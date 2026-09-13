import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { Schema } from "effect";
import {
  CodingJob,
  CodingJobPatch,
  CodingSettings,
  CreateCodingJob,
  ExecutionProfile,
} from "../../features/coding/schema";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { assertAvailable } from "../maintenance.server";
import { writeTransaction } from "../transaction.server";

export function requireCodingAgent(db: DatabaseSync, agentId: string) {
  const agent = db.prepare("SELECT kind FROM agents WHERE id=?").get(agentId);
  if (!agent) throw new AgentStoreError({ message: "Agent not found." });
  if (agent.kind !== "coding")
    throw new AgentStoreError({ message: "This agent is not a coding agent." });
}

function readSettings(db: DatabaseSync, agentId: string): CodingSettings {
  const row = db
    .prepare("SELECT * FROM coding_settings WHERE agentId=?")
    .get(agentId);
  return row
    ? Schema.decodeUnknownSync(CodingSettings)({
        ...row,
        sources: JSON.parse(String(row.sources)),
      })
    : {
        agentId,
        repository: "",
        projectInstructions: "",
        defaultProfileId: null,
        sources: [],
        revision: 0,
      };
}

export const getCodingSettings = (agentId: string) =>
  withAgentStore((db) => {
    requireCodingAgent(db, agentId);
    return readSettings(db, agentId);
  });

export const saveCodingSettings = (input: CodingSettings) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      assertAvailable(db);
      const data = Schema.decodeUnknownSync(CodingSettings)(input);
      requireCodingAgent(db, data.agentId);
      const existing = readSettings(db, data.agentId);
      if (data.revision !== existing.revision)
        throw new AgentStoreError({
          message: "These coding settings changed. Reload before saving.",
        });
      if (
        data.defaultProfileId &&
        !db
          .prepare("SELECT id FROM coding_profiles WHERE id=?")
          .get(data.defaultProfileId)
      )
        throw new AgentStoreError({
          message: "That execution profile no longer exists. Choose another.",
        });
      if (
        new Set(data.sources.map((source) => source.id)).size !==
        data.sources.length
      )
        throw new AgentStoreError({
          message: "Task source IDs must be unique.",
        });
      const saved = { ...data, revision: existing.revision + 1 };
      db.prepare(
        `INSERT INTO coding_settings(agentId,repository,projectInstructions,defaultProfileId,sources,revision)
         VALUES(?,?,?,?,?,?) ON CONFLICT(agentId) DO UPDATE SET
         repository=excluded.repository,projectInstructions=excluded.projectInstructions,
         defaultProfileId=excluded.defaultProfileId,sources=excluded.sources,revision=excluded.revision`,
      ).run(
        saved.agentId,
        saved.repository,
        saved.projectInstructions,
        saved.defaultProfileId,
        JSON.stringify(saved.sources),
        saved.revision,
      );
      return saved;
    }),
  );

export const listExecutionProfiles = () =>
  withAgentStore((db) =>
    Schema.decodeUnknownSync(Schema.Array(ExecutionProfile))(
      db.prepare("SELECT * FROM coding_profiles ORDER BY name,id").all(),
    ),
  );

export const saveExecutionProfile = (input: ExecutionProfile) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      assertAvailable(db);
      const decoded = Schema.decodeUnknownSync(ExecutionProfile)(input);
      const data = {
        ...decoded,
        target: decoded.kind === "local" ? "" : decoded.target.trim(),
      };
      if (
        data.target &&
        !/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(
          data.target,
        )
      )
        throw new AgentStoreError({
          message: "An SSH target must be a host alias or user@hostname.",
        });
      const existing = db
        .prepare("SELECT revision FROM coding_profiles WHERE id=?")
        .get(data.id);
      if (data.revision !== Number(existing?.revision ?? 0))
        throw new AgentStoreError({
          message: "This execution profile changed. Reload before saving.",
        });
      const saved = { ...data, revision: data.revision + 1 };
      db.prepare(
        `INSERT INTO coding_profiles(id,name,kind,target,instructions,revision) VALUES(?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,
         target=excluded.target,instructions=excluded.instructions,revision=excluded.revision`,
      ).run(
        saved.id,
        saved.name,
        saved.kind,
        saved.target,
        saved.instructions,
        saved.revision,
      );
      return saved;
    }),
  );

export const deleteExecutionProfile = (id: string, revision: number) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      assertAvailable(db);
      const removed = db
        .prepare("DELETE FROM coding_profiles WHERE id=? AND revision=?")
        .run(id, revision);
      if (!removed.changes)
        throw new AgentStoreError({
          message:
            "This execution profile changed or was deleted. Reload before removing it.",
        });
      db.prepare(
        "UPDATE coding_settings SET defaultProfileId=NULL,revision=revision+1 WHERE defaultProfileId=?",
      ).run(id);
      return { removed: true };
    }),
  );

export function decodeCodingJob(row: Record<string, unknown>): CodingJob {
  return Schema.decodeUnknownSync(CodingJob)({
    ...row,
    observedWorking: Boolean(row.observedWorking),
    cancelRequested: Boolean(row.cancelRequested),
  });
}

export function readCodingJob(
  db: DatabaseSync,
  agentId: string,
  id: string,
): CodingJob | null {
  const row = db
    .prepare("SELECT * FROM coding_jobs WHERE agentId=? AND id=?")
    .get(agentId, id);
  return row ? decodeCodingJob(row) : null;
}

export const listCodingJobs = (agentId: string) =>
  withAgentStore((db) => {
    requireCodingAgent(db, agentId);
    return db
      .prepare(
        "SELECT * FROM coding_jobs WHERE agentId=? ORDER BY createdAt DESC,id LIMIT 100",
      )
      .all(agentId)
      .map(decodeCodingJob);
  });

export const getCodingJob = (agentId: string, id: string) =>
  withAgentStore((db) => {
    requireCodingAgent(db, agentId);
    const job = readCodingJob(db, agentId, id);
    if (!job) throw new AgentStoreError({ message: "Coding job not found." });
    return job;
  });

function sqlValue(value: unknown): SQLInputValue {
  return typeof value === "boolean" ? Number(value) : (value as SQLInputValue);
}

export const createCodingJob = (input: CreateCodingJob) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      assertAvailable(db);
      const data = Schema.decodeUnknownSync(CreateCodingJob)(input);
      requireCodingAgent(db, data.agentId);
      const request = JSON.stringify(data, Object.keys(data).sort());
      const previous = db
        .prepare("SELECT * FROM coding_jobs WHERE id=?")
        .get(data.id);
      if (previous) {
        if (previous.agentId !== data.agentId || previous.request !== request)
          throw new AgentStoreError({
            message:
              "This job request was already used for another assignment.",
          });
        return decodeCodingJob(previous);
      }
      const settings = readSettings(db, data.agentId);
      const profileId =
        data.profileId === undefined
          ? settings.defaultProfileId
          : data.profileId;
      const row = profileId
        ? db.prepare("SELECT * FROM coding_profiles WHERE id=?").get(profileId)
        : undefined;
      if (profileId && !row)
        throw new AgentStoreError({
          message: "That execution profile no longer exists. Choose another.",
        });
      const profile = row
        ? Schema.decodeUnknownSync(ExecutionProfile)(row)
        : null;
      const job: CodingJob = {
        ...data,
        assignment: data.assignment ?? data.brief,
        profileId,
        sourceUrl: data.sourceUrl ?? "",
        sourceRunId: data.sourceRunId ?? "",
        remoteTarget:
          data.remoteTarget ?? (profile?.kind === "ssh" ? profile.target : ""),
        repository: data.repository ?? settings.repository,
        projectInstructions:
          data.projectInstructions ?? settings.projectInstructions,
        profileInstructions:
          data.profileInstructions ?? profile?.instructions ?? "",
        status: "queued",
        summary: "",
        error: "",
        output: "",
        lastWorkerState: "",
        observedWorking: false,
        dispatchedAt: null,
        notifiedStatus: "",
        paneId: "",
        sessionIdentity: "",
        nativeSessionId: "",
        launchOwner: "",
        cancelRequested: false,
        lastCheckedAt: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        revision: 1,
      };
      const fields = Object.keys(job);
      db.prepare(
        `INSERT INTO coding_jobs(${fields.join(",")},request) VALUES(${fields.map(() => "?").join(",")},?)`,
      ).run(...Object.values(job).map(sqlValue), request);
      db.prepare(
        "INSERT INTO conversation_records(id,agentId,createdAt) VALUES(?,?,?)",
      ).run(job.id, job.agentId, job.createdAt);
      return job;
    }),
  );

export function writeCodingJobPatch(
  db: DatabaseSync,
  agentId: string,
  id: string,
  patch: CodingJobPatch,
  expectedRevision?: number,
) {
  requireCodingAgent(db, agentId);
  const data = Schema.decodeUnknownSync(CodingJobPatch)(patch, {
    onExcessProperty: "error",
  });
  const current = readCodingJob(db, agentId, id);
  if (!current) throw new AgentStoreError({ message: "Coding job not found." });
  if (expectedRevision !== undefined && current.revision !== expectedRevision)
    throw new AgentStoreError({
      message: "This coding job changed. Read it again before updating.",
    });
  const changes = Object.entries(data).filter(
    ([key, value]) =>
      value !== undefined && value !== current[key as keyof CodingJob],
  );
  if (!changes.length) return current;
  const updatedAt = changes.some(([key]) => key !== "lastCheckedAt")
    ? Date.now()
    : current.updatedAt;
  db.prepare(
    `UPDATE coding_jobs SET ${changes.map(([key]) => `${key}=?`).join(",")},updatedAt=?,revision=revision+1 WHERE agentId=? AND id=?`,
  ).run(...changes.map(([, value]) => sqlValue(value)), updatedAt, agentId, id);
  return readCodingJob(db, agentId, id)!;
}

export const updateCodingJob = (
  agentId: string,
  id: string,
  patch: CodingJobPatch,
  expectedRevision?: number,
) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      assertAvailable(db);
      return writeCodingJobPatch(db, agentId, id, patch, expectedRevision);
    }),
  );
