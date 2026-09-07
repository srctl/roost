import { randomBytes } from "node:crypto";

export const computerEnabled = () =>
  Boolean(
    process.env.ROOST_DESKTOP_DISPLAY && process.env.ROOST_DESKTOP_ORIGIN,
  );

export function checkComputerOrigin(origin: string | null) {
  return computerEnabled() && origin === process.env.ROOST_DESKTOP_ORIGIN;
}

type Viewer = { expires: number; connected: boolean; close?: () => void };

const globals = globalThis as typeof globalThis & {
  roostComputer?: {
    viewers: Map<string, Viewer>;
    human?: { id: string; expires: number };
    agent?: string;
    acting: boolean;
  };
};

globals.roostComputer ??= { viewers: new Map(), acting: false };
const state = globals.roostComputer;

function human() {
  if (state.human && state.human.expires < Date.now()) {
    const id = state.human.id;
    state.human = undefined;
    const viewer = state.viewers.get(id);
    state.viewers.delete(id);
    viewer?.close?.();
  }
  return state.human;
}

export function computerStatus() {
  return {
    enabled: computerEnabled(),
    humanControlled: Boolean(human()),
    agentId: state.agent ?? null,
  };
}

export function createViewer() {
  if (!computerEnabled())
    throw new Error("No desktop is configured on this machine.");
  for (const [id, viewer] of state.viewers)
    if (!viewer.connected && viewer.expires < Date.now())
      state.viewers.delete(id);
  const id = randomBytes(32).toString("base64url");
  state.viewers.set(id, { expires: Date.now() + 60_000, connected: false });

  return { id };
}

export function connectViewer(id: string, origin: string | null) {
  const viewer = state.viewers.get(id);
  if (
    !checkComputerOrigin(origin) ||
    !viewer ||
    viewer.connected ||
    viewer.expires < Date.now()
  )
    return false;
  viewer.connected = true;

  return true;
}

export function disconnectViewer(id: string) {
  state.viewers.delete(id);
  if (state.human?.id === id) state.human = undefined;
}

export function attachViewer(id: string, close: () => void) {
  const viewer = state.viewers.get(id);
  if (viewer) viewer.close = close;
}

export const viewerConnected = (id: string) =>
  state.viewers.get(id)?.connected === true;

export function viewerControl(id: string, control: boolean) {
  human();
  if (!state.viewers.get(id)?.connected)
    throw new Error("Reconnect to the desktop first.");
  if (!control) {
    if (human()?.id === id) state.human = undefined;
    return { controlling: false };
  }
  if (human() && human()?.id !== id)
    throw new Error("Another viewer is controlling the desktop.");
  if (state.acting)
    throw new Error(
      "The agent is finishing a computer action. Try again in a moment.",
    );
  state.human = { id, expires: Date.now() + 30_000 };

  return { controlling: true };
}

export function beginComputerAction(agentId: string) {
  if (!computerEnabled())
    throw new Error("Computer access is not configured on this machine.");
  if (human())
    throw new Error(
      "The user has taken control. Do not inspect or control the desktop. Wait for the user to return control and ask you to continue.",
    );
  if (state.agent && state.agent !== agentId)
    throw new Error(
      "Another agent is using the shared desktop. Try again after its run finishes.",
    );
  if (state.acting)
    throw new Error(
      "A computer action is already in progress. Use one action at a time.",
    );
  state.agent = agentId;
  state.acting = true;
}

export const endComputerAction = () => {
  state.acting = false;
};

export const releaseComputer = (agentId: string) => {
  if (state.agent === agentId) state.agent = undefined;
};
