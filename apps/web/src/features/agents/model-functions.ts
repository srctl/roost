import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import { saveAgentModel } from "../../server/agents/model.server";
import { available } from "../../server/available";
import { AgentModelInput } from "./model-schema";

export const saveAgentModelSettings = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(AgentModelInput))
  .handler(({ data }) =>
    Effect.runPromise(
      saveAgentModel(data).pipe(
        Effect.match({
          onSuccess: (value) => ({ ok: true as const, value }),
          onFailure: (error) => ({ ok: false as const, error: error.message }),
        }),
      ),
    ),
  );
