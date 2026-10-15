import CoreLocation
import SwiftUI

/// Missouri license offices (driver licenses, plates, titles), nearest first,
/// with today's hours. Missouri takes no appointments at these offices; they
/// are walk-in, run by contractors for the Department of Revenue. The data
/// is the state's own open dataset, the one the DOR office locator map
/// reads (data.mo.gov 835g-7keg).
struct LicenseOffice: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let address: String
    let phone: String
    let hours: String
    let closedDays: String
    let lat: Double
    let lon: Double

    init?(_ d: [String: Any]) {
        guard let ll = d["latlng"] as? [String: Any], let lat = Double(ll.str("latitude")), let lon = Double(ll.str("longitude")) else { return nil }
        id = d.str("number")
        name = d.str("name")
        // The data stores ZIP+4 as nine bare digits ("641100000").
        let zip = String(d.str("zipcode").prefix(5))
        address = [d.str("address1"), d.str("address2"), "\(d.str("city")), MO \(zip)"]
            .filter { !$0.isEmpty }.joined(separator: ", ")
        phone = d.str("phone")
        hours = d.str("daysopen").replacingOccurrences(of: "  ", with: " ")
        closedDays = [d.str("holidaysclosed"), d.str("additionaldaysclosed")].joined(separator: ", ")
        self.lat = lat
        self.lon = lon
    }

    enum Today: Equatable { case open(until: String), opensLater(at: String), closed, closesEarly, unknown }

    /// Today's state from the free-text hours. Special rules ("last
    /// Saturday", "bus day") are not computed; the raw text shows them.
    func today(_ now: Date = Date()) -> Today {
        let cal = Calendar.current
        let c = cal.dateComponents([.month, .day, .year, .weekday, .hour, .minute], from: now)
        let stamp = "\(c.month!)/\(c.day!)/\(c.year!)"
        if let r = closedDays.range(of: stamp) {
            let after = closedDays[r.upperBound...].prefix(25).lowercased()
            return after.contains("partial") ? .closesEarly : .closed
        }
        guard let span = Self.span(hours, weekday: c.weekday!) else {
            // A special rule ("last Saturday") may cover today; say nothing rather than guess.
            let segs = Self.segments(hours)
            return segs.isEmpty || segs.contains { $0.0.isEmpty } ? .unknown : .closed
        }
        let minutes = c.hour! * 60 + c.minute!
        if minutes < span.0 { return .opensLater(at: Self.clock(span.0)) }
        if minutes < span.1 { return .open(until: Self.clock(span.1)) }
        return .closed
    }

    private static let days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

    /// Segments of "<days> H:MM-H:MM". Each one: the days it covers (empty
    /// when the rule is special) and the minutes it opens and closes.
    private static func segments(_ text: String) -> [(Set<Int>, Int, Int)] {
        let s = text.lowercased()
        guard let re = try? NSRegularExpression(pattern: #"(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})"#) else { return [] }
        var out: [(Set<Int>, Int, Int)] = []
        var from = s.startIndex
        for m in re.matches(in: s, range: NSRange(s.startIndex..., in: s)) {
            guard let r = Range(m.range, in: s) else { continue }
            let dayText = String(s[from..<r.lowerBound])
            from = r.upperBound
            func n(_ i: Int) -> Int { Int(s[Range(m.range(at: i), in: s)!])! }
            let open = n(1) * 60 + n(2)
            var closeHour = n(3)
            if closeHour < n(1) || closeHour <= 7 { closeHour += 12 }
            let close = closeHour * 60 + n(4)
            let special = ["last", "1st", "first", "except", "bus day"].contains { dayText.contains($0) }
            out.append((special ? [] : dayset(dayText), open, close))
        }
        return out
    }

    private static func dayset(_ t: String) -> Set<Int> {
        let found = days.indices.compactMap { i -> (Int, String.Index)? in
            t.range(of: days[i]).map { (i + 1, $0.lowerBound) }
        }.sorted { $0.1 < $1.1 }.map(\.0)
        // "monday - friday" (or "monday friday", a dash lost in the data) is a range.
        if found.count == 2, !t.contains(",") { return Set(found[0]...found[1]) }
        return Set(found)
    }

    private static func span(_ text: String, weekday: Int) -> (Int, Int)? {
        segments(text).first { $0.0.contains(weekday) }.map { ($0.1, $0.2) }
    }

    private static func clock(_ m: Int) -> String {
        let h = m / 60, mm = m % 60
        let h12 = h % 12 == 0 ? 12 : h % 12
        return mm == 0 ? "\(h12) \(h < 12 ? "AM" : "PM")" : String(format: "%d:%02d %@", h12, mm, h < 12 ? "AM" : "PM")
    }
}

@MainActor
final class LicenseOfficeStore: ObservableObject {
    static let shared = LicenseOfficeStore()
    @Published var offices: [LicenseOffice] = []
    @Published var error: String?

    private var url: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("license-offices.json")
    }

    init() {
        if let d = try? Data(contentsOf: url), let v = try? JSONDecoder().decode([LicenseOffice].self, from: d) { offices = v }
    }

    /// The list changes a few times a year, so a saved copy younger than a day is kept.
    func load(force: Bool = false) async {
        if !force, !offices.isEmpty, let t = UserDefaults.standard.object(forKey: "licenseOfficesSaved") as? Date,
           Date().timeIntervalSince(t) < 86400 { return }
        do {
            let (d, _) = try await URLSession.shared.data(from: URL(string: "https://data.mo.gov/resource/835g-7keg.json?$limit=1000")!)
            let rows = (try JSONSerialization.jsonObject(with: d) as? [[String: Any]] ?? []).compactMap(LicenseOffice.init)
            guard !rows.isEmpty else { throw CivicError.server("The state's office list was empty.") }
            offices = rows
            error = nil
            if let e = try? JSONEncoder().encode(rows) { try? e.write(to: url) }
            UserDefaults.standard.set(Date(), forKey: "licenseOfficesSaved")
        } catch {
            if offices.isEmpty { self.error = error.localizedDescription }
        }
    }
}

struct LicenseOfficesView: View {
    @StateObject private var store = LicenseOfficeStore.shared
    @State private var here: CLLocationCoordinate2D?
    @State private var web: URL?

    private var sorted: [(LicenseOffice, Double)] {
        let c = here ?? Locator.downtown
        let me = CLLocation(latitude: c.latitude, longitude: c.longitude)
        return store.offices.map { ($0, me.distance(from: CLLocation(latitude: $0.lat, longitude: $0.lon))) }.sorted { $0.1 < $1.1 }
    }

    var body: some View {
        List {
            Section {
                Button { web = URL(string: "https://mydmv.mo.gov") } label: {
                    linkRow("MyDMV: renew a license, schedule a driving test", icon: "badge")
                }
                Button { web = URL(string: "https://dor.mo.gov/motor-vehicle/plates/") } label: {
                    linkRow("Renew plates online", icon: "directions_car")
                }
            } footer: {
                Text("Missouri license offices are walk-in and take no appointments. Driving tests are booked with the Highway Patrol through MyDMV.")
            }
            Section(here == nil ? "Nearest to downtown" : "Nearest to you") {
                if store.offices.isEmpty {
                    if let e = store.error {
                        StateMessage(icon: "cloud_off", title: "Cannot load the offices", message: e,
                                     action: ("Try again", { Task { await store.load(force: true) } }))
                    } else {
                        HStack { Spacer(); ProgressView(); Spacer() }
                    }
                }
                ForEach(sorted.prefix(25), id: \.0.id) { o, meters in row(o, meters) }
            }
        }
        .wrappingTitle("License offices")
        .refreshable { await store.load(force: true) }
        .task {
            here = await Locator.shared.currentIfAllowed()
            await store.load()
        }
        .sheet(item: $web) { SafariView(url: $0).ignoresSafeArea() }
    }

    private func linkRow(_ title: String, icon: String) -> some View {
        HStack(spacing: 14) {
            Icon(name: icon, size: 22).foregroundStyle(Theme.primary).frame(width: 28)
            Text(title).foregroundStyle(Theme.onSurface)
            Spacer()
            Icon(name: "open_in_new", size: 18).foregroundStyle(Theme.onSurfaceVariant)
        }
    }

    private func row(_ o: LicenseOffice, _ meters: Double) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(o.name).font(.headline).foregroundStyle(Theme.onSurface)
                Spacer()
                Text(NearbyRow.distance(meters)).font(.caption.monospacedDigit()).foregroundStyle(Theme.onSurfaceVariant)
            }
            todayLabel(o.today())
            Text(o.address).font(.caption).foregroundStyle(Theme.onSurfaceVariant)
            Text(o.hours).font(.caption).foregroundStyle(Theme.onSurfaceVariant)
            HStack(spacing: 10) {
                if let tel = URL(string: "tel:" + o.phone.filter(\.isNumber)), !o.phone.isEmpty {
                    Link(destination: tel) { chip("Call", icon: "call") }
                }
                if let maps = URL(string: "http://maps.apple.com/?daddr=\(o.lat),\(o.lon)&q=\(o.name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") {
                    Link(destination: maps) { chip("Directions", icon: "directions") }
                }
            }
            .padding(.top, 2)
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder private func todayLabel(_ t: LicenseOffice.Today) -> some View {
        switch t {
        case .open(let until): status("Open now, until \(until)", icon: "schedule", color: Theme.done)
        case .opensLater(let at): status("Opens today at \(at)", icon: "schedule", color: Theme.open)
        case .closed: status("Closed now", icon: "block", color: Theme.onSurfaceVariant)
        case .closesEarly: status("Closes early today", icon: "warning", color: Theme.open)
        case .unknown: EmptyView()
        }
    }

    private func status(_ text: String, icon: String, color: Color) -> some View {
        Label { Text(text) } icon: { Icon(name: icon, size: 14) }
            .font(.caption.weight(.semibold)).foregroundStyle(color)
    }

    private func chip(_ title: String, icon: String) -> some View {
        HStack(spacing: 4) { Icon(name: icon, size: 16); Text(title).font(.caption.weight(.semibold)) }
            .padding(.horizontal, 10).padding(.vertical, 5)
            .foregroundStyle(Theme.onPrimaryContainer)
            .background(Theme.secondaryContainer, in: Capsule())
    }
}
