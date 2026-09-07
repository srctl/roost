import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import { available } from "../../server/available";
import {
  cancelLogin,
  getAccount,
  getLogin,
  startLogin,
} from "../../server/codex/login.server";

export const getCodexAccount = createServerFn({ method: "GET" })
  .middleware([available])
  .handler(() => Effect.runPromise(getAccount));

export const getCodexLogin = createServerFn({ method: "GET" })
  .middleware([available])
  .handler(() => getLogin());

export const startCodexLogin = createServerFn({ method: "POST" })
  .middleware([available])
  .handler(() => startLogin());

export const cancelCodexLogin = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(Schema.Struct({ loginId: Schema.String })),
  )
  .handler(({ data }) => cancelLogin(data.loginId));
