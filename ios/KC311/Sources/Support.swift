import CoreLocation
import MapKit
import SafariServices
import SwiftUI
import UIKit

/// Camera capture through UIImagePickerController.
struct CameraPicker: UIViewControllerRepresentable {
    let onPick: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        p.delegate = context.coordinator
        return p
    }

    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ p: CameraPicker) { parent = p }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let img = info[.originalImage] as? UIImage { parent.onPick(img) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}

struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

/// One-shot location and reverse geocoding.
@MainActor
final class Locator: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let shared = Locator()
    static let downtown = CLLocationCoordinate2D(latitude: 39.0997, longitude: -94.5786)

    @Published var last: CLLocationCoordinate2D?
    @Published var denied = false
    private let manager = CLLocationManager()
    private var waiters: [CheckedContinuation<CLLocationCoordinate2D?, Never>] = []

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    /// The current spot only when permission is already granted; never prompts.
    func currentIfAllowed() async -> CLLocationCoordinate2D? {
        guard [.authorizedWhenInUse, .authorizedAlways].contains(manager.authorizationStatus) else { return nil }
        return await current()
    }

    func current() async -> CLLocationCoordinate2D? {
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
        if [.denied, .restricted].contains(manager.authorizationStatus) { denied = true; return nil }
        return await withCheckedContinuation { c in
            waiters.append(c)
            manager.requestLocation()
        }
    }

    nonisolated func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        let c = locs.last?.coordinate
        Task { @MainActor in self.finish(c) }
    }

    nonisolated func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.finish(nil) }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        let s = m.authorizationStatus
        Task { @MainActor in
            self.denied = [.denied, .restricted].contains(s)
            if self.denied { self.finish(nil) } else if !self.waiters.isEmpty { m.requestLocation() }
        }
    }

    private func finish(_ c: CLLocationCoordinate2D?) {
        if let c { last = c }
        let w = waiters
        waiters = []
        w.forEach { $0.resume(returning: c) }
    }

    static func address(for c: CLLocationCoordinate2D) async -> PickedLocation {
        let marks = try? await CLGeocoder().reverseGeocodeLocation(CLLocation(latitude: c.latitude, longitude: c.longitude))
        guard let p = marks?.first else {
            return PickedLocation(coordinate: c, street: String(format: "%.5f, %.5f", c.latitude, c.longitude))
        }
        // Apple gives ranges ("1200–1252 Oak St"); the city matches duplicates on
        // one house number, so keep the first.
        let number = p.subThoroughfare?.components(separatedBy: CharacterSet(charactersIn: "–-")).first
        let street = [number, p.thoroughfare].compactMap { $0 }.joined(separator: " ")
        return PickedLocation(coordinate: c, street: street.isEmpty ? (p.name ?? "Pinned location") : street.uspsAbbreviated,
                              city: p.locality ?? "Kansas City", state: p.administrativeArea ?? "MO", zip: p.postalCode ?? "")
    }
}

extension String {
    /// The city matches duplicate reports on USPS-style addresses ("E Truman Rd").
    var uspsAbbreviated: String {
        let abbr = ["North": "N", "South": "S", "East": "E", "West": "W", "Street": "St", "Road": "Rd",
                    "Avenue": "Ave", "Boulevard": "Blvd", "Drive": "Dr", "Parkway": "Pkwy", "Terrace": "Ter",
                    "Place": "Pl", "Lane": "Ln", "Court": "Ct", "Trafficway": "Trfy", "Highway": "Hwy"]
        return split(separator: " ").map { abbr[String($0)] ?? String($0) }.joined(separator: " ")
    }
}

/// Status chip and the four-step track (Sent, Received, In progress, Done).
struct StatusTrack: View {
    let status: String
    var timeline: [TimelineEntry] = []

    var body: some View {
        let stage = StatusStage(status, timeline: timeline)
        let steps = StatusStage.allCases
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                ForEach(steps.indices, id: \.self) { i in
                    Capsule()
                        .fill(i <= stage.rawValue ? color(stage) : Theme.outlineVariant)
                        .frame(height: 6)
                }
            }
            HStack {
                ForEach(steps.indices, id: \.self) { i in
                    Text(steps[i].label)
                        .font(.caption.weight(i == stage.rawValue ? .semibold : .regular))
                        .foregroundStyle(i == stage.rawValue ? Theme.onSurface : Theme.onSurfaceVariant)
                        .lineLimit(1).minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity, alignment: i == 0 ? .leading : i == steps.count - 1 ? .trailing : .center)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Status: \(stage.label)")
    }

    func color(_ s: StatusStage) -> Color {
        switch s { case .sent, .received: Theme.open; case .working: Theme.working; case .done: Theme.done }
    }
}

struct StatusChip: View {
    let status: String
    var body: some View {
        let stage = StatusStage(status)
        let color: Color = switch stage { case .sent, .received: Theme.open; case .working: Theme.working; case .done: Theme.done }
        Text(status.isEmpty ? "Received" : status.capitalized)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .foregroundStyle(color)
            .background(color.opacity(0.14), in: Capsule())
    }
}

/// Empty, loading, and error states share one layout.
struct StateMessage: View {
    let icon: String
    let title: String
    var message: String = ""
    var action: (title: String, run: () -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Icon(name: icon, size: 44).foregroundStyle(Theme.onSurfaceVariant)
            Text(title).font(.headline).foregroundStyle(Theme.onSurface)
            if !message.isEmpty {
                Text(message).font(.subheadline).foregroundStyle(Theme.onSurfaceVariant).multilineTextAlignment(.center)
            }
            if let action { TonalButton(title: action.title, icon: "refresh", action: action.run).padding(.top, 4) }
        }
        .padding(32)
        .frame(maxWidth: .infinity)
    }
}

extension Date {
    var short: String { formatted(.dateTime.month(.abbreviated).day().hour().minute()) }
    var relative: String { formatted(.relative(presentation: .named)) }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}
