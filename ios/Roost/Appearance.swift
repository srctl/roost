import SwiftUI

enum ResponseStyle: String, CaseIterable {
    case messages
    case codex
}

struct CharacterView: View {
    let name: String
    var size: CGFloat = 44

    struct Pixel: Decodable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double
        let fill: String
    }
    static let characters: [String: [Pixel]] = {
        guard let url = Bundle.main.url(forResource: "Characters", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let result = try? JSONDecoder().decode([String: [Pixel]].self, from: data)
        else { return [:] }
        return result
    }()

    var body: some View {
        Canvas { context, size in
            for pixel in Self.characters[name] ?? Self.characters["moss"] ?? [] {
                let hex = UInt32(pixel.fill.dropFirst(), radix: 16) ?? 0
                let color = Color(
                    red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255,
                    blue: Double(hex & 255) / 255)
                context.fill(
                    Path(
                        CGRect(
                            x: pixel.x * size.width / 16, y: pixel.y * size.height / 16,
                            width: pixel.width * size.width / 16,
                            height: pixel.height * size.height / 16)), with: .color(color))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

struct ErrorNotice: View {
    @Environment(\.palette) private var palette

    let text: String

    var body: some View {
        Label(text, systemImage: "exclamationmark.circle")
            .font(.footnote)
            .foregroundStyle(palette.muted)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.surface)
            .accessibilityIdentifier("errorNotice")
    }
}
