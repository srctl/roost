import { definePlugin } from "nitro";
import { closeAgentRuntimes } from "./codex/agent-runtime.server";
import { closeLogin } from "./codex/login.server";
import { startWorker } from "./runs/worker.server";

export default definePlugin((app) => {
  const stop = startWorker();
  app.hooks.hook("close", async () => {
    await stop();
    await closeLogin();
    await closeAgentRuntimes();
  });
});
