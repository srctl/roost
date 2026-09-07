import { Schema } from "effect";
import type { DynamicToolSpec } from "../codex/protocol/v2/DynamicToolSpec";

export { publishArtifact } from "./store.server";

export const PublishArtifact = Schema.Struct({
  path: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(4096)),
  name: Schema.optional(
    Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  ),
});

export const fileTools: DynamicToolSpec[] = [
  {
    type: "function",
    name: "roost_publish_artifact",
    description:
      "Make a finished file available to the user as a download in this conversation. Supply a path to a regular file inside your workspace, optionally a display filename. Roost saves an immutable snapshot (maximum 20 MB) and returns a download URL. Use this for reports, edited documents, spreadsheets, and other outputs. Creating a local file alone does not deliver it to the user. Do not publish secrets or files from outside your workspace.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, name: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
];
