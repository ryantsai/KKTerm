// Shared pieces for the two spatial Server Room layouts (floor plan + 2.5D):
// the per-rack status tag chips that replaced the old health/utilisation/power
// metric toggle, the room-object glyph set, and the edit-mode object picker
// column used to arm placement of a rack or non-rack fixture (roomObjects.ts).

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { isImeComposingEvent, isImeEditableTarget } from "../../lib/ime";
import type { Rack } from "../../types";
import { rackFloorMetrics } from "./roomFloorPlan";
import type { Facing } from "./roomIsoLayout";
import { ROOM_OBJECT_KINDS, type RoomObjectKind } from "./roomObjects";
import { ROOM_ZOOM_LEVELS, sanitizeRoomZoom } from "./siteTreeState";
import { RoomObjectPlanArtwork } from "./RoomObjectArtwork";
import { RoomObjectIsoArtwork } from "./RoomObjectIsoReference";
import {
  centerRoomViewport,
  preserveRoomPan,
  type RoomViewportSize,
} from "./roomViewport";
import { IT_ACCENTS, ItIcon } from "./icons";

/** Accent colour per object kind (乖乖 is green — it has a job to do). Fed to
 *  CSS as the `--obj`/`--tile` custom properties, mirroring TILE_COLORS. */
export const OBJECT_ACCENTS: Record<RoomObjectKind, string> = {
  camera: IT_ACCENTS.indigo,
  aircon: IT_ACCENTS.teal,
  fireExtinguisher: IT_ACCENTS.red,
  ups: IT_ACCENTS.purple,
  sensor: IT_ACCENTS.blue,
  smokeDetector: IT_ACCENTS.graphite,
  crashCart: IT_ACCENTS.pink,
  wall: IT_ACCENTS.steel,
  kuaikuai: IT_ACCENTS.green,
};

// ── Armed placement cursor ──

export interface RoomPlacementPointer {
  x: number;
  y: number;
}

/** High-contrast direction marker drawn over a snapped placement ghost. */
export function RoomPlacementFacingArrow({
  facing,
  liftPx,
}: {
  facing: Facing;
  /** 2.5D height above the floor plane; omitted in the top-down plan. */
  liftPx?: number;
}) {
  const positions = [
    { x: "50%", y: "calc(100% + 15px)" },
    { x: "-15px", y: "50%" },
    { x: "50%", y: "-15px" },
    { x: "calc(100% + 15px)", y: "50%" },
  ] as const;
  const position = positions[facing];
  return (
    <span
      aria-hidden="true"
      className="rm-placement-facing-arrow"
      style={
        {
          "--placement-facing-angle": `${facing * 90}deg`,
          "--placement-facing-x": position.x,
          "--placement-facing-y": position.y,
          ...(liftPx == null ? {} : { "--placement-facing-lift": `${liftPx}px` }),
        } as CSSProperties
      }
    />
  );
}

/** Match Rack View's armed-placement contract: keep tracking outside the room
 *  canvas, cancel from anywhere with right-click/Escape or when another app
 *  control is selected, and let each view replace the floating preview with
 *  its snapped in-canvas ghost. */
export function useRoomPlacementPointer(
  active: boolean,
  onCancel?: () => void,
  placementViewport?: RefObject<HTMLElement | null>,
): RoomPlacementPointer | null {
  const [pointer, setPointer] = useState<RoomPlacementPointer | null>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    if (!active) {
      setPointer(null);
      return;
    }

    const updatePointer = (event: PointerEvent) => {
      setPointer({ x: event.clientX, y: event.clientY });
    };
    const cancelFromContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      cancelRef.current?.();
    };
    const cancelFromKeyboard = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        (isImeEditableTarget(event.target) && isImeComposingEvent(event))
      ) return;
      event.preventDefault();
      cancelRef.current?.();
    };
    const cancelFromOtherUi = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const insideViewport = placementViewport?.current?.contains(target);
      const placementControl =
        target instanceof Element && target.closest(".rm-bp-ctl, .rm-iso-ctl");
      if (insideViewport && !placementControl) return;
      cancelRef.current?.();
    };

    document.addEventListener("pointermove", updatePointer, true);
    document.addEventListener("pointerdown", cancelFromOtherUi, true);
    document.addEventListener("contextmenu", cancelFromContextMenu, true);
    document.addEventListener("keydown", cancelFromKeyboard, true);
    return () => {
      document.removeEventListener("pointermove", updatePointer, true);
      document.removeEventListener("pointerdown", cancelFromOtherUi, true);
      document.removeEventListener("contextmenu", cancelFromContextMenu, true);
      document.removeEventListener("keydown", cancelFromKeyboard, true);
    };
  }, [active, placementViewport]);

  return pointer;
}

/** Floating preview shown while an armed fixture is between the picker and a
 *  valid floor target. Inside the room, the richer snapped preview takes over. */
export function RoomPlacementCursorGhost({
  pointer,
  tool,
  rackArmed,
  variant,
  snapped,
}: {
  pointer: RoomPlacementPointer | null;
  tool: RoomTool;
  rackArmed: boolean;
  variant: "floor" | "iso";
  snapped: boolean;
}) {
  if (!pointer || snapped || (!tool && !rackArmed)) return null;
  return createPortal(
    <div
      className={`itops-page rm-cursor-ghost ${variant}`}
      aria-hidden="true"
      style={{
        left: pointer.x,
        top: pointer.y,
        ...(tool ? { "--obj": OBJECT_ACCENTS[tool] } : {}),
      } as CSSProperties}
    >
      {rackArmed ? (
        <span className="rm-cursor-ghost-rack">
          <ItIcon name="rack" size={32} sw={1.3} />
        </span>
      ) : tool ? (
        variant === "iso" ? <RoomObjectIsoArtwork kind={tool} /> : <RoomObjectPlanArtwork kind={tool} />
      ) : null}
    </div>,
    document.body,
  );
}

// ── Viewport-filling grids ──

/** Content-box size of the scroll viewport hosting a room view, so the floor
 *  grid can grow to cover the whole visible area. Null until the first
 *  measure (and in DOM-less tests), which renders the layout's natural
 *  minimum. */
export function useRoomViewportSize(): [
  RefObject<HTMLDivElement | null>,
  { w: number; h: number } | null,
] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      // Slightly conservative: grids size themselves to exactly this box, and
      // exact-fit content can pin a transient scrollbar forever (each bar
      // justifies the other). A 2px allowance lets scrollbars always retract.
      const w = Math.max(0, node.clientWidth - 2);
      const h = Math.max(0, node.clientHeight - 2);
      setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

/** Step the zoom on wheel over the room's scroll viewport (drag pans, so the
 *  wheel is free to zoom; Ctrl+wheel — the browser page-zoom gesture — steps
 *  the same way). A native non-passive listener because React registers
 *  `onWheel` passively, which cannot preventDefault. */
export function useWheelZoom(
  ref: RefObject<HTMLDivElement | null>,
  onStep: (dir: 1 | -1) => void,
): void {
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      stepRef.current(event.deltaY < 0 ? 1 : -1);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [ref]);
}

/** Pan the room by scrolling its viewport: hold the left button on the floor
 *  (presses on racks, objects, or controls keep their own click/drag
 *  behaviour), middle-mouse drag from anywhere (preventDefault suppresses the
 *  browser's autoscroll gadget), and arrow keys. A left pan only engages past
 *  a small threshold so floor clicks (object placement) still land, and a
 *  completed pan swallows the follow-up click. The scroll element carries
 *  tabIndex 0, so clicking anywhere in the room — floor or a rack button
 *  inside it — puts focus where the keydown listener hears it. */
export function useRoomPan(
  ref: RefObject<HTMLDivElement | null>,
  centerOffset: { left: number; top: number },
  viewportSize: RoomViewportSize | null = null,
): void {
  const centerLeft = centerOffset.left;
  const centerTop = centerOffset.top;
  const viewportWidth = viewportSize?.w ?? null;
  const viewportHeight = viewportSize?.h ?? null;
  const previousCenterRef = useRef<{ left: number; top: number } | null>(null);
  const previousViewportRef = useRef<RoomViewportSize | null | undefined>(undefined);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previous = previousCenterRef.current;
    const previousViewport = previousViewportRef.current;
    const viewportChanged =
      previousViewport !== undefined &&
      ((previousViewport === null) !== (viewportSize === null) ||
        (previousViewport !== null &&
          viewportSize !== null &&
          (previousViewport.w !== viewportSize.w || previousViewport.h !== viewportSize.h)));
    if (previous && !viewportChanged) {
      // Preserve the user's pan relative to the centered camera when the
      // fitted scene changes size without changing the visible viewport.
      const nextScroll = preserveRoomPan(
        { left: node.scrollLeft, top: node.scrollTop },
        previous,
        { left: centerLeft, top: centerTop },
      );
      node.scrollLeft = nextScroll.left;
      node.scrollTop = nextScroll.top;
    } else {
      // The browser can shift scrollLeft/scrollTop while a flex pane changes
      // size. Re-center on measured viewport changes so that automatic layout
      // movement is never mistaken for a user pan.
      centerRoomViewport(ref);
    }
    // The first center operation may be clamped by the browser before the
    // measured viewport exists. Use the resulting position as the baseline so
    // the next measurement can recover the intended center without treating
    // the initial layout error as user panning.
    previousCenterRef.current = previous && !viewportChanged
      ? { left: centerLeft, top: centerTop }
      : { left: node.scrollLeft, top: node.scrollTop };
    previousViewportRef.current = viewportSize;
  }, [ref, centerLeft, centerTop, viewportSize, viewportWidth, viewportHeight]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let pointerId: number | null = null;
    let panning = false;
    let button = 1;
    let lastX = 0;
    let lastY = 0;
    const canPan = () =>
      node.scrollWidth > node.clientWidth + 1 ||
      node.scrollHeight > node.clientHeight + 1;
    const engage = (event: PointerEvent) => {
      panning = true;
      node.style.cursor = "grabbing";
      node.focus({ preventScroll: true });
      try {
        node.setPointerCapture(event.pointerId);
      } catch {
        // Keep panning uncaptured if the pointer is already gone.
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 0) {
        if (!canPan()) return;
        // Elements with their own left-button press behaviour opt out.
        const target = event.target as HTMLElement;
        if (
          target.closest(
            ".rm-bp-rack, .rm-bp-obj, .rm-bp-ctl, .rm-iso-cab, .rm-iso-obj, .rm-iso-ctl",
          )
        ) {
          return;
        }
      } else if (event.button !== 1) {
        return;
      }
      pointerId = event.pointerId;
      button = event.button;
      lastX = event.clientX;
      lastY = event.clientY;
      panning = false;
      if (event.button === 1) {
        event.preventDefault();
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      if (!panning) {
        if (Math.abs(event.clientX - lastX) < 4 && Math.abs(event.clientY - lastY) < 4) return;
        engage(event);
      }
      node.scrollLeft -= event.clientX - lastX;
      node.scrollTop -= event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const squelchClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const endPan = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      if (button === 1 && !panning) {
        centerRoomViewport(ref);
      }
      if (panning && button === 0) {
        // The pan's pointerup still produces a click on whatever is under the
        // cursor; capture-phase, one-shot: swallow it before placement/select
        // handlers fire (the timeout clears the trap when no click follows).
        node.addEventListener("click", squelchClick, { capture: true, once: true });
        window.setTimeout(
          () => node.removeEventListener("click", squelchClick, { capture: true }),
          0,
        );
      }
      pointerId = null;
      panning = false;
      node.style.cursor = "";
    };
    const PAN_STEP = 64;
    const KEY_DELTAS: Record<string, [number, number]> = {
      ArrowLeft: [-PAN_STEP, 0],
      ArrowRight: [PAN_STEP, 0],
      ArrowUp: [0, -PAN_STEP],
      ArrowDown: [0, PAN_STEP],
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const delta = KEY_DELTAS[event.key];
      if (!delta || !canPan() || event.ctrlKey || event.altKey || event.metaKey) return;
      event.preventDefault();
      node.scrollBy({ left: delta[0], top: delta[1] });
    };
    node.addEventListener("pointerdown", onPointerDown);
    node.addEventListener("pointermove", onPointerMove);
    node.addEventListener("pointerup", endPan);
    node.addEventListener("pointercancel", endPan);
    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", endPan);
      node.removeEventListener("pointercancel", endPan);
      node.removeEventListener("keydown", onKeyDown);
    };
  }, [ref]);
}

// ── Zoom ruler ──

/** Vertical ruler floating over the room's top-right corner: one clickable
 *  tick per fixed zoom level (largest on top), with the active tick tracking
 *  wheel-zoom steps. Levels persist per view via siteTreeState.loadRoomZoom /
 *  saveRoomZoom, so a view reopens at its last zoom. */
export function RoomZoomRuler({
  zoom,
  onZoomChange,
  onResetCenter,
}: {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onResetCenter: () => void;
}) {
  const { t } = useTranslation();
  const level = sanitizeRoomZoom(zoom);
  return (
    <div className="rm-zoomruler" role="group" aria-label={t("itops.floorPlan.zoomLabel")}>
      {[...ROOM_ZOOM_LEVELS].reverse().map((value) => {
        const percent = Math.round(value * 100);
        return (
          <button
            key={value}
            type="button"
            className="rm-zoomruler-tick"
            data-active={value === level}
            title={t("itops.floorPlan.zoomSet", { percent })}
            aria-label={t("itops.floorPlan.zoomSet", { percent })}
            aria-pressed={value === level}
            onClick={() => onZoomChange(value)}
          >
            <i />
            <span>{percent}%</span>
          </button>
        );
      })}
      <button
        type="button"
        className="rm-zoomruler-reset"
        title={t("common.reset")}
        aria-label={t("common.reset")}
        onClick={onResetCenter}
      >
        <ItIcon name="center" size={14} sw={1.6} />
      </button>
    </div>
  );
}

// ── Rack status tags ──

/** Compact always-visible tags on a rack footprint: device count and power
 *  draw (only when any device declares one). Rack-unit figures stay off the
 *  view — they live in the hover detail card (RackTipContent). */
export function RackTagChips({ rack }: { rack: Rack }) {
  const { t } = useTranslation();
  const m = rackFloorMetrics(rack);
  return (
    <span className="rm-tags">
      <span
        className="rm-tag rm-tag-count"
        title={t("itops.racks.deviceCount", { count: m.deviceCount })}
      >
        <i />
        {m.deviceCount}
      </span>
      {m.powerW > 0 ? (
        <span
          className="rm-tag"
          title={
            m.powerCapacityW != null
              ? t("itops.floorPlan.powerValue", { used: m.powerW, capacity: m.powerCapacityW })
              : t("itops.floorPlan.powerDrawOnly", { watts: m.powerW })
          }
        >
          {m.powerW}W
        </span>
      ) : null}
    </span>
  );
}

/** Inner content of the hover detail card shared by the floor plan and the
 *  2.5D room: name, health · utilisation (· power), used/total rack units ·
 *  device count, and status tallies. */
export function RackTipContent({ rack }: { rack: Rack }) {
  const { t } = useTranslation();
  const m = rackFloorMetrics(rack);
  const health = t(`itops.floorPlan.health.${m.health}`);
  return (
    <>
      <span className="rm-tip-name">{rack.name}</span>
      <span className="rm-tip-detail">
        {health} · {t("itops.floorPlan.utilizationValue", { percent: Math.round(m.utilization * 100) })}
        {m.powerW > 0
          ? ` · ${
              m.powerCapacityW != null
                ? t("itops.floorPlan.powerValue", { used: m.powerW, capacity: m.powerCapacityW })
                : t("itops.floorPlan.powerDrawOnly", { watts: m.powerW })
            }`
          : ""}
      </span>
      <span className="rm-tip-cap">
        {t("itops.racks.unitCount", { count: m.usedU })} /{" "}
        {t("itops.racks.unitCount", { count: m.capacityU })} ·{" "}
        {t("itops.racks.deviceCount", { count: m.deviceCount })}
      </span>
      {m.deviceCount > 0 ? (
        <span className="rm-tile-dots">
          <span className="rm-dot on">
            <i />
            {m.online}
          </span>
          {m.warning > 0 ? (
            <span className="rm-dot warn">
              <i />
              {m.warning}
            </span>
          ) : null}
          {m.offline > 0 ? (
            <span className="rm-dot off">
              <i />
              {m.offline}
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );
}

export interface RoomRackHoverPoint {
  x: number;
  y: number;
}

interface RoomRackHoverSize {
  width: number;
  height: number;
}

interface RoomRackHoverBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface RoomRackHoverPosition {
  left: number;
  top: number;
}

/** Place a pointer-anchored card inside the visible room rectangle. Prefer
 *  above/right of the pointer, flip at the matching edge, then clamp as a
 *  final guard for corners and narrow viewports. */
export function placeRoomRackHoverCard(
  pointer: RoomRackHoverPoint,
  card: RoomRackHoverSize,
  boundary: RoomRackHoverBounds,
): RoomRackHoverPosition {
  const margin = 8;
  const gap = 12;
  const minLeft = boundary.left + margin;
  const minTop = boundary.top + margin;
  const maxLeft = Math.max(minLeft, boundary.right - margin - card.width);
  const maxTop = Math.max(minTop, boundary.bottom - margin - card.height);
  let left = pointer.x + gap;
  let top = pointer.y - gap - card.height;
  if (left > maxLeft) left = pointer.x - gap - card.width;
  if (top < minTop) top = pointer.y + gap;
  return {
    left: Math.min(maxLeft, Math.max(minLeft, left)),
    top: Math.min(maxTop, Math.max(minTop, top)),
  };
}

/** Viewport-aware Rack detail card shared by both spatial layouts. It portals
 *  to the app window so neither scroll overflow nor the 2.5D floor clip can
 *  cut it off, while its geometry remains constrained to the room viewport. */
export function RoomRackHoverCard({
  rack,
  pointer,
  boundaryRef,
}: {
  rack: Rack | null;
  pointer: RoomRackHoverPoint | null;
  boundaryRef: RefObject<HTMLElement | null>;
}) {
  const cardRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const card = cardRef.current;
    const boundaryNode = boundaryRef.current;
    if (!rack || !pointer || !card || !boundaryNode) {
      setPosition(null);
      return;
    }
    const measure = () => {
      const cardRect = card.getBoundingClientRect();
      const rawBoundary = boundaryNode.getBoundingClientRect();
      const boundary = {
        left: Math.max(0, rawBoundary.left),
        top: Math.max(0, rawBoundary.top),
        right: Math.min(window.innerWidth, rawBoundary.right),
        bottom: Math.min(window.innerHeight, rawBoundary.bottom),
      };
      setPosition(
        placeRoomRackHoverCard(
          pointer,
          { width: cardRect.width, height: cardRect.height },
          boundary,
        ),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    boundaryNode.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(boundaryNode);
    observer?.observe(card);
    return () => {
      window.removeEventListener("resize", measure);
      boundaryNode.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [boundaryRef, pointer, rack]);

  if (typeof document === "undefined" || !rack || !pointer) return null;
  return createPortal(
    <div className="itops-page rm-rack-hover-portal">
      <span
        ref={cardRef}
        className="rm-rack-hover-card"
        role="tooltip"
        style={{
          left: position?.left ?? 0,
          top: position?.top ?? 0,
          visibility: position ? "visible" : "hidden",
        }}
      >
        <RackTipContent rack={rack} />
      </span>
    </div>,
    document.body,
  );
}

// ── Room-object glyphs ──

function Svg({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const OBJECT_GLYPHS: Record<RoomObjectKind, (size: number) => ReactNode> = {
  camera: (size) => (
    <Svg size={size}>
      <rect x="3" y="6" width="12" height="8" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M15 9l6-2v6l-6-2" />
      <path d="M7 14v4h5" />
    </Svg>
  ),
  aircon: (size) => (
    <Svg size={size}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" />
      <path d="M12 4v2M12 18v2M4 12h2M18 12h2" />
    </Svg>
  ),
  fireExtinguisher: (size) => (
    <Svg size={size}>
      <path d="M9 8a3 3 0 0 1 6 0v11a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 19V8Z" />
      <path d="M12 5V3.5" />
      <path d="M10 3.5h4" />
      <path d="M9 6.5 5.5 5v3" />
    </Svg>
  ),
  ups: (size) => (
    <Svg size={size}>
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="M12 8l-2.5 4.5H12L11 17l3.5-5.5H12L13 8Z" />
    </Svg>
  ),
  sensor: (size) => (
    <Svg size={size}>
      <circle cx="12" cy="14" r="3" />
      <path d="M12 11V4" />
      <path d="M7.5 8.5a7 7 0 0 1 9 0" />
      <path d="M5.5 5.8a10 10 0 0 1 13 0" />
    </Svg>
  ),
  smokeDetector: (size) => (
    <Svg size={size}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 4.5v2M12 17.5v2M4.5 12h2M17.5 12h2" />
    </Svg>
  ),
  crashCart: (size) => (
    <Svg size={size}>
      <rect x="5" y="5" width="13" height="12" rx="1.5" />
      <path d="M5 9h13M5 13h13" />
      <circle cx="8.5" cy="19.5" r="1.5" />
      <circle cx="15.5" cy="19.5" r="1.5" />
      <path d="M18 5h2.5" />
    </Svg>
  ),
  wall: (size) => (
    <Svg size={size}>
      <rect x="3" y="6" width="18" height="12" rx="1" />
      <path d="M3 12h18" />
      <path d="M12 6v6M8 12v6M16 12v6" />
    </Svg>
  ),
  kuaikuai: (size) => (
    <Svg size={size}>
      <path d="M8 4h8l1 2-1 1.5v11a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 8 18.5V7.5L7 6l1-2Z" />
      <path d="M8 7.5h8" />
      <path d="m12 11 .9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2-1.45-1.4 2-.3L12 11Z" />
    </Svg>
  ),
};

export function ObjectGlyph({ kind, size = 14 }: { kind: RoomObjectKind; size?: number }) {
  return <>{OBJECT_GLYPHS[kind](size)}</>;
}

// ── Edit-mode object picker ──

/** The armed placement tool: null = move/select, or the object kind whose next
 *  two clicks choose position and facing. */
export type RoomTool = RoomObjectKind | null;

/** Full-height right-side picker column shown while editing a spatial room
 *  view: a search box over a grid of preview cards — Racks first, then every
 *  room-object kind. Clicking a card arms it; the first floor click locks its
 *  position and the second confirms its facing. Racks have properties, so the
 *  Rack card opens the New Rack dialog before the same two-click flow. */
export function RoomObjectPicker({
  tool,
  onToolChange,
  rackArmed,
  onPickRack,
}: {
  tool: RoomTool;
  onToolChange: (tool: RoomTool) => void;
  /** A just-created rack is awaiting its placement click. */
  rackArmed: boolean;
  onPickRack: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const rackLabel = t("itops.floorPlan.pickerRack");
  const kinds = ROOM_OBJECT_KINDS.filter(
    (kind) => !q || t(`itops.floorPlan.object.${kind}`).toLowerCase().includes(q),
  );
  return (
    <div className="rm-picker" role="group" aria-label={t("itops.floorPlan.pickerTitle")}>
      <div className="rm-picker-h">{t("itops.floorPlan.pickerTitle")}</div>
      <div className="rm-picker-search">
        <ItIcon name="search" size={13} />
        <input
          type="text"
          value={query}
          placeholder={t("itops.floorPlan.pickerSearchPlaceholder")}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {query ? (
          <button type="button" className="rm-picker-search-x" onClick={() => setQuery("")}>
            <ItIcon name="xmark" size={12} />
          </button>
        ) : null}
      </div>
      <div className="rm-picker-grid">
        {!q || rackLabel.toLowerCase().includes(q) ? (
          <button
            type="button"
            className="rm-picker-card"
            data-active={rackArmed}
            title={rackLabel}
            aria-pressed={rackArmed}
            onClick={onPickRack}
          >
            <span className="rm-picker-thumb rack">
              <ItIcon name="rack" size={30} sw={1.3} />
            </span>
            <span className="rm-picker-name">{rackLabel}</span>
          </button>
        ) : null}
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            className="rm-picker-card"
            data-active={tool === kind}
            style={{ "--obj": OBJECT_ACCENTS[kind] } as CSSProperties}
            title={t(`itops.floorPlan.object.${kind}`)}
            aria-pressed={tool === kind}
            onClick={() => onToolChange(tool === kind ? null : kind)}
          >
            <span className="rm-picker-thumb">
              <RoomObjectPlanArtwork kind={kind} />
            </span>
            <span className="rm-picker-name">{t(`itops.floorPlan.object.${kind}`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
