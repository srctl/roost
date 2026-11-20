import { Pressable, Text } from "react-native";
import { usePalette } from "@/lib/theme";
import { Icon } from "./icon";
import type { NativeButtonProps } from "./native-button.types";

// Android and web fallback with the same shape as the SwiftUI glass button.
export function NativeButton({
  label,
  onPress,
  sf,
  md,
  variant = "glass",
  iconOnly,
  destructive,
  disabled,
  size = "regular",
  testID,
}: NativeButtonProps) {
  const palette = usePalette();
  const prominent = variant === "glassProminent";
  const color = destructive
    ? "#C0392B"
    : prominent
      ? palette.onAccent
      : palette.foreground;
  const height = size === "small" ? 32 : size === "large" ? 50 : 40;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height,
        minWidth: height,
        paddingHorizontal: iconOnly ? 0 : 16,
        borderRadius: height / 2,
        backgroundColor: prominent ? palette.accent : palette.bubble,
        opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      {sf && md ? (
        <Icon sf={sf} md={md} size={height * 0.45} color={color} />
      ) : null}
      {iconOnly ? null : (
        <Text
          style={{
            color,
            fontSize: size === "large" ? 17 : 15,
            fontWeight: "600",
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
