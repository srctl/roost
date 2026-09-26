import { Button, Host } from "@expo/ui/swift-ui";
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  labelStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { usePalette } from "@/lib/theme";
import type { NativeButtonProps } from "./native-button.types";

// A real SwiftUI Button: Liquid Glass material, press morphing and haptics
// come from the system (.buttonStyle(.glass) needs iOS 26).
export function NativeButton({
  label,
  onPress,
  sf,
  variant = "glass",
  iconOnly,
  destructive,
  disabled,
  size = "regular",
  testID,
}: NativeButtonProps) {
  const palette = usePalette();
  return (
    <Host matchContents>
      <Button
        label={label}
        systemImage={sf}
        role={destructive ? "destructive" : "default"}
        onPress={onPress}
        testID={testID}
        modifiers={[
          buttonStyle(variant),
          controlSize(size),
          tint(destructive ? "#C0392B" : palette.accent),
          ...(iconOnly
            ? [labelStyle("iconOnly"), buttonBorderShape("circle")]
            : []),
          disabledModifier(disabled ?? false),
        ]}
      />
    </Host>
  );
}
