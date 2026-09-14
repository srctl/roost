import { createServerFn } from "@tanstack/react-start";
import { getCookie, setResponseHeader } from "@tanstack/react-start/server";
import {
  activityDetailsKey,
  readDisplayPreferences,
  responseStyleKey,
} from "./display-preferences";

import { readThemePreference, themeKey } from "./themes";

export const getDisplayPreferences = createServerFn({ method: "GET" }).handler(
  () => {
    setResponseHeader("Cache-Control", "private, no-store");
    const responseStyle = getCookie(responseStyleKey);
    const activityDetails = getCookie(activityDetailsKey);
    return {
      ...readDisplayPreferences(responseStyle, activityDetails),
      theme: readThemePreference(getCookie(themeKey)),
      migrateResponseStyle: responseStyle === undefined,
      migrateActivityDetails: activityDetails === undefined,
    };
  },
);
