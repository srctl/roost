export const CODEX_SIGN_IN_REQUIRED =
  "Codex needs you to sign in again. Connect Codex in Settings, then retry your message.";

export type CodexLogin =
  | { status: "idle" }
  | {
      status: "pending";
      loginId: string;
      verificationUrl: string;
      userCode: string;
    }
  | { status: "connected" }
  | { status: "error"; error: string };
