import SwiftUI

extension CityLink {
    /// Clearer labels for the city's menu names where the name hides the action.
    var displayName: String {
        switch name {
        case "Bulky Item Pickup": "Schedule a bulky item pickup"
        case "Recycling Carts": "Recycling cart information"
        case "Leaf and Brush": "Leaf and brush pickup schedule"
        case "Snowplow Map": "Snowplow map"
        case "Snow and Trash Update": "Snow and trash service updates"
        case "Make a Police Report": "Make a police report online"
        default: name
        }
    }
}

extension Store {
    var reportCategories: [Category] { categories.filter { !ReportSection.isUpdateRequest($0.name) } }

    func categories(in s: ReportSection) -> [Category] {
        reportCategories.filter { ReportSection.of($0) == s }
    }

    func links(in s: ReportSection) -> [CityLink] { links.filter { s.owns($0) } }

    /// Links that no section claims stay on the City tab.
    var generalLinks: [CityLink] { links.filter { l in !ReportSection.all.contains { $0.owns(l) } } }

    var sections: [ReportSection] {
        ReportSection.all + (reportCategories.contains { ReportSection.of($0) == .other } ? [.other] : [])
    }

    /// Every report type, page, and phone number, for the A to Z list.
    var directory: [DirectoryItem] {
        var out: [DirectoryItem] = []
        for c in reportCategories {
            let section = ReportSection.of(c).title
            if c.subs.isEmpty {
                out.append(DirectoryItem(title: c.displayName, detail: section, icon: c.icon, kind: .report(c, nil)))
            }
            for s in c.subs {
                out.append(DirectoryItem(title: s.displayName, detail: "\(c.displayName) · \(section)", icon: c.icon, kind: .report(c, s)))
            }
        }
        for l in links {
            let where_ = ReportSection.all.first { $0.owns(l) }?.title ?? "City"
            out.append(DirectoryItem(title: l.displayName, detail: "Web page · \(where_)", icon: l.icon, kind: .link(l)))
        }
        for p in CityPhones.pinned + CityPhones.more {
            out.append(DirectoryItem(title: p.name, detail: p.number, icon: p.text ? "sms" : "call", kind: .phone(p)))
        }
        out.append(DirectoryItem(title: "KC Streetcar problem", detail: "Streetcar Authority, not 311", icon: "tram", kind: .streetcar))
        return out.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }
}

/// The report home: streetcar, the A to Z list, then the sections. Update
/// requests live on the My reports tab.
struct SectionGrid: View {
    @ObservedObject var draft: ReportDraft
    let open: (DirectoryItem.Kind) -> Void
    let openSection: (ReportSection) -> Void
    let openAll: () -> Void
    var title = "What is wrong?"
    @EnvironmentObject private var store: Store
    @State private var query = ""

    var body: some View {
        ScrollView {
            if let photo = draft.photos.last {
                Image(uiImage: photo).resizable().scaledToFill()
                    .frame(height: 140).frame(maxWidth: .infinity).clipped()
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Shape.tile, style: .continuous))
                    .padding(.horizontal, 16)
            }
            if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                DirectoryRows(items: store.directory, query: query, open: open)
                    .padding(.horizontal, 16)
            } else if store.categories.isEmpty {
                if let err = store.catalogError {
                    StateMessage(icon: "cloud_off", title: "Cannot load report types", message: err,
                                 action: ("Try again", { Task { await store.refreshCatalog(force: true) } }))
                } else {
                    ProgressView().padding(40)
                }
            } else {
                VStack(spacing: 12) {
                    shortcut("KC Streetcar", "On board or at a stop. Goes to the Streetcar Authority, not 311.", "tram") { open(.streetcar) }
                    Button(action: openAll) {
                        HStack(spacing: 12) {
                            Icon(name: "sort_by_alpha", size: 24).foregroundStyle(Theme.primary)
                            Text("Everything, A to Z").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.onSurface)
                            Spacer()
                            Text("\(store.directory.count)").font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                            Icon(name: "chevron_right", size: 20).foregroundStyle(Theme.onSurfaceVariant)
                        }
                        .padding(16).card()
                    }
                    .buttonStyle(.plain)
                    ForEach(store.sections) { s in
                        Button { openSection(s) } label: {
                            HStack(alignment: .top, spacing: 14) {
                                Icon(name: s.icon, size: 26).foregroundStyle(Theme.primary).frame(width: 30)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(s.title).font(.headline).foregroundStyle(Theme.onSurface)
                                    Text(s.blurb).font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                                        .multilineTextAlignment(.leading)
                                }
                                Spacer(minLength: 0)
                                Icon(name: "chevron_right", size: 20).foregroundStyle(Theme.onSurfaceVariant)
                            }
                            .padding(16)
                            .background(Theme.surfaceContainer, in: RoundedRectangle(cornerRadius: Theme.Shape.tile, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
        }
        .background(Theme.surface)
        .navigationTitle(title)
        .settingsCog()
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Pothole, streetlight, tow lot")
    }

    private func shortcut(_ title: String, _ sub: String, _ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                Icon(name: icon, size: 26).foregroundStyle(Theme.onPrimaryContainer)
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.onPrimaryContainer)
                Text(sub).font(.caption).foregroundStyle(Theme.onPrimaryContainer.opacity(0.8))
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.primaryContainer, in: RoundedRectangle(cornerRadius: Theme.Shape.tile, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

/// One section: its city pages first, then each category as a header with
/// its sub-types under it, so look-alike names ("Guardrail" in Bridge and in
/// Street Maintenance) show where they go.
struct SectionView: View {
    let section: ReportSection
    let open: (DirectoryItem.Kind) -> Void
    @EnvironmentObject private var store: Store

    var body: some View {
        List {
            let links = store.links(in: section)
            if !links.isEmpty {
                Section("Pages") {
                    ForEach(links) { l in
                        Button { open(.link(l)) } label: { row(l.displayName, icon: l.icon, trailing: "open_in_new") }
                    }
                }
            }
            ForEach(store.categories(in: section)) { c in
                Section {
                    if c.subs.isEmpty {
                        Button { open(.report(c, nil)) } label: { row(c.displayName, icon: c.icon, trailing: "chevron_right") }
                    }
                    ForEach(c.subs) { s in
                        Button { open(.report(c, s)) } label: { row(s.displayName, icon: nil, trailing: "chevron_right") }
                    }
                } header: {
                    Label { Text(c.displayName) } icon: { Icon(name: c.icon, size: 18) }
                }
            }
        }
        .wrappingTitle(section.title)
    }

    private func row(_ title: String, icon: String?, trailing: String) -> some View {
        HStack(spacing: 12) {
            if let icon { Icon(name: icon, size: 22).foregroundStyle(Theme.primary) }
            Text(title).foregroundStyle(Theme.onSurface)
            Spacer()
            Icon(name: trailing, size: 18).foregroundStyle(Theme.onSurfaceVariant)
        }
    }
}

/// Every report type, page, and number in alphabetical order, with a letter index.
struct AllItemsView: View {
    let open: (DirectoryItem.Kind) -> Void
    @EnvironmentObject private var store: Store
    @State private var query = ""

    var body: some View {
        ScrollView {
            DirectoryRows(items: store.directory, query: query, open: open).padding(16)
        }
        .background(Theme.surface)
        .wrappingTitle("Everything, A to Z")
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search")
    }
}

struct DirectoryRows: View {
    let items: [DirectoryItem]
    let query: String
    let open: (DirectoryItem.Kind) -> Void

    private var shown: [DirectoryItem] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return items }
        return items.filter { $0.title.lowercased().contains(q) || $0.detail.lowercased().contains(q) }
    }

    private var letters: [(String, [DirectoryItem])] {
        Dictionary(grouping: shown) { String($0.title.uppercased().first.map { $0.isLetter ? $0 : "#" } ?? "#") }
            .sorted { $0.key < $1.key }
    }

    var body: some View {
        if shown.isEmpty {
            StateMessage(icon: "search_off", title: "No match", message: "Try a shorter word.")
        }
        LazyVStack(alignment: .leading, spacing: 16, pinnedViews: [.sectionHeaders]) {
            ForEach(letters, id: \.0) { letter, rows in
                Section {
                    VStack(spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { i, item in
                            if i > 0 { Divider().padding(.leading, 52) }
                            Button { open(item.kind) } label: {
                                HStack(spacing: 14) {
                                    Icon(name: item.icon, size: 22).foregroundStyle(Theme.primary).frame(width: 24)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(item.title).foregroundStyle(Theme.onSurface).multilineTextAlignment(.leading)
                                        Text(item.detail).font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                                            .multilineTextAlignment(.leading)
                                    }
                                    Spacer(minLength: 0)
                                }
                                .padding(.horizontal, 14).padding(.vertical, 10)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .card()
                } header: {
                    Text(letter).font(.headline).foregroundStyle(Theme.primary)
                        .padding(.vertical, 4).padding(.horizontal, 4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.surface)
                }
            }
        }
    }
}
