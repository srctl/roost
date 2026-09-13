import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import { available } from "../../server/available";
import {
  getNotePreference,
  noteHistory,
  readNote,
  readNoteRevision,
  restoreNote,
  saveNote,
  saveNoteInstructions,
  setNotePreference,
} from "../../server/notes/store.server";
import { NoteInstructionWrite, NoteRestore, NoteWrite } from "./schema";

const result = <A, E extends { message: string }>(
  effect: Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onSuccess: (value) => ({ ok: true as const, value }),
        onFailure: (error) => ({ ok: false as const, error: error.message }),
      }),
    ),
  );
const agent = { agentId: Schema.UUID };
export const getNote = createServerFn({ method: "GET" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(Schema.Struct(agent)))
  .handler(({ data }) => result(readNote(data.agentId)));
export const getNoteHistory = createServerFn({ method: "GET" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({
        ...agent,
        before: Schema.optional(Schema.NonNegativeInt),
      }),
    ),
  )
  .handler(({ data }) => result(noteHistory(data.agentId, data.before)));
export const updateNote = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(Schema.Struct({ ...agent, ...NoteWrite.fields })),
  )
  .handler(({ data: { agentId, ...input } }) =>
    result(saveNote(agentId, input)),
  );
export const updateNoteInstructions = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ ...agent, ...NoteInstructionWrite.fields }),
    ),
  )
  .handler(({ data: { agentId, ...input } }) =>
    result(saveNoteInstructions(agentId, input)),
  );
export const restoreNoteRevision = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ ...agent, ...NoteRestore.fields }),
    ),
  )
  .handler(({ data: { agentId, ...input } }) =>
    result(restoreNote(agentId, input)),
  );

export const getNoteRevision = createServerFn({ method: "GET" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ agentId: Schema.UUID, revision: Schema.NonNegativeInt }),
    ),
  )
  .handler(({ data }) => result(readNoteRevision(data.agentId, data.revision)));

export const getNoteSetting = createServerFn({ method: "GET" })
  .middleware([available])
  .handler(() => result(getNotePreference()));

export const changeNoteSetting = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(Schema.Struct({ enabled: Schema.Boolean })),
  )
  .handler(({ data }) => result(setNotePreference(data.enabled)));
