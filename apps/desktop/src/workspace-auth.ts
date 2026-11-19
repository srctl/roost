import type { Authentication } from "./connection-settings";

type HeaderResponse =
  | { requestHeaders: Record<string, string> }
  | { cancel: true };
export type HeaderHandler = (
  details: { url: string; requestHeaders: Record<string, string> },
  callback: (response: HeaderResponse) => void,
) => void;
export function installWorkspaceAuthentication(
  register: (handler: HeaderHandler) => void,
  origin: string,
  authenticate: () => Promise<Authentication>,
) {
  register((details, callback) => {
    const headers = { ...details.requestHeaders };
    // A redirect must never carry the proxy credential to another origin.
    for (const name of Object.keys(headers))
      if (name.toLowerCase() === "x-exedev-authorization") delete headers[name];
    const target = new URL(details.url);
    if (target.protocol === "wss:") target.protocol = "https:";
    if (target.protocol === "ws:") target.protocol = "http:";
    if (target.origin !== origin) {
      callback({ requestHeaders: headers });
      return;
    }
    void authenticate().then(
      (auth) => {
        if (auth.proxyToken)
          headers["X-Exedev-Authorization"] = `Bearer ${auth.proxyToken}`;
        callback({ requestHeaders: headers });
      },
      () => callback({ cancel: true }),
    );
  });
}
