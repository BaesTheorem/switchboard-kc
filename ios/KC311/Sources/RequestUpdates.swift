import SwiftUI

/// One tap files a "311 Request Update" for each selected open report. The
/// screen is the review: it lists every open report and the contact the city
/// will use, and the button says how many real requests it sends. Reports
/// filed or asked about in the past 7 days are greyed out with the date their
/// requests open (Store.tooSoon).
/// The switch turns on the automatic version (AutoUpdates.swift).
struct RequestUpdatesView: View {
    @EnvironmentObject private var store: Store
    @State private var contact = Contact.saved
    @State private var method = "Email"
    @State private var selected: Set<String> = []
    @State private var touched = false
    @State private var auto = Store.autoEnabled
    @State private var sending = false
    @State private var progress = 0
    @State private var results: [String: String] = [:]
    @State private var error: String?

    private var open: [MyReport] { store.visibleReports.filter(\.isOpen) }

    /// Reports filed or asked about in the past 7 days cannot be selected.
    private func caution(_ r: MyReport) -> String? { store.tooSoon(r) }

    private var contactValue: String { method == "Email" ? contact.email : contact.phone }
    private var done: Bool { !results.isEmpty && !sending }
    private var loading: Bool { store.myReportsState == .loading || (store.myReportsState == .idle && store.myReports.isEmpty) }

    var body: some View {
        List {
            if open.isEmpty {
                if loading {
                    HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
                } else if case .failed(let msg) = store.myReportsState {
                    StateMessage(icon: "cloud_off", title: "Cannot load your reports", message: msg,
                                 action: ("Try again", { Task { await store.loadMyReports() } }))
                        .listRowBackground(Color.clear)
                } else {
                    StateMessage(icon: "task_alt", title: "No open reports", message: "All the reports you sent are closed.")
                        .listRowBackground(Color.clear)
                }
            } else {
                Section("Open reports") {
                    ForEach(open) { r in row(r) }
                }
                Section("The city contacts you by") {
                    Picker("Method", selection: $method) {
                        Text("Email").tag("Email")
                        Text("Phone call").tag("Phone Call")
                    }
                    .pickerStyle(.segmented)
                    if method == "Email" {
                        TextField("Email", text: $contact.email).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                    } else {
                        TextField("Phone", text: $contact.phone).keyboardType(.phonePad)
                    }
                }
            }
            Section {
                Toggle("Ask automatically", isOn: $auto)
                    .onChange(of: auto) { _, on in
                        Store.autoEnabled = on
                        if on { Store.requestNotificationPermission() }
                    }
            } footer: {
                Text("When a report has had no updates and no update request for 7 days, the app asks the city and sends you a notification. It needs your email or phone above.")
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(Theme.error)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if !open.isEmpty {
                Group {
                    if done {
                        FilledButton(title: "Done", icon: "check") { results = [:]; progress = 0; selectDefault() }
                    } else {
                        FilledButton(title: buttonTitle, icon: sending ? nil : "notifications_active",
                                     enabled: !selected.isEmpty && !contactValue.isEmpty && !sending) {
                            Task { await send() }
                        }
                    }
                }
                .padding(16)
                .background(Theme.surface)
            }
        }
        .wrappingTitle("Request updates")
        .refreshable { await store.loadMyReports() }
        .task {
            selectDefault()
            await store.loadMyReports()
        }
        .onChange(of: store.myReports) { _, _ in if !touched && !sending && !done { selectDefault() } }
        .onChange(of: contact) { _, c in Contact.saved = c }
    }

    private func row(_ r: MyReport) -> some View {
        Button {
            touched = true
            if selected.contains(r.id) { selected.remove(r.id) } else { selected.insert(r.id) }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Icon(name: selected.contains(r.id) ? "check_box" : "check_box_outline_blank", size: 24)
                    .foregroundStyle(selected.contains(r.id) ? Theme.primary : Theme.onSurfaceVariant)
                VStack(alignment: .leading, spacing: 3) {
                    Text(r.subcategory.isEmpty ? r.category : r.subcategory).foregroundStyle(Theme.onSurface)
                    Text([r.caseNumber.isEmpty ? "Report \(r.id)" : "#\(r.caseNumber)", r.status.capitalized,
                          r.address.isEmpty ? nil : r.address].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                    if let note = caution(r) {
                        Label { Text(note) } icon: { Icon(name: "schedule", size: 14) }
                            .font(.caption).foregroundStyle(Theme.open)
                    }
                }
                Spacer()
                if let res = results[r.id] {
                    Icon(name: res == "ok" ? "check_circle" : "error", size: 22)
                        .foregroundStyle(res == "ok" ? Theme.done : Theme.error)
                }
            }
        }
        .disabled(sending || done || caution(r) != nil)
        .opacity(caution(r) == nil ? 1 : 0.5)
    }

    /// Selects every open report without a caution note.
    private func selectDefault() { selected = Set(open.filter { caution($0) == nil }.map(\.id)) }

    private var buttonTitle: String {
        if sending { return "Sending \(progress) of \(selected.count)" }
        if contactValue.isEmpty { return method == "Email" ? "Add your email" : "Add your phone" }
        let n = selected.count
        return n == 0 ? "Select a report" : "Request \(n == 1 ? "an update" : "\(n) updates")"
    }

    private func send() async {
        sending = true
        error = nil
        progress = 0
        defer { sending = false }
        for r in open where selected.contains(r.id) {
            progress += 1
            do {
                try await store.fileUpdateRequest(for: r, method: method, contact: contact)
                results[r.id] = "ok"
            } catch {
                results[r.id] = "error"
                self.error = error.localizedDescription
            }
        }
        await store.loadMyReports()
    }
}
