import type { ReactElement } from "react";

export type MenuAction = {
  title: string;
  sf: "doc.on.doc" | "arrowshape.turn.up.left";
  onPress: () => void;
};

export type MessageMenuProps = {
  actions: MenuAction[];
  children: ReactElement;
};
