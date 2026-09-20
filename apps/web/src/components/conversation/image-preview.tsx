import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import {
  type FileAttachment,
  safeAttachmentUrl,
} from "../../features/chat/files";
import { colors } from "../../styles/tokens.stylex";
import { Button } from "../ui/button";
import { Icon } from "../ui/primitives";

export function ImagePreview({
  file,
  compact = false,
}: {
  file: FileAttachment;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const url = safeAttachmentUrl(file);
  useEffect(() => {
    // An SSR image may fail before hydration attaches the error listener.
    const element = image.current;
    if (element?.complete && element.naturalWidth === 0) setFailed(true);
  }, []);
  if (!url || !file.mimeType.toLowerCase().startsWith("image/")) return null;
  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (open) setFailed(false);
      }}
    >
      <Dialog.Trigger
        type="button"
        aria-label={`Open image, ${file.name}`}
        {...stylex.props(
          styles.preview,
          failed && !compact && styles.unavailable,
          compact && styles.compact,
        )}
      >
        {failed ? (
          <span {...stylex.props(styles.fallback)}>
            {compact ? "Image" : "Preview unavailable · Open image"}
          </span>
        ) : (
          <img
            ref={image}
            src={url}
            alt={file.name}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailed(true)}
            {...stylex.props(styles.image, compact && styles.crop)}
          />
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup {...stylex.props(styles.viewer)}>
          <div {...stylex.props(styles.heading)}>
            <Dialog.Title {...stylex.props(styles.title)}>
              {file.name}
            </Dialog.Title>
            <a
              href={url}
              download={file.name}
              {...stylex.props(styles.download)}
            >
              Download
            </a>
            <Dialog.Close render={<Button />} aria-label="Close image">
              <Icon name="close" />
            </Dialog.Close>
          </div>
          <Dialog.Description {...stylex.props(styles.description)}>
            Image preview. Download to keep the original file.
          </Dialog.Description>
          <div {...stylex.props(styles.canvas)}>
            {failed ? (
              <p>
                This image could not be previewed. You can still download the
                file.
              </p>
            ) : (
              <img
                src={url}
                alt={file.name}
                decoding="async"
                onError={() => setFailed(true)}
                {...stylex.props(styles.fullImage)}
              />
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const styles = stylex.create({
  preview: {
    display: "grid",
    placeItems: "center",
    width: "min(100%, 420px)",
    aspectRatio: "4 / 3",
    maxHeight: 320,
    padding: 0,
    overflow: "hidden",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
    color: colors.muted,
    cursor: "zoom-in",
    outlineOffset: 3,
  },
  compact: { width: 64, height: 64, flexShrink: 0, borderRadius: 6 },
  unavailable: { aspectRatio: "auto", minHeight: 44, maxHeight: 44 },
  image: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  crop: { objectFit: "cover" },
  fallback: { padding: 8, fontSize: 11 },
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 40,
    backgroundColor: "#000000a8",
  },
  viewer: {
    position: "fixed",
    inset: { default: 24, "@media (max-width: 700px)": 8 },
    zIndex: 41,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    padding: 12,
    paddingTop: "max(12px, env(safe-area-inset-top))",
    paddingBottom: "max(12px, env(safe-area-inset-bottom))",
    backgroundColor: colors.background,
    color: colors.foreground,
    borderRadius: 12,
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
  },
  heading: { display: "flex", alignItems: "center", gap: 12 },
  title: {
    margin: 0,
    flex: 1,
    minWidth: 0,
    overflowWrap: "anywhere",
    fontSize: 14,
    fontWeight: 500,
  },
  download: {
    color: "inherit",
    fontSize: 12,
    paddingBlock: 12,
    textUnderlineOffset: 3,
  },
  description: { marginBlock: 8, color: colors.muted, fontSize: 12 },
  canvas: {
    display: "grid",
    placeItems: "center",
    flex: 1,
    minHeight: 0,
    overflow: "auto",
  },
  fullImage: {
    display: "block",
    width: "100%",
    height: "100%",
    minHeight: 0,
    objectFit: "contain",
  },
});
