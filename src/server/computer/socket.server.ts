import { connect, type Socket } from "node:net";
import { defineWebSocketHandler } from "nitro";
import { authenticatedSocket, sessionActive } from "../auth/session.server";
import {
  attachViewer,
  connectViewer,
  disconnectViewer,
  viewerConnected,
} from "./session.server";

const sockets = new Map<string, Socket>();
const authTimers = new Map<string, ReturnType<typeof setInterval>>();

export default defineWebSocketHandler({
  upgrade(request) {
    const session = authenticatedSocket(request);
    const id = new URL(request.url).searchParams.get("ticket") ?? "";
    if (!connectViewer(id, request.headers.get("origin"), session))
      throw new Response("Forbidden", { status: 403 });
    return { context: { ticket: id, session } };
  },

  open(peer) {
    // Only the configured local desktop is reachable; clients cannot choose a host.
    const socket = connect(
      Number(process.env.ROOST_DESKTOP_VNC_PORT ?? 5901),
      "127.0.0.1",
    );
    sockets.set(peer.id, socket);
    const active = () =>
      sessionActive(
        typeof peer.context.session === "string" ? peer.context.session : null,
      );
    const check = () => {
      try {
        if (active()) return;
      } catch {
        /* Fail closed if auth storage is unavailable. */
      }
      socket.destroy();
      peer.close(1008, "Sign in required");
    };
    const timer = setInterval(check, 1000);
    timer.unref();
    authTimers.set(peer.id, timer);
    check();
    attachViewer(String(peer.context.ticket), () => {
      socket.destroy();
      peer.close(1000, "Control timed out");
    });
    socket.on("data", (data) => {
      check();
      if (!socket.destroyed) peer.send(data);
    });
    socket.on("error", () => peer.close(1011, "Desktop unavailable"));
    socket.on("close", () => peer.close());
  },

  message(peer, message) {
    if (
      !sessionActive(
        typeof peer.context.session === "string" ? peer.context.session : null,
      )
    ) {
      sockets.get(peer.id)?.destroy();
      peer.close(1008, "Sign in required");
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
    clearInterval(authTimers.get(peer.id));
    authTimers.delete(peer.id);
    disconnectViewer(String(peer.context.ticket));
  },

  error(peer) {
    sockets.get(peer.id)?.destroy();
    sockets.delete(peer.id);
    clearInterval(authTimers.get(peer.id));
    authTimers.delete(peer.id);
    disconnectViewer(String(peer.context.ticket));
  },
});
