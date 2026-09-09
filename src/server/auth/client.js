const content = document.querySelector("#content");
const status = document.querySelector("#status");
let setup = null;
// A fixed destination for updater reauthentication, never a supplied URL/path.
const returnToUpdates =
  new URLSearchParams(location.search).get("updates") === "1";
function captureSetup() {
  const value = new URLSearchParams(location.hash.slice(1)).get("setup");
  if (value) setup = value;
  history.replaceState(null, "", returnToUpdates ? "/auth?updates=1" : "/auth");
}
captureSetup();
window.addEventListener("hashchange", () => {
  captureSetup();
  render().catch((error) => {
    status.textContent = error.message;
  });
});

function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
function button(label, action) {
  const node = element("button", label);
  node.type = "button";
  node.onclick = async () => {
    node.disabled = true;
    status.textContent = "";
    try {
      await action();
    } catch (error) {
      status.textContent =
        error.name === "NotAllowedError"
          ? "Passkey request canceled or unavailable. Try again with your passkey device."
          : error.message;
    } finally {
      node.disabled = false;
    }
  };
  return node;
}
async function api(operation, data) {
  const response = await fetch(`/auth/api/${operation}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: "same-origin",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Please sign in again.");
  return result;
}
const decode = (value) =>
  Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (char) => char.charCodeAt(0),
  );
const encode = (value) =>
  btoa(String.fromCharCode(...new Uint8Array(value)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
function responseJSON(credential) {
  const response = credential.response;
  const result = {
    id: credential.id,
    rawId: encode(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: { clientDataJSON: encode(response.clientDataJSON) },
  };
  if (response.attestationObject) {
    result.response.attestationObject = encode(response.attestationObject);
    result.response.transports = response.getTransports?.() ?? [];
  } else {
    result.response.authenticatorData = encode(response.authenticatorData);
    result.response.signature = encode(response.signature);
    result.response.userHandle = response.userHandle
      ? encode(response.userHandle)
      : undefined;
  }
  return result;
}
async function passkey(register, name, returnToSettings = false) {
  if (!window.PublicKeyCredential)
    throw new Error(
      "This browser does not support passkeys. Use a current browser over HTTPS.",
    );
  const { options } = await api(
    register ? "register-options" : "login-options",
    register && setup ? { setup } : {},
  );
  options.challenge = decode(options.challenge);
  if (register) {
    options.user.id = decode(options.user.id);
    options.excludeCredentials = options.excludeCredentials.map((value) => ({
      ...value,
      id: decode(value.id),
    }));
  } else if (options.allowCredentials) {
    options.allowCredentials = options.allowCredentials.map((value) => ({
      ...value,
      id: decode(value.id),
    }));
  }
  const credential = await navigator.credentials[register ? "create" : "get"]({
    publicKey: options,
  });
  if (!credential) throw new Error("No passkey received. Try again.");
  await api(register ? "register-verify" : "login-verify", {
    response: responseJSON(credential),
    name,
  });
  setup = null;
  location.assign(
    register && name
      ? "/auth"
      : returnToUpdates
        ? "/settings?group=updates"
        : returnToSettings
          ? "/auth"
          : "/",
  );
}
async function render() {
  const response = await fetch("/auth/api/state", { cache: "no-store" });
  const state = await response.json();
  if (!response.ok) throw new Error(state.error ?? "Could not load sign-in.");
  content.replaceChildren();
  if (!state.enabled) {
    location.replace("/settings");
    return;
  }
  if (setup) {
    content.append(
      element("h1", "Make yourself at home"),
      element(
        "p",
        "Create your owner passkey to open Roost. Use your device’s fingerprint, face recognition, or screen lock.",
      ),
      button("Create passkey", () => passkey(true)),
    );
    return;
  }
  if (!state.authenticated) {
    content.append(
      element("h1", "Welcome home"),
      element("p", "Sign in with your passkey to open Roost."),
      button("Sign in with a passkey", () => passkey(false)),
    );
    if (state.setup)
      content.append(
        element(
          "p",
          "First time here? Open the setup link generated on your server.",
        ),
      );
    content.append(
      element("small", "Lost access? Run roost auth recover on your server."),
    );
    return;
  }
  const back = element("a", "Back to Roost");
  back.href = returnToUpdates ? "/settings?group=updates" : "/settings";
  content.append(
    back,
    element("h1", "Passkeys and sessions"),
    element(
      "p",
      "Keep a second passkey so you can sign in if you lose a device.",
    ),
  );
  if (!state.recent)
    content.append(
      element("p", "Sign in again to change passkeys or revoke sessions."),
      button("Verify with a passkey", () => passkey(false, undefined, true)),
    );
  content.append(element("h2", "Your passkeys"));
  for (const credential of state.credentials) {
    const row = element("div", "");
    row.className = "row";
    row.append(element("span", credential.name));
    if (state.credentials.length > 1)
      row.append(
        button("Remove", async () => {
          await api("remove-passkey", { id: credential.id });
          await render();
        }),
      );
    content.append(row);
  }
  const label = element("label", "Passkey name");
  label.htmlFor = "name";
  const name = document.createElement("input");
  name.id = "name";
  name.maxLength = 80;
  name.placeholder = "e.g. Personal phone";
  name.autocomplete = "off";
  content.append(
    label,
    name,
    button("Add a passkey", () =>
      passkey(true, name.value.trim() || "Passkey"),
    ),
    element("h2", "Signed-in sessions"),
  );
  for (const session of state.sessions) {
    const row = element("div", "");
    row.className = "row";
    row.append(
      element(
        "span",
        `${session.current ? "This browser" : "Browser session"} · ${new Date(session.created).toLocaleString()}`,
      ),
      button(session.current ? "Sign out" : "Revoke", async () => {
        await api(session.current ? "logout" : "revoke-session", {
          id: session.id,
        });
        await render();
      }),
    );
    content.append(row);
  }
}
render().catch((error) => {
  status.textContent = error.message;
});
