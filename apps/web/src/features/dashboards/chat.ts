import { Schema } from "effect";
import { DashboardKey } from "./schema";

// Conversation UI references saved, agent-owned content. It never carries UI
// markup, copied blocks, event handlers or model-supplied component properties.
export const DashboardMessageUI = Schema.Struct({
  type: Schema.Literal("dashboard"),
  key: DashboardKey,
});
export type DashboardMessageUI = typeof DashboardMessageUI.Type;

export function dashboardMessageUI(
  input: unknown,
): DashboardMessageUI | undefined {
  const decoded = Schema.decodeUnknownEither(DashboardMessageUI, {
    onExcessProperty: "error",
  })(input);
  return decoded._tag === "Right" ? decoded.right : undefined;
}

// A future or malformed UI extension must not make an otherwise readable
// conversation fail to decode. Renderers support only the strict known shape.
export const OptionalMessageUI = Schema.transform(
  Schema.Unknown,
  Schema.UndefinedOr(DashboardMessageUI),
  { decode: dashboardMessageUI, encode: (value) => value },
);

export const ShowDashboard = Schema.Struct({ key: DashboardKey });
export const decodeShowDashboard = Schema.decodeUnknownSync(ShowDashboard, {
  onExcessProperty: "error",
});

export const ChatDashboardInput = Schema.Struct({
  agentId: Schema.UUID,
  key: DashboardKey,
});
export const decodeChatDashboardInput = Schema.decodeUnknownSync(
  ChatDashboardInput,
  { onExcessProperty: "error" },
);
