/** Keep the existing sandbox unless an operator explicitly uses a dedicated VM. */
export function codexSandbox(value = process.env.ROOST_CODEX_SANDBOX) {
  if (!value || value === "workspace-write") return "workspace-write" as const;
  if (value === "danger-full-access") return "danger-full-access" as const;
  throw new Error(
    "ROOST_CODEX_SANDBOX must be workspace-write or danger-full-access.",
  );
}
