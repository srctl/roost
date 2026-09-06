import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Schema } from "effect";
import { available } from "../../server/available";
import {
  checkComputerOrigin,
  computerStatus,
  createViewer,
  viewerControl,
} from "../../server/computer/session.server";

function mutation<T>(action: () => T) {
  if (!checkComputerOrigin(getRequest().headers.get("origin")))
    return {
      ok: false as const,
      error: "Desktop access requires the configured Roost address.",
    };
  try {
    return { ok: true as const, value: action() };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Desktop unavailable.",
    };
  }
}

export const getComputerStatus = createServerFn({ method: "GET" })
  .middleware([available])
  .handler(() => computerStatus());

export const openComputer = createServerFn({ method: "POST" })
  .middleware([available])
  .handler(() => mutation(createViewer));

export const controlComputer = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ id: Schema.String, control: Schema.Boolean }),
    ),
  )
  .handler(({ data }) => mutation(() => viewerControl(data.id, data.control)));
