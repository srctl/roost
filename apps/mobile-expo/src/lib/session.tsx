import * as SecureStore from "expo-secure-store";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";
import type { Connection } from "./api";
import { type Agent, APIError, makeConnection, RoostAPI } from "./api";

// Same Keychain service/account as the SwiftUI app would be ideal for a real
// migration; the prototype uses its own key so the two apps can coexist.
const key = "roost.connection";

const store = {
  async load(): Promise<Connection | null> {
    const raw =
      Platform.OS === "web"
        ? globalThis.localStorage?.getItem(key)
        : await SecureStore.getItemAsync(key);
    return raw ? (JSON.parse(raw) as Connection) : null;
  },
  async save(connection: Connection) {
    const raw = JSON.stringify(connection);
    if (Platform.OS === "web") globalThis.localStorage?.setItem(key, raw);
    else
      await SecureStore.setItemAsync(key, raw, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
  },
  async clear() {
    if (Platform.OS === "web") globalThis.localStorage?.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  },
};

type Session = {
  ready: boolean;
  api: RoostAPI | null;
  agents: Agent[];
  error: string | null;
  loading: boolean;
  connect(server: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const api = useMemo(
    () => (connection ? new RoostAPI(connection) : null),
    [connection],
  );

  useEffect(() => {
    store
      .load()
      .then(setConnection)
      .catch(() =>
        setError("Unlock your phone to access your saved connection."),
      )
      .finally(() => setReady(true));
  }, []);

  const refresh = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      setAgents(await api.get<Agent[]>("agents"));
      setError(null);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  const connect = useCallback(async (server: string, token: string) => {
    const next = makeConnection(server, token);
    const candidate = new RoostAPI(next);
    const session = await candidate.get<{ apiVersion: number }>("session");
    if (session.apiVersion !== 1) {
      throw new APIError("Update the app to connect to this server.");
    }
    const list = await candidate.get<Agent[]>("agents");
    await store.save(next);
    setAgents(list);
    setError(null);
    setConnection(next);
  }, []);

  const disconnect = useCallback(async () => {
    await store.clear();
    setConnection(null);
    setAgents([]);
  }, []);

  const value = useMemo(
    () => ({
      ready,
      api,
      agents,
      error,
      loading,
      connect,
      disconnect,
      refresh,
    }),
    [ready, api, agents, error, loading, connect, disconnect, refresh],
  );
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}

export function useApi() {
  const { api } = useSession();
  if (!api) throw new Error("No Roost connection");
  return api;
}
