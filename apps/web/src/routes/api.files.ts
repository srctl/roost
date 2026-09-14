import { createFileRoute } from "@tanstack/react-router";
import {
  downloadFileRequest,
  uploadFileRequest,
} from "../server/files/http.server";

export const Route = createFileRoute("/api/files")({
  server: {
    handlers: {
      GET: ({ request }) => downloadFileRequest(request),
      POST: ({ request }) => uploadFileRequest(request),
    },
  },
});
