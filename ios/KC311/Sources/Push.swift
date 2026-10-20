import SwiftUI
import UIKit
import UserNotifications

/// Ticket alerts. The Switchboard KC push server (push/ in this repo) reads this
/// phone's reports every minute and sends a notification when city staff
/// change one. The app gives it the reports id and the APNs token, nothing else.
@MainActor
final class PushAlerts: NSObject, ObservableObject {
    static let shared = PushAlerts()
    static let server = URL(string: "https://kc311-push.alex-hedtke.workers.dev")!

    enum State: Equatable { case off, asking, on, denied, failed }

    @Published private(set) var state: State = .off
    /// The user's choice. On by default; iOS permission is asked separately.
    @Published private(set) var enabled: Bool = UserDefaults.standard.object(forKey: "ticketAlerts") as? Bool ?? true
    /// A report to open, set when a notification is tapped.
    @Published var openReportID: String?

    private var token: String? {
        get { UserDefaults.standard.string(forKey: "apnsToken") }
        set { UserDefaults.standard.set(newValue, forKey: "apnsToken") }
    }
    /// The reports id the server has for this phone, so a changed id can be swapped.
    private var registeredID: String? {
        get { UserDefaults.standard.string(forKey: "pushRegisteredID") }
        set { UserDefaults.standard.set(newValue, forKey: "pushRegisteredID") }
    }

    private static var apnsEnvironment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }

    /// On launch: get a fresh token if alerts are on and iOS allows them.
    func start() async {
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        switch status {
        case .denied: state = .denied
        case .authorized, .provisional, .ephemeral:
            if enabled {
                if state != .on { state = .asking }
                UIApplication.shared.registerForRemoteNotifications()
            } else {
                state = .off
            }
        default: state = .off
        }
    }

    /// Turn alerts on, asking iOS for permission if it has not been asked.
    func turnOn() async {
        enabled = true
        UserDefaults.standard.set(true, forKey: "ticketAlerts")
        state = .asking
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        if granted { UIApplication.shared.registerForRemoteNotifications() } else { state = .denied }
    }

    /// Asks once, after the first report, if the user has not chosen yet.
    func askIfUndecided() async {
        guard enabled else { return }
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        if status == .notDetermined { await turnOn() }
    }

    /// Turn alerts off and delete this phone from the server.
    func turnOff() async {
        enabled = false
        UserDefaults.standard.set(false, forKey: "ticketAlerts")
        state = .off
        if let id = registeredID, let token { _ = await post("unregister", ["device_uid": id, "token": token]) }
        registeredID = nil
    }

    func didRegister(_ data: Data) {
        token = data.map { String(format: "%02x", $0) }.joined()
        Task { await sendRegistration() }
    }

    func didFailToRegister() { if enabled { state = .failed } }

    /// The reports id changed (Settings > Restore my reports).
    func reportsIDChanged() async {
        guard enabled, token != nil else { return }
        await sendRegistration()
    }

    private func sendRegistration() async {
        guard enabled, let token else { return }
        let id = CivicClient.shared.deviceUID
        if let old = registeredID, old != id { _ = await post("unregister", ["device_uid": old, "token": token]) }
        if await post("register", ["device_uid": id, "token": token, "env": Self.apnsEnvironment]) {
            registeredID = id
            state = .on
        } else {
            state = .failed
        }
    }

    private func post(_ path: String, _ body: [String: String]) async -> Bool {
        var req = URLRequest(url: Self.server.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        req.timeoutInterval = 30
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return obj["ok"] as? Bool == true
    }
}

extension PushAlerts: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification)
        async -> UNNotificationPresentationOptions { [.banner, .list, .sound] }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let id = response.notification.request.content.userInfo["report_id"] as? String else { return }
        await MainActor.run {
            TabRouter.shared.tab = 2
            PushAlerts.shared.openReportID = id
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = PushAlerts.shared
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in PushAlerts.shared.didRegister(deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in PushAlerts.shared.didFailToRegister() }
    }
}

/// Settings card: one switch, what the server keeps, and the way out when iOS says no.
struct TicketAlertsSection: View {
    @ObservedObject private var push = PushAlerts.shared

    var body: some View {
        Section {
            // Off until iOS allows notifications; on while setting up or retrying.
            Toggle(isOn: Binding(get: { push.enabled && [.asking, .on, .failed].contains(push.state) },
                                 set: { on in Task { on ? await push.turnOn() : await push.turnOff() } })) {
                Label { Text("Alert me when the city updates a report") } icon: { Icon(name: "notifications", size: 20) }
            }
            .disabled(push.state == .denied || push.state == .asking)
            switch push.state {
            case .on:
                Text("Checking every minute").font(.caption).foregroundStyle(Theme.onSurfaceVariant)
            case .denied:
                Button("Open iPhone Settings") {
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
                }
            case .failed:
                Text("Alerts are not set up yet. The app tries again when it opens.")
                    .font(.caption).foregroundStyle(Theme.error)
            case .asking, .off:
                EmptyView()
            }
        } header: {
            Text("Ticket alerts")
        } footer: {
            Text("The Switchboard KC alert server checks your reports every minute and sends a notification when city staff change one. It keeps your reports id and this phone's notification token, nothing else. Turn this off to delete them.")
        }
    }
}
