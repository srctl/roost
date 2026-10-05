import { View } from "react-native";
// Pixel art shared with the SwiftUI app's CharacterView.
import characters from "../../../ios/Roost/Resources/Characters.json";

type Pixel = {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
};
const catalog = characters as Record<string, Pixel[]>;

export function Character({
  name,
  size = 44,
}: {
  name: string;
  size?: number;
}) {
  const pixels = catalog[name]?.length ? catalog[name] : catalog.moss;
  const unit = size / 16;
  return (
    <View
      style={{ width: size, height: size }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {pixels.map((p) => (
        <View
          key={`${p.x}-${p.y}`}
          style={{
            position: "absolute",
            left: p.x * unit,
            top: p.y * unit,
            width: p.width * unit,
            height: p.height * unit,
            backgroundColor: p.fill,
          }}
        />
      ))}
    </View>
  );
}
