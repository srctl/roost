import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { appGate } from "../updater/gate";
import { withAgentStore } from "./agents/store.server";
import { verifyAuthReadiness } from "./auth/readiness.server";
import { loginActive } from "./codex/login.server";
import { computerActivity } from "./computer/session.server";
import { workerActivity } from "./runs/worker.server";

let requests = 0;
export async function trackUpdateRequest(action: () => Promise<Response>) {
  requests++;
  try {
    return await action();
  } finally {
    requests--;
  }
}
export async function updateGateRequest(
  request: Request,
  renderShell?: () => Response | Promise<Response>,
): Promise<Response | null> {
  const gate = appGate();
  const url = new URL(request.url);
  const authorized =
    request.headers.get("X-Roost-Updater") === (gate.token ?? gate.operation) &&
    gate.mode !== "open";
  if (url.pathname === "/api/updates/quiescence" && authorized) {
    const activity = workerActivity();
    return Response.json({
      requests,
      tasks: activity.tasks + computerActivity(),
      login: loginActive(),
      frozen: ["hold", "verify", "manual"].includes(gate.mode),
    });
  }
  if (
    url.pathname === "/api/updates/probe" &&
    authorized &&
    gate.mode === "verify"
  ) {
    const appSchema = await Effect.runPromise(
      withAgentStore((db) => {
        if (
          db
            .prepare("PRAGMA integrity_check")
            .all()
            .some((r) => r.integrity_check !== "ok")
        )
          throw new Error("App integrity failed.");
        return Number(db.prepare("PRAGMA user_version").get()?.user_version);
      }),
    );
    const auth = new DatabaseSync(
      join(process.env.ROOST_DATA_DIR!, "auth.sqlite"),
      { readOnly: true },
    );
    let authSchema = 0;
    try {
      authSchema = Number(
        auth.prepare("PRAGMA user_version").get()?.user_version,
      );
      if (
        auth
          .prepare("PRAGMA integrity_check")
          .all()
          .some((r) => r.integrity_check !== "ok")
      )
        throw new Error("Auth integrity failed.");
      verifyAuthReadiness(auth);
    } finally {
      auth.close();
    }
    const assets = process.env.ROOST_PUBLIC_DIR;
    const names = assets ? await readdir(join(assets, "assets")) : [];
    const script = names.find((name) => name.endsWith(".js"));
    const style = names.find((name) => name.endsWith(".css"));
    const healthyAssets = !!(
      script &&
      style &&
      assets &&
      (await readFile(join(assets, "assets", script))).length &&
      (await readFile(join(assets, "assets", style))).length
    );
    let shell = false;
    let referencedAssets = false;
    if (renderShell) {
      const response = await renderShell();
      const { boundedBytes } = await import("../updater/releases");
      const html = (await boundedBytes(response, 2 * 1024 * 1024)).toString();
      const references = [
        ...new Set(html.match(/\/assets\/[^"'<>\s)]+\.(?:js|css)/g) ?? []),
      ];
      referencedAssets =
        !!assets &&
        references.some((p) => p.endsWith(".js")) &&
        references.some((p) => p.endsWith(".css"));
      for (const path of references) {
        const name = path.slice("/assets/".length);
        if (!/^[A-Za-z0-9_.-]+\.(?:js|css)$/.test(name)) {
          referencedAssets = false;
          break;
        }
        const info = await stat(join(assets!, "assets", name)).catch(
          () => null,
        );
        if (!info?.isFile() || info.size === 0) referencedAssets = false;
      }
      shell =
        response.ok &&
        response.headers.get("content-type")?.includes("text/html") === true &&
        html.includes("Software updates") &&
        html.includes("<script") &&
        html.includes("</html>");
    }
    return Response.json({
      shell,
      operation: gate.operation,
      token: gate.token,
      version: process.env.ROOST_RELEASE_VERSION,
      integrity: true,
      appSchema,
      authSchema,
      assets: healthyAssets && referencedAssets,
      workerReady: workerActivity().initialized,
    });
  }
  if (["hold", "verify", "manual"].includes(gate.mode)) {
    if (url.pathname === "/api/health")
      return Response.json(
        { status: "maintenance" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    return new Response(
      "Roost is updating or recovering. Reconnect to check the durable result. Do not resubmit work.",
      {
        status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "2" },
      },
    );
  }
  return null;
}
