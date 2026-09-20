import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type FileAttachment,
  safeAttachmentUrl,
} from "../src/features/chat/files";

const id = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";
const file: FileAttachment = {
  id,
  name: "Garden.png",
  mimeType: "image/png",
  size: 10,
  kind: "attachment",
  url: `/api/files?agentId=${agentId}&id=${id}`,
};

test("attachment URLs stay on the protected file endpoint and match the saved file identity", () => {
  assert.equal(safeAttachmentUrl(file), file.url);
  assert.equal(
    safeAttachmentUrl({
      ...file,
      url: `${file.url}&redirect=https://external.test#fragment`,
    }),
    file.url,
  );
  for (const url of [
    "https://external.test/tracking.png",
    `https://roost.invalid${file.url}`,
    "//external.test/tracking.png",
    "javascript:alert(1)",
    "data:image/svg+xml,<svg></svg>",
    "blob:https://external.test/id",
    `/api/files?agentId=${agentId}&id=${agentId}`,
    `/api/files?agentId=../../secrets&id=${id}`,
    `/api/files?agentId=${agentId}&id=${id}%0a`,
    "/api/other?image=1",
  ]) {
    assert.equal(safeAttachmentUrl({ ...file, url }), undefined, url);
  }
});
