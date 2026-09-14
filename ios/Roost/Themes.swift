import SwiftUI

enum ThemePreset: String, CaseIterable, Identifiable {
    case `default`
    case rosePine = "rose-pine"
    case carbonfox
    case catppuccin

    var id: String { rawValue }

    var name: String {
        switch self {
        case .default: "Default"
        case .rosePine: "Rosé Pine"
        case .carbonfox: "Carbonfox"
        case .catppuccin: "Catppuccin"
        }
    }
}

struct ThemePalette {
    static let catalog: [String: [String: [String: String]]] = {
        guard let url = Bundle.main.url(forResource: "Themes", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let themes = try? JSONDecoder()
                .decode(
                    [String: [String: [String: String]]].self, from: data)
        else { preconditionFailure("The generated theme resource is missing or invalid") }
        return themes
    }()

    let preset: ThemePreset
    let scheme: ColorScheme

    var background: Color { color("background") }
    var sidebar: Color { color("sidebar") }
    var surface: Color { color("surface") }
    var selected: Color { color("selected") }
    var bubble: Color { color("bubble") }
    var foreground: Color { color("foreground") }
    var muted: Color { color("muted") }
    var faint: Color { color("faint") }
    var border: Color { color("border") }
    var accent: Color { color("accent") }
    var onAction: Color { color("onAccent") }
    var action: Color { color("action") }
    var review: Color { color("review") }

    private func color(_ token: String) -> Color {
        let value = Self.catalog[preset.rawValue]![scheme == .dark ? "dark" : "light"]![token]!
        let hex = UInt32(value.dropFirst(), radix: 16)!
        return Color(
            .sRGB,
            red: Double((hex >> 16) & 255) / 255,
            green: Double((hex >> 8) & 255) / 255,
            blue: Double(hex & 255) / 255,
            opacity: 1
        )
    }
}

private struct PaletteKey: EnvironmentKey {
    static let defaultValue = ThemePalette(preset: .default, scheme: .light)
}

extension EnvironmentValues {
    var palette: ThemePalette {
        get { self[PaletteKey.self] }
        set { self[PaletteKey.self] = newValue }
    }
}

struct ThemeRoot<Content: View>: View {
    @AppStorage("themePreset") private var preset: ThemePreset = .default
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ViewBuilder let content: Content

    private var reduced: Bool {
        #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-ui-testing-reduce-motion") {
                return true
            }
        #endif
        return reduceMotion
    }

    var body: some View {
        let palette = ThemePalette(preset: preset, scheme: scheme)
        content
            .environment(\.palette, palette)
            .environment(\.roostReduceMotion, reduced)
            .tint(palette.accent)
            .foregroundStyle(palette.foreground)
            .background(palette.background.ignoresSafeArea())
            .animation(reduced ? nil : .easeInOut(duration: 0.22), value: preset)
    }
}

private struct ThemeScreen: ViewModifier {
    @Environment(\.palette) private var palette

    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .background(palette.background)
            .environment(\.colorScheme, palette.scheme)
            .toolbarColorScheme(palette.scheme, for: .navigationBar)
            .toolbarBackground(palette.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }
}

extension View {
    func themedScreen() -> some View { modifier(ThemeScreen()) }
}
