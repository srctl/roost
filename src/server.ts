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
import {
  trackUpdateRequest,
  updateGateRequest,
} from "./server/update-gate.server";
import { updatesRequest } from "./server/updates.server";

const handler = createStartHandler(defaultStreamHandler);

export default createServerEntry({
  async fetch(request, options) {
    const gate = await updateGateRequest(request, () =>
      // A fixed, capability-authorized read-only shell probe. Settings' external
      // connection loaders remain blocked by maintenance; no client JS executes.
      handler(
        new Request(new URL("/settings?group=updates", request.url), {
          headers: request.headers,
        }),
        options,
      ),
    );
    if (gate) return gate;
    return trackUpdateRequest(async () => {
      const auth = await authGate(request, authPage);
      if (auth) return auth;
      if (new URL(request.url).pathname.startsWith("/api/updates"))
        return updatesRequest(request);
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
    });
  },
});
