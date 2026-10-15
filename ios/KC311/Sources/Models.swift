import Foundation

/// The JSON from this API mixes numbers and strings for the same field, so
/// models are read by hand from dictionaries with these helpers.
extension Dictionary where Key == String, Value == Any {
    func str(_ key: String) -> String {
        switch self[key] {
        case let s as String: s
        case let n as NSNumber: n.stringValue
        default: ""
        }
    }

    func dbl(_ key: String) -> Double? { Double(str(key)) }

    func date(_ key: String) -> Date? {
        guard let t = Double(str(key)), t > 0 else { return nil }
        return Date(timeIntervalSince1970: t)
    }
}

struct Question: Identifiable, Hashable {
    enum Kind: Int { case yesNo = 1, monthYear = 2, text = 3, choice = 4, dateTime = 5, date = 6, time = 7 }
    struct Option: Hashable { let id: String; let value: String }

    let caption: String
    let kind: Kind
    let placeholder: String
    let required: Bool
    let multiple: Bool
    let options: [Option]
    let sortOrder: Int
    var id: String { caption }

    init?(_ d: [String: Any]) {
        guard let kind = Kind(rawValue: Int(d.str("type")) ?? 0) else { return nil }
        caption = d.str("caption")
        self.kind = kind
        placeholder = d.str("placeholder")
        required = ["yes", "1"].contains(d.str("IS_INPUT_REQUIRED").lowercased())
        multiple = d.str("allow_multiple_select") == "yes"
        options = (d["dropdown_options"] as? [[String: Any]] ?? []).map { Option(id: $0.str("id"), value: $0.str("value")) }
        sortOrder = Int(d.str("sort_order")) ?? 0
    }

    static func parse(_ raw: String) -> [Question] {
        guard !raw.isEmpty, let data = raw.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return arr.compactMap(Question.init).sorted { $0.sortOrder < $1.sortOrder }
    }
}

/// A report category or sub-category row from get_main. Both carry the same
/// flags; a sub-category value wins over its category's, as in the app.
struct CatalogRow: Identifiable, Hashable {
    let raw: [String: Any]
    var id: String { raw.str("subcat_id").isEmpty ? raw.str("cat_id") : raw.str("subcat_id") }
    var name: String { raw.str("name") }
    /// The city strips commas from some names ("Trash  Recycling  Bulky
    /// Services"); show the double space as a comma. `name` stays raw for the API.
    var displayName: String { name.cleanedCityName }
    var type: String { raw.str("type") }
    func flag(_ key: String) -> String { raw.str(key) }

    static func == (a: CatalogRow, b: CatalogRow) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }
}

struct Category: Identifiable, Hashable {
    let row: CatalogRow
    let subs: [CatalogRow]
    var id: String { row.raw.str("cat_id") }
    var name: String { row.name }
    var displayName: String { row.displayName }

    func value(_ key: String, sub: CatalogRow?) -> String {
        let s = sub?.flag(key) ?? ""
        return s.isEmpty ? row.flag(key) : s
    }

    func questions(sub: CatalogRow?) -> [Question] {
        if let sub, !sub.flag("form_data").isEmpty, !sub.type.isEmpty { return Question.parse(sub.flag("form_data")) }
        return Question.parse(row.flag("form_data"))
    }

    func effectiveType(sub: CatalogRow?) -> String {
        if let sub, !sub.type.isEmpty { return sub.type }
        return row.type.isEmpty ? "Standard" : row.type
    }

    /// A Material Symbols name picked from the category's words.
    var icon: String { Category.icon(for: name) }

    static func icon(for name: String) -> String {
        let n = name.lowercased()
        let table: [(String, String)] = [
            ("pothole", "road"), ("street light", "lightbulb"), ("streetlight", "lightbulb"), ("traffic", "traffic"),
            ("sign", "signpost"), ("trash", "delete"), ("recycl", "recycling"), ("dump", "delete_sweep"),
            ("bulky", "chair"), ("animal", "pets"), ("tree", "park"), ("park", "park"), ("water", "water_drop"),
            ("sewer", "plumbing"), ("storm", "flood"), ("snow", "ac_unit"), ("graffiti", "format_paint"),
            ("sidewalk", "directions_walk"), ("bike", "pedal_bike"), ("bridge", "architecture"), ("vehicle", "directions_car"),
            ("car", "directions_car"), ("parking", "local_parking"), ("noise", "volume_up"), ("weed", "grass"),
            ("grass", "grass"), ("property", "home"), ("house", "home"), ("building", "apartment"),
            ("tent", "camping"), ("sleep", "camping"), ("discrimination", "balance"), ("curb", "road"),
            ("alley", "road"), ("bus", "directions_bus"), ("health", "health_and_safety"), ("rodent", "pest_control"),
            ("mosquito", "pest_control"), ("light", "lightbulb"), ("update", "update"), ("street", "road"),
        ]
        return table.first { n.contains($0.0) }?.1 ?? "report"
    }
}

struct CityLink: Identifiable, Hashable {
    let name: String
    let url: URL
    var id: String { name }

    var icon: String {
        let n = name.lowercased()
        let table: [(String, String)] = [
            ("court", "gavel"), ("calendar", "calendar_month"), ("water", "water_drop"), ("health", "health_and_safety"),
            ("vaccine", "vaccines"), ("official", "groups"), ("hear", "campaign"), ("pay", "payments"),
            ("biz", "storefront"), ("snow", "ac_unit"), ("trash", "delete"), ("kudos", "thumb_up"),
            ("street", "road"), ("job", "work"), ("bulky", "chair"), ("leaf", "eco"), ("recycl", "recycling"),
            ("parade", "celebration"), ("fountain", "badge"), ("police", "local_police"), ("speak", "forum"),
            ("plow", "map"), ("ask", "support_agent"), ("sunshine", "description"), ("language", "translate"),
            ("compass", "explore"),
        ]
        return table.first { n.contains($0.0) }?.1 ?? "open_in_new"
    }
}

/// The city's 311 case number. It exists only after the report syncs to
/// the city's CRM; before that, display_wo holds MyCivic's own id, so read
/// thirdparty_params.case_number and never fall back to display_wo.
func cityCaseNumber(_ d: [String: Any]) -> String {
    var tp = d["thirdparty_params"]
    if let s = tp as? String, let data = s.data(using: .utf8) { tp = try? JSONSerialization.jsonObject(with: data) }
    return (tp as? [String: Any])?.str("case_number") ?? ""
}

/// One row of "my reports" (myissues). Here `category` holds the form type,
/// so the category name comes from `name` / `issue_type`.
struct MyReport: Identifiable, Hashable {
    let id: String
    let caseNumber: String
    let category: String
    let subcategory: String
    let status: String
    let description: String
    let address: String
    let added: Date?
    let updated: Date?
    let unread: Int
    /// Where the report was pinned, for the Reports map.
    let lat: Double?
    let lon: Double?
    /// Latest movement: updated_on (UTC), last_action_date, or added_on.
    let lastMovement: Date?

    init(_ d: [String: Any]) {
        id = d.str("id")
        caseNumber = cityCaseNumber(d)
        category = (d.str("name").isEmpty ? d.str("issue_type") : d.str("name")).cleanedCityName
        subcategory = (d.str("subcategory").isEmpty ? d.str("sub_type") : d.str("subcategory")).cleanedCityName
        status = d.str("status")
        description = d.str("description")
        address = d.str("address")
        updated = nil
        unread = Int(d.str("new_update_count")) ?? 0
        lat = Double(d.str("latitude"))
        lon = Double(d.str("longitude"))
        let utc = DateFormatter()
        utc.locale = Locale(identifier: "en_US_POSIX")
        utc.timeZone = TimeZone(identifier: "UTC")
        utc.dateFormat = "yyyy-MM-dd HH:mm:ss"
        let day = DateFormatter()
        day.locale = utc.locale
        day.timeZone = utc.timeZone
        day.dateFormat = "MM/dd/yyyy"
        // myissues' epoch fields run hours ahead of the real time (added_on
        // +2 h, updated_timestamp +5 h on 2026-10-05); updated_on, a UTC
        // string, is right. Filing time = the earlier of the two, never later
        // than now.
        let now = Date()
        let updatedOn = utc.date(from: d.str("updated_on"))
        added = [d.date("added_on"), updatedOn].compactMap { $0 }.min().map { min($0, now) }
        lastMovement = [added, updatedOn, day.date(from: d.str("last_action_date"))]
            .compactMap { $0 }.max().map { min($0, now) }
    }

    /// A filed "311 Request Update" is itself a report in this list.
    var isUpdateRequest: Bool {
        ReportSection.isUpdateRequest(category)
            || description.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix(ReportSection.updateRequestText)
    }
    var isOpen: Bool { StatusStage(status) != .done }

}

struct TimelineEntry: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let details: String
    let when: String
    /// For sorting entries from more than one case.
    var at: Date? = nil
}

/// Detail of one report. Reporter contact fields are never read: the city's
/// API returns them for other people's reports too.
struct ReportDetail {
    let caseNumber: String
    let status: String
    let type: String
    let subtype: String
    let address: String
    let description: String
    let photos: [URL]
    /// When the report was filed. This endpoint's epoch is the real time.
    let added: Date?
    var timeline: [TimelineEntry]

    init(_ d: [String: Any]) {
        caseNumber = cityCaseNumber(d)
        status = d.str("status")
        type = d.str("type").cleanedCityName
        subtype = d.str("subtype").cleanedCityName
        address = d.str("address")
        description = d.str("description")
        photos = (d["issue_image"] as? [String] ?? []).compactMap(URL.init(string:))
        added = d.date("added_on")
        let hist = (d["history_object"] as? [[String: Any]] ?? []).sorted { ($0.dbl("timestamp") ?? 0) < ($1.dbl("timestamp") ?? 0) }
        timeline = hist.map {
            TimelineEntry(title: $0.str("title"), details: $0.str("details").strippingHTML, when: $0.str("dateofupdate"), at: $0.date("timestamp"))
        }
    }
}

/// A public report on the map.
struct MapIssue: Identifiable, Hashable, Codable {
    let id: String
    let type: String
    let subtype: String
    let status: String
    let address: String
    let lat: Double
    let lon: Double
    let submitted: Date?
    // Optional so pins saved by an older build still decode.
    var details: String?
    var caseNumberValue: String?
    var updated: Date?

    enum CodingKeys: String, CodingKey {
        case id, type, subtype, status, address, lat, lon, submitted, details, updated
        case caseNumberValue = "caseNumber"
    }

    init?(_ d: [String: Any]) {
        guard let lat = d.dbl("issue_latitude"), let lon = d.dbl("issue_longitude") else { return nil }
        id = d.str("report_id")
        type = d.str("issue_name").cleanedCityName
        subtype = d.str("subtype").cleanedCityName
        status = d.str("issue_status")
        address = d.str("issue_address")
        self.lat = lat
        self.lon = lon
        submitted = d.date("issue_submitted_date")
        details = d.str("issue_description").strippingHTML
        caseNumberValue = cityCaseNumber(d)
        updated = d.date("issue_lastupdated_date")
    }
}

/// MyCivic statuses: "new" when filed, "received" once staff take it,
/// "assigned" or "referred" while a crew has it, then "resolved" or
/// "canceled".
enum StatusStage: Int, CaseIterable {
    case sent, received, working, done

    init(_ status: String) {
        let s = status.lowercased()
        if ["resolved", "closed", "canceled", "cancelled", "completed"].contains(where: s.contains) {
            self = .done
        } else if ["assigned", "referred", "active", "progress", "scheduled"].contains(where: s.contains) {
            self = .working
        } else if s.contains("received") {
            self = .received
        } else {
            self = .sent
        }
    }

    /// Departments that work a report inside MyCivic (Sidewalks and Curbs,
    /// for one) record site visits and referrals as staff notes and leave
    /// the status at "received". A staff note on an open report counts as
    /// work in progress.
    init(_ status: String, timeline: [TimelineEntry]) {
        let s = StatusStage(status)
        self = s.rawValue < StatusStage.working.rawValue
            && timeline.contains { $0.title.localizedCaseInsensitiveContains("staff") } ? .working : s
    }

    var label: String {
        switch self { case .sent: "Sent"; case .received: "Received"; case .working: "In progress"; case .done: "Done" }
    }
}

extension String {
    var cleanedCityName: String {
        replacingOccurrences(of: #"\s{2,}"#, with: ", ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    var strippingHTML: String {
        replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
