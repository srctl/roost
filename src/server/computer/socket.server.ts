import { connect, type Socket } from "node:net";
import { defineWebSocketHandler } from "nitro";
import {
  attachViewer,
  connectViewer,
  disconnectViewer,
  viewerConnected,
} from "./session.server";

const sockets = new Map<string, Socket>();

export default defineWebSocketHandler({
  upgrade(request) {
    const id = new URL(request.url).searchParams.get("ticket") ?? "";
    if (!connectViewer(id, request.headers.get("origin")))
      throw new Response("Forbidden", { status: 403 });
    return { context: { ticket: id } };
  },

  open(peer) {
    // Only the configured local desktop is reachable; clients cannot choose a host.
    const socket = connect(
      Number(process.env.ROOST_DESKTOP_VNC_PORT ?? 5901),
      "127.0.0.1",
    );
    sockets.set(peer.id, socket);
    attachViewer(String(peer.context.ticket), () => {
      socket.destroy();
      peer.close(1000, "Control timed out");
    });
    socket.on("data", (data) => peer.send(data));
    socket.on("error", () => peer.close(1011, "Desktop unavailable"));
    socket.on("close", () => peer.close());
  },

  message(peer, message) {
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
    disconnectViewer(String(peer.context.ticket));
  },

  error(peer) {
    sockets.get(peer.id)?.destroy();
    sockets.delete(peer.id);
    disconnectViewer(String(peer.context.ticket));
  },
});
