import SwiftUI

struct PaymentsView: View {
    @Environment(\.palette) private var palette
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @State private var model: PaymentsModel
    @State private var confirmDisconnect = false

    init(api: RoostAPI, agentId: String? = nil) {
        _model = State(initialValue: PaymentsModel(api: api, agentId: agentId))
    }

    var body: some View {
        Form {
            if let error = model.error {
                ErrorNotice(text: error).listRowBackground(palette.surface)
            }
            if let settings = model.settings {
                wallet(settings)
                Section {
                    if model.purchases.isEmpty {
                        Text("Ask your agent to prepare a purchase. Review and approve it in Link.")
                            .font(.subheadline).foregroundStyle(palette.muted)
                    }
                    ForEach(model.purchases) { purchase in
                        purchaseRow(purchase)
                    }
                } header: {
                    Text(model.agentId == nil ? "Purchases" : "This agent’s purchases")
                        .accessibilityIdentifier("paymentPurchasesHeader")
                }
                .listRowBackground(palette.surface)
            } else if model.error == nil {
                ProgressView("Loading payments…").listRowBackground(palette.surface)
            }
        }
        .themedScreen().textCase(nil)
        .navigationTitle("Payments")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Button {
                Task { await model.refresh() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .accessibilityLabel("Refresh payments")
            .disabled(model.busy)
        }
        .refreshable { await model.refresh() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await model.refresh(pollProvider: false)
            await model.refresh()
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(10)) } catch { break }
                await model.refresh(pollProvider: model.needsProviderPolling)
            }
        }
        .confirmationDialog(
            "Disconnect Link for all agents?", isPresented: $confirmDisconnect,
            titleVisibility: .visible
        ) {
            Button("Disconnect Link", role: .destructive) {
                Task { await model.disconnect() }
            }
        } message: {
            Text(
                "This disconnects the shared wallet from this Roost server, including your other devices. It does not undo submitted payments or completed orders."
            )
        }
    }

    @ViewBuilder
    private func wallet(_ settings: PaymentSettings) -> some View {
        Section {
            LabeledContent {
                Text(settings.connected ? "Connected" : "Not connected")
                    .foregroundStyle(palette.muted)
            } label: {
                Label("Link wallet", systemImage: "creditcard")
            }
            if settings.connected {
                if let email = settings.email {
                    Text(email).textSelection(.enabled).foregroundStyle(palette.muted)
                }
                Button("Disconnect Link", role: .destructive) { confirmDisconnect = true }
                    .disabled(model.busy)
            } else if let connection = settings.connection {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    connectionContent(connection, now: context.date)
                }
                Button("Cancel connection") {
                    Task { await model.disconnect() }
                }
                .disabled(model.busy)
                .accessibilityIdentifier("cancelLinkConnection")
            } else {
                connectButton("Connect Link")
            }
        } header: {
            Text("Wallet")
        } footer: {
            Text(
                "Your wallet is shared by this server’s agents. Link handles sign-in and purchase approval in your browser."
            )
        }
        .listRowBackground(palette.surface)
    }

    @ViewBuilder
    private func connectionContent(_ connection: PaymentConnection, now: Date) -> some View {
        if connection.isExpired(now: now) {
            VStack(alignment: .leading, spacing: 12) {
                Text("This sign-in request expired. Connect again to get a new code.")
                    .font(.subheadline).foregroundStyle(palette.muted)
                connectButton("Connect Link again")
            }
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Text("Finish connecting in Link")
                    .font(.headline)
                Text(connection.userCode)
                    .font(.title2.monospaced().weight(.semibold))
                    .textSelection(.enabled)
                    .accessibilityLabel("Link sign-in code: \(connection.userCode)")
                Text("Use this code if Link asks for it. Return here after signing in.")
                    .font(.subheadline).foregroundStyle(palette.muted)
                Text(
                    "Expires \(Date(milliseconds: connection.expiresAt).formatted(date: .omitted, time: .shortened))"
                )
                .font(.caption).foregroundStyle(palette.muted)
                if let url = linkPaymentURL(connection.verificationUrl) {
                    Button("Continue in Link") { openURL(url) }
                } else {
                    Text("This sign-in address cannot be opened. Connect again to retry.")
                        .font(.footnote).foregroundStyle(palette.muted)
                    connectButton("Connect Link again")
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func connectButton(_ title: String) -> some View {
        Button {
            Task {
                if let url = await model.connect() { openURL(url) }
            }
        } label: {
            HStack {
                Text(title)
                if model.working { ProgressView() }
            }
        }
        .disabled(model.busy)
        .accessibilityIdentifier("connectLink")
    }

    private func purchaseRow(_ purchase: PaymentPurchase) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(purchase.merchantName).font(.headline)
                Spacer(minLength: 12)
                Text(purchase.total).font(.headline).multilineTextAlignment(.trailing)
            }
            Text(purchase.description).font(.subheadline)
            if let merchant = workspaceURL(purchase.merchantUrl) {
                Text(merchant.host ?? purchase.merchantName)
                    .font(.caption).foregroundStyle(palette.muted)
            }
            Text(purchase.statusLabel)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(purchase.needsLinkAction ? palette.review : palette.muted)
            if let error = purchase.error {
                Text(error).font(.footnote).foregroundStyle(palette.muted)
            }
            if purchase.needsLinkAction {
                if let url = linkPaymentURL(purchase.approvalUrl) {
                    Button(purchase.awaitingApproval ? "Review in Link" : "Continue in Link") {
                        openURL(url)
                    }
                    .accessibilityIdentifier("reviewPurchase-" + purchase.id)
                } else {
                    Text("Refresh to check for a Link approval link.")
                        .font(.footnote).foregroundStyle(palette.muted)
                }
            }
            if let reference = purchase.orderReference {
                Text("Order \(reference)")
                    .font(.footnote).textSelection(.enabled).foregroundStyle(palette.muted)
            }
            if let value = purchase.receiptUrl, let url = workspaceURL(value), url.scheme == "https"
            {
                Button("View receipt") { openURL(url) }
            }
            Text(
                Date(milliseconds: purchase.createdAt),
                format: .dateTime.month().day().hour().minute()
            )
            .font(.caption).foregroundStyle(palette.muted)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .contain)
    }
}
