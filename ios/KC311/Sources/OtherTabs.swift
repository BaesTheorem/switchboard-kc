import MapKit
import SwiftUI

/// One of my reports as a card: type, status track, number, last movement.
struct MyReportCard: View {
    let report: MyReport
    @EnvironmentObject private var store: Store

    var body: some View {
        let r = report
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Icon(name: Category.icon(for: r.category), size: 20).foregroundStyle(Theme.primary)
                Text(r.subcategory.isEmpty ? r.category : r.subcategory).font(.headline).foregroundStyle(Theme.onSurface)
                    .multilineTextAlignment(.leading)
                Spacer()
                if r.unread > 0 {
                    Text("\(r.unread) new").font(.caption.weight(.semibold)).foregroundStyle(Theme.onPrimary)
                        .padding(.horizontal, 8).padding(.vertical, 2).background(Theme.primary, in: Capsule())
                }
            }
            StatusTrack(status: r.status)
            HStack {
                Text(r.caseNumber.isEmpty ? "Report \(r.id)" : "#\(r.caseNumber)").monospacedDigit()
                Spacer()
                if let d = r.lastMovement { Text("updated \(d.relative)") }
            }
            .font(.caption).foregroundStyle(Theme.onSurfaceVariant)
            if let asked = store.lastAsked(r) {
                Label { Text("Update asked \(asked.relative)") } icon: { Icon(name: "notifications_active", size: 14) }
                    .font(.caption).foregroundStyle(Theme.primary)
            }
        }
        .padding(16).card()
    }
}

struct ReportDetailView: View {
    let report: MyReport
    @EnvironmentObject private var store: Store
    @State private var detail: ReportDetail?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let d = detail {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack { StatusChip(status: d.status); Spacer(); if !d.caseNumber.isEmpty { Text("#\(d.caseNumber)").monospacedDigit().foregroundStyle(Theme.onSurfaceVariant).textSelection(.enabled) } }
                        Text(d.subtype.isEmpty ? d.type : d.subtype).font(.title2.weight(.semibold))
                        if !d.address.isEmpty { Label { Text(d.address) } icon: { Icon(name: "location_on", size: 18) }.font(.subheadline) }
                        StatusTrack(status: d.status)
                        if report.isOpen { RequestUpdateButton(target: report).padding(.top, 4) }
                    }
                    .padding(16).card()
                    if !d.photos.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(d.photos, id: \.self) { url in
                                    AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Theme.surfaceContainer }
                                        .frame(width: 140, height: 140).clipped()
                                        .clipShape(RoundedRectangle(cornerRadius: Theme.Shape.card, style: .continuous))
                                }
                            }
                        }
                    }
                    if !d.description.isEmpty {
                        Text(d.description).font(.body).padding(16).frame(maxWidth: .infinity, alignment: .leading).card()
                    }
                    if !d.timeline.isEmpty {
                        SectionLabel(text: "Timeline")
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(d.timeline.reversed().enumerated()), id: \.element.id) { i, e in
                                HStack(alignment: .top, spacing: 12) {
                                    VStack(spacing: 0) {
                                        Circle().fill(i == 0 ? Theme.primary : Theme.outlineVariant).frame(width: 12, height: 12).padding(.top, 4)
                                        if i < d.timeline.count - 1 { Rectangle().fill(Theme.outlineVariant).frame(width: 2) }
                                    }
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(e.title).font(.subheadline.weight(.semibold))
                                        if !e.details.isEmpty { Text(e.details).font(.subheadline).foregroundStyle(Theme.onSurfaceVariant) }
                                        Text(e.when).font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                                    }
                                    .padding(.bottom, 16)
                                }
                            }
                        }
                        .padding(16).card()
                    }
                } else if let error {
                    StateMessage(icon: "cloud_off", title: "Cannot load this report", message: error,
                                 action: ("Try again", { Task { await load() } }))
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(40)
                }
            }
            .padding(16)
        }
        .background(Theme.surface)
        .navigationTitle(report.caseNumber.isEmpty ? "Report \(report.id)" : "#\(report.caseNumber)")
        .settingsCog()
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        if detail == nil { detail = store.cachedFullDetail(report) }
        do { detail = try await store.fullDetail(report); error = nil } catch { if detail == nil { self.error = error.localizedDescription } }
    }
}

/// My reports and everyone else's on one map (or list). Mine are drawn as
/// person pins on top and never fall under the 250-pin cap; in the list they
/// sit in a Yours section above Nearby. "Only mine" hides everyone else.
struct ReportsTab: View {
    @EnvironmentObject private var store: Store
    // `-startUpdates YES` opens the update screen, `-openReport YES` my first report (screenshots).
    @State private var path = NavigationPath()
    @AppStorage("onlyMine") private var onlyMine = false
    @State private var position: MapCameraPosition = .region(MKCoordinateRegion(center: Locator.downtown, latitudinalMeters: 2500, longitudinalMeters: 2500))
    @State private var center = Locator.downtown
    @State private var status = "open"
    @State private var selected: MapIssue?
    @State private var detailFor: MapIssue?
    /// Map or list, kept between launches.
    @AppStorage("nearbyList") private var listMode = false

    /// Time scope in days, kept between launches. Default 1 year.
    @AppStorage("mapScopeDays") private var scopeDays = 365
    private static let scopes: [(Int, String)] = [(365, "1 year"), (182, "6 months"), (90, "90 days"), (30, "30 days")]
    private var scopeLabel: String { Self.scopes.first { $0.0 == scopeDays }?.1 ?? "1 year" }

    /// Reports submitted inside the time scope. A report without a date stays.
    private var issues: [MapIssue] {
        let cutoff = Date().addingTimeInterval(-Double(scopeDays) * 86400)
        return (store.mapIssues[status] ?? []).filter { ($0.submitted ?? .distantFuture) >= cutoff }
    }

    /// MapKit stalls when SwiftUI hands it thousands of markers (3,000+ open
    /// reports citywide), so only the pins nearest the map's center are drawn.
    /// They update when the map stops moving.
    private var shown: [MapIssue] {
        let here = CLLocation(latitude: center.latitude, longitude: center.longitude)
        return issues
            .map { ($0, here.distance(from: CLLocation(latitude: $0.lat, longitude: $0.lon))) }
            .sorted { $0.1 < $1.1 }
            .prefix(250)
            .map(\.0)
    }
    private var loading: Bool { store.mapLoading.contains(status) }
    private var error: String? { store.mapError }

    /// My reports that match the status and time filters.
    private var mine: [MyReport] {
        let cutoff = Date().addingTimeInterval(-Double(scopeDays) * 86400)
        return store.visibleReports.filter { r in
            (status == "all" || (status == "open") == r.isOpen) && (r.added ?? .distantFuture) >= cutoff
        }
    }
    private var mineIDs: Set<String> { Set(store.visibleReports.map(\.id)) }
    private var others: [MapIssue] { onlyMine ? [] : issues.filter { !mineIDs.contains($0.id) } }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if listMode {
                    reportsList
                } else {
                    Map(position: $position, selection: Binding(get: { selected?.id }, set: { id in
                        if let id, id.hasPrefix("mine-"), let r = mine.first(where: { "mine-\($0.id)" == id }) {
                            selected = nil
                            path.append(r)
                        } else {
                            selected = issues.first { $0.id == id }
                        }
                    })) {
                        UserAnnotation()
                        if !onlyMine {
                            ForEach(shown.filter { !mineIDs.contains($0.id) }) { i in
                                Marker(i.type, monogram: Text(""), coordinate: CLLocationCoordinate2D(latitude: i.lat, longitude: i.lon))
                                    .tint(color(i.status))
                                    .tag(i.id)
                            }
                        }
                        // Drawn after the others and as markers too, so MapKit stacks them on top.
                        ForEach(mine.filter { $0.lat != nil && $0.lon != nil }) { r in
                            Marker("Yours: " + (r.subcategory.isEmpty ? r.category : r.subcategory), systemImage: "person.fill",
                                   coordinate: CLLocationCoordinate2D(latitude: r.lat!, longitude: r.lon!))
                                .tint(Theme.onSurface)
                                .tag("mine-\(r.id)")
                        }
                    }
                    .mapControls { MapUserLocationButton() }
                    .onMapCameraChange(frequency: .onEnd) { center = $0.region.center }
                }
            }
            .safeAreaInset(edge: .top) {
                // Large text: the picker gets the full width; refresh is an icon button.
                HStack(spacing: 8) {
                    Picker("Status", selection: $status) {
                        Text("Open").tag("open")
                        Text("Closed").tag("closed")
                        Text("All").tag("all")
                    }
                    .pickerStyle(.segmented)
                    Menu {
                        Picker("Reported in the past", selection: $scopeDays) {
                            ForEach(Self.scopes, id: \.0) { Text($0.1).tag($0.0) }
                        }
                    } label: {
                        HStack(spacing: 2) {
                            Icon(name: "date_range", size: 20)
                            Icon(name: "arrow_drop_down", size: 20)
                        }
                        .frame(height: 44).padding(.horizontal, 8)
                        .foregroundStyle(Theme.onPrimaryContainer)
                        .background(Theme.secondaryContainer, in: Capsule())
                    }
                    .accessibilityLabel("Reported in the past \(scopeLabel)")
                    Button { Task { await load(force: true) } } label: {
                        Group {
                            if loading { ProgressView() } else { Icon(name: "refresh", size: 22) }
                        }
                        .frame(width: 44, height: 44)
                        .foregroundStyle(Theme.onPrimaryContainer)
                        .background(Theme.secondaryContainer, in: Circle())
                    }
                    .accessibilityLabel(loading ? "Loading" : "Search this area")
                }
                .padding(10)
                // Opaque, so the controls stay readable over busy map tiles in light and dark.
                .background(Theme.surfaceContainerHigh, in: RoundedRectangle(cornerRadius: Theme.Shape.tile, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.Shape.tile, style: .continuous).strokeBorder(Theme.outlineVariant))
                .shadow(color: .black.opacity(0.18), radius: 6, y: 2)
                .padding(.horizontal, 12)
                .safeAreaInset(edge: .bottom, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(caption)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Theme.onSurface)
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .background(Theme.surfaceContainerHigh, in: Capsule())
                            .overlay(Capsule().strokeBorder(Theme.outlineVariant))
                        if !store.visibleReports.isEmpty {
                            Button { onlyMine.toggle(); selected = nil } label: {
                                HStack(spacing: 4) {
                                    Icon(name: onlyMine ? "person" : "groups", size: 16)
                                    Text(onlyMine ? "Only mine" : "Everyone").font(.caption.weight(.semibold))
                                }
                                .padding(.horizontal, 10).padding(.vertical, 4)
                                .foregroundStyle(onlyMine ? Theme.onPrimary : Theme.onSurface)
                                .background(onlyMine ? Theme.primary : Theme.surfaceContainerHigh, in: Capsule())
                                .overlay(Capsule().strokeBorder(Theme.outlineVariant))
                            }
                            .accessibilityLabel(onlyMine ? "Showing only your reports. Show everyone's" : "Showing everyone's reports. Show only yours")
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 18)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let i = selected, !listMode {
                    PinCard(issue: i, color: color(i.status)) { detailFor = i } close: { selected = nil }
                        .padding(12)
                } else if let error {
                    Text(error).font(.footnote).padding(12)
                        .background(Theme.errorContainer, in: RoundedRectangle(cornerRadius: Theme.Shape.card, style: .continuous))
                        .padding(12)
                } else if !loading && others.isEmpty && mine.isEmpty && !listMode {
                    Text("No \(status == "all" ? "" : status + " ")reports here in the past \(scopeLabel).").font(.footnote).padding(12)
                        .background(Theme.surface, in: Capsule()).padding(12)
                }
            }
            .sheet(item: $detailFor) { i in PublicIssueDetail(issue: i) }
            // `-selectPin YES|recent` selects the nearest (or nearest recent) pin, for simulator screenshots.
            .task {
                guard let pick = UserDefaults.standard.string(forKey: "selectPin") else { return }
                try? await Task.sleep(for: .seconds(4))
                selected = pick == "recent"
                    ? shown.first { ($0.submitted ?? .distantPast) > Date().addingTimeInterval(-7 * 86400) }
                    : shown.first
            }
            .navigationTitle("Reports")
            .settingsCog()
            .navigationDestination(for: MyReport.self) { ReportDetailView(report: $0) }
            .navigationDestination(for: String.self) { _ in RequestUpdatesView() }
            .refreshable { await store.loadMyReports() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { listMode.toggle(); selected = nil } label: {
                        Icon(name: listMode ? "map" : "list", size: 24).foregroundStyle(Theme.onSurfaceVariant)
                    }
                    .accessibilityLabel(listMode ? "Show map" : "Show list")
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .task {
                if let c = await Locator.shared.current() {
                    center = c
                    position = .region(MKCoordinateRegion(center: c, latitudinalMeters: 2500, longitudinalMeters: 2500))
                }
                await load()
            }
            .task {
                if UserDefaults.standard.bool(forKey: "startUpdates") { path.append("updates") }
                await store.loadMyReports()
                if UserDefaults.standard.bool(forKey: "openReport"), path.isEmpty, let r = store.visibleReports.first { path.append(r) }
            }
            .onChange(of: status) { _, _ in Task { await load() } }
            // A tapped ticket alert opens its report.
            .onReceive(PushAlerts.shared.$openReportID) { id in
                guard let id else { return }
                Task {
                    if !store.myReports.contains(where: { $0.id == id }) { await store.loadMyReports() }
                    if let r = store.myReports.first(where: { $0.id == id }) {
                        path = NavigationPath()
                        path.append(r)
                    }
                    PushAlerts.shared.openReportID = nil
                }
            }
        }
    }

    private var caption: String {
        let n = others.count, m = mine.count
        let parts = [m > 0 ? "\(m) yours" : nil, onlyMine ? nil : "\(n) nearby"].compactMap { $0 }
        return "Past \(scopeLabel) · " + parts.joined(separator: " · ")
    }

    /// List mode: Yours (with Request updates) above Nearby, nearest first.
    private var reportsList: some View {
        let here = CLLocation(latitude: center.latitude, longitude: center.longitude)
        let rows = others.map { ($0, here.distance(from: CLLocation(latitude: $0.lat, longitude: $0.lon))) }.sorted { $0.1 < $1.1 }
        let openCount = store.visibleReports.filter(\.isOpen).count
        return List {
            if !mine.isEmpty || !store.queued.isEmpty {
                Section {
                    ForEach(store.queued) { q in
                        HStack(spacing: 12) {
                            Icon(name: "cloud_upload").foregroundStyle(Theme.open)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(q.title).font(.headline)
                                Text("Waiting to send").font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                            }
                        }
                    }
                    ForEach(mine) { r in
                        NavigationLink(value: r) { MyReportCard(report: r) }
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    }
                } header: {
                    HStack {
                        Text("Yours")
                        Spacer()
                        if openCount > 0 {
                            NavigationLink(value: "updates") {
                                Label { Text("Request updates") } icon: { Icon(name: "notifications_active", size: 16) }
                                    .font(.caption.weight(.semibold))
                            }
                        }
                    }
                }
            }
            if !onlyMine {
                Section("Nearby") {
                    ForEach(rows, id: \.0.id) { i, meters in
                        Button { detailFor = i } label: { NearbyRow(issue: i, meters: meters, color: color(i.status)) }
                            .buttonStyle(.plain)
                    }
                }
            }
        }
        .listStyle(.plain)
        .overlay {
            if rows.isEmpty && mine.isEmpty {
                StateMessage(icon: "search_off", title: "No reports", message: "Try another status or a longer time.")
            }
        }
    }

    private func load(force: Bool = false) async {
        await store.loadMap(center: center, status: status, force: force)
    }

    private func color(_ s: String) -> Color {
        switch StatusStage(s) { case .received: Theme.open; case .working: Theme.working; case .done: Theme.done }
    }
}

/// One public report in the Reports list.
struct NearbyRow: View {
    let issue: MapIssue
    let meters: Double
    let color: Color

    var body: some View {
        let i = issue
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(color).frame(width: 12, height: 12).padding(.top, 5)
            VStack(alignment: .leading, spacing: 3) {
                Text(i.subtype.isEmpty ? i.type : i.subtype).font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.onSurface).multilineTextAlignment(.leading)
                if !i.address.isEmpty {
                    Text(i.address).font(.caption).foregroundStyle(Theme.onSurfaceVariant).multilineTextAlignment(.leading)
                }
                Text([i.status.capitalized, i.submitted.map { "reported \($0.relative)" }].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Theme.onSurfaceVariant)
            }
            Spacer(minLength: 8)
            Text(Self.distance(meters)).font(.caption.monospacedDigit()).foregroundStyle(Theme.onSurfaceVariant)
        }
        .contentShape(Rectangle())
    }

    static func distance(_ m: Double) -> String {
        let mi = m / 1609.34
        return mi < 0.1 ? "\(Int(m * 3.281 / 10) * 10) ft" : String(format: "%.1f mi", mi)
    }
}

struct CityTab: View {
    @EnvironmentObject private var store: Store
    // `-openLicenses YES` opens License offices, for simulator screenshots.
    @State private var showLicenses = UserDefaults.standard.bool(forKey: "openLicenses")
    // `-openHelp YES` opens Health and help, for simulator screenshots.
    @State private var showHelp = UserDefaults.standard.bool(forKey: "openHelp")
    // `-openScreen stay|food|clinics|benefits|transit`, for simulator screenshots.
    @State private var showScreen = UserDefaults.standard.string(forKey: "openScreen") != nil
    @State private var query = ""
    @State private var open: CityLink?
    @State private var showMore = false

    private func matches(_ text: String) -> Bool {
        let q = query.lowercased().trimmingCharacters(in: .whitespaces)
        return q.isEmpty || text.lowercased().contains(q)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HealthHelpCard()
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
                Section("Phone numbers") {
                    ForEach(CityPhones.pinned.filter { matches($0.name + $0.number) }) { phoneRow($0) }
                    let more = CityPhones.more.filter { matches($0.name + $0.number) }
                    if !more.isEmpty {
                        DisclosureGroup(isExpanded: Binding(get: { showMore || !query.isEmpty }, set: { showMore = $0 })) {
                            ForEach(more) { phoneRow($0) }
                        } label: {
                            Label { Text("More city numbers (\(more.count))") } icon: { Icon(name: "contact_phone", size: 22).foregroundStyle(Theme.primary) }
                        }
                    }
                }
                if matches("license offices dmv driver license plates title motor vehicle buses streetcar transit ridekc") {
                    Section {
                        NavigationLink { LicenseOfficesView() } label: {
                            Label { Text("License offices (DMV)") } icon: { Icon(name: "badge", size: 22).foregroundStyle(Theme.primary) }
                        }
                        NavigationLink { TransitView() } label: {
                            Label { Text("Buses and streetcar") } icon: { Icon(name: "directions_bus", size: 22).foregroundStyle(Theme.primary) }
                        }
                    } footer: {
                        Text("License offices with today's hours, and the next buses and streetcars near you.")
                    }
                }
                let links = store.generalLinks.filter { matches($0.displayName) }
                if store.links.isEmpty {
                    Section("City pages") {
                        HStack(spacing: 12) { ProgressView(); Text("Loading city pages").foregroundStyle(Theme.onSurfaceVariant) }
                    }
                } else if !links.isEmpty {
                    Section {
                        ForEach(links) { l in
                            Button { open = l } label: {
                                HStack(spacing: 14) {
                                    Icon(name: l.icon, size: 22).foregroundStyle(Theme.primary).frame(width: 28)
                                    Text(l.displayName).foregroundStyle(Theme.onSurface)
                                    Spacer()
                                    Icon(name: "open_in_new", size: 18).foregroundStyle(Theme.onSurfaceVariant)
                                }
                            }
                        }
                    } header: {
                        Text("City pages")
                    } footer: {
                        Text("Pages about trash, streets, water, health, and business are in their sections on the Report tab.")
                    }
                }
            }
            .navigationTitle("City")
            .settingsCog()
            .navigationDestination(isPresented: $showLicenses) { LicenseOfficesView() }
            .navigationDestination(isPresented: $showHelp) { HealthHelpView() }
            .navigationDestination(isPresented: $showScreen) {
                switch UserDefaults.standard.string(forKey: "openScreen") {
                case "stay": BasicNeeds.stay
                case "food": BasicNeeds.food
                case "clinics": BasicNeeds.clinics
                case "benefits": BasicNeeds.benefits
                default: TransitView()
                }
            }
            .searchable(text: $query, prompt: "Tow lot, court, water")
            .sheet(item: $open) { SafariView(url: $0.url).ignoresSafeArea() }
        }
    }

    private func phoneRow(_ p: CityPhone) -> some View {
        Link(destination: p.url) {
            HStack(spacing: 14) {
                Icon(name: p.text ? "sms" : "call", size: 22).foregroundStyle(Theme.primary).frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.name).foregroundStyle(Theme.onSurface)
                    Text(p.number).font(.caption.monospacedDigit()).foregroundStyle(Theme.onSurfaceVariant)
                }
            }
        }
    }
}

/// Appearance, API status, and the manual key refresh. The app repairs the
/// API by itself; the API sections are for when it could not. Opens as a
/// sheet from the cog in the top right of every main screen.
struct SettingsView: View {
    @EnvironmentObject private var store: Store
    @State private var deviceID = CivicClient.shared.deviceUID
    @State private var restoreID = ""
    @State private var restoreNote: String?
    @ObservedObject private var keys = KeyRefresher.shared
    @ObservedObject private var health = APIHealth.shared
    @AppStorage(Appearance.key) private var appearance = Appearance.auto.rawValue
    @Environment(\.dismiss) private var dismiss
    @State private var checking = false

    var body: some View {
        List {
            Section("Appearance") {
                Picker("Theme", selection: $appearance) {
                    ForEach(Appearance.allCases) { a in Text(a.label).tag(a.rawValue) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

            TicketAlertsSection()

            Section {
                HStack {
                    Text("Status")
                    Spacer()
                    Text(statusText).foregroundStyle(statusColor).multilineTextAlignment(.trailing)
                }
                if let last = health.lastCheck {
                    LabeledContent("Last check", value: last.relative)
                }
                if let repair = health.lastRepair {
                    Text("Last repair: \(repair)").font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                }
                Button {
                    Task { checking = true; await health.check(force: true); checking = false }
                } label: {
                    HStack { Text("Check the API now"); if checking { Spacer(); ProgressView() } }
                }
                .disabled(checking || keys.isBusy)
            } header: {
                Text("City API")
            } footer: {
                Text("The app checks the city's API every 6 hours and repairs it by itself: it asks the server for its current address, then gets the current key from the city's own app.")
            }

            Section {
                Button {
                    Task { await keys.refresh(manual: true) }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Update the city API key")
                        Text(keyStatus).font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                    }
                }
                .disabled(keys.isBusy)
            } footer: {
                Text("Downloads the city's newest Android app (about 44 MB) and reads the key from it. Use this only if reports stop going through.")
            }

            Section("Details") {
                LabeledContent("City app version", value: CivicConfig.current?.app_version ?? "none")
                LabeledContent("API address", value: CivicClient.base.host() ?? "")
            }

            Section {
                LabeledContent("Your reports id") {
                    Text(deviceID).monospaced().textSelection(.enabled)
                }
                Button("Copy it") { UIPasteboard.general.string = deviceID }
                TextField("Paste an id to restore", text: $restoreID)
                    .monospaced().textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("Restore my reports") {
                    if CivicClient.shared.useDeviceUID(restoreID) {
                        deviceID = CivicClient.shared.deviceUID
                        restoreID = ""
                        restoreNote = "Restored. My reports now shows the reports filed under this id."
                        Task {
                            await store.loadMyReports()
                            await PushAlerts.shared.reportsIDChanged()
                        }
                    } else {
                        restoreNote = "An id is 16 characters, 0 to 9 and a to f."
                    }
                }
                .disabled(restoreID.trimmingCharacters(in: .whitespaces).isEmpty)
                if let restoreNote { Text(restoreNote).font(.caption).foregroundStyle(Theme.onSurfaceVariant) }
            } header: {
                Text("My reports")
            } footer: {
                Text("The city has no accounts: it keeps your reports under this id. The app saves it in your iCloud Keychain, so it survives deleting the app and moves to a new iPhone. Keep a copy if iCloud Keychain is off.")
            }

            Section {
                // "Come check us out!" is the link.
                Text("Provided by Kansas City Effective Altruism. [Come check us out!](https://www.eakansascity.org)\n\nAn unofficial app. It is not made, approved, or supported by the City of Kansas City, Missouri, Tyler Technologies, or the KC Streetcar Authority. For an emergency, call 911.")
                    .font(.footnote)
                    .foregroundStyle(Theme.onSurfaceVariant)
                    .tint(Theme.primary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .multilineTextAlignment(.center)
                    .listRowBackground(Color.clear)
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }

    private var statusText: String {
        switch health.status {
        case .unknown: "Not checked yet"
        case .ok: "Working"
        case .repairing(let what): what
        case .broken(let why): why
        }
    }

    private var statusColor: Color {
        switch health.status {
        case .ok: Theme.done
        case .broken: Theme.error
        default: Theme.onSurfaceVariant
        }
    }

    private var keyStatus: String {
        switch keys.state {
        case .downloading(let f): "Downloading the city's app, \(Int(f * 100))%"
        case .scanning: "Reading the key"
        case .testing: "Testing the key"
        case .done(let v): "Updated. City app version \(v)."
        case .failed(let m): m
        case .idle:
            (UserDefaults.standard.object(forKey: "keyRefreshed") as? Date).map { "Last updated \($0.relative)" } ?? "Not needed so far"
        }
    }
}

/// The selected pin. Text wraps; nothing is cut off.
struct PinCard: View {
    let issue: MapIssue
    let color: Color
    let open: () -> Void
    let close: () -> Void

    @ViewBuilder private var cardButtons: some View {
        TonalButton(title: "Full details", icon: "description", action: open)
        if StatusStage(issue.status) != .done { RequestUpdateButton(target: issue) }
    }

    var body: some View {
        // Hug the content; past 55% of the screen, scroll.
        ViewThatFits(in: .vertical) {
            content.background(cardShape)
            ScrollView { content }.scrollBounceBehavior(.basedOnSize).background(cardShape)
        }
        .containerRelativeFrame(.vertical, alignment: .bottom) { h, _ in h * 0.55 }
    }

    private var cardShape: some View {
        RoundedRectangle(cornerRadius: Theme.Shape.tile, style: .continuous).fill(Theme.surface)
            .overlay(alignment: .leading) {
                UnevenRoundedRectangle(topLeadingRadius: Theme.Shape.tile, bottomLeadingRadius: Theme.Shape.tile)
                    .fill(color).frame(width: 5)
            }
    }

    private var content: some View {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(issue.subtype.isEmpty ? issue.type : issue.subtype).font(.headline)
                            .fixedSize(horizontal: false, vertical: true)
                        if !issue.subtype.isEmpty {
                            Text(issue.type).font(.subheadline).foregroundStyle(Theme.onSurfaceVariant)
                        }
                    }
                    Spacer(minLength: 8)
                    Button(action: close) { Icon(name: "close", size: 20).foregroundStyle(Theme.onSurfaceVariant) }
                        .accessibilityLabel("Close")
                }
                StatusChip(status: issue.status)
                Label { Text(issue.address).fixedSize(horizontal: false, vertical: true) } icon: { Icon(name: "location_on", size: 18) }
                    .font(.subheadline)
                if let d = issue.details, !d.isEmpty {
                    Text(d).font(.subheadline).foregroundStyle(Theme.onSurfaceVariant)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text([(issue.caseNumber.isEmpty ? nil : "#\(issue.caseNumber)"),
                      issue.submitted.map { "reported \($0.formatted(date: .abbreviated, time: .omitted))" },
                      issue.updated.map { "updated \($0.relative)" }].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                // Side by side when they fit; stacked at large text sizes.
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 8) { cardButtons }
                    VStack(alignment: .leading, spacing: 8) { cardButtons }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A public report's detail: photos, description, staff timeline. The
/// reporter's contact fields are never read.
struct PublicIssueDetail: View {
    let issue: MapIssue
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var detail: ReportDetail?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        StatusChip(status: detail?.status ?? issue.status)
                        Text(issue.subtype.isEmpty ? issue.type : issue.subtype).font(.title2.weight(.semibold))
                        if !issue.subtype.isEmpty { Text(issue.type).foregroundStyle(Theme.onSurfaceVariant) }
                        Label { Text(issue.address) } icon: { Icon(name: "location_on", size: 18) }.font(.subheadline)
                        StatusTrack(status: detail?.status ?? issue.status)
                    }
                    .padding(16).frame(maxWidth: .infinity, alignment: .leading).card()
                    if let d = detail {
                        if !d.photos.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    ForEach(d.photos, id: \.self) { url in
                                        AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Theme.surfaceContainer }
                                            .frame(width: 160, height: 160).clipped()
                                            .clipShape(RoundedRectangle(cornerRadius: Theme.Shape.card, style: .continuous))
                                    }
                                }
                            }
                        }
                        let text = d.description.isEmpty ? (issue.details ?? "") : d.description
                        if !text.isEmpty { Text(text).padding(16).frame(maxWidth: .infinity, alignment: .leading).card() }
                        if !d.timeline.isEmpty {
                            SectionLabel(text: "Timeline")
                            VStack(alignment: .leading, spacing: 12) {
                                ForEach(d.timeline.reversed()) { e in
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(e.title).font(.subheadline.weight(.semibold))
                                        if !e.details.isEmpty { Text(e.details).font(.subheadline).foregroundStyle(Theme.onSurfaceVariant) }
                                        Text(e.when).font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                                    }
                                }
                            }
                            .padding(16).frame(maxWidth: .infinity, alignment: .leading).card()
                        }
                    } else if let error {
                        StateMessage(icon: "cloud_off", title: "Cannot load the details", message: error,
                                     action: ("Try again", { Task { await load() } }))
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(30)
                    }
                }
                .padding(16)
            }
            .background(Theme.surface)
            .wrappingTitle(issue.caseNumber.isEmpty ? "Report" : "#\(issue.caseNumber)")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .task { await load() }
        }
    }

    private func load() async {
        if detail == nil { detail = store.cachedFullDetail(issue) }
        do { detail = try await store.fullDetail(issue); error = nil } catch { if detail == nil { self.error = error.localizedDescription } }
    }
}

/// "Request update" for one report: a pin on the map or one of mine. It
/// files a real 311 Request Update, so it confirms first and names the
/// contact the city will use; without a saved contact it asks for one.
struct RequestUpdateButton<T: UpdateTarget>: View {
    let target: T
    @EnvironmentObject private var store: Store
    @State private var confirm = false
    @State private var askContact = false
    @State private var sending = false
    @State private var sent = false
    @State private var error: String?

    private var contact: Contact { Contact.saved }
    private var method: String { contact.email.isEmpty ? "Phone Call" : "Email" }
    private var reach: String { method == "Email" ? contact.email : contact.phone }
    var body: some View {
        let blocked = store.tooSoon(target)
        VStack(alignment: .leading, spacing: 4) {
            if sent {
                Label { Text("Update requested") } icon: { Icon(name: "check_circle", size: 18) }
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.done)
                    .frame(minHeight: 44)
            } else {
                TonalButton(title: sending ? "Sending" : "Request update", icon: sending ? nil : "notifications_active") {
                    if reach.isEmpty { askContact = true } else { confirm = true }
                }
                .disabled(sending || blocked != nil)
                .opacity(blocked == nil ? 1 : 0.45)
            }
            if let blocked, !sent {
                Label { Text(blocked).fixedSize(horizontal: false, vertical: true) } icon: { Icon(name: "schedule", size: 14) }
                    .font(.caption).foregroundStyle(Theme.open)
            }
            if let error { Text(error).font(.caption).foregroundStyle(Theme.error) }
        }
        .confirmationDialog("Ask the city for an update?", isPresented: $confirm, titleVisibility: .visible) {
            Button("Request update") { Task { await send() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This files a 311 Request Update on \(target.reference) (\(target.label)). The city contacts you by \(method == "Email" ? "email at" : "phone at") \(reach).")
        }
        .sheet(isPresented: $askContact, onDismiss: { if !reach.isEmpty { confirm = true } }) {
            ContactSheet().presentationDetents([.medium])
        }
    }

    private func send() async {
        sending = true
        error = nil
        defer { sending = false }
        do {
            try await store.fileUpdateRequest(for: target, method: method, contact: contact)
            sent = true
            await store.loadMyReports()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Asks once for the contact the city uses to answer update requests.
struct ContactSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var contact = Contact.saved

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Email", text: $contact.email).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                    TextField("Phone", text: $contact.phone).keyboardType(.phonePad)
                } footer: {
                    Text("The city answers update requests by email, or by phone if no email is given. Saved on this phone only.")
                }
            }
            .wrappingTitle("How should the city reach you?")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Continue") {
                        Contact.saved = contact
                        dismiss()
                    }
                    .disabled(contact.email.isEmpty && contact.phone.isEmpty)
                }
            }
        }
    }
}
