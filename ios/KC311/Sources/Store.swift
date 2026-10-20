import CoreLocation
import Foundation
import UIKit

/// Everything the screens read: the report catalog, city links, my reports,
/// report details, and map pins. Each one is saved on disk and shown at
/// once on launch; the network refresh replaces it in the background, so a
/// screen only waits when it has never loaded before.
@MainActor
final class Store: ObservableObject {
    static let menuReport = "10871"

    @Published var categories: [Category] = []
    @Published var links: [CityLink] = []
    @Published var catalogError: String?
    @Published var myReports: [MyReport] = []
    @Published var myReportsState: LoadState = .idle
    @Published var queued: [QueuedReport] = []
    @Published var mapIssues: [String: [MapIssue]] = [:]
    @Published var mapLoading: Set<String> = []
    @Published var mapError: String?
    var mapCenter: CLLocationCoordinate2D?

    enum LoadState: Equatable { case idle, loading, loaded, failed(String) }

    private let api = CivicClient.shared
    private var cacheURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("get_main.json")
    }
    private func file(_ name: String) -> URL { cacheURL.deletingLastPathComponent().appendingPathComponent(name) }
    /// Raw `get_issue_detail_citizen` rows by report id, with when they were fetched.
    // Published so the report cards redraw their track when a detail loads.
    @Published private var detailCache: [String: [String: Any]] = [:]
    private var queueURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("queue.json")
    }

    init() {
        try? FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: cacheURL), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            apply(obj)
        }
        if let data = try? Data(contentsOf: queueURL), let q = try? JSONDecoder().decode([QueuedReport].self, from: data) {
            queued = q
        }
        loadSavedMaps()
        if let d = try? Data(contentsOf: file("myissues.json")), let rows = try? JSONSerialization.jsonObject(with: d) as? [[String: Any]] {
            myReports = rows.map(MyReport.init)
            myReportsState = .loaded
        }
        if let d = try? Data(contentsOf: file("details.json")), let c = try? JSONSerialization.jsonObject(with: d) as? [String: [String: Any]] {
            detailCache = c
        }
    }

    // MARK: Catalog

    /// The catalog changes rarely, so a saved copy younger than 6 hours is
    /// kept unless `force` (the "Try again" button).
    func refreshCatalog(force: Bool = false) async {
        if !force, !categories.isEmpty, let t = UserDefaults.standard.object(forKey: "catalogSaved") as? Date,
           Date().timeIntervalSince(t) < 6 * 3600 { return }
        do {
            let obj = try await api.post("get_main", fields: ["timestamp": "0"])
            apply(obj)
            catalogError = nil
            if let data = try? JSONSerialization.data(withJSONObject: obj) { try? data.write(to: cacheURL) }
            UserDefaults.standard.set(Date(), forKey: "catalogSaved")
        } catch {
            if categories.isEmpty { catalogError = error.localizedDescription }
        }
    }

    private func apply(_ obj: [String: Any]) {
        guard let tables = (obj["response_data"] as? [String: Any])?["data"] as? [[String: Any]] else { return }
        var byName: [String: [[String: Any]]] = [:]
        for t in tables { byName[t.str("table_name")] = t["records"] as? [[String: Any]] ?? [] }
        let subs = (byName["RAI_SUBCATEGORY"] ?? []).map(CatalogRow.init)
        categories = (byName["RAI_CATEGORY"] ?? [])
            .sorted { (Int($0.str("sort_order")) ?? 0) < (Int($1.str("sort_order")) ?? 0) }
            .map { cat in
                let mine = subs.filter { $0.flag("category_id") == cat.str("cat_id") }
                    .sorted { (Int($0.flag("cat_order")) ?? 0) < (Int($1.flag("cat_order")) ?? 0) }
                return Category(row: CatalogRow(raw: cat), subs: mine)
            }
            .filter { $0.row.flag("no_entry") != "yes" }
        links = (byName["MENU"] ?? [])
            .filter { $0.str("menu_item_type") == "HTML" }
            .compactMap { r in
                let s = r.str("ios_url").isEmpty ? r.str("menu_item_url") : r.str("ios_url")
                guard let url = URL(string: s.trimmingCharacters(in: .whitespaces)), url.scheme?.hasPrefix("http") == true else { return nil }
                return CityLink(name: r.str("menu_item_name"), url: url)
            }
    }

    // MARK: My reports

    func loadMyReports() async {
        if myReports.isEmpty { myReportsState = .loading }
        do {
            let obj = try await api.postJSON("myissues", payload: ["device_id": api.deviceUID, "start": 0])
            let rows = obj["my_issues"] as? [[String: Any]] ?? []
            myReports = rows.map(MyReport.init)
            myReportsState = .loaded
            if let d = try? JSONSerialization.data(withJSONObject: rows) { try? d.write(to: file("myissues.json")) }
            // The cards' status track reads staff notes from each open
            // report's detail. One at a time: the server queues a session anyway.
            let open = myReports.filter { $0.isOpen && !$0.isUpdateRequest }.map(\.id)
            Task { for id in open { _ = try? await detail(id) } }
        } catch {
            myReportsState = .failed(error.localizedDescription)
        }
    }

    /// One report's detail. Since Tyler's October 2026 fix, get_issue_detail_citizen
    /// opens only this device's reports; other people's reports come from
    /// reported_issue_detail, the endpoint the official app uses for its public list.
    func detail(_ id: String, isPublic: Bool = false) async throws -> ReportDetail {
        let obj = try await api.post(isPublic ? "reported_issue_detail" : "get_issue_detail_citizen", fields: ["issue_id": id])
        guard let issue = ((obj["response_data"] as? [String: Any])?["issues"] as? [[String: Any]])?.first else {
            throw CivicError.server("This report is not available.")
        }
        // Other people's contact fields are never saved.
        let kept = issue.filter { !$0.key.hasPrefix("reporter_") }
        detailCache[id] = kept
        // Keep the 300 most recent, so the file stays small.
        if detailCache.count > 300 { detailCache.removeValue(forKey: detailCache.keys.sorted().first!) }
        if let d = try? JSONSerialization.data(withJSONObject: detailCache) { try? d.write(to: file("details.json")) }
        return ReportDetail(kept)
    }

    /// The last saved detail for a report, to show while the fresh one loads.
    func cachedDetail(_ id: String) -> ReportDetail? { detailCache[id].map(ReportDetail.init) }

    /// A report's detail, with each update request that names it and all
    /// staff activity on those requests merged into its timeline by time.
    func fullDetail(_ t: some UpdateTarget) async throws -> ReportDetail {
        let base = try await detail(t.id, isPublic: !myReports.contains { $0.id == t.id })
        let requests = updateRequests(for: t)
        for r in requests { _ = try? await detail(r.id) }
        return merged(base, requests: requests)
    }

    func cachedFullDetail(_ t: some UpdateTarget) -> ReportDetail? {
        cachedDetail(t.id).map { merged($0, requests: updateRequests(for: t)) }
    }

    private func merged(_ base: ReportDetail, requests: [MyReport]) -> ReportDetail {
        var d = base
        var rows = d.timeline
        for r in requests {
            guard let rd = cachedDetail(r.id) else { continue }
            rows.append(TimelineEntry(title: "Update requested", details: "Update request \(r.id), now \(rd.status).",
                                      when: rd.added?.formatted(date: .abbreviated, time: .shortened) ?? "", at: rd.added ?? r.added))
            rows += rd.timeline.map {
                TimelineEntry(title: "Update request \(r.id): \($0.title)", details: $0.details, when: $0.when, at: $0.at)
            }
        }
        d.timeline = rows.sorted { ($0.at ?? .distantPast) < ($1.at ?? .distantPast) }
        return d
    }

    // MARK: Map

    /// Public reports near a point, saved per status so the map opens with
    /// the last pins at once. The city's map endpoint takes about 6 s per
    /// call and answers HTTP 500 for some mixes of categories (each category
    /// alone always works), so it asks in groups of 5, all at once (the
    /// cookie-free session lets them run in parallel), splits a failed group
    /// into single categories, and shows pins as they land.
    func loadMap(center c: CLLocationCoordinate2D, status: String, force: Bool = false) async {
        if mapLoading.contains(status) { return }
        // Saved pins less than 15 minutes old, near the same spot, are current enough.
        if !force, let saved = UserDefaults.standard.object(forKey: "mapSaved-\(status)") as? Date,
           Date().timeIntervalSince(saved) < 15 * 60, let mc = mapCenter ?? savedMapCenter,
           CLLocation(latitude: mc.latitude, longitude: mc.longitude).distance(from: CLLocation(latitude: c.latitude, longitude: c.longitude)) < 1500 {
            return
        }
        mapLoading.insert(status)
        // A new try clears the last failure, so the banner never sits on top of a working load.
        mapError = nil
        defer { mapLoading.remove(status) }
        let names = reportCategories.map(\.name)
        guard !names.isEmpty else { return }
        // Categories that once broke a group are asked alone from the start.
        let solo = Set(UserDefaults.standard.stringArray(forKey: "mapSolo") ?? [])
        let mixed = names.filter { !solo.contains($0) }
        let groups = stride(from: 0, to: mixed.count, by: 5).map { Array(mixed[$0..<min($0 + 5, mixed.count)]) }
            + names.filter { solo.contains($0) }.map { [$0] }
        let learned = SoloLedger()
        var fresh: [String: MapIssue] = [:]
        var failed = 0
        await withTaskGroup(of: [MapIssue]?.self) { tg in
            for g in groups {
                tg.addTask { [api] in
                    if let rows = try? await Self.mapCall(api, c, status, g) { return rows }
                    if g.count > 1 { await learned.add(g) }
                    // Split the group: one call per category.
                    return await withTaskGroup(of: [MapIssue]?.self) { inner in
                        for n in g { inner.addTask { try? await Self.mapCall(api, c, status, [n]) } }
                        var all: [MapIssue]? = nil
                        for await r in inner { if let r { all = (all ?? []) + r } }
                        return all
                    }
                }
            }
            for await chunk in tg {
                guard let chunk else { failed += 1; continue }
                for i in chunk { fresh[i.id] = i }
                // Show new pins as they arrive, on top of the saved ones.
                var shown = Dictionary((mapIssues[status] ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
                for i in chunk { shown[i.id] = i }
                mapIssues[status] = Array(shown.values)
            }
        }
        if failed == groups.count {
            mapError = Self.isOffline ? "No internet connection. Showing the last saved pins."
                : "The city's map did not answer. Showing the last saved pins. Tap refresh to try again."
            return
        }
        mapError = nil
        let newSolo = await learned.names
        if !newSolo.isEmpty { UserDefaults.standard.set(Array(solo.union(newSolo)), forKey: "mapSolo") }
        mapIssues[status] = Array(fresh.values)
        mapCenter = c
        UserDefaults.standard.set(Date(), forKey: "mapSaved-\(status)")
        UserDefaults.standard.set([c.latitude, c.longitude], forKey: "mapCenter")
        saveMap(status)
    }

    /// Set when the last map call failed because the phone had no connection.
    nonisolated(unsafe) private static var isOffline = false

    nonisolated private static func mapCall(_ api: CivicClient, _ c: CLLocationCoordinate2D, _ status: String,
                                            _ names: [String]) async throws -> [MapIssue] {
        let filter = try JSONSerialization.data(withJSONObject: ["status": status, "issue_type": names.joined(separator: ",")])
        let obj: [String: Any]
        do {
            obj = try await api.post("reported_issues_map", fields: [
                "menu_id": Store.menuReport, "lat": "\(c.latitude)", "lng": "\(c.longitude)",
                "FilterOptions": String(data: filter, encoding: .utf8)!,
            ])
            isOffline = false
        } catch let e as CivicError {
            if case .offline = e { isOffline = true }
            throw e
        }
        let rows = (obj["response_status"] as? [String: Any])?["response_data"] as? [[String: Any]] ?? []
        return rows.compactMap(MapIssue.init)
    }

    private func mapURL(_ status: String) -> URL {
        cacheURL.deletingLastPathComponent().appendingPathComponent("map-\(status).json")
    }

    private func saveMap(_ status: String) {
        if let d = try? JSONEncoder().encode(mapIssues[status] ?? []) { try? d.write(to: mapURL(status)) }
    }

    private var savedMapCenter: CLLocationCoordinate2D? {
        guard let a = UserDefaults.standard.array(forKey: "mapCenter") as? [Double], a.count == 2 else { return nil }
        return CLLocationCoordinate2D(latitude: a[0], longitude: a[1])
    }

    func loadSavedMaps() {
        for st in ["open", "closed", "all"] {
            if let d = try? Data(contentsOf: mapURL(st)), let v = try? JSONDecoder().decode([MapIssue].self, from: d) {
                mapIssues[st] = v
            }
        }
    }

    // MARK: Filing

    struct Duplicate { let level: String; let message: String }

    func checkDuplicate(_ d: ReportDraft) async throws -> Duplicate {
        guard let loc = d.location, let cat = d.category else { return Duplicate(level: "0", message: "") }
        let obj = try await api.postJSON("check_duplicate_issue", payload: [
            "latitude": "\(loc.coordinate.latitude)", "longitude": "\(loc.coordinate.longitude)",
            "address": loc.street, "city": loc.city, "state": loc.state, "zip": loc.zip,
            "type": cat.id, "subtype": d.sub?.id ?? "", "device_id": api.deviceUID,
        ])
        let rd = obj["response_data"] as? [String: Any] ?? [:]
        return Duplicate(level: rd.str("allow_duplicate"), message: obj.str("response_message"))
    }

    /// Files a REAL report with the city. Returns the work order number.
    func submit(_ d: ReportDraft, contact: Contact?) async throws -> String {
        let (issue, zip) = try d.payload(deviceUID: api.deviceUID, contact: contact)
        var files: [CivicClient.FilePart] = []
        if let zip {
            files.append(.init(name: "file_zip", filename: "\(Int(Date().timeIntervalSince1970 * 1000))_images.zip",
                               data: zip, mime: "application/zip"))
        }
        let json = String(data: try JSONSerialization.data(withJSONObject: issue), encoding: .utf8)!
        let obj = try await api.post("report_an_issue", fields: ["issue_details": json], files: files, includeBase: false)
        let status = obj["response_status"] as? [String: Any] ?? [:]
        guard status.str("response_code") == "1" else {
            throw CivicError.server(status.str("response_message"))
        }
        return status.str("work_order")
    }

    // MARK: Offline queue

    func enqueue(_ d: ReportDraft, contact: Contact?) {
        guard let q = try? QueuedReport(draft: d, deviceUID: api.deviceUID, contact: contact) else { return }
        queued.append(q)
        saveQueue()
    }

    /// Sends queued reports. Stops at the first one that still cannot go.
    func flushQueue() async {
        while let q = queued.first {
            do {
                var files: [CivicClient.FilePart] = []
                if let zip = q.zip {
                    files.append(.init(name: "file_zip", filename: "\(Int(Date().timeIntervalSince1970 * 1000))_images.zip",
                                       data: zip, mime: "application/zip"))
                }
                let obj = try await api.post("report_an_issue", fields: ["issue_details": q.issueJSON], files: files, includeBase: false)
                let status = obj["response_status"] as? [String: Any] ?? [:]
                if status.str("response_code") != "1" { break }
                queued.removeFirst()
                saveQueue()
            } catch {
                break
            }
        }
        if queued.isEmpty { await loadMyReports() }
    }

    private func saveQueue() {
        if let data = try? JSONEncoder().encode(queued) { try? data.write(to: queueURL) }
    }
}

struct Contact: Codable, Equatable {
    var firstName = ""
    var lastName = ""
    var email = ""
    var phone = ""

    var isEmpty: Bool { [firstName, lastName, email, phone].allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty } }

    static var saved: Contact {
        get {
            guard let data = UserDefaults.standard.data(forKey: "contact"),
                  let c = try? JSONDecoder().decode(Contact.self, from: data) else { return Contact() }
            return c
        }
        set { UserDefaults.standard.set(try? JSONEncoder().encode(newValue), forKey: "contact") }
    }
}

struct QueuedReport: Codable, Identifiable {
    var id = UUID()
    let title: String
    let issueJSON: String
    let zip: Data?
    let created: Date

    @MainActor
    init(draft: ReportDraft, deviceUID: String, contact: Contact?) throws {
        let (issue, zip) = try draft.payload(deviceUID: deviceUID, contact: contact)
        title = [draft.category?.name, draft.sub?.name].compactMap { $0 }.joined(separator: ": ")
        issueJSON = String(data: try JSONSerialization.data(withJSONObject: issue), encoding: .utf8)!
        self.zip = zip
        created = Date()
    }
}

/// Collects the categories of map groups that failed, across parallel calls.
actor SoloLedger {
    private(set) var names: Set<String> = []
    func add(_ group: [String]) { names.formUnion(group) }
}
