import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Markdown } from "@/components/markdown";
import { feedCache } from "@/lib/feed";
import { usePalette } from "@/lib/theme";

// Feed reader, presented as a native form sheet with detents.
export default function StoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const item = feedCache.get(id);
  if (!item) return null;
  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={{ padding: 20, gap: 14 }}
    >
      <Text style={{ color: palette.muted, fontSize: 13 }}>
        {item.sourceName}
      </Text>
      <Text
        style={{
          color: palette.foreground,
          fontSize: 26,
          fontWeight: "700",
          lineHeight: 31,
        }}
      >
        {item.title}
      </Text>
      {item.imageUrl ? (
        <Image
          source={item.imageUrl}
          style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 12 }}
          contentFit="cover"
        />
      ) : null}
      <View
        style={{
          padding: 14,
          borderRadius: 12,
          backgroundColor: palette.surface,
          gap: 4,
        }}
      >
        <Text style={{ color: palette.muted, fontSize: 12, fontWeight: "600" }}>
          Why you’re seeing this
        </Text>
        <Text style={{ color: palette.foreground, fontSize: 15 }}>
          {item.why}
        </Text>
      </View>
      <Markdown text={item.body || item.summary} />
      {item.url ? (
        <Pressable
          onPress={() => item.url && WebBrowser.openBrowserAsync(item.url)}
          style={{
            paddingVertical: 14,
            borderRadius: 12,
            alignItems: "center",
            backgroundColor: palette.accent,
          }}
        >
          <Text
            style={{ color: palette.onAccent, fontSize: 17, fontWeight: "600" }}
          >
            Read at {item.sourceName}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
