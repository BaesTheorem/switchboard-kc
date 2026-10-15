import Foundation

/// Watches the city API and repairs it without the user.
///
/// A check is one signed read (get_main). It runs at launch, on foreground,
/// and in background refresh, at most every 6 hours. Any request that fails
/// for a reason a fix can address (a rejected key, a refused request, no key)
/// also comes here. The repair follows the official app: ask get_baseurl for
/// the current API base and try again; if that does not help, get the key
/// from the newest city app (KeyRefresher).
@MainActor
final class APIHealth: ObservableObject {
    static let shared = APIHealth()
    static let checkInterval: TimeInterval = 6 * 3600

    enum Status: Equatable { case unknown, ok, repairing(String), broken(String) }
    @Published var status: Status = .unknown
    @Published var lastCheck: Date? = UserDefaults.standard.object(forKey: "apiLastCheck") as? Date
    @Published var lastRepair: String? = UserDefaults.standard.string(forKey: "apiLastRepair")
    private var repairing: Task<Bool, Never>?

    /// Runs a check if none ran in the past 6 hours (or `force`).
    func check(force: Bool = false) async {
        if !force, let last = lastCheck, Date().timeIntervalSince(last) < Self.checkInterval, status != .unknown { return }
        do {
            let obj = try await CivicClient.shared.post("get_main", fields: ["timestamp": "0"])
            let ok = ((obj["response_status"] as? [String: Any])?["response_code"] as? Int) == 1
            status = ok ? .ok : .broken("The city's server answered, but not with the expected data.")
        } catch CivicError.offline {
            status = .broken(CivicError.offline.localizedDescription)
        } catch {
            status = .broken(error.localizedDescription)
        }
        lastCheck = Date()
        UserDefaults.standard.set(lastCheck, forKey: "apiLastCheck")
    }

    /// Repairs after an auth failure. Concurrent callers share one repair.
    func repair(after error: CivicError) async -> Bool {
        if let repairing { return await repairing.value }
        let t = Task { await runRepair(after: error) }
        repairing = t
        let ok = await t.value
        repairing = nil
        return ok
    }

    private func runRepair(after error: CivicError) async -> Bool {
        if case .rejected = error {
            status = .repairing("Checking the API address")
            if await CivicClient.shared.refreshBase() {
                note("The city moved its API; the app switched to the new address.")
                status = .ok
                return true
            }
        }
        status = .repairing("Getting the city's current API key")
        if await KeyRefresher.shared.refresh() {
            note("The city changed its API key; the app read the new one from the city's app.")
            status = .ok
            return true
        }
        status = .broken(KeyRefresher.shared.state.failureText ?? error.localizedDescription)
        return false
    }

    private func note(_ text: String) {
        lastRepair = "\(Date().formatted(date: .abbreviated, time: .shortened)): \(text)"
        UserDefaults.standard.set(lastRepair, forKey: "apiLastRepair")
    }
}

extension KeyRefresher.State {
    var failureText: String? { if case .failed(let m) = self { m } else { nil } }
}
