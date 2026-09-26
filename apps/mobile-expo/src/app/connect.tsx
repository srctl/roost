import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Character } from "@/components/character";
import { NativeButton } from "@/components/native-button";
import { useSession } from "@/lib/session";
import { usePalette } from "@/lib/theme";

export default function ConnectScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { connect, error: sessionError } = useSession();
  const [server, setServer] = useState("");
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setConnecting(true);
    setError(null);
    try {
      await connect(server, token);
      setToken("");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  const label = {
    color: palette.foreground,
    fontSize: 15,
    fontWeight: "500" as const,
  };
  const input = { color: palette.foreground, fontSize: 17, paddingVertical: 6 };
  const shown = error ?? sessionError;

  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{
        padding: 24,
        paddingTop: insets.top + 36,
        gap: 28,
        maxWidth: 560,
        width: "100%",
        alignSelf: "center",
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ flexDirection: "row", gap: 2, alignItems: "flex-end" }}>
        <Character name="moss" size={66} />
        <Character name="wisp" size={56} />
        <Character name="peach" size={56} />
      </View>
      <View style={{ gap: 8 }}>
        <Text
          style={{
            color: palette.foreground,
            fontSize: 34,
            fontWeight: "600",
            lineHeight: 41,
          }}
        >
          {"Your Roost.\nWithin reach."}
        </Text>
        <Text style={{ color: palette.muted, fontSize: 17 }}>
          Connect to your server to pick up with your agents.
        </Text>
      </View>
      <View
        style={{
          padding: 20,
          gap: 18,
          borderRadius: 18,
          backgroundColor: palette.surface,
        }}
      >
        <View style={{ gap: 8 }}>
          <Text style={label}>Server address</Text>
          <TextInput
            value={server}
            onChangeText={setServer}
            placeholder="https://roost.example.com"
            placeholderTextColor={palette.faint}
            keyboardType="url"
            textContentType="URL"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!connecting}
            testID="serverAddress"
            style={input}
          />
        </View>
        <View style={{ height: 1, backgroundColor: palette.border }} />
        <View style={{ gap: 8 }}>
          <Text style={label}>Device token</Text>
          <TextInput
            value={token}
            onChangeText={setToken}
            placeholder="Paste your device token"
            placeholderTextColor={palette.faint}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!connecting}
            testID="deviceToken"
            style={input}
          />
        </View>
      </View>
      {shown ? (
        <Text
          style={{ color: "#C0392B", fontSize: 15 }}
          accessibilityRole="alert"
        >
          {shown}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <NativeButton
          label={connecting ? "Connecting…" : "Connect to Roost"}
          variant="glassProminent"
          size="large"
          disabled={connecting || !server || !token}
          testID="connectButton"
          onPress={submit}
        />
        {connecting ? <ActivityIndicator color={palette.muted} /> : null}
      </View>
      <Pressable
        onPress={() =>
          Alert.alert(
            "Connect your iPhone",
            "On your Roost server run:\n\nroost mobile create --name iPhone --output ~/iphone-token.txt\n\nCopy the token into the app and delete the transfer file afterward.",
          )
        }
      >
        <Text style={{ color: palette.accent, fontSize: 15 }}>
          How to get a device token
        </Text>
      </Pressable>
    </KeyboardAwareScrollView>
  );
}
