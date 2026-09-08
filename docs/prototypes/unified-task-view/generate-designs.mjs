import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Native editable Excalidraw rectangles/text. No flattened screenshot elements.
const directory = fileURLToPath(new URL("./designs/", import.meta.url));
let elements = [];
let serial = 0;

function element(type, x, y, width, height, extra = {}) {
  const id = `shape-${++serial}`;
  elements.push({
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#30382c",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: serial,
    version: 1,
    versionNonce: serial,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...extra,
  });
}

function rect(x, y, width, height, color = "#ffffff") {
  element("rectangle", x, y, width, height, {
    backgroundColor: color,
    strokeColor: "#b8c3af",
  });
}

function text(x, y, value, size = 16, color = "#30382c") {
  const lines = value.split("\n");
  element(
    "text",
    x,
    y,
    Math.max(...lines.map((line) => line.length)) * size * 0.56,
    lines.length * size * 1.25,
    {
      text: value,
      originalText: value,
      fontSize: size,
      fontFamily: 2,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      autoResize: true,
      lineHeight: 1.25,
      strokeColor: color,
    },
  );
}

function card(x, y, w, title, lines, attention = false) {
  const h = 64 + lines.length * 25;
  rect(x, y, w, h, attention ? "#fff4e3" : "#ffffff");
  text(x + 16, y + 16, title, 17);
  text(x + 16, y + 48, lines.join("\n"), 14);
  return h;
}

function shell(w, h, title, mobile) {
  rect(0, 0, w, h, "#fafbf7");
  text(20, 18, "ROOST / TASKS     •     FICTIONAL RESEARCH", mobile ? 12 : 16);
  text(20, 60, title, mobile ? 22 : 28);
  text(
    20,
    104,
    mobile
      ? "Roost project · 10:42 UTC fixture"
      : "Project: Roost   |   Task source: Notion   |   Worker: Roost / Herdr   |   Code: GitHub",
    mobile ? 13 : 16,
  );
  rect(20, 145, w - 40, 95, "#e9efdf");
  text(
    36,
    160,
    mobile
      ? "2 / 2 task slots held\n1 working · 1 blocked\n2 tasks need you"
      : "CAPACITY   2 / 2 task slots held    •    1 working + 1 blocked               ATTENTION   2 tasks need you\nBlocked work keeps its slot. Verified handoff releases it; Human review remains visible.",
    mobile ? 16 : 19,
  );
}

for (const option of ["a", "b", "c"]) {
  for (const mobile of [false, true]) {
    elements = [];
    serial = 0;
    const w = mobile ? 390 : 1440;
    const h = mobile ? 1270 : 1040;
    const titles = {
      a: "A · Task workspace",
      b: "B · Status board",
      c: "C · Attention inbox",
    };
    shell(w, h, titles[option], mobile);
    if (!mobile && option === "a") {
      text(
        20,
        265,
        "All tasks   |   Needs you (2)   |   In progress (2)   |   Backlog     Search…",
        17,
      );
      card(
        20,
        315,
        690,
        "P1  Repair export flow                         SLOT HELD",
        [
          "Notion: In progress     Worker: Blocked",
          "GitHub: Draft #142     Checks: 1 failed · b72e",
          "You → Inspect network approval in the original terminal",
        ],
        true,
      );
      card(
        20,
        480,
        690,
        "P1  Improve task search                      SLOT HELD",
        [
          "Notion: In progress     Worker: Working",
          "GitHub: Open #143     Checks: running · c93f",
        ],
      );
      card(
        20,
        620,
        690,
        "P2  Compact conversation spacing       NO SLOT",
        [
          "Notion: Human review     Worker: Idle / job completed",
          "GitHub: Open #141     Checks: 3 passed · a61d",
          "You → Review acceptance criteria and evidence",
        ],
        true,
      );
      card(
        20,
        785,
        690,
        "P1  Explain offline recovery                   NO SLOT",
        [
          "Notion: Backlog / Ready to implement     No job",
          "No PR · Checks not applicable · waits for capacity",
        ],
      );
      card(
        740,
        315,
        680,
        "REPAIR EXPORT FLOW · SELECTED TASK",
        [
          "Approval needed → You",
          "Inspect the network request in the original worker terminal.",
          "[ Inspect worker terminal ↗ ]",
          "",
          "Notion task: In progress / P1    •    observed 10:42 UTC",
          "Roost job: blocked / Worker: Blocked    •    slot held",
          "GitHub PR: Draft #142 / head b72e",
          "Checks: 1 failed on b72e    •    observed 10:42 UTC",
          "",
          "A failed check is separate from the terminal approval.",
          "[ Notion ↗ ]   [ Worker progress ↗ ]   [ GitHub PR ↗ ]",
          "",
          "Only a human marks Done.",
        ],
        true,
      );
    } else if (!mobile && option === "b") {
      text(
        20,
        265,
        "Columns use Notion status only. Cards retain worker + PR + check state. No drag-to-change status.",
        17,
      );
      const lanes = ["Backlog", "In progress", "Human review", "Done"];
      lanes.forEach((lane, i) => {
        rect(20 + i * 355, 312, 335, 600, "#f0f2eb");
        text(35 + i * 355, 332, lane, 20);
      });
      card(32, 384, 311, "P1  Offline recovery", [
        "Ready to implement",
        "No job / no slot",
        "No PR / checks N/A",
      ]);
      card(
        387,
        384,
        311,
        "P1  Repair export flow",
        [
          "Worker: Blocked / slot held",
          "Draft #142 / 1 failed · b72e",
          "You → terminal approval",
        ],
        true,
      );
      card(387, 550, 311, "P1  Improve task search", [
        "Worker: Working / slot held",
        "Open #143 / running · c93f",
      ]);
      card(
        742,
        384,
        311,
        "P2  Compact spacing",
        [
          "Worker: Idle / no slot",
          "Open #141 / 3 passed · a61d",
          "You → experience review",
        ],
        true,
      );
      card(1097, 384, 311, "P3  Archived tasks", [
        "Human accepted / no slot",
        "Merged #139",
        "2 passed on merged head",
      ]);
      text(
        30,
        945,
        "Select card → same task detail as A. Strong lifecycle scan; sparse columns and cross-column attention scanning.",
        17,
      );
    } else if (!mobile && option === "c") {
      text(
        20,
        265,
        "Needs you (2)   |   All tasks (5)     Group by next responsible person; keep every task reachable.",
        17,
      );
      card(
        20,
        315,
        460,
        "APPROVAL · P1 · Repair export flow",
        [
          "In progress / worker Blocked",
          "Draft #142 / 1 failed · b72e",
          "Slot held · since 10:39 UTC",
        ],
        true,
      );
      card(
        20,
        480,
        460,
        "REVIEW · P2 · Compact spacing",
        [
          "Human review / worker Idle",
          "Open #141 / 3 passed · a61d",
          "No slot · since 10:40 UTC",
        ],
        true,
      );
      card(
        510,
        315,
        910,
        "NEXT ACTION: INSPECT WORKER TERMINAL",
        [
          "Repair export flow · owner: You",
          "A network approval blocks verification; a failed check is also present.",
          "Open the original worker terminal to inspect the concrete request.",
          "[ Inspect worker terminal ↗ ]",
          "",
          "Notion: In progress / P1   •   Roost job: blocked / worker: Blocked",
          "GitHub: Draft #142 / head b72e / 1 failed check",
          "Source observations: Notion 10:42 / worker 10:42 / GitHub 10:42 UTC",
          "",
          "[ Notion task ↗ ]   [ Worker progress ↗ ]   [ GitHub PR ↗ ]",
        ],
        true,
      );
      card(20, 710, 1400, "CONTINUING WITHOUT YOU", [
        "P1 Improve task search: In progress / Working / Open #143 / checks running / slot held",
        "P1 Offline recovery: Backlog / Ready to implement / no job / no PR / waits for capacity",
        "P3 Archived tasks: Done by human / Merged #139 / no slot",
      ]);
      text(
        20,
        945,
        "Fast triage; progress can disappear below the inbox. Needs dependable ownership, grouping and freshness.",
        17,
      );
    } else {
      text(
        20,
        265,
        option === "b"
          ? "Status: In progress ▾   (2)"
          : option === "c"
            ? "Needs you (2)   |   All tasks (5)"
            : "All tasks   |   Needs you   |   Search",
        16,
      );
      card(
        20,
        310,
        350,
        "P1  Repair export flow",
        [
          "Notion: In progress",
          "Worker: Blocked · slot held",
          "Draft #142 / 1 failed · b72e",
          "You → Inspect terminal approval",
          "[ Open task → ]",
        ],
        true,
      );
      if (option !== "c")
        card(20, 520, 350, "P1  Improve task search", [
          "Notion: In progress",
          "Worker: Working · slot held",
          "Open #143 / running · c93f",
        ]);
      if (option !== "b")
        card(
          20,
          option === "c" ? 520 : 685,
          350,
          "P2  Compact spacing",
          [
            "Notion: Human review",
            "Worker: Idle · no slot",
            "Open #141 / 3 passed · a61d",
            "You → Review PR and evidence",
          ],
          true,
        );
      text(
        20,
        920,
        option === "b"
          ? "Change status selector to browse\nBacklog / Human review / Done.\nAvoid horizontal lane scrolling."
          : option === "c"
            ? "All tasks keeps working + queued\nwork reachable outside the inbox.\nNo one-tap approval shortcut."
            : "Select a task → full-screen detail.\nBack preserves filter + selection.\nPriority stays visible on every card.",
        16,
      );
      text(
        20,
        1030,
        "GitHub unavailable? Show unknown\nand the last observation, never\na current green check from old data.",
        16,
      );
      text(
        20,
        1150,
        "Only a human marks Done.\nAll content is fictional research.",
        16,
      );
      // A second native mobile screen shows the navigation endpoint.
      rect(430, 0, 390, 1270, "#fafbf7");
      text(450, 22, "MOBILE DETAIL · SAME FOR A / B / C", 13);
      text(450, 72, "← Back to tasks", 17);
      text(450, 127, "P1  Repair export flow", 22);
      card(
        450,
        195,
        350,
        "APPROVAL NEEDED · YOU",
        [
          "Inspect the network request in",
          "the original worker terminal.",
          "[ Inspect worker terminal ↗ ]",
        ],
        true,
      );
      card(450, 370, 350, "Notion task", [
        "In progress · P1",
        "Observed 10:42 UTC",
      ]);
      card(450, 520, 350, "Roost job / worker", [
        "blocked / Blocked · slot held",
        "Observed 10:42 UTC",
      ]);
      card(450, 670, 350, "GitHub PR / checks", [
        "Draft #142 · head b72e",
        "1 failed check on b72e",
        "Observed 10:42 UTC",
      ]);
      text(
        450,
        860,
        "[ Notion ↗ ]  [ Worker progress ↗ ]\n[ GitHub PR ↗ ]",
        16,
      );
      text(
        450,
        980,
        "Human review differs from Done.\nIdle and passed checks do not\naccept the task. Only humans do.",
        16,
      );
      text(
        450,
        1130,
        "Navigation sketch; all destinations\nare fixtures in the prototype.",
        15,
      );
    }
    if (!mobile)
      text(
        20,
        1000,
        "EDITABLE DESIGN EXPLORATION · NOT A SCREENSHOT · No production integration or status writes",
        13,
      );
    writeFileSync(
      `${directory}${option}-${mobile ? "mobile" : "desktop"}.excalidraw`,
      JSON.stringify(
        {
          type: "excalidraw",
          version: 2,
          source: "roost/unified-task-view-research",
          elements,
          appState: { viewBackgroundColor: "#ffffff", gridSize: null },
          files: {},
        },
        null,
        2,
      ),
    );
  }
}
console.log("Generated six native editable desktop/mobile Excalidraw scenes.");
