import { router, Stack, useLocalSearchParams } from "expo-router";
import { forwardRef, useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  type ScrollViewProps,
  Text,
  View,
} from "react-native";
import {
  KeyboardChatScrollView,
  KeyboardStickyView,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Character } from "@/components/character";
import {
  ApprovalCard,
  Composer,
  TypingIndicator,
} from "@/components/chat-parts";
import { EmptyConversation, MessageRow } from "@/components/message-row";
import type { Entry } from "@/lib/api";
import { useConversation } from "@/lib/conversation";
import { useApi, useSession } from "@/lib/session";
import { usePalette } from "@/lib/theme";

type ChatScrollRef = React.ComponentRef<typeof KeyboardChatScrollView>;

// Keyboard-aware chat scrolling: content lifts with the keyboard only when
// the newest message is visible, and follows interactive dismissal.
const ChatScroll = forwardRef<ChatScrollRef, ScrollViewProps>((props, ref) => (
  <KeyboardChatScrollView
    ref={ref}
    {...props}
    inverted
    keyboardLiftBehavior="whenAtEnd"
  />
));

export default function ChatScreen() {
  const { agentId, conversationId } = useLocalSearchParams<{
    agentId: string;
    conversationId?: string;
  }>();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const agent = useSession().agents.find((a) => a.id === agentId);
  const id = conversationId ?? agentId;
  const main = id === agentId;
  const chat = useConversation(api, agentId, id);

  // Activity rows are hidden in the default Messages style, like the native app.
  const rows = useMemo(
    () => chat.entries.filter((e) => e.message.role !== "activity").reverse(),
    [chat.entries],
  );

  const openReply = useCallback(
    async (entry: Entry) => {
      const thread = await chat.reply(entry.message);
      if (thread)
        router.push({
          pathname: "/chat/[agentId]",
          params: { agentId, conversationId: thread },
        });
    },
    [chat, agentId],
  );

  if (!agent) {
    return (
      <ActivityIndicator
        style={{ flex: 1, backgroundColor: palette.background }}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Character name={agent.character} size={28} />
              <Text
                numberOfLines={1}
                style={{
                  color: palette.foreground,
                  fontSize: 17,
                  fontWeight: "600",
                }}
              >
                {main ? agent.name : "Reply thread"}
              </Text>
            </View>
          ),
          headerBackTitle: "Agents",
        }}
      />
      {main ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu
            icon="bubble.left.and.bubble.right"
            accessibilityLabel="Reply threads"
            title={
              chat.threads.length ? "Reply threads" : "No reply threads yet"
            }
          >
            {chat.threads.map((thread) => (
              <Stack.Toolbar.MenuAction
                key={thread.id}
                subtitle={
                  thread.replyCount === 1
                    ? "1 reply"
                    : `${thread.replyCount} replies`
                }
                onPress={() =>
                  router.push({
                    pathname: "/chat/[agentId]",
                    params: { agentId, conversationId: thread.id },
                  })
                }
              >
                {thread.parent.text.slice(0, 80)}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : null}
      <FlatList
        data={rows}
        inverted
        keyExtractor={(e) => e.message.id}
        renderScrollComponent={(props) => <ChatScroll {...props} />}
        keyboardDismissMode="interactive"
        contentContainerStyle={{ padding: 20, gap: 12 }}
        renderItem={({ item }) => (
          <MessageRow
            message={item.message}
            arriving={chat.arriving.has(item.message.id)}
            canReply={main}
            onReply={() => openReply(item)}
          />
        )}
        // Inverted: the header renders at the bottom, below the newest message.
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            {chat.approvals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                onAnswer={(decision) => chat.answer(approval, decision)}
              />
            ))}
            {chat.busy && chat.approvals.length === 0 ? (
              <TypingIndicator name={agent.name} queued={chat.queued} />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          chat.loading ? (
            <ActivityIndicator style={{ marginTop: 60 }} />
          ) : (
            <View style={{ transform: [{ scaleY: -1 }] }}>
              <EmptyConversation agent={agent} main={main} />
            </View>
          )
        }
      />
      <KeyboardStickyView offset={{ opened: insets.bottom }}>
        <View
          style={{
            paddingBottom: insets.bottom,
            backgroundColor: palette.background,
            gap: 8,
          }}
        >
          {chat.error ? (
            <Pressable
              onPress={chat.clearError}
              style={{ paddingHorizontal: 20 }}
            >
              <Text
                style={{ color: "#C0392B", fontSize: 14 }}
                numberOfLines={4}
              >
                {chat.error}
              </Text>
            </Pressable>
          ) : null}
          <Composer
            agentName={agent.name}
            draft={chat.draft}
            setDraft={chat.setDraft}
            busy={chat.busy}
            pending={chat.pending !== null}
            sending={chat.sending}
            stopping={chat.stopping}
            onSend={chat.send}
            onStop={chat.stop}
          />
        </View>
      </KeyboardStickyView>
    </View>
  );
}
