import type { SymbolView } from "expo-symbols";
import type { ComponentProps } from "react";

type Name = ComponentProps<typeof SymbolView>["name"];

export type NativeButtonProps = {
  label: string;
  onPress: () => void;
  /** SF Symbol on iOS. */
  sf?: Extract<Name, string>;
  /** Material Symbol on Android and web. */
  md?: NonNullable<Exclude<Name, string>["android"]>;
  /** glassProminent is the tinted primary action; glass is secondary. */
  variant?: "glass" | "glassProminent";
  iconOnly?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  size?: "small" | "regular" | "large";
  testID?: string;
};
