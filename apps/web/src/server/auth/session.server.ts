import { digest, openAuth } from "./store.server";

export const sessionCookie = "__Host-roost-session";
export const ceremonyCookie = "__Host-roost-ceremony";
export function cookie(request: Request, name: string) {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${name}=`));
  return values.length === 1 ? values[0]!.slice(name.length + 1) : null;
}
export function sessionId(request: Request) {
  const value = cookie(request, sessionCookie);
  return value ? digest(value) : null;
}
export function setCookie(name: string, value: string, seconds: number) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;
}
export function authenticatedSocket(request: Request): string | null {
  const store = openAuth();
  if (!store) return null;
  try {
    const config = store.config();
    if (
      request.headers.get("origin") !== config.origin ||
      new URL(request.url).host !== new URL(config.origin).host
    )
      throw new Response("Forbidden", { status: 403 });
    const session = store.session(sessionId(request));
    if (!session) throw new Response("Sign in required", { status: 401 });
    return session.id;
  } finally {
    store.close();
  }
}
export function sessionActive(id: string | null) {
  const store = openAuth();
  if (!store) return id === null;
  try {
    return Boolean(store.session(id));
  } finally {
    store.close();
  }
}
