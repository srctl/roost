import SwiftUI

struct WorkspaceMoreView: View {
    @Environment(\.palette) private var palette
    let agent: Agent
    let api: RoostAPI
    var body: some View {
        List {
            Section {
                NavigationLink {
                    AutomationsView(api: api, agent: agent)
                } label: {
                    Label("Automations", systemImage: "clock.arrow.circlepath")
                }
                .accessibilityIdentifier("openAutomations")
                NavigationLink {
                    ComputerView(api: api)
                } label: {
                    Label("Computer", systemImage: "desktopcomputer")
                }
                .accessibilityIdentifier("openComputer")
                NavigationLink {
                    PaymentsView(api: api, agentId: agent.id)
                } label: {
                    Label("Purchases", systemImage: "creditcard")
                }
                .accessibilityIdentifier("openPurchases")
            }
            .listRowBackground(palette.surface)
            Section("Agent") {
                NavigationLink {
                    AgentIdentityView(agent: agent, api: api)
                } label: {
                    Label("Identity & memory", systemImage: "person.text.rectangle")
                }
                .accessibilityIdentifier("openAgentIdentity")
                if agent.kind == "coding" {
                    NavigationLink {
                        AgentCodingSettingsView(agent: agent, api: api)
                    } label: {
                        Label("Coding settings", systemImage: "terminal")
                    }
                    .accessibilityIdentifier("openCodingSettings")
                }
            }
            .listRowBackground(palette.surface)
        }
        .themedScreen()
        .navigationTitle(agent.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}
