import type { ReactNode } from "react";
import { Button } from "./button";
import * as stylex from "@stylexjs/stylex";
import moss from "../../assets/moss.svg";
import wisp from "../../assets/wisp.svg";
import peach from "../../assets/peach.svg";

const characters = { moss, wisp, peach };
export function Avatar({
  character,
  size = 32,
}: {
  character: keyof typeof characters;
  size?: number;
}) {
  return (
    <img
      src={characters[character]}
      alt=""
      width={size}
      height={size}
      {...stylex.props(styles.avatar)}
    />
  );
}
const paths = {
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  settings: (
    <>
      <path d="M4 7h7m4 0h5M4 17h3m4 0h9" />
      <circle cx="13" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  "chevron-down": <path d="m8 10 4 4 4-4" />,
  "chevron-right": <path d="m10 8 4 4-4 4" />,
  more: (
    <>
      <circle cx="5" cy="12" r=".8" />
      <circle cx="12" cy="12" r=".8" />
      <circle cx="19" cy="12" r=".8" />
    </>
  ),
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M14 4v16" />
    </>
  ),
  edit: <path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z" />,
  expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  file: (
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M8 12h8M8 16h6" />
  ),
  check: <path d="m5 12 4 4L19 6" />,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  up: <path d="M12 19V5m-5 5 5-5 5 5" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
};
export function Icon({
  name,
  size = 16,
}: {
  name: keyof typeof paths;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...stylex.props(styles.icon)}
    >
      {paths[name]}
    </svg>
  );
}
// Visual controls only for this UI pass; no action handlers.
export function StaticButton({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Button disabled aria-label={label}>
      {children}
    </Button>
  );
}
const styles = stylex.create({
  avatar: { display: "block", flexShrink: 0, imageRendering: "pixelated" },
  icon: { flexShrink: 0, display: "block" },
});
