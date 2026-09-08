import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import { authGate } from "./server/auth/http.server";
import { authPage } from "./server/auth/page.server";
import { nativeAuthEnabled } from "./server/auth/store.server";
import { compressHtml } from "./server/html-compression.server";
import { followStartupRedirect } from "./server/startup-response.server";

const handler = createStartHandler(defaultStreamHandler);

export default createServerEntry({
  async fetch(request, options) {
    const auth = await authGate(request, authPage);
    if (auth) return auth;
    const response = await followStartupRedirect(
      request,
      await handler(request, options),
      (nextRequest) => handler(nextRequest, options),
    );
    if (nativeAuthEnabled()) {
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
    }
    return compressHtml(request, response);
  },
});
