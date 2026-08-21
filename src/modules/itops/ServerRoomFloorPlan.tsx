// Top-down Server Room View (docs/SITE.md Server Room View). A blueprint-style
// floor plan on the same grid the 2.5D view renders: each Rack is a footprint
// standing on a floor cell (shared "grid" placement, so arranging the room
// here rearranges the 2.5D room too), with compact always-on status tags
// instead of a metric toggle, a facing edge showing which way the front
// points, and non-rack room objects (roomObjects.ts) drawn at their cells.
// Edit mode drags footprints between cells (swapping on collision), rotates
// facings, and places/stacks/deletes room objects; the object picker column
// (owned by SitesTab, shared with the 2.5D view) arms a rack or object kind
// and two clicks choose its position and facing.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Rack } from "../../types";
import {
  facingFromPoint,
  moveIsoRack,
  rackDepthFrac,
  rackFootprint,
  rackTopCornerPoint,
  resolveIsoLayout,
  sanitizeFacing,
  type Corner,
  type Facing,
  type IsoCell,
} from "./roomIsoLayout";
import {
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
import {
  loadRoomZoom,
  saveRoomZoom,
  stepRoomZoom,
  type FreePlacementMap,
  type RackFacingMap,
} from "./siteTreeState";
import { rackFloorMetrics } from "./roomFloorPlan";
import { centerRoomViewport, roomPanFrame, roomScrollCenter } from "./roomViewport";
import { ItIcon } from "./icons";
import { RoomObjectPlanArtwork } from "./RoomObjectArtwork";
import { isRackTopItem } from "./rackPlacement";
import {
  OBJECT_ACCENTS,
  RackTagChips,
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

// Base floor cell size in px; rack footprints span the full cell along their
// side-to-side axis so adjacent cabinets in a row touch like real racks. The
// grid always covers the scroll viewport: cells are appended (and every cell
// stretches a few px) until the room fills the window, and when a large room
// cannot fit, cells shrink no further than BP_MIN_CELL and the plan scrolls.
const BP_CELL = 76;
const BP_MIN_CELL = 56;
// Px eaten by the room's wall border (2.5px per side, content-box sizing).
const BP_WALL = 5;

interface DragState {
  kind: "rack" | "object";
  id: string;
  /** Live drag offset in px. */
  dx: number;
  dy: number;
  target: IsoCell;
}

type PendingFacingPlacement =
  | { kind: "rack"; cell: IsoCell; facing: Facing }
  | { kind: "object"; cell: IsoCell; corner: Corner; facing: Facing };

export function ServerRoomFloorPlan({
  racks,
  editMode,
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
  onObjectBlocked,
  onCancelPlacement,
}: {
  racks: Rack[];
  editMode?: boolean;
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
  /** A placement click or drag found no available space in the cell. */
  onObjectBlocked?: () => void;
  /** Right-click while a picker card is armed disarms it. */
  onCancelPlacement?: () => void;
}) {
  const { t } = useTranslation();
  const layout = resolveIsoLayout(
    racks,
    placement,
    objects.filter((object) => object.kind === "wall"),
  );
  const [scrollRef, viewport] = useRoomViewportSize();
  // Zoom scales the rendered plan; the fill math below works in unzoomed
  // (logical) px, so zooming out shows more floor cells in the same window.
  const [zoom, setZoom] = useState(() => loadRoomZoom("floor"));
  useEffect(() => saveRoomZoom("floor", zoom), [zoom]);
  useWheelZoom(scrollRef, (dir) => setZoom((current) => stepRoomZoom(current, dir)));
  // Grid dimensions cover the racks, every placed object, and the visible
  // viewport; cell sizes stretch so the walls land on the viewport edge.
  const floorW = viewport ? Math.max(0, viewport.w / zoom - BP_WALL) : 0;
  const floorH = viewport ? Math.max(0, viewport.h / zoom - BP_WALL) : 0;
  const cols = Math.max(
    layout.cols,
    Math.floor(floorW / BP_CELL),
    ...objects.map((object) => object.x + objectCellSpan(object.kind, object.rot).w),
  );
  const rows = Math.max(
    layout.rows,
    Math.floor(floorH / BP_CELL),
    ...objects.map((object) => object.y + objectCellSpan(object.kind, object.rot).h),
  );
  const cellW = floorW > 0 ? Math.max(BP_MIN_CELL, floorW / cols) : BP_CELL;
  const cellH = floorH > 0 ? Math.max(BP_MIN_CELL, floorH / rows) : BP_CELL;
  const sceneW = (cols * cellW + BP_WALL) * zoom;
  const sceneH = (rows * cellH + BP_WALL) * zoom;
  const panFrame = roomPanFrame(
    viewport ?? { w: sceneW, h: sceneH },
    { w: sceneW, h: sceneH },
    false,
  );
  const panCenter = roomScrollCenter(
    viewport ?? { w: sceneW, h: sceneH },
    { w: panFrame.w, h: panFrame.h },
  );
  useRoomPan(scrollRef, panCenter, viewport);
  const grid = { cols, rows, cells: layout.cells };
  const armed =
    tool != null || placeRackId != null || cloneRack != null || cloneObject != null;
  // Cursor-tracked placement preview: the armed object ghost snaps to the
  // hovered cell (and, for quarter-block fixtures, the cell quadrant under
  // the pointer) so the grid shows the drop before the click commits.
  const [hover, setHover] = useState<(IsoCell & { corner: Corner }) | null>(null);
  const [pendingFacing, setPendingFacing] = useState<PendingFacingPlacement | null>(null);
  const [rackHover, setRackHover] = useState<{
    rackId: string;
    pointer: { x: number; y: number };
  } | null>(null);
  const placing = !!editMode && armed;
  const cancelArmedPlacement = () => {
    setHover(null);
    setPendingFacing(null);
    onCancelPlacement?.();
  };
  const placementPointer = useRoomPlacementPointer(placing, cancelArmedPlacement, scrollRef);
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
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<{
    kind: "rack" | "object";
    id: string;
    startX: number;
    startY: number;
    origin: IsoCell;
    target: IsoCell;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const clampCell = (cell: IsoCell): IsoCell => ({
    x: Math.min(cols - 1, Math.max(0, Math.round(cell.x))),
    y: Math.min(rows - 1, Math.max(0, Math.round(cell.y))),
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
    const target = event.target as HTMLElement;
    if (target.closest(".rm-bp-ctl")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { kind, id, startX: event.clientX, startY: event.clientY, origin, target: origin, moved: false };
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragRef.current;
    if (!state) return;
    // Logical (unzoomed) px: the dragged element renders inside the scaled
    // plan, so the translate offset scales back up to match the pointer.
    const dx = (event.clientX - state.startX) / zoom;
    const dy = (event.clientY - state.startY) / zoom;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) state.moved = true;
    if (!state.moved) return;
    state.target = clampCell({
      x: state.origin.x + dx / cellW,
      y: state.origin.y + dy / cellH,
    });
    setDrag({ kind: state.kind, id: state.id, dx, dy, target: state.target });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragRef.current;
    if (state) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (state.moved) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
        if (state.kind === "rack") {
          if (wallOccupiesCell(state.target, objects)) onObjectBlocked?.();
          else onPlacementChange?.(moveIsoRack(grid, state.id, state.target));
        } else {
          dropObject(state.id, state.target);
        }
      }
    }
    dragRef.current = null;
    setDrag(null);
  }

  // Move an object to a cell, re-resolving its vertical position; if the cell
  // is vertically full the move is rejected and the object stays put.
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

  // Pointer position → continuous floor coordinates on the plan surface.
  function pointFromEvent(event: React.MouseEvent<HTMLDivElement>): { x: number; y: number } {
    const surface = event.currentTarget;
    // The rect is the zoomed border box; clientLeft/Top are unzoomed CSS px.
    const rect = surface.getBoundingClientRect();
    // Children (and the grid background) sit inside the wall border.
    return {
      x: ((event.clientX - rect.left) / zoom - surface.clientLeft) / cellW,
      y: ((event.clientY - rect.top) / zoom - surface.clientTop) / cellH,
    };
  }

  function cellFromEvent(event: React.MouseEvent<HTMLDivElement>): IsoCell {
    const point = pointFromEvent(event);
    return clampCell({ x: Math.floor(point.x), y: Math.floor(point.y) });
  }

  // The cell quadrant under the pointer, anchoring a quarter-block fixture.
  function cornerFromEvent(event: React.MouseEvent<HTMLDivElement>, cell: IsoCell): Corner {
    const point = pointFromEvent(event);
    const qx = point.x - cell.x >= 0.5 ? 1 : 0;
    const qy = point.y - cell.y >= 0.5 ? 1 : 0;
    // Clockwise numbering: 0 = NW, 1 = NE, 2 = SE, 3 = SW.
    return qy === 0 ? (qx as Corner) : ((3 - qx) as Corner);
  }

  function trackPlacement(event: ReactPointerEvent<HTMLDivElement>) {
    if (pendingFacing) {
      const nextFacing = facingForPending(event, pendingFacing);
      setPendingFacing((current) => current ? { ...current, facing: nextFacing } : current);
      return;
    }
    const cell = cellFromEvent(event);
    const corner =
      tool != null && objectSpec(tool).quarter ? cornerFromEvent(event, cell) : (0 as Corner);
    setHover((prev) =>
      prev && prev.x === cell.x && prev.y === cell.y && prev.corner === corner
        ? prev
        : { ...cell, corner },
    );
  }

  function cancelPlacement(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    cancelArmedPlacement();
  }

  function facingForPending(
    event: React.MouseEvent<HTMLDivElement>,
    pending: PendingFacingPlacement,
  ): Facing {
    const center = pending.kind === "rack"
      ? (() => {
          const rack = racks.find((entry) => entry.id === placeRackId);
          const fp = rackFootprint(pending.facing, rackDepthFrac(rack?.depthMm ?? 1000));
          return { x: pending.cell.x + fp.x + fp.w / 2, y: pending.cell.y + fp.y + fp.d / 2 };
        })()
      : (() => {
          if (tool == null) return { x: pending.cell.x + 0.5, y: pending.cell.y + 0.5 };
          const anchor = objectSurfaceAnchor(tool, pending.facing, pending.corner);
          return { x: pending.cell.x + anchor.x, y: pending.cell.y + anchor.y };
        })();
    return facingFromPoint(pointFromEvent(event), center);
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

  // An armed picker card places on any cell click: objects land on racks too
  // (that is how a 乖乖 pack lands on top of a cabinet), and a pending rack
  // moves to the clicked cell (swapping with another Rack, but never a Wall).
  function placeAt(event: React.MouseEvent<HTMLDivElement>) {
    if (!editMode || !armed) return;
    const cell = cellFromEvent(event);
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
        cell.x + span.w > cols ||
        cell.y + span.h > rows ||
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
      return;
    }
    if (placeRackId != null) {
      if (pendingFacing?.kind === "rack") {
        const nextFacing = facingForPending(event, pendingFacing);
        if (layout.cells[placeRackId]) {
          setPendingFacing(null);
          setHover(null);
          onPlacementChange?.(moveIsoRack(grid, placeRackId, pendingFacing.cell));
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
      return;
    }
    if (tool == null || !onObjectsChange) return;
    if (pendingFacing?.kind === "object") {
      const nextFacing = facingForPending(event, pendingFacing);
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
    const corner = objectSpec(tool).quarter ? cornerFromEvent(event, cell) : (0 as Corner);
    if (resolveObjectPlacement(cell, corner, 0).z == null) {
      onObjectBlocked?.();
      return;
    }
    setPendingFacing({ kind: "object", cell, corner, facing: 0 });
    setHover({ ...cell, corner });
  }

  function selectRack(rack: Rack, event: React.MouseEvent<HTMLButtonElement>) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (editMode && event.shiftKey && onCloneRack) {
      event.stopPropagation();
      onCloneRack(rack);
      return;
    }
    if (!armed) onSelectRack(rack.id);
  }

  function selectObject(object: RoomObject, event: React.MouseEvent<HTMLDivElement>) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (editMode && event.shiftKey && onCloneObject) {
      event.stopPropagation();
      onCloneObject(object);
    }
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

  return (
    <div className="rm-bp-wrap">
      <div className="rm-view-body">
        {/* tabIndex: clicking the room focuses the viewport so arrow keys pan. */}
        <div className="rm-bp-scroll" ref={scrollRef} tabIndex={0}>
          <div
            className="rm-bp-zoom"
            style={{
              width: panFrame.w,
              height: panFrame.h,
            }}
          >
            <div
              className={`rm-bp${placing ? " placing" : ""}`}
              style={{
                width: cols * cellW,
                height: rows * cellH,
                left: panFrame.sceneLeft,
                top: panFrame.sceneTop,
                transform: zoom !== 1 ? `scale(${zoom})` : undefined,
                backgroundSize: `${cellW}px ${cellH}px, ${cellW}px ${cellH}px, ${cellW / 4}px ${cellH / 4}px, ${cellW / 4}px ${cellH / 4}px, auto`,
              }}
              onClick={placeAt}
              onPointerMove={placing ? trackPlacement : undefined}
              onPointerLeave={placing && !pendingFacing ? () => setHover(null) : undefined}
              onContextMenu={placing ? cancelPlacement : undefined}
            >
              {drag ? (
                <div
                  className={`rm-bp-drop${
                    drag.kind === "rack" && wallOccupiesCell(drag.target, objects)
                      ? " blocked"
                      : ""
                  }`}
                  style={{
                    left: drag.target.x * cellW,
                    top: drag.target.y * cellH,
                    width: cellW,
                    height: cellH,
                  }}
                />
              ) : null}
              {racks.map((rack) => (
                <BlueprintRack
                  key={rack.id}
                  rack={rack}
                  cell={layout.cells[rack.id]}
                  cellW={cellW}
                  cellH={cellH}
                  facing={sanitizeFacing(facing[rack.id])}
                  editMode={!!editMode}
                  drag={drag?.kind === "rack" && drag.id === rack.id ? drag : null}
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
                  onSelect={(event) => selectRack(rack, event)}
                  onRotate={editMode && onFacingChange ? () => rotateRack(rack) : undefined}
                  onDelete={editMode && onDeleteRack ? () => onDeleteRack(rack) : undefined}
                />
              ))}
              {objects.map((object) => (
                <BlueprintObject
                  key={object.id}
                  object={object}
                  arms={object.kind === "wall" ? wallArms(object, objects) : undefined}
                  cellW={cellW}
                  cellH={cellH}
                  editMode={!!editMode}
                  drag={drag?.kind === "object" && drag.id === object.id ? drag : null}
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
                      ? () => onObjectsChange(objects.filter((entry) => entry.id !== object.id))
                      : undefined
                  }
                />
              ))}
              {placing && (pendingFacing ?? hover)
                ? (() => {
                    const preview = pendingFacing ?? {
                      kind: tool != null || cloneObject != null ? "object" as const : "rack" as const,
                      cell: hover!,
                      corner: cloneObject?.corner ?? hover!.corner,
                      facing: cloneObject?.rot ?? cloneRackFacing,
                    };
                    const previewCorner = preview.kind === "object" ? preview.corner : (0 as Corner);
                    const previewFacing = preview.facing;
                    const previewObjectKind = cloneObject?.kind ?? tool;
                    const spec = previewObjectKind != null ? objectSpec(previewObjectKind) : null;
                    const blocked = cloneRack != null
                      ? !roomCellIsBlank(preview.cell, layout.cells, objects)
                      : cloneObject != null
                        ? !roomObjectPlacementIsBlank(
                            preview.cell,
                            cloneObject.kind,
                            cloneObject.rot,
                            layout.cells,
                            objects,
                          )
                        : placeRackId != null
                          ? wallOccupiesCell(preview.cell, objects)
                          : tool != null && resolveObjectPlacement(
                          preview.cell,
                          previewCorner,
                          previewFacing,
                        ).z == null;
                    const pendingRack =
                      cloneRack ?? racks.find((entry) => entry.id === placeRackId);
                    const fp = previewObjectKind != null
                      ? objectFootprint(previewObjectKind, previewFacing, previewCorner)
                      : rackFootprint(
                          previewFacing,
                          rackDepthFrac(pendingRack?.depthMm ?? 1000),
                        );
                    const slot = {
                      left: (preview.cell.x + fp.x) * cellW,
                      top: (preview.cell.y + fp.y) * cellH,
                      width: fp.w * cellW,
                      height: fp.d * cellH,
                    };
                    return (
                      <div
                        className={`rm-bp-ghost${blocked ? " blocked" : ""}`}
                        style={
                          {
                            ...slot,
                            "--obj":
                              previewObjectKind != null
                                ? OBJECT_ACCENTS[previewObjectKind]
                                : undefined,
                          } as React.CSSProperties
                        }
                      >
                        {previewObjectKind != null && spec ? (
                          <span
                            className="rm-bp-ghost-item"
                            style={{
                              width: Math.round(spec.wide * cellW),
                              height: Math.round(spec.deep * cellH),
                              transform: `rotate(${previewFacing * 90}deg)`,
                            }}
                          >
                            <RoomObjectPlanArtwork kind={previewObjectKind} />
                          </span>
                        ) : (
                          <span
                            className="rm-bp-ghost-rack"
                            style={{
                              width: "100%",
                              height: "100%",
                            }}
                          />
                        )}
                        {pendingFacing && cloneRack == null && cloneObject == null ? (
                          <RoomPlacementFacingArrow facing={previewFacing} />
                        ) : null}
                      </div>
                    );
                  })()
                : null}
            </div>
          </div>
          <RoomRackHoverCard
            rack={!editMode && rackHover
              ? racks.find((rack) => rack.id === rackHover.rackId) ?? null
              : null}
            pointer={!editMode ? rackHover?.pointer ?? null : null}
            boundaryRef={scrollRef}
          />
        </div>
        <RoomZoomRuler
          zoom={zoom}
          onZoomChange={setZoom}
          onResetCenter={() => centerRoomViewport(scrollRef)}
        />
      </div>
      {editMode ? <div className="rm-iso-hint">{t("itops.floorPlan.blueprintEditHint")}</div> : null}
      <RoomPlacementCursorGhost
        pointer={placementPointer}
        tool={cloneObject?.kind ?? tool}
        rackArmed={placeRackId != null || cloneRack != null}
        variant="floor"
        snapped={pendingFacing != null || hover != null}
      />
    </div>
  );
}

function BlueprintRack({
  rack,
  cell,
  cellW,
  cellH,
  facing,
  editMode,
  drag,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onInfoHover,
  onInfoLeave,
  onSelect,
  onRotate,
  onDelete,
}: {
  rack: Rack;
  cell: IsoCell;
  cellW: number;
  cellH: number;
  facing: Facing;
  editMode: boolean;
  drag: DragState | null;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onInfoHover: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onInfoLeave: () => void;
  onSelect: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onRotate?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const m = rackFloorMetrics(rack);
  // Side axis spans the full cell; the depth axis tracks the cabinet's
  // physical depth, front face flush on the borderline the facing points at.
  const fp = rackFootprint(facing, rackDepthFrac(rack.depthMm));
  const w = fp.w * cellW;
  const h = fp.d * cellH;
  const left = (cell.x + fp.x) * cellW;
  const top = (cell.y + fp.y) * cellH;
  const front = (["s", "w", "n", "e"] as const)[facing];
  const topKuaiguai = rack.items.find((item) => isRackTopItem(item, rack.heightU));
  const topKuaiguaiPoint = rackTopCornerPoint(topKuaiguai?.metadata?.rackTopCorner);

  return (
    <div
      className={`rm-bp-rack${drag ? " dragging" : ""}${editMode ? " editing" : ""}`}
      data-shell={rack.shell && rack.shell !== "black" ? rack.shell : undefined}
      data-front={front}
      style={{
        left,
        top,
        width: w,
        height: h,
        transform: drag ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
      }}
      onPointerDown={editMode ? onPointerDown : undefined}
      onPointerMove={editMode ? onPointerMove : undefined}
      onPointerUp={editMode ? onPointerUp : undefined}
      onPointerCancel={editMode ? onPointerCancel : undefined}
      onPointerEnter={!editMode ? onInfoHover : undefined}
      onPointerLeave={!editMode ? onInfoLeave : undefined}
    >
      <button
        type="button"
        className="rm-bp-rack-body"
        title={t("itops.floorPlan.tileTitle", {
          name: rack.name,
          detail: t(`itops.floorPlan.health.${m.health}`),
        })}
        onClick={onSelect}
      >
        <span className="rm-bp-rack-name">{rack.name}</span>
        {topKuaiguai ? (
          <span
            className="rm-bp-top-kuaiguai"
            style={
              {
                left: `${topKuaiguaiPoint.x * 100}%`,
                top: `${topKuaiguaiPoint.y * 100}%`,
                transform: `translate(-50%, -50%) rotate(${sanitizeFacing(topKuaiguai.metadata?.rackTopFacing) * 90}deg)`,
                "--obj": OBJECT_ACCENTS.kuaikuai,
              } as React.CSSProperties
            }
          >
            <RoomObjectPlanArtwork kind="kuaikuai" />
          </span>
        ) : null}
        <RackTagChips rack={rack} />
      </button>
      {editMode && (onRotate || onDelete) ? (
        <span className="rm-bp-ctl">
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
      ) : null}
    </div>
  );
}

function BlueprintObject({
  object,
  arms,
  cellW,
  cellH,
  editMode,
  drag,
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
  /** Wall only: resolved auto-connect arms toward adjacent wall cells. */
  arms?: WallArms;
  cellW: number;
  cellH: number;
  editMode: boolean;
  drag: DragState | null;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSelect: (event: React.MouseEvent<HTMLDivElement>) => void;
  onRotate: () => void;
  /** Quarter-block fixtures only: walk to the next cell corner. */
  onCorner?: () => void;
  onRaise: () => void;
  onLower: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  // A wall's arms already point at its joined neighbours in grid space, so
  // its glyph covers the whole cell unrotated; other kinds keep their exact
  // footprint box with the artwork turned to the stored rotation.
  const isWall = object.kind === "wall";
  const fp = isWall
    ? { x: 0, y: 0, w: 1, d: 1 }
    : objectFootprint(object.kind, object.rot, object.corner);
  const w = fp.w * cellW;
  const h = fp.d * cellH;
  const left = (object.x + fp.x) * cellW;
  const top = (object.y + fp.y) * cellH;
  const name = t(`itops.floorPlan.object.${object.kind}`);

  return (
    <div
      className={`rm-bp-obj${drag ? " dragging" : ""}${editMode ? " editing" : ""}`}
      data-kind={object.kind}
      style={
        {
          left,
          top,
          width: w,
          height: h,
          transform: drag ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
          "--obj": OBJECT_ACCENTS[object.kind],
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
        className="rm-bp-obj-glyph"
        style={isWall ? undefined : { transform: `rotate(${object.rot * 90}deg)` }}
      >
        <RoomObjectPlanArtwork kind={object.kind} arms={arms} />
      </span>
      {editMode ? (
        <span className="rm-bp-ctl">
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
      ) : null}
    </div>
  );
}
