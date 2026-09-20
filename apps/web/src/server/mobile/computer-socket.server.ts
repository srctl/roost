import { connect, type Socket } from "node:net";
import { defineWebSocketHandler } from "nitro";
import {
  attachViewer,
  connectMobileViewer,
  disconnectViewer,
  viewerConnected,
} from "../computer/session.server";
import { mobileDeviceActive, mobileIdentity } from "./tokens.server";

const sockets = new Map<string, Socket>();
const timers = new Map<string, ReturnType<typeof setInterval>>();
const active = (device: unknown) => {
  try {
    return typeof device === "string" && mobileDeviceActive(device);
  } catch {
    return false;
  }
};

export default defineWebSocketHandler({
  upgrade(request) {
    if (
      request.headers.has("origin") ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      throw new Response("Forbidden", { status: 403 });
    const device = mobileIdentity(request);
    const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
    if (!device || !connectMobileViewer(ticket, device))
      throw new Response("Forbidden", { status: 403 });
    return { context: { device, ticket } };
  },
  open(peer) {
    const socket = connect(
      Number(process.env.ROOST_DESKTOP_VNC_PORT ?? 5901),
      "127.0.0.1",
    );
    sockets.set(peer.id, socket);
    const check = () => {
      if (active(peer.context.device)) return true;
      socket.destroy();
      peer.close(1008, "Reconnect with a valid device token");
      return false;
    };
    const timer = setInterval(check, 1000);
    timer.unref();
    timers.set(peer.id, timer);
    check();
    attachViewer(String(peer.context.ticket), () => {
      socket.destroy();
      peer.close(1000, "Control timed out");
    });
    socket.on("data", (data) => {
      if (check()) peer.send(data);
    });
    socket.on("error", () => peer.close(1011, "Desktop unavailable"));
    socket.on("close", () => peer.close());
  },
  message(peer, message) {
    if (!active(peer.context.device)) {
      sockets.get(peer.id)?.destroy();
      peer.close(1008, "Device disconnected");
      return;
    }
    if (!viewerConnected(String(peer.context.ticket))) return;
    const data = message.uint8Array();
    if (data.length > 1024 * 1024) {
      peer.close(1009, "Message too large");
      return;
    }
    sockets.get(peer.id)?.write(data);
  },
  close(peer) {
    sockets.get(peer.id)?.destroy();
    sockets.delete(peer.id);
    clearInterval(timers.get(peer.id));
    timers.delete(peer.id);
    disconnectViewer(String(peer.context.ticket));
  },
  error(peer) {
    sockets.get(peer.id)?.destroy();
    sockets.delete(peer.id);
    clearInterval(timers.get(peer.id));
    timers.delete(peer.id);
    disconnectViewer(String(peer.context.ticket));
  },
});
