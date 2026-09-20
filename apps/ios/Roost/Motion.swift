import SwiftUI

private struct ReducedMotionKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    // ThemeRoot resolves the live system setting here. Debug UI tests can
    // exercise the same fallback without changing the device's accessibility settings.
    var roostReduceMotion: Bool {
        get { self[ReducedMotionKey.self] }
        set { self[ReducedMotionKey.self] = newValue }
    }
}

enum RoostMotion {
    static let send = Animation.spring(duration: 0.52, bounce: 0.12)
    static let settle = Animation.spring(duration: 0.32, bounce: 0.06)
    static let press = Animation.spring(duration: 0.2, bounce: 0.12)
}

struct PressFeedback: ButtonStyle {
    @Environment(\.roostReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.92 : 1)
            .opacity(configuration.isPressed ? 0.72 : 1)
            .animation(reduceMotion ? nil : RoostMotion.press, value: configuration.isPressed)
    }
}

struct MessageFlight: Identifiable {
    let message: Message
    let origin: CGRect
    var destination: CGRect?
    var id: String { message.id }
}

// This overlay sits above both the scroll view and composer. Measuring both ends
// avoids guessed offsets and lets a multiline bubble travel across the safe-area
// boundary without being clipped by the conversation's viewport.
struct FlyingMessage: View {
    let flight: MessageFlight
    let destination: CGRect
    let container: CGRect
    let agent: Agent
    let style: ResponseStyle
    let api: RoostAPI
    let completion: () -> Void
    @State private var landed = false

    var body: some View {
        MessageView(
            message: flight.message, agent: agent, style: style, canReply: false,
            reply: {}, file: { _ in }, api: api
        )
        .frame(width: destination.width)
        .fixedSize(horizontal: false, vertical: true)
        .scaleEffect(landed ? 1 : 0.82, anchor: .bottomTrailing)
        .opacity(landed ? 1 : 0.35)
        .position(
            x: (landed ? destination.midX : flight.origin.midX) - container.minX,
            y: (landed ? destination.midY : flight.origin.maxY - destination.height / 2)
                - container.minY
        )
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear {
            withAnimation(RoostMotion.send, completionCriteria: .removed) {
                landed = true
            } completion: {
                completion()
            }
        }
    }
}

struct MessageEntrance: ViewModifier {
    let animated: Bool
    @Environment(\.roostReduceMotion) private var reduceMotion
    @State private var appeared = false

    func body(content: Content) -> some View {
        content
            .opacity(animated && !appeared ? 0 : 1)
            .offset(y: animated && !appeared && !reduceMotion ? 12 : 0)
            .onAppear {
                withAnimation(reduceMotion ? .easeOut(duration: 0.12) : RoostMotion.settle) {
                    appeared = true
                }
            }
    }
}
