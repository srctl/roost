import * as stylex from "@stylexjs/stylex";
import { type FileAttachment, formatFileSize } from "../../features/chat/files";

export function FileLinks({ files }: { files?: readonly FileAttachment[] }) {
  if (!files?.length) return null;
  return (
    <ul aria-label="Files" {...stylex.props(styles.files)}>
      {files.map((file) => (
        <li key={file.id}>
          <a
            href={file.url}
            download={file.name}
            {...stylex.props(styles.link)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5" />
            </svg>
            <span>{file.name}</span>
            <span {...stylex.props(styles.size)}>
              {formatFileSize(file.size)}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

const styles = stylex.create({
  files: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    marginTop: 6,
    display: "grid",
    gap: 8,
  },
  link: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "inherit",
    textUnderlineOffset: 3,
    fontSize: 12,
    overflowWrap: "anywhere",
  },
  size: {
    fontSize: 10,
    opacity: 0.7,
    whiteSpace: "nowrap",
    textDecoration: "none",
  },
});
