import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import type { ChatEvent } from "../src/features/chat/schema";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import { closeAgentRuntimes } from "../src/server/codex/agent-runtime.server";
import {
  readConversation,
  sendConversation,
} from "../src/server/codex/conversation.server";
import {
  downloadFileRequest,
  sameOriginFileRequest,
  uploadFileRequest,
} from "../src/server/files/http.server";
import {
  downloadFile,
  publishArtifact,
  readRunAttachments,
  uploadAttachment,
} from "../src/server/files/store.server";
import {
  claimRun,
  enqueueChat,
  schedulerTick,
} from "../src/server/runs/store.server";
import { readTimeline } from "../src/server/runs/timeline.server";

const run = Effect.runPromise;
const create = (name: string) =>
  run(
    saveAgent({
      id: randomUUID(),
      name,
      instructions: "Help",
      character: "moss",
      model: "fake",
    }),
  );

async function fixture(task: (directory: string) => Promise<void>) {
  const directory = mkdtempSync("/tmp/roost-files-test-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    await task(directory);
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
}

test("uploads and downloads enforce same origin, scope, size and safe response headers", async () =>
  fixture(async () => {
    assert.equal(
      sameOriginFileRequest(
        new Request("http://upstream/api/files", {
          headers: {
            origin: "https://roost.example",
            "sec-fetch-site": "same-origin",
          },
        }),
      ),
      true,
    );
    assert.equal(
      sameOriginFileRequest(
        new Request("http://localhost/api/files", {
          headers: {
            origin: "http://localhost",
            "sec-fetch-site": "cross-site",
          },
        }),
      ),
      false,
    );
    const owner = await create("Owner");
    const other = await create("Other");
    const form = new FormData();
    form.set("agentId", owner.id);
    form.set(
      "file",
      new File(["private contents"], "notes.txt", { type: "text/plain" }),
    );
    const response = await uploadFileRequest(
      new Request("http://localhost/api/files", {
        method: "POST",
        headers: { origin: "http://localhost" },
        body: form,
      }),
    );
    assert.equal(response.status, 200);
    const file = await response.json();
    const request = (url: string, site = "same-origin") =>
      new Request(`http://localhost${url}`, {
        headers: { "sec-fetch-site": site },
      });
    const downloaded = await downloadFileRequest(request(file.url));
    assert.equal(await downloaded.text(), "private contents");
    assert.equal(downloaded.headers.get("cache-control"), "no-store");
    assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
    assert.match(
      downloaded.headers.get("content-disposition")!,
      /^attachment;.*notes.txt/,
    );
    assert.equal(
      (await downloadFileRequest(request(file.url, "cross-site"))).status,
      403,
    );
    assert.equal(
      (await downloadFileRequest(new Request(`http://localhost${file.url}`)))
        .status,
      403,
    );
    await assert.rejects(run(downloadFile(other.id, file.id)), /not found/);
    assert.equal(
      (
        await uploadFileRequest(
          new Request("http://localhost/api/files", {
            method: "POST",
            headers: { origin: "https://elsewhere.test" },
            body: form,
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await uploadFileRequest(
          new Request("http://localhost/api/files", {
            method: "POST",
            headers: {
              origin: "http://localhost",
              "content-type": "multipart/form-data; boundary=test",
              "content-length": String(21 * 1024 * 1024),
            },
            body: "x",
          }),
        )
      ).status,
      413,
    );
  }));

test("attachments link atomically to one message and retries cannot change accepted inputs", async () =>
  fixture(async () => {
    const agent = await create("Owner");
    const other = await create("Other");
    const file = await run(
      uploadAttachment({
        agentId: agent.id,
        name: "notes.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("notes"),
      }),
    );
    const input = {
      agentId: agent.id,
      messageId: randomUUID(),
      text: "",
      attachmentIds: [file.id],
    };
    await assert.rejects(
      run(enqueueChat({ ...input, agentId: other.id })),
      /unavailable/,
    );
    assert.equal(
      await run(
        withAgentStore((db) =>
          db.prepare("SELECT * FROM runs WHERE id=?").get(input.messageId),
        ),
      ),
      undefined,
    );
    await run(enqueueChat(input));
    await run(enqueueChat(input));
    assert.deepEqual((await run(readTimeline(agent.id)))[0]?.files, [file]);
    assert.equal(
      (await run(readRunAttachments(agent.id, input.messageId))).length,
      1,
    );
    await assert.rejects(
      run(enqueueChat({ ...input, text: "changed" })),
      /already been used/,
    );
    await assert.rejects(
      run(enqueueChat({ ...input, messageId: randomUUID() })),
      /unavailable/,
    );
    const plain = {
      ...input,
      messageId: randomUUID(),
      text: "plain",
      attachmentIds: [],
    };
    await run(enqueueChat(plain));
    await assert.rejects(
      run(enqueueChat({ ...plain, attachmentIds: [file.id] })),
      /different files/,
    );
    await assert.rejects(
      run(enqueueChat({ ...plain, messageId: randomUUID(), text: "" })),
      /attach a file/,
    );
  }));

test("published outputs are immutable snapshots and reject traversal, symlinks and inactive runs", async () =>
  fixture(async (directory) => {
    const agent = await create("Owner");
    const input = {
      agentId: agent.id,
      messageId: randomUUID(),
      text: "Make a report",
    };
    await run(enqueueChat(input));
    const workspace = join(directory, "workspaces", agent.id);
    writeFileSync(join(workspace, "report.txt"), "original");
    await assert.rejects(
      run(publishArtifact(agent.id, input.messageId, { path: "report.txt" })),
      /active run/,
    );
    await run(schedulerTick("files-test"));
    await run(claimRun("files-test"));
    const published = await run(
      publishArtifact(agent.id, input.messageId, { path: "report.txt" }),
    );
    writeFileSync(join(workspace, "report.txt"), "changed");
    assert.equal(
      (await run(downloadFile(agent.id, published.id))).bytes.toString(),
      "original",
    );
    assert.deepEqual((await run(readTimeline(agent.id))).at(-1)?.files, [
      published,
    ]);
    await run(
      withAgentStore((db) =>
        db.exec(
          "CREATE TRIGGER fail_artifact_notice BEFORE INSERT ON timeline BEGIN SELECT RAISE(ABORT, 'unavailable'); END;",
        ),
      ),
    );
    await assert.rejects(
      run(publishArtifact(agent.id, input.messageId, { path: "report.txt" })),
    );
    assert.deepEqual(readdirSync(join(directory, "files", agent.id)), [
      published.id,
    ]);
    assert.equal(
      await run(
        withAgentStore((db) =>
          Number(
            db
              .prepare("SELECT COUNT(*) AS count FROM files WHERE agentId=?")
              .get(agent.id)!.count,
          ),
        ),
      ),
      1,
    );
    assert.equal(
      readFileSync(join(workspace, "report.txt"), "utf8"),
      "changed",
    );
    await run(
      withAgentStore((db) => db.exec("DROP TRIGGER fail_artifact_notice")),
    );
    const outside = join(directory, "secret.txt");
    writeFileSync(outside, "secret");
    symlinkSync(outside, join(workspace, "link.txt"));
    symlinkSync(directory, join(workspace, "linked-folder"));
    for (const path of [
      "../../secret.txt",
      outside,
      "link.txt",
      "linked-folder/secret.txt",
    ])
      await assert.rejects(
        run(publishArtifact(agent.id, input.messageId, { path })),
      );
    await run(
      withAgentStore((db) =>
        db
          .prepare("UPDATE runs SET cancelRequested=1 WHERE id=?")
          .run(input.messageId),
      ),
    );
    await assert.rejects(
      run(publishArtifact(agent.id, input.messageId, { path: "report.txt" })),
      /active run/,
    );
  }));

test("Codex receives document paths and image inputs while conversation preserves original user text", async () =>
  fixture(async (directory) => {
    const previousHome = process.env.CODEX_HOME;
    const previousBinary = process.env.ROOST_CODEX_BINARY;
    process.env.CODEX_HOME = directory;
    process.env.ROOST_CODEX_BINARY = fileURLToPath(
      new URL("./fixtures/chat-server.mjs", import.meta.url),
    );
    writeFileSync(
      join(directory, "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "fake" }),
    );
    try {
      const agent = await create("Reader");
      const image = await run(
        uploadAttachment({
          agentId: agent.id,
          name: "image.png",
          mimeType: "image/png",
          bytes: Buffer.from("fake image"),
        }),
      );
      const document = await run(
        uploadAttachment({
          agentId: agent.id,
          name: "report.pdf",
          mimeType: "application/pdf",
          bytes: Buffer.from("fake pdf"),
        }),
      );
      const input = {
        agentId: agent.id,
        messageId: randomUUID(),
        text: "Summarize these",
        attachmentIds: [image.id, document.id],
      };
      await run(enqueueChat(input));
      const events: ChatEvent[] = [];
      await run(sendConversation(input, (event) => events.push(event)));
      const stored = JSON.parse(
        readFileSync(
          join(directory, "agents", agent.id, "codex", "fake-thread.json"),
          "utf8",
        ),
      );
      const content = stored.turns[0].items[0].content;
      assert.equal(content[0].text, input.text);
      assert.match(content[1].text, /report.pdf/);
      assert.equal(content[2].type, "localImage");
      assert.equal(readFileSync(content[2].path, "utf8"), "fake image");
      for (const event of events) {
        if (event.type !== "history") continue;
        const user = event.messages.find(
          (message) => message.id === input.messageId,
        )!;
        assert.equal(user.text, input.text);
        assert.equal(user.files?.length, 2);
        assert.ok(!JSON.stringify(user).includes(directory));
      }
      assert.equal(
        (await run(readConversation(agent.id))).messages[0]?.text,
        input.text,
      );
    } finally {
      await closeAgentRuntimes();
      if (previousHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousHome;
      if (previousBinary === undefined) delete process.env.ROOST_CODEX_BINARY;
      else process.env.ROOST_CODEX_BINARY = previousBinary;
    }
  }));
