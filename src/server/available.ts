import { createMiddleware } from "@tanstack/react-start";
import { Effect } from "effect";
import { withAgentStore } from "./agents/store.server";
import { assertAvailable } from "./maintenance.server";

export const available = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    await Effect.runPromise(withAgentStore(assertAvailable));
    return next();
  },
);
