import CoreLocation
import SwiftUI

/// RideKC buses and the streetcar: the stops nearest you and their next
/// scheduled departures, from KCATA's static GTFS feed (free to use; about
/// 1.9 MB, saved for a week). Live arrivals need a Swiftly API key, which
/// the app does not have yet, so times are the schedule.
struct Departure: Identifiable, Hashable {
    let id = UUID()
    let route: String
    let headsign: String
    let seconds: Int
}

struct NearStop: Identifiable {
    let id: String
    let name: String
    let lat: Double
    let lon: Double
    var meters: Double
    var departures: [Departure]
}

enum GTFS {
    static let feed = URL(string: "https://ridekc.org/static-gtfs")!
    static var file: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("ridekc-gtfs.zip")
    }

    static func zip() async throws -> Data {
        if let attrs = try? FileManager.default.attributesOfItem(atPath: file.path), let m = attrs[.modificationDate] as? Date,
           Date().timeIntervalSince(m) < 7 * 86400, let d = try? Data(contentsOf: file) { return d }
        let (d, _) = try await URLSession.shared.data(from: feed)
        try? d.write(to: file)
        return d
    }

    /// CSV rows as dictionaries. Handles quoted fields with commas.
    static func rows(_ data: Data, keep: (([String: String]) -> Bool)? = nil) -> [[String: String]] {
        let text = String(decoding: data, as: UTF8.self)
        var lines = text.split(whereSeparator: \.isNewline).makeIterator()
        guard let head = lines.next() else { return [] }
        let keys = fields(String(head)).map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "\u{FEFF} ")) }
        var out: [[String: String]] = []
        while let line = lines.next() {
            let v = fields(String(line))
            var r: [String: String] = [:]
            for (i, k) in keys.enumerated() where i < v.count { r[k] = v[i].trimmingCharacters(in: .whitespaces) }
            if keep?(r) ?? true { out.append(r) }
        }
        return out
    }

    private static func fields(_ line: String) -> [String] {
        guard line.contains("\"") else { return line.components(separatedBy: ",") }
        var out: [String] = [], cur = "", quoted = false
        for ch in line {
            if ch == "\"" { quoted.toggle() } else if ch == "," && !quoted { out.append(cur); cur = "" } else { cur.append(ch) }
        }
        out.append(cur)
        return out
    }

    /// The nearest stops (up to 6 within 800 m) and their departures in the next two hours.
    static func nearby(_ c: CLLocationCoordinate2D, now: Date = Date()) async throws -> [NearStop] {
        let z = try await zip()
        return try await Task.detached(priority: .userInitiated) {
            let files = Dictionary(try Zip.entries(in: z, suffix: ".txt"), uniquingKeysWith: { a, _ in a })
            func file(_ n: String) -> Data { files[n] ?? Data() }
            let me = CLLocation(latitude: c.latitude, longitude: c.longitude)
            var stops = rows(file("stops.txt")).compactMap { r -> NearStop? in
                guard let la = Double(r["stop_lat"] ?? ""), let lo = Double(r["stop_lon"] ?? ""), let id = r["stop_id"] else { return nil }
                return NearStop(id: id, name: r["stop_name"] ?? id, lat: la, lon: lo,
                                meters: me.distance(from: CLLocation(latitude: la, longitude: lo)), departures: [])
            }
            stops = Array(stops.filter { $0.meters < 800 }.sorted { $0.meters < $1.meters }.prefix(6))
            guard !stops.isEmpty else { return [] }
            let want = Set(stops.map(\.id))

            // Services running today.
            let cal = Calendar.current
            let day = cal.dateComponents([.year, .month, .day, .weekday], from: now)
            let ymd = String(format: "%04d%02d%02d", day.year!, day.month!, day.day!)
            let weekday = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][day.weekday! - 1]
            var services = Set(rows(file("calendar.txt")).filter {
                $0[weekday] == "1" && ($0["start_date"] ?? "") <= ymd && ymd <= ($0["end_date"] ?? "")
            }.compactMap { $0["service_id"] })
            for r in rows(file("calendar_dates.txt")) where r["date"] == ymd {
                guard let s = r["service_id"] else { continue }
                if r["exception_type"] == "1" { services.insert(s) } else if r["exception_type"] == "2" { services.remove(s) }
            }
            let routes = Dictionary(rows(file("routes.txt")).compactMap { r in
                r["route_id"].map { ($0, (r["route_short_name"]?.isEmpty == false ? r["route_short_name"]! : r["route_long_name"] ?? $0)) }
            }, uniquingKeysWith: { a, _ in a })
            var trips: [String: (String, String)] = [:]
            for r in rows(file("trips.txt")) where services.contains(r["service_id"] ?? "") {
                if let t = r["trip_id"] { trips[t] = (routes[r["route_id"] ?? ""] ?? "", r["trip_headsign"] ?? "") }
            }
            let nowSec = (cal.component(.hour, from: now) * 3600) + (cal.component(.minute, from: now) * 60)
            var byStop: [String: [Departure]] = [:]
            for r in rows(file("stop_times.txt"), keep: { want.contains($0["stop_id"] ?? "") }) {
                guard let stop = r["stop_id"], let t = trips[r["trip_id"] ?? ""] else { continue }
                let parts = (r["departure_time"] ?? "").split(separator: ":").compactMap { Int($0) }
                guard parts.count == 3 else { continue }
                let sec = parts[0] * 3600 + parts[1] * 60 + parts[2]
                guard sec >= nowSec, sec <= nowSec + 7200 else { continue }
                byStop[stop, default: []].append(Departure(route: t.0, headsign: t.1, seconds: sec))
            }
            return stops.map { s in
                var s = s
                s.departures = Array((byStop[s.id] ?? []).sorted { $0.seconds < $1.seconds }.prefix(5))
                return s
            }
        }.value
    }
}

struct TransitView: View {
    @State private var stops: [NearStop]?
    @State private var error: String?
    @State private var web: URL?

    var body: some View {
        List {
            Section {
                Text("RideKC buses and the KC Streetcar near you. Times are the published schedule, not live arrivals.")
                    .font(.subheadline).foregroundStyle(Theme.onSurfaceVariant)
                Button { web = URL(string: "https://ridekc.org") } label: {
                    HStack { Text("RideKC trip planner and alerts").foregroundStyle(Theme.primary); Spacer(); Icon(name: "open_in_new", size: 18).foregroundStyle(Theme.onSurfaceVariant) }
                }
            }
            if let error {
                Text("Could not load the schedule: \(error)").font(.caption).foregroundStyle(Theme.error)
            } else if let stops {
                if stops.isEmpty { Text("No stops within half a mile.").foregroundStyle(Theme.onSurfaceVariant) }
                ForEach(stops) { s in
                    Section {
                        if s.departures.isEmpty {
                            Text("No departures in the next two hours.").font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                        }
                        ForEach(s.departures) { d in
                            HStack {
                                Text(d.route).font(.subheadline.weight(.bold)).monospacedDigit()
                                    .padding(.horizontal, 8).padding(.vertical, 2)
                                    .foregroundStyle(Theme.onPrimaryContainer).background(Theme.primaryContainer, in: Capsule())
                                Text(d.headsign).font(.subheadline).lineLimit(2)
                                Spacer()
                                Text(Self.clock(d.seconds)).font(.subheadline.monospacedDigit()).foregroundStyle(Theme.onSurfaceVariant)
                            }
                        }
                    } header: {
                        HStack { Text(s.name); Spacer(); Text(NearbyRow.distance(s.meters)).monospacedDigit() }
                    }
                }
            } else {
                HStack { Spacer(); ProgressView(); Spacer() }
            }
        }
        .wrappingTitle("Buses and streetcar")
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $web) { SafariView(url: $0).ignoresSafeArea() }
    }

    private func load() async {
        let c = await Locator.shared.currentIfAllowed() ?? Locator.downtown
        // `-transitHour H` checks the schedule as if it were H:00 today (screenshots).
        var now = Date()
        if let hs = UserDefaults.standard.string(forKey: "transitHour"), let h = Int(hs) {
            now = Calendar.current.date(bySettingHour: h, minute: 0, second: 0, of: now) ?? now
        }
        do { stops = try await GTFS.nearby(c, now: now); error = nil } catch { if stops == nil { self.error = error.localizedDescription } }
    }

    static func clock(_ s: Int) -> String {
        let h = (s / 3600) % 24, m = (s % 3600) / 60
        return String(format: "%d:%02d %@", h % 12 == 0 ? 12 : h % 12, m, h < 12 ? "AM" : "PM")
    }
}
