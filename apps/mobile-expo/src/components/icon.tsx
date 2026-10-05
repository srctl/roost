import { SymbolView } from "expo-symbols";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";

type Name = ComponentProps<typeof SymbolView>["name"];
type SF = Extract<Name, string>;
type Material = NonNullable<Exclude<Name, string>["android"]>;

// SF Symbols on iOS; Material Symbols on Android and web.
export function Icon({
  sf,
  md,
  size = 20,
  color,
}: {
  sf: SF;
  md: Material;
  size?: number;
  color: ColorValue;
}) {
  return (
    <SymbolView
      name={{ ios: sf, android: md, web: md }}
      size={size}
      tintColor={color}
    />
  );
}
