import CoreLocation
import Foundation
import ImageIO

/// Where a report comes from, in words a crew can use: the GPS point, the
/// nearest address, and the nearest intersection.
struct PlaceFacts: Equatable {
    var coordinate: CLLocationCoordinate2D
    var source: String
    var address = ""
    var street = ""
    var crossStreet = ""
    var intersection = ""

    static func == (a: PlaceFacts, b: PlaceFacts) -> Bool {
        a.coordinate.latitude == b.coordinate.latitude && a.coordinate.longitude == b.coordinate.longitude
            && a.address == b.address && a.intersection == b.intersection
    }

    var summary: String {
        var parts = [String(format: "GPS %.6f, %.6f (%@)", coordinate.latitude, coordinate.longitude, source)]
        if !address.isEmpty { parts.append("nearest address \(address)") }
        if !intersection.isEmpty { parts.append("nearest intersection \(intersection)") }
        return parts.joined(separator: "; ")
    }

    var line: String { "Location: \(summary)." }

    /// The answer for a free-text question that asks where, or nil.
    func answer(for caption: String) -> String? {
        let c = caption.trimmingCharacters(in: .whitespaces).lowercased()
        if c == "street" { return street.isEmpty ? nil : street }
        if c == "intersecting street" || c == "cross street" { return crossStreet.isEmpty ? nil : crossStreet }
        let wherePattern = #"locat|intersection|where is|street ?/ ?location|address or intersection|specific address|area of (traffic )?concern|where .*needed"#
        let notPattern = #"e-?mail|employer|current address|your name|rental|business|company|manager|how many|property issues|when|visit|assisted|county|verify"#
        guard caption.range(of: wherePattern, options: [.regularExpression, .caseInsensitive]) != nil,
              caption.range(of: notPattern, options: [.regularExpression, .caseInsensitive]) == nil else { return nil }
        return summary
    }
}

enum Place {
    /// GPS from a photo's EXIF block, if the photo has one.
    static func gps(in data: Data) -> CLLocationCoordinate2D? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let g = props[kCGImagePropertyGPSDictionary] as? [CFString: Any],
              var lat = g[kCGImagePropertyGPSLatitude] as? Double,
              var lon = g[kCGImagePropertyGPSLongitude] as? Double else { return nil }
        if (g[kCGImagePropertyGPSLatitudeRef] as? String) == "S" { lat = -lat }
        if (g[kCGImagePropertyGPSLongitudeRef] as? String) == "W" { lon = -lon }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    static func facts(_ c: CLLocationCoordinate2D, source: String) async -> PlaceFacts {
        var f = PlaceFacts(coordinate: c, source: source)
        async let picked = Locator.address(for: c)
        async let cross = intersection(c)
        let p = await picked
        if !p.street.contains(",") {
            f.address = "\(p.street), \(p.city), \(p.state) \(p.zip)".trimmingCharacters(in: .whitespaces)
            f.street = p.street.replacingOccurrences(of: #"^\d+[A-Z]?\s+"#, with: "", options: .regularExpression)
        }
        if let (names, meters) = await cross {
            f.intersection = "\(names.joined(separator: " & ")) (about \(Int(meters.rounded())) m away)"
            f.crossStreet = names.first { core($0) != core(f.street) } ?? ""
        }
        return f
    }

    private static func core(_ s: String) -> String {
        s.replacingOccurrences(of: #"^[NSEW] "#, with: "", options: .regularExpression)
    }

    private static func ordinal(_ name: String) -> String {
        let re = try! NSRegularExpression(pattern: #"\b(\d+) (St|Ter|Pl|Ave|Rd|Ct|Dr|Ln|Cir)\b"#)
        var out = name
        for m in re.matches(in: name, range: NSRange(name.startIndex..., in: name)).reversed() {
            guard let nr = Range(m.range(at: 1), in: name), let tr = Range(m.range(at: 2), in: name),
                  let whole = Range(m.range, in: out), let n = Int(name[nr]) else { continue }
            let suf = (10...20).contains(n % 100) ? "th" : [1: "st", 2: "nd", 3: "rd"][n % 10] ?? "th"
            out.replaceSubrange(whole, with: "\(n)\(suf) \(name[tr])")
        }
        return out
    }

    /// Nearest vertex shared by two different roads, from US Census TIGER.
    static func intersection(_ c: CLLocationCoordinate2D, radius: Int = 150) async -> ([String], Double)? {
        var comps = URLComponents(string: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/8/query")!
        comps.queryItems = [
            .init(name: "geometry", value: "\(c.longitude),\(c.latitude)"), .init(name: "geometryType", value: "esriGeometryPoint"),
            .init(name: "inSR", value: "4326"), .init(name: "spatialRel", value: "esriSpatialRelIntersects"),
            .init(name: "distance", value: "\(radius)"), .init(name: "units", value: "esriSRUnit_Meter"),
            .init(name: "outFields", value: "NAME"), .init(name: "returnGeometry", value: "true"),
            .init(name: "outSR", value: "4326"), .init(name: "f", value: "json"),
        ]
        guard let (data, _) = try? await URLSession.shared.data(from: comps.url!),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let feats = obj["features"] as? [[String: Any]] else { return nil }
        var namesAt: [String: (Double, Double, Set<String>)] = [:]
        for f in feats {
            guard let name = (f["attributes"] as? [String: Any])?["NAME"] as? String, !name.isEmpty,
                  let paths = (f["geometry"] as? [String: Any])?["paths"] as? [[[Double]]] else { continue }
            let clean = ordinal(name).uspsAbbreviated
            for pt in paths.joined() where pt.count >= 2 {
                let key = String(format: "%.6f,%.6f", pt[0], pt[1])
                var e = namesAt[key] ?? (pt[1], pt[0], [])
                e.2.insert(clean)
                namesAt[key] = e
            }
        }
        var best: ([String], Double)?
        let here = CLLocation(latitude: c.latitude, longitude: c.longitude)
        for (lat, lon, names) in namesAt.values {
            var byCore: [String: String] = [:]
            for n in names.sorted() { byCore[core(n)] = n }
            guard byCore.count >= 2 else { continue }
            let d = here.distance(from: CLLocation(latitude: lat, longitude: lon))
            if best == nil || d < best!.1 { best = (Array(byCore.values.sorted().prefix(2)), d) }
        }
        return best
    }
}
