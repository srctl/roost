import { Schema } from "effect";

const Text = Schema.String.pipe(Schema.maxLength(32000));
export const ApprovalQuestion = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  question: Text,
  options: Schema.Array(Schema.Struct({ label: Text, description: Text })).pipe(
    Schema.maxItems(20),
  ),
  allowOther: Schema.Boolean,
});
export const ApprovalRequest = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  details: Text.pipe(Schema.minLength(1)),
  questions: Schema.optional(
    Schema.Array(ApprovalQuestion).pipe(Schema.maxItems(3)),
  ),
});
export type ApprovalRequest = typeof ApprovalRequest.Type;
export const ApprovalResponse = Schema.Struct({
  decision: Schema.Literal("approve", "decline", "answer"),
  answers: Schema.optional(Schema.Record({ key: Schema.String, value: Text })),
});
export type ApprovalResponse = typeof ApprovalResponse.Type;
export type Approval = ApprovalRequest & {
  id: string;
  status: "pending" | "answered" | "cancelled";
  response: ApprovalResponse | null;
};
