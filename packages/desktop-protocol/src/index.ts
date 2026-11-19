import { z } from "zod";

const chatId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const coordinate = z.number().int().min(0).max(16384);
export const grantsSchema = z
  .object({
    agentId: z.uuid().nullable(),
    chats: z
      .array(z.object({ id: chatId, label: z.string().max(160) }).strict())
      .max(100),
    computerUntil: z.number().int().nonnegative(),
  })
  .strict();
export type Grants = z.infer<typeof grantsSchema>;
export const emptyGrants: Grants = {
  agentId: null,
  chats: [],
  computerUntil: 0,
};

export const messagesInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("chats") }).strict(),
  z
    .object({
      action: z.literal("history"),
      chatId,
      limit: z.number().int().min(1).max(100).default(30),
      query: z.string().max(200).optional(),
    })
    .strict(),
]);
export const computerInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("screenshot") }).strict(),
  z
    .object({
      action: z.literal("click"),
      x: coordinate,
      y: coordinate,
      button: z.enum(["left", "right"]).default("left"),
      clicks: z.number().int().min(1).max(2).default(1),
    })
    .strict(),
  z
    .object({ action: z.literal("move"), x: coordinate, y: coordinate })
    .strict(),
  z
    .object({
      action: z.literal("scroll"),
      direction: z.enum(["up", "down"]),
      amount: z.number().int().min(1).max(10),
    })
    .strict(),
  z
    .object({
      action: z.literal("key"),
      key: z
        .string()
        .min(1)
        .max(60)
        .regex(/^[a-zA-Z0-9_+]+$/),
    })
    .strict(),
  z.object({ action: z.literal("type"), text: z.string().max(5000) }).strict(),
]);
export const desktopCallSchema = z.discriminatedUnion("tool", [
  z
    .object({ tool: z.literal("roost_desktop_messages"), input: messagesInput })
    .strict(),
  z
    .object({ tool: z.literal("roost_desktop_computer"), input: computerInput })
    .strict(),
]);
export type DesktopCall = z.infer<typeof desktopCallSchema>;
export const desktopRequestSchema = z
  .object({
    id: z.uuid(),
    agentId: z.uuid(),
    runId: z.uuid(),
    expiresAt: z.number().int(),
    call: desktopCallSchema,
  })
  .strict();
export type DesktopRequest = z.infer<typeof desktopRequestSchema>;
export const desktopResultSchema = z
  .object({
    success: z.boolean(),
    text: z.string().max(100000),
    image: z
      .object({
        dataURL: z
          .string()
          .max(4 * 1024 * 1024)
          .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/),
        width: z.number().int().positive().max(4096),
        height: z.number().int().positive().max(4096),
      })
      .strict()
      .optional(),
  })
  .strict();
export type DesktopResult = z.infer<typeof desktopResultSchema>;

export function permits(
  grants: Grants,
  agentId: string,
  call: DesktopCall,
  now = Date.now(),
) {
  if (grants.agentId !== agentId) return false;
  if (call.tool === "roost_desktop_computer") return grants.computerUntil > now;
  const input = call.input;
  return (
    grants.chats.length > 0 &&
    (input.action === "chats" ||
      grants.chats.some((chat) => chat.id === input.chatId))
  );
}
