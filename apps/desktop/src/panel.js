const api = window.roostDesktop;
const byId = (id) => document.getElementById(id);
let current;
let conversations = [];
async function call(operation) {
  byId("error").hidden = true;
  try {
    const result = await operation;
    if (!result.ok) throw new Error(result.error);
    return result.value;
  } catch (error) {
    byId("error").textContent = error.message;
    byId("error").hidden = false;
    throw error;
  }
}
function render(value) {
  current = value;
  byId("host").textContent = value.origin
    ? new URL(value.origin).host
    : "Desktop";
  byId("status").textContent = value.status;
  byId("activity").textContent = value.activity;
  byId("panel").hidden = !value.settingsVisible;
  byId("stop").hidden = value.grants.computerUntil <= Date.now();
  byId("access").hidden = !value.agents.length;
  byId("connection-summary").hidden = !value.origin;
  byId("connection-origin").textContent = value.origin;
  byId("connect-form").hidden = value.status === "Connected";
  byId("intro").hidden = Boolean(value.origin);
  byId("token").required = !value.origin;
  if (value.origin && !byId("origin").value)
    byId("origin").value = value.origin;
  const agent = byId("agent");
  const signature = value.agents
    .map((item) => `${item.id}:${item.name}`)
    .join("|");
  if (agent.dataset.signature !== signature) {
    agent.replaceChildren(
      new Option("Local access off", ""),
      ...value.agents.map((item) => new Option(item.name, item.id)),
    );
    agent.dataset.signature = signature;
  }
  agent.value = value.grants.agentId || "";
  byId("start-computer").disabled =
    !value.grants.agentId ||
    value.status !== "Connected" ||
    value.grants.computerUntil > Date.now();
  byId("load-chats").disabled =
    !value.grants.agentId || value.status !== "Connected";
  byId("permission-status").textContent =
    `Screen recording: ${value.permissions.screen}. Computer control: ${value.permissions.accessibility ? "allowed" : "not enabled"}. Messages helper: ${value.permissions.messagesInstalled ? "installed" : "install imsg to enable reading"}.`;
  for (const checkbox of byId("chats").querySelectorAll("input"))
    checkbox.checked = value.grants.chats.some(
      (chat) => chat.id === Number(checkbox.value),
    );
}
byId("connect-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  byId("connect").disabled = true;
  try {
    render(
      await call(api.connect(byId("origin").value, byId("token").value.trim())),
    );
    byId("token").value = "";
  } catch {
  } finally {
    byId("connect").disabled = false;
  }
});
byId("disconnect").addEventListener(
  "click",
  () =>
    void call(api.disconnect())
      .then((value) => {
        conversations = [];
        byId("chats").replaceChildren();
        byId("chats").hidden = true;
        byId("origin").value = "";
        render(value);
      })
      .catch(() => {}),
);
byId("reconnect").addEventListener(
  "click",
  () =>
    void call(api.reconnect())
      .then(render)
      .catch(() => {}),
);
byId("settings").addEventListener(
  "click",
  () =>
    void call(api.settings(!current.settingsVisible))
      .then(render)
      .catch(() => {}),
);
byId("workspace").addEventListener(
  "click",
  () =>
    void call(api.settings(false))
      .then(render)
      .catch(() => {}),
);
byId("agent").addEventListener(
  "change",
  () =>
    void call(api.grants(byId("agent").value || null, []))
      .then(render)
      .catch(() => {}),
);
byId("stop").addEventListener(
  "click",
  () =>
    void call(api.stopComputer())
      .then(render)
      .catch(() => {}),
);
byId("start-computer").addEventListener(
  "click",
  () =>
    void call(api.startComputer())
      .then(render)
      .catch(() => {}),
);
byId("load-chats").addEventListener("click", async () => {
  try {
    conversations = await call(api.chats());
    const list = byId("chats");
    list.replaceChildren();
    list.hidden = false;
    for (const chat of conversations) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = String(chat.id);
      input.checked = current.grants.chats.some((item) => item.id === chat.id);
      label.append(input, document.createTextNode(chat.label));
      list.append(label);
      input.addEventListener("change", () => {
        const selected = Array.from(list.querySelectorAll("input:checked")).map(
          (item) =>
            conversations.find((chat) => chat.id === Number(item.value)),
        );
        void call(api.grants(current.grants.agentId, selected))
          .then(render)
          .catch(() => {});
      });
    }
    if (!conversations.length)
      list.textContent = "No conversations are available on this Mac.";
  } catch {}
});
for (const kind of ["screen", "accessibility", "messages"])
  byId(`${kind}-permission`).addEventListener(
    "click",
    () => void call(api.permission(kind)).catch(() => {}),
  );
setInterval(() => {
  const seconds = Math.max(
    0,
    Math.ceil(((current?.grants.computerUntil || 0) - Date.now()) / 1000),
  );
  byId("remaining").textContent = seconds
    ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} remaining`
    : "";
}, 1000);
api.onState(render);
void call(api.state())
  .then(render)
  .catch(() => {});
