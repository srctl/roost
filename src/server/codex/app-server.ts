import { Data, Effect } from "effect";

export class CodexNotConnected extends Data.TaggedError(
  "CodexNotConnected",
)<{}> {}

// Future boundary: own `codex app-server` over stdio, initialize the
// connection, and translate its thread/turn events into Roost's services.
// Fail explicitly until the transport is implemented; never fake a connection.
export const connect = (): Effect.Effect<void, CodexNotConnected> =>
  Effect.fail(new CodexNotConnected());
