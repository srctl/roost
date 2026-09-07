import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import { compressHtml } from "./server/html-compression.server";
import { followStartupRedirect } from "./server/startup-response.server";

const handler = createStartHandler(defaultStreamHandler);

export default createServerEntry({
  async fetch(request, options) {
    const response = await followStartupRedirect(
      request,
      await handler(request, options),
      (nextRequest) => handler(nextRequest, options),
    );
    return compressHtml(request, response);
  },
});
