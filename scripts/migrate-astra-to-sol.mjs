import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Run with the packaged Node after deployment. Dry-run is the default.
// The rollback file contains only IDs/model settings, never prompts or credentials.
const [database, action = "--dry-run", backupPath] = process.argv.slice(2);
if (!database || !["--dry-run", "--apply", "--rollback"].includes(action))
  throw new Error(
    "Usage: node scripts/migrate-astra-to-sol.mjs <database> [--dry-run | --apply <new-rollback-file> | --rollback <rollback-file>]",
  );
if (action !== "--dry-run" && !backupPath)
  throw new Error("A rollback file is required.");
const db = new DatabaseSync(resolve(database), {
  readOnly: action === "--dry-run",
});
db.exec("PRAGMA busy_timeout=5000");
const oldModels = "('gpt-6-astra','astra')";
const targetModel = "gpt-6.1-sol";
const targetEffort = "low";
const counts = (snapshot) =>
  Object.fromEntries(
    Object.entries(snapshot)
      .filter(([key]) =>
        ["agents", "conversations", "automations", "queuedRuns"].includes(key),
      )
      .map(([key, rows]) => [key, rows.length]),
  );
const snapshot = () => ({
  version: 1,
  targetModel,
  targetEffort,
  agents: db
    .prepare(
      `SELECT id,model,reasoningEffort FROM agents WHERE model IN ${oldModels}`,
    )
    .all(),
  conversations: db
    .prepare(
      `SELECT conversationId,agentId,model FROM conversation_sessions WHERE provider='codex' AND model IN ${oldModels}`,
    )
    .all(),
  automations: db
    .prepare(
      `SELECT id,model,reasoningEffort,revision FROM automations WHERE model IN ${oldModels}`,
    )
    .all(),
  queuedRuns: db
    .prepare(
      `SELECT id,json_extract(automationSnapshot,'$.model') model,json_extract(automationSnapshot,'$.reasoningEffort') reasoningEffort,json_type(automationSnapshot,'$.reasoningEffort') effortType FROM runs WHERE status='queued' AND json_extract(automationSnapshot,'$.model') IN ${oldModels}`,
    )
    .all(),
});
let maintenanceOwned = false;
try {
  if (action === "--dry-run") {
    console.log(
      JSON.stringify({ mode: "dry-run", counts: counts(snapshot()) }),
    );
  } else {
    db.exec("BEGIN IMMEDIATE");
    if (
      db.prepare("SELECT maintenance FROM runtime_control WHERE id=1").get()
        ?.maintenance !== 0
    )
      throw new Error("Another operation has Roost in maintenance.");
    db.prepare("UPDATE runtime_control SET maintenance=1 WHERE id=1").run();
    db.exec("COMMIT");
    maintenanceOwned = true;
    db.exec("BEGIN IMMEDIATE");
    if (db.prepare("SELECT 1 FROM runs WHERE status='running'").get())
      throw new Error(
        "Active runs must finish before migrating; no runs were interrupted.",
      );
    const data =
      action === "--rollback"
        ? JSON.parse(readFileSync(backupPath, "utf8"))
        : snapshot();
    if (
      data.version !== 1 ||
      data.targetModel !== targetModel ||
      data.targetEffort !== targetEffort
    )
      throw new Error("Unsupported rollback data.");
    if (action === "--apply") {
      mkdirSync(dirname(resolve(backupPath)), { recursive: true, mode: 0o700 });
      writeFileSync(backupPath, `${JSON.stringify(data, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      db.prepare(
        `UPDATE agents SET model=?,reasoningEffort=? WHERE model IN ${oldModels}`,
      ).run(targetModel, targetEffort);
      db.prepare(
        `UPDATE conversation_sessions SET model=? WHERE provider='codex' AND model IN ${oldModels}`,
      ).run(targetModel);
      db.prepare(
        `UPDATE automations SET model=?,reasoningEffort=?,revision=revision+1 WHERE model IN ${oldModels}`,
      ).run(targetModel, targetEffort);
      db.prepare(
        `UPDATE runs SET automationSnapshot=json_set(automationSnapshot,'$.model',?,'$.reasoningEffort',?) WHERE status='queued' AND json_extract(automationSnapshot,'$.model') IN ${oldModels}`,
      ).run(targetModel, targetEffort);
    } else {
      // Refuse to overwrite settings edited after the migration.
      for (const row of data.agents) {
        const changes = db
          .prepare(
            "UPDATE agents SET model=?,reasoningEffort=? WHERE id=? AND model=? AND reasoningEffort=?",
          )
          .run(
            row.model,
            row.reasoningEffort,
            row.id,
            targetModel,
            targetEffort,
          ).changes;
        if (changes !== 1)
          throw new Error(
            "Agent settings changed since migration; rollback cancelled.",
          );
      }
      for (const row of data.conversations) {
        const changes = db
          .prepare(
            "UPDATE conversation_sessions SET model=? WHERE conversationId=? AND agentId=? AND model=?",
          )
          .run(row.model, row.conversationId, row.agentId, targetModel).changes;
        if (changes !== 1)
          throw new Error(
            "Conversation settings changed since migration; rollback cancelled.",
          );
      }
      for (const row of data.automations) {
        const changes = db
          .prepare(
            "UPDATE automations SET model=?,reasoningEffort=?,revision=? WHERE id=? AND revision=? AND model=? AND reasoningEffort=?",
          )
          .run(
            row.model,
            row.reasoningEffort,
            row.revision,
            row.id,
            row.revision + 1,
            targetModel,
            targetEffort,
          ).changes;
        if (changes !== 1)
          throw new Error(
            "Automation settings changed since migration; rollback cancelled.",
          );
      }
      for (const row of data.queuedRuns) {
        const expression =
          row.effortType === null
            ? "json_remove(json_set(automationSnapshot,'$.model',?),'$.reasoningEffort')"
            : "json_set(automationSnapshot,'$.model',?,'$.reasoningEffort',?)";
        const params =
          row.effortType === null
            ? [row.model, row.id, targetModel]
            : [row.model, row.reasoningEffort, row.id, targetModel];
        const changes = db
          .prepare(
            `UPDATE runs SET automationSnapshot=${expression} WHERE id=? AND status='queued' AND json_extract(automationSnapshot,'$.model')=?`,
          )
          .run(...params).changes;
        if (changes !== 1)
          throw new Error("A queued run has advanced; rollback cancelled.");
      }
    }
    db.exec("COMMIT");
    console.log(
      JSON.stringify({
        mode: action.slice(2),
        model: targetModel,
        reasoningEffort: targetEffort,
        counts: counts(data),
      }),
    );
  }
} catch (error) {
  try {
    db.exec("ROLLBACK");
  } catch {}
  throw error;
} finally {
  if (maintenanceOwned)
    db.prepare("UPDATE runtime_control SET maintenance=0 WHERE id=1").run();
  db.close();
}
