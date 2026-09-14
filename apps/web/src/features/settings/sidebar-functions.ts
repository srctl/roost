import { createServerFn } from "@tanstack/react-start";
import { getCookie, setResponseHeader } from "@tanstack/react-start/server";
import {
  readSidebarPreferences,
  sidebarCollapsedKey,
  sidebarWidthKey,
} from "./sidebar-preferences";

export const getSidebarPreferences = createServerFn({ method: "GET" }).handler(
  () => {
    setResponseHeader("Cache-Control", "private, no-store");
    return readSidebarPreferences(
      getCookie(sidebarCollapsedKey),
      getCookie(sidebarWidthKey),
    );
  },
);
