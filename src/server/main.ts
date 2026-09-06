import { NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";

// Composition root for future HTTP routes and agent services.
// No listener, scheduler, or Codex process is started by this scaffold.
const program = Effect.log("Roost backend scaffold — no services connected.");

NodeRuntime.runMain(program);
