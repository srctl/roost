# Payments with Link

Connect a US Link wallet in **Settings → Payments** on the web or native iPhone
app. Open the Link sign-in page, enter the displayed code if requested, and approve
the connection. Return to Roost to finish connecting. The wallet belongs to the
Roost owner and is shared by their agents; each purchase records its requesting
agent. Your real card details remain with Link.

Ask an agent to prepare an ordinary retail purchase. It reads the checkout,
records the merchant, item and delivery details, and requests approval for the
final total including tax and shipping. Roost shows a purchase card in the web
conversation. On iPhone, use the conversation's **Payments** control or
**Settings → Payments**. Open **Review in Link** and approve or decline there.
The agent cannot approve its own request. This version uses Link's hosted approval
experience, rather than an approval button inside Roost.

After approval, the agent checks the checkout again, fills Link's one-time virtual
card, and completes that order. A changed total or merchant needs a new approval.
The agent records the merchant's order confirmation and optional receipt afterward.
An approved payment request is not proof that an order was placed. If checkout is
uncertain, check the merchant's order history before retrying.

This first version supports USD retail purchases up to $500 per request, subject
to Link's account, verification, and spending limits. It requires Roost's
[shared Linux desktop](remote-desktop-setup.md) for checkout. Link may request
additional verification; open **Continue in Link**, finish it, and refresh the
purchase status. It does not support transfers, trading, unattended spending,
merchant subscription billing, or recurring-charge authorization.

## Connection and recovery

Closing the mobile app does not stop the server's agent. The agent waits for Link
approval while releasing the shared desktop; it must inspect checkout again when
it resumes. If a run stops or the server restarts, the saved purchase remains in
Payments. Ask the agent to check the existing request before creating another.
Retries of the same unchanged request reuse its idempotency key.

Disconnect Link in Payments to cancel cancellable pending/approved requests and
revoke Roost's wallet connection. Submitted payments and completed merchant orders
cannot be undone by disconnecting. Returns and refunds go through the merchant.
You can also manage or revoke Roost's connection in Link. A revoked connection can
be removed and connected again in Roost.

## Operator notes

Roost uses `@stripe/link-sdk` and the public Link device authorization flow. No
Stripe merchant secret key is required. Native embedded approval flows and higher
limits require discussing the integration with Stripe; see the
[official integration guidance](https://github.com/stripe/link-cli#integrating-into-agents).

OAuth tokens and pending device secrets stay in the server's
`ROOST_DATA_DIR/payments/payments.sqlite` (directory mode 0700, database mode 0600).
Web/mobile APIs and tool responses only return allowlisted connection and purchase
fields. One-time card values are fetched only after verifying Link approval and
the purchase's owner, merchant, currency, and total, then passed to desktop input
through stdin. They are not saved to the database or returned as tool text.

This is the existing single-owner/shared-OS-user deployment model, not a separate
credential-isolation service. A process with the server user's filesystem access
can read its private storage, and a shared desktop screenshot can show an unmasked
one-time card field. The agent is instructed not to inspect storage or reveal
credentials. Use a dedicated, trusted Roost host and protect its backups. The
underlying real payment method is never supplied by Link to Roost.

Purchases are provider-approved and agent-attributed. Receipt references are the
agent's record of an observed merchant confirmation, not an independent settlement
or refund ledger. Link remains the source of truth for payment status.

Provider, store, and mobile/tool tests use simulated provider responses and do
not make financial transactions. A live acceptance check requires connecting the
owner's Link account and approving an actual purchase in Link.
