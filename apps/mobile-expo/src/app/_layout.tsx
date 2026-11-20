import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SessionProvider, useSession } from "@/lib/session";
import { usePalette } from "@/lib/theme";

SplashScreen.preventAutoHideAsync();

function Routes() {
  const { ready, api } = useSession();
  const palette = usePalette();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;
  const base = palette.scheme === "dark" ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider
      value={{
        ...base,
        colors: {
          ...base.colors,
          primary: palette.accent,
          background: palette.background,
          card: palette.background,
          text: palette.foreground,
          border: palette.border,
        },
      }}
    >
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={api !== null}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="chat/[agentId]" options={{ headerShown: true }} />
          <Stack.Screen
            name="story/[id]"
            options={{
              headerShown: true,
              presentation: "formSheet",
              sheetAllowedDetents: [0.6, 1],
              sheetGrabberVisible: true,
              title: "",
            }}
          />
        </Stack.Protected>
        <Stack.Protected guard={api === null}>
          <Stack.Screen name="connect" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SessionProvider>
          <Routes />
        </SessionProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
