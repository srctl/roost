export async function initializeAnalytics(
  service: "roost-marketing" | "roost-docs",
) {
  const applicationId = import.meta.env.VITE_DATADOG_APPLICATION_ID?.trim();
  const clientToken = import.meta.env.VITE_DATADOG_CLIENT_TOKEN?.trim();
  const site = import.meta.env.VITE_DATADOG_SITE?.trim();

  if (!import.meta.env.PROD || !applicationId || !clientToken || !site) return;

  try {
    const { datadogRum } = await import("@datadog/browser-rum");
    datadogRum.init({
      applicationId,
      clientToken,
      site,
      service,
      env: import.meta.env.VITE_DATADOG_ENV?.trim() || "production",
      sessionSampleRate: 100,
      sessionReplaySampleRate: 100,
      trackUserInteractions: true,
      trackResources: true,
      trackLongTasks: true,
      defaultPrivacyLevel: "mask-user-input",
    });
  } catch {
    // Analytics must not prevent navigation, search, or other site behavior.
    console.warn("Roost analytics could not be initialized.");
  }
}
