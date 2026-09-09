import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { updaterRequest } from "../updater/client";
import { capability } from "../updater/contract";
import type { UpdateSummary } from "../updater/daemon";
import { type Offer, ReleaseChecker } from "../updater/releases";
import { authorizeMutation, csrfToken, updateBody } from "../updater/security";
import { sessionId } from "./auth/session.server";
import { digest, openAuth } from "./auth/store.server";

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
  const root = process.env.ROOST_HOME;
  if (
    !root ||
    !process.env.ROOST_RELEASE_VERSION ||
    process.env.ROOST_DATA_DIR !== join(root, "data")
  )
    return { packaged: false, root: undefined, repository: undefined };
  try {
    const c = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
    if (c.root !== (await realpath(root)) || c.uid !== process.getuid?.())
      throw new Error("Installation mismatch");
    const os = await readFile("/etc/os-release", "utf8").catch(() => "");
    const field = (name: string) =>
      new RegExp(`^${name}="?([^"\\n]+)`, "m").exec(os)?.[1] ?? "unknown";
    const mounts = (
      await readFile("/proc/self/mountinfo", "utf8").catch(() => "")
    )
      .split("\n")
      .map((line) => {
        const [left, right] = line.split(" - ");
        return {
          path: (left?.split(" ")[4] ?? "").replace(
            /\\([0-7]{3})/g,
            (_, n: string) => String.fromCharCode(Number.parseInt(n, 8)),
          ),
          fs: right?.split(" ")[0],
        };
      })
      .filter(
        (mount) =>
          mount.path &&
          (root === mount.path ||
            root.startsWith(mount.path === "/" ? "/" : `${mount.path}/`)),
      )
      .sort((a, b) => b.path.length - a.path.length);
    return {
      packaged: true,
      distribution: `${field("ID")}:${field("VERSION_ID")}`,
      filesystem: mounts[0]?.fs ?? "unknown",
      root,
      repository: c.repository as string | undefined,
    };
  } catch {
    return { packaged: false, root: undefined, repository: undefined };
  }
}
export async function updatesRequest(request: Request) {
  const facts = await installation();
  const detected = capability({
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
    const enrolled = !!(
      facts.root && existsSync(join(facts.root, "updater.json"))
    );
    const url = new URL(request.url);
    const match = /^\/api\/updates(?:\/([a-f0-9-]{36})(\/cancel)?)?$/.exec(
      url.pathname,
    );
    if (!match && url.pathname !== "/api/updates/check")
      return json({ error: "Not found." }, 404);
    if (facts.repository && checker?.repository !== facts.repository)
      checker = new ReleaseChecker(facts.repository);
    if (request.method === "GET" && match) {
      const key = url.searchParams.get("key");
      if (
        [...url.searchParams.keys()].some((name) => name !== "key") ||
        (key !== null &&
          (match[1] ||
            url.searchParams.getAll("key").length !== 1 ||
            !/^[a-zA-Z0-9_-]{16,100}$/.test(key)))
      )
        return json({ error: "Invalid status lookup." }, 400);
      let helper:
        | {
            qualified: boolean;
            latest: Offer | null;
            operation: UpdateSummary | null;
          }
        | undefined;
      let error: string | undefined;
      if (enrolled && session)
        try {
          helper = await updaterRequest(facts.root!, {
            action: "status",
            ...(match[1] ? { id: match[1] } : key ? { key } : {}),
          });
        } catch {
          error =
            "Updater is unavailable. Existing operations may still be recovering; do not submit again.";
        }
      return json({
        capability:
          enrolled && detected.code === "setup-required"
            ? {
                code: !session
                  ? "native-auth-required"
                  : !helper
                    ? "updater-unavailable"
                    : helper.qualified
                      ? "supported"
                      : "qualification-required",
                canActivate: !!helper?.qualified,
                reason: !session
                  ? "Native passkey sign-in is required for UI updates."
                  : !helper
                    ? "The enrolled updater is unavailable. Inspect its service and durable status before retrying."
                    : helper.qualified
                      ? "Enrolled supervised updater is ready."
                      : "Updater is enrolled. Activation remains disabled until this helper build passes systemd and reboot qualification.",
              }
            : detected,
        version: facts.packaged ? process.env.ROOST_RELEASE_VERSION : "dev",
        latest: session ? (helper?.latest ?? checker?.cached ?? null) : null,
        operation: helper?.operation ?? null,
        enrolled,
        error,
        canCheck: !!(session && facts.repository),
        csrf: session ? csrfToken(secret, session.id) : null,
        recent: !!session && session.created >= Date.now() - 300000,
      });
    }
    if (request.method !== "POST")
      return json({ error: "Method not allowed." }, 405);
    if (!auth || !session)
      return json({ error: "Native passkey sign-in required." }, 401);
    let body: Record<string, unknown>;
    try {
      authorizeMutation(request, {
        origin: auth.config().origin,
        session,
        secret,
      });
      body = await updateBody(
        request,
        url.pathname === "/api/updates" ? ["offerId", "version", "key"] : [],
      );
      // Reading a bounded streaming body may outlive revocation or recent auth.
      authorizeMutation(request, {
        origin: auth.config().origin,
        session: auth.session(session.id),
        secret,
      });
    } catch {
      return json({ error: "Sign in again and retry from Settings." }, 403);
    }
    if (url.pathname === "/api/updates/check") {
      if (!facts.repository || !checker)
        return json(
          { error: "No packaged release repository configured." },
          409,
        );
      if (!auth.limit("updates-check", 2))
        return json({ error: "Wait a minute before checking again." }, 429);
      try {
        return json({
          latest: enrolled
            ? await updaterRequest(facts.root!, { action: "check" })
            : await checker.check(),
        });
      } catch {
        return json(
          {
            error:
              "Release check failed. Check repository access and retry in a minute.",
          },
          503,
        );
      }
    }
    if (!enrolled)
      return json({ error: "Explicit terminal enrollment is required." }, 409);
    if (match?.[2]) {
      try {
        return json({
          operation: await updaterRequest(facts.root!, {
            action: "cancel",
            id: match[1],
          }),
        });
      } catch {
        return json(
          {
            error:
              "Cancellation could not be confirmed. Read the operation status.",
          },
          409,
        );
      }
    }
    if (!auth.limit("updates-start", 4))
      return json({ error: "Too many update requests." }, 429);
    if (
      typeof body.offerId !== "string" ||
      !/^([a-f0-9]{64})$/.test(body.offerId) ||
      typeof body.version !== "string" ||
      body.version.length > 32 ||
      typeof body.key !== "string" ||
      !/^[a-zA-Z0-9_-]{16,100}$/.test(body.key)
    )
      return json({ error: "Confirm the exact offered version." }, 400);
    try {
      return json(
        {
          operation: await updaterRequest(facts.root!, {
            action: "accept",
            ...body,
            actor: digest(session.id),
          }),
        },
        202,
      );
    } catch {
      return json(
        {
          error:
            "Acceptance was not confirmed. Check durable status before any new confirmation.",
        },
        409,
      );
    }
  } finally {
    auth?.close();
  }
}
