import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  codingHandoffPlan,
  codingHandoffPresentation,
  codingHandoffViewSchema,
  validateCodingHandoffPlan,
} from "../src/features/coding/presentation";
import type { CodingWorkspace } from "../src/features/coding/workspace-schema";

const id = randomUUID();
const now = 1000000;
const workspace: CodingWorkspace = {
  jobId: id,
  agentId: randomUUID(),
  conversationId: id,
  revision: 7,
  updatedAt: now,
  workflow: "feedback",
  previewUrl: "https://preview.example.com",
  previewRevision: "v7",
  previewAvailability: "running",
  previewReportedAt: now - 1000,
  previewExpiresAt: now + 899000,
  latestChanges: "Current changes",
  verification: "Unit checks passed",
  integration: "pending",
  pullRequests: [],
};

test("coding handoff plans contain only authored view and current job references", () => {
  for (const view of codingHandoffViewSchema.options) {
    const plan = codingHandoffPlan(id, view);
    assert.deepEqual(validateCodingHandoffPlan(plan, id), plan);
    assert.equal(plan.nodes[0]!.id, "handoff/content");
    assert.equal(plan.nodes[0]!.component, "CodingHandoff");
    assert.deepEqual(plan.nodes[0]!.props, { jobId: id, view });
    assert.equal(validateCodingHandoffPlan(plan, randomUUID()), null);
    const injected = structuredClone(plan);
    injected.nodes[0]!.props = {
      ...injected.nodes[0]!.props,
      feedback: "send this",
      href: "https://untrusted.example",
    };
    assert.equal(validateCodingHandoffPlan(injected, id), null);
    const mismatched = structuredClone(plan);
    mismatched.decisions[0]!.option = view === "try" ? "overview" : "try";
    assert.equal(validateCodingHandoffPlan(mismatched, id), null);
    const unsupported = structuredClone(plan);
    unsupported.nodes[0]!.component = "ExecuteCommand";
    assert.equal(validateCodingHandoffPlan(unsupported, id), null);
  }
});

test("handoff suggestions prioritize review evidence and fresh previews without hiding manual choices", () => {
  const job = { id, status: "review" as const, cancelRequested: false };
  assert.equal(
    codingHandoffPresentation(job, workspace, now).defaultView,
    "try",
  );
  assert.equal(
    codingHandoffPresentation(job, { ...workspace, workflow: "review" }, now)
      .defaultView,
    "review",
  );
  assert.equal(
    codingHandoffPresentation(job, workspace, workspace.previewExpiresAt)
      .defaultView,
    "review",
  );
  assert.equal(
    codingHandoffPresentation(
      { ...job, status: "running" },
      { ...workspace, workflow: "working" },
      now,
    ).defaultView,
    "overview",
  );
  for (const status of ["blocked", "failed", "cancelled"] as const) {
    const presentation = codingHandoffPresentation(
      { ...job, status },
      workspace,
      now,
    );
    assert.equal(presentation.defaultView, "overview");
    assert.deepEqual(presentation.availableViews, [
      "overview",
      "review",
      "try",
    ]);
    for (const view of presentation.availableViews)
      assert.ok(validateCodingHandoffPlan(presentation.plans[view], id));
  }
  assert.equal(
    codingHandoffPresentation({ ...job, cancelRequested: true }, workspace, now)
      .defaultView,
    "overview",
  );
});
