import SwiftUI
import UIKit

/// Material Design 3 color roles, a tonal scheme built around fountain blue.
/// Shapes follow the MD3 scale: 12pt cards, 16pt tiles, 28pt sheets, and
/// full-pill buttons. Elevation is tonal (surface containers), with one soft
/// shadow on floating actions.
enum Theme {
    // Light and dark MD3 tones for each role. Values are (red, green, blue)
    // for light mode, then dark mode.
    static let primary = dyn((0.0, 0.36, 0.80), (0.68, 0.78, 1.0))
    static let onPrimary = dyn((1, 1, 1), (0.0, 0.18, 0.41))
    static let primaryContainer = dyn((0.85, 0.89, 1.0), (0.0, 0.27, 0.58))
    static let onPrimaryContainer = dyn((0.0, 0.11, 0.29), (0.85, 0.89, 1.0))
    static let secondaryContainer = dyn((0.86, 0.89, 0.96), (0.24, 0.28, 0.35))
    static let surface = dyn((0.98, 0.98, 1.0), (0.07, 0.07, 0.09))
    static let surfaceContainer = dyn((0.93, 0.94, 0.97), (0.11, 0.125, 0.14))
    static let surfaceContainerHigh = dyn((0.90, 0.91, 0.95), (0.16, 0.165, 0.18))
    static let onSurface = dyn((0.10, 0.11, 0.13), (0.89, 0.89, 0.91))
    static let onSurfaceVariant = dyn((0.27, 0.28, 0.32), (0.77, 0.78, 0.82))
    static let outlineVariant = dyn((0.77, 0.78, 0.82), (0.27, 0.28, 0.31))
    static let error = dyn((0.73, 0.10, 0.10), (1.0, 0.71, 0.67))
    static let errorContainer = dyn((1.0, 0.85, 0.84), (0.58, 0.0, 0.04))
    static let onError = dyn((1, 1, 1), (0.41, 0.0, 0.02))
    static let onErrorContainer = dyn((0.25, 0.0, 0.02), (1.0, 0.85, 0.84))

    // Case status colors.
    static let open = dyn((0.85, 0.50, 0.0), (1.0, 0.73, 0.36))
    static let working = primary
    static let done = dyn((0.13, 0.55, 0.30), (0.43, 0.84, 0.55))

    private static func dyn(_ light: (Double, Double, Double), _ dark: (Double, Double, Double)) -> Color {
        Color(UIColor { t in
            let c = t.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: c.0, green: c.1, blue: c.2, alpha: 1)
        })
    }

    enum Shape {
        static let card: CGFloat = 12
        static let tile: CGFloat = 16
        static let sheet: CGFloat = 28
    }
}

/// A Material Symbols Outlined glyph, drawn from the bundled variable font by
/// ligature name ("photo_camera", "location_on").
struct Icon: View {
    let name: String
    var size: CGFloat = 22

    var body: some View {
        Text(name)
            .font(.custom("Material Symbols Outlined", size: size))
            .accessibilityHidden(true)
    }
}

/// MD3 filled button: full pill, primary color.
struct FilledButton: View {
    let title: String
    var icon: String?
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon { Icon(name: icon, size: 20) }
                Text(title).font(.headline)
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .foregroundStyle(enabled ? Theme.onPrimary : Theme.onSurface.opacity(0.38))
            .background(enabled ? Theme.primary : Theme.onSurface.opacity(0.12), in: Capsule())
        }
        .disabled(!enabled)
    }
}

/// MD3 tonal button: full pill, secondary container.
struct TonalButton: View {
    let title: String
    var icon: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon { Icon(name: icon, size: 20) }
                Text(title).font(.subheadline.weight(.semibold))
            }
            .padding(.horizontal, 20)
            .frame(minHeight: 44)
            .foregroundStyle(Theme.onPrimaryContainer)
            .background(Theme.secondaryContainer, in: Capsule())
        }
    }
}

struct SectionLabel: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Theme.onSurfaceVariant)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension View {
    /// MD3 filled card: tonal surface container, 12pt corners, no stroke.
    func card(_ color: Color = Theme.surfaceContainer) -> some View {
        self.background(color, in: RoundedRectangle(cornerRadius: Theme.Shape.card, style: .continuous))
    }
}

extension Image {
    /// A Material Symbols glyph as a template image, for places that only
    /// take images (tab bar items).
    static func symbol(_ name: String, size: CGFloat = 24) -> Image {
        let font = UIFont(name: "Material Symbols Outlined", size: size) ?? .systemFont(ofSize: size)
        let text = NSAttributedString(string: name, attributes: [.font: font])
        let bounds = text.boundingRect(with: CGSize(width: 200, height: 200), options: .usesLineFragmentOrigin, context: nil)
        let img = UIGraphicsImageRenderer(size: CGSize(width: ceil(bounds.width), height: ceil(bounds.height))).image { _ in
            text.draw(at: .zero)
        }
        return Image(uiImage: img.withRenderingMode(.alwaysTemplate))
    }
}

extension View {
    /// A navigation title that wraps to two lines and shrinks a little
    /// before it truncates. City category names run long.
    func wrappingTitle(_ title: String) -> some View {
        self.navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text(title)
                        .font(.headline)
                        .lineLimit(2)
                        .minimumScaleFactor(0.75)
                        .multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)
                }
            }
            .settingsCog()
    }

    /// The settings cog in the top right. Every main screen and pushed page
    /// carries it, so settings are one tap away from anywhere in the app.
    func settingsCog() -> some View {
        toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { SettingsSheet.shared.shown = true } label: {
                    Icon(name: "settings", size: 24).foregroundStyle(Theme.onSurfaceVariant)
                }
                .accessibilityLabel("Settings")
            }
        }
    }
}

/// Whether the settings sheet is open. A shared object, so the cog on any
/// screen opens the one sheet that RootView owns.
@MainActor
final class SettingsSheet: ObservableObject {
    static let shared = SettingsSheet()
    @Published var shown = UserDefaults.standard.bool(forKey: "showSettings")
}

/// Light, dark, or the phone's setting. Saved in UserDefaults.
enum Appearance: String, CaseIterable, Identifiable {
    case auto, light, dark
    static let key = "appearance"
    var id: String { rawValue }
    var label: String {
        switch self { case .auto: "Auto"; case .light: "Light"; case .dark: "Dark" }
    }
    var style: UIUserInterfaceStyle {
        switch self { case .auto: .unspecified; case .light: .light; case .dark: .dark }
    }

    /// Sets the style on the app's windows. SwiftUI's preferredColorScheme
    /// does not always return to the phone's setting after nil, this does.
    @MainActor static func apply(_ raw: String) {
        let style = (Appearance(rawValue: raw) ?? .auto).style
        for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
            scene.windows.forEach { $0.overrideUserInterfaceStyle = style }
        }
    }
}
