import { ECDH } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import webpush from "web-push";
import type { Message } from "../../features/chat/schema";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { readNotificationPreferences } from "./preferences.server";

type Subscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};
export type Attention = {
  agentId: string;
  conversationId?: string;
  id: string;
  kind: "approval" | "completed" | "failed" | "agent";
  title?: string;
  body?: string;
};

const unavailable = () =>
  new AgentStoreError({
    message: "Could not update notifications. Please try again.",
  });

function contact() {
  const subject = process.env.ROOST_PUSH_SUBJECT?.trim();
  if (!subject) return null;
  try {
    const url = new URL(subject);
    if (
      (url.protocol === "mailto:" &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url.pathname)) ||
      (url.protocol === "https:" &&
        url.hostname.includes(".") &&
        !url.username &&
        !url.password)
    )
      return subject;
  } catch {
    /* Report configuration as unavailable without exposing its value. */
  }
  return null;
}

function vapidKeys(directory: string) {
  const folder = join(directory, "notifications");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  chmodSync(folder, 0o700);
  const path = join(folder, "vapid.json");
  try {
    const keys = JSON.parse(readFileSync(path, "utf8")) as {
      publicKey: string;
      privateKey: string;
    };
    if (
      Buffer.from(keys.publicKey, "base64url").length !== 65 ||
      Buffer.from(keys.privateKey, "base64url").length !== 32
    )
      throw unavailable();
    chmodSync(path, 0o600);
    return keys;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const keys = webpush.generateVAPIDKeys();
    writeFileSync(path, JSON.stringify(keys), { flag: "wx", mode: 0o600 });
    return keys;
  }
}

// Limit outbound requests to browser-operated push services. Do not accept
// arbitrary HTTPS URLs or follow redirects to destinations supplied by clients.
export function validatePushEndpoint(value: string) {
  if (value.length > 4096) throw unavailable();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw unavailable();
  }
  const allowed =
    [
      "fcm.googleapis.com",
      "updates.push.services.mozilla.com",
      "web.push.apple.com",
    ].includes(url.hostname) ||
    /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname);
  if (
    !allowed ||
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname === "/"
  )
    throw new AgentStoreError({
      message: "This browser’s push service is not supported by Roost.",
    });
  // web-push uses Node's legacy URL parser; pass the canonical URL we checked.
  return url.href;
}

export function validateSubscription(input: Subscription): Subscription {
  const endpoint = validatePushEndpoint(input.endpoint);
  const { p256dh, auth } = input.keys;
  if (!/^[A-Za-z0-9_-]{87}$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(auth))
    throw unavailable();
  try {
    ECDH.convertKey(Buffer.from(p256dh, "base64url"), "prime256v1");
  } catch {
    throw unavailable();
  }
  return { endpoint, keys: { p256dh, auth } };
}

export const readPushSettings = (endpoint?: string, directory?: string) =>
  withAgentStore((db, root) => {
    const preferences = readNotificationPreferences(db);
    const registered =
      !!endpoint &&
      !!db
        .prepare("SELECT endpoint FROM push_subscriptions WHERE endpoint=?")
        .get(endpoint);
    if (!contact())
      return { publicKey: null, registered, configured: false, preferences };
    return {
      publicKey: vapidKeys(root).publicKey,
      registered,
      configured: true,
      preferences,
    };
  }, directory);

export const savePushSubscription = (
  input: Subscription,
  publicKey: string,
  directory?: string,
) =>
  withAgentStore((db, root) => {
    const subscription = validateSubscription(input);
    if (!contact() || publicKey !== vapidKeys(root).publicKey)
      throw new AgentStoreError({
        message:
          "Notification settings changed. Reload Settings and try again.",
      });
    if (
      !db
        .prepare("SELECT endpoint FROM push_subscriptions WHERE endpoint=?")
        .get(subscription.endpoint) &&
      Number(
        db.prepare("SELECT count(*) AS count FROM push_subscriptions").get()
          ?.count,
      ) >= 32
    )
      throw new AgentStoreError({
        message:
          "Too many devices have notifications enabled. Disable notifications on an old device first.",
      });
    db.prepare(
      "INSERT INTO push_subscriptions (endpoint,subscription,createdAt) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET subscription=excluded.subscription,createdAt=excluded.createdAt",
    ).run(subscription.endpoint, JSON.stringify(subscription), Date.now());
  }, directory);

export const removePushSubscription = (endpoint: string, directory?: string) =>
  withAgentStore((db) => {
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").run(endpoint);
  }, directory);

function notificationText(value: string, limit: number) {
  const text = value
    .replace(/\bROOST_NO_UPDATE\b/g, "")
    .replace(/^\s*```[^\n]*$/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*{1,3}|~~|`{1,3})(.+?)\1/g, "$2")
    .replace(/\b(_{1,3})([^_]+)\1\b/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

export function attentionPayload(attention: Attention, agentName = "Roost") {
  const title =
    attention.title ||
    {
      approval: "Approval needed",
      failed: "Needs attention",
      agent: "Update",
      completed: "Turn complete",
    }[attention.kind];
  const body =
    notificationText(attention.body ?? "", 240) ||
    (attention.kind === "approval"
      ? "Open the conversation to review the request."
      : attention.kind === "failed"
        ? "The turn could not finish. Open the conversation for details."
        : "Open the conversation to see the update.");
  return {
    title: notificationText(`${agentName} · ${title}`, 100),
    body,
    tag: `roost:${attention.kind}:${attention.id}`,
    url: `/agents/${encodeURIComponent(attention.agentId)}${attention.conversationId && attention.conversationId !== attention.agentId ? `?conversation=${encodeURIComponent(attention.conversationId)}` : ""}`,
  };
}

type Send = typeof webpush.sendNotification;

export async function deliverAttention(
  attention: Attention,
  options: { directory?: string; send?: Send } = {},
) {
  const directory =
    options.directory ?? resolve(process.env.ROOST_DATA_DIR ?? ".roost");
  const state = await Effect.runPromise(
    withAgentStore((db, root) => {
      const preferences = readNotificationPreferences(db);
      const enabled =
        attention.kind === "completed"
          ? preferences.turnCompleted
          : attention.kind === "agent"
            ? preferences.agentUpdates
            : preferences.needsAttention;
      if (!preferences.enabled || !enabled) return null;
      const subscriptions = db
        .prepare("SELECT subscription FROM push_subscriptions")
        .all();
      const subject = contact();
      if (!subscriptions.length || !subject) return null;
      const agent = db
        .prepare("SELECT name FROM agents WHERE id=?")
        .get(attention.agentId);
      const origin = db
        .prepare(
          "SELECT conversationId FROM runs WHERE agentId=? AND id=COALESCE((SELECT runId FROM approvals WHERE id=? AND agentId=?),(SELECT runId FROM agent_notifications WHERE id=? AND agentId=?),?)",
        )
        .get(
          attention.agentId,
          attention.id,
          attention.agentId,
          attention.id,
          attention.agentId,
          attention.id,
        );
      let content = {
        ...attention,
        conversationId:
          attention.conversationId ??
          (origin ? String(origin.conversationId) : undefined),
      };
      if (attention.kind === "approval") {
        const approval = db
          .prepare("SELECT request FROM approvals WHERE id=? AND agentId=?")
          .get(attention.id, attention.agentId);
        if (approval) {
          const request = JSON.parse(String(approval.request)) as {
            title: string;
            details: string;
          };
          content = {
            ...content,
            title: request.title,
            body: request.details,
          };
        }
      }
      return {
        subscriptions,
        vapidDetails: { subject, ...vapidKeys(root) },
        payload: attentionPayload(
          content,
          agent ? String(agent.name) : "Roost",
        ),
      };
    }, directory),
  );
  if (!state) return { delivered: 0, expired: 0, failed: 0 };
  const payload = JSON.stringify(state.payload);
  const outcomes = await Promise.all(
    state.subscriptions.map(async (row) => {
      const serialized = String(row.subscription);
      try {
        const subscription = validateSubscription(JSON.parse(serialized));
        await (options.send ?? webpush.sendNotification)(
          subscription,
          payload,
          {
            vapidDetails: state.vapidDetails,
            TTL: 3600,
            timeout: 5000,
            urgency: attention.kind === "approval" ? "high" : "normal",
          },
        );
        return "delivered" as const;
      } catch (error) {
        const status = (error as { statusCode?: number } | null)?.statusCode;
        if (status === 404 || status === 410) {
          await Effect.runPromise(
            withAgentStore((db) => {
              db.prepare(
                "DELETE FROM push_subscriptions WHERE subscription=?",
              ).run(serialized);
            }, directory),
          );
          return "expired" as const;
        }
        return "failed" as const;
      }
    }),
  );
  return {
    delivered: outcomes.filter((value) => value === "delivered").length,
    expired: outcomes.filter((value) => value === "expired").length,
    failed: outcomes.filter((value) => value === "failed").length,
  };
}

// Delivery never becomes a dependency of a run or approval. A missed push leaves
// the durable result/request in the conversation for the user's next visit.
export function notifyAttention(attention: Attention) {
  void deliverAttention(attention)
    .then((result) => {
      if (result.failed)
        console.warn(
          "Roost could not deliver a push notification to some devices.",
        );
    })
    .catch(() => console.warn("Roost could not deliver a push notification."));
}

export function runNotificationKind(run: {
  kind: string;
  status: string;
  automationSnapshot: string | null;
  messages: string;
}) {
  if (run.kind === "delegation" || run.status === "cancelled") return null;
  if (run.status === "failed" || run.status === "interrupted")
    return "failed" as const;
  if (run.status !== "completed") return null;
  if (run.kind === "reflection") {
    const answer = (JSON.parse(run.messages) as Message[])
      .reverse()
      .find((message) => message.role === "assistant")
      ?.text?.trim();
    if (answer === "ROOST_NO_UPDATE") return null;
  }
  if (run.kind === "automation") {
    const automation = JSON.parse(run.automationSnapshot ?? "null");
    const answer = (JSON.parse(run.messages) as Message[])
      .reverse()
      .find((message) => message.role === "assistant")
      ?.text?.trim();
    if (
      automation?.notification === "when-needed" &&
      answer === "ROOST_NO_UPDATE"
    )
      return null;
  }
  return "completed" as const;
}

export const readRunAttention = (id: string, directory?: string) =>
  withAgentStore((db): Attention | null => {
    const row = db
      .prepare(
        "SELECT agentId,conversationId,kind,status,automationSnapshot,messages,error,prompt,hasAgentUpdate FROM runs WHERE id=?",
      )
      .get(id);
    if (!row) return null;
    const kind = runNotificationKind({
      kind: String(row.kind),
      status: String(row.status),
      automationSnapshot: row.automationSnapshot
        ? String(row.automationSnapshot)
        : null,
      messages: String(row.messages),
    });
    if (!kind) return null;
    if (
      kind === "completed" &&
      readNotificationPreferences(db).agentUpdates &&
      row.hasAgentUpdate === 1
    )
      return null;
    const answer = (JSON.parse(String(row.messages)) as Message[])
      .reverse()
      .find((message) => message.role === "assistant")
      ?.text?.replace(/\bROOST_NO_UPDATE\b/g, "")
      .trim();
    const body =
      kind === "failed"
        ? row.error ||
          (row.status === "interrupted"
            ? "The turn was interrupted before it finished."
            : `Could not finish: ${row.prompt}`)
        : answer || `Finished: ${row.prompt}`;
    return {
      agentId: String(row.agentId),
      conversationId: String(row.conversationId),
      id,
      kind,
      body: String(body),
    };
  }, directory);

export function notifyRunFinished(id: string) {
  void Effect.runPromise(readRunAttention(id))
    .then((attention) => {
      if (attention) notifyAttention(attention);
    })
    .catch(() => console.warn("Roost could not prepare a push notification."));
}
