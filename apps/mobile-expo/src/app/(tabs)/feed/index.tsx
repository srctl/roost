import { Image } from "expo-image";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  View,
} from "react-native";
import type { FeedItem } from "@/lib/api";
import { type FeedFilter, sectionTitle, useFeed } from "@/lib/feed";
import { useApi } from "@/lib/session";
import { usePalette } from "@/lib/theme";

export default function FeedScreen() {
  const palette = usePalette();
  const api = useApi();
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [pulling, setPulling] = useState(false);
  const feed = useFeed(api, filter);

  const sections = useMemo(() => {
    const groups = new Map<string, FeedItem[]>();
    for (const item of feed.items) {
      const title = sectionTitle(item.publishedAt);
      groups.set(title, [...(groups.get(title) ?? []), item]);
    }
    return [...groups].map(([title, data]) => ({ title, data }));
  }, [feed.items]);

  const menu = (item: FeedItem) => {
    const options = [
      item.saved ? "Remove from saved" : "Save for later",
      "Dismiss",
      "Cancel",
    ];
    const choose = (i: number) => {
      if (i === 0) feed.act(item, item.saved ? "unsave" : "save");
      if (i === 1) feed.act(item, "dismiss");
    };
    if (Platform.OS === "ios")
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: 2,
          destructiveButtonIndex: 1,
          title: item.title,
        },
        choose,
      );
    else
      Alert.alert(item.title, undefined, [
        { text: options[0], onPress: () => choose(0) },
        { text: options[1], style: "destructive", onPress: () => choose(1) },
        { text: "Cancel", style: "cancel" },
      ]);
  };

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: palette.background }}
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          onRefresh={async () => {
            setPulling(true);
            await feed.load();
            setPulling(false);
          }}
        />
      }
      ListHeaderComponent={
        <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 10 }}>
          <View
            accessibilityRole="tablist"
            style={{
              flexDirection: "row",
              padding: 2,
              borderRadius: 9,
              backgroundColor: palette.bubble,
            }}
          >
            {(["all", "saved"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: filter === value }}
                onPress={() => setFilter(value)}
                style={{
                  flex: 1,
                  paddingVertical: 6,
                  borderRadius: 7,
                  alignItems: "center",
                  backgroundColor:
                    filter === value ? palette.background : "transparent",
                }}
              >
                <Text
                  style={{
                    color: palette.foreground,
                    fontSize: 13,
                    fontWeight: "500",
                  }}
                >
                  {value === "all" ? "All" : "Saved"}
                </Text>
              </Pressable>
            ))}
          </View>
          {feed.error ? (
            <Text style={{ color: "#C0392B" }}>{feed.error}</Text>
          ) : null}
          {feed.status?.lastRefreshedAt ? (
            <Text style={{ color: palette.muted, fontSize: 12 }}>
              Updated{" "}
              {new Date(feed.status.lastRefreshedAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
          ) : null}
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Text
          accessibilityRole="header"
          style={{
            color: palette.foreground,
            fontSize: 20,
            fontWeight: "600",
            paddingHorizontal: 20,
            paddingTop: 24,
            paddingBottom: 4,
          }}
        >
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => (
        <Pressable
          onPress={() =>
            router.push({ pathname: "/story/[id]", params: { id: item.id } })
          }
          onLongPress={() => menu(item)}
          style={({ pressed }) => ({
            paddingHorizontal: 20,
            paddingVertical: 14,
            gap: 8,
            backgroundColor: pressed ? palette.selected : palette.background,
            borderBottomWidth: 1,
            borderBottomColor: palette.border,
          })}
        >
          <Text style={{ color: palette.muted, fontSize: 12 }}>
            {item.kind === "update"
              ? `Personal update · ${item.sourceName}`
              : item.sourceName}
            {item.saved ? "  ·  Saved" : ""}
          </Text>
          <Text
            style={{
              color: palette.foreground,
              fontSize: 17,
              fontWeight: "600",
            }}
          >
            {item.title}
          </Text>
          {item.imageUrl ? (
            <Image
              source={item.imageUrl}
              style={{
                width: "100%",
                maxWidth: 420,
                aspectRatio: 16 / 9,
                borderRadius: 10,
                backgroundColor: palette.surface,
              }}
              contentFit="cover"
              transition={200}
              accessibilityLabel={`Image for ${item.title}`}
            />
          ) : null}
          <Text
            numberOfLines={3}
            style={{ color: palette.muted, fontSize: 15, lineHeight: 20 }}
          >
            {item.summary}
          </Text>
        </Pressable>
      )}
      ListEmptyComponent={
        feed.loading ? (
          <ActivityIndicator style={{ marginTop: 60 }} />
        ) : (
          <Text
            style={{ color: palette.muted, textAlign: "center", marginTop: 60 }}
          >
            {filter === "saved" ? "Nothing saved yet" : "No stories yet"}
          </Text>
        )
      }
    />
  );
}
