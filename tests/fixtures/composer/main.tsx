import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Composer } from "../../../src/components/conversation/composer";
import type { FileAttachment } from "../../../src/features/chat/files";
import "../../../src/styles/reset.css";

declare global {
  interface Window {
    composerTest: {
      sent: { text: string; files: readonly FileAttachment[] }[];
      stops: number;
      finish?: (success: boolean) => void;
      setBusy: (value: boolean) => void;
      setLoading: (value: boolean) => void;
    };
  }
}

function Harness() {
  const [busy, setBusy] = useState(true);
  const [loading, setLoading] = useState(false);
  window.composerTest = {
    sent: window.composerTest?.sent ?? [],
    stops: window.composerTest?.stops ?? 0,
    finish: window.composerTest?.finish,
    setBusy,
    setLoading,
  };
  return (
    <main style={{ maxWidth: 760, padding: 16, margin: "40px auto" }}>
      <Composer
        agentId="fixture"
        agentName="Fixture"
        busy={busy}
        loading={loading}
        onSend={(text, files) => {
          window.composerTest.sent.push({ text, files });
          return new Promise((resolve) => {
            window.composerTest.finish = resolve;
          });
        }}
        onStop={() => {
          window.composerTest.stops++;
          setBusy(false);
        }}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
