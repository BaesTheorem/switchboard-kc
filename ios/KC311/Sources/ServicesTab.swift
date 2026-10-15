import SwiftUI

/// Every service in one place: the KC Streetcar shortcut, the A to Z list,
/// and the sections. It is the "No photo" way in; a photo, when wanted, is
/// added on the report form. It keeps its own draft, separate from the
/// Report tab's photo-first flow.
struct ServicesTab: View {
    let openMyReports: () -> Void
    @StateObject private var draft = ReportDraft()
    @State private var path: [Step] = []
    @State private var web: URL?

    enum Step: Hashable { case section(ReportSection), all, details, done(String), streetcar }

    var body: some View {
        NavigationStack(path: $path) {
            SectionGrid(draft: draft, open: open, openSection: { path.append(.section($0)) },
                        openAll: { path.append(.all) }, title: "Services")
                .navigationDestination(for: Step.self) { step in
                    switch step {
                    case .section(let sec): SectionView(section: sec, open: open)
                    case .all: AllItemsView(open: open)
                    case .streetcar: StreetcarForm(draft: draft)
                    case .details: ReportForm(draft: draft) { wo in path.append(.done(wo)) }
                    case .done(let wo): DoneView(workOrder: wo, note: draft.autoresponse) {
                        draft.reset()
                        path = []
                        openMyReports()
                    }
                    }
                }
                .sheet(item: $web) { SafariView(url: $0).ignoresSafeArea() }
        }
    }

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
}
