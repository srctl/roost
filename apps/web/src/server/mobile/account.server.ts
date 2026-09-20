import { Effect, Schema } from "effect";
import { withAgentStore } from "../agents/store.server";
import {
  cancelLogin,
  getAccount,
  getLogin,
  startLogin,
} from "../codex/login.server";
import { assertAvailable } from "../maintenance.server";

const accountServices = {
  getAccount: () => Effect.runPromise(getAccount),
  getLogin,
  startLogin,
  cancelLogin,
};

// Exposes only the existing device-code login flow. OpenAI credentials stay in
// the host Codex process; browser passkeys and sessions keep their own auth flow.
export function createMobileAccountRequest(services = accountServices) {
  return async (
    path: string,
    request: Request,
    body: (request: Request) => Promise<unknown>,
  ): Promise<{ value: unknown; status?: number } | null> => {
    if (path !== "account" && path !== "account/login") return null;
    await Effect.runPromise(withAgentStore(assertAvailable));
    if (path === "account" && request.method === "GET") {
      const { configured } = await services.getAccount();
      return { value: { configured, login: services.getLogin() } };
    }
    if (path === "account/login") {
      if (request.method === "GET") return { value: services.getLogin() };
      if (request.method === "POST")
        return { value: await services.startLogin() };
      if (request.method === "DELETE") {
        const { loginId } = Schema.decodeUnknownSync(
          Schema.Struct({
            loginId: Schema.String.pipe(
              Schema.minLength(1),
              Schema.maxLength(2000),
            ),
          }),
        )(await body(request));
        return { value: await services.cancelLogin(loginId) };
      }
    }
    return { value: { error: "Method not allowed." }, status: 405 };
  };
}
export const mobileAccountRequest = createMobileAccountRequest();
