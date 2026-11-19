import { randomUUID } from "node:crypto";
import {
  type DesktopCall,
  type DesktopRequest,
  type DesktopResult,
  desktopResultSchema,
  type Grants,
  grantsSchema,
  permits,
} from "@roost/desktop-protocol";
import { Effect } from "effect";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { allowsTool, runCapabilities } from "../codex/run-capabilities.server";
import { mobileDeviceActive } from "../mobile/tokens.server";
import type { Run } from "../runs/store.server";

type Pending = {
  request: DesktopRequest;
  delivered: boolean;
  resolve: (value: DesktopResult) => void;
  reject: (error: Error) => void;
};
type Companion = {
  lease: string;
  seen: number;
  grants: Grants;
  pending: Map<string, Pending>;
};

export async function assertDesktopRun(
  agentId: string,
  runId: string,
  tool: string,
) {
  await Effect.runPromise(
    withAgentStore((db) => {
      const run = db
        .prepare(
          "SELECT kind,automationId FROM runs WHERE id=? AND agentId=? AND status='running' AND cancelRequested=0",
        )
        .get(runId, agentId);
      if (
        !run ||
        !allowsTool(
          runCapabilities(
            run.kind as Run["kind"],
            run.automationId as string | null,
          ),
          tool,
        )
      ) {
        throw new AgentStoreError({
          message: "This run cannot access a desktop companion.",
        });
      }
    }),
  );
}

// Work is deliberately ephemeral. Restarting or losing a companion never
// replays an input action against a desktop that may have changed.
export class CompanionBroker {
  private companions = new Map<string, Companion>();
  constructor(
    private authorize = assertDesktopRun,
    private active = mobileDeviceActive,
  ) {}

  connect(deviceId: string) {
    for (const [id, companion] of this.companions) {
      if (Date.now() - companion.seen > 8000 || !this.active(id))
        this.disconnect(id);
    }
    this.disconnect(deviceId);
    if (this.companions.size >= 32)
      throw new Error("Too many desktop companions.");
    const lease = randomUUID();
    this.companions.set(deviceId, {
      lease,
      seen: Date.now(),
      grants: { agentId: null, chats: [], computerUntil: 0 },
      pending: new Map(),
    });
    return { lease, protocolVersion: 1 };
  }

  private connection(deviceId: string, lease: string) {
    const companion = this.companions.get(deviceId);
    if (!companion || companion.lease !== lease || !this.active(deviceId))
      throw new Error("Reconnect the desktop companion.");
    return companion;
  }

  async poll(deviceId: string, lease: string, input: unknown) {
    const companion = this.connection(deviceId, lease);
    const grants = grantsSchema.parse(input);
    if (grants.computerUntil > Date.now() + 15 * 60 * 1000)
      throw new Error("Computer sessions last at most 15 minutes.");
    companion.grants = grants;
    companion.seen = Date.now();
    const requests: DesktopRequest[] = [];
    for (const pending of companion.pending.values()) {
      try {
        if (
          !permits(grants, pending.request.agentId, pending.request.call) ||
          pending.request.expiresAt <= Date.now()
        )
          throw new Error("Local access ended.");
        await this.authorize(
          pending.request.agentId,
          pending.request.runId,
          pending.request.call.tool,
        );
        if (companion.pending.get(pending.request.id) !== pending) continue;
        if (!pending.delivered) {
          pending.delivered = true;
          requests.push(pending.request);
        }
      } catch (error) {
        companion.pending.delete(pending.request.id);
        pending.reject(
          error instanceof Error ? error : new Error("Local access ended."),
        );
      }
    }
    return { requests, activeRequestIds: [...companion.pending.keys()] };
  }

  async result(deviceId: string, lease: string, id: string, input: unknown) {
    const companion = this.connection(deviceId, lease);
    const pending = companion.pending.get(id);
    if (!pending?.delivered)
      throw new Error("This desktop request is no longer active.");
    const result = desktopResultSchema.parse(input);
    if (
      !permits(
        companion.grants,
        pending.request.agentId,
        pending.request.call,
      ) ||
      pending.request.expiresAt <= Date.now()
    )
      throw new Error("Local access ended.");
    await this.authorize(
      pending.request.agentId,
      pending.request.runId,
      pending.request.call.tool,
    );
    if (pending.request.call.tool !== "roost_desktop_computer" && result.image)
      throw new Error("Unexpected image result.");
    companion.pending.delete(id);
    pending.resolve(result);
  }

  disconnect(deviceId: string, lease?: string) {
    const companion = this.companions.get(deviceId);
    if (!companion || (lease && companion.lease !== lease)) return;
    this.companions.delete(deviceId);
    for (const pending of companion.pending.values())
      pending.reject(new Error("The desktop companion disconnected."));
  }

  async request(
    agentId: string,
    runId: string,
    call: DesktopCall,
    signal: AbortSignal,
  ) {
    await this.authorize(agentId, runId, call.tool);
    if (signal.aborted) throw new Error("Run stopped.");
    const matches = [...this.companions].filter(
      ([deviceId, value]) =>
        this.active(deviceId) &&
        Date.now() - value.seen < 8000 &&
        permits(value.grants, agentId, call),
    );
    if (matches.length !== 1)
      throw new Error(
        matches.length
          ? "Choose only one desktop for this agent."
          : "Open Roost and enable access for this agent.",
      );
    const companion = matches[0]![1];
    if (companion.pending.size)
      throw new Error(
        "The desktop companion is busy. Request a new screenshot before retrying computer input.",
      );
    const request: DesktopRequest = {
      id: randomUUID(),
      agentId,
      runId,
      expiresAt: Date.now() + 15000,
      call,
    };
    return new Promise<DesktopResult>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        companion.pending.delete(request.id);
      };
      const abort = () => {
        finish();
        reject(new Error("Run stopped."));
      };
      const timer = setTimeout(() => {
        finish();
        reject(
          new Error(
            "The desktop request timed out. Input actions are not replayed.",
          ),
        );
      }, 15000);
      companion.pending.set(request.id, {
        request,
        delivered: false,
        resolve: (value) => {
          finish();
          resolve(value);
        },
        reject: (error) => {
          finish();
          reject(error);
        },
      });
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}
export const companionBroker = new CompanionBroker();
