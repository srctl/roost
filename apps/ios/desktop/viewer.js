import RFBModule from "@novnc/novnc/lib/rfb.js";

// noVNC ships Babel CommonJS; browser bundlers may preserve its default wrapper.
const RFB = typeof RFBModule === "function" ? RFBModule : RFBModule.default;

// The only transport is the native URLSession socket. Device credentials never
// enter JavaScript, URLs, cookies, persistent WebKit storage, or a remote page.
const post = (type, value) =>
  window.webkit.messageHandlers.desktop.postMessage({
    type,
    value,
    generation: window.roostGeneration,
  });
const channel = {
  readyState: 0,
  binaryType: "arraybuffer",
  protocol: "",
  onopen: null,
  onmessage: null,
  onclose: null,
  onerror: null,
  send(bytes) {
    let binary = "";
    for (const value of new Uint8Array(
      bytes.buffer ?? bytes,
      bytes.byteOffset ?? 0,
      bytes.byteLength,
    ))
      binary += String.fromCharCode(value);
    post("send", btoa(binary));
  },
  close() {
    this.readyState = 3;
    post("close");
  },
};
const client = new RFB(document.getElementById("screen"), channel);
client.viewOnly = true;
client.scaleViewport = true;
client.resizeSession = false;
client.focusOnClick = false;
client.background = "#111311";
client.addEventListener("connect", () => post("connected"));
client.addEventListener("disconnect", () => post("disconnected"));
client.addEventListener("securityfailure", () => post("failure"));
window.roostReceive = (base64) => {
  if (channel.readyState === 0) {
    channel.readyState = 1;
    channel.onopen?.();
  }
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  channel.onmessage?.({ data: bytes.buffer });
};
window.roostControl = (value) => {
  client.viewOnly = !value;
};
window.roostKey = (key) => {
  if (!client.viewOnly) client.sendKey(key);
};
window.roostText = (text) => {
  if (client.viewOnly) return false;
  for (const character of text) {
    const cp = character.codePointAt(0);
    client.sendKey(
      cp === 10
        ? 0xff0d
        : cp === 9
          ? 0xff09
          : cp === 8
            ? 0xff08
            : cp <= 255
              ? cp
              : 0x01000000 | cp,
    );
  }
  return true;
};
post("ready");
