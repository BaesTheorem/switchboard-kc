import MapKit
import PhotosUI
import SwiftUI

/// Report flow: photo first, then what is wrong, then one details sheet.
struct ReportTab: View {
    let openMyReports: () -> Void
    /// "No photo" goes to the Services tab.
    let openServices: () -> Void
    @EnvironmentObject private var store: Store
    @StateObject private var draft = ReportDraft()
    @State private var path: [Step] = []
    @State private var showCamera = false
    @State private var libraryItem: PhotosPickerItem?
    @State private var web: URL?

    enum Step: Hashable { case category, section(ReportSection), all, details, done(String), streetcar, report(MyReport) }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(spacing: 20) {
                    hero
                    HealthHelpCard()
                    NearYouCard()
                    if !store.queued.isEmpty { queuedCard }
                    recent
                }
                .padding(16)
            }
            .background(Theme.surface)
            .navigationTitle("KC 311")
            .settingsCog()
            .navigationDestination(for: Step.self) { step in
                switch step {
                case .category: SectionGrid(draft: draft, open: open,
                                            openSection: { path.append(.section($0)) }, openAll: { path.append(.all) })
                case .section(let sec): SectionView(section: sec, open: open)
                case .all: AllItemsView(open: open)
                case .streetcar: StreetcarForm(draft: draft)
                case .report(let r): ReportDetailView(report: r)
                case .details: ReportForm(draft: draft) { wo in path.append(.done(wo)) }
                case .done(let wo): DoneView(workOrder: wo, note: draft.autoresponse) {
                    draft.reset()
                    path = []
                    openMyReports()
                }
                }
            }
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { img in
                    draft.photos.append(img)
                    path = [.category]
                }
                .ignoresSafeArea()
            }
            .onChange(of: libraryItem) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                        await draft.addPhoto(img, data: data)
                        path = [.category]
                    }
                    libraryItem = nil
                }
            }
            .task { await openStartStep() }
            .task { await NearYou.shared.load() }
            .sheet(item: $web) { SafariView(url: $0).ignoresSafeArea() }
        }
    }

    /// Where a tapped row leads: a report form, a city page, a call or text,
    /// the streetcar form, or the update-request sheet.
    private func open(_ kind: DirectoryItem.Kind) {
        switch kind {
        case .report(let c, let sub):
            draft.category = c
            draft.sub = sub
            draft.answers = [:]
            draft.choiceAnswers = [:]
            path.append(.details)
        case .link(let l): web = l.url
        case .phone(let p): UIApplication.shared.open(p.url)
        case .streetcar: path.append(.streetcar)
        }
    }

    /// `-startStep category|all|details|sub|streetcar|report` (sub with `-startCategory trash`) jumps into the flow, for headless
    /// simulator screenshots. `details` picks the first pothole sub-type.
    private func openStartStep() async {
        guard let step = UserDefaults.standard.string(forKey: "startStep") else { return }
        if step == "category" { path = [.category]; return }
        if step == "streetcar" { path = [.category, .streetcar]; return }
        while store.categories.isEmpty { try? await Task.sleep(for: .milliseconds(200)) }
        if step == "all" { path = [.category, .all]; return }
        if step == "report" {
            while store.visibleReports.isEmpty { try? await Task.sleep(for: .milliseconds(200)) }
            if let r = store.visibleReports.first(where: \.isOpen) { path = [.report(r)] }
            return
        }
        if step == "sub", let want = UserDefaults.standard.string(forKey: "startCategory")?.lowercased(),
           let cat = store.categories.first(where: { $0.name.lowercased().contains(want) }) {
            path = [.category, .section(ReportSection.of(cat))]
            return
        }
        guard step == "details", let cat = store.categories.first(where: { $0.name.lowercased().contains("pothole") }) else { return }
        draft.category = cat
        draft.sub = cat.subs.last
        path = [.category, .details]
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 16) {
            Icon(name: "add_a_photo", size: 36).foregroundStyle(Theme.onPrimaryContainer)
            Text("Report a problem").font(.title2.weight(.semibold)).foregroundStyle(Theme.onPrimaryContainer)
            Text("Take a photo, pick what is wrong, confirm the spot. The city gets it in under a minute.")
                .font(.subheadline).foregroundStyle(Theme.onPrimaryContainer.opacity(0.8))
            FilledButton(title: "Take a photo", icon: "photo_camera") { showCamera = true }
            HStack(spacing: 12) {
                PhotosPicker(selection: $libraryItem, matching: .images) {
                    HStack(spacing: 8) { Icon(name: "photo_library", size: 20); Text("Library").font(.subheadline.weight(.semibold)) }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .foregroundStyle(Theme.onPrimaryContainer)
                        .background(Theme.surface.opacity(0.7), in: Capsule())
                }
                Button(action: openServices) {
                    Text("No photo").font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .foregroundStyle(Theme.onPrimaryContainer)
                        .background(Theme.surface.opacity(0.7), in: Capsule())
                }
            }
        }
        .padding(20)
        .background(Theme.primaryContainer, in: RoundedRectangle(cornerRadius: Theme.Shape.sheet, style: .continuous))
    }

    private var queuedCard: some View {
        HStack(spacing: 12) {
            Icon(name: "cloud_upload").foregroundStyle(Theme.open)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(store.queued.count) waiting to send").font(.subheadline.weight(.semibold))
                Text("They go out when the city's server answers again.").font(.caption).foregroundStyle(Theme.onSurfaceVariant)
            }
            Spacer()
            Button("Retry") { Task { await store.flushQueue() } }.font(.subheadline.weight(.semibold))
        }
        .padding(16)
        .card()
    }

    /// Open reports first (newest first), each one opens its detail.
    @ViewBuilder private var recent: some View {
        let open = store.visibleReports.filter(\.isOpen).sorted { ($0.added ?? .distantPast) > ($1.added ?? .distantPast) }
        if !open.isEmpty {
            VStack(spacing: 12) {
                HStack {
                    SectionLabel(text: open.count == 1 ? "Your open report" : "Your open reports")
                    Button("See all", action: openMyReports).font(.subheadline.weight(.semibold))
                }
                ForEach(open.prefix(5)) { r in
                    NavigationLink(value: Step.report(r)) {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(alignment: .firstTextBaseline) {
                                Icon(name: Category.icon(for: r.category), size: 20).foregroundStyle(Theme.primary)
                                Text(r.subcategory.isEmpty ? r.category : r.subcategory).font(.headline)
                                    .foregroundStyle(Theme.onSurface).multilineTextAlignment(.leading)
                                Spacer()
                                Icon(name: "chevron_right", size: 20).foregroundStyle(Theme.onSurfaceVariant)
                            }
                            StatusTrack(status: r.status, timeline: store.cachedDetail(r.id)?.timeline ?? [])
                            HStack {
                                Text(r.caseNumber.isEmpty ? "Report \(r.id)" : "#\(r.caseNumber)").monospacedDigit()
                                Spacer()
                                if let d = r.lastMovement { Text("updated \(d.relative)") }
                            }
                            .font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                        }
                        .padding(16)
                        .card()
                    }
                    .buttonStyle(.plain)
                }
                if open.count > 5 {
                    Button("See all \(open.count) open reports", action: openMyReports).font(.subheadline.weight(.semibold))
                }
            }
        }
    }
}

struct DoneView: View {
    let workOrder: String
    let note: String?
    let finish: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Icon(name: "check_circle", size: 72).foregroundStyle(Theme.done)
            Text("Report sent").font(.title.weight(.semibold))
            if !workOrder.isEmpty {
                Text("Report #\(workOrder)").font(.title3.monospacedDigit()).foregroundStyle(Theme.onSurfaceVariant)
                    .textSelection(.enabled)
                Text("Some report types also get a separate city case number, which shows in My reports when it is assigned.")
                    .font(.caption).foregroundStyle(Theme.onSurfaceVariant).multilineTextAlignment(.center)
            }
            if let note {
                Text(note).font(.subheadline).foregroundStyle(Theme.onSurfaceVariant).multilineTextAlignment(.center)
                    .padding(16).card()
            }
            Spacer()
            FilledButton(title: "Track it", icon: "assignment", action: finish)
        }
        .padding(24)
        .background(Theme.surface)
        .navigationBarBackButtonHidden()
    }
}
