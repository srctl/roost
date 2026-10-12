import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type DesktopRequest,
  type DesktopResult,
  desktopRequestSchema,
  desktopResultSchema,
  type Grants,
  grantsSchema,
  permits,
} from "@roost/desktop-protocol";

export type Execute = (
  program: string,
  args: string[],
  input: string | undefined,
  signal: AbortSignal,
) => Promise<string>;
export const execute: Execute = (program, args, input, signal) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      program,
      args,
      { encoding: "utf8", timeout: 8000, maxBuffer: 5 * 1024 * 1024, signal },
      (error, stdout) => {
        if (error)
          reject(
            new Error(
              program.endsWith("imsg")
                ? "Messages access failed. Install imsg and allow Roost Full Disk Access in System Settings."
                : "Computer access failed. Allow Roost screen recording and Accessibility in System Settings.",
            ),
          );
        else resolve(stdout);
      },
    );
    child.stdin?.end(input);
  });

function jsonRows(text: string): Record<string, unknown>[] {
  const value = text.trim();
  if (!value) return [];
  const rows = value.startsWith("[")
    ? JSON.parse(value)
    : value
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
  if (
    !Array.isArray(rows) ||
    rows.some((row) => !row || typeof row !== "object")
  )
    throw new Error("Unexpected Messages response.");
  return rows;
}

type Screenshot = {
  dataURL: string;
  width: number;
  height: number;
  bounds: { x: number; y: number; width: number; height: number };
};
export class LocalTools {
  private grants: Grants = { agentId: null, chats: [], computerUntil: 0 };
  private controller = new AbortController();
  private screenshot: Screenshot | null = null;
  private capturedAt = 0;
  private busy = false;
  private seen = new Map<string, number>();
  constructor(
    private helper: string,
    private run: Execute = execute,
    private imsg = [
      join(homedir(), ".local/bin/imsg"),
      "/opt/homebrew/bin/imsg",
      "/usr/local/bin/imsg",
    ].find(existsSync) ?? "/opt/homebrew/bin/imsg",
  ) {}

  setGrants(input: Grants) {
    const grants = grantsSchema.parse(input);
    if (JSON.stringify(grants) !== JSON.stringify(this.grants)) {
      this.controller.abort();
      this.controller = new AbortController();
      this.screenshot = null;
    }
    this.grants = grants;
  }
  stop() {
    this.setGrants({ agentId: null, chats: [], computerUntil: 0 });
    this.controller.abort();
  }
  cancelCurrent() {
    this.controller.abort();
    this.controller = new AbortController();
    this.screenshot = null;
  }

  async chats() {
    const rows = jsonRows(
      await this.run(
        this.imsg,
        ["chats", "--limit", "100", "--json"],
        undefined,
        this.controller.signal,
      ),
    );
    return rows
      .map((row) => ({
        id: Number(row.id),
        label: String(
          row.name ||
            row.display_name ||
            row.identifier ||
            `Conversation ${row.id}`,
        ).slice(0, 160),
      }))
      .filter((row) => Number.isSafeInteger(row.id) && row.id > 0);
  }

  async handle(input: DesktopRequest): Promise<DesktopResult> {
    const request = desktopRequestSchema.parse(input);
    if (
      request.expiresAt <= Date.now() ||
      request.expiresAt > Date.now() + 16000 ||
      !permits(this.grants, request.agentId, request.call)
    )
      throw new Error(
        "This request is outside the access you enabled on this Mac.",
      );
    if (this.busy)
      throw new Error("This Mac is already handling a desktop request.");
    for (const [id, expiresAt] of this.seen)
      if (expiresAt <= Date.now()) this.seen.delete(id);
    if (this.seen.has(request.id))
      throw new Error("This desktop request was already handled.");
    this.seen.set(request.id, request.expiresAt);
    this.busy = true;
    const remaining = Math.min(
      request.expiresAt - Date.now(),
      request.call.tool === "roost_desktop_computer"
        ? this.grants.computerUntil - Date.now()
        : 15000,
    );
    const signal = AbortSignal.any([
      this.controller.signal,
      AbortSignal.timeout(Math.max(1, remaining)),
    ]);
    let inputAttempted = false;
    try {
      let result: DesktopResult;
      if (request.call.tool === "roost_desktop_messages") {
        const action = request.call.input;
        if (action.action === "chats")
          result = {
            success: true,
            text: JSON.stringify({ chats: this.grants.chats }),
          };
        else {
          const rows = jsonRows(
            await this.run(
              this.imsg,
              [
                "history",
                "--chat-id",
                String(action.chatId),
                "--limit",
                String(action.limit),
                "--json",
              ],
              undefined,
              signal,
            ),
          );
          const query = action.query?.toLocaleLowerCase();
          // Whitelist text fields. Attachment paths and arbitrary CLI output
          // never leave this Mac, and these reads never mark messages as read.
          const messages = rows
            .filter(
              (row) =>
                !query ||
                String(row.text ?? "")
                  .toLocaleLowerCase()
                  .includes(query),
            )
            .map((row) => ({
              id: row.id,
              text: String(row.text ?? "").slice(0, 6000),
              sender: String(row.sender_name ?? row.sender ?? ""),
              isFromMe: Boolean(row.is_from_me),
              createdAt: row.created_at,
            }));
          const bounded = [];
          let size = 0;
          for (const message of messages) {
            size += JSON.stringify(message).length;
            if (size > 90000) break;
            bounded.push(message);
          }
          result = {
            success: true,
            text: JSON.stringify({
              chatId: action.chatId,
              messages: bounded,
              truncated: bounded.length < messages.length,
            }),
          };
        }
      } else {
        const action = request.call.input;
        if (action.action !== "screenshot") {
          if (!this.screenshot || Date.now() - this.capturedAt > 30000)
            throw new Error("Take a fresh screenshot before using this Mac.");
          let nativeAction: Record<string, unknown> = { ...action };
          if (action.action === "click" || action.action === "move") {
            if (
              action.x >= this.screenshot.width ||
              action.y >= this.screenshot.height
            )
              throw new Error("Coordinates are outside the screenshot.");
            const bounds = this.screenshot.bounds;
            nativeAction = {
              ...action,
              x: bounds.x + (action.x * bounds.width) / this.screenshot.width,
              y: bounds.y + (action.y * bounds.height) / this.screenshot.height,
            };
          }
          this.screenshot = null;
          inputAttempted = true;
          await this.run(this.helper, [], JSON.stringify(nativeAction), signal);
        }
        this.screenshot = null;
        const screenshot = JSON.parse(
          await this.run(
            this.helper,
            [],
            JSON.stringify({ action: "screenshot" }),
            signal,
          ),
        ) as Screenshot;
        desktopResultSchema.parse({
          success: true,
          text: "",
          image: {
            dataURL: screenshot.dataURL,
            width: screenshot.width,
            height: screenshot.height,
          },
        });
        if (
          !screenshot.bounds ||
          !Number.isFinite(screenshot.bounds.width) ||
          screenshot.bounds.width <= 0 ||
          !Number.isFinite(screenshot.bounds.height) ||
          screenshot.bounds.height <= 0
        )
          throw new Error("Invalid display geometry.");
        this.screenshot = screenshot;
        this.capturedAt = Date.now();
        result = {
          success: true,
          text: `Mac main display: ${screenshot.width} × ${screenshot.height}. Use these screenshot pixel coordinates.`,
          image: {
            dataURL: screenshot.dataURL,
            width: screenshot.width,
            height: screenshot.height,
          },
        };
      }
      if (
        signal.aborted ||
        !permits(this.grants, request.agentId, request.call) ||
        request.expiresAt <= Date.now()
      )
        throw new Error("Local access ended.");
      return desktopResultSchema.parse(result);
    } catch (error) {
      if (inputAttempted) {
        this.screenshot = null;
        throw new Error(
          "Input may already have been applied. Take a fresh screenshot before trying another action.",
          { cause: error },
        );
      }
      throw error;
    } finally {
      this.busy = false;
    }
  }
}
