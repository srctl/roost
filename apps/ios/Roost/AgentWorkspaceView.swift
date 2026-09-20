import SwiftUI
import UIKit

struct AgentWorkspaceView: View {
    @Environment(\.palette) private var palette
    let app: AppModel
    let model: ConversationModel
    let close: () -> Void
    @State private var section = "chat"
    @State private var keyboardVisible = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Namespace private var selection

    var body: some View {
        VStack(spacing: 0) {
            TabView(selection: $section) {
                WorkspaceTab(back: close) {
                    ConversationView(app: app, model: model)
                }
                .tabItem { Label("Chat", systemImage: "bubble.left.and.bubble.right") }
                .tag("chat")
                WorkspaceTab(back: close) {
                    DashboardView(agent: model.agent, api: model.api) { prompt in
                        if model.draft.isEmpty {
                            model.draft = prompt
                            model.persistDraft()
                        }
                        section = "chat"
                    }
                }
                .tabItem { Label("Dashboard", systemImage: "chart.xyaxis.line") }
                .tag("dashboard")
                if model.agent.kind == "coding" {
                    WorkspaceTab(back: close) {
                        CodingJobsView(app: app, agent: model.agent, api: model.api) {
                            section = "chat"
                        }
                    }
                    .tabItem {
                        Label("Coding", systemImage: "chevron.left.forwardslash.chevron.right")
                    }
                    .tag("coding")
                }
                WorkspaceTab(back: close) {
                    NotesView(agent: model.agent, api: model.api)
                }
                .tabItem { Label("Notes", systemImage: "note.text") }
                .tag("notes")
                WorkspaceTab(back: close) {
                    WorkspaceMoreView(agent: model.agent, api: model.api)
                }
                .tabItem { Label("More", systemImage: "ellipsis") }
                .tag("more")
            }
            .toolbar(.hidden, for: .tabBar)
            .layoutPriority(1)
            if !keyboardVisible {
                HStack(spacing: 4) {
                    navigationButton("chat", "Chat", "bubble.left.and.bubble.right")
                    navigationButton("dashboard", "Dashboard", "chart.xyaxis.line")
                    if model.agent.kind == "coding" {
                        navigationButton(
                            "coding", "Coding", "chevron.left.forwardslash.chevron.right")
                    }
                    navigationButton("notes", "Notes", "note.text")
                    navigationButton("more", "More", "ellipsis")
                }
                .padding(5)
                .background {
                    if reduceTransparency {
                        Capsule().fill(palette.surface)
                    } else {
                        Capsule().fill(.ultraThinMaterial)
                    }
                }
                .overlay { Capsule().strokeBorder(.white.opacity(0.24), lineWidth: 0.5) }
                .shadow(color: .black.opacity(0.08), radius: 14, y: 5)
                .padding(.horizontal, 28)
                .padding(.top, 6)
                .padding(.bottom, 6)
            }
        }
        .background(palette.background)
        .onReceive(
            NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)
        ) { _ in
            keyboardVisible = true
        }
        .onReceive(
            NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)
        ) { _ in
            keyboardVisible = false
        }
    }

    private func navigationButton(_ id: String, _ title: String, _ icon: String) -> some View {
        Button {
            withAnimation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.85)) {
                section = id
            }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 17, weight: .medium))
                Text(title).font(.system(size: 10, weight: .medium))
            }
            .foregroundStyle(section == id ? palette.accent : palette.muted)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background {
                if section == id {
                    Capsule().fill(palette.accent.opacity(0.11))
                        .matchedGeometryEffect(id: "selected-tab", in: selection)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityIdentifier("workspace-" + id)
        .accessibilityAddTraits(section == id ? .isSelected : [])
    }
}

// Each tab owns its navigation history. Keeping a stack inside the tab also
// lets native toolbar/title preferences reach the correct navigation bar.
private struct WorkspaceTab<Content: View>: View {
    let back: () -> Void
    @ViewBuilder let content: Content
    var body: some View {
        NavigationStack {
            content
                .toolbar(.visible, for: .navigationBar)
                .toolbar(.hidden, for: .tabBar)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button(action: back) { Label("Roost", systemImage: "chevron.left") }
                            .accessibilityLabel("Roost")
                    }
                }
        }
    }
}
