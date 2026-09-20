import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import {
  isLinkUrl,
  type PaymentPurchase,
  type PaymentSettings,
  PurchaseInput,
} from "../../features/payments/schema";
import {
  LinkProviderError,
  type LinkSpend,
  type LinkTokens,
  linkProvider,
  type PendingLinkConnection,
} from "./provider.server";

export class PaymentError extends Error {}
type Connection = {
  id: string;
  tokens?: LinkTokens;
  pending?: PendingLinkConnection;
  email?: string;
};
type PurchaseRow = {
  id: string;
  agentId: string;
  runId: string;
  connectionId: string;
  providerId: string | null;
  input: string;
  value: string;
};
type Provider = typeof linkProvider;
const queues = new Map<string, Promise<unknown>>();

// All requests in this server share a queue, including mobile, web, and tools.
// Persist requests before contacting Link; its idempotency key also protects
// against retries after a process restart or an ambiguous network response.
export class PaymentStore {
  constructor(
    readonly directory = resolve(process.env.ROOST_DATA_DIR ?? ".roost"),
    readonly provider: Provider = linkProvider,
  ) {}

  private db<A>(action: (db: DatabaseSync) => A): A {
    const folder = join(this.directory, "payments");
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    chmodSync(folder, 0o700);
    const path = join(folder, "payments.sqlite");
    const db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    try {
      db.exec(`PRAGMA busy_timeout=5000;
        PRAGMA secure_delete=ON;
        CREATE TABLE IF NOT EXISTS connection (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS purchases (
          id TEXT PRIMARY KEY, agentId TEXT NOT NULL, runId TEXT NOT NULL,
          connectionId TEXT NOT NULL, providerId TEXT, input TEXT NOT NULL, value TEXT NOT NULL
        );`);
      return action(db);
    } finally {
      db.close();
    }
  }

  private async locked<A>(action: () => Promise<A>): Promise<A> {
    const previous = queues.get(this.directory) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(action);
    queues.set(this.directory, task);
    try {
      return await task;
    } catch (error) {
      if (
        error instanceof LinkProviderError &&
        error.code === "sign_in_required"
      )
        this.db((db) => db.prepare("DELETE FROM connection").run());
      throw error;
    } finally {
      if (queues.get(this.directory) === task) queues.delete(this.directory);
    }
  }

  private connection(): Connection | undefined {
    return this.db((db) => {
      const row = db.prepare("SELECT value FROM connection WHERE id=1").get();
      return row ? (JSON.parse(String(row.value)) as Connection) : undefined;
    });
  }

  private saveConnection(value: Connection) {
    this.db((db) =>
      db
        .prepare(
          "INSERT INTO connection VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        )
        .run(JSON.stringify(value)),
    );
  }

  private async authenticated() {
    const connection = this.connection();
    if (!connection?.tokens)
      throw new PaymentError("Connect Link in Settings → Payments first.");
    if (connection.tokens.expiresAt <= Date.now() + 60_000) {
      connection.tokens = await this.provider.refreshToken(connection.tokens);
      this.saveConnection(connection);
    }
    return { ...connection, tokens: connection.tokens };
  }

  private rows(agentId?: string): PurchaseRow[] {
    return this.db(
      (db) =>
        (agentId
          ? db
              .prepare(
                "SELECT * FROM purchases WHERE agentId=? ORDER BY rowid DESC LIMIT 100",
              )
              .all(agentId)
          : db
              .prepare("SELECT * FROM purchases ORDER BY rowid DESC LIMIT 100")
              .all()) as PurchaseRow[],
    );
  }

  private row(agentId: string, id: string): PurchaseRow {
    const row = this.db((db) =>
      db
        .prepare("SELECT * FROM purchases WHERE id=? AND agentId=?")
        .get(id, agentId),
    ) as PurchaseRow | undefined;
    if (!row) throw new PaymentError("Purchase not found for this agent.");
    return row;
  }

  private savePurchase(
    row: PurchaseRow,
    value: PaymentPurchase,
    providerId = row.providerId,
  ) {
    this.db((db) =>
      db
        .prepare(
          "UPDATE purchases SET value=?,providerId=? WHERE id=? AND agentId=?",
        )
        .run(JSON.stringify(value), providerId, row.id, row.agentId),
    );
    return value;
  }

  read(agentId?: string): PaymentSettings {
    const connection = this.connection();
    const pending = connection?.pending;
    return {
      connected: Boolean(connection?.tokens),
      ...(connection?.email ? { email: connection.email } : {}),
      ...(pending
        ? {
            connection: {
              verificationUrl: pending.verificationUrl,
              userCode: pending.userCode,
              expiresAt: pending.expiresAt,
            },
          }
        : {}),
      purchases: this.rows(agentId).map(
        (row) => JSON.parse(row.value) as PaymentPurchase,
      ),
    };
  }

  connect() {
    return this.locked(async () => {
      const existing = this.connection();
      if (existing?.tokens) {
        try {
          const auth = await this.authenticated();
          await this.provider.wallet(auth.tokens);
          return this.read();
        } catch (error) {
          if (
            !(error instanceof LinkProviderError) ||
            error.code !== "sign_in_required"
          )
            throw error;
          this.db((db) => db.prepare("DELETE FROM connection").run());
        }
      }
      if (existing?.pending && existing.pending.expiresAt > Date.now())
        return this.read();
      const pending = await this.provider.beginConnection();
      if (!isLinkUrl(pending.verificationUrl))
        throw new PaymentError(
          "Link returned an unsupported connection address.",
        );
      this.saveConnection({ id: randomUUID(), pending });
      return this.read();
    });
  }

  refresh(agentId?: string) {
    return this.locked(async () => {
      const connection = this.connection();
      if (connection?.pending && connection.pending.expiresAt > Date.now()) {
        const result = await this.provider.pollConnection(connection.pending);
        if (result.status === "connected") {
          // Save immediately: a wallet lookup failure must not lose OAuth tokens.
          delete connection.pending;
          connection.tokens = result.tokens;
          this.saveConnection(connection);
          const wallet = await this.provider.wallet(result.tokens);
          connection.email = wallet.email ?? undefined;
          this.saveConnection(connection);
        } else {
          connection.pending = result.pending;
          this.saveConnection(connection);
        }
      }
      if (this.connection()?.tokens) {
        const auth = await this.authenticated();
        for (const row of this.rows(agentId)) {
          const value = JSON.parse(row.value) as PaymentPurchase;
          if (
            row.connectionId !== auth.id ||
            !row.providerId ||
            terminal(value.status)
          )
            continue;
          const spend = await this.provider.retrieveSpend(
            auth.tokens,
            row.providerId,
          );
          this.update(row, spend);
        }
      }
      return this.read(agentId);
    });
  }

  disconnect() {
    return this.locked(async () => {
      try {
        if (this.connection()?.tokens) {
          const auth = await this.authenticated();
          for (const row of this.rows()) {
            const value = JSON.parse(row.value) as PaymentPurchase;
            if (
              row.connectionId !== auth.id ||
              !row.providerId ||
              terminal(value.status)
            )
              continue;
            const current = this.update(
              row,
              await this.provider.retrieveSpend(auth.tokens, row.providerId),
            );
            if (["awaiting_approval", "approved"].includes(current.status))
              this.update(
                row,
                await this.provider.cancelSpend(auth.tokens, row.providerId),
              );
          }
          await this.provider.revoke(auth.tokens);
        }
      } catch (error) {
        if (
          !(error instanceof LinkProviderError) ||
          error.code !== "sign_in_required"
        )
          throw error;
        // Already revoked/expired connections must still be removable locally.
      }
      this.db((db) => db.prepare("DELETE FROM connection").run());
      return this.read();
    });
  }

  request(agentId: string, runId: string, raw: PurchaseInput) {
    return this.locked(async () => {
      const input = Schema.decodeUnknownSync(PurchaseInput)(raw);
      merchantUrl(input.merchantUrl);
      const auth = await this.authenticated();
      let row = this.db((db) =>
        db.prepare("SELECT * FROM purchases WHERE id=?").get(input.requestId),
      ) as PurchaseRow | undefined;
      if (row) {
        if (
          row.agentId !== agentId ||
          row.connectionId !== auth.id ||
          row.input !== JSON.stringify(input)
        )
          throw new PaymentError(
            "This request ID belongs to a different purchase. Reuse IDs only for unchanged purchases.",
          );
        if (row.providerId) return JSON.parse(row.value) as PaymentPurchase;
      } else {
        const now = Date.now();
        const value: PaymentPurchase = {
          id: input.requestId,
          agentId,
          merchantName: input.merchantName,
          merchantUrl: input.merchantUrl,
          description: input.description,
          amount: input.amount,
          currency: input.currency,
          status: "creating",
          createdAt: now,
          updatedAt: now,
        };
        row = {
          id: input.requestId,
          agentId,
          runId,
          connectionId: auth.id,
          providerId: null,
          input: JSON.stringify(input),
          value: JSON.stringify(value),
        };
        this.db((db) =>
          db
            .prepare("INSERT INTO purchases VALUES (?,?,?,?,?,?,?)")
            .run(
              row!.id,
              agentId,
              runId,
              auth.id,
              null,
              row!.input,
              row!.value,
            ),
        );
      }
      // No automatic new request on failure. Retry the same key and exact body.
      const spend = await this.provider.createSpend(
        auth.tokens,
        {
          merchantName: input.merchantName,
          merchantUrl: input.merchantUrl,
          amount: input.amount,
          currency: input.currency,
          context: `Roost is requesting approval for this specific purchase on behalf of its owner. Merchant: ${input.merchantName}. Final total including tax and shipping: ${input.amount} ${input.currency} minor units. Purchase and delivery details: ${input.description}`,
        },
        `roost_${input.requestId}`,
      );
      return this.update(row, spend);
    });
  }

  private update(row: PurchaseRow, spend: LinkSpend) {
    const value = JSON.parse(row.value) as PaymentPurchase;
    if (row.providerId && row.providerId !== spend.id)
      throw new PaymentError(
        "Link returned a different purchase. Check the existing request before retrying.",
      );
    if (
      (spend.amount !== null && spend.amount !== value.amount) ||
      (spend.currency !== null &&
        spend.currency.toLowerCase() !== value.currency) ||
      (spend.merchantUrl !== null &&
        new URL(spend.merchantUrl).origin !== new URL(value.merchantUrl).origin)
    )
      throw new PaymentError(
        "Link purchase details changed. Create a new approval for the exact checkout.",
      );
    const status = spend.status === "cancelled" ? "canceled" : spend.status;
    const approvalUrl = spend.actionUrl ?? spend.approvalUrl;
    if (approvalUrl && !isLinkUrl(approvalUrl))
      throw new PaymentError("Link returned an unsupported approval address.");
    return this.savePurchase(
      row,
      {
        ...value,
        status,
        approvalUrl: !terminal(status) && approvalUrl ? approvalUrl : undefined,
        updatedAt: Date.now(),
      },
      spend.id,
    );
  }

  inspect(agentId: string, id: string) {
    return this.locked(async () => {
      const row = this.row(agentId, id);
      const value = JSON.parse(row.value) as PaymentPurchase;
      if (!row.providerId || terminal(value.status)) return value;
      const auth = await this.authenticated();
      if (row.connectionId !== auth.id)
        throw new PaymentError(
          "This purchase belongs to a previous Link connection.",
        );
      return this.update(
        row,
        await this.provider.retrieveSpend(auth.tokens, row.providerId),
      );
    });
  }

  cancel(agentId: string, id: string) {
    return this.locked(async () => {
      const row = this.row(agentId, id);
      const value = JSON.parse(row.value) as PaymentPurchase;
      if (terminal(value.status)) return value;
      const auth = await this.authenticated();
      if (row.connectionId !== auth.id || !row.providerId)
        throw new PaymentError(
          "This purchase is not available. Check Link before creating another request.",
        );
      const current = this.update(
        row,
        await this.provider.retrieveSpend(auth.tokens, row.providerId),
      );
      if (terminal(current.status)) return current;
      if (!["awaiting_approval", "approved"].includes(current.status))
        throw new PaymentError(
          "This purchase cannot be canceled here. Check its status in Link and with the merchant.",
        );
      return this.update(
        row,
        await this.provider.cancelSpend(auth.tokens, row.providerId),
      );
    });
  }

  // The consumer must inject the secret directly into checkout; never return it
  // from a tool, web/mobile route, error, or transcript. Nothing stores the card.
  withCard<A>(
    agentId: string,
    id: string,
    consume: (card: Awaited<ReturnType<Provider["card"]>>) => Promise<A>,
  ) {
    return this.locked(async () => {
      const row = this.row(agentId, id);
      const auth = await this.authenticated();
      if (row.connectionId !== auth.id || !row.providerId)
        throw new PaymentError("This purchase is not available.");
      if (terminal((JSON.parse(row.value) as PaymentPurchase).status))
        throw new PaymentError("This purchase is already closed.");
      const spend = await this.provider.retrieveSpend(
        auth.tokens,
        row.providerId,
      );
      const value = this.update(row, spend);
      if (value.status !== "approved")
        throw new PaymentError(
          "Approve this purchase in Link before filling checkout.",
        );
      if (
        spend.amount !== value.amount ||
        spend.currency?.toLowerCase() !== value.currency ||
        !spend.merchantUrl
      )
        throw new PaymentError(
          "Link did not confirm the approved merchant and total.",
        );
      const card = await this.provider.card(auth.tokens, row.providerId);
      if (card.validUntil && Date.parse(card.validUntil) <= Date.now())
        throw new PaymentError(
          "This payment credential expired. Request a new approval.",
        );
      return consume(card);
    });
  }

  record(
    agentId: string,
    id: string,
    orderReference: string,
    receiptUrl?: string,
  ) {
    return this.locked(async () => {
      const row = this.row(agentId, id);
      const value = JSON.parse(row.value) as PaymentPurchase;
      if (!["approved", "processing", "completed"].includes(value.status))
        throw new PaymentError(
          "Only an approved purchase can have an order confirmation.",
        );
      if (receiptUrl) merchantUrl(receiptUrl);
      return this.savePurchase(row, {
        ...value,
        status: "completed",
        approvalUrl: undefined,
        orderReference,
        ...(receiptUrl ? { receiptUrl } : {}),
        updatedAt: Date.now(),
      });
    });
  }
}

export function terminal(status: string) {
  return ["completed", "declined", "canceled", "expired", "failed"].includes(
    status,
  );
}

function merchantUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !url.hostname.includes(".")
  )
    throw new PaymentError("Use the merchant’s public HTTPS address.");
}

export function paymentError(error: unknown) {
  // Never surface arbitrary provider errors, which can contain response bodies.
  return error instanceof PaymentError || error instanceof LinkProviderError
    ? error.message
    : "Could not complete the Link request. Refresh to check its status before retrying.";
}
