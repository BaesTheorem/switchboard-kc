import CoreLocation
import SwiftUI
import UIKit

struct PickedLocation: Equatable {
    var coordinate: CLLocationCoordinate2D
    var street: String
    var city = "Kansas City"
    var state = "MO"
    var zip = ""

    static func == (a: PickedLocation, b: PickedLocation) -> Bool {
        a.coordinate.latitude == b.coordinate.latitude && a.coordinate.longitude == b.coordinate.longitude && a.street == b.street
    }
}

/// One report as the user builds it. `payload` turns it into the
/// `issue_details` JSON and photo ZIP the official app sends.
@MainActor
final class ReportDraft: ObservableObject {
    @Published var photos: [UIImage] = []
    @Published var category: Category?
    @Published var sub: CatalogRow?
    @Published var answers: [String: String] = [:]
    @Published var choiceAnswers: [String: Set<String>] = [:]
    @Published var notes = ""
    @Published var location: PickedLocation?
    @Published var anonymous = false
    /// "public" puts the report on the city's public map. On by default; the
    /// city's own default (and the official app's) is "private".
    @Published var share = "public"
    /// How the location was set: "phone GPS", "photo GPS", or "pin placed by hand".
    @Published var locationSource = "phone GPS"
    @Published var place: PlaceFacts?
    private var autoAnswers: [String: String] = [:]

    /// Adds a photo. A library photo with EXIF GPS sets the location, unless
    /// the pin was placed by hand.
    func addPhoto(_ img: UIImage, data: Data?) async {
        photos.append(img)
        guard let data, let c = Place.gps(in: data), locationSource != "pin placed by hand" else { return }
        locationSource = "photo GPS"
        location = await Locator.address(for: c)
    }

    /// Looks up the address and intersection for the current location, then
    /// writes them into the description and into questions that ask where.
    /// Only text this method wrote before is replaced; typed text stays.
    func refreshPlace() async {
        guard let loc = location else { return }
        let facts = await Place.facts(loc.coordinate, source: locationSource)
        guard location == loc else { return }
        place = facts
        var kept = notes.components(separatedBy: "\n").filter { !$0.hasPrefix("Location: GPS") }
        while kept.last?.trimmingCharacters(in: .whitespaces).isEmpty == true { kept.removeLast() }
        notes = (kept + (kept.isEmpty ? [] : [""]) + [facts.line]).joined(separator: "\n")
        for q in questions where q.kind == .text {
            guard let fill = facts.answer(for: q.caption) else { continue }
            let now = answers[q.caption] ?? ""
            if now.isEmpty || now == autoAnswers[q.caption] {
                answers[q.caption] = fill
                autoAnswers[q.caption] = fill
            }
        }
    }

    var questions: [Question] { category?.questions(sub: sub) ?? [] }

    var locationRequired: Bool { category?.value("location_required", sub: sub) == "yes" }
    var descriptionRequired: Bool { category?.value("description_required", sub: sub) == "yes" }

    var disclaimer: String? {
        guard let c = category, c.value("enable_disclaimer", sub: sub) == "yes" else { return nil }
        let t = c.value("disclaimer_text", sub: sub).strippingHTML
        return t.isEmpty ? nil : t
    }

    var autoresponse: String? {
        let t = category?.value("autoresponse_text", sub: sub).strippingHTML ?? ""
        return t.isEmpty ? nil : t
    }

    func answer(_ q: Question) -> String {
        switch q.kind {
        case .choice:
            let picked = choiceAnswers[q.caption] ?? []
            return q.options.filter { picked.contains($0.id) }.map(\.id).joined(separator: ",")
        case .yesNo:
            return answers[q.caption] == "YES" ? "YES" : "NO"
        default:
            return answers[q.caption] ?? ""
        }
    }

    /// The first thing still missing, or nil when the draft can be sent.
    var missing: String? {
        if category == nil { return "Pick what is wrong." }
        if let c = category, !c.subs.isEmpty, sub == nil { return "Pick a type." }
        for q in questions where q.required && q.kind != .yesNo && answer(q).isEmpty { return "Answer \"\(q.caption)\"." }
        if locationRequired && location == nil { return "Set the location." }
        if descriptionRequired && notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Add a description." }
        return nil
    }

    func reset() {
        photos = []; category = nil; sub = nil; answers = [:]; choiceAnswers = [:]
        notes = ""; location = nil; share = "public"; locationSource = "phone GPS"; place = nil; autoAnswers = [:]
    }

    func payload(deviceUID: String, contact: Contact?) throws -> ([String: Any], Data?) {
        guard let cat = category else { throw CivicError.server("Pick what is wrong first.") }
        let city = CivicConfig.current?.city_id ?? KeyRefresher.kansasCity
        let now = Int(Date().timeIntervalSince1970 * 1000)
        var entries: [(String, Data)] = []
        var meta: [[String: Any]] = []
        let stamp = DateFormatter()
        stamp.dateFormat = "yyyy-MM-dd HH:mm:ss"
        for (i, img) in photos.enumerated() {
            guard let jpeg = img.scaled(maxSide: 1000).jpegData(compressionQuality: 0.85) else { continue }
            let name = "CAM\(now + i).jpeg"
            entries.append((name, jpeg))
            meta.append(["filename": name, "metadata": ["creation_date": stamp.string(from: Date())]])
        }
        let type = cat.effectiveType(sub: sub)
        var issue: [String: Any] = [
            "city_id": city, "menu_id": Store.menuReport, "timestamp": "\(now)",
            "deviceuid": deviceUID, "device_id": deviceUID,
            "type": type, "type_id": cat.id, "name": cat.name, "issue_cat_id": cat.row.flag("server_id"),
            "subtype": sub?.name ?? "",
            "SELECTED_SUB_TYPE": sub.map { [Self.selected($0)] } ?? [],
            "notes": notes, "share_options": share, "files_metadata": meta,
            "RAI_LAT": location.map { $0.coordinate.latitude as Any } ?? "",
            "RAI_LONG": location.map { $0.coordinate.longitude as Any } ?? "",
            "api_version": CivicClient.apiVersion,
            "offline_timestamp": now,
        ]
        if let c = contact, !c.isEmpty {
            for (k, v) in [("first_name", c.firstName), ("last_name", c.lastName), ("email", c.email), ("phone", c.phone)]
            where !v.isEmpty { issue[k] = v }
        }
        if let l = location {
            issue["location"] = l.street; issue["address"] = l.street; issue["RAI_STREET"] = l.street
            issue["RAI_CITY"] = l.city; issue["RAI_STATE"] = l.state; issue["RAI_ZIP"] = l.zip
        }
        if ["form_type", "form_type_car"].contains(type.lowercased()), !questions.isEmpty {
            var form: [String: String] = [:]
            var list: [[String: Any]] = []
            for q in questions {
                let a = answer(q)
                form[q.caption] = a
                list.append(["caption": q.caption, "type": q.kind.rawValue, "sort_order": q.sortOrder, "enterdValue": a])
            }
            issue["form_data"] = form
            issue["new_form_data"] = list
        }
        return (issue, entries.isEmpty ? nil : Zip.store(entries))
    }

    private static func selected(_ s: CatalogRow) -> [String: Any] {
        let keys = ["category_id", "name", "cat_order", "type", "menu_id", "server_id", "autoresponse_text",
                    "login_required", "disclaimer_phone", "disclaimer_text", "disclaimer_title", "disclaimer_url",
                    "enable_disclaimer", "form_data", "contact_info_required", "thirdparty_type", "thirdparty_id"]
        var o: [String: Any] = [:]
        for k in keys { o[k] = s.flag(k) }
        o["Id"] = s.id; o["subCat_id"] = s.id
        for k in ["image", "share_options", "sort_order", "disclosure"] { o[k] = "" }
        return o
    }
}

extension UIImage {
    func scaled(maxSide: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxSide else { return self }
        let f = maxSide / longest
        let target = CGSize(width: (size.width * f).rounded(), height: (size.height * f).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
    }
}

/// A minimal ZIP writer (stored entries, no compression). JPEGs do not
/// compress further, and this avoids a third-party dependency.
enum Zip {
    private static let table: [UInt32] = (0..<256).map { i -> UInt32 in
        var c = UInt32(i)
        for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    static func crc32(_ data: Data) -> UInt32 {
        var c: UInt32 = 0xFFFF_FFFF
        for b in data { c = table[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        return c ^ 0xFFFF_FFFF
    }

    static func store(_ entries: [(String, Data)]) -> Data {
        var out = Data()
        var central = Data()
        func le16(_ v: Int, _ d: inout Data) { var x = UInt16(v).littleEndian; d.append(Data(bytes: &x, count: 2)) }
        func le32(_ v: UInt32, _ d: inout Data) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 4)) }
        for (name, data) in entries {
            let offset = UInt32(out.count)
            let crc = crc32(data)
            let n = Data(name.utf8)
            le32(0x0403_4B50, &out); le16(20, &out); le16(0, &out); le16(0, &out); le16(0, &out); le16(0x21, &out)
            le32(crc, &out); le32(UInt32(data.count), &out); le32(UInt32(data.count), &out)
            le16(n.count, &out); le16(0, &out); out.append(n); out.append(data)
            le32(0x0201_4B50, &central); le16(20, &central); le16(20, &central); le16(0, &central); le16(0, &central)
            le16(0, &central); le16(0x21, &central); le32(crc, &central); le32(UInt32(data.count), &central)
            le32(UInt32(data.count), &central); le16(n.count, &central); le16(0, &central); le16(0, &central)
            le16(0, &central); le16(0, &central); le32(0, &central); le32(offset, &central); central.append(n)
        }
        let cdOffset = UInt32(out.count)
        out.append(central)
        le32(0x0605_4B50, &out); le16(0, &out); le16(0, &out); le16(entries.count, &out); le16(entries.count, &out)
        le32(UInt32(central.count), &out); le32(cdOffset, &out); le16(0, &out)
        return out
    }
}
