import { useEffect, useState } from "react";

export function PasskeySetting() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/auth/api/state", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json())
      .then((state) => setEnabled(state.enabled === true))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!enabled) return null;
  return (
    <p>
      <a href="/auth">Manage passkeys and signed-in sessions</a>
    </p>
  );
}
