import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { withAgentStore } from "../server/agents/store.server";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        await Effect.runPromise(
          withAgentStore((db) => db.prepare("SELECT 1").get()),
        );

        return Response.json({
          status: "ok",
          version: process.env.ROOST_RELEASE_VERSION ?? "dev",
        });
      },
    },
  },
});
