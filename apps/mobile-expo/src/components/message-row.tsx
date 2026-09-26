import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  FadeInDown,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { Agent, Message } from "@/lib/api";
import { motion, usePalette } from "@/lib/theme";
import { Character } from "./character";
import { Icon } from "./icon";
import { Markdown } from "./markdown";

const replyThreshold = 72;

function haptic() {
  if (Platform.OS !== "web") Haptics.selectionAsync();
}

export function MessageRow({
  message,
  arriving,
  canReply,
  onReply,
}: {
  message: Message;
  arriving: boolean;
  canReply: boolean;
  onReply: () => void;
}) {
  const palette = usePalette();
  const isUser = message.role === "user";
  const offset = useSharedValue(0);
  const armed = useSharedValue(false);
  const swipeable = canReply && message.role === "assistant";

  // Same directional rule as SwipeToReply in MessageView.swift: horizontal
  // drags starting away from the screen edge, 72pt to arm, 96pt max travel.
  const pan = Gesture.Pan()
    .enabled(swipeable)
    .activeOffsetX(24)
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      offset.value = Math.min(96, Math.max(0, event.translationX));
      const next = offset.value >= replyThreshold;
      if (next !== armed.value) {
        armed.value = next;
        if (next) scheduleOnRN(haptic);
      }
    })
    .onEnd(() => {
      if (offset.value >= replyThreshold) scheduleOnRN(onReply);
      offset.value = withSpring(0, motion.settle);
      armed.value = false;
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));
  const iconStyle = useAnimatedStyle(() => ({
    opacity: Math.min(offset.value / replyThreshold, 1),
    transform: [
      {
        scale: interpolate(
          offset.value,
          [0, replyThreshold],
          [0.8, 1],
          "clamp",
        ),
      },
    ],
  }));

  const openMenu = () => {
    const actions = [
      "Copy text",
      ...(swipeable ? ["Reply in thread"] : []),
      "Cancel",
    ];
    const choose = (index: number) => {
      if (actions[index] === "Copy text")
        Clipboard.setStringAsync(message.text);
      if (actions[index] === "Reply in thread") onReply();
    };
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: actions, cancelButtonIndex: actions.length - 1 },
        choose,
      );
    } else {
      Alert.alert(
        "Message",
        undefined,
        actions.map((title, index) => ({
          text: title,
          style: title === "Cancel" ? "cancel" : "default",
          onPress: () => choose(index),
        })),
      );
    }
  };

  if (message.role === "activity") {
    return (
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Icon sf="terminal" md="terminal" size={15} color={palette.muted} />
        <Text style={{ color: palette.muted, fontSize: 15 }}>
          {message.title ?? "Activity"}
        </Text>
      </View>
    );
  }
  if (message.role === "notice") {
    return (
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Icon sf="circle.dotted" md="pending" size={14} color={palette.muted} />
        <View style={{ flex: 1 }}>
          {message.title ? (
            <Text
              style={{ color: palette.muted, fontSize: 13, fontWeight: "500" }}
            >
              {message.title}
            </Text>
          ) : null}
          <Text style={{ color: palette.muted, fontSize: 13 }}>
            {message.text}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <Animated.View
      entering={arriving ? FadeInDown.springify().duration(320) : undefined}
    >
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 4,
            top: 0,
            bottom: 0,
            justifyContent: "center",
          },
          iconStyle,
        ]}
      >
        <Icon
          sf="arrowshape.turn.up.left.fill"
          md="reply"
          size={20}
          color={palette.accent}
        />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[{ alignItems: isUser ? "flex-end" : "flex-start" }, rowStyle]}
        >
          <Pressable
            onLongPress={openMenu}
            delayLongPress={350}
            accessibilityActions={
              swipeable ? [{ name: "reply", label: "Reply in thread" }] : []
            }
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === "reply") onReply();
            }}
            style={{
              maxWidth: "88%",
              paddingHorizontal: 14,
              paddingVertical: 10,
              backgroundColor: isUser ? palette.action : palette.bubble,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              borderBottomLeftRadius: isUser ? 18 : 5,
              borderBottomRightRadius: isUser ? 5 : 18,
              gap: 8,
            }}
          >
            {!isUser && message.title ? (
              <Text style={{ color: palette.muted, fontSize: 12 }}>
                {message.title}
              </Text>
            ) : null}
            {isUser ? (
              <Text
                selectable
                style={{
                  color: palette.onAccent,
                  fontSize: 17,
                  lineHeight: 23,
                }}
              >
                {message.text}
              </Text>
            ) : (
              <Markdown text={message.text} />
            )}
            {message.files?.map((file) => (
              <View
                key={file.id}
                style={{ flexDirection: "row", gap: 6, alignItems: "center" }}
              >
                <Icon
                  sf="doc"
                  md="description"
                  size={14}
                  color={isUser ? palette.onAccent : palette.accent}
                />
                <Text
                  style={{
                    color: isUser ? palette.onAccent : palette.accent,
                    fontSize: 15,
                  }}
                >
                  {file.name}
                </Text>
              </View>
            ))}
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

export function EmptyConversation({
  agent,
  main,
}: {
  agent: Agent;
  main: boolean;
}) {
  const palette = usePalette();
  return (
    <View style={{ alignItems: "center", gap: 16, paddingVertical: 60 }}>
      <Character name={agent.character} size={80} />
      <Text
        style={{ color: palette.foreground, fontSize: 22, fontWeight: "500" }}
      >
        {main ? `Start with ${agent.name}` : "Continue in this thread"}
      </Text>
      <Text style={{ color: palette.muted, fontSize: 17, textAlign: "center" }}>
        {main
          ? "Send a task, ask a question, or share a file."
          : "Replies share your agent’s context."}
      </Text>
    </View>
  );
}
