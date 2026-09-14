import SwiftUI

struct ThemePickerView: View {
    @Environment(\.palette) private var palette
    @AppStorage("themePreset") private var preset: ThemePreset = .default
    @AppStorage("appearance") private var appearance = "system"

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 8) {
                        CharacterView(name: "moss", size: 26)
                        Text("Moss").font(.subheadline.weight(.semibold))
                    }
                    Text("A little more you.")
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(palette.bubble, in: RoundedRectangle(cornerRadius: 18))
                    HStack {
                        Spacer()
                        Text("Feels like home.")
                            .foregroundStyle(palette.onAction)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(palette.action, in: RoundedRectangle(cornerRadius: 18))
                    }
                }
                .padding(.vertical, 12)
                .accessibilityIdentifier("themePreview")
            }
            .listRowBackground(palette.background)

            Section {
                ForEach(ThemePreset.allCases) { theme in
                    Button {
                        preset = theme
                    } label: {
                        HStack(spacing: 14) {
                            swatches(for: theme)
                            Text(theme.name).foregroundStyle(palette.foreground)
                            Spacer()
                            Image(systemName: "checkmark")
                                .font(.body.weight(.semibold))
                                .opacity(preset == theme ? 1 : 0)
                        }
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                    }
                    .accessibilityIdentifier("theme-" + theme.rawValue)
                    .accessibilityAddTraits(preset == theme ? .isSelected : [])
                    .listRowBackground(palette.surface)
                    .listRowSeparatorTint(palette.border)
                }
            } header: {
                Text("Color theme").textCase(nil)
            }

            Section {
                Picker("Appearance", selection: $appearance) {
                    Text("System").tag("system")
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("themeAppearance")
            } footer: {
                Text("Saved on this iPhone. System follows your device’s appearance.")
            }
            .listRowBackground(palette.surface)
        }
        .themedScreen()
        .textCase(nil)
        .navigationTitle("Theme")
        .navigationBarTitleDisplayMode(.inline)
        .sensoryFeedback(.selection, trigger: preset)
    }

    private func swatches(for theme: ThemePreset) -> some View {
        let colors = ThemePalette(preset: theme, scheme: palette.scheme)
        return HStack(spacing: -5) {
            ForEach(
                Array([colors.bubble, colors.accent, colors.action].enumerated()), id: \.offset
            ) {
                _, color in
                Circle()
                    .fill(color)
                    .frame(width: 22, height: 22)
                    .overlay(Circle().strokeBorder(palette.surface, lineWidth: 2))
            }
        }
        .accessibilityHidden(true)
    }
}
