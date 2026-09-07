import * as stylex from "@stylexjs/stylex";
import acorn from "../../assets/acorn.svg";
import bloom from "../../assets/bloom.svg";
import button from "../../assets/button.svg";
import ember from "../../assets/ember.svg";
import moss from "../../assets/moss.svg";
import nimbus from "../../assets/nimbus.svg";
import peach from "../../assets/peach.svg";
import pebble from "../../assets/pebble.svg";
import pip from "../../assets/pip.svg";
import puddle from "../../assets/puddle.svg";
import sprout from "../../assets/sprout.svg";
import wisp from "../../assets/wisp.svg";
import type { Character } from "../../features/agents/schema";

const characters = {
  moss,
  wisp,
  peach,
  sprout,
  ember,
  puddle,
  pip,
  bloom,
  pebble,
  button,
  nimbus,
  acorn,
} satisfies Record<typeof Character.Type, string>;

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
  plus: <path d="M12 5v14M5 12h14" />,
  settings: (
    <>
      <path d="M4 7h7m4 0h5M4 17h3m4 0h9" />
      <circle cx="13" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  "chevron-left": <path d="m14 6-6 6 6 6" />,
  pointer: <path d="m5 3 14 10-7 1-3 7z" />,
  recenter: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v5m0 10v5M2 12h5m10 0h5" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10" />
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
  expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
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

const styles = stylex.create({
  avatar: { display: "block", flexShrink: 0, imageRendering: "pixelated" },
  icon: { flexShrink: 0, display: "block" },
});
