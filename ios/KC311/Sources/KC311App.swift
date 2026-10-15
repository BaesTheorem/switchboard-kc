import SwiftUI

@main
struct KC311App: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var store: Store
    @Environment(\.scenePhase) private var phase

    init() {
        let s = Store()
        _store = StateObject(wrappedValue: s)
        Store.registerBackground(s)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .tint(Theme.primary)
                .task {
                    await PushAlerts.shared.start()
                    await store.refreshCatalog()
                    // Start the map early: its city endpoint is slow.
                    Task {
                        let here = await Locator.shared.currentIfAllowed() ?? Locator.downtown
                        await store.loadMap(center: here, status: "open")
                    }
                    await APIHealth.shared.check()
                    await store.flushQueue()
                    await store.loadMyReports()
                    await store.autoRequestUpdates()
                    Store.scheduleBackground()
                }
                .onChange(of: phase) { _, now in
                    if now == .active {
                        Task {
                            await PushAlerts.shared.start()
                            await APIHealth.shared.check()
                            await store.flushQueue()
                            await store.autoRequestUpdates()
                        }
                    }
                    if now == .background { Store.scheduleBackground() }
                }
        }
    }
}

/// A strip at the top while the app repairs its API access.
struct KeyBanner: View {
    @ObservedObject var keys = KeyRefresher.shared
    @ObservedObject var health = APIHealth.shared

    private var text: String? {
        if keys.isBusy { return CivicConfig.current == nil ? "Getting the city's API key" : "The city changed its API key. Getting the new one." }
        if case .repairing(let what) = health.status { return what }
        return nil
    }

    var body: some View {
        if let text {
            HStack(spacing: 10) {
                ProgressView()
                Text(text).font(.caption.weight(.semibold))
            }
            .padding(.horizontal, 14).padding(.vertical, 8)
            .foregroundStyle(Theme.onPrimaryContainer)
            .background(Theme.primaryContainer, in: Capsule())
            .padding(.top, 4)
            .transition(.opacity)
        }
    }
}

struct RootView: View {
    // `-startTab N` opens a tab directly, for headless simulator screenshots;
    // `-showSettings YES` opens the settings sheet.
    @ObservedObject private var router = TabRouter.shared
    @ObservedObject private var settings = SettingsSheet.shared
    @AppStorage(Appearance.key) private var appearance = Appearance.auto.rawValue

    var body: some View {
        TabView(selection: $router.tab) {
            ReportTab(openMyReports: { router.tab = 2 }, openServices: { router.tab = 4 })
                .tabItem { Label { Text("Report") } icon: { Image.symbol("add_a_photo") } }
                .tag(0)
            // Tag 4 so the older tab numbers (and `-startTab`) stay the same.
            ServicesTab(openMyReports: { router.tab = 2 })
                .tabItem { Label { Text("Services") } icon: { Image.symbol("list_alt") } }
                .tag(4)
            ReportsTab()
                .tabItem { Label { Text("Reports") } icon: { Image.symbol("map") } }
                .tag(2)
            CityTab()
                .tabItem { Label { Text("City") } icon: { Image.symbol("account_balance") } }
                .tag(3)
        }
        .overlay(alignment: .top) { KeyBanner() }
        .sheet(isPresented: $settings.shown) { NavigationStack { SettingsView() } }
        .onAppear { Appearance.apply(appearance) }
        .onChange(of: appearance) { _, new in Appearance.apply(new) }
    }
}
