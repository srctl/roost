import assert from "node:assert/strict";
import { test } from "node:test";
import { noteSaveStatus } from "../src/features/notes/save-status";

const clean = {
  status: "Unsaved changes",
  dirty: false,
  ready: true,
  online: true,
  busy: false,
  pending: false,
  conflict: false,
  recovery: false,
  error: "",
};

test("typing/deleting and Undo/Redo back to the saved baseline need no autosave to report Saved", () => {
  const saved = [{ id: "stable-id", content: [{ text: "Saved text" }] }];
  const edited = [{ ...saved[0], content: [{ text: "Saved text!" }] }];
  // Every editor update sets Unsaved changes, including the final history event.
  // No successful save callback occurs when the debounce is cancelled by undo.
  for (const local of [edited, saved, edited, saved]) {
    assert.equal(
      noteSaveStatus({
        ...clean,
        dirty: JSON.stringify(local) !== JSON.stringify(saved),
      }),
      local === saved ? "Saved" : "Unsaved changes",
    );
  }
  assert.equal(
    noteSaveStatus({ ...clean, dirty: true }),
    "Unsaved changes",
    "instructions still differ even when blocks match",
  );
});

test("returning to baseline while a write is unresolved stays unsaved until acknowledgement and reconciliation", () => {
  assert.equal(
    noteSaveStatus({ ...clean, busy: true, pending: true }),
    "Unsaved changes",
  );
  assert.equal(
    noteSaveStatus({ ...clean, pending: true }),
    "Unsaved changes",
    "a lost response may still have committed the edited snapshot",
  );
  assert.equal(
    noteSaveStatus({
      ...clean,
      pending: true,
      status: "Not saved",
      error: "Response lost",
    }),
    "Not saved",
  );
  // The acknowledgement advances the base to the submitted edit. The local
  // undo is now dirty against that base and must itself save before reporting Saved.
  assert.equal(
    noteSaveStatus({ ...clean, dirty: true, status: "Saved" }),
    "Unsaved changes",
  );
  assert.equal(noteSaveStatus({ ...clean, status: "Saved" }), "Saved");
});

test("clean content never normalizes pending remote, recovery, offline, or failure states", () => {
  for (const guard of [
    { ready: false },
    { conflict: true },
    { recovery: true },
    { error: "Save failed" },
  ])
    assert.equal(noteSaveStatus({ ...clean, ...guard }), "Unsaved changes");
  assert.equal(
    noteSaveStatus({ ...clean, online: false }),
    "Offline · draft kept on this device",
  );
  for (const status of [
    "Saving…",
    "Restoring…",
    "Not saved",
    "Restore failed",
    "Restore not confirmed",
    "Restored on server · resolve your newer edits",
    "Unsaved draft found",
  ])
    assert.equal(noteSaveStatus({ ...clean, status }), status);
});
