import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { FeedItem } from "../features/feed/schema";
import { useOpenAfterMount } from "../features/motion";
import { feedStyles as styles } from "../styles/feed.stylex";
import { MessageContent } from "./conversation/message-content";
import { Button } from "./ui/button";
import { Icon } from "./ui/primitives";

export type FeedAction =
  | "save"
  | "unsave"
  | "dismiss"
  | "restore"
  | "read"
  | "unread"
  | "more"
  | "less";

export function feedTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(timestamp));
}

function sourceLabel(item: FeedItem) {
  if (item.kind === "update") return "Personal update";
  if (item.kind === "story") return "Roost story";
  return "Article";
}

function FeedMeta({ item }: { item: FeedItem }) {
  return (
    <div {...stylex.props(styles.meta)}>
      {item.readAt === null && (
        <span {...stylex.props(styles.unreadDot)}>
          <span {...stylex.props(styles.srOnly)}>Unread</span>
        </span>
      )}
      {item.kind === "update" && <Icon name="mail" size={13} />}
      <span {...stylex.props(styles.source)}>{item.sourceName}</span>
      <span aria-hidden="true">·</span>
      <span>{sourceLabel(item)}</span>
      <span aria-hidden="true">·</span>
      <time dateTime={new Date(item.publishedAt).toISOString()}>
        {feedTime(item.publishedAt)}
      </time>
      {item.importance === "important" && (
        <span {...stylex.props(styles.important)}>Important</span>
      )}
    </div>
  );
}

function FeedActions({
  item,
  busy,
  onAction,
  extended = false,
}: {
  item: FeedItem;
  busy: boolean;
  onAction: (item: FeedItem, action: FeedAction) => void;
  extended?: boolean;
}) {
  return (
    <div {...stylex.props(styles.actions)}>
      <Button
        aria-label={item.saved ? "Remove from saved" : "Save for later"}
        aria-pressed={item.saved}
        disabled={busy}
        onClick={() => onAction(item, item.saved ? "unsave" : "save")}
        xstyle={[styles.action, item.saved && styles.activeAction]}
      >
        <Icon name="bookmark" size={14} />
        {item.saved ? "Saved" : "Save"}
      </Button>
      <Button
        disabled={busy}
        onClick={() => onAction(item, "more")}
        xstyle={styles.action}
      >
        More like this
      </Button>
      {extended && (
        <Button
          disabled={busy}
          onClick={() => onAction(item, "less")}
          xstyle={styles.action}
        >
          Less like this
        </Button>
      )}
      <span {...stylex.props(styles.actionSpacer)} />
      {extended && (
        <Button
          disabled={busy}
          onClick={() =>
            onAction(item, item.readAt === null ? "read" : "unread")
          }
          xstyle={styles.action}
        >
          {item.readAt === null ? "Mark read" : "Mark unread"}
        </Button>
      )}
      <Button
        aria-label={`Dismiss ${item.title}`}
        title="Dismiss"
        disabled={busy}
        onClick={() => onAction(item, "dismiss")}
        xstyle={styles.action}
      >
        <Icon name="close" size={14} />
      </Button>
    </div>
  );
}

export function FeedEntry({
  item,
  lead,
  busy,
  onOpen,
  onAction,
}: {
  item: FeedItem;
  lead: boolean;
  busy: boolean;
  onOpen: (item: FeedItem) => void;
  onAction: (item: FeedItem, action: FeedAction) => void;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const hasImage =
    !!item.imageUrl && failedImage !== item.imageUrl && item.kind !== "update";
  return (
    <article
      aria-labelledby={`feed-title-${item.id}`}
      data-feed-item={item.id}
      {...stylex.props(
        styles.article,
        lead && styles.lead,
        item.kind === "update" && styles.update,
      )}
    >
      <div
        {...stylex.props(
          styles.articleLayout,
          !hasImage && styles.withoutImage,
          lead && styles.leadLayout,
        )}
      >
        {lead && hasImage && (
          <button
            type="button"
            aria-label={`Read ${item.title}`}
            onClick={() => onOpen(item)}
            {...stylex.props(styles.imageButton)}
          >
            <img
              src={item.imageUrl!}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setFailedImage(item.imageUrl)}
              {...stylex.props(styles.image, styles.leadImage)}
            />
          </button>
        )}
        <div {...stylex.props(styles.content)}>
          <FeedMeta item={item} />
          <button
            type="button"
            onClick={() => onOpen(item)}
            {...stylex.props(styles.openArticle)}
          >
            <h2
              id={`feed-title-${item.id}`}
              {...stylex.props(
                styles.headline,
                lead && styles.leadHeadline,
                item.kind === "update" && styles.updateHeadline,
              )}
            >
              {item.title}
            </h2>
            <p {...stylex.props(styles.summary)}>{item.summary}</p>
          </button>
          <FeedActions item={item} busy={busy} onAction={onAction} />
        </div>
        {!lead && hasImage && (
          <button
            type="button"
            aria-label={`Read ${item.title}`}
            onClick={() => onOpen(item)}
            {...stylex.props(styles.imageButton)}
          >
            <img
              src={item.imageUrl!}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setFailedImage(item.imageUrl)}
              {...stylex.props(styles.image)}
            />
          </button>
        )}
      </div>
    </article>
  );
}

export function FeedReader({
  item,
  busy,
  discussing,
  canDiscuss,
  error,
  announcement,
  onClose,
  onAction,
  onDiscuss,
}: {
  item: FeedItem;
  busy: boolean;
  discussing: boolean;
  canDiscuss: boolean;
  error: string;
  announcement: string;
  onClose: () => void;
  onAction: (item: FeedItem, action: FeedAction) => void;
  onDiscuss: (item: FeedItem) => void;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const shown = useOpenAfterMount(true);
  return (
    <Dialog.Root
      open={shown}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup {...stylex.props(styles.dialog)}>
          <header {...stylex.props(styles.dialogHeader)}>
            <span {...stylex.props(styles.status)}>{sourceLabel(item)}</span>
            <Dialog.Close
              render={
                <Button aria-label="Close story">
                  <Icon name="close" />
                </Button>
              }
            />
          </header>
          <div {...stylex.props(styles.dialogScroll, styles.readerScroll)}>
            <FeedMeta item={item} />
            <Dialog.Title {...stylex.props(styles.readerHeadline)}>
              {item.title}
            </Dialog.Title>
            <Dialog.Description {...stylex.props(styles.srOnly)}>
              {item.summary}
            </Dialog.Description>
            {item.imageUrl &&
              failedImage !== item.imageUrl &&
              item.kind !== "update" && (
                <img
                  src={item.imageUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setFailedImage(item.imageUrl)}
                  {...stylex.props(styles.readerImage)}
                />
              )}
            <div {...stylex.props(styles.readerBody)}>
              <MessageContent>{item.body || item.summary}</MessageContent>
            </div>
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                {...stylex.props(styles.externalLink)}
              >
                Read at {item.sourceName}
                <Icon name="external" size={13} />
              </a>
            )}
            {item.why && (
              <aside {...stylex.props(styles.why)}>
                <span {...stylex.props(styles.whyLabel)}>
                  Why this is in your feed
                </span>
                {item.why}
              </aside>
            )}
            {item.citations.length > 0 && (
              <section aria-label="Sources" {...stylex.props(styles.citations)}>
                <h3 {...stylex.props(styles.sectionTitle)}>Sources</h3>
                <ul {...stylex.props(styles.citationList)}>
                  {item.citations.map((citation) => (
                    <li key={`${citation.url}-${citation.title}`}>
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        {...stylex.props(styles.link)}
                      >
                        {citation.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <FeedActions item={item} busy={busy} onAction={onAction} extended />
          </div>
          <footer {...stylex.props(styles.dialogFooter)}>
            <div>
              {error ? (
                <p role="alert" {...stylex.props(styles.error)}>
                  {error}
                </p>
              ) : (
                <p role="status" {...stylex.props(styles.feedback)}>
                  {announcement}
                </p>
              )}
              {!canDiscuss && (
                <p {...stylex.props(styles.hint)}>
                  Choose an agent in feed preferences to discuss stories.
                </p>
              )}
            </div>
            <Button
              disabled={!canDiscuss || discussing}
              onClick={() => onDiscuss(item)}
              xstyle={styles.primary}
            >
              <Icon name="reply" size={14} />
              {discussing ? "Opening discussion…" : "Discuss with agent"}
            </Button>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
