// Shared SF-Symbols-flavoured glyph set for the IT Ops Module, ported from the
// redesign mockup (itops-icons.jsx). Most glyphs stay self-contained inline SVG
// so dense status/transport/trigger iconography remains pixel-matched; topology
// entity icons use the product's default line-icon set.

import type { ReactNode } from "react";
import {
  Box,
  Buildings2,
  Cabinet,
  Grid2x2,
  Rows3,
  ServerSquare,
  type IconComponent,
  type IconWeight,
} from "../../lib/reicon";

export type ItIconName =
  | "ops"
  | "site"
  | "group"
  | "network"
  | "room"
  | "rack"
  | "run"
  | "auto"
  | "server"
  | "ssh"
  | "windows"
  | "psexec"
  | "globe"
  | "database"
  | "check"
  | "alert"
  | "xmark"
  | "clock"
  | "pending"
  | "spinner"
  | "plus"
  | "minus"
  | "chevR"
  | "chevL"
  | "chevD"
  | "rotateL"
  | "rotateR"
  | "center"
  | "stop"
  | "rerun"
  | "bot"
  | "filter"
  | "search"
  | "dots"
  | "trash"
  | "edit"
  | "grip"
  | "gauge"
  | "calendar"
  | "regex"
  | "webhook"
  | "mail"
  | "bell"
  | "popup"
  | "code"
  | "book"
  | "download"
  | "share"
  | "table"
  | "link"
  | "pulse"
  | "arrow"
  | "history"
  | "image"
  | "power"
  | "rows"
  | "grid"
  | "cube"
  | "lock";

type GlyphProps = { size: number; sw: number };

function LineIconGlyph(Icon: IconComponent, { size, sw }: GlyphProps, weight?: IconWeight) {
  return <Icon size={size} strokeWidth={sw} weight={weight} />;
}

export function ItOpsModuleIcon({ size = 16, sw }: { size?: number; sw?: number }) {
  return <ServerSquare size={size} strokeWidth={sw ?? 1.7} weight="Filled" />;
}

function Svg({
  size,
  sw,
  fill = "none",
  children,
}: GlyphProps & { fill?: string; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const GLYPHS: Record<ItIconName, (p: GlyphProps) => ReactNode> = {
  site: (p) => LineIconGlyph(Buildings2, p),
  ops: (p) => <ItOpsModuleIcon size={p.size} sw={p.sw} />,
  group: (p) => (
    <Svg {...p}>
      <path d="M7 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path d="M17 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path d="M2.5 19v-1a3.5 3.5 0 0 1 3.5-3.5h2A3.5 3.5 0 0 1 11.5 18v1" />
      <path d="M12.5 19v-1A3.5 3.5 0 0 1 16 14.5h2a3.5 3.5 0 0 1 3.5 3.5v1" />
    </Svg>
  ),
  lock: (p) => (
    <Svg {...p}>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Svg>
  ),
  network: (p) => (
    <Svg {...p} sw={1.6}>
      <circle cx="12" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="19" r="2" />
      <path d="M12 7v4" />
      <path d="M12 11l-5 6" />
      <path d="M12 11l5 6" />
    </Svg>
  ),
  room: (p) => LineIconGlyph(ServerSquare, p, "Filled"),
  rack: (p) => LineIconGlyph(Cabinet, p),
  rows: (p) => LineIconGlyph(Rows3, p),
  grid: (p) => LineIconGlyph(Grid2x2, p),
  cube: (p) => LineIconGlyph(Box, p),
  center: (p) => (
    <Svg {...p} sw={1.6}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </Svg>
  ),
  run: (p) => (
    <Svg {...p} sw={1.8}>
      <path d="M8 5.5l10 6.5-10 6.5z" />
    </Svg>
  ),
  auto: (p) => (
    <Svg {...p} sw={1.7}>
      <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12l1-8z" />
    </Svg>
  ),
  server: (p) => (
    <Svg {...p} sw={1.6}>
      <path d="M4 4.5h16a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" />
      <path d="M4 14h16a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V15a1 1 0 0 1 1-1Z" />
      <path d="M6.5 7.2h0" />
      <path d="M6.5 16.7h0" />
    </Svg>
  ),
  ssh: (p) => (
    <Svg {...p} sw={1.6}>
      <circle cx="8" cy="12" r="3.5" />
      <path d="M11.3 11h9.2" />
      <path d="M17.5 11v3" />
      <path d="M20.5 11v2.2" />
    </Svg>
  ),
  windows: (p) => (
    <Svg {...p} sw={0} fill="currentColor">
      <path d="M3.5 5.4 11 4.3v7H3.5zM12.4 4.1 20.5 3v8.3h-8.1zM3.5 12.6H11v7L3.5 18.5zM12.4 12.6h8.1V21l-8.1-1.2z" />
    </Svg>
  ),
  psexec: (p) => (
    <Svg {...p} sw={1.6}>
      <path d="M4 5.5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z" />
      <path d="M7 9.5l3 2.5-3 2.5" />
      <path d="M12.5 14.5h4" />
    </Svg>
  ),
  globe: (p) => (
    <Svg {...p} sw={1.5}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.5 2.5 2.5 14.5 0 17" />
      <path d="M12 3.5c-2.5 2.5-2.5 14.5 0 17" />
    </Svg>
  ),
  database: (p) => (
    <Svg {...p} sw={1.6}>
      <ellipse cx="12" cy="6" rx="7.5" ry="3" />
      <path d="M4.5 6v12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V6" />
      <path d="M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3" />
    </Svg>
  ),
  check: (p) => (
    <Svg {...p} sw={2.2}>
      <path d="M5 12.5l4.5 4.5L19 6.5" />
    </Svg>
  ),
  alert: (p) => (
    <Svg {...p} sw={2}>
      <path d="M12 7.5v5.5" />
      <path d="M12 16.6h0" />
      <circle cx="12" cy="12" r="9" strokeWidth={1.7} />
    </Svg>
  ),
  xmark: (p) => (
    <Svg {...p} sw={2.1}>
      <path d="M6.5 6.5l11 11" />
      <path d="M17.5 6.5l-11 11" />
    </Svg>
  ),
  clock: (p) => (
    <Svg {...p} sw={1.7}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  ),
  pending: (p) => (
    <Svg {...p} sw={1.7}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12h0" />
      <path d="M12 12h0" />
      <path d="M16 12h0" />
    </Svg>
  ),
  spinner: (p) => (
    <Svg {...p} sw={2}>
      <path d="M12 3.5v3.5" />
      <path d="M12 17v3.5" />
      <path d="M20.5 12H17" />
      <path d="M7 12H3.5" />
      <path d="M18 6l-2.5 2.5" />
      <path d="M8.5 15.5 6 18" />
      <path d="M18 18l-2.5-2.5" />
      <path d="M8.5 8.5 6 6" />
    </Svg>
  ),
  plus: (p) => (
    <Svg {...p} sw={2}>
      <path d="M12 5.5v13" />
      <path d="M5.5 12h13" />
    </Svg>
  ),
  minus: (p) => (
    <Svg {...p} sw={2}>
      <path d="M5.5 12h13" />
    </Svg>
  ),
  chevR: (p) => (
    <Svg {...p} sw={2}>
      <path d="M9.5 6l6 6-6 6" />
    </Svg>
  ),
  chevL: (p) => (
    <Svg {...p} sw={2}>
      <path d="M14.5 6l-6 6 6 6" />
    </Svg>
  ),
  chevD: (p) => (
    <Svg {...p} sw={2}>
      <path d="M6 9.5l6 6 6-6" />
    </Svg>
  ),
  rotateL: (p) => (
    <Svg {...p} sw={1.7}>
      <path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.5" />
      <path d="M4 4v4.5h4.5" />
    </Svg>
  ),
  rotateR: (p) => (
    <Svg {...p} sw={1.7}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5" />
      <path d="M20 4v4.5h-4.5" />
    </Svg>
  ),
  stop: (p) => (
    <Svg {...p} sw={1.7}>
      <path d="M7 7h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" />
    </Svg>
  ),
  rerun: (p) => (
    <Svg {...p} sw={1.7}>
      <path d="M20 11a8 8 0 0 0-14-4.5L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14 4.5l2-1.5" />
      <path d="M20 20v-4h-4" />
    </Svg>
  ),
  bot: (p) => (
    <Svg {...p} sw={1.6}>
      <path d="M12 3.5v2.5" />
      <path d="M7 6.5h10a2 2 0 0 1 2 2V16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z" />
      <path d="M9.5 11v1.5" />
      <path d="M14.5 11v1.5" />
      <path d="M3 11v3" />
      <path d="M21 11v3" />
    </Svg>
  ),
  filter: (p) => (
    <Svg {...p} sw={1.7}>
      <path d="M4 5.5h16l-6 7v5l-4 2v-7l-6-7z" />
    </Svg>
  ),
  search: (p) => (
    <Svg {...p} sw={1.7}>
      <path d="M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z" />
      <path d="M20 20l-4.3-4.3" />
    </Svg>
  ),
  dots: (p) => (
    <Svg {...p} sw={2}>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  ),
  trash: (p) => (
    <Svg {...p} sw={1.6}>
      <path d="M5 6.5h14" />
      <path d="M9 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v1.5" />
      <path d="M6.5 6.5l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
    </Svg>
  ),
  edit: (p) => (
    <Svg {...p} sw={1.6}>
      <path d="M16 4.5l3.5 3.5L9 18.5l-4 1 1-4L16 4.5z" />
    </Svg>
  ),
  grip: (p) => (
    <Svg {...p} sw={2}>
      <circle cx="9" cy="7" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17" r="1.1" fill="currentColor" stroke="none" />
    </Svg>
  ),
  gauge: (p) => (
    <Svg {...p} sw={1.6}>
      <path d="M4 16a8 8 0 1 1 16 0" />
      <path d="M12 16l4-4" />
      <circle cx="12" cy="16" r="1.3" fill="currentColor" stroke="none" />
    </Svg>
  ),
  calendar: (p) => (
    <Svg {...p} sw={1.6}>
      <path d="M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" />
      <path d="M4 10h16" />
      <path d="M8 3.5v4" />
      <path d="M16 3.5v4" />
    </Svg>
  ),
  regex: (p) => (
    <Svg {...p} sw={1.6}>
      <path d="M14 5v8" />
      <path d="M10.5 7l7 4" />
      <path d="M17.5 7l-7 4" />
      <circle cx="7" cy="17" r="1.6" fill="currentColor" stroke="none" />
    </Svg>
  ),
  webhook: (p) => (
    <Svg {...p} sw={1.6}>
      <path d="M9 9a3 3 0 1 1 4.2 2.7L16 16" />
      <path d="M16 16a3 3 0 1 1-2.8 2H8.5" />
      <path d="M9 11.7 6.6 16A3 3 0 1 0 9 18" />
    </Svg>
  ),
  mail: (p) => (
    <Svg {...p} sw={1.6}>
      <path d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </Svg>
  ),
  bell: (p) => (
    <Svg {...p} sw={1.6}>
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9Z" />
      <path d="M10 19.5a2 2 0 0 0 4 0" />
    </Svg>
  ),
  popup: (p) => (
    <Svg {...p} sw={1.6}>
      <path d="M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 3v-3H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
    </Svg>
  ),
  code: (p) => (
    <Svg {...p} sw={1.7}>
      <path d="M9 8l-4 4 4 4" />
      <path d="M15 8l4 4-4 4" />
    </Svg>
  ),
  book: (p) => (
    <Svg {...p} sw={1.6}>
      <path d="M5 4.5h11a2 2 0 0 1 2 2V20a2 2 0 0 0-2-2H5z" />
      <path d="M19 6.5V18" />
    </Svg>
  ),
  download: (p) => (
    <Svg {...p} sw={1.7}>
      <path d="M12 4.5v9" />
      <path d="M8 10l4 4 4-4" />
      <path d="M5 19.5h14" />
    </Svg>
  ),
  share: (p) => (
    <Svg {...p} sw={1.7}>
      <path d="M12 15.5v-11" />
      <path d="M8 8.5l4-4 4 4" />
      <path d="M6 11.5v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7" />
    </Svg>
  ),
  table: (p) => (
    <Svg {...p} sw={1.5}>
      <path d="M4.5 5.5h15v13h-15z" />
      <path d="M4.5 10h15" />
      <path d="M9.5 5.5v13" />
      <path d="M14.5 5.5v13" />
    </Svg>
  ),
  link: (p) => (
    <Svg {...p} sw={1.6}>
      <path d="M10 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5L11 7.5" />
      <path d="M14 10.5a3.5 3.5 0 0 0-5 0L6.5 13a3.5 3.5 0 0 0 5 5L13 16.5" />
    </Svg>
  ),
  pulse: (p) => (
    <Svg {...p} sw={1.7}>
      <path d="M3 12h4l2.5-6 4 13 2.5-7H21" />
    </Svg>
  ),
  arrow: (p) => (
    <Svg {...p} sw={1.9}>
      <path d="M5 12h13" />
      <path d="M12.5 6.5 18 12l-5.5 5.5" />
    </Svg>
  ),
  history: (p) => (
    <Svg {...p} sw={1.6}>
      <path d="M3.5 9A8 8 0 1 1 4 13.5" />
      <path d="M3.5 4.5v4.5H8" />
      <path d="M12 8v4l3 2" />
    </Svg>
  ),
  power: (p) => (
    <Svg {...p} sw={1.7}>
      <path d="M12 3.5v8" />
      <path d="M6.8 7A8 8 0 1 0 17.2 7" />
    </Svg>
  ),
  image: (p) => (
    <Svg {...p} sw={1.6}>
      <path d="M5 4.5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" />
      <circle cx="9" cy="9.5" r="1.6" />
      <path d="M4.5 16.5l4.5-4 3.5 3 3-2.5 4 3.5" />
    </Svg>
  ),
};

export function ItIcon({
  name,
  size = 16,
  sw,
}: {
  name: ItIconName;
  size?: number;
  sw?: number;
}) {
  const glyph = GLYPHS[name] ?? GLYPHS.server;
  return glyph({ size, sw: sw ?? 1.7 });
}

// Site-status accent palette for tiles and action chips. These are content
// accents (a site's chosen colour, an action's category hue), not theme
// chrome, so they live here as fixed values rather than scheme tokens.
export const IT_ACCENTS = {
  blue: "#0a84ff",
  green: "#34c759",
  teal: "#30b0c7",
  indigo: "#5e5ce6",
  purple: "#bf5af2",
  orange: "#ff9500",
  pink: "#ff375f",
  red: "#ff3b30",
  graphite: "#5b6066",
  steel: "#7d8791",
} as const;
