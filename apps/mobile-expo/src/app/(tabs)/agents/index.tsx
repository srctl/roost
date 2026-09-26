import { router, Stack, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { Character } from "@/components/character";
import { Icon } from "@/components/icon";
import type { Agent } from "@/lib/api";
import { useSession } from "@/lib/session";
import { usePalette } from "@/lib/theme";

export default function AgentsScreen() {
  const palette = usePalette();
  const { agents, refresh, loading, error, disconnect } = useSession();
  const [search, setSearch] = useState("");
  const [pulling, setPulling] = useState(false);

  // Same 15s foreground refresh as AgentsView.swift.
  useFocusEffect(
    useCallback(() => {
      refresh();
      const timer = setInterval(refresh, 15_000);
      return () => clearInterval(timer);
    }, [refresh]),
  );

  const filtered = agents.filter(
    (a) =>
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.instructions.toLowerCase().includes(search.toLowerCase()),
  );

  const row = ({ item }: { item: Agent }) => (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/chat/[agentId]",
          params: { agentId: item.id },
        })
      }
      testID={`agent-${item.name}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 20,
        paddingVertical: 8,
        backgroundColor: pressed ? palette.selected : palette.background,
      })}
    >
      <Character name={item.character} size={46} />
      <View style={{ flex: 1, gap: 5, paddingVertical: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text
            style={{
              color: palette.foreground,
              fontSize: 17,
              fontWeight: "600",
            }}
          >
            {item.name}
          </Text>
          {item.kind === "coding" ? (
            <Icon
              sf="chevron.left.forwardslash.chevron.right"
              md="code"
              size={12}
              color={palette.muted}
            />
          ) : null}
        </View>
        <Text numberOfLines={2} style={{ color: palette.muted, fontSize: 15 }}>
          {item.instructions}
        </Text>
      </View>
      <Icon
        sf="chevron.right"
        md="chevron_right"
        size={13}
        color={palette.faint}
      />
    </Pressable>
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: "Find an agent",
            onChangeText: (event) => setSearch(event.nativeEvent.text),
            hideWhenScrolling: true,
          },
          headerLeft: () => (
            <Pressable
              accessibilityLabel="Disconnect"
              hitSlop={10}
              onPress={() =>
                Alert.alert("Disconnect this device?", undefined, [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Disconnect",
                    style: "destructive",
                    onPress: disconnect,
                  },
                ])
              }
            >
              <Icon
                sf="gearshape"
                md="settings"
                size={22}
                color={palette.accent}
              />
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={filtered}
        keyExtractor={(a) => a.id}
        renderItem={row}
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: palette.background }}
        ItemSeparatorComponent={() => (
          <View
            style={{
              height: 1,
              marginLeft: 80,
              backgroundColor: palette.border,
            }}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={async () => {
              setPulling(true);
              await refresh();
              setPulling(false);
            }}
          />
        }
        ListHeaderComponent={
          error ? (
            <Text style={{ color: "#C0392B", padding: 20 }}>{error}</Text>
          ) : null
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: 60 }} />
          ) : (
            <Text
              style={{
                color: palette.muted,
                textAlign: "center",
                marginTop: 60,
              }}
            >
              {search ? `No results for “${search}”` : "Your agents live here"}
            </Text>
          )
        }
      />
    </>
  );
}
