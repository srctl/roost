import { Button, ContextMenu, Host, RNHostView } from "@expo/ui/swift-ui";
import type { MessageMenuProps } from "./message-menu.types";

// SwiftUI .contextMenu: the bubble lifts, the background blurs, and the
// menu springs out exactly like Messages.
export function MessageMenu({ actions, children }: MessageMenuProps) {
  return (
    <Host matchContents>
      <ContextMenu>
        <ContextMenu.Items>
          {actions.map((action) => (
            <Button
              key={action.title}
              label={action.title}
              systemImage={action.sf}
              onPress={action.onPress}
            />
          ))}
        </ContextMenu.Items>
        <ContextMenu.Trigger>
          <RNHostView matchContents>{children}</RNHostView>
        </ContextMenu.Trigger>
      </ContextMenu>
    </Host>
  );
}
