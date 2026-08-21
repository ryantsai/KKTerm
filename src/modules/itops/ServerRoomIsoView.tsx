// 2.5D Server Room View (docs/SITE.md Server Room View). Draws the room as an
// axonometric floor grid sharing the floor plan's cell placement: every Rack
// is an extruded cabinet whose height tracks its U capacity and whose visible
// front face renders a miniature of the 2D rack skin — shell finish plus each
// placed device as a faceplate strip with a status LED. Cabinets span their
// full cell along the side axis, so racks in adjacent cells touch like a real
// rack row; the rack's stored facing decides which face carries the devices.
// The camera is fixed but the room can be viewed from four corners (the grid
// is rotated under the camera in quarter turns, see roomIsoLayout.ts). Room
// objects (roomObjects.ts) stand on the same grid at their vertical position:
// a CRAC on the floor, a camera near the ceiling, a 乖乖 pack on a cabinet
// top. Edit mode drags cabinets/objects across the floor, rotates facings,
// nudges object levels, adds racks on empty tiles, and places racks/objects
// armed by the shared picker column (owned by SitesTab). Placement persists
// through the shared "grid" store.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { showNativeContextMenu } from "../../lib/nativeContextMenu";
import { nativeMenuIcons } from "../../lib/nativeMenuIcons";
import type { Rack, RackItem, RackItemStatus } from "../../types";
import { rackFloorMetrics } from "./roomFloorPlan";
import { RoomObjectIsoArtwork } from "./RoomObjectIsoReference";
import { isRackTopItem, rackItemXSpan } from "./rackPlacement";
import {
  ISO_ROT_DEG,
  ISO_TILT_COS,
  ISO_TILT_DEG,
  cornerFromDisplayPoint,
  expandIsoFloorFrame,
  facingFromPoint,
  fitIsoRoomZoom,
  isoViewHeightForWidth,
  isoPlacementCells,
  moveIsoRack,
  rackDepthFrac,
  rackFootprint,
  rackTopCornerPoint,
  resolveIsoLayout,
  rotateCellForView,
  rotatePointForView,
  rotateRectForView,
  rotateFacingForView,
  sanitizeFacing,
  screenDeltaToPlane,
  viewDeltaToGrid,
  viewGridSize,
  type CellRect,
  type Corner,
  type Facing,
  type IsoCell,
  type IsoLayout,
  type IsoViewAngle,
} from "./roomIsoLayout";
import {
  ROOM_CEILING_U,
  footprintSpans,
  nudgeZ,
  objectCellSpan,
  objectFootprint,
  objectSurfaceAnchor,
  objectSpec,
  rackTopSupport,
  resolveDropZ,
  roomCellIsBlank,
  roomObjectPlacementIsBlank,
  wallArms,
  wallOccupiesCell,
  type RoomObject,
  type WallArms,
} from "./roomObjects";
import type { FreePlacementMap, IsoFloorColor, RackFacingMap } from "./siteTreeState";
import {
  loadIsoViewAngle,
  loadRoomZoom,
  saveIsoViewAngle,
  saveRoomZoom,
  stepRoomZoom,
} from "./siteTreeState";
import { ItIcon } from "./icons";
import { centerRoomViewport, roomPanFrame, roomScrollCenter } from "./roomViewport";
import {
  OBJECT_ACCENTS,
  RoomRackHoverCard,
  RoomPlacementFacingArrow,
  RoomPlacementCursorGhost,
  RoomZoomRuler,
  useRoomPan,
  useRoomPlacementPointer,
  useRoomViewportSize,
  useWheelZoom,
  type RoomTool,
} from "./roomViewParts";

// Floor tile size in plane px. Cabinets span the full CELL along their side
// axis (adjacent racks touch); the depth axis tracks each rack's physical
// depth (rackDepthFrac), front face flush on its facing borderline.
const CELL = 58;

// Vertical scale: one rack unit in plane px. Linear so stacking is exact —
// an object with z = rack heightU sits flush on the cabinet top.
const PX_PER_U = 2.1;

type BlackoutPhase = "idle" | "flash" | "dark" | "recovering";

interface BlackoutKuaikuaiMarker {
  key: string;
  x: number;
  bottom: number;
  facing: Facing;
  expired: boolean;
}

export const SERVER_ROOM_BLACKOUT_SEQUENCE = [
  "arrowup",
  "arrowup",
  "arrowdown",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowleft",
  "arrowright",
  "b",
  "a",
] as const;

export interface ServerRoomBlackoutKey {
  key: string;
  at: number;
}

export function trackServerRoomBlackoutKey(
  buffer: ServerRoomBlackoutKey[],
  key: string,
  at: number,
): { buffer: ServerRoomBlackoutKey[]; complete: boolean } {
  const recent = [...buffer, { key, at }]
    .filter((entry) => at - entry.at <= 3_000)
    .slice(-SERVER_ROOM_BLACKOUT_SEQUENCE.length);
  const complete =
    recent.length === SERVER_ROOM_BLACKOUT_SEQUENCE.length &&
    SERVER_ROOM_BLACKOUT_SEQUENCE.every((expected, index) => recent[index]?.key === expected);
  return { buffer: complete ? [] : recent, complete };
}

function cabHeight(heightU: number): number {
  return Math.min(124, Math.max(20, Math.max(1, heightU) * PX_PER_U));
}

function zPx(u: number): number {
  return u * PX_PER_U;
}

// Billboard a child of the tilted plane back to screen alignment: lift it to
// `z`, invert the plane's rotateX/rotateZ, then offset in screen space
// (`shift` is a CSS translate() argument list, e.g. "-50%, -100%").
function billboard(z: number, shift: string): string {
  return `translateZ(${z}px) rotateZ(-${ISO_ROT_DEG}deg) rotateX(-${ISO_TILT_DEG}deg) translate(${shift})`;
}

// Room-object reference models are genuine CSS 3D constructions. Keep them in
// the floor plane's coordinate system so the plane supplies the one and only
// axonometric projection; only labels/controls need billboard cancellation.
function surfaceModel(z: number, shift: string): string {
  return `translateZ(${z}px) translate(${shift})`;
}

function blackoutArcDelay(seed: string): string {
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `${((hash % 9) * -0.07).toFixed(2)}s`;
}

function BlackoutDeviceArc({ seed, liftPx }: { seed: string; liftPx?: number }) {
  return (
    <svg
      className="rm-iso-device-arc"
      viewBox="0 0 24 34"
      style={
        {
          "--blackout-arc-delay": blackoutArcDelay(seed),
          ...(liftPx == null ? {} : { "--blackout-arc-lift": `${liftPx}px` }),
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      <path d="M14 1 5 16l7 2-9 15 17-18-8-2L22 1l-8 8Z" />
    </svg>
  );
}

function itemStatus(item: RackItem): RackItemStatus {
  return item.metadata?.status ?? "online";
}

interface DragState {
  kind: "rack" | "object";
  id: string;
  /** Live drag offset in display-plane px. */
  u: number;
  v: number;
  /** Target grid cell (not display coords). */
  target: IsoCell;
}

type PendingFacingPlacement =
  | { kind: "rack"; cell: IsoCell; facing: Facing }
  | { kind: "object"; cell: IsoCell; corner: Corner; facing: Facing };

export function ServerRoomIsoView({
  racks,
  editMode,
  floorColor = "default",
  tool = null,
  placeRackId = null,
  cloneRack = null,
  cloneRackFacing = 0,
  cloneObject = null,
  onRackPlaced,
  onObjectPlaced,
  onCloneRack,
  onCloneObject,
  onCloneRackPlaced,
  onCloneObjectPlaced,
  placement,
  onPlacementChange,
  facing,
  onFacingChange,
  objects,
  onObjectsChange,
  onPlaceKuaiguai,
  onDeleteRack,
  onSelectRack,
  onAddRack,
  onObjectBlocked,
  onCancelPlacement,
  onOpenBackground,
}: {
  racks: Rack[];
  editMode?: boolean;
  floorColor?: IsoFloorColor;
  /** Armed object kind from the shared picker column (SitesTab owns it). */
  tool?: RoomTool;
  /** A just-created rack awaiting its position/facing clicks. */
  placeRackId?: string | null;
  /** Shift-click copy drafts are temporary until their one-click placement. */
  cloneRack?: Rack | null;
  cloneRackFacing?: Facing;
  cloneObject?: RoomObject | null;
  onRackPlaced?: () => void;
  /** A room fixture was successfully placed; the owner may keep continuous tools armed. */
  onObjectPlaced?: () => void;
  onCloneRack?: (rack: Rack) => void;
  onCloneObject?: (object: RoomObject) => void;
  onCloneRackPlaced?: (cell: IsoCell) => void;
  onCloneObjectPlaced?: (cell: IsoCell) => void;
  placement: FreePlacementMap;
  onPlacementChange?: (next: FreePlacementMap) => void;
  facing: RackFacingMap;
  onFacingChange?: (next: RackFacingMap) => void;
  objects: RoomObject[];
  onObjectsChange?: (next: RoomObject[]) => void;
  /** A 乖乖 pack landed on a cabinet top: it becomes a rack-top Rack Device
   *  (shared with the Rack View) instead of a room object. Returns false when
   *  the rack top is already taken. */
  onPlaceKuaiguai?: (rack: Rack, corner?: Corner, facing?: Facing) => boolean;
  onDeleteRack?: (rack: Rack) => void;
  onSelectRack: (rackId: string) => void;
  onAddRack?: () => void;
  /** A placement click or drag found no available space in the cell. */
  onObjectBlocked?: () => void;
  /** Right-click while a picker card is armed disarms it. */
  onCancelPlacement?: () => void;
  /** Empty-space context-menu action owned by the Server Room view. */
  onOpenBackground?: () => void;
}) {
  const { t } = useTranslation();
  const blackoutRootRef = useRef<HTMLDivElement | null>(null);
  const blackoutHoveredRef = useRef(false);
  const blackoutRunningRef = useRef(false);
  const blackoutKeysRef = useRef<ServerRoomBlackoutKey[]>([]);
  const blackoutTimersRef = useRef<number[]>([]);
  const [blackoutPhase, setBlackoutPhase] = useState<BlackoutPhase>("idle");
  const [blackoutKuaikuaiMarkers, setBlackoutKuaikuaiMarkers] = useState<
    BlackoutKuaikuaiMarker[]
  >([]);
  const startBlackout = useCallback(() => {
    if (blackoutRunningRef.current || !blackoutRootRef.current) return;
    const body = blackoutRootRef.current.querySelector<HTMLElement>(".rm-view-body");
    if (body) {
      const bodyRect = body.getBoundingClientRect();
      const kuaikuais = blackoutRootRef.current.querySelectorAll<HTMLElement>(
        '.rm-iso-obj-model[data-kind="kuaikuai"], .rm-iso-rack-top-kuaiguai[data-kind="kuaikuai"]',
      );
      setBlackoutKuaikuaiMarkers(
        Array.from(kuaikuais).map((kuaikuai, index) => {
          const faces = Array.from(
            kuaikuai.querySelectorAll<HTMLElement>(".rm-ref-kuaikuai-face"),
          );
          const rects = faces
            .map((face) => face.getBoundingClientRect())
            .filter((rect) => rect.width > 0 && rect.height > 0);
          const fallback = kuaikuai.getBoundingClientRect();
          const left = rects.length ? Math.min(...rects.map((rect) => rect.left)) : fallback.left;
          const right = rects.length ? Math.max(...rects.map((rect) => rect.right)) : fallback.right;
          const bottom = rects.length
            ? Math.max(...rects.map((rect) => rect.bottom))
            : fallback.bottom;
          const artwork = kuaikuai.querySelector<HTMLElement>(
            '.rm-object-art-iso[data-kind="kuaikuai"]',
          );
          const parsedFacing = Number(artwork?.dataset.facing ?? 0);
          return {
            key: `kuaikuai-${index}`,
            x: (left + right) / 2 - bodyRect.left,
            bottom: bottom - bodyRect.top,
            facing:
              parsedFacing === 1 || parsedFacing === 2 || parsedFacing === 3
                ? parsedFacing
                : 0,
            expired: artwork?.dataset.expired === "true",
          };
        }),
      );
    }
    blackoutRunningRef.current = true;
    setBlackoutPhase("flash");

    blackoutTimersRef.current.push(
      window.setTimeout(() => setBlackoutPhase("dark"), 720),
      window.setTimeout(() => {
        const lights = Array.from(
          blackoutRootRef.current?.querySelectorAll<HTMLElement>("[data-blackout-light]") ?? [],
        );
        for (let index = lights.length - 1; index > 0; index -= 1) {
          const swapIndex = Math.floor(Math.random() * (index + 1));
          [lights[index], lights[swapIndex]] = [lights[swapIndex], lights[index]];
        }
        lights.forEach((light, index) => {
          const delay = (index / Math.max(1, lights.length)) * 4.6;
          light.style.setProperty("--blackout-recovery-delay", `${delay.toFixed(2)}s`);
        });
        setBlackoutPhase("recovering");
      }, 5_720),
      window.setTimeout(() => {
        blackoutRootRef.current
          ?.querySelectorAll<HTMLElement>("[data-blackout-light]")
          .forEach((light) => light.style.removeProperty("--blackout-recovery-delay"));
        setBlackoutPhase("idle");
        setBlackoutKuaikuaiMarkers([]);
        blackoutRunningRef.current = false;
      }, 10_920),
    );
  }, []);
  useEffect(() => {
    const tracked = new Set<string>(SERVER_ROOM_BLACKOUT_SEQUENCE);
    const onKeyDown = (event: KeyboardEvent) => {
      const root = blackoutRootRef.current;
      const focused = root?.contains(document.activeElement);
      if (!root || (!blackoutHoveredRef.current && !focused) || event.repeat) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.matches("input, textarea, select"))
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (!tracked.has(key) || event.altKey || event.ctrlKey || event.metaKey) return;
      const result = trackServerRoomBlackoutKey(blackoutKeysRef.current, key, Date.now());
      blackoutKeysRef.current = result.buffer;
      if (result.complete) startBlackout();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [startBlackout]);
  useEffect(
    () => () => {
      blackoutTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      blackoutTimersRef.current = [];
    },
    [],
  );
  const layout = resolveIsoLayout(
    racks,
    placement,
    objects.filter((object) => object.kind === "wall"),
  );
  const [scrollRef, viewport] = useRoomViewportSize();
  const [angle, setAngle] = useState<IsoViewAngle>(loadIsoViewAngle);
  useEffect(() => saveIsoViewAngle(angle), [angle]);
  // Zoom scales the rendered room; the coverage math below works in unzoomed
  // (logical) px, so zooming out shows more floor in the same window.
  const [zoom, setZoom] = useState(() => loadRoomZoom("iso"));
  useEffect(() => saveRoomZoom("iso", zoom), [zoom]);
  useWheelZoom(scrollRef, (dir) => setZoom((current) => stepRoomZoom(current, dir)));
  const armed =
    tool != null || placeRackId != null || cloneRack != null || cloneObject != null;
  const placing = !!editMode && armed;
  // Cursor-tracked placement preview: hovering a tile (or a cabinet) while a
  // picker card is armed snaps the armed object's ghost to that grid cell.
  const [hover, setHover] = useState<(IsoCell & { corner: Corner }) | null>(null);
  const [pendingFacing, setPendingFacing] = useState<PendingFacingPlacement | null>(null);
  const pendingFacingGuideRef = useRef<HTMLDivElement | null>(null);
  const cancelArmedPlacement = () => {
    setHover(null);
    setPendingFacing(null);
    onCancelPlacement?.();
  };
  const placementPointer = useRoomPlacementPointer(placing, cancelArmedPlacement, scrollRef);
  const [rackHover, setRackHover] = useState<{
    rackId: string;
    pointer: { x: number; y: number };
  } | null>(null);
  useEffect(() => {
    if (!placing) {
      setHover(null);
      setPendingFacing(null);
    }
  }, [placing]);
  useEffect(
    () => setPendingFacing(null),
    [placeRackId, tool, cloneRack?.id, cloneObject?.id],
  );
  const setHoverCell = (cell: IsoCell, corner: Corner = 0) => {
    if (pendingFacing) return;
    setHover((prev) =>
      prev && prev.x === cell.x && prev.y === cell.y && prev.corner === corner
        ? prev
        : { ...cell, corner },
    );
  };
  const cornerFromTileEvent = (
    event: ReactPointerEvent<HTMLButtonElement> | ReactMouseEvent<HTMLButtonElement>,
  ): Corner =>
    tool != null && objectSpec(tool).quarter
      ? cornerFromDisplayPoint(
          event.nativeEvent.offsetX,
          event.nativeEvent.offsetY,
          event.currentTarget.offsetWidth,
          event.currentTarget.offsetHeight,
          angle,
        )
      : 0;
  const clearHoverOutsideTarget = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pendingFacing) {
      const nextFacing = facingFromPendingPointer(event);
      setPendingFacing((current) => current ? { ...current, facing: nextFacing } : current);
      return;
    }
    const target = event.target as HTMLElement;
    if (!target.closest(".rm-iso-tile, .rm-iso-cab")) setHover(null);
  };
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selectedItem, setSelectedItem] = useState<{
    kind: "rack" | "object";
    id: string;
  } | null>(null);
  useEffect(() => {
    if (!editMode) setSelectedItem(null);
  }, [editMode]);
  useEffect(() => {
    if (!selectedItem) return;
    const exists = selectedItem.kind === "rack"
      ? racks.some((rack) => rack.id === selectedItem.id)
      : objects.some((object) => object.id === selectedItem.id);
    if (!exists) setSelectedItem(null);
  }, [objects, racks, selectedItem]);
  // Mutable drag bookkeeping: the live target must not lag behind React's
  // batched `drag` state when the pointer is released.
  const dragRef = useRef<{
    kind: "rack" | "object";
    id: string;
    startX: number;
    startY: number;
    origin: IsoCell;
    target: IsoCell;
    moved: boolean;
  } | null>(null);
  // A completed drag is followed by a click on the cabinet button; swallow it
  // so dropping a cabinet doesn't also drill into the rack.
  const suppressClickRef = useRef(false);

  // Interactive grid: the layout's own cells, widened to cover any object a
  // floor-plan edit placed beyond the racks (including multi-cell spans).
  const gridCols = Math.max(
    layout.cols,
    ...objects.map((object) => object.x + objectCellSpan(object.kind, object.rot).w),
  );
  const gridRows = Math.max(
    layout.rows,
    ...objects.map((object) => object.y + objectCellSpan(object.kind, object.rot).h),
  );
  // Headroom for the tallest cabinet or elevated object.
  let maxTop = racks.reduce((max, rack) => Math.max(max, cabHeight(rack.heightU)), 0);
  for (const object of objects) {
    maxTop = Math.max(maxTop, zPx(object.z + objectSpec(object.kind).heightU));
  }

  // The canvas is the projected bounding box of the interactive grid plus
  // headroom, grown to fill the scroll viewport. The drawn floor then adds
  // decorative cells beyond the room origin until the plane's projection
  // covers that canvas (the viewport clips the overhang).
  // cols+rows fixes the projected diagonal — a view rotation only swaps them
  // — so the ring size is angle-independent.
  const contentDiag = (gridCols + gridRows) * CELL * Math.SQRT1_2;
  const naturalView = {
    w: Math.ceil(contentDiag) + 48,
    h: Math.ceil(contentDiag * ISO_TILT_COS) + Math.ceil(maxTop) + 84,
  };
  const effectiveZoom = fitIsoRoomZoom(naturalView, viewport, zoom);
  const viewW = Math.max(naturalView.w, (viewport?.w ?? 0) / effectiveZoom);
  const viewH = Math.max(
    naturalView.h,
    (viewport?.h ?? 0) / effectiveZoom,
    isoViewHeightForWidth(viewW, maxTop),
  );
  const sceneW = viewW * effectiveZoom;
  const sceneH = viewH * effectiveZoom;
  const panFrame = roomPanFrame(
    viewport ?? { w: sceneW, h: sceneH },
    { w: sceneW, h: sceneH },
  );
  const panCenter = roomScrollCenter(
    viewport ?? { w: sceneW, h: sceneH },
    { w: panFrame.w, h: panFrame.h },
  );
  useRoomPan(scrollRef, panCenter);
  const floorDiag = Math.max(viewW - 48, (viewH - Math.ceil(maxTop) - 84) / ISO_TILT_COS);
  const { floorCols, floorRows, offX, offY } = expandIsoFloorFrame(
    gridCols,
    gridRows,
    floorDiag,
    CELL,
  );
  const placementGrid: IsoLayout = { cols: floorCols, rows: floorRows, cells: layout.cells };
  const dims = viewGridSize(floorCols, floorRows, angle);
  const toDisplay = (cell: IsoCell) =>
    rotateCellForView({ x: cell.x + offX, y: cell.y + offY }, angle, floorCols, floorRows);
  const objectDisplayRect = (object: RoomObject): CellRect => {
    const fp = objectFootprint(object.kind, object.rot, object.corner);
    return rotateRectForView(
      { x: object.x + offX + fp.x, y: object.y + offY + fp.y, w: fp.w, d: fp.d },
      angle,
      floorCols,
      floorRows,
    );
  };
  const objectDisplayAnchor = (object: RoomObject): { x: number; y: number } => {
    const anchor = objectSurfaceAnchor(object.kind, object.rot, object.corner);
    return rotatePointForView(
      { x: object.x + offX + anchor.x, y: object.y + offY + anchor.y },
      angle,
      floorCols,
      floorRows,
    );
  };
  const planeW = dims.cols * CELL;
  const planeH = dims.rows * CELL;

  const clampCell = (cell: IsoCell): IsoCell => ({
    x: Math.min(floorCols - 1, Math.max(0, Math.round(cell.x))),
    y: Math.min(floorRows - 1, Math.max(0, Math.round(cell.y))),
  });

  function startDrag(
    event: ReactPointerEvent<HTMLDivElement>,
    kind: "rack" | "object",
    id: string,
    origin: IsoCell,
  ) {
    if (!editMode || armed || event.shiftKey) return;
    // Left button only — the middle button pans the viewport (useRoomPan).
    if (event.button !== 0) return;
    if (kind === "rack" && !onPlacementChange) return;
    if (kind === "object" && !onObjectsChange) return;
    const target = event.target as HTMLElement;
    if (target.closest(".rm-iso-ctl")) return;
    setSelectedItem({ kind, id });
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { kind, id, startX: event.clientX, startY: event.clientY, origin, target: origin, moved: false };
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragRef.current;
    if (!state) return;
    // Screen deltas divided by effective zoom: the dragged cabinet renders inside the
    // scaled viewport, so its translate scales back up to match the pointer.
    const { u, v } = screenDeltaToPlane(
      (event.clientX - state.startX) / effectiveZoom,
      (event.clientY - state.startY) / effectiveZoom,
    );
    if (Math.abs(u) > 3 || Math.abs(v) > 3) state.moved = true;
    if (!state.moved) return;
    const { dx, dy } = viewDeltaToGrid(u, v, angle);
    state.target = clampCell({ x: state.origin.x + dx / CELL, y: state.origin.y + dy / CELL });
    setDrag({ kind: state.kind, id: state.id, u, v, target: state.target });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragRef.current;
    if (state) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (state.moved) {
        // The follow-up click (if any) dispatches before timers run; the
        // timeout only clears a stale flag when no click follows (cancel).
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
        if (state.kind === "rack") {
          if (wallOccupiesCell(state.target, objects)) onObjectBlocked?.();
          else onPlacementChange?.(moveIsoRack(placementGrid, state.id, state.target));
        } else {
          dropObject(state.id, state.target);
        }
      }
    }
    dragRef.current = null;
    setDrag(null);
  }

  function dropObject(id: string, target: IsoCell) {
    const object = objects.find((entry) => entry.id === id);
    if (!object || !onObjectsChange) return;
    const spans = footprintSpans(
      target,
      object.kind,
      object.rot,
      racks,
      layout.cells,
      objects,
      id,
      object.corner,
      facing,
    );
    const z = resolveDropZ(spans, object.kind, object.z);
    if (z == null) {
      onObjectBlocked?.();
      return;
    }
    if (object.kind === "kuaikuai" && onPlaceKuaiguai) {
      const support = rackTopSupport(target, object.kind, object.rot, object.corner, z, racks, layout.cells, facing);
      if (support) {
        if (onPlaceKuaiguai(support, object.corner)) {
          onObjectsChange(objects.filter((entry) => entry.id !== id));
        } else {
          onObjectBlocked?.();
        }
        return;
      }
    }
    onObjectsChange(
      objects.map((entry) => (entry.id === id ? { ...entry, x: target.x, y: target.y, z } : entry)),
    );
  }

  function facingFromPendingPointer(event: { clientX: number; clientY: number }): Facing {
    const guide = pendingFacingGuideRef.current;
    if (!guide) return pendingFacing?.facing ?? 0;
    const rect = guide.getBoundingClientRect();
    const { u, v } = screenDeltaToPlane(
      (event.clientX - (rect.left + rect.width / 2)) / effectiveZoom,
      (event.clientY - (rect.top + rect.height / 2)) / effectiveZoom,
    );
    const delta = viewDeltaToGrid(u, v, angle);
    return facingFromPoint({ x: delta.dx, y: delta.dy }, { x: 0, y: 0 });
  }

  function resolveObjectPlacement(cell: IsoCell, corner: Corner, rot: Facing) {
    if (tool == null) return { z: null, support: null };
    const z = resolveDropZ(
      footprintSpans(cell, tool, rot, racks, layout.cells, objects, undefined, corner, facing),
      tool,
    );
    if (z == null) return { z: null, support: null };
    const support = tool === "kuaikuai"
      ? rackTopSupport(cell, tool, rot, corner, z, racks, layout.cells, facing)
      : null;
    if (support?.items.some((item) => isRackTopItem(item, support.heightU))) {
      return { z: null, support };
    }
    return { z, support };
  }

  function placeObjectAt(
    cell: IsoCell,
    corner: Corner,
    event: { clientX: number; clientY: number },
  ) {
    if (tool == null || !onObjectsChange) return;
    if (pendingFacing?.kind === "object") {
      const nextFacing = facingFromPendingPointer(event);
      const candidate = resolveObjectPlacement(
        pendingFacing.cell,
        pendingFacing.corner,
        nextFacing,
      );
      if (candidate.z == null) {
        onObjectBlocked?.();
        return;
      }
      if (tool === "kuaikuai" && candidate.support && onPlaceKuaiguai) {
        if (!onPlaceKuaiguai(candidate.support, pendingFacing.corner, nextFacing)) {
          onObjectBlocked?.();
          return;
        }
      } else {
        onObjectsChange([
          ...objects,
          {
            id: crypto.randomUUID(),
            kind: tool,
            x: pendingFacing.cell.x,
            y: pendingFacing.cell.y,
            z: candidate.z,
            rot: nextFacing,
            corner: pendingFacing.corner,
          },
        ]);
      }
      setPendingFacing(null);
      setHover(null);
      onObjectPlaced?.();
      return;
    }
    if (resolveObjectPlacement(cell, corner, 0).z == null) {
      onObjectBlocked?.();
      return;
    }
    setPendingFacing({ kind: "object", cell, corner, facing: 0 });
    setHover({ ...cell, corner });
  }

  function placeCloneAt(cell: IsoCell) {
    if (cloneRack != null) {
      if (!roomCellIsBlank(cell, layout.cells, objects)) {
        onObjectBlocked?.();
        return;
      }
      setHover(null);
      onCloneRackPlaced?.(cell);
      return;
    }
    if (cloneObject != null) {
      const span = objectCellSpan(cloneObject.kind, cloneObject.rot);
      if (
        cell.x + span.w > floorCols ||
        cell.y + span.h > floorRows ||
        !roomObjectPlacementIsBlank(
          cell,
          cloneObject.kind,
          cloneObject.rot,
          layout.cells,
          objects,
        )
      ) {
        onObjectBlocked?.();
        return;
      }
      setHover(null);
      onCloneObjectPlaced?.(cell);
    }
  }

  // Drop the picker's just-created rack on a cell (swapping with another Rack,
  // but never entering a Wall's reserved block).
  function placeRackAt(cell: IsoCell, event: { clientX: number; clientY: number }) {
    if (placeRackId == null) return;
    if (pendingFacing?.kind === "rack") {
      const nextFacing = facingFromPendingPointer(event);
      if (layout.cells[placeRackId]) {
        setPendingFacing(null);
        setHover(null);
        onPlacementChange?.(moveIsoRack(placementGrid, placeRackId, pendingFacing.cell));
        onFacingChange?.({ ...facing, [placeRackId]: nextFacing });
        onRackPlaced?.();
      }
      return;
    }
    if (wallOccupiesCell(cell, objects)) {
      onObjectBlocked?.();
      return;
    }
    setPendingFacing({ kind: "rack", cell, facing: 0 });
    setHover({ ...cell, corner: 0 });
  }

  function selectRack(rack: Rack, event: ReactMouseEvent<HTMLButtonElement>) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (editMode && event.shiftKey && onCloneRack) {
      event.stopPropagation();
      onCloneRack(rack);
      return;
    }
    if (cloneRack != null || cloneObject != null) {
      onObjectBlocked?.();
      return;
    }
    if (placeRackId != null) {
      placeRackAt(layout.cells[rack.id], event);
      return;
    }
    if (tool != null) {
      placeObjectAt(layout.cells[rack.id], cornerFromTileEvent(event), event);
      return;
    }
    if (editMode) {
      setSelectedItem({ kind: "rack", id: rack.id });
      return;
    }
    onSelectRack(rack.id);
  }

  function selectObject(object: RoomObject, event: ReactMouseEvent<HTMLDivElement>) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (editMode && event.shiftKey && onCloneObject) {
      event.stopPropagation();
      onCloneObject(object);
      return;
    }
    if (cloneRack != null || cloneObject != null) {
      onObjectBlocked?.();
      return;
    }
    if (editMode && !armed) setSelectedItem({ kind: "object", id: object.id });
  }

  function handleRoomPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!editMode || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(".rm-iso-cab, .rm-iso-obj, .rm-iso-corner")) return;
    setSelectedItem(null);
  }

  async function handleRoomContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (placing) {
      event.preventDefault();
      cancelArmedPlacement();
      return;
    }
    if (!onOpenBackground) return;
    const target = event.target as HTMLElement;
    if (target.closest(".rm-iso-cab, .rm-iso-obj, .rm-iso-corner")) return;
    event.preventDefault();
    await showNativeContextMenu(
      [
        {
          kind: "item",
          label: t("itops.racks.changeBackground"),
          iconSvg: nativeMenuIcons.image,
          action: onOpenBackground,
        },
      ],
      { x: event.clientX, y: event.clientY },
    );
  }

  function rotateRack(rack: Rack) {
    if (!onFacingChange) return;
    const current = sanitizeFacing(facing[rack.id]);
    onFacingChange({ ...facing, [rack.id]: ((current + 1) % 4) as Facing });
  }

  function rotateObject(object: RoomObject) {
    onObjectsChange?.(
      objects.map((entry) =>
        entry.id === object.id ? { ...entry, rot: ((entry.rot + 1) % 4) as Facing } : entry,
      ),
    );
  }

  // Walk a quarter-block fixture to the next cell corner (NW→NE→SE→SW).
  function cycleCorner(object: RoomObject) {
    onObjectsChange?.(
      objects.map((entry) =>
        entry.id === object.id ? { ...entry, corner: ((entry.corner + 1) % 4) as Corner } : entry,
      ),
    );
  }

  function nudgeObject(object: RoomObject, dir: 1 | -1) {
    const spans = footprintSpans(
      object,
      object.kind,
      object.rot,
      racks,
      layout.cells,
      objects,
      object.id,
      object.corner,
      facing,
    );
    const z = nudgeZ(spans, object.kind, object.z, dir);
    if (z === object.z) return;
    onObjectsChange?.(objects.map((entry) => (entry.id === object.id ? { ...entry, z } : entry)));
  }

  // Edit-mode click targets: empty tiles add a rack (no tool) or take an
  // armed rack/object; cells holding only objects still get a tile while a
  // tool is armed so a second fixture can stack in the same cell.
  const rackCells = new Set(Object.values(layout.cells).map((cell) => `${cell.x},${cell.y}`));
  const editableTiles = editMode && (onAddRack || armed)
    ? isoPlacementCells(floorCols, floorRows, rackCells)
    : [];

  return (
    <div
      className="rm-iso"
      data-blackout-phase={blackoutPhase}
      ref={blackoutRootRef}
      onPointerEnter={() => {
        blackoutHoveredRef.current = true;
      }}
      onPointerLeave={() => {
        blackoutHoveredRef.current = false;
      }}
    >
      <div className="rm-view-body">
        {/* tabIndex: clicking the room focuses the viewport so arrow keys pan. */}
        <div
          className="rm-iso-scroll"
          ref={scrollRef}
          tabIndex={0}
          onPointerDown={handleRoomPointerDown}
          onContextMenu={placing || onOpenBackground ? handleRoomContextMenu : undefined}
        >
          <div className="rm-iso-zoom" style={{ width: panFrame.w, height: panFrame.h }}>
            <div
              className="rm-iso-viewport"
              style={{
                width: viewW,
                height: viewH,
                left: panFrame.sceneLeft,
                top: panFrame.sceneTop,
                transform: effectiveZoom !== 1 ? `scale(${effectiveZoom})` : undefined,
              }}
            >
              <div
                className={`rm-iso-plane${placing ? " placing" : ""}`}
                data-floor={floorColor !== "default" ? floorColor : undefined}
                style={{
                  width: planeW,
                  height: planeH,
                  backgroundSize: `${CELL}px ${CELL}px, ${CELL}px ${CELL}px, auto`,
                  top: `calc(50% + ${Math.round(maxTop * 0.38)}px)`,
                }}
                onPointerMove={placing ? clearHoverOutsideTarget : undefined}
                onPointerLeave={placing && !pendingFacing ? () => setHover(null) : undefined}
              >
                {editableTiles.map((cell) => {
                  const at = toDisplay(cell);
                  return (
                    <button
                      key={`t-${cell.x}-${cell.y}`}
                      type="button"
                      className="rm-iso-tile"
                      style={{ left: at.x * CELL, top: at.y * CELL, width: CELL, height: CELL }}
                      title={
                        cloneRack != null
                          ? cloneRack.name
                          : cloneObject != null
                            ? t(`itops.floorPlan.object.${cloneObject.kind}`)
                            : placeRackId != null
                          ? t("itops.floorPlan.pickerRack")
                          : tool != null
                            ? t(`itops.floorPlan.object.${tool}`)
                            : t("itops.floorPlan.isoAddHere")
                      }
                      onPointerEnter={
                        placing
                          ? (event) => setHoverCell(cell, cornerFromTileEvent(event))
                          : undefined
                      }
                      onPointerMove={
                        placing
                          ? (event) => setHoverCell(cell, cornerFromTileEvent(event))
                          : undefined
                      }
                      onClick={(event) =>
                        cloneRack != null || cloneObject != null
                          ? placeCloneAt(cell)
                          : placeRackId != null
                          ? placeRackAt(cell, event)
                          : tool != null
                            ? placeObjectAt(cell, cornerFromTileEvent(event), event)
                            : onAddRack?.()
                      }
                    >
                      <ItIcon name="plus" size={13} />
                    </button>
                  );
                })}
                {drag ? (
                  <div
                    className={`rm-iso-drop${
                      drag.kind === "rack" && wallOccupiesCell(drag.target, objects)
                        ? " blocked"
                        : ""
                    }`}
                    style={{
                      left: toDisplay(drag.target).x * CELL,
                      top: toDisplay(drag.target).y * CELL,
                      width: CELL,
                      height: CELL,
                    }}
                  />
                ) : null}
                {racks.map((rack) => (
                  <IsoCabinet
                    key={rack.id}
                    rack={rack}
                    cell={toDisplay(layout.cells[rack.id])}
                    facing={rotateFacingForView(sanitizeFacing(facing[rack.id]), angle)}
                    viewAngle={angle}
                    drag={drag?.kind === "rack" && drag.id === rack.id ? drag : null}
                    editMode={!!editMode}
                    selected={selectedItem?.kind === "rack" && selectedItem.id === rack.id}
                    onPointerDown={(event) => startDrag(event, "rack", rack.id, layout.cells[rack.id])}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onInfoHover={(event) =>
                      setRackHover({
                        rackId: rack.id,
                        pointer: { x: event.clientX, y: event.clientY },
                      })
                    }
                    onInfoLeave={() => setRackHover(null)}
                    onHoverCell={
                      placing
                        ? (event) =>
                            setHoverCell(layout.cells[rack.id], cornerFromTileEvent(event))
                        : undefined
                    }
                    onSelect={(event) => selectRack(rack, event)}
                    onRotate={editMode && onFacingChange ? () => rotateRack(rack) : undefined}
                    onDelete={
                      editMode && onDeleteRack
                        ? () => {
                            setSelectedItem(null);
                            onDeleteRack(rack);
                          }
                        : undefined
                    }
                  />
                ))}
                {objects.map((object) => (
                  <IsoObject
                    key={object.id}
                    object={object}
                    rect={objectDisplayRect(object)}
                    anchor={objectDisplayAnchor(object)}
                    // A wall's arms already point at its joined neighbours in
                    // grid space, so its construction turns with the view
                    // angle only; other kinds add their stored rotation.
                    arms={object.kind === "wall" ? wallArms(object, objects) : undefined}
                    facing={rotateFacingForView(object.kind === "wall" ? 0 : object.rot, angle)}
                    drag={drag?.kind === "object" && drag.id === object.id ? drag : null}
                    editMode={!!editMode}
                    selected={selectedItem?.kind === "object" && selectedItem.id === object.id}
                    onPointerDown={(event) =>
                      startDrag(event, "object", object.id, { x: object.x, y: object.y })
                    }
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onSelect={(event) => selectObject(object, event)}
                    onRotate={() => rotateObject(object)}
                    onCorner={
                      objectSpec(object.kind).quarter ? () => cycleCorner(object) : undefined
                    }
                    onRaise={() => nudgeObject(object, 1)}
                    onLower={() => nudgeObject(object, -1)}
                    onDelete={
                      onObjectsChange
                        ? () => {
                            setSelectedItem(null);
                            onObjectsChange(objects.filter((entry) => entry.id !== object.id));
                          }
                        : undefined
                    }
                  />
                ))}
                {placing && (pendingFacing ?? hover)
                  ? (() => {
                      // Realtime placement preview on the hovered cell: the
                      // armed fixture's 2.5D artwork at its resolved level
                      // over its covered cell span (red tile when the cell
                      // has no free vertical span), or the complete cabinet
                      // model for the pending rack at its depth, front flush.
                      const preview = pendingFacing ?? {
                        kind: tool != null || cloneObject != null ? "object" as const : "rack" as const,
                        cell: hover!,
                        corner: cloneObject?.corner ?? hover!.corner,
                        facing: cloneObject?.rot ?? cloneRackFacing,
                      };
                      const previewFacing = preview.facing;
                      const previewObjectKind = cloneObject?.kind ?? tool;
                      if (previewObjectKind != null) {
                        const previewCorner = preview.kind === "object" ? preview.corner : (0 as Corner);
                        const z = cloneObject != null
                          ? roomObjectPlacementIsBlank(
                              preview.cell,
                              cloneObject.kind,
                              cloneObject.rot,
                              layout.cells,
                              objects,
                            )
                            ? cloneObject.z
                            : null
                          : resolveObjectPlacement(
                              preview.cell,
                              previewCorner,
                              previewFacing,
                            ).z;
                        const displayFacing = rotateFacingForView(previewFacing, angle);
                        const fp = objectFootprint(
                          previewObjectKind,
                          previewFacing,
                          previewCorner,
                        );
                        const anchor = objectSurfaceAnchor(
                          previewObjectKind,
                          previewFacing,
                          previewCorner,
                        );
                        const displayRect = rotateRectForView(
                          { x: preview.cell.x + offX + fp.x, y: preview.cell.y + offY + fp.y, w: fp.w, d: fp.d },
                          angle,
                          floorCols,
                          floorRows,
                        );
                        const tile = {
                          left: displayRect.x * CELL,
                          top: displayRect.y * CELL,
                          width: displayRect.w * CELL,
                          height: displayRect.d * CELL,
                        };
                        const displayAnchor = rotatePointForView(
                          { x: preview.cell.x + offX + anchor.x, y: preview.cell.y + offY + anchor.y },
                          angle,
                          floorCols,
                          floorRows,
                        );
                        return (
                          <>
                            <div
                              ref={pendingFacing ? pendingFacingGuideRef : undefined}
                              className={`rm-iso-drop${z == null ? " blocked" : ""}`}
                              style={tile}
                            >
                              {pendingFacing ? (
                                <RoomPlacementFacingArrow
                                  facing={displayFacing}
                                  liftPx={
                                    z == null
                                      ? 8
                                      : zPx(z + objectSpec(previewObjectKind).heightU) + 8
                                  }
                                />
                              ) : null}
                            </div>
                            {z != null ? (
                              <div
                                className={`rm-iso-obj ghost${z === 0 ? " grounded" : ""}`}
                                data-kind={previewObjectKind}
                                style={
                                  {
                                    left: displayRect.x * CELL,
                                    top: displayRect.y * CELL,
                                    width: displayRect.w * CELL,
                                    height: displayRect.d * CELL,
                                    "--obj": OBJECT_ACCENTS[previewObjectKind],
                                    "--tile": OBJECT_ACCENTS[previewObjectKind],
                                  } as React.CSSProperties
                                }
                              >
                                <span
                                  className="rm-iso-obj-model"
                                  data-kind={previewObjectKind}
                                  style={{
                                    left: (displayAnchor.x - displayRect.x) * CELL,
                                    top: (displayAnchor.y - displayRect.y) * CELL,
                                    transform: surfaceModel(zPx(z), "-50%, -100%"),
                                  }}
                                >
                                  <RoomObjectIsoArtwork
                                    kind={previewObjectKind}
                                    facing={displayFacing}
                                  />
                                </span>
                              </div>
                            ) : null}
                          </>
                        );
                      }
                      const at = toDisplay(preview.cell);
                      const pendingRack =
                        cloneRack ?? racks.find((entry) => entry.id === placeRackId);
                      const gh = cabHeight(pendingRack?.heightU ?? 42);
                      const displayFacing = rotateFacingForView(previewFacing, angle);
                      const blocked = cloneRack != null
                        ? !roomCellIsBlank(preview.cell, layout.cells, objects)
                        : wallOccupiesCell(preview.cell, objects);
                      const fp = rackFootprint(
                        displayFacing,
                        rackDepthFrac(pendingRack?.depthMm ?? 1000),
                      );
                      const w = fp.w * CELL;
                      const d = fp.d * CELL;
                      return (
                        <>
                          <div
                            ref={pendingFacing ? pendingFacingGuideRef : undefined}
                            className={`rm-iso-drop${blocked ? " blocked" : ""}`}
                            style={{
                              left: (at.x + fp.x) * CELL,
                              top: (at.y + fp.y) * CELL,
                              width: w,
                              height: d,
                            }}
                          >
                            {pendingFacing && cloneRack == null ? (
                              <RoomPlacementFacingArrow facing={displayFacing} liftPx={gh + 8} />
                            ) : null}
                          </div>
                          {pendingRack ? (
                            <IsoCabinet
                              rack={pendingRack}
                              cell={at}
                              facing={displayFacing}
                              viewAngle={angle}
                              drag={null}
                              editMode={false}
                              selected={false}
                              ghost
                              blocked={blocked}
                            />
                          ) : null}
                        </>
                      );
                    })()
                  : null}
              </div>
            </div>
          </div>
          <RoomRackHoverCard
            rack={rackHover ? racks.find((rack) => rack.id === rackHover.rackId) ?? null : null}
            pointer={rackHover?.pointer ?? null}
            boundaryRef={scrollRef}
          />
        </div>
        <div className="rm-iso-blackout-fx" aria-hidden="true">
          <div className="rm-iso-blackout-vignette" />
          <div className="rm-iso-blackout-flicker" />
          <div className="rm-iso-blackout-smoke">
            <i style={{ "--blackout-x": "34%", "--blackout-delay": "0s" } as React.CSSProperties} />
            <i style={{ "--blackout-x": "46%", "--blackout-delay": ".35s" } as React.CSSProperties} />
            <i style={{ "--blackout-x": "58%", "--blackout-delay": ".7s" } as React.CSSProperties} />
            <i style={{ "--blackout-x": "68%", "--blackout-delay": ".18s" } as React.CSSProperties} />
          </div>
          <div className="rm-iso-blackout-kuaikuais">
            {blackoutKuaikuaiMarkers.map((marker) => (
              <span
                key={marker.key}
                className="rm-iso-blackout-kuaikuai"
                style={{ left: marker.x, top: marker.bottom }}
              >
                <RoomObjectIsoArtwork
                  kind="kuaikuai"
                  facing={marker.facing}
                  expiry={marker.expired ? "2000-01-01" : undefined}
                />
              </span>
            ))}
          </div>
          <svg className="rm-iso-blackout-bolt" viewBox="0 0 1120 580" preserveAspectRatio="none">
            <path d="M560 -20 L536 120 L588 150 L520 270 L566 300 L470 372" />
            <path d="M520 270 L470 300 L500 340" />
            <path d="M588 150 L636 196" />
          </svg>
          <div className="rm-iso-blackout-flash" />
        </div>
        {/* Floating control column over the room's top-right corner. Floor
            finish now belongs to Server Room Properties. */}
        <div className="rm-iso-corner">
          <RoomZoomRuler
            zoom={zoom}
            onZoomChange={setZoom}
            onResetCenter={() => centerRoomViewport(scrollRef)}
          />
          <div
            className="rm-iso-angles"
            role="group"
            aria-label={t("itops.floorPlan.viewAngleLabel")}
          >
            <button
              type="button"
              title={t("itops.floorPlan.rotateViewLeft")}
              aria-label={t("itops.floorPlan.rotateViewLeft")}
              onClick={() => setAngle(((angle + 3) % 4) as IsoViewAngle)}
            >
              <ItIcon name="rotateL" size={13} />
            </button>
            <button
              type="button"
              title={t("itops.floorPlan.rotateViewRight")}
              aria-label={t("itops.floorPlan.rotateViewRight")}
              onClick={() => setAngle(((angle + 1) % 4) as IsoViewAngle)}
            >
              <ItIcon name="rotateR" size={13} />
            </button>
          </div>
        </div>
      </div>
      {editMode ? <div className="rm-iso-hint">{t("itops.floorPlan.isoEditHint")}</div> : null}
      <RoomPlacementCursorGhost
        pointer={placementPointer}
        tool={cloneObject?.kind ?? tool}
        rackArmed={placeRackId != null || cloneRack != null}
        variant="iso"
        snapped={pendingFacing != null || hover != null}
      />
    </div>
  );
}

// Miniature of the 2D rack skin, painted on a cabinet face: the rack shell as
// backdrop and each placed device as a faceplate strip at its U position with
// a status LED. Strip geometry mirrors RackElevation's U grid. On the south
// (+y) face the U axis runs down the element ("y"); on the east (+x) face the
// rotateY(90°) fold maps the cabinet's up direction onto the element's width,
// right edge = floor, so strips lay out horizontally ("x").
function IsoRackSkin({
  rack,
  axis,
  face,
}: {
  rack: Rack;
  axis: "y" | "x";
  face: "front" | "rear";
}) {
  const capacity = Math.max(1, rack.heightU);
  return (
    <span
      className={`rm-iso-skin axis-${axis}`}
      data-face={face}
      data-shell={rack.shell && rack.shell !== "black" ? rack.shell : undefined}
    >
      <span className="rm-iso-skin-items">
        {rack.items
          .filter(
            (item) =>
              item.kind !== "kuaiguai" && (item.mountFace ?? "front") === face,
          )
          .map((item) => {
            const topU = item.startU + item.heightU - 1;
            const offset = ((capacity - topU) / capacity) * 100;
            const size = (Math.max(1, item.heightU) / capacity) * 100;
            // Fractional-width faces inset across the strip's cross axis so two
            // devices sharing a U render side by side.
            const { xStart, xQuarters } = rackItemXSpan(item.metadata);
            const cross =
              xQuarters < 4
                ? { start: `${xStart * 25}%`, size: `${xQuarters * 25}%` }
                : null;
            return (
              <i
                key={item.id}
                className="rm-iso-skin-item"
                data-blackout-light=""
                data-kind={item.kind}
                data-status={itemStatus(item)}
                style={
                  axis === "y"
                    ? {
                        top: `${offset}%`,
                        height: `${size}%`,
                        ...(cross ? { left: cross.start, width: cross.size } : {}),
                      }
                    : {
                        left: `${offset}%`,
                        width: `${size}%`,
                        ...(cross ? { top: cross.start, height: cross.size } : {}),
                      }
                }
              >
                <BlackoutDeviceArc seed={item.id} />
              </i>
            );
          })}
      </span>
    </span>
  );
}

function IsoCabinet({
  rack,
  cell,
  facing,
  viewAngle,
  drag,
  editMode,
  selected,
  ghost = false,
  blocked = false,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onInfoHover,
  onInfoLeave,
  onHoverCell,
  onSelect,
  onRotate,
  onDelete,
}: {
  rack: Rack;
  /** Display cell (already view-rotated). */
  cell: IsoCell;
  /** Display facing (already view-rotated). */
  facing: Facing;
  viewAngle: IsoViewAngle;
  drag: DragState | null;
  editMode: boolean;
  selected: boolean;
  /** Placement preview uses the complete cabinet model without interactions. */
  ghost?: boolean;
  blocked?: boolean;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onInfoHover?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onInfoLeave?: () => void;
  /** Armed placement hover: previews the selected quarter of this cabinet top. */
  onHoverCell?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onSelect?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onRotate?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const m = rackFloorMetrics(rack);
  const h = cabHeight(rack.heightU);
  // Full cell along the side axis so adjacent cabinets connect; the depth
  // axis tracks the cabinet's physical depth, front face flush on the tile
  // borderline the facing points at.
  const fp = rackFootprint(facing, rackDepthFrac(rack.depthMm));
  const w = fp.w * CELL;
  const d = fp.d * CELL;
  const left = (cell.x + fp.x) * CELL;
  const top = (cell.y + fp.y) * CELL;
  // Which visible face (south = +y, east = +x) carries the device skin; the
  // other reads as a plain side, or as the cable rear when the front is
  // turned away from the camera.
  const southRole = facing === 0 ? "front" : facing === 2 ? "rear" : "side";
  const eastRole = facing === 3 ? "front" : facing === 1 ? "rear" : "side";
  const health = t(`itops.floorPlan.health.${m.health}`);
  const topKuaiguai = rack.items.find((item) => isRackTopItem(item, rack.heightU));
  const topKuaiguaiPoint = rackTopCornerPoint(
    topKuaiguai?.metadata?.rackTopCorner,
    viewAngle,
  );

  return (
    <div
      className={`rm-iso-cab${drag ? " dragging" : ""}${editMode ? " editing" : ""}${selected ? " selected" : ""}${ghost ? " ghost" : ""}${blocked ? " blocked" : ""}`}
      data-shell={rack.shell && rack.shell !== "black" ? rack.shell : undefined}
      style={{
        left,
        top,
        width: w,
        height: d,
        transform: drag ? `translate3d(${drag.u}px, ${drag.v}px, 0)` : undefined,
      }}
      onPointerDown={editMode ? onPointerDown : undefined}
      onPointerMove={editMode ? onPointerMove : undefined}
      onPointerUp={editMode ? onPointerUp : undefined}
      onPointerCancel={editMode ? onPointerCancel : undefined}
      onPointerEnter={onInfoHover}
      onPointerLeave={onInfoLeave}
    >
      <button
        type="button"
        className="rm-iso-body"
        title={t("itops.floorPlan.tileTitle", { name: rack.name, detail: health })}
        onClick={onSelect}
        onPointerEnter={onHoverCell}
        onPointerMove={onHoverCell}
      >
        <span className="rm-iso-face rm-iso-top" style={{ transform: `translateZ(${h}px)` }}>
          <span
            className="rm-iso-nameplate"
            style={{ transform: `translate(-50%, -50%) rotate(${facing * 90}deg)` }}
          >
            {rack.name}
          </span>
        </span>
        {topKuaiguai ? (
          <span
            className="rm-iso-rack-top-kuaiguai"
            data-kind="kuaikuai"
            style={{
              left: `${topKuaiguaiPoint.x * 100}%`,
              top: `${topKuaiguaiPoint.y * 100}%`,
              transform: surfaceModel(h, "-50%, -100%"),
            }}
          >
            <RoomObjectIsoArtwork
              kind="kuaikuai"
              facing={rotateFacingForView(
                sanitizeFacing(topKuaiguai.metadata?.rackTopFacing),
                viewAngle,
              )}
              expiry={topKuaiguai.metadata?.expiry}
            />
          </span>
        ) : null}
        <span
          className={`rm-iso-face rm-iso-front ${southRole}`}
          style={{ width: w, height: h, top: d - h }}
        >
          {southRole === "front" ? (
            <IsoRackSkin rack={rack} axis="y" face="front" />
          ) : southRole === "rear" ? (
            <IsoRackSkin rack={rack} axis="y" face="rear" />
          ) : null}
        </span>
        <span
          className={`rm-iso-face rm-iso-side ${eastRole}`}
          style={{ width: h, height: d, left: w - h }}
        >
          {eastRole === "front" ? (
            <IsoRackSkin rack={rack} axis="x" face="front" />
          ) : eastRole === "rear" ? (
            <IsoRackSkin rack={rack} axis="x" face="rear" />
          ) : null}
        </span>
      </button>
      {editMode && selected && (onRotate || onDelete) ? (
        <span className="rm-iso-ctl-wrap" style={{ transform: billboard(h + 6, "40%, -170%") }}>
          <span className="rm-iso-ctl">
            {onRotate ? (
              <button
                type="button"
                title={t("itops.floorPlan.rotateTitle")}
                aria-label={t("itops.floorPlan.rotateTitle")}
                onClick={(event) => {
                  event.stopPropagation();
                  onRotate();
                }}
              >
                <ItIcon name="rerun" size={11} />
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                className="danger"
                title={t("itops.racks.deleteTitle")}
                aria-label={t("itops.racks.deleteTitle")}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
              >
                <ItIcon name="xmark" size={11} />
              </button>
            ) : null}
          </span>
        </span>
      ) : null}
    </div>
  );
}

function IsoObject({
  object,
  rect,
  anchor,
  arms,
  facing,
  drag,
  editMode,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onSelect,
  onRotate,
  onCorner,
  onRaise,
  onLower,
  onDelete,
}: {
  object: RoomObject;
  /** Display footprint rectangle, already view-rotated. */
  rect: CellRect;
  /** Display point where the sprite touches the surface, already view-rotated. */
  anchor: { x: number; y: number };
  /** Wall only: resolved auto-connect arms toward adjacent wall cells. */
  arms?: WallArms;
  /** Object facing after applying the current room view angle. */
  facing: Facing;
  drag: DragState | null;
  editMode: boolean;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSelect: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onRotate: () => void;
  /** Quarter-block fixtures only: walk to the next cell corner. */
  onCorner?: () => void;
  onRaise: () => void;
  onLower: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const spec = objectSpec(object.kind);
  const w = rect.w * CELL;
  const d = rect.d * CELL;
  const left = rect.x * CELL;
  const top = rect.y * CELL;
  const h = Math.max(3, zPx(spec.heightU));
  const bottom = zPx(Math.min(object.z, ROOM_CEILING_U));
  const name = t(`itops.floorPlan.object.${object.kind}`);

  return (
    <div
      className={`rm-iso-obj${drag ? " dragging" : ""}${editMode ? " editing" : ""}${selected ? " selected" : ""}${object.z === 0 ? " grounded" : ""}`}
      data-kind={object.kind}
      style={
        {
          left,
          top,
          width: w,
          height: d,
          transform: drag ? `translate3d(${drag.u}px, ${drag.v}px, 0)` : undefined,
          "--obj": OBJECT_ACCENTS[object.kind],
          "--tile": OBJECT_ACCENTS[object.kind],
        } as React.CSSProperties
      }
      title={`${name} — ${t("itops.floorPlan.objectLevel", { z: object.z })}`}
      onPointerDown={editMode ? onPointerDown : undefined}
      onPointerMove={editMode ? onPointerMove : undefined}
      onPointerUp={editMode ? onPointerUp : undefined}
      onPointerCancel={editMode ? onPointerCancel : undefined}
      onClick={editMode ? onSelect : undefined}
    >
      <span
        className="rm-iso-obj-model"
        data-kind={object.kind}
        style={{
          left: (anchor.x - rect.x) * CELL,
          top: (anchor.y - rect.y) * CELL,
          transform: surfaceModel(bottom, "-50%, -100%"),
        }}
      >
        <RoomObjectIsoArtwork kind={object.kind} facing={facing} arms={arms} />
        {object.kind !== "kuaikuai" &&
        object.kind !== "wall" &&
        object.kind !== "fireExtinguisher" ? (
          <BlackoutDeviceArc seed={object.id} liftPx={h} />
        ) : null}
      </span>
      {editMode && selected ? (
        <span
          className="rm-iso-ctl-wrap"
          style={{ transform: billboard(bottom + h + 5, "-50%, -240%") }}
        >
          <span className="rm-iso-ctl">
            <button
              type="button"
              title={t("itops.floorPlan.rotateTitle")}
              aria-label={t("itops.floorPlan.rotateTitle")}
              onClick={(event) => {
                event.stopPropagation();
                onRotate();
              }}
            >
              <ItIcon name="rerun" size={11} />
            </button>
            {onCorner ? (
              <button
                type="button"
                title={t("itops.floorPlan.cornerTitle")}
                aria-label={t("itops.floorPlan.cornerTitle")}
                onClick={(event) => {
                  event.stopPropagation();
                  onCorner();
                }}
              >
                <ItIcon name="grid" size={11} />
              </button>
            ) : null}
            <button
              type="button"
              title={t("itops.floorPlan.raiseTitle")}
              aria-label={t("itops.floorPlan.raiseTitle")}
              onClick={(event) => {
                event.stopPropagation();
                onRaise();
              }}
            >
              <span className="rm-flip">
                <ItIcon name="chevD" size={11} />
              </span>
            </button>
            <button
              type="button"
              title={t("itops.floorPlan.lowerTitle")}
              aria-label={t("itops.floorPlan.lowerTitle")}
              onClick={(event) => {
                event.stopPropagation();
                onLower();
              }}
            >
              <ItIcon name="chevD" size={11} />
            </button>
            {onDelete ? (
              <button
                type="button"
                className="danger"
                title={t("itops.floorPlan.deleteObjectTitle")}
                aria-label={t("itops.floorPlan.deleteObjectTitle")}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
              >
                <ItIcon name="xmark" size={11} />
              </button>
            ) : null}
          </span>
        </span>
      ) : null}
    </div>
  );
}
