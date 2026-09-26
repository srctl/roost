import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import type { Approval } from "@/lib/api";
import { motion, usePalette } from "@/lib/theme";
import { Icon } from "./icon";

function Dot({ index }: { index: number }) {
  const palette = usePalette();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);
  // Web indicator timing: 1.2s cycle, 150ms stagger, peak at 30%.
  useEffect(() => {
    if (reduced) return;
    pulse.value = withDelay(
      index * 150,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 360 }),
          withTiming(0, { duration: 360 }),
          withTiming(0, { duration: 480 }),
        ),
        -1,
      ),
    );
  }, [index, pulse, reduced]);
  const style = useAnimatedStyle(() => ({
    opacity: reduced ? 1 : 0.4 + 0.6 * pulse.value,
    transform: [{ translateY: -3 * pulse.value }],
  }));
  return (
    <Animated.View
      style={[
        {
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: palette.muted,
        },
        style,
      ]}
    />
  );
}

export function TypingIndicator({
  name,
  queued,
}: {
  name: string;
  queued: boolean;
}) {
  const palette = usePalette();
  return (
    <View
      accessible
      accessibilityLabel={
        queued ? `Message queued for ${name}` : `${name} is replying`
      }
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        gap: 4,
        paddingHorizontal: 16,
        paddingVertical: 15,
        marginTop: 8,
        backgroundColor: palette.bubble,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        borderBottomRightRadius: 18,
        borderBottomLeftRadius: 5,
      }}
    >
      {[0, 1, 2].map((i) => (
        <Dot key={i} index={i} />
      ))}
    </View>
  );
}

// PressFeedback in Motion.swift: scale to 0.92 and fade while pressed.
function PressScale({
  onPress,
  disabled,
  label,
  children,
}: {
  onPress: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: scale.value < 1 ? 0.72 : 1,
  }));
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={() => {
        scale.value = withSpring(0.92, motion.press);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, motion.press);
      }}
      hitSlop={6}
    >
      <Animated.View
        style={[
          {
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            opacity: disabled ? 0.35 : 1,
          },
          style,
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

export function Composer({
  agentName,
  draft,
  setDraft,
  busy,
  pending,
  sending,
  stopping,
  onSend,
  onStop,
}: {
  agentName: string;
  draft: string;
  setDraft: (text: string) => void;
  busy: boolean;
  pending: boolean;
  sending: boolean;
  stopping: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  const palette = usePalette();
  const hasDraft = draft.trim().length > 0;
  const canSend = !sending && (pending || (hasDraft && draft.length <= 32_000));
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 10,
        marginHorizontal: 12,
        marginBottom: 8,
        paddingHorizontal: 8,
        backgroundColor: palette.bubble,
        borderRadius: 24,
      }}
    >
      <PressScale label="Add attachment" onPress={() => {}} disabled>
        <Icon sf="plus" md="add" size={20} color={palette.foreground} />
      </PressScale>
      <TextInput
        value={pending ? "" : draft}
        onChangeText={setDraft}
        editable={!pending}
        multiline
        placeholder={busy ? "Add a follow-up…" : `Message ${agentName}…`}
        placeholderTextColor={palette.muted}
        accessibilityLabel={
          pending ? "Waiting for message delivery" : "Message"
        }
        style={{
          flex: 1,
          maxHeight: 140,
          paddingTop: 12,
          paddingBottom: 12,
          fontSize: 17,
          color: palette.foreground,
        }}
      />
      {busy ? (
        <PressScale label="Stop response" onPress={onStop} disabled={stopping}>
          {stopping ? (
            <ActivityIndicator color={palette.muted} />
          ) : (
            <Icon
              sf="stop.fill"
              md="stop"
              size={18}
              color={palette.foreground}
            />
          )}
        </PressScale>
      ) : null}
      {!busy || hasDraft || pending ? (
        <PressScale
          label={pending ? "Retry message" : "Send message"}
          disabled={!canSend}
          onPress={() => {
            if (Platform.OS !== "web")
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onSend();
          }}
        >
          {sending ? (
            <ActivityIndicator color={palette.muted} />
          ) : (
            <Icon
              sf={
                pending ? "arrow.clockwise.circle.fill" : "arrow.up.circle.fill"
              }
              md={pending ? "refresh" : "arrow_circle_up"}
              size={32}
              color={palette.accent}
            />
          )}
        </PressScale>
      ) : null}
    </View>
  );
}

export function ApprovalCard({
  approval,
  onAnswer,
}: {
  approval: Approval;
  onAnswer: (decision: string) => Promise<void>;
}) {
  const palette = usePalette();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const respond = async (decision: string) => {
    setWorking(true);
    setError(null);
    try {
      await onAnswer(decision);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setWorking(false);
    }
  };
  return (
    <View
      style={{
        gap: 12,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.surface,
      }}
    >
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Icon
          sf="hand.raised"
          md="front_hand"
          size={16}
          color={palette.review}
        />
        <Text
          style={{
            color: palette.foreground,
            fontSize: 17,
            fontWeight: "600",
            flex: 1,
          }}
        >
          {approval.title}
        </Text>
      </View>
      <Text style={{ color: palette.muted, fontSize: 15 }}>
        {approval.details}
      </Text>
      {error ? <Text style={{ color: "#C0392B" }}>{error}</Text> : null}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Pressable
          onPress={() => respond("decline")}
          disabled={working}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 16,
            borderRadius: 10,
            backgroundColor: palette.bubble,
          }}
        >
          <Text style={{ color: "#C0392B", fontWeight: "500" }}>Decline</Text>
        </Pressable>
        {working ? <ActivityIndicator color={palette.muted} /> : null}
        <Pressable
          onPress={() => respond("approve")}
          disabled={working}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 16,
            borderRadius: 10,
            backgroundColor: palette.accent,
          }}
        >
          <Text style={{ color: palette.onAccent, fontWeight: "600" }}>
            Approve once
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
