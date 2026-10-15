import CoreLocation
import SwiftUI

// Open civic data around the user: shelters and cooling/warming centers,
// SNAP stores, health centers, benefits offices, housing counselors, trash
// day, water outages, and snow plowing. Every source was checked on
// 2026-10-06; none needs a key or a login.

/// One place in a list: a title, a few lines, and how to reach it.
struct CivicPlace: Identifiable, Hashable {
    let id: String
    let title: String
    var lines: [String] = []
    var phone: String?
    var web: URL?
    var lat: Double?
    var lon: Double?
    var badge: String?
    /// Hide the address and directions (confidential shelters).
    var hidden = false
}

enum ArcGIS {
    /// Features near a point, or all features when `miles` is nil.
    static func query(_ layer: String, near c: CLLocationCoordinate2D? = nil, miles: Double? = nil,
                      where clause: String = "1=1", limit: Int = 500) async throws -> [[String: Any]] {
        var q = URLComponents(string: layer + "/query")!
        q.queryItems = [
            .init(name: "where", value: clause), .init(name: "outFields", value: "*"),
            .init(name: "outSR", value: "4326"), .init(name: "returnGeometry", value: "true"),
            .init(name: "resultRecordCount", value: "\(limit)"), .init(name: "f", value: "json"),
        ]
        if let c {
            q.queryItems! += [
                .init(name: "geometry", value: "\(c.longitude),\(c.latitude)"), .init(name: "geometryType", value: "esriGeometryPoint"),
                .init(name: "inSR", value: "4326"), .init(name: "spatialRel", value: "esriSpatialRelIntersects"),
            ]
            if let miles { q.queryItems! += [.init(name: "distance", value: "\(miles)"), .init(name: "units", value: "esriSRUnit_StatuteMile")] }
        }
        var req = URLRequest(url: q.url!)
        req.timeoutInterval = 30
        let (d, _) = try await URLSession.shared.data(for: req)
        let obj = try JSONSerialization.jsonObject(with: d) as? [String: Any] ?? [:]
        return (obj["features"] as? [[String: Any]] ?? [])
    }

    static func attrs(_ f: [String: Any]) -> [String: Any] { f["attributes"] as? [String: Any] ?? [:] }
    static func point(_ f: [String: Any]) -> (Double, Double)? {
        guard let g = f["geometry"] as? [String: Any], let x = g["x"] as? Double, let y = g["y"] as? Double else { return nil }
        return (y, x)
    }
}

extension Dictionary where Key == String, Value == Any {
    /// A field as text whatever its JSON type, trimmed.
    func text(_ k: String) -> String {
        switch self[k] {
        case let s as String: s.trimmingCharacters(in: .whitespaces)
        case let n as NSNumber: n.stringValue
        default: ""
        }
    }
}

/// The loaders behind each list. Each takes the user's position.
enum CivicSources {
    static let kcmo = "https://services.arcgis.com/4o5uMWTHuOhUVJPd/arcgis/rest/services"

    static func shelters(_ c: CLLocationCoordinate2D) async throws -> [CivicPlace] {
        try await ArcGIS.query("https://maps2.kcmo.org/kcgis/rest/services/Data_Layers/BedInventory/FeatureServer/1").compactMap { f in
            let a = ArcGIS.attrs(f)
            let type = a.text("USER_ProjectType")
            guard type.hasPrefix("ES") || type.hasPrefix("SH") || type.hasPrefix("TH") else { return nil }
            let kind = type.hasPrefix("ES") ? "Emergency shelter" : type.hasPrefix("SH") ? "Safe haven" : "Transitional housing"
            let confidential = a.text("USER_VictimServiceProvider") == "Yes"
            let p = ArcGIS.point(f)
            var lines = [kind + (a.text("USER_CurrentBedInventory").isEmpty ? "" : " · \(a.text("USER_CurrentBedInventory")) beds")]
            let who = a.text("USER_HouseholdTargetPopulation").replacingOccurrences(of: #"^[A-Z]+ - "#, with: "", options: .regularExpression)
            if !who.isEmpty { lines.append("For: " + who) }
            lines.append(confidential ? "Confidential location for survivors of violence. Call 211 for intake."
                         : a.text("USER_ProjectAddress"))
            return CivicPlace(id: "bed-\(a.text("OBJECTID"))", title: a.text("USER_ProjectName"), lines: lines,
                         phone: confidential ? "211" : nil, lat: confidential ? nil : p?.0, lon: confidential ? nil : p?.1,
                         badge: type.hasPrefix("ES") ? "Shelter" : nil, hidden: confidential)
        }
    }

    static func centers(_ kind: String, _ c: CLLocationCoordinate2D) async throws -> [CivicPlace] {
        try await ArcGIS.query("https://gis.mo.gov/arcgis/rest/services/DHSS/\(kind)_Center/MapServer/0", near: c, miles: 30).map { f in
            let a = ArcGIS.attrs(f)
            var lines = ["\(a.text("ADDRESS")), \(a.text("CITY"))", a.text("HOURS_OF_OPERATION")]
            if a.text("ID_REQUIRED").lowercased().hasPrefix("y") { lines.append("ID required") }
            return CivicPlace(id: "\(kind)-\(a.text("OBJECTID"))", title: a.text("FACILITY"), lines: lines.filter { !$0.isEmpty },
                         phone: a.text("PHONE"), lat: Double(a.text("LATITUDE")), lon: Double(a.text("LONGITUDE")))
        }
    }

    static func snap(_ c: CLLocationCoordinate2D) async throws -> [CivicPlace] {
        try await ArcGIS.query("https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/snap_retailer_location_data/FeatureServer/0",
                               near: c, miles: 3, limit: 200).map { f in
            let a = ArcGIS.attrs(f)
            var lines = [a.text("Store_Type"), "\(a.text("Store_Street_Address")), \(a.text("City"))"]
            if !a.text("Incentive_Program").isEmpty { lines.append("Incentive: " + a.text("Incentive_Program")) }
            return CivicPlace(id: "snap-\(a.text("Record_ID"))", title: a.text("Store_Name").capitalized, lines: lines.filter { !$0.isEmpty },
                         lat: Double(a.text("Latitude")), lon: Double(a.text("Longitude")))
        }
    }

    static func healthCenters(_ c: CLLocationCoordinate2D) async throws -> [CivicPlace] {
        guard let u = Bundle.main.url(forResource: "HealthCenters", withExtension: "json"),
              let rows = try JSONSerialization.jsonObject(with: Data(contentsOf: u)) as? [[String: Any]] else { return [] }
        return rows.map { r in
            CivicPlace(id: "hc-\(r.text("name"))-\(r.text("address"))", title: r.text("name"),
                  lines: [r.text("org"), r.text("address"), r.text("hours").isEmpty ? "" : "\(r.text("hours")) hours a week"].filter { !$0.isEmpty },
                  phone: r.text("phone"), web: URL(string: r.text("web").hasPrefix("http") ? r.text("web") : "https://" + r.text("web")).flatMap { r.text("web").isEmpty ? nil : $0 },
                  lat: r["lat"] as? Double, lon: r["lon"] as? Double)
        }
    }

    static func benefitsOffices(_ c: CLLocationCoordinate2D) async throws -> [CivicPlace] {
        let (d, _) = try await URLSession.shared.data(from: URL(string: "https://data.mo.gov/resource/dsx5-5mwh.json?$limit=500")!)
        let rows = try JSONSerialization.jsonObject(with: d) as? [[String: Any]] ?? []
        return rows.compactMap { r in
            guard let loc = r["location_1"] as? [String: Any] else { return nil }
            var addr = ""
            if let h = (loc["human_address"] as? String)?.data(using: .utf8),
               let a = try? JSONSerialization.jsonObject(with: h) as? [String: Any] {
                addr = "\(a.text("address")), \(a.text("city"))"
            }
            return CivicPlace(id: "fsd-\(r.text("resource_center"))", title: r.text("resource_center"),
                         lines: [addr, r.text("hours_of_operation"), r.text("drop_box_information").capitalized].filter { !$0.isEmpty },
                         phone: r.text("phone_number"), lat: Double(loc.text("latitude")), lon: Double(loc.text("longitude")))
        }
    }

    static func housingCounselors(_ c: CLLocationCoordinate2D) async throws -> [CivicPlace] {
        let u = URL(string: "https://data.hud.gov/Housing_Counselor/searchByLocation?Lat=\(c.latitude)&Long=\(c.longitude)&Distance=15")!
        let (d, _) = try await URLSession.shared.data(from: u)
        let rows = try JSONSerialization.jsonObject(with: d) as? [[String: Any]] ?? []
        return rows.map { r in
            CivicPlace(id: "hud-\(r.text("agcid"))", title: r.text("nme").capitalized,
                  lines: ["\(r.text("adr1")), \(r.text("city"))", "Languages: " + r.text("languages")],
                  phone: r.text("phone1"), web: URL(string: r.text("weburl")),
                  lat: Double(r.text("agc_ADDR_LATITUDE")), lon: Double(r.text("agc_ADDR_LONGITUDE")))
        }
    }
}

/// A list of places, nearest first, from one or more sources.
struct PlacesView: View {
    let title: String
    let intro: String
    var links: [(String, String)] = []
    let sections: [(String, (CLLocationCoordinate2D) async throws -> [CivicPlace])]
    @State private var here: CLLocationCoordinate2D?
    @State private var results: [String: [CivicPlace]] = [:]
    @State private var errors: [String: String] = [:]
    @State private var web: URL?

    var body: some View {
        List {
            Section {
                Text(intro).font(.subheadline).foregroundStyle(Theme.onSurfaceVariant)
                ForEach(links, id: \.0) { l in
                    Button { web = URL(string: l.1) } label: {
                        HStack { Text(l.0).foregroundStyle(Theme.primary); Spacer(); Icon(name: "open_in_new", size: 18).foregroundStyle(Theme.onSurfaceVariant) }
                    }
                }
            }
            ForEach(sections, id: \.0) { name, _ in
                Section(name) {
                    if let e = errors[name] {
                        Text("Could not load: \(e)").font(.caption).foregroundStyle(Theme.error)
                    } else if let list = results[name] {
                        if list.isEmpty { Text("None nearby.").font(.caption).foregroundStyle(Theme.onSurfaceVariant) }
                        ForEach(sorted(list).prefix(30), id: \.0.id) { p, m in PlaceRow(place: p, meters: m) { web = $0 } }
                    } else {
                        HStack { Spacer(); ProgressView(); Spacer() }
                    }
                }
            }
        }
        .wrappingTitle(title)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $web) { SafariView(url: $0).ignoresSafeArea() }
    }

    private func sorted(_ list: [CivicPlace]) -> [(CivicPlace, Double?)] {
        let c = here ?? Locator.downtown
        let me = CLLocation(latitude: c.latitude, longitude: c.longitude)
        return list.map { p in (p, p.lat.flatMap { la in p.lon.map { me.distance(from: CLLocation(latitude: la, longitude: $0)) } }) }
            .sorted { ($0.1 ?? .greatestFiniteMagnitude) < ($1.1 ?? .greatestFiniteMagnitude) }
    }

    /// One section's result. A struct on purpose: with Swift 6.3.3 at -O, a
    /// task group of `(String, Result<[CivicPlace], Error>)` aborts in
    /// AsyncTask::completeFuture (TestFlight crash, 2026-10-07).
    private struct Loaded: Sendable {
        let name: String
        let places: [CivicPlace]?
        let error: String?
    }

    private func load() async {
        let c = await Locator.shared.currentIfAllowed() ?? Locator.downtown
        here = c
        await withTaskGroup(of: Loaded.self) { g in
            for (name, loader) in sections {
                g.addTask {
                    do { return Loaded(name: name, places: try await loader(c), error: nil) }
                    catch { return Loaded(name: name, places: nil, error: error.localizedDescription) }
                }
            }
            for await r in g {
                if let v = r.places { results[r.name] = v; errors[r.name] = nil }
                else if results[r.name] == nil { errors[r.name] = r.error }
            }
        }
    }
}

struct PlaceRow: View {
    let place: CivicPlace
    let meters: Double?
    let openWeb: (URL) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(place.title).font(.headline).foregroundStyle(Theme.onSurface)
                if let b = place.badge {
                    Text(b).font(.caption2.weight(.semibold)).padding(.horizontal, 6).padding(.vertical, 2)
                        .foregroundStyle(Theme.onErrorContainer).background(Theme.errorContainer, in: Capsule())
                }
                Spacer()
                if let m = meters { Text(NearbyRow.distance(m)).font(.caption.monospacedDigit()).foregroundStyle(Theme.onSurfaceVariant) }
            }
            ForEach(place.lines, id: \.self) { Text($0).font(.caption).foregroundStyle(Theme.onSurfaceVariant) }
            HStack(spacing: 8) {
                if let ph = place.phone, !ph.isEmpty, let u = URL(string: "tel:" + ph.filter(\.isNumber)) {
                    Link(destination: u) { chip(ph == "211" ? "Call 211" : "Call", "call") }
                }
                if !place.hidden, let la = place.lat, let lo = place.lon,
                   let u = URL(string: "http://maps.apple.com/?daddr=\(la),\(lo)") {
                    Link(destination: u) { chip("Directions", "directions") }
                }
                if let w = place.web { Button { openWeb(w) } label: { chip("Website", "open_in_new") }.buttonStyle(.plain) }
            }
            .padding(.top, 2)
        }
        .padding(.vertical, 4)
    }

    private func chip(_ t: String, _ i: String) -> some View {
        HStack(spacing: 4) { Icon(name: i, size: 16); Text(t).font(.caption.weight(.semibold)) }
            .padding(.horizontal, 10).padding(.vertical, 5)
            .foregroundStyle(Theme.onPrimaryContainer).background(Theme.secondaryContainer, in: Capsule())
    }
}

/// The basic-needs screens, linked from Health and help.
enum BasicNeeds {
    static var stay: PlacesView {
        PlacesView(title: "Somewhere to stay",
                   intro: "Shelters and housing programs from the city's bed inventory. Bed counts are capacity, not tonight's openings: call 211 to find a bed today.",
                   links: [("211: find a bed tonight", "https://www.unitedwaygkc.org/211")],
                   sections: [("Shelters and housing", CivicSources.shelters),
                              ("Cooling centers", { try await CivicSources.centers("Cooling", $0) }),
                              ("Warming centers", { try await CivicSources.centers("Warming", $0) })])
    }
    static var food: PlacesView {
        PlacesView(title: "Food",
                   intro: "Food pantries and free meals are listed by Harvesters, the region's food bank. Stores that take SNAP (EBT) are below.",
                   links: [("Harvesters: find food near you", "https://www.harvesters.org/get-food-assistance/food-locator"),
                           ("211: food help", "https://www.unitedwaygkc.org/211")],
                   sections: [("Stores that take SNAP", CivicSources.snap)])
    }
    static var clinics: PlacesView {
        PlacesView(title: "Low-cost clinics",
                   intro: "Federally funded health centers. They see patients whether or not they have insurance, with fees based on income.",
                   sections: [("Health centers", CivicSources.healthCenters)])
    }
    static var benefits: PlacesView {
        PlacesView(title: "SNAP, Medicaid, and housing help",
                   intro: "Missouri Family Support Division offices handle SNAP and Medicaid. HUD-approved counselors help with rent, eviction, and foreclosure.",
                   links: [("Missouri DSS: apply online", "https://dss.mo.gov"), ("Legal Aid of Western Missouri", "https://www.lawmo.org")],
                   sections: [("Family Support offices", CivicSources.benefitsOffices),
                              ("Housing counselors", CivicSources.housingCounselors)])
    }
}

// MARK: Near you (Report home)

/// Trash day, leaf and brush zone, water outages, and snow plowing for the
/// phone's position. Saved for a day; the outage and snow checks refresh
/// every launch.
@MainActor
final class NearYou: ObservableObject {
    static let shared = NearYou()
    @Published var trashDay: String?
    @Published var zone: String?
    @Published var outage: String?
    @Published var plowed: String?
    private var loaded: CLLocationCoordinate2D?

    func load() async {
        guard let c = await Locator.shared.currentIfAllowed() else { return }
        if let l = loaded, CLLocation(latitude: l.latitude, longitude: l.longitude)
            .distance(from: CLLocation(latitude: c.latitude, longitude: c.longitude)) < 100, trashDay != nil { await live(c); return }
        loaded = c
        if let f = try? await ArcGIS.query("https://mapd.kcmo.org/kcgis/rest/services/AGOL/MapServer/5", near: c).first {
            trashDay = ArcGIS.attrs(f).text("TRASHDAY")
        }
        if let f = try? await ArcGIS.query("\(CivicSources.kcmo)/Leaf_Brush_Zones/FeatureServer/0", near: c).first {
            zone = ArcGIS.attrs(f).text("ZONE")
        }
        await live(c)
    }

    private func live(_ c: CLLocationCoordinate2D) async {
        let o = try? await ArcGIS.query("https://maps.kcwater.info/arcgis/rest/services/WaterOutage_MainBreakArea/MapServer/0",
                                        near: c, where: "Status='Active'")
        if let a = o?.first.map(ArcGIS.attrs) {
            let end = (a["EstimatedEndTime"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) }
            outage = "Water outage at your location" + (end.map { ", expected back \($0.formatted(date: .omitted, time: .shortened))" } ?? "")
        } else { outage = nil }
        let s = try? await ArcGIS.query("\(CivicSources.kcmo)/EventSnowRoutes_public_74e8930bc7fb4f2aa30a81bec12d50bc/FeatureServer/0",
                                        near: c, miles: 0.1, limit: 20)
        let last = s?.compactMap { ArcGIS.attrs($0)["lastserviced"] as? Double }.max().map { Date(timeIntervalSince1970: $0 / 1000) }
        if let last, Date().timeIntervalSince(last) < 3 * 86400 { plowed = "Your street was plowed \(last.relative)" } else { plowed = nil }
    }
}

struct NearYouCard: View {
    @ObservedObject private var near = NearYou.shared

    var body: some View {
        if near.trashDay != nil || near.outage != nil || near.plowed != nil {
            VStack(alignment: .leading, spacing: 10) {
                if let o = near.outage { row("water_drop", o, Theme.error) }
                if let t = near.trashDay, !t.isEmpty {
                    row("delete", "Trash day: \(t)" + ((near.zone ?? "").isEmpty ? "" : " · Leaf and brush zone: \(near.zone!)"), Theme.primary)
                }
                if let p = near.plowed { row("ac_unit", p, Theme.primary) }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        }
    }

    private func row(_ icon: String, _ text: String, _ color: Color) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Icon(name: icon, size: 20).foregroundStyle(color)
            Text(text).font(.subheadline).foregroundStyle(Theme.onSurface)
        }
    }
}
