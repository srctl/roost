import { Schema } from "effect";

export type PaymentPurchase = {
  id: string;
  agentId: string;
  merchantName: string;
  merchantUrl: string;
  description: string;
  amount: number;
  currency: string;
  status: string;
  approvalUrl?: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
  orderReference?: string;
  receiptUrl?: string;
};

export type PaymentSettings = {
  connected: boolean;
  email?: string;
  connection?: {
    verificationUrl: string;
    userCode: string;
    expiresAt: number;
  };
  purchases: PaymentPurchase[];
};

export const PaymentQuery = Schema.Struct({
  agentId: Schema.optional(Schema.UUID),
});

export const PurchaseInput = Schema.Struct({
  requestId: Schema.UUID,
  merchantName: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(200)),
  merchantUrl: Schema.String.pipe(Schema.maxLength(2048)),
  description: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(2000)),
  amount: Schema.Number.pipe(Schema.int(), Schema.between(1, 50000)),
  currency: Schema.Literal("usd"),
});
export type PurchaseInput = typeof PurchaseInput.Type;

// Provider pages are opened outside Roost; never attach a Roost session/token.
export function isLinkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["link.com", "app.link.com", "login.link.com"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
