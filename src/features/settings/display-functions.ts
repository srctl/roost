import { createServerFn } from "@tanstack/react-start";
import { getCookie, setResponseHeader } from "@tanstack/react-start/server";
import {
  activityDetailsKey,
  readDisplayPreferences,
  responseStyleKey,
} from "./display-preferences";

export const getDisplayPreferences = createServerFn({ method: "GET" }).handler(
  () => {
    setResponseHeader("Cache-Control", "private, no-store");
    const responseStyle = getCookie(responseStyleKey);
    const activityDetails = getCookie(activityDetailsKey);
    return {
      ...readDisplayPreferences(responseStyle, activityDetails),
      migrateResponseStyle: responseStyle === undefined,
      migrateActivityDetails: activityDetails === undefined,
    };
  },
);
