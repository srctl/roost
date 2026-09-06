import { Icon } from "../ui/primitives";
import * as stylex from "@stylexjs/stylex";
import { colors } from "../../styles/tokens.stylex";

export function Attachment({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div {...stylex.props(styles.attachment)}>
      <Icon name="file" size={21} />
      <div {...stylex.props(styles.attachmentInfo)}>
        <span {...stylex.props(styles.attachmentTitle)}>{title}</span>
        <span {...stylex.props(styles.attachmentSubtitle)}>{subtitle}</span>
      </div>
      <Icon name="arrow" size={16} />
    </div>
  );
}
const styles = stylex.create({
  attachment: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 8,
    marginTop: 18,
    color: colors.muted,
  },
  attachmentInfo: { flex: 1, display: "flex", flexDirection: "column", gap: 3 },
  attachmentTitle: { color: colors.foreground, fontSize: 12, fontWeight: 500 },
  attachmentSubtitle: { fontSize: 10 },
});
