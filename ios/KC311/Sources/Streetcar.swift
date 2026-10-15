import CoreLocation
import MessageUI
import SwiftUI

/// KC Streetcar reports. The Authority is not part of 311. Two channels:
/// - See Say text line (816-837-4800): reaches a streetcar dispatcher now,
///   with two-way text. For safety, behavior, cleanliness, damage.
/// - Email info@kcstreetcar.org: the canonical inbox. For tracker and
///   display problems, service, feedback.
/// Both open the phone's own composer with the photo attached, so the
/// report goes from the user's own number or address and replies come back.
enum Streetcar {
    static let seeSayNumber = "8168374800"
    static let email = "info@kcstreetcar.org"
    static let seeSayWeb = URL(string: "https://tellkcstreetcar.com")!

    // Names as the See Say form writes them; positions from OpenStreetMap
    // (ODbL), averaged over each stop's two platforms. North to south.
    static let stops: [(String, Double, Double)] = [
        ("Riverfront (Berkley Riverfront)", 39.11715, -94.57212), ("River Market (3rd & Grand)", 39.11043, -94.58133),
        ("River Market West (4th & Delaware)", 39.10880, -94.58438), ("City Market (5th & Walnut)", 39.10851, -94.58189),
        ("North Loop (7th & Main)", 39.10524, -94.58303), ("Library (9th & Main)", 39.10311, -94.58307),
        ("Metro Center (12th & Main)", 39.09994, -94.58321), ("Power & Light (14th & Main)", 39.09684, -94.58334),
        ("Kauffman Center (16th & Main)", 39.09451, -94.58347), ("Crossroads (19th & Main)", 39.09041, -94.58368),
        ("Union Station (Pershing & Main)", 39.08467, -94.58406), ("WWI Museum & Memorial (27th & Main)", 39.07853, -94.58453),
        ("Union Hill (31st & Main)", 39.07107, -94.58531), ("Armour (35th & Main)", 39.06377, -94.58569),
        ("Westport (39th & Main)", 39.05643, -94.58612), ("Southmoreland (43rd & Main)", 39.04937, -94.58655),
        ("Art Museums (45th & Main)", 39.04591, -94.58674), ("Plaza (Cleaver II & Brookside)", 39.04109, -94.58612),
        ("UMKC (51st & Brookside)", 39.03547, -94.58412),
    ]

    struct Kind: Hashable { let name: String; let dispatch: Bool }

    // The See Say form's report types, plus the tracker problem that email suits best.
    static let kinds: [(String, [Kind])] = [
        ("Safety / Security", ["Disruptive Behavior", "Loitering / Sleeping", "Intoxication", "Solicitation / Panhandling",
                               "Harassment", "Assault / Fighting", "Suspicious Activity", "Other Safety / Security Issue"]
            .map { Kind(name: $0, dispatch: true) }),
        ("Maintenance", ["Cleanliness / Trash", "Broken Glass", "Graffiti", "Vandalism", "Other Maintenance Issue"]
            .map { Kind(name: $0, dispatch: true) }),
        ("Service", ["Arrival sign / tracker wrong", "Service delay or gap", "Accessibility problem", "Comment / Other Issue"]
            .map { Kind(name: $0, dispatch: false) }),
    ]

    static func nearestStop(_ c: CLLocationCoordinate2D) -> (String, Double) {
        let here = CLLocation(latitude: c.latitude, longitude: c.longitude)
        let best = stops.min { here.distance(from: CLLocation(latitude: $0.1, longitude: $0.2)) < here.distance(from: CLLocation(latitude: $1.1, longitude: $1.2)) }!
        return (best.0, here.distance(from: CLLocation(latitude: best.1, longitude: best.2)))
    }
}

struct StreetcarForm: View {
    @ObservedObject var draft: ReportDraft
    @State private var kind = Streetcar.kinds[1].1[0]
    @State private var stop = ""
    @State private var onboard = false
    @State private var car = "NA"
    @State private var details = ""
    @State private var composer: Composer?
    @State private var showWeb = false
    @State private var result: String?

    enum Composer: Identifiable { case sms, mail; var id: Int { hashValue } }

    private var whereText: String {
        var w = onboard ? "on board streetcar \(car == "NA" ? "(number not seen)" : car)" : "at the \(stop) stop"
        if onboard && !stop.isEmpty { w += ", near the \(stop) stop" }
        return w
    }

    private var gpsText: String {
        guard let p = draft.place else { return "" }
        return String(format: "GPS %.6f, %.6f", p.coordinate.latitude, p.coordinate.longitude)
    }

    var smsBody: String {
        "\(kind.name): \(details.trimmingCharacters(in: .whitespacesAndNewlines)) Location: \(whereText)."
            + (gpsText.isEmpty ? "" : " \(gpsText).")
    }

    var mailBody: String {
        let c = Contact.saved
        var lines = ["Hello,", "", "I want to report a problem I saw on \(Date().formatted(date: .complete, time: .shortened)).", "",
                     details.trimmingCharacters(in: .whitespacesAndNewlines), "", "Location: \(whereText)."]
        if let p = draft.place { lines.append(p.summary + ".") }
        if !draft.photos.isEmpty { lines += ["", "A photo is attached."] }
        lines += ["", "Please let me know if you need more details."]
        let sig = ["\(c.firstName) \(c.lastName)".trimmingCharacters(in: .whitespaces), c.phone, c.email].filter { !$0.isEmpty }
        if !sig.isEmpty { lines += ["", "Thank you,"] + sig }
        return lines.joined(separator: "\n")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(spacing: 12) {
                    Icon(name: "tram", size: 28).foregroundStyle(Theme.onPrimaryContainer)
                        .frame(width: 48, height: 48).background(Theme.primaryContainer, in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text("KC Streetcar").font(.headline)
                        Text("Not part of 311. This goes to the Streetcar Authority.").font(.subheadline).foregroundStyle(Theme.onSurfaceVariant)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    SectionLabel(text: "What happened")
                    Menu {
                        ForEach(Streetcar.kinds, id: \.0) { group in
                            Section(group.0) { ForEach(group.1, id: \.self) { k in Button(k.name) { kind = k } } }
                        }
                    } label: {
                        HStack { Text(kind.name).foregroundStyle(Theme.onSurface); Spacer(); Icon(name: "expand_more").foregroundStyle(Theme.onSurfaceVariant) }
                            .padding(16).card()
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    SectionLabel(text: "Where")
                    VStack(spacing: 0) {
                        Picker("Stop", selection: $stop) {
                            ForEach(Streetcar.stops, id: \.0) { Text($0.0).tag($0.0) }
                        }
                        .padding(.horizontal, 16).padding(.vertical, 8)
                        Divider().padding(.leading, 16)
                        Toggle("On board a streetcar", isOn: $onboard).padding(16)
                        if onboard {
                            Divider().padding(.leading, 16)
                            Picker("Car number", selection: $car) {
                                Text("Not seen").tag("NA")
                                ForEach(801...814, id: \.self) { Text("\($0)").tag("\($0)") }
                            }
                            .padding(.horizontal, 16).padding(.vertical, 8)
                        }
                    }
                    .card()
                    if let p = draft.place {
                        Text(p.summary).font(.caption).foregroundStyle(Theme.onSurfaceVariant)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    SectionLabel(text: "Details")
                    TextField("What should staff know?", text: $details, axis: .vertical)
                        .lineLimit(3...8).padding(16).card()
                }

                if !draft.photos.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Array(draft.photos.enumerated()), id: \.offset) { _, img in
                                Image(uiImage: img).resizable().scaledToFill().frame(width: 72, height: 72).clipped()
                                    .clipShape(RoundedRectangle(cornerRadius: Theme.Shape.card, style: .continuous))
                            }
                        }
                    }
                }

                VStack(spacing: 12) {
                    let ready = !details.trimmingCharacters(in: .whitespaces).isEmpty
                    if kind.dispatch {
                        FilledButton(title: ready ? "Text dispatch (See Say)" : "Add details", icon: ready ? "sms" : nil, enabled: ready) { composer = .sms }
                        TonalButton(title: "Email the Authority instead", icon: "mail") { composer = .mail }
                    } else {
                        FilledButton(title: ready ? "Email the Authority" : "Add details", icon: ready ? "mail" : nil, enabled: ready) { composer = .mail }
                        TonalButton(title: "Text dispatch instead", icon: "sms") { composer = .sms }
                    }
                    Button("Use the See Say web form") { showWeb = true }.font(.subheadline)
                    Text(kind.dispatch
                         ? "See Say reaches a streetcar dispatcher, who can text you back. For an emergency, call 911."
                         : "info@kcstreetcar.org is the Authority's main inbox. Replies come to your email.")
                        .font(.caption).foregroundStyle(Theme.onSurfaceVariant).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)

                if let result {
                    Label { Text(result) } icon: { Icon(name: "check_circle", size: 20).foregroundStyle(Theme.done) }
                        .padding(16).frame(maxWidth: .infinity, alignment: .leading).card()
                }
            }
            .padding(16)
        }
        .background(Theme.surface)
        .navigationTitle("Streetcar")
        .settingsCog()
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $composer) { c in
            switch c {
            case .sms: MessageComposer(recipient: Streetcar.seeSayNumber, body: smsBody, photos: draft.photos) { sent in
                if sent { result = "Text sent to See Say. Dispatch can reply to your number." }
            }
            case .mail: MailComposer(to: Streetcar.email, subject: "[Issue Report] \(kind.name) - \(onboard ? "Streetcar \(car)" : stop)",
                                     body: mailBody, photos: draft.photos) { sent in
                if sent { result = "Email sent to info@kcstreetcar.org." }
            }
            }
        }
        .sheet(isPresented: $showWeb) { SafariView(url: Streetcar.seeSayWeb).ignoresSafeArea() }
        .task {
            if draft.location == nil, let c = await Locator.shared.current() {
                draft.locationSource = "phone GPS"
                draft.location = await Locator.address(for: c)
            }
            if let loc = draft.location {
                if stop.isEmpty { stop = Streetcar.nearestStop(loc.coordinate).0 }
                if draft.place == nil { draft.place = await Place.facts(loc.coordinate, source: draft.locationSource) }
            }
            if stop.isEmpty { stop = Streetcar.stops[0].0 }
        }
    }
}

/// The system text composer, or the sms: URL when this device cannot send texts.
struct MessageComposer: UIViewControllerRepresentable {
    let recipient: String
    let body: String
    let photos: [UIImage]
    let done: (Bool) -> Void

    func makeUIViewController(context: Context) -> UIViewController {
        guard MFMessageComposeViewController.canSendText() else {
            let q = body.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
            if let url = URL(string: "sms:\(recipient)&body=\(q)") { UIApplication.shared.open(url) }
            return UIViewController()
        }
        let vc = MFMessageComposeViewController()
        vc.recipients = [recipient]
        vc.body = body
        if MFMessageComposeViewController.canSendAttachments() {
            for (i, p) in photos.enumerated() {
                if let d = p.scaled(maxSide: 1600).jpegData(compressionQuality: 0.85) {
                    vc.addAttachmentData(d, typeIdentifier: "public.jpeg", filename: "photo\(i + 1).jpg")
                }
            }
        }
        vc.messageComposeDelegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: UIViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(done) }

    final class Coordinator: NSObject, MFMessageComposeViewControllerDelegate {
        let done: (Bool) -> Void
        init(_ d: @escaping (Bool) -> Void) { done = d }
        func messageComposeViewController(_ c: MFMessageComposeViewController, didFinishWith r: MessageComposeResult) {
            done(r == .sent)
            c.dismiss(animated: true)
        }
    }
}

/// The system mail composer, or a mailto: URL when no mail account is set up.
struct MailComposer: UIViewControllerRepresentable {
    let to: String
    let subject: String
    let body: String
    let photos: [UIImage]
    let done: (Bool) -> Void

    func makeUIViewController(context: Context) -> UIViewController {
        guard MFMailComposeViewController.canSendMail() else {
            var c = URLComponents()
            c.scheme = "mailto"
            c.path = to
            c.queryItems = [.init(name: "subject", value: subject), .init(name: "body", value: body)]
            if let url = c.url { UIApplication.shared.open(url) }
            return UIViewController()
        }
        let vc = MFMailComposeViewController()
        vc.setToRecipients([to])
        vc.setSubject(subject)
        vc.setMessageBody(body, isHTML: false)
        for (i, p) in photos.enumerated() {
            if let d = p.scaled(maxSide: 2000).jpegData(compressionQuality: 0.85) {
                vc.addAttachmentData(d, mimeType: "image/jpeg", fileName: "photo\(i + 1).jpg")
            }
        }
        vc.mailComposeDelegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: UIViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(done) }

    final class Coordinator: NSObject, MFMailComposeViewControllerDelegate {
        let done: (Bool) -> Void
        init(_ d: @escaping (Bool) -> Void) { done = d }
        func mailComposeController(_ c: MFMailComposeViewController, didFinishWith r: MFMailComposeResult, error: Error?) {
            done(r == .sent)
            c.dismiss(animated: true)
        }
    }
}
