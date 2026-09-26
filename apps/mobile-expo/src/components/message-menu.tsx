import { Alert, Pressable } from "react-native";
import type { MessageMenuProps } from "./message-menu.types";

// Android and web: long press opens a simple action list.
export function MessageMenu({ actions, children }: MessageMenuProps) {
  return (
    <Pressable
      delayLongPress={350}
      onLongPress={() =>
        Alert.alert("Message", undefined, [
          ...actions.map((action) => ({
            text: action.title,
            onPress: action.onPress,
          })),
          { text: "Cancel", style: "cancel" as const },
        ])
      }
    >
      {children}
    </Pressable>
  );
}
