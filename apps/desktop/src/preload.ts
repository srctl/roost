import { contextBridge, ipcRenderer } from "electron";

// Only the bundled local companion panel gets this bridge. The remote Roost
// page has no preload, Node access, device token, or general-purpose IPC.
contextBridge.exposeInMainWorld("roostDesktop", {
  state: () => ipcRenderer.invoke("desktop:state"),
  connect: (origin: string, token: string) =>
    ipcRenderer.invoke("desktop:connect", origin, token),
  disconnect: () => ipcRenderer.invoke("desktop:disconnect"),
  reconnect: () => ipcRenderer.invoke("desktop:reconnect"),
  chats: () => ipcRenderer.invoke("desktop:chats"),
  grants: (agentId: string | null, chats: unknown[]) =>
    ipcRenderer.invoke("desktop:grants", agentId, chats),
  startComputer: () => ipcRenderer.invoke("desktop:start-computer"),
  stopComputer: () => ipcRenderer.invoke("desktop:stop-computer"),
  settings: (visible: boolean) =>
    ipcRenderer.invoke("desktop:settings", visible),
  permission: (kind: string) => ipcRenderer.invoke("desktop:permission", kind),
  onState: (callback: (value: unknown) => void) => {
    ipcRenderer.on("desktop:changed", (_event, value) => callback(value));
  },
});
