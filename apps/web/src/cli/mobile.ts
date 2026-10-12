import { writeFileSync } from "node:fs";
import { z } from "zod";
import { MobileTokens } from "../server/mobile/tokens.server";

export function mobileCommand(args: string[], directory: string) {
  const [action, ...rest] = args;
  const store = new MobileTokens(directory);
  try {
    if (
      rest.length === 3 &&
      action === "renew" &&
      rest[0] === "--id" &&
      rest[2] === "--json"
    ) {
      const device = store.renew(z.uuid().parse(rest[1]));
      console.log(
        JSON.stringify({
          id: device.id,
          token: device.secret,
          expires: device.expires,
        }),
      );
      return;
    }
    if (
      rest.length === 5 &&
      action === "create" &&
      rest[0] === "--name" &&
      rest[2] === "--id" &&
      rest[4] === "--json"
    ) {
      const device = store.create(rest[1]!, z.uuid().parse(rest[3]));
      console.log(
        JSON.stringify({
          id: device.id,
          token: device.secret,
          expires: device.expires,
        }),
      );
      return;
    }
    if (action === "list" && rest.length === 0) {
      console.log(JSON.stringify(store.list(), null, 2));
      return;
    }
    if (action === "revoke" && rest.length === 1) {
      if (!store.revoke(rest[0]!)) throw new Error("Device not found.");
      console.log("Device revoked.");
      return;
    }
    if (
      action === "create" &&
      rest.length === 4 &&
      rest[0] === "--name" &&
      rest[2] === "--output"
    ) {
      const device = store.create(rest[1]!);
      try {
        writeFileSync(rest[3]!, `${device.secret}\n`, {
          mode: 0o600,
          flag: "wx",
        });
      } catch (error) {
        store.revoke(device.id);
        throw error;
      }
      console.log(
        `Device ${device.id} created. Token saved to the requested file; expires ${new Date(device.expires).toISOString()}.`,
      );
      return;
    }
    throw new Error(
      "Use roost mobile create --name iPhone --output <new-file>, roost mobile list, or roost mobile revoke <device-id>.",
    );
  } finally {
    store.close();
  }
}
