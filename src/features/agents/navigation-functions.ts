import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import {
  changeAgentNavigation,
  readAgentNavigation,
  renameAgent,
} from "../../server/agents/navigation.server";
import { available } from "../../server/available";
import { NavigationChange, RenameAgentInput } from "./navigation-schema";

const result = <A, E extends { message: string }>(
  effect: Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onSuccess: (value) => ({ ok: true as const, value }),
        onFailure: (error) => ({ ok: false as const, error: error.message }),
      }),
    ),
  );

export const getAgentNavigation = createServerFn({ method: "GET" })
  .middleware([available])
  .handler(() => result(readAgentNavigation()));
export const saveAgentName = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(RenameAgentInput))
  .handler(({ data }) => result(renameAgent(data)));
export const saveAgentNavigation = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(NavigationChange))
  .handler(({ data }) => result(changeAgentNavigation(data)));
