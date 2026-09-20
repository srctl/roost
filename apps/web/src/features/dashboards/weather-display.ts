export function weatherCondition(code: number) {
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code === 56 || code === 57) return "Freezing drizzle";
  if (code === 61) return "Light rain";
  if (code === 63) return "Rain";
  if (code === 65) return "Heavy rain";
  if (code === 66 || code === 67) return "Freezing rain";
  if (code === 71) return "Light snow";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code === 95) return "Thunderstorms";
  if (code === 96 || code === 99) return "Thunderstorms with hail";
  return "Conditions unavailable";
}

export function weatherDay(date: string) {
  // A forecast date is a civil day in the selected city, not the viewer's timezone.
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
