import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  captureWorkerResponse,
  responseCaptureInstruction,
  responseFrame,
} from "../src/server/coding/response-capture.server";

const id = "5a9a46e2-c3db-4cb2-8cc4-eb5fa9682227";
const { begin, end } = responseFrame(id);
const frame = `${begin}\nThe actual answer\n${end}`;

test("actual Codex 0.154.0 / Herdr 0.9.0 screen isolates latest answer from echoed prompt and previous reply", () => {
  // Excerpt from isolated live Astra verification, Herdr recent-unwrapped,
  // 2026-09-13. Removed session startup, replaced request tokens, local URL,
  // revision and workspace path; retained actual wrapping, bullets and chrome.
  const snapshot = readFileSync(
    new URL("./fixtures/codex-herdr-reply.txt", import.meta.url),
    "utf8",
  );
  const baseline = snapshot.slice(0, snapshot.indexOf("› Task:"));
  const beforeReply = snapshot.slice(0, snapshot.indexOf(`• ${begin}`));
  const echoedPrompt = beforeReply.slice(beforeReply.indexOf("› Task:"));
  assert.equal(
    captureWorkerResponse(id, baseline, snapshot, echoedPrompt),
    "PR37_JOBPAGE_TWO",
  );
  assert.equal(
    captureWorkerResponse(id, baseline, beforeReply, echoedPrompt),
    null,
  );
  assert.equal(
    captureWorkerResponse(id, snapshot, snapshot, echoedPrompt),
    null,
  );
  assert.equal(
    captureWorkerResponse("third-request", baseline, snapshot, echoedPrompt),
    null,
  );
});

test("isolates a complete per-request reply after a real terminal-style redraw and bullet", () => {
  const prompt = responseCaptureInstruction(id);
  assert.ok(!prompt.includes(begin) && !prompt.includes(end));
  assert.equal(
    captureWorkerResponse(
      id,
      "Old screen",
      `Old answer\n› Task:\n${prompt}\n• ${frame}\n› Type a message\n100% context left`,
    ),
    "The actual answer",
  );
});

test("rejects prompt echo, old snapshots, wrong requests, partial frames and ambiguous repeats", () => {
  for (const output of [
    `Old answer\n› ${responseCaptureInstruction(id)}`,
    `${begin}\nPartial output`,
    `Clipped beginning\n${end}`,
    `${frame}\n${frame}`,
    `› ${frame}`,
    `${begin} inline answer ${end}`,
    `${end}\n${begin}`,
    `${begin}\n\n${end}`,
  ])
    assert.equal(captureWorkerResponse(id, "Old screen", output), null);
  assert.equal(captureWorkerResponse("another-request", "", frame), null);
  assert.equal(
    captureWorkerResponse(id, "", frame, `User asked to echo:\n${frame}`),
    null,
  );
  assert.equal(
    captureWorkerResponse(id, frame, `${frame}\nstatus update`),
    null,
  );
});
