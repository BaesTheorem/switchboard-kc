import MapKit
import PhotosUI
import SwiftUI

/// One page for the details: photos, location, the city's questions, notes,
/// contact. The submit button names the first thing still missing.
struct ReportForm: View {
    @ObservedObject var draft: ReportDraft
    let sent: (String) -> Void
    @EnvironmentObject private var store: Store
    @State private var contact = Contact.saved
    @State private var picking = false
    @State private var showCamera = false
    @State private var libraryItem: PhotosPickerItem?
    @State private var sending = false
    @State private var error: String?
    @State private var warning: String?
    @State private var locating = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                if let d = draft.disclaimer { disclaimer(d) }
                photos
                location
                if !draft.questions.isEmpty { questions }
                notes
                contactSection
                if let error {
                    HStack(alignment: .top, spacing: 12) {
                        Icon(name: "error").foregroundStyle(Theme.error)
                        Text(error).font(.subheadline)
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.errorContainer, in: RoundedRectangle(cornerRadius: Theme.Shape.card, style: .continuous))
                }
                FilledButton(title: sending ? "Sending" : (draft.missing ?? "Send to the city"),
                             icon: sending ? nil : (draft.missing == nil ? "send" : nil),
                             enabled: draft.missing == nil && !sending) { Task { await send(force: false) } }
            }
            .padding(16)
        }
        .background(Theme.surface)
        .navigationTitle("Details")
        .settingsCog()
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $picking) {
            LocationPicker(start: draft.location?.coordinate) {
                draft.locationSource = "pin placed by hand"
                draft.location = $0
            }
        }
        .onChange(of: draft.location) { _, _ in Task { await draft.refreshPlace() } }
        .fullScreenCover(isPresented: $showCamera) { CameraPicker { draft.photos.append($0) }.ignoresSafeArea() }
        .onChange(of: libraryItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                    await draft.addPhoto(img, data: data)
                }
                libraryItem = nil
            }
        }
        .alert("Already reported here?", isPresented: Binding(get: { warning != nil }, set: { if !$0 { warning = nil } })) {
            Button("Send anyway") { Task { await send(force: true) } }
            Button("Cancel", role: .cancel) {}
        } message: { Text(warning ?? "") }
        .task {
            if draft.location == nil { await useCurrentLocation() } else if draft.place == nil { await draft.refreshPlace() }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Icon(name: draft.category?.icon ?? "report", size: 28)
                .foregroundStyle(Theme.onPrimaryContainer)
                .frame(width: 48, height: 48)
                .background(Theme.primaryContainer, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(draft.category?.displayName ?? "").font(.headline)
                if let s = draft.sub { Text(s.displayName).font(.subheadline).foregroundStyle(Theme.onSurfaceVariant) }
            }
        }
    }

    private func disclaimer(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Icon(name: "info").foregroundStyle(Theme.primary)
            Text(text).font(.footnote).foregroundStyle(Theme.onSurfaceVariant)
        }
        .padding(16)
        .card()
    }

    private var photos: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Photos")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(draft.photos.enumerated()), id: \.offset) { i, img in
                        Image(uiImage: img).resizable().scaledToFill()
                            .frame(width: 88, height: 88).clipped()
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Shape.card, style: .continuous))
                            .overlay(alignment: .topTrailing) {
                                Button { draft.photos.remove(at: i) } label: {
                                    Icon(name: "close", size: 16).foregroundStyle(.white)
                                        .frame(width: 24, height: 24).background(.black.opacity(0.6), in: Circle())
                                }
                                .padding(4)
                                .accessibilityLabel("Remove photo")
                            }
                    }
                    if draft.photos.count < 4 {
                        Menu {
                            Button { showCamera = true } label: { Label("Camera", systemImage: "camera") }
                            PhotosPicker(selection: $libraryItem, matching: .images) { Label("Library", systemImage: "photo") }
                        } label: {
                            Icon(name: "add_a_photo", size: 28).foregroundStyle(Theme.primary)
                                .frame(width: 88, height: 88)
                                .background(Theme.surfaceContainer, in: RoundedRectangle(cornerRadius: Theme.Shape.card, style: .continuous))
                        }
                        .accessibilityLabel("Add photo")
                    }
                }
            }
        }
    }

    private var location: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: draft.locationRequired ? "Location" : "Location (optional)")
            Button { picking = true } label: {
                VStack(spacing: 0) {
                    if let loc = draft.location {
                        Map(initialPosition: .region(MKCoordinateRegion(center: loc.coordinate, latitudinalMeters: 300, longitudinalMeters: 300)),
                            interactionModes: []) {
                            Marker("", coordinate: loc.coordinate).tint(Theme.primary)
                        }
                        .id(loc.street + "\(loc.coordinate.latitude)")
                        .frame(height: 140)
                        .allowsHitTesting(false)
                    }
                    HStack(spacing: 12) {
                        Icon(name: "location_on").foregroundStyle(Theme.primary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(locating ? "Finding you" : (draft.location?.street ?? "Set the location"))
                                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.onSurface)
                            if let p = draft.place {
                                Text(p.intersection.isEmpty ? p.source : "Near \(p.intersection) · \(p.source)")
                                    .font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                            }
                        }
                        Spacer()
                        Text("Change").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.primary)
                    }
                    .padding(16)
                }
                .card()
                .clipShape(RoundedRectangle(cornerRadius: Theme.Shape.card, style: .continuous))
            }
            .buttonStyle(.plain)
        }
    }

    private var questions: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "The city asks")
            ForEach(draft.questions) { q in QuestionField(q: q, draft: draft) }
        }
    }

    private var notes: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: draft.descriptionRequired ? "Description" : "Description (optional)")
            TextField("What should the crew know?", text: $draft.notes, axis: .vertical)
                .lineLimit(3...8)
                .padding(16)
                .card()
        }
    }

    private var contactSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Visibility and contact")
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 4) {
                    Toggle("Show on the public map", isOn: Binding(get: { draft.share == "public" },
                                                                    set: { draft.share = $0 ? "public" : "private" }))
                    Text("Neighbors can see the type, place, description, and photos, so they need not report it again.")
                        .font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                }
                .padding(16)
                Divider().padding(.leading, 16)
                Toggle("Send anonymously", isOn: $draft.anonymous).padding(16)
                if !draft.anonymous {
                    Divider().padding(.leading, 16)
                    VStack(spacing: 12) {
                        HStack(spacing: 12) {
                            TextField("First name", text: $contact.firstName).textContentType(.givenName)
                            TextField("Last name", text: $contact.lastName).textContentType(.familyName)
                        }
                        TextField("Email", text: $contact.email).textContentType(.emailAddress)
                            .keyboardType(.emailAddress).textInputAutocapitalization(.never)
                        TextField("Phone", text: $contact.phone).textContentType(.telephoneNumber).keyboardType(.phonePad)
                    }
                    .padding(16)
                    Text("The city uses this to send case updates. It is saved on this phone only.")
                        .font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding([.horizontal, .bottom], 16)
                }
            }
            .card()
            .onChange(of: contact) { _, c in Contact.saved = c }
        }
    }

    private func useCurrentLocation() async {
        locating = true
        defer { locating = false }
        guard let c = await Locator.shared.current() else { return }
        draft.locationSource = "phone GPS"
        draft.location = await Locator.address(for: c)
    }

    private func send(force: Bool) async {
        sending = true
        error = nil
        defer { sending = false }
        let who: Contact? = draft.anonymous ? nil : contact
        do {
            if !force {
                let dup = try await store.checkDuplicate(draft)
                if dup.level == "2" { error = dup.message; return }
                if dup.level == "1" { warning = dup.message; return }
            }
            let wo = try await store.submit(draft, contact: who)
            await store.loadMyReports()
            sent(wo)
            await PushAlerts.shared.askIfUndecided()
        } catch CivicError.offline {
            store.enqueue(draft, contact: who)
            sent("")
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// One of the city's custom questions, rendered by kind.
struct QuestionField: View {
    let q: Question
    @ObservedObject var draft: ReportDraft
    @State private var date = Date()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(q.caption + (q.required && q.kind != .yesNo ? " *" : "")).font(.subheadline.weight(.semibold))
            switch q.kind {
            case .yesNo:
                Picker(q.caption, selection: Binding(get: { draft.answers[q.caption] ?? "NO" }, set: { draft.answers[q.caption] = $0 })) {
                    Text("Yes").tag("YES")
                    Text("No").tag("NO")
                }
                .pickerStyle(.segmented)
            case .choice:
                FlowChips(options: q.options, selected: draft.choiceAnswers[q.caption] ?? []) { id in
                    var set = draft.choiceAnswers[q.caption] ?? []
                    if set.contains(id) { set.remove(id) } else { set = q.multiple ? set.union([id]) : [id] }
                    draft.choiceAnswers[q.caption] = set
                }
            case .text, .monthYear:
                TextField(q.placeholder.isEmpty ? (q.kind == .monthYear ? "MM/yyyy" : "Answer") : q.placeholder,
                          text: Binding(get: { draft.answers[q.caption] ?? "" }, set: { draft.answers[q.caption] = $0 }),
                          axis: .vertical)
            case .dateTime, .date, .time:
                DatePicker(q.caption, selection: $date, displayedComponents: components)
                    .labelsHidden()
                    .onChange(of: date, initial: true) { _, d in draft.answers[q.caption] = format(d) }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private var components: DatePickerComponents {
        switch q.kind { case .date: [.date]; case .time: [.hourAndMinute]; default: [.date, .hourAndMinute] }
    }

    private func format(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = switch q.kind { case .date: "MM-dd-yyyy"; case .time: "HH:mm"; default: "MM-dd-yyyy HH:mm" }
        return f.string(from: d)
    }
}

/// MD3 filter chips that wrap.
struct FlowChips: View {
    let options: [Question.Option]
    let selected: Set<String>
    let toggle: (String) -> Void

    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(options, id: \.id) { o in
                let on = selected.contains(o.id)
                Button { toggle(o.id) } label: {
                    HStack(spacing: 6) {
                        if on { Icon(name: "check", size: 18) }
                        Text(o.value).font(.subheadline)
                    }
                    .padding(.horizontal, 14).frame(minHeight: 36)
                    .foregroundStyle(on ? Theme.onPrimaryContainer : Theme.onSurface)
                    .background(on ? Theme.secondaryContainer : Color.clear, in: Capsule())
                    .overlay(Capsule().stroke(on ? Color.clear : Theme.outlineVariant, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: rows.last.map { $0.y + $0.height } ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for i in row.items {
                let s = subviews[i].sizeThatFits(.unspecified)
                subviews[i].place(at: CGPoint(x: x, y: bounds.minY + row.y), proposal: ProposedViewSize(s))
                x += s.width + spacing
            }
        }
    }

    private struct Row { var items: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0; var y: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for (i, v) in subviews.enumerated() {
            let s = v.sizeThatFits(.unspecified)
            if !rows[rows.count - 1].items.isEmpty && rows[rows.count - 1].width + spacing + s.width > width {
                let y = rows[rows.count - 1].y + rows[rows.count - 1].height + spacing
                rows.append(Row(y: y))
            }
            let r = rows.count - 1
            rows[r].width += (rows[r].items.isEmpty ? 0 : spacing) + s.width
            rows[r].height = max(rows[r].height, s.height)
            rows[r].items.append(i)
        }
        return rows
    }
}

/// Full-screen map with a fixed center pin. Drag the map under the pin.
struct LocationPicker: View {
    let start: CLLocationCoordinate2D?
    let done: (PickedLocation) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var position: MapCameraPosition = .automatic
    @State private var center = Locator.downtown
    @State private var address = ""
    @State private var lookup: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            ZStack {
                Map(position: $position)
                    .onMapCameraChange(frequency: .onEnd) { ctx in
                        center = ctx.region.center
                        lookup?.cancel()
                        lookup = Task {
                            let p = await Locator.address(for: center)
                            if !Task.isCancelled { address = p.street }
                        }
                    }
                Icon(name: "location_on", size: 44).foregroundStyle(Theme.primary)
                    .offset(y: -20)
                    .allowsHitTesting(false)
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 12) {
                    Text(address.isEmpty ? "Move the map to the spot" : address)
                        .font(.headline).frame(maxWidth: .infinity, alignment: .leading)
                    HStack(spacing: 12) {
                        TonalButton(title: "Me", icon: "my_location") {
                            Task {
                                if let c = await Locator.shared.current() {
                                    withAnimation { position = .region(MKCoordinateRegion(center: c, latitudinalMeters: 250, longitudinalMeters: 250)) }
                                }
                            }
                        }
                        FilledButton(title: "Use this spot", icon: "check") {
                            Task {
                                done(await Locator.address(for: center))
                                dismiss()
                            }
                        }
                    }
                }
                .padding(20)
                .background(Theme.surface, in: UnevenRoundedRectangle(topLeadingRadius: Theme.Shape.sheet, topTrailingRadius: Theme.Shape.sheet, style: .continuous))
            }
            .ignoresSafeArea(edges: .top)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear {
                let c = start ?? Locator.shared.last ?? Locator.downtown
                center = c
                position = .region(MKCoordinateRegion(center: c, latitudinalMeters: 250, longitudinalMeters: 250))
            }
        }
    }
}
