/** Local-only native UI test server. Uses real Roost stores/API; no Codex process. */
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import type { CodexLogin } from "../../src/features/auth/schema";
import {
  listAgents,
  saveAgent,
  withAgentStore,
} from "../../src/server/agents/store.server";
import { createApproval } from "../../src/server/approvals/store.server";
import {
  createCodingJob,
  updateCodingJob,
} from "../../src/server/coding/store.server";
import {
  readCodingWorkspace,
  writeCodingWorkspace,
} from "../../src/server/coding/workspace-store.server";
import { createDashboardTracker } from "../../src/server/dashboards/actions.server";
import { showDashboard } from "../../src/server/dashboards/chat.server";
import {
  saveDashboard,
  saveDataset,
  setDashboardPreference,
} from "../../src/server/dashboards/store.server";
import {
  WeatherProvider,
  weatherProvider,
} from "../../src/server/dashboards/weather-provider.server";
import {
  DEFAULT_FEED_SETTINGS,
  putFeedItem,
  saveFeedSettings,
} from "../../src/server/feed/store.server";
import { uploadAttachment } from "../../src/server/files/store.server";
import { createMobileAccountRequest } from "../../src/server/mobile/account.server";
import { createMobileAgentManagementRequest } from "../../src/server/mobile/agent-management.server";
import { createMobileHandler } from "../../src/server/mobile/http.server";
import { MobileTokens } from "../../src/server/mobile/tokens.server";
import { saveNote } from "../../src/server/notes/store.server";
import {
  enqueueChat,
  finishRun,
  type Run,
} from "../../src/server/runs/store.server";
import { putMessage } from "../../src/server/runs/timeline.server";

const root = mkdtempSync(join(tmpdir(), "roost-native-ui-"));
process.env.ROOST_DATA_DIR = root;
// Local photo for native Feed image/layout verification; credit is beside the
// fixture and in its story. Never fetch a publisher image or send credentials.
const feedImage = readFileSync(
  process.env.ROOST_FEED_FIXTURE_IMAGE ??
    new URL("./feed-neighborhood.jpg", import.meta.url),
);
const run = Effect.runPromise;
let loseNextSendResponse = false;
let fixtureLogin: CodexLogin = { status: "idle" };
let rejectNextSend = false;
let fixtureAgentId = "";
const weatherCity = {
  id: 5809844,
  name: "Seattle",
  admin1: "Washington",
  country: "United States",
  latitude: 47.6062,
  longitude: -122.3321,
  timezone: "America/Los_Angeles",
};
function fixtureForecast(temperatureUnit: string) {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: weatherCity.timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, Number(part.value)]),
  );
  const offset =
    (Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ) -
      Math.floor(now.getTime() / 1000) * 1000) /
    1000;
  const midnight =
    Date.UTC(parts.year, parts.month - 1, parts.day) / 1000 - offset;
  const fahrenheit = temperatureUnit === "fahrenheit";
  const unit = fahrenheit ? "°F" : "°C";
  return {
    utc_offset_seconds: offset,
    current_units: {
      temperature_2m: unit,
      apparent_temperature: unit,
      wind_speed_10m: "km/h",
    },
    daily_units: { temperature_2m_max: unit, temperature_2m_min: unit },
    current: {
      time: Math.floor(now.getTime() / 1000),
      temperature_2m: fahrenheit ? 68 : 20,
      apparent_temperature: fahrenheit ? 66 : 19,
      weather_code: 2,
      is_day: 1,
      wind_speed_10m: 12,
    },
    daily: {
      time: Array.from({ length: 5 }, (_, i) => midnight + i * 86400),
      weather_code: [2, 3, 61, 2, 0],
      temperature_2m_max: fahrenheit
        ? [72, 70, 66, 69, 73]
        : [22, 21, 19, 21, 23],
      temperature_2m_min: fahrenheit
        ? [54, 53, 51, 52, 54]
        : [12, 12, 11, 11, 12],
      precipitation_probability_max: [10, 20, 70, 25, 5],
    },
  };
}

function installWeatherFixture() {
  // Local-only transport: exercise the real provider validation/cache and all
  // authenticated routes without transferring searches or locations externally.
  const local = new WeatherProvider({
    transport: {
      search: async (query) => ({
        results: query.toLowerCase().includes("seattle") ? [weatherCity] : [],
      }),
      location: async () => weatherCity,
      forecast: async (_location, unit) => fixtureForecast(unit),
    },
  });
  weatherProvider.search = local.search.bind(local);
  weatherProvider.location = local.location.bind(local);
  weatherProvider.forecast = local.forecast.bind(local);
}
async function seed() {
  installWeatherFixture();
  loseNextSendResponse = false;
  fixtureLogin = { status: "idle" };
  rejectNextSend = false;
  rmSync(root, { recursive: true, force: true });
  const tokens = new MobileTokens(root);
  const device = tokens.create("UI test fixture");
  tokens.close();
  const db = new DatabaseSync(join(root, "mobile.sqlite"));
  // This public test-only credential is valid solely in the disposable fixture.
  db.prepare("UPDATE devices SET hash=? WHERE id=?").run(
    createHash("sha256")
      .update(`roost_mobile_${"a".repeat(43)}`)
      .digest("hex"),
    device.id,
  );
  db.close();
  const moss = await run(
    saveAgent({
      id: randomUUID(),
      name: "Moss",
      instructions: "A little care for your plants, every day.",
      character: "moss",
      model: "fixture",
    }),
  );
  fixtureAgentId = moss.id;
  const wisp = await run(
    saveAgent({
      id: randomUUID(),
      kind: "coding",
      name: "Wisp",
      instructions: "Research, reading, and good questions.",
      character: "wisp",
      model: "fixture",
    }),
  );
  await run(
    saveAgent({
      id: randomUUID(),
      name: "Peach",
      instructions: "Make room for the things you love.",
      character: "peach",
      model: "fixture",
    }),
  );
  await run(setDashboardPreference(true));
  await run(
    saveFeedSettings({
      ...DEFAULT_FEED_SETTINGS,
      enabled: false,
      agentId: wisp.id,
      interests:
        "Seattle, Capitol Hill, neighborhood gardens, and local culture.",
      priorities: "Weekend plans and important reservation changes.",
    }),
  );
  await run(
    withAgentStore((db) => {
      const now = Date.now();
      for (const [index, item] of [
        {
          id: "8015a702-9046-4513-8567-a3daf8b31111",
          kind: "story" as const,
          title: "Why Seattle’s little gardens matter",
          summary:
            "The small spaces connecting neighbors, one growing season at a time.",
          body: "Seattle’s neighborhood gardens offer room to grow food and connect with the people nearby. This is a fictional story for the native test fixture.",
          sourceName: "Wisp",
          why: "You follow neighborhood gardens and local culture.",
        },
        {
          id: "8015a702-9046-4513-8567-a3daf8b32222",
          kind: "update" as const,
          title: "Your dinner reservation moved to 7:30",
          summary: "A reservation update worth checking before you head out.",
          body: "Your fictional dinner reservation is now at 7:30 PM. This is a test fixture, not a real email.",
          sourceName: "Email",
          why: "This changes your plans for tonight.",
        },
        {
          id: "8015a702-9046-4513-8567-a3daf8b33333",
          kind: "article" as const,
          title: "A greener walk through Capitol Hill",
          summary:
            "A fictional neighborhood project explores greener streets and more space to walk through Capitol Hill, bringing together shade, safer crossings, and places to pause. The proposal in this local test story connects everyday walking routes with small public spaces where neighbors could rest, meet, or enjoy the trees. Its details are sample content for checking the Feed reader; the accompanying photograph shows an existing neighborhood streetscape and does not document a planned or completed project.",
          body: "A new neighborhood project explores greener streets and more space to walk. This is a fictional article used to verify the native feed.\n\nFollow the original source for the full story.\n\nPhoto: [Joe Mabel, April 3, 2017 — Seattle, Volunteer Park Seventh Day Adventist Church](https://commons.wikimedia.org/wiki/File:Seattle_-_Volunteer_Park_Seventh_Day_Adventist_Church_02.jpg), licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The photograph is displayed with a landscape crop.",
          sourceName: "Capitol Hill Seattle Blog",
          why: "You follow Capitol Hill news and changes to neighborhood public spaces.",
        },
      ].entries()) {
        putFeedItem(
          db,
          {
            ...item,
            url:
              item.kind === "update"
                ? null
                : "https://example.com/fixture/neighborhood",
            imageUrl:
              item.kind === "article"
                ? "http://127.0.0.1:4399/__fixture/feed-photo.jpg"
                : null,
            sourceUrl: "https://example.com",
            authorAgentId: item.kind === "article" ? null : wisp.id,
            publishedAt: now - (3 - index) * 3_600_000,
            createdAt: now - (3 - index) * 60_000,
            readAt: null,
            saved: false,
            dismissed: false,
            topics: ["Seattle", "Capitol Hill"],
            importance: item.kind === "update" ? "important" : "normal",
            score: 0.9,
            scoring: item.kind === "article" ? "basic" : "agent",
            citations:
              item.kind === "update"
                ? []
                : [
                    {
                      title: "Original source",
                      url: "https://example.com/fixture/neighborhood",
                    },
                    ...(item.kind === "article"
                      ? [
                          {
                            title: "Photo: Joe Mabel · CC BY-SA 4.0",
                            url: "https://commons.wikimedia.org/wiki/File:Seattle_-_Volunteer_Park_Seventh_Day_Adventist_Church_02.jpg",
                          },
                        ]
                      : []),
                  ],
          },
          `fixture:${item.id}`,
        );
      }
    }),
  );
  await run(
    saveDataset(moss.id, {
      key: "herb-growth",
      title: "Balcony herb growth",
      description: "Weekly sample measurements in centimeters.",
      columns: [
        { key: "week", label: "Week", type: "string" },
        { key: "basil", label: "Basil", type: "number" },
        { key: "mint", label: "Mint", type: "number" },
      ],
      rows: [
        ["Aug 23", 4, 6],
        ["Aug 30", 7, 8],
        ["Sep 6", 11, 10],
        ["Sep 13", 16, 13],
      ],
    }),
  );
  await run(
    saveDashboard(moss.id, {
      key: "balcony",
      title: "A little greener every week",
      blocks: [
        {
          type: "metrics",
          items: [
            { label: "Happy plants", value: "8", note: "All looking healthy" },
            { label: "New growth", value: "+5 cm", note: "Basil this week" },
          ],
        },
        {
          type: "dataset-chart",
          title: "Growing together",
          datasetKey: "herb-growth",
          style: "line",
          x: "week",
          series: [
            { column: "basil", label: "Basil" },
            { column: "mint", label: "Mint" },
          ],
        },
        {
          type: "tasks",
          items: [
            { label: "Water the herbs", status: "done" },
            { label: "Rotate the basil toward the sun", status: "todo" },
          ],
        },
      ],
    }),
  );
  await run(
    saveNote(moss.id, {
      requestId: randomUUID(),
      revision: 0,
      blocks: [
        {
          id: randomUUID(),
          type: "heading",
          level: 1,
          content: [{ text: "Our balcony garden" }],
        },
        {
          id: randomUUID(),
          type: "paragraph",
          content: [
            { text: "A small space, " },
            { text: "a little more green.", italic: true },
          ],
        },
        {
          id: randomUUID(),
          type: "heading",
          level: 2,
          content: [{ text: "This week" }],
        },
        {
          id: randomUUID(),
          type: "todo",
          checked: false,
          content: [{ text: "Pick up a terracotta pot for the basil" }],
        },
        {
          id: randomUUID(),
          type: "todo",
          checked: true,
          content: [{ text: "Move the mint to morning sunlight" }],
        },
        {
          id: randomUUID(),
          type: "paragraph",
          content: [
            { text: "Remember: ", bold: true },
            { text: "check the soil before watering." },
          ],
        },
      ],
    }),
  );
  const job = await run(
    createCodingJob({
      id: randomUUID(),
      agentId: wisp.id,
      title: "A calmer garden dashboard",
      brief:
        "Create a responsive garden dashboard with readable charts and a clear weekly checklist.",
      cwd: root,
      sessionName: "native-fixture",
      workerName: "fixture-worker",
      workerKind: "codex",
    }),
  );
  await run(
    updateCodingJob(wisp.id, job.id, {
      status: "review",
      sessionIdentity: "fixture-session",
      nativeSessionId: "fixture-native",
      lastWorkerState: "idle",
      summary: "The layout and charts are ready for your feedback.",
    }),
  );
  await run(
    withAgentStore((db) =>
      writeCodingWorkspace(db, {
        ...readCodingWorkspace(db, wisp.id, job.id),
        workflow: "feedback",
        latestChanges:
          "A quieter layout, native chart colors, and a weekly checklist. Everything adapts to a narrow screen.",
        verification:
          "Fixture preview: responsive layout and sample data checked.",
        previewRevision: "garden-v3",
        previewAvailability: "not_needed",
      }),
    ),
  );
  const runId = randomUUID();
  await run(
    enqueueChat({
      agentId: moss.id,
      messageId: runId,
      text: "How is the balcony garden looking?",
    }),
  );
  await run(
    withAgentStore((store) => {
      store
        .prepare(
          "UPDATE runs SET status='running',threadId='ui-fixture' WHERE id=?",
        )
        .run(runId);
      putMessage(store, moss.id, {
        id: "fixture-activity",
        role: "activity",
        title: "Fixture tool activity",
        text: "Fixture tool output",
        status: "completed",
      });
      putMessage(store, moss.id, {
        id: "welcome",
        role: "assistant",
        text: "The garden is ready for a fresh start.",
      });
    }),
  );
  await run(
    createApproval(
      {
        agentId: moss.id,
        runId,
        threadId: "ui-fixture",
        requestKey: "reminder",
      },
      {
        title: "Add a watering reminder?",
        details: "Create a reminder to check the herbs each Sunday morning.",
      },
    ),
  );
}
await seed();
const handle = createMobileHandler(
  async () => {},
  createMobileAgentManagementRequest(
    Effect.succeed({
      models: [{ model: "fixture", displayName: "Fixture", isDefault: true }],
    }),
  ),
  createMobileAccountRequest({
    getAccount: async () => ({ configured: false }),
    getLogin: () => fixtureLogin,
    startLogin: async () =>
      (fixtureLogin = {
        status: "pending",
        loginId: "fixture-login",
        userCode: "TEST-CODE",
        verificationUrl: "https://auth.openai.com/codex/device",
      }),
    cancelLogin: async () => (fixtureLogin = { status: "idle" }),
  }),
);
const server = createServer(async (incoming, outgoing) => {
  try {
    if (
      incoming.url === "/__fixture/feed-photo.jpg" &&
      incoming.method === "GET"
    ) {
      outgoing.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Length": feedImage.byteLength,
        "Cache-Control": "no-store",
      });
      outgoing.end(feedImage);
      return;
    }
    if (
      incoming.url === "/__fixture/images" &&
      incoming.method === "POST" &&
      incoming.headers["x-roost-test"] === "reset"
    ) {
      const moss = (await run(listAgents())).find(
        (agent) => agent.name === "Moss",
      )!;
      const image = await run(
        uploadAttachment({
          agentId: moss.id,
          name: "Roost garden.png",
          mimeType: "image/png",
          bytes: readFileSync(
            new URL(
              "../../../ios/Roost/Resources/Assets.xcassets/AppIcon.appiconset/Icon.png",
              import.meta.url,
            ),
          ),
        }),
      );
      const document = await run(
        uploadAttachment({
          agentId: moss.id,
          name: "Garden notes.txt",
          mimeType: "text/plain",
          bytes: Buffer.from("Water the herbs each morning."),
        }),
      );
      await run(
        withAgentStore((db) => {
          db.prepare("UPDATE runs SET status='completed' WHERE agentId=?").run(
            moss.id,
          );
          db.prepare("DELETE FROM approvals WHERE agentId=?").run(moss.id);
          putMessage(db, moss.id, {
            id: "fixture-image",
            role: "assistant",
            text: "Here is your garden picture.",
            files: [image, document],
          });
        }),
      );
      outgoing.writeHead(200, { "Content-Type": "application/json" });
      outgoing.end(JSON.stringify({ agentId: moss.id, image, document }));
      return;
    }
    if (
      incoming.url === "/__fixture/reject-next-send" &&
      incoming.method === "POST" &&
      incoming.headers["x-roost-test"] === "reset"
    ) {
      rejectNextSend = true;
      outgoing.writeHead(204);
      outgoing.end();
      return;
    }
    if (
      incoming.url === "/__fixture/expire-token" &&
      incoming.method === "POST" &&
      incoming.headers["x-roost-test"] === "reset"
    ) {
      const db = new DatabaseSync(join(root, "mobile.sqlite"));
      db.prepare("UPDATE devices SET expires=0").run();
      db.close();
      const tokens = new MobileTokens(root);
      const replacement = tokens.create("Replacement UI test fixture");
      tokens.close();
      const updated = new DatabaseSync(join(root, "mobile.sqlite"));
      updated.prepare("UPDATE devices SET hash=? WHERE id=?").run(
        createHash("sha256")
          .update(`roost_mobile_${"b".repeat(43)}`)
          .digest("hex"),
        replacement.id,
      );
      updated.close();
      outgoing.writeHead(204);
      outgoing.end();
      return;
    }
    if (
      incoming.url === "/__fixture/lose-next-send-response" &&
      incoming.method === "POST" &&
      incoming.headers["x-roost-test"] === "reset"
    ) {
      loseNextSendResponse = true;
      outgoing.writeHead(204);
      outgoing.end();
      return;
    }
    if (
      incoming.url === "/__fixture/reset" &&
      incoming.method === "POST" &&
      incoming.headers["x-roost-test"] === "reset"
    ) {
      await seed();
      outgoing.writeHead(204);
      outgoing.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    if (
      incoming.url === "/__fixture/chat-tracker" &&
      incoming.method === "POST" &&
      incoming.headers["x-roost-test"] === "reset"
    ) {
      const input = JSON.parse(Buffer.concat(chunks).toString());
      await run(
        createDashboardTracker(fixtureAgentId, {
          key: input.key,
          kind: input.kind,
          title: input.title,
          ...(input.kind === "weather"
            ? { locationId: input.locationId, unit: input.unit }
            : {}),
        }),
      );
      await run(
        withAgentStore((db) => {
          db.prepare("UPDATE runs SET status='completed' WHERE agentId=?").run(
            fixtureAgentId,
          );
        }),
      );
      const runId = randomUUID();
      await run(
        enqueueChat({
          agentId: fixtureAgentId,
          messageId: runId,
          conversationId: input.conversationId,
          text: `Show my ${input.title.toLowerCase()} here.`,
        }),
      );
      await run(
        withAgentStore((db) => {
          db.prepare(
            "UPDATE runs SET status='running',threadId='ui-fixture-chat' WHERE id=?",
          ).run(runId);
        }),
      );
      const shown = await run(
        showDashboard(fixtureAgentId, runId, { key: input.key }),
      );
      if (input.complete === true) {
        const completed = await run(
          withAgentStore(
            (db) =>
              db
                .prepare(
                  "UPDATE runs SET owner='ui-fixture-chat' WHERE id=? RETURNING *",
                )
                .get(runId) as Run,
          ),
        );
        await run(finishRun(completed, "completed", []));
      }
      outgoing.writeHead(200, { "Content-Type": "application/json" });
      outgoing.end(JSON.stringify({ agentId: fixtureAgentId, ...shown }));
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers))
      if (value)
        headers.set(key, Array.isArray(value) ? value.join(",") : value);
    const request = new Request(`http://127.0.0.1:4399${incoming.url}`, {
      method: incoming.method,
      headers,
      ...(["GET", "HEAD"].includes(incoming.method ?? "GET")
        ? {}
        : { body: Buffer.concat(chunks) }),
    });
    if (
      request.method === "GET" &&
      /\/agents\/[^/]+\/automations\/models$/.test(
        new URL(request.url).pathname,
      ) &&
      request.headers.get("authorization") ===
        `Bearer roost_mobile_${"a".repeat(43)}`
    ) {
      outgoing.writeHead(200, { "Content-Type": "application/json" });
      outgoing.end(
        JSON.stringify({
          models: [{ model: "fixture", displayName: "Fixture" }],
        }),
      );
      return;
    }
    if (
      rejectNextSend &&
      incoming.method === "POST" &&
      incoming.url?.endsWith("/messages")
    ) {
      rejectNextSend = false;
      outgoing.writeHead(400, { "Content-Type": "application/json" });
      outgoing.end(
        JSON.stringify({
          error: "Fixture rejected this message. Edit and retry.",
          code: "message_rejected",
        }),
      );
      return;
    }
    const response =
      (await handle(request)) ?? new Response("Not found", { status: 404 });
    // Exercise an ambiguous delivery: the real API accepted and stored the
    // message, but the client did not receive its successful response.
    if (
      loseNextSendResponse &&
      incoming.method === "POST" &&
      incoming.url?.endsWith("/messages")
    ) {
      loseNextSendResponse = false;
      outgoing.writeHead(503, { "Content-Type": "application/json" });
      outgoing.end(JSON.stringify({ error: "Fixture response interrupted" }));
      return;
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500);
    outgoing.end("Fixture failed");
  }
});
server.listen(4399, "127.0.0.1", () =>
  console.log("Native UI fixture ready on 127.0.0.1:4399"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () =>
    server.close(() => {
      rmSync(root, { recursive: true, force: true });
      process.exit(0);
    }),
  );
