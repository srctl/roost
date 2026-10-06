import { Effect, Schema } from "effect";
import { AgentModelInput } from "../../features/agents/model-schema";
import { Agent } from "../../features/agents/schema";
import {
  type CodexModel,
  getCodexConnection,
} from "../codex/app-server.server";
import { assertAvailable } from "../maintenance.server";
import { writeTransaction } from "../transaction.server";
import { AgentStoreError, withAgentStore } from "./store.server";

export function validateModelEffort(
  models: readonly CodexModel[],
  model: string,
  effort?: string | null,
) {
  const selected = models.find((entry) => entry.model === model);
  if (!selected)
    throw new AgentStoreError({
      message:
        "That model is unavailable. Reload to choose an available model.",
    });
  if (
    effort &&
    !selected.supportedReasoningEfforts?.some(
      (entry) => entry.reasoningEffort === effort,
    )
  )
    throw new AgentStoreError({
      message:
        "That reasoning effort is unavailable for this model. Reload to choose a supported effort.",
    });
  return selected;
}

// A model change is explicit for the agent and its existing conversations.
// Automation overrides keep their own selection; native thread/history IDs survive.
export const saveAgentModel = (
  input: typeof AgentModelInput.Type,
  connection = getCodexConnection,
) =>
  Effect.gen(function* () {
    const data = yield* Schema.decodeUnknown(AgentModelInput)(input);
    const { models } = yield* connection;
    yield* Effect.try({
      try: () => validateModelEffort(models, data.model, data.reasoningEffort),
      catch: (error) => error as AgentStoreError,
    });
    return yield* withAgentStore((db) =>
      writeTransaction(db, () => {
        assertAvailable(db);
        const row = db
          .prepare("SELECT * FROM agents WHERE id=?")
          .get(data.agentId);
        if (!row) throw new AgentStoreError({ message: "Agent not found." });
        if (
          row.model !== data.expectedModel ||
          (row.reasoningEffort ?? null) !== data.expectedReasoningEffort
        )
          throw new AgentStoreError({
            message:
              "This agent's model settings changed. Reload before saving.",
          });
        if (
          db
            .prepare("SELECT 1 FROM runs WHERE agentId=? AND status='running'")
            .get(data.agentId)
        )
          throw new AgentStoreError({
            message:
              "This agent is working. Wait for its active run to finish before changing model settings.",
          });
        db.prepare(
          "UPDATE agents SET model=?,reasoningEffort=? WHERE id=?",
        ).run(data.model, data.reasoningEffort, data.agentId);
        db.prepare(
          "UPDATE conversation_sessions SET model=? WHERE agentId=? AND provider='codex'",
        ).run(data.model, data.agentId);
        return Schema.decodeUnknownSync(Agent)(
          db.prepare("SELECT * FROM agents WHERE id=?").get(data.agentId),
        );
      }),
    );
  });
