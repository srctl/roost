import { Stack } from "expo-router";

export default function Layout() {
  return (
    <Stack screenOptions={{ headerLargeTitle: true, headerTransparent: false }}>
      <Stack.Screen name="index" options={{ title: "Roost" }} />
    </Stack>
  );
}
