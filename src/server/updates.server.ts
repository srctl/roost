import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { capability } from "../updater/contract";
import { ReleaseChecker } from "../updater/releases";
import { authorizeMutation, csrfToken, updateBody } from "../updater/security";
import { sessionId } from "./auth/session.server";
import { openAuth } from "./auth/store.server";

const secret = randomBytes(32).toString("hex");
let checker: ReleaseChecker | undefined;
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

async function installation() {
  // ROOST_HOME alone is also present in agent/source environments. The packaged
  // launcher supplies the version and fixes DATA_DIR; require both identities.
  const root = process.env.ROOST_HOME;
  if (
    !root ||
    !process.env.ROOST_RELEASE_VERSION ||
    process.env.ROOST_DATA_DIR !== join(root, "data")
  )
    return { packaged: false, repository: undefined };
  try {
    const c = JSON.parse(await readFile(join(root, "config.json"), "utf8")) as {
      root?: string;
      uid?: number;
      repository?: string;
    };
    if (c.root !== (await realpath(root)) || c.uid !== process.getuid?.())
      return { packaged: false, repository: undefined };
    return { packaged: true, repository: c.repository };
  } catch {
    return { packaged: false, repository: undefined };
  }
}

/** Phase-one status only. The activation route deliberately has no command,
 * spawn, filesystem mutation, enrollment, or fallback to the legacy CLI. */
export async function updatesRequest(request: Request) {
  const facts = await installation();
  const status = capability({
    ...facts,
    platform: process.platform,
    arch: process.arch,
    systemd: existsSync("/run/systemd/system"),
  });
  const auth = openAuth();
  try {
    const session = auth?.session(sessionId(request));
    if (
      auth &&
      (!session ||
        new URL(request.url).host !== new URL(auth.config().origin).host)
    )
      return json({ error: "Native sign-in required." }, 401);
    if (facts.repository && checker?.repository !== facts.repository)
      checker = new ReleaseChecker(facts.repository);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/updates") {
      return json({
        capability: status,
        version: facts.packaged ? process.env.ROOST_RELEASE_VERSION : "dev",
        latest: session ? (checker?.cached ?? null) : null,
        canCheck: Boolean(session && facts.repository),
        csrf: session ? csrfToken(secret, session.id) : null,
        recent: Boolean(session && session.created >= Date.now() - 5 * 60_000),
      });
    }
    if (request.method !== "POST")
      return json({ error: "Method not allowed." }, 405);
    if (!auth || !session)
      return json({ error: "Native passkey sign-in required." }, 401);
    try {
      authorizeMutation(request, {
        origin: auth.config().origin,
        session,
        secret,
      });
      await updateBody(request, []);
    } catch {
      return json(
        { error: "Sign in again and retry this request from Settings." },
        403,
      );
    }
    if (url.pathname === "/api/updates/check") {
      if (!facts.repository || !checker)
        return json(
          { error: "No packaged release repository is configured." },
          409,
        );
      if (!auth.limit("updates-check", 2))
        return json({ error: "Wait a minute before checking again." }, 429);
      try {
        return json({ latest: await checker.check() });
      } catch {
        return json(
          {
            error:
              "Could not check releases. Check network and configured repository access, then retry in a minute.",
          },
          503,
        );
      }
    }
    return json({ error: status.reason }, 409);
  } finally {
    auth?.close();
  }
}
