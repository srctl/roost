import { Effect, Schema } from "effect";
import { ApprovalResponse } from "../../features/approvals/schema";
import { SendMessage } from "../../features/chat/schema";
import { listAgents, withAgentStore } from "../agents/store.server";
import { answerApproval, readApprovals } from "../approvals/store.server";
import { downloadFileRequest, uploadFileRequest } from "../files/http.server";
import { assertAvailable } from "../maintenance.server";
import { readConversationSnapshot } from "../runs/conversation-snapshot.server";
import { cancelRun, enqueueChat } from "../runs/store.server";
import { openReplyThread } from "../runs/threads.server";
import { ensureTimeline, startWorker } from "../runs/worker.server";
import { mobileAccountRequest } from "./account.server";
import {
  MobileAgentManagementError,
  mobileAgentManagementRequest,
} from "./agent-management.server";
import { mobileAutomationRequest } from "./automations.server";
import { mobileComputerRequest } from "./computer.server";
import { mobileDisplaySettingsRequest } from "./display-settings.server";
import { mobileFeedRequest } from "./feed.server";
import { mobileNotificationsRequest } from "./notifications.server";
import { mobilePaymentRequest } from "./payments.server";
import { mobileSettingsRequest } from "./settings.server";
import { MobileTokens, mobileIdentity } from "./tokens.server";
import {
  MobileWorkspaceError,
  mobileWorkspaceRequest,
} from "./workspaces.server";

const prefix = "/api/mobile/v1/";
const json = (value: unknown, status = 200) =>
  Response.json(value ?? null, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const uuid = Schema.decodeUnknownSync(Schema.UUID);
const conversationQuery = Schema.decodeUnknownSync(
  Schema.Struct({
    conversationId: Schema.optional(Schema.UUID),
    since: Schema.optional(
      Schema.NumberFromString.pipe(Schema.int(), Schema.nonNegative()),
    ),
    before: Schema.optional(
      Schema.NumberFromString.pipe(Schema.int(), Schema.nonNegative()),
    ),
  }),
);
async function body(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new Error("Expected JSON");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256 * 1024) {
        await reader.cancel();
        throw new Error("Too large");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  } finally {
    reader.releaseLock();
  }
}

// A separate, explicitly authenticated surface. Browser cookies never grant
// mobile access; tokens never bypass authentication on web or desktop routes.
export function createMobileHandler(
  prepare = async (agentId: string) => {
    startWorker();
    await Effect.runPromise(ensureTimeline(agentId));
  },
  manageAgents = mobileAgentManagementRequest,
  accountRequest = mobileAccountRequest,
) {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/mobile/")) return null;
    if (
      request.headers.has("origin") ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return json({ error: "Browser requests are not supported." }, 403);
    const identity = mobileIdentity(request);
    if (!identity)
      return json({ error: "Connect with a valid device token." }, 401);
    if (!url.pathname.startsWith(prefix))
      return json({ error: "Unsupported mobile API version." }, 404);
    const path = url.pathname.slice(prefix.length);
    try {
      if (path === "session" && request.method === "GET")
        return json({ apiVersion: 1 });
      if (path === "session" && request.method === "DELETE") {
        const store = new MobileTokens();
        try {
          store.revoke(identity);
        } finally {
          store.close();
        }
        return json({ ok: true });
      }
      if (path === "agents" && request.method === "GET") {
        await Effect.runPromise(withAgentStore(assertAvailable));
        return json(await Effect.runPromise(listAgents()));
      }
      if (path === "files" && ["GET", "POST"].includes(request.method)) {
        const headers = new Headers(request.headers);
        headers.set("sec-fetch-site", "same-origin");
        const internal = new Request(request, { headers });
        return request.method === "GET"
          ? downloadFileRequest(internal)
          : uploadFileRequest(internal);
      }
      const payments = await mobilePaymentRequest(path, request, body);
      if (payments) return json(payments.value, payments.status);
      const management = await manageAgents(path, request, body);
      if (management) return json(management.value, management.status);
      const automation = await mobileAutomationRequest(
        path,
        request,
        body,
        prepare,
      );
      if (automation) return json(automation.value, automation.status);
      const settings = await mobileSettingsRequest(path, request, body);
      if (settings) return json(settings.value, settings.status);
      const push = await mobileNotificationsRequest(
        path,
        request,
        body,
        identity,
      );
      if (push) return json(push.value, push.status);
      const displaySettings = await mobileDisplaySettingsRequest(
        path,
        request,
        body,
      );
      if (displaySettings)
        return json(displaySettings.value, displaySettings.status);
      const account = await accountRequest(path, request, body);
      if (account) return json(account.value, account.status);
      const computer = await mobileComputerRequest(
        path,
        request,
        body,
        identity,
      );
      if (computer) return json(computer.value, computer.status);
      const workspace = await mobileWorkspaceRequest(path, request, body);
      if (workspace) return json(workspace.value, workspace.status);
      const feed = await mobileFeedRequest(path, request, body, prepare);
      if (feed) return json(feed.value, feed.status);
      const match =
        /^agents\/([^/]+)\/(conversation|messages|stop|threads|approvals)$/.exec(
          path,
        );
      if (!match) return json({ error: "Not found." }, 404);
      const agentId = uuid(match[1]);
      const action = match[2];
      if (action === "conversation" && request.method === "GET") {
        const query = conversationQuery(Object.fromEntries(url.searchParams));
        await Effect.runPromise(withAgentStore(assertAvailable));
        await prepare(agentId);
        return json(
          await Effect.runPromise(readConversationSnapshot(agentId, query)),
        );
      }
      if (action === "approvals" && request.method === "GET")
        return json(await Effect.runPromise(readApprovals(agentId)));
      if (request.method !== "POST")
        return json({ error: "Method not allowed." }, 405);
      if (action === "messages") {
        const rejected = () =>
          json(
            {
              error:
                "This message was not sent. Check the message and attachments, refresh, and try again.",
              code: "message_rejected",
            },
            400,
          );
        let input: SendMessage;
        try {
          input = Schema.decodeUnknownSync(SendMessage)({
            ...(await body(request)),
            agentId,
          });
          await Effect.runPromise(withAgentStore(assertAvailable));
          await prepare(agentId);
        } catch {
          // No enqueue has been attempted. Native clients can safely unlock
          // their draft for editing. Errors after enqueue must stay ambiguous
          // so retries keep the same message identity.
          return rejected();
        }
        try {
          return json(await Effect.runPromise(enqueueChat(input)), 202);
        } catch (error) {
          // Attachment/conversation checks can fail inside the enqueue
          // transaction. Only release the draft after confirming that its
          // identity has no persisted run or message; an existing identity or
          // an unreadable store must retain the exact retry payload.
          const absent = await Effect.runPromise(
            withAgentStore(
              (db) =>
                !db
                  .prepare(
                    "SELECT 1 FROM runs WHERE id=? UNION ALL SELECT 1 FROM timeline WHERE id=? LIMIT 1",
                  )
                  .get(input.messageId, input.messageId),
            ),
          );
          if (absent) return rejected();
          throw error;
        }
      }
      const data = await body(request);
      if (action === "stop")
        return json(await Effect.runPromise(cancelRun(agentId, uuid(data.id))));
      if (action === "threads") {
        const input = Schema.decodeUnknownSync(
          Schema.Struct({
            parentMessageId: Schema.String.pipe(
              Schema.minLength(1),
              Schema.maxLength(2000),
            ),
          }),
        )(data);
        const assistantParent = await Effect.runPromise(
          withAgentStore((db) => {
            assertAvailable(db);
            return db
              .prepare(
                "SELECT 1 FROM timeline WHERE agentId=? AND conversationId=? AND id=? AND json_extract(message,'$.role')='assistant'",
              )
              .get(agentId, agentId, input.parentMessageId);
          }),
        );
        if (!assistantParent)
          return json(
            { error: "Only assistant messages can have replies." },
            400,
          );
        return json(
          await Effect.runPromise(
            openReplyThread(agentId, input.parentMessageId),
          ),
        );
      }
      if (action === "approvals") {
        const response = Schema.decodeUnknownSync(ApprovalResponse)(
          data.response,
        );
        return json(
          await Effect.runPromise(
            answerApproval(agentId, uuid(data.id), response),
          ),
        );
      }
      return json({ error: "Not found." }, 404);
    } catch (error) {
      if (error instanceof MobileAgentManagementError)
        return json({ error: error.message }, 400);
      if (error instanceof MobileWorkspaceError)
        return json({ error: error.message }, error.status);
      return json(
        {
          error:
            "Could not complete this request. Refresh and retry; Roost may be updating or the item may no longer be available.",
        },
        400,
      );
    }
  };
}
export const mobileRequest = createMobileHandler();
