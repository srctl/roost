import { NativeTabs } from "expo-router/unstable-native-tabs";
import { usePalette } from "@/lib/theme";

// UITabBarController on iOS (Liquid Glass on iOS 26), Material bottom
// navigation on Android. Same Feed / Agents split as AgentsView.swift.
export default function TabsLayout() {
  const palette = usePalette();
  return (
    <NativeTabs tintColor={palette.accent}>
      <NativeTabs.Trigger name="agents">
        <NativeTabs.Trigger.Label>Agents</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bubble.left.and.bubble.right" md="forum" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="feed">
        <NativeTabs.Trigger.Label>Feed</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="newspaper" md="newspaper" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
