import Foundation

/// The city's 41 categories overlap (three for trash, three for water, four
/// for traffic), so the app groups them into plain sections. Each section
/// also holds the city web pages and phone numbers that belong with it.
/// A category the table does not know (the city adds one) lands in "Other".
struct ReportSection: Identifiable, Hashable {
    let id: String
    let title: String
    let icon: String
    let blurb: String
    /// Lowercased fragments of the city's category names.
    let categoryKeys: [String]
    /// Lowercased fragments of the city's web link names.
    let linkKeys: [String]

    static func == (a: ReportSection, b: ReportSection) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }

    static let all: [ReportSection] = [
        ReportSection(id: "trash", title: "Trash & Recycling", icon: "delete",
                      blurb: "Missed pickups, carts, blue bags, bulky items, leaves, dumping",
                      categoryKeys: ["trash", "recycling cart", "solid waste", "leaf and brush", "illegal dumping"],
                      linkKeys: ["bulky", "holiday trash", "recycling cart", "leaf and brush", "snow and trash"]),
        ReportSection(id: "streets", title: "Streets & Sidewalks", icon: "road",
                      blurb: "Potholes, pavement, curbs, sidewalks, sweeping, snow, bridges, graffiti",
                      categoryKeys: ["pothole", "street maintenance", "sidewalks", "street cleaning", "bridge",
                                     "right-of-way", "snow", "graffiti"],
                      linkKeys: ["street preservation", "snowplow", "snow and trash"]),
        ReportSection(id: "traffic", title: "Traffic, Parking & Lights", icon: "traffic",
                      blurb: "Signals, signs, markings, streetlights, speeding, bike lanes, parking, towing",
                      categoryKeys: ["traffic", "streetlight", "vision zero", "bike", "vehicles and parking", "parking meter"],
                      linkKeys: []),
        ReportSection(id: "water", title: "Water & Sewer", icon: "water_drop",
                      blurb: "Leaks, main breaks, pressure, water quality, sewer backups, storm drains",
                      categoryKeys: ["water", "sewer"],
                      linkKeys: ["kc water"]),
        ReportSection(id: "property", title: "Property & Housing", icon: "home",
                      blurb: "Weeds, junk, vacant or open buildings, rentals, short-term rentals, zoning, tents",
                      categoryKeys: ["property violations", "healthy homes", "land bank", "short term rental", "zoning", "tents"],
                      linkKeys: []),
        ReportSection(id: "parks", title: "Parks & Trees", icon: "park",
                      blurb: "Park upkeep, playgrounds, fountains, reservations, trees in the right-of-way",
                      categoryKeys: ["parks", "trees"],
                      linkKeys: []),
        ReportSection(id: "animals", title: "Animals", icon: "pets",
                      blurb: "Strays, bites, cruelty, dead animals, wildlife",
                      categoryKeys: ["animal"],
                      linkKeys: []),
        ReportSection(id: "safety", title: "Health & Safety", icon: "health_and_safety",
                      blurb: "Food safety, health code, police and fire requests, hate incidents",
                      categoryKeys: ["public safety", "health code", "food safety", "hate"],
                      linkKeys: ["health dept", "coronavirus", "police report", "fountain id"]),
        ReportSection(id: "rights", title: "Rights, Labor & Business", icon: "balance",
                      blurb: "Discrimination, wage theft, contractor complaints, business help",
                      categoryKeys: ["discrimination", "contract and labor"],
                      linkKeys: ["bizcare", "language access"]),
    ]

    static let other = ReportSection(id: "other", title: "Other", icon: "more_horiz",
                                     blurb: "Report types the app does not group yet", categoryKeys: [], linkKeys: [])

    func owns(_ c: Category) -> Bool { categoryKeys.contains { c.name.lowercased().contains($0) } }
    func owns(_ l: CityLink) -> Bool { linkKeys.contains { l.name.lowercased().contains($0) } }

    /// Section for a category; the first match wins.
    static func of(_ c: Category) -> ReportSection {
        all.first { $0.owns(c) } ?? other
    }

    static func isUpdateRequest(_ name: String) -> Bool { name.lowercased().contains("request update") }
    /// Every update request this app files opens with these words. The city
    /// stores the request as "Administration or Questions", so its category
    /// alone does not show what it is.
    static let updateRequestText = "Please send an update on"
}

/// One row of the A to Z list: a report type, a city page, or a phone number.
struct DirectoryItem: Identifiable, Hashable {
    enum Kind: Hashable { case report(Category, CatalogRow?), link(CityLink), phone(CityPhone), streetcar }
    let title: String
    let detail: String
    let icon: String
    let kind: Kind
    var id: String { "\(title)|\(detail)" }
}

struct CityPhone: Identifiable, Hashable {
    let name: String
    let number: String
    var text = false
    var id: String { name + number }
    var url: URL { URL(string: (text ? "sms:" : "tel:") + number.filter(\.isNumber))! }
}

/// City phone numbers. 311 and police from kcpolice.org; streetcar from
/// kcstreetcar.org; the rest from the city's own 311 catalog text, where each
/// number appears next to the service it reaches (checked 2026-10-05).
enum CityPhones {
    static let pinned: [CityPhone] = [
        CityPhone(name: "Call 311", number: "816-513-1313"),
        CityPhone(name: "Police non-emergency", number: "816-234-5111"),
        CityPhone(name: "KC Streetcar Authority", number: "816-627-2527"),
        CityPhone(name: "KC Streetcar See Say (text dispatch)", number: "816-837-4800", text: true),
    ]

    static let more: [CityPhone] = [
        CityPhone(name: "Animal bite, after hours", number: "816-788-0725"),
        CityPhone(name: "Barking dogs (KC Pet Project)", number: "816-683-1373"),
        CityPhone(name: "Beekeeper registration", number: "816-513-6048"),
        CityPhone(name: "Civil Rights and Equal Opportunity", number: "816-513-1836"),
        CityPhone(name: "Crosswalk Restoration Program", number: "816-513-9870"),
        CityPhone(name: "Environmental compliance, illicit discharge", number: "816-513-0600"),
        CityPhone(name: "Fire appearances and station tours", number: "816-513-6464"),
        CityPhone(name: "Fire Marshal, smoke detectors", number: "816-513-4648"),
        CityPhone(name: "Food handler cards (Health Department)", number: "816-513-6315"),
        CityPhone(name: "HUD housing discrimination", number: "800-669-9777"),
        CityPhone(name: "Human trafficking hotline", number: "888-373-7888"),
        CityPhone(name: "KC Water, account shut off", number: "816-513-0567"),
        CityPhone(name: "KC Water, lead service line hotline", number: "816-513-0150"),
        CityPhone(name: "KCPD community complaints", number: "816-889-6640"),
        CityPhone(name: "KCPD information", number: "816-234-5000"),
        CityPhone(name: "KCPD records", number: "816-234-5100"),
        CityPhone(name: "KCPD video requests", number: "816-234-5589"),
        CityPhone(name: "MoDOT (highways and ramps)", number: "816-607-2000"),
        CityPhone(name: "Parks facility reservations", number: "816-513-0632"),
        CityPhone(name: "PIAC sidewalk requests", number: "816-513-8828"),
        CityPhone(name: "Regulated industries licenses", number: "816-513-4560"),
        CityPhone(name: "Towed vehicles, reclaim", number: "816-513-0668"),
        CityPhone(name: "Tow lot (7750 E Front St)", number: "816-513-0688"),
        CityPhone(name: "Traffic calming", number: "816-513-9886"),
        CityPhone(name: "Wildlife (Lakeside Nature Center)", number: "816-513-8960"),
    ]
}
