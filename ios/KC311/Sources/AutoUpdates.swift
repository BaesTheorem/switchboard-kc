import BackgroundTasks
import Foundation
import UserNotifications

/// Update requests. The city's own records are the state: a filed "311
/// Request Update" shows in "my reports" for this device id, so any client
/// that shares the device id and uses this rule sees the same history and
/// never asks twice. A report is due when it is open and has had no movement and no
/// update request for 7 days.
/// Anything an update request can name: one of my reports or a public pin.
protocol UpdateTarget {
    var id: String { get }
    var caseNumber: String { get }
    var address: String { get }
    var added: Date? { get }
    var label: String { get }
}

extension UpdateTarget {
    /// How to name the report to city staff. lastAsked() matches these words.
    var reference: String { caseNumber.isEmpty ? "myKCMO app report \(id)" : "request #\(caseNumber)" }
}

extension MyReport: UpdateTarget {
    var label: String { subcategory.isEmpty ? category : subcategory }
}

extension MapIssue: UpdateTarget {
    var caseNumber: String { caseNumberValue ?? "" }
    var added: Date? { submitted }
    var label: String { subtype.isEmpty ? type : subtype }
}

extension Store {
    static let staleDays: Double = 7
    static let autoKey = "autoRequestUpdates"
    static let bgTask = (Bundle.main.bundleIdentifier ?? "kc311") + ".updates"

    static var autoEnabled: Bool {
        get { UserDefaults.standard.object(forKey: autoKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: autoKey) }
    }

    /// Reports to show: update requests appear as a note on their report.
    var visibleReports: [MyReport] { myReports.filter { !$0.isUpdateRequest } }

    /// The update requests in my reports that name this report.
    func updateRequests(for r: some UpdateTarget) -> [MyReport] {
        let keys = ["report \(r.id)"] + (r.caseNumber.isEmpty ? [] : ["#\(r.caseNumber)"])
        return myReports.filter { $0.isUpdateRequest && keys.contains(where: $0.description.contains) }
    }

    func lastAsked(_ r: some UpdateTarget) -> Date? { updateRequests(for: r).compactMap(\.added).max() }

    /// Why an update request is not allowed yet, or nil. Requests open 7 days
    /// after a report is filed and 7 days after the last update request.
    func tooSoon(_ t: some UpdateTarget, now: Date = Date()) -> String? {
        let week = Self.staleDays * 86400
        if let added = t.added, now.timeIntervalSince(added) < week {
            let opens = added.addingTimeInterval(week).formatted(date: .abbreviated, time: .omitted)
            return "Filed \(added.relative). Update requests open \(opens)."
        }
        if let asked = lastAsked(t), now.timeIntervalSince(asked) < week {
            let opens = asked.addingTimeInterval(week).formatted(date: .abbreviated, time: .omitted)
            return "Update asked \(asked.relative). The next one opens \(opens)."
        }
        return nil
    }

    func isDue(_ r: MyReport, now: Date = Date()) -> Bool {
        guard r.isOpen, !r.isUpdateRequest else { return false }
        let last = [r.lastMovement, lastAsked(r)].compactMap { $0 }.max() ?? .distantPast
        return now.timeIntervalSince(last) >= Self.staleDays * 86400
    }

    var dueReports: [MyReport] { visibleReports.filter { isDue($0) } }

    /// Files one "311 Request Update" naming the report. A REAL city request.
    func fileUpdateRequest(for r: some UpdateTarget, method: String, contact: Contact) async throws {
        guard let cat = categories.first(where: { ReportSection.isUpdateRequest($0.name) }) else {
            throw CivicError.server("The city's update form is not loaded yet.")
        }
        let reach = method == "Email" ? contact.email : contact.phone
        let draft = ReportDraft()
        draft.category = cat
        let filed = r.added.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? ""
        for q in draft.questions {
            let c = q.caption.lowercased()
            if c.contains("request number") { draft.answers[q.caption] = r.caseNumber.isEmpty ? r.reference : r.caseNumber }
            else if c.contains("location") { draft.answers[q.caption] = r.address }
            else if c.contains("contact information") { draft.answers[q.caption] = reach }
            else if q.kind == .choice, let o = q.options.first(where: { $0.id == method }) { draft.choiceAnswers[q.caption] = [o.id] }
        }
        draft.notes = "Please send an update on \(r.reference): \(r.label)"
            + (r.address.isEmpty ? "" : " at \(r.address)") + (filed.isEmpty ? "" : ", filed \(filed)") + "."
        _ = try await submit(draft, contact: contact)
    }

    /// Asks about every due report, if automatic requests are on and a
    /// contact is saved. Returns how many were filed.
    @discardableResult
    func autoRequestUpdates() async -> Int {
        guard Self.autoEnabled else { return 0 }
        let contact = Contact.saved
        let method = contact.email.isEmpty ? "Phone Call" : "Email"
        guard !(method == "Email" ? contact.email : contact.phone).isEmpty else { return 0 }
        await loadMyReports()
        let due = dueReports
        guard !due.isEmpty else { return 0 }
        var filed: [MyReport] = []
        for r in due {
            if (try? await fileUpdateRequest(for: r, method: method, contact: contact)) != nil { filed.append(r) }
        }
        await loadMyReports()
        if !filed.isEmpty { Self.notify(filed) }
        return filed.count
    }

    private static func notify(_ filed: [MyReport]) {
        let c = UNMutableNotificationContent()
        c.title = "Asked the city for updates"
        c.body = filed.count == 1
            ? "\(filed[0].subcategory.isEmpty ? filed[0].category : filed[0].subcategory) had no updates in 7 days."
            : "\(filed.count) reports had no updates in 7 days."
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
    }

    /// Asks iOS for permission and, when granted, turns on ticket alerts too.
    static func requestNotificationPermission() {
        Task { await PushAlerts.shared.turnOn() }
    }

    // MARK: Background refresh (iOS decides when; launch and foreground also run the check)

    static func registerBackground(_ store: Store) {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: bgTask, using: nil) { task in
            scheduleBackground()
            let work = Task { @MainActor in
                await APIHealth.shared.check()
                await store.autoRequestUpdates()
                task.setTaskCompleted(success: true)
            }
            task.expirationHandler = { work.cancel() }
        }
    }

    static func scheduleBackground() {
        let req = BGAppRefreshTaskRequest(identifier: bgTask)
        req.earliestBeginDate = Date(timeIntervalSinceNow: 6 * 3600)
        try? BGTaskScheduler.shared.submit(req)
    }
}
