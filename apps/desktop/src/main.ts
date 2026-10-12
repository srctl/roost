import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  emptyGrants,
  type Grants,
  grantsSchema,
} from "@roost/desktop-protocol";
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  Notification,
  nativeImage,
  safeStorage,
  shell,
  systemPreferences,
  Tray,
  WebContentsView,
} from "electron";
import { RoostAPI, serverOrigin } from "./api";
import { DesktopCompanion } from "./companion";
import {
  type ConnectionSource,
  type Credentials,
  decodeConnection,
  encodeConnection,
  vmNameSchema,
} from "./connection-settings";
import { CredentialSession, ExeDev } from "./exedev";
import { LocalTools } from "./local-tools";
import { installWorkspaceAuthentication } from "./workspace-auth";

const directory = __dirname;
const panelURL = pathToFileURL(join(directory, "panel.html")).href;
let window: BrowserWindow;
let workspace: WebContentsView | null = null;
let tray: Tray | null = null;
let connection: {
  controller: AbortController;
  companion: DesktopCompanion;
  credentials: CredentialSession;
} | null = null;
let tools: LocalTools;
let grants: Grants = { ...emptyGrants };
let agents: { id: string; name: string }[] = [];
let origin = "";
let status = "Disconnected";
let activity = "Local access is off";
let settingsVisible = true;
let quitting = false;

function configPath() {
  return join(app.getPath("userData"), "connection.json");
}
function saveConnection(value: Credentials) {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error(
      "Secure credential storage is unavailable on this computer.",
    );
  const path = configPath();
  mkdirSync(app.getPath("userData"), { recursive: true, mode: 0o700 });
  writeFileSync(
    `${path}.tmp`,
    JSON.stringify(
      encodeConnection(value, (text) => safeStorage.encryptString(text)),
    ),
    { mode: 0o600 },
  );
  renameSync(`${path}.tmp`, path);
}
function savedConnection() {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("Secure credential storage is unavailable.");
  return decodeConnection(
    JSON.parse(readFileSync(configPath(), "utf8")),
    (data) => safeStorage.decryptString(data),
  );
}
function state() {
  return {
    origin,
    status,
    activity,
    agents,
    grants,
    settingsVisible,
    permissions: {
      screen:
        process.platform === "darwin"
          ? systemPreferences.getMediaAccessStatus("screen")
          : "unsupported",
      accessibility:
        process.platform === "darwin" &&
        systemPreferences.isTrustedAccessibilityClient(false),
      messagesInstalled: [
        join(app.getPath("home"), ".local/bin/imsg"),
        "/opt/homebrew/bin/imsg",
        "/usr/local/bin/imsg",
      ].some(existsSync),
    },
  };
}
function publish() {
  if (window && !window.isDestroyed())
    window.webContents.send("desktop:changed", state());
  tray?.setToolTip(
    grants.computerUntil > Date.now()
      ? "Roost — your computer is shared"
      : `Roost — ${status}`,
  );
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Roost", click: () => window.show() },
      {
        label: "Companion settings",
        click: () => {
          showSettings(true);
          window.show();
        },
      },
      {
        label: "Stop computer access",
        enabled: grants.computerUntil > 0,
        click: stopComputer,
      },
      { type: "separator" },
      { label: "Quit Roost", click: () => app.quit() },
    ]),
  );
}
function showSettings(visible: boolean) {
  settingsVisible = !workspace || visible;
  workspace?.setVisible(!settingsVisible);
  publish();
}
function applyGrants(value: Grants) {
  grants = grantsSchema.parse(value);
  tools.setGrants(grants);
  publish();
}
function stopComputer() {
  applyGrants({ ...grants, computerUntil: 0 });
  activity = "Computer access stopped";
  publish();
}
function bounds() {
  if (!workspace) return;
  const [width = 1180, height = 820] = window.getContentSize();
  workspace.setBounds({ x: 0, y: 64, width, height: Math.max(1, height - 64) });
}
function validExternal(value: string) {
  const url = new URL(value);
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    !url.username &&
    !url.password
  );
}
function closeWorkspace() {
  if (workspace) {
    window.contentView.removeChildView(workspace);
    workspace.webContents.close();
    workspace = null;
  }
}
async function openWorkspace(
  workspaceOrigin: string,
  credentials: CredentialSession,
) {
  closeWorkspace();
  workspace = new WebContentsView({
    webPreferences: {
      partition: `persist:roost-${createHash("sha256").update(workspaceOrigin).digest("hex").slice(0, 16)}`,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  const contents = workspace.webContents;
  installWorkspaceAuthentication(
    (handler) => contents.session.webRequest.onBeforeSendHeaders(handler),
    workspaceOrigin,
    () => credentials.authentication(),
  );
  contents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  contents.session.setPermissionCheckHandler(() => false);
  contents.setWindowOpenHandler(({ url }) => {
    if (validExternal(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== workspaceOrigin) {
      event.preventDefault();
      if (validExternal(url)) void shell.openExternal(url);
    }
  });
  contents.on("will-redirect", (event, url) => {
    if (new URL(url).origin !== workspaceOrigin) event.preventDefault();
  });
  window.contentView.addChildView(workspace);
  bounds();
  workspace.setVisible(!settingsVisible);
  await contents.loadURL(workspaceOrigin);
}

async function connect(
  source: ConnectionSource,
  mode: "setup" | "resume" | "reconnect" = "setup",
) {
  const controller = new AbortController();
  const credentials = new CredentialSession(
    source,
    controller.signal,
    (value) => {
      controller.signal.throwIfAborted();
      if (connection !== attempt)
        throw new Error("Connection attempt cancelled.");
      saveConnection(value);
    },
  );
  const nextOrigin = serverOrigin(credentials.origin);
  if (mode === "reconnect") credentials.requireFreshProxy();
  const api = new RoostAPI(
    nextOrigin,
    async (signal) =>
      signal === null
        ? credentials.cachedAuthentication()
        : credentials.authentication(),
    controller.signal,
  );
  const nextTools = new LocalTools(join(directory, "roost-mac-helper"));
  let ready = false;
  const nextCompanion = new DesktopCompanion(
    api,
    nextTools,
    () => (connection === attempt ? grants : emptyGrants),
    (value) => {
      if (connection !== attempt) return;
      if (value.startsWith("Connection lost")) {
        status = value;
        applyGrants({ ...emptyGrants });
        controller.abort();
      } else if (ready) status = value;
      publish();
    },
    (value) => {
      if (connection !== attempt) return;
      activity = value;
      publish();
    },
  );
  const attempt = { controller, companion: nextCompanion, credentials };
  const previous = connection;
  connection = attempt;
  previous?.controller.abort();
  void previous?.companion.stop();
  tools.stop();
  tools = nextTools;
  closeWorkspace();
  applyGrants({ ...emptyGrants });
  origin = nextOrigin;
  agents = [];
  status = "Connecting";
  showSettings(true);
  publish();
  try {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error(
        "Secure credential storage is unavailable on this computer.",
      );
    const list = await api.request("agents");
    if (!Array.isArray(list)) throw new Error("Invalid agent list.");
    const nextAgents = list.map((agent) => ({
      id: String(agent.id),
      name: String(agent.name),
    }));
    await nextCompanion.start();
    controller.signal.throwIfAborted();
    await openWorkspace(nextOrigin, credentials);
    const readyCredentials = await credentials.get();
    controller.signal.throwIfAborted();
    if (mode === "setup") saveConnection(readyCredentials);
    credentials.commit();
    agents = nextAgents;
    ready = true;
    status = "Connected";
    showSettings(false);
    if (source.kind === "new-exe") {
      void previous?.credentials.revoke().catch(() => {
        if (connection === attempt) {
          activity =
            "Connected. Previous server credentials could not all be revoked.";
          publish();
        }
      });
    }
  } catch (error) {
    controller.abort();
    if (connection === attempt) {
      connection = null;
      applyGrants({ ...emptyGrants });
      closeWorkspace();
      origin = "";
      agents = [];
      if (!status.startsWith("Connection lost")) status = "Disconnected";
      showSettings(true);
    }
    await nextCompanion.stop();
    await credentials.rollback().catch(() => {});
    throw error;
  }
  publish();
}

function registerIPC() {
  const handlers: Record<string, (...args: never[]) => unknown> = {
    "desktop:state": () => state(),
    "desktop:connect": async (server: string, token: string) => {
      await connect({ kind: "manual", origin: serverOrigin(server), token });
      return state();
    },
    "desktop:exe-vms": () => new ExeDev().list(),
    "desktop:exe-connect": async (vm: string) => {
      await connect({ kind: "new-exe", vm: vmNameSchema.parse(vm) });
      return state();
    },
    "desktop:reconnect": async () => {
      await connect(savedConnection(), "reconnect");
      return state();
    },
    "desktop:disconnect": async () => {
      const previous = connection;
      connection = null;
      previous?.controller.abort();
      void previous?.companion.stop();
      applyGrants({ ...emptyGrants });
      closeWorkspace();
      writeFileSync(configPath(), "{}", { mode: 0o600 });
      status = "Disconnected";
      agents = [];
      origin = "";
      activity = "Local access is off";
      showSettings(true);
      void previous?.credentials.revoke().catch((error) => {
        if (!connection) {
          activity =
            error instanceof Error
              ? error.message
              : "Some server credentials could not be revoked.";
          publish();
        }
      });
      return state();
    },
    "desktop:chats": async () => tools.chats(),
    "desktop:grants": (agentId: string | null, chats: Grants["chats"]) => {
      if (grants.computerUntil > Date.now())
        throw new Error(
          "Stop computer access before changing local permissions.",
        );
      if (!connection || status !== "Connected")
        throw new Error("Connect to Roost first.");
      if (agentId && !agents.some((agent) => agent.id === agentId))
        throw new Error("Choose an agent from this server.");
      applyGrants({ agentId, chats: agentId ? chats : [], computerUntil: 0 });
      return state();
    },
    "desktop:start-computer": () => {
      if (grants.computerUntil > Date.now())
        throw new Error(
          "Computer access is already enabled. Stop it before starting another session.",
        );
      if (!grants.agentId || status !== "Connected")
        throw new Error("Choose a connected agent first.");
      if (process.platform !== "darwin")
        throw new Error("Local computer access currently supports macOS.");
      if (!systemPreferences.isTrustedAccessibilityClient(true))
        throw new Error(
          "Enable Roost Accessibility in System Settings, then try again.",
        );
      applyGrants({ ...grants, computerUntil: Date.now() + 10 * 60 * 1000 });
      activity = "Computer access enabled for 10 minutes";
      new Notification({
        title: "Roost computer access enabled",
        body: "Your selected agent can use this Mac. Stop anytime with ⌘⇧Escape.",
      }).show();
      return state();
    },
    "desktop:stop-computer": () => {
      stopComputer();
      return state();
    },
    "desktop:settings": (visible: boolean) => {
      showSettings(Boolean(visible));
      return state();
    },
    "desktop:permission": async (kind: string) => {
      if (grants.computerUntil > Date.now())
        throw new Error(
          "Stop computer access before changing macOS permissions.",
        );
      const links: Record<string, string> = {
        screen:
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        accessibility:
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        messages:
          "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
      };
      if (!links[kind]) throw new Error("Unknown permission.");
      await shell.openExternal(links[kind]);
    },
  };
  for (const [name, handler] of Object.entries(handlers))
    ipcMain.handle(name, async (event, ...args) => {
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== panelURL
      )
        throw new Error(
          "Only the local companion panel can change desktop access.",
        );
      try {
        return { ok: true, value: await handler(...(args as never[])) };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not complete this action.",
        };
      }
    });
}

if (process.env.ROOST_DESKTOP_TEST_DATA_DIR)
  app.setPath("userData", process.env.ROOST_DESKTOP_TEST_DATA_DIR);
else {
  // Keep saved connections when the product's display name changes.
  const dataDirectory = join(app.getPath("appData"), "Roost Desktop");
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  app.setPath("userData", dataDirectory);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
  });
  app.whenReady().then(async () => {
    tools = new LocalTools(join(directory, "roost-mac-helper"));
    window = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 720,
      minHeight: 540,
      title: "Roost",
      backgroundColor: "#101211",
      ...(process.platform === "darwin"
        ? {
            titleBarStyle: "hiddenInset" as const,
            trafficLightPosition: { x: 16, y: 25 },
          }
        : {}),
      webPreferences: {
        preload: join(directory, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (url !== panelURL) event.preventDefault();
    });
    registerIPC();
    await window.loadFile(join(directory, "panel.html"));
    window.on("resize", bounds);
    window.on("close", (event) => {
      if (!quitting) {
        event.preventDefault();
        window.hide();
      }
    });
    app.on("activate", () => {
      window.show();
    });
    app.on("browser-window-focus", publish);
    const image = nativeImage.createFromPath(join(directory, "tray.png"));
    image.setTemplateImage(true);
    tray = new Tray(image);
    tray.on("click", () => window.show());
    globalShortcut.register("CommandOrControl+Shift+Escape", stopComputer);
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "Roost",
          submenu: [
            { role: "about" },
            {
              label: "Companion settings",
              accelerator: "CommandOrControl+,",
              click: () => showSettings(true),
            },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        {
          label: "Edit",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: "View",
          submenu: [
            { role: "reload" },
            ...(!app.isPackaged ? [{ role: "toggleDevTools" as const }] : []),
            { role: "togglefullscreen" },
          ],
        },
      ]),
    );
    publish();
    setInterval(() => {
      if (grants.computerUntil && grants.computerUntil <= Date.now())
        stopComputer();
    }, 500).unref();
    try {
      await connect(savedConnection(), "resume");
    } catch {}
  });
  app.on("before-quit", () => {
    quitting = true;
    tools?.stop();
    globalShortcut.unregisterAll();
    connection?.controller.abort();
    void connection?.companion.stop();
  });
}
