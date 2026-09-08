import {
  Excalidraw,
  exportToSvg,
  loadFromBlob,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";

function Editor() {
  const [api, setApi] = useState(null);
  const [label, setLabel] = useState("Choose a native .excalidraw file");
  async function load(file) {
    const scene = await loadFromBlob(file, null, null);
    api.updateScene(scene);
    api.scrollToContent(scene.elements, { fitToContent: true });
    setLabel(file.name);
    window.researchScene = {
      count: () => api.getSceneElements().length,
      exportSvg: async () =>
        (
          await exportToSvg({
            elements: api.getSceneElements(),
            appState: {
              ...api.getAppState(),
              exportBackground: true,
              exportWithDarkMode: false,
            },
            files: {},
          })
        ).outerHTML,
      roundTrip: () =>
        serializeAsJSON(api.getSceneElements(), api.getAppState(), {}, "local"),
    };
  }
  return (
    <>
      <div style={{ padding: 12, fontFamily: "Arial", height: 54 }}>
        <label>
          Load editable concept{" "}
          <input
            aria-label="Load editable concept"
            type="file"
            accept=".excalidraw"
            disabled={!api}
            onChange={(event) => load(event.target.files[0])}
          />
        </label>
        <span>{label}</span>
      </div>
      <div style={{ height: "calc(100vh - 78px)" }}>
        <Excalidraw excalidrawAPI={setApi} />
      </div>
    </>
  );
}
createRoot(document.getElementById("root")).render(<Editor />);
