import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import {
  answerApproval,
  readApprovals,
} from "../../server/approvals/store.server";
import { ApprovalResponse } from "./schema";

const result = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onSuccess: (value) => ({ ok: true as const, value }),
        onFailure: () => ({
          ok: false as const,
          error:
            "This request could not be updated. It may have expired; reload and try again.",
        }),
      }),
    ),
  );

// Existing runs must remain reviewable and resolvable while an update drains
// them. The store still validates the agent, request, and active run.
export const getApprovals = createServerFn({ method: "GET" })
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ agentId: Schema.UUID, id: Schema.optional(Schema.UUID) }),
    ),
  )
  .handler(({ data }) => result(readApprovals(data.agentId, data.id)));

export const respondToApproval = createServerFn({ method: "POST" })
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({
        agentId: Schema.UUID,
        id: Schema.UUID,
        response: ApprovalResponse,
      }),
    ),
  )
  .handler(({ data }) =>
    result(answerApproval(data.agentId, data.id, data.response)),
  );
