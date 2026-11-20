import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
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
  withTiming,
} from "react-native-reanimated";
import type { Approval } from "@/lib/api";
import { usePalette } from "@/lib/theme";
import { Icon } from "./icon";
import { NativeButton } from "./native-button";

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
  const glass = isLiquidGlassAvailable();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 8,
        marginHorizontal: 12,
        marginBottom: 8,
      }}
    >
      <NativeButton
        label="Add attachment"
        sf="plus"
        md="add"
        iconOnly
        size="large"
        disabled
        onPress={() => {}}
      />
      {/* UIGlassEffect on iOS 26; a plain rounded surface elsewhere. */}
      <GlassView
        glassEffectStyle="regular"
        isInteractive
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "flex-end",
          borderRadius: 25,
          paddingLeft: 16,
          paddingRight: 4,
          minHeight: 50,
          backgroundColor: glass ? undefined : palette.bubble,
        }}
      >
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
            paddingTop: 14,
            paddingBottom: 14,
            fontSize: 17,
            color: palette.foreground,
          }}
        />
        <View style={{ paddingVertical: 5, flexDirection: "row", gap: 4 }}>
          {busy ? (
            stopping ? (
              <ActivityIndicator color={palette.muted} style={{ width: 40 }} />
            ) : (
              <NativeButton
                label="Stop response"
                sf="stop.fill"
                md="stop"
                iconOnly
                onPress={onStop}
              />
            )
          ) : null}
          {!busy || hasDraft || pending ? (
            sending ? (
              <ActivityIndicator color={palette.muted} style={{ width: 40 }} />
            ) : (
              <NativeButton
                label={pending ? "Retry message" : "Send message"}
                sf={pending ? "arrow.clockwise" : "arrow.up"}
                md={pending ? "refresh" : "arrow_upward"}
                variant="glassProminent"
                iconOnly
                disabled={!canSend}
                testID="sendMessage"
                onPress={() => {
                  if (Platform.OS !== "web")
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onSend();
                }}
              />
            )
          ) : null}
        </View>
      </GlassView>
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
        <NativeButton
          label="Decline"
          destructive
          disabled={working}
          onPress={() => respond("decline")}
        />
        {working ? <ActivityIndicator color={palette.muted} /> : null}
        <NativeButton
          label="Approve once"
          variant="glassProminent"
          disabled={working}
          testID="approveOnce"
          onPress={() => respond("approve")}
        />
      </View>
    </View>
  );
}
