import { definePlugin } from "nitro";
import { appRoot, startupGuard } from "../updater/gate";
import { closeAgentRuntimes } from "./codex/agent-runtime.server";
import { closeLogin } from "./codex/login.server";
import { startWorker } from "./runs/worker.server";

export default definePlugin((app) => {
  const root = appRoot();
  if (root)
    startupGuard(
      root,
      process.env.ROOST_RELEASE_VERSION ?? "dev",
      process.env.ROOST_UPDATE_TOKEN,
    );
  const stop = startWorker();
  app.hooks.hook("close", async () => {
    await stop();
    await closeLogin();
    await closeAgentRuntimes();
  });
});
