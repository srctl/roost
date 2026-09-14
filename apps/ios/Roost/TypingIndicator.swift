import SwiftUI

struct TypingIndicator: View {
    @Environment(\.palette) private var palette

    let name: String
    let queued: Bool

    @Environment(\.roostReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var startedAt = Date()

    var body: some View {
        TimelineView(
            .animation(minimumInterval: 1.0 / 30, paused: reduceMotion || scenePhase != .active)
        ) { timeline in
            HStack(spacing: 4) {
                ForEach(0..<3) { index in
                    let pulse = reduceMotion ? 0 : pulse(at: timeline.date, dot: index)

                    Circle()
                        .fill(palette.muted)
                        .frame(width: 6, height: 6)
                        .opacity(reduceMotion ? 1 : 0.4 + 0.6 * pulse)
                        .offset(y: -3 * pulse)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 15)
            .background(
                palette.bubble,
                in: UnevenRoundedRectangle(
                    topLeadingRadius: 18,
                    bottomLeadingRadius: 5,
                    bottomTrailingRadius: 18,
                    topTrailingRadius: 18
                )
            )
        }
        .padding(.top, 8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(queued ? "Message queued for \(name)" : "\(name) is replying")
        .accessibilityIdentifier("typingIndicator")
    }

    private func pulse(at date: Date, dot: Int) -> Double {
        // Match the web indicator: a 1.2-second pulse, staggered by 150 ms,
        // lifting each dot at 30% and resting from 60% to the next cycle.
        let elapsed = date.timeIntervalSince(startedAt) - Double(dot) * 0.15
        guard elapsed >= 0 else { return 0 }

        let phase = elapsed.truncatingRemainder(dividingBy: 1.2) / 1.2
        guard phase < 0.6 else { return 0 }

        return (1 - cos(phase / 0.6 * 2 * .pi)) / 2
    }
}
