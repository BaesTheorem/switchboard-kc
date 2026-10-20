import SwiftUI

/// Health and help: crisis lines first, then one card per top cause area in
/// Kansas City Effective Altruism's cause prioritization, each with the
/// intervention a resident can use and who delivers it here. Every number
/// and link was checked against the provider's own page on 2026-10-06.
struct HelpResource: Identifiable {
    let id: String
    let title: String
    let icon: String
    let what: String
    let who: String
    var phone: (label: String, number: String)?
    var text: (label: String, number: String)?
    var link: (label: String, url: String)?
    var note: String?
    /// A 311 report that helps with this cause, opened in Services.
    var report: String?
}

enum HelpCatalog {
    static let crisis: [HelpResource] = [
        HelpResource(id: "988", title: "988 Suicide & Crisis Lifeline", icon: "support_agent",
                     what: "Call or text any time for emotional support or a mental health crisis.",
                     who: "National lifeline", phone: ("Call 988", "988"), text: ("Text 988", "988"),
                     link: ("988lifeline.org", "https://988lifeline.org")),
        HelpResource(id: "211", title: "211: food, shelter, utilities, rent", icon: "diversity_1",
                     what: "One call to find food pantries, shelters, utility and rent help, and more. Open 24/7, with interpreters.",
                     who: "United Way of Greater Kansas City", phone: ("Call 211", "211"),
                     link: ("Search the 211 database", "https://www.unitedwaygkc.org/211"),
                     note: "From a phone that cannot dial 211: 816-474-5112."),
        HelpResource(id: "firstcall", title: "Addiction crisis line", icon: "call",
                     what: "Free 24/7 help for you or someone you love with alcohol or drug use.",
                     who: "First Call", phone: ("Call 816-361-5900", "8163615900"),
                     link: ("firstcallkc.org", "https://www.firstcallkc.org")),
    ]

    /// In the order of the cause prioritization.
    static let causes: [HelpResource] = [
        HelpResource(id: "tobacco", title: "Quit smoking, vaping, or chew", icon: "smoke_free",
                     what: "Free quit coaching by phone, text, or online, any time. Coaches build a quit plan with you.",
                     who: "Missouri Tobacco Quit Services", phone: ("Call 1-800-QUIT-NOW", "18007848669"),
                     link: ("youcanquit.org", "https://youcanquit.org"),
                     note: "Teens: mylifemyquit.org."),
        HelpResource(id: "overdose", title: "Prevent an overdose", icon: "medication",
                     what: "Free naloxone (Narcan) and fentanyl test strips, and training on how to use them. Both are legal in Missouri.",
                     who: "First Call", phone: ("Call 816-361-5900", "8163615900"),
                     link: ("Request naloxone", "https://www.firstcallkc.org/harmreduction/")),
        HelpResource(id: "falls", title: "Prevent falls (older adults)", icon: "elderly",
                     what: "A Matter of Balance: a free 8-class program on strength, balance, and making a home safer.",
                     who: "Shepherd's Center of KC Central", phone: ("Call (816) 444-1121", "8164441121"),
                     link: ("Class schedule", "https://kcshepherdscenter.org/programs-and-services/a-matter-of-balance.html"),
                     note: "Registration is free. Space is limited.",
                     report: "Report a broken sidewalk"),
        HelpResource(id: "bp", title: "Check your blood pressure", icon: "monitor_heart",
                     what: "High blood pressure is Kansas City's single largest health burden. Primary care for all ages, with a sliding fee for insured or uninsured patients.",
                     who: "Samuel U. Rodgers Health Center", phone: ("Call (816) 474-4920", "8164744920"),
                     link: ("samrodgers.org", "https://samrodgers.org/medical-services/")),
        HelpResource(id: "traffic", title: "Safer streets", icon: "traffic",
                     what: "Report a dangerous intersection, speeding, a missing crosswalk, or a signal problem.",
                     who: "City of Kansas City, through 311",
                     report: "Request traffic calming"),
        HelpResource(id: "infant", title: "New and expecting moms", icon: "pregnancy",
                     what: "Nurse-Family Partnership: free visits from a nurse during pregnancy and the baby's first two years, for first-time moms.",
                     who: "Nurse-Family Partnership (Changent)",
                     link: ("Check if you qualify", "https://changent.org/for-families/"),
                     note: "Availability in Kansas City is not confirmed yet."),
        HelpResource(id: "locks", title: "Free gun locks", icon: "lock",
                     what: "A cable lock keeps a gun out of reach of children and of anyone in crisis.",
                     who: "Project ChildSafe and local police",
                     link: ("Find a free safety kit", "https://projectchildsafe.org/get-a-safety-kit/"),
                     note: "KCPD has offered free locks at patrol stations. Call 816-234-5000 first to confirm."),
    ]
}

/// The red "Health and help" card shown on the Report and City tabs.
struct HealthHelpCard: View {
    /// In a List row, a visible NavigationLink gets a second, system chevron.
    /// There the link sits hidden behind the card.
    var inList = false

    var body: some View {
        if inList {
            card.background(NavigationLink { HealthHelpView() } label: { EmptyView() }.opacity(0))
        } else {
            NavigationLink { HealthHelpView() } label: { card }.buttonStyle(.plain)
        }
    }

    private var card: some View {
        HStack(alignment: .top, spacing: 14) {
            Icon(name: "favorite", size: 28).foregroundStyle(Theme.onErrorContainer)
            VStack(alignment: .leading, spacing: 4) {
                Text("Health and help").font(.headline).foregroundStyle(Theme.onErrorContainer)
                Text("Crisis lines, food and shelter, quitting tobacco, overdose prevention, falls, and more.")
                    .font(.caption).foregroundStyle(Theme.onErrorContainer.opacity(0.85))
                    .multilineTextAlignment(.leading)
            }
            Spacer(minLength: 0)
            Icon(name: "chevron_right", size: 20).foregroundStyle(Theme.onErrorContainer)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.errorContainer, in: RoundedRectangle(cornerRadius: Theme.Shape.tile, style: .continuous))
    }
}

struct HealthHelpView: View {
    @State private var web: URL?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Link(destination: URL(string: "tel:911")!) {
                    Label { Text("In danger right now? Call 911.").font(.headline) } icon: { Icon(name: "emergency", size: 22) }
                        .foregroundStyle(Theme.onErrorContainer)
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.errorContainer, in: RoundedRectangle(cornerRadius: Theme.Shape.tile, style: .continuous))
                }
                SectionLabel(text: "Help now")
                ForEach(HelpCatalog.crisis) { card($0) }
                SectionLabel(text: "Basic needs")
                VStack(spacing: 0) {
                    needLink("Somewhere to stay", "Shelters, cooling and warming centers", "night_shelter") { BasicNeeds.stay }
                    Divider().padding(.leading, 52)
                    needLink("Food", "Food pantries, meals, stores that take SNAP", "restaurant") { BasicNeeds.food }
                    Divider().padding(.leading, 52)
                    needLink("Low-cost clinics", "Health centers with fees based on income", "local_hospital") { BasicNeeds.clinics }
                    Divider().padding(.leading, 52)
                    needLink("SNAP, Medicaid, housing help", "Benefits offices, rent and eviction help", "home_work") { BasicNeeds.benefits }
                }
                .card()
                SectionLabel(text: "Prevent the most harm")
                Text("Ordered by Kansas City Effective Altruism's ranking of where effort saves the most healthy years of life here.")
                    .font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                ForEach(HelpCatalog.causes) { card($0) }
                Button { web = URL(string: "https://becomingstronger.github.io/kc-cause-prioritization.html") } label: {
                    Text("How the causes were ranked").font(.subheadline.weight(.semibold))
                }
                .padding(.top, 4)
            }
            .padding(16)
        }
        .background(Theme.surface)
        .wrappingTitle("Health and help")
        .sheet(item: $web) { SafariView(url: $0).ignoresSafeArea() }
    }

    private func needLink<D: View>(_ title: String, _ sub: String, _ icon: String, @ViewBuilder _ dest: @escaping () -> D) -> some View {
        NavigationLink { dest() } label: {
            HStack(spacing: 14) {
                Icon(name: icon, size: 22).foregroundStyle(Theme.error).frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.onSurface)
                    Text(sub).font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                }
                Spacer()
                Icon(name: "chevron_right", size: 18).foregroundStyle(Theme.onSurfaceVariant)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func card(_ r: HelpResource) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Icon(name: r.icon, size: 22).foregroundStyle(Theme.error)
                Text(r.title).font(.headline).foregroundStyle(Theme.onSurface)
            }
            Text(r.what).font(.subheadline).foregroundStyle(Theme.onSurface)
            Text(r.who).font(.caption.weight(.semibold)).foregroundStyle(Theme.onSurfaceVariant)
            if let n = r.note { Text(n).font(.caption).foregroundStyle(Theme.onSurfaceVariant) }
            FlowLayout(spacing: 8) {
                if let p = r.phone, let u = URL(string: "tel:\(p.number)") { Link(destination: u) { chip(p.label, "call", filled: true) } }
                if let t = r.text, let u = URL(string: "sms:\(t.number)") { Link(destination: u) { chip(t.label, "sms", filled: false) } }
                if let l = r.link, let u = URL(string: l.url) { Button { web = u } label: { chip(l.label, "open_in_new", filled: false) } }
                if let rep = r.report {
                    Button { TabRouter.shared.tab = 4 } label: { chip(rep, "report", filled: false) }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func chip(_ title: String, _ icon: String, filled: Bool) -> some View {
        HStack(spacing: 6) { Icon(name: icon, size: 16); Text(title).font(.caption.weight(.semibold)) }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .foregroundStyle(filled ? Theme.onError : Theme.onErrorContainer)
            .background(filled ? Theme.error : Theme.errorContainer, in: Capsule())
    }
}

/// The selected tab, shared so a screen can send people to another tab
/// (Health and help opens Services to file a report).
@MainActor
final class TabRouter: ObservableObject {
    static let shared = TabRouter()
    @Published var tab = { let t = UserDefaults.standard.integer(forKey: "startTab"); return t == 1 ? 2 : t }()
}
