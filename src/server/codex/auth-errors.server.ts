import { CODEX_SIGN_IN_REQUIRED } from "../../features/auth/schema";

// Only classify upstream errors. Never return raw provider errors or credentials.
export function codexErrorMessage(error: unknown, fallback: string) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "";
  return /401|unauthorized|invalid_refresh_token|authentication token|access token could not be refreshed|not logged in|sign in again/i.test(
    message,
  )
    ? CODEX_SIGN_IN_REQUIRED
    : fallback;
}
