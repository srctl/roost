/** This protocol is independent of the application release/bundle schema. */
export const updaterProtocol = 1;
export const stableVersion =
  /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?![\s\S])/;

export function compareVersions(a: string, b: string) {
  if (!stableVersion.test(a) || !stableVersion.test(b))
    throw new Error("Invalid stable version.");
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i]! > right[i]! ? 1 : -1;
  }
  return 0;
}

export type Compatibility = {
  protocol: 1;
  app: { min: number; max: number; output: number };
  auth: { min: number; max: number; output: number };
  data: "complete-snapshot-v1";
  externalState: "unchanged";
  codex: string;
};

export function compatibility(value: unknown): Compatibility {
  const c = value as Compatibility;
  const range = (r: Compatibility["app"]) =>
    r &&
    [r.min, r.max, r.output].every(
      (n) => Number.isSafeInteger(n) && n >= 0 && n <= 10000,
    ) &&
    r.min <= r.max &&
    r.output >= r.max;
  if (
    !c ||
    c.protocol !== updaterProtocol ||
    !range(c.app) ||
    !range(c.auth) ||
    c.data !== "complete-snapshot-v1" ||
    c.externalState !== "unchanged" ||
    !stableVersion.test(c.codex)
  )
    throw new Error("Release has no supported update compatibility contract.");
  return c;
}

export function assertCompatible(
  value: unknown,
  installed: { app: number; auth: number; codex: string },
) {
  const c = compatibility(value);
  if (
    installed.app < c.app.min ||
    installed.app > c.app.max ||
    installed.auth < c.auth.min ||
    installed.auth > c.auth.max ||
    installed.codex !== c.codex
  )
    throw new Error(
      "Database or bundled Codex compatibility requires terminal maintenance.",
    );
  return c;
}

export type Capability = {
  code:
    | "externally-managed"
    | "unsupported-platform"
    | "unsupported-service-manager"
    | "unsupported-distribution"
    | "unsupported-storage"
    | "setup-required"
    | "qualification-required";
  reason: string;
  canActivate: false;
};

export function capability(facts: {
  packaged: boolean;
  platform: string;
  arch: string;
  systemd: boolean;
  distribution?: string;
  filesystem?: string;
}): Capability {
  if (!facts.packaged)
    return {
      code: "externally-managed",
      reason:
        "This source or orchestrated installation is externally managed. Update it through its deployment workflow.",
      canActivate: false,
    };
  if (facts.platform !== "linux" || facts.arch !== "x64")
    return {
      code: "unsupported-platform",
      reason: "UI updates initially require a packaged Linux x64 installation.",
      canActivate: false,
    };
  if (!facts.systemd)
    return {
      code: "unsupported-service-manager",
      reason:
        "This installation does not have the required systemd supervisor.",
      canActivate: false,
    };
  if (facts.distribution && facts.distribution !== "ubuntu:24.04")
    return {
      code: "unsupported-distribution",
      reason:
        "Initial UI update qualification is limited to Ubuntu 24.04. Use operator-managed updates on this distribution.",
      canActivate: false,
    };
  if (facts.filesystem && facts.filesystem !== "ext4")
    return {
      code: "unsupported-storage",
      reason:
        "Initial UI updates require persistent local ext4 installation storage. This storage layout requires operator-managed updates.",
      canActivate: false,
    };
  return {
    code: "setup-required",
    reason:
      "Explicit operator enrollment is required. Run roost updates enroll from the packaged terminal CLI; activation also requires a qualified helper build.",
    canActivate: false,
  };
}
