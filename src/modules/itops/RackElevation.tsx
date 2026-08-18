// Rack elevation (docs/SITE.md Rack View). Renders one mounting face as a
// skeuomorphic metal frame — rail caps, a U-number gutter, and a slatted device
// column — with each Rack Device drawn as an animated <RackDevice> faceplate at
// its U position (ported from the "IT Ops Racks" design comp). With callbacks
// wired it is the editor: devices are added through the picker column's armed
// placement flow; a device with bound Connections opens the connect popover on
// click with a pencil to edit; items without bindings open the edit dialog on
// click.
// A Connection-backed item whose Connection is gone renders as a dimmed
// "ghost". Items are drag-to-restacked onto any U slot (possibly across racks).

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { isImeComposingEvent, isImeEditableTarget } from "../../lib/ime";
import type { Rack, RackItem, RackItemStatus, RackMountFace } from "../../types";
import { ItIcon } from "./icons";
import { collectBoundConnectionIds, summarizeRackDeviceMetadata } from "./rackInventory";
import { RackDevice } from "./RackDevice";
import type { RackItemDraft } from "./RackItemDialog";
import {
  isRackTopItem,
  rackItemsCollide,
  rackItemXSpan,
  snapPlacementSlot,
  snapRackPlacement,
  widthFractionQuarters,
  type RackPlacementSnap,
} from "./rackPlacement";

// Pixel height of one rack unit (U) row. Kept in sync with `--rk-u` in CSS.
export const U_PX = 26;

function itemStatus(item: RackItem): RackItemStatus {
  return item.metadata?.status ?? "online";
}

// Grid row for the top edge of an item: rows run top-down (row 1 = highest U),
// so an item's top U maps to `heightU - topU + 1`.
function itemRowStart(rackHeightU: number, item: RackItem): number {
  const topU = item.startU + item.heightU - 1;
  return rackHeightU - topU + 1;
}

export function RackElevation({
  rack,
  hostFor,
  onOpenItem,
  onEditItem,
  onBindItem,
  onEditRack,
  onDeleteRack,
  onRunRack,
  onMoveItem,
  onDeleteItem,
  isGhost,
  detailed,
  unitPx = U_PX,
  hideHeader = false,
  editMode = false,
  reserveTopU = 0,
  showRackTop = true,
  placeSpec,
  onPlaceAt,
  onCancelPlacement,
  face = "front",
  onToggleFace,
}: {
  rack: Rack;
  /** Resolve a placed Connection's host/ip for the faceplate sub-line. */
  hostFor?: (item: RackItem) => string | null;
  /** Open the connect popover for a device with bound Connections; the anchor
   *  is the clicked faceplate element. */
  onOpenItem?: (item: RackItem, anchor: HTMLElement) => void;
  onEditItem?: (item: RackItem) => void;
  onBindItem?: (item: RackItem) => void;
  onEditRack?: (rack: Rack) => void;
  onDeleteRack?: (rack: Rack) => void;
  onRunRack?: (rack: Rack) => void;
  /** Drag-drop a device onto a U slot (move/restack, possibly across racks).
   *  `xFraction` is the drop's horizontal position across the bay (0–1) so a
   *  fractional-width device can land on a left/right slot. */
  onMoveItem?: (
    itemId: string,
    targetRackId: string,
    startU: number,
    xFraction?: number,
    mountFace?: RackMountFace,
  ) => void;
  onDeleteItem?: (item: RackItem) => void;
  isGhost?: (item: RackItem) => boolean;
  /** Single-rack detail view: wider cabinet + a placed-device summary list. */
  detailed?: boolean;
  /** Rack View may shrink one U to fit the visible drill viewport. */
  unitPx?: number;
  /** Rack View moves this identity/spec line into the drill toolbar. */
  hideHeader?: boolean;
  editMode?: boolean;
  /** Always keep at least this much headroom (in U) above the cabinet so a
   *  rack-top 乖乖 has room and the rack doesn't shift when one is placed. */
  reserveTopU?: number;
  /** Rack-top equipment belongs to the cabinet, not either mounting face. */
  showRackTop?: boolean;
  /** Armed picker placement: the configured device ghosts under the cursor,
   *  snapped to the hovered U slot, and a slot click places it there. */
  placeSpec?: RackItemDraft | null;
  onPlaceAt?: (startU: number, slot?: number) => void;
  /** Right-click while placing disarms (mirrors the room-view pickers). */
  onCancelPlacement?: () => void;
  /** Cabinet mounting plane currently presented by this elevation. */
  face?: RackMountFace;
  /** Optional per-rack face switch shown at the cabinet's top-right corner. */
  onToggleFace?: () => void;
}) {
  const { t } = useTranslation();
  const renderedFaceRef = useRef<RackMountFace>(face);
  const [displayFace, setDisplayFace] = useState<RackMountFace>(face);
  const [turning, setTurning] = useState(false);
  useEffect(() => {
    if (face === renderedFaceRef.current) {
      setDisplayFace(face);
      setTurning(false);
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      renderedFaceRef.current = face;
      setDisplayFace(face);
      setTurning(false);
      return;
    }
    setTurning(true);
    const swap = window.setTimeout(() => {
      renderedFaceRef.current = face;
      setDisplayFace(face);
    }, 180);
    const finish = window.setTimeout(() => setTurning(false), 380);
    return () => {
      window.clearTimeout(swap);
      window.clearTimeout(finish);
    };
  }, [face]);
  const editable = !!onEditItem;
  const canMove = editMode && !!onMoveItem;
  const placing =
    editMode &&
    !!placeSpec &&
    !!onPlaceAt &&
    (placeSpec.kind === "kuaiguai" || placeSpec.mountFace === displayFace);
  const rackRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const rackElement = rackRef.current;
    if (!rackElement) return;
    const handleContentVisibilityChange = (event: Event) => {
      rackElement.dataset.contentSkipped = String(
        (event as ContentVisibilityAutoStateChangeEvent).skipped,
      );
    };
    rackElement.addEventListener(
      "contentvisibilityautostatechange",
      handleContentVisibilityChange,
    );
    return () => {
      rackElement.removeEventListener(
        "contentvisibilityautostatechange",
        handleContentVisibilityChange,
      );
      delete rackElement.dataset.contentSkipped;
    };
  }, []);
  const pointerRef = useRef<{
    draft: RackItemDraft;
    x: number;
    y: number;
    width: number;
    snap: RackPlacementSnap | null;
  } | null>(null);
  const [pointerGhost, setPointerGhost] = useState(pointerRef.current);

  // Snap the armed device's span to a hovered U: the hovered unit is the
  // bottom-most U, clamped so the span stays inside the rack. `slot` is the
  // horizontal slot for a fractional-width device (0 for full width).
  function snapPlacement(
    u: number,
    slot = 0,
  ): { startU: number; blocked: boolean; slot: number } {
    const heightU = Math.max(1, Math.min(placeSpec?.heightU ?? 1, rack.heightU));
    const startU = Math.max(1, Math.min(u, rack.heightU - heightU + 1));
    const xQuarters = widthFractionQuarters(placeSpec?.metadata?.widthFraction);
    const placeSpan = { startU, heightU, xStart: slot * xQuarters, xQuarters };
    const blocked = rack.items.some((item) =>
      (item.mountFace ?? "front") === displayFace &&
      rackItemsCollide(placeSpan, {
        startU: item.startU,
        heightU: item.heightU,
        ...rackItemXSpan(item.metadata),
      }),
    );
    return { startU, blocked, slot };
  }
  useEffect(() => {
    if (!placing || !placeSpec || !onPlaceAt) return;

    const updatePointer = (event: PointerEvent) => {
      const rackElement = rackRef.current;
      const slot = rackElement?.querySelector(".rk-slot") as HTMLElement | null;
      const grid = rackElement?.querySelector(".rk-grid") as HTMLElement | null;
      const slotRect = slot?.getBoundingClientRect();
      const gridRect = grid?.getBoundingClientRect();
      if (!slotRect || !gridRect) return;
      const bayRect = {
        left: slotRect.left,
        right: slotRect.right,
        top: gridRect.top,
        bottom: gridRect.bottom,
        width: slotRect.width,
        height: gridRect.height,
      };
      const snap = snapRackPlacement({
        x: event.clientX,
        y: event.clientY,
        bayRect,
        rackHeightU: rack.heightU,
        placeHeightU: placeSpec.heightU,
        placeWidthFraction: placeSpec.metadata?.widthFraction,
        items: rack.items.filter(
          (item) =>
            isRackTopItem(item, rack.heightU) ||
            (item.mountFace ?? "front") === displayFace,
        ),
        allowTop: placeSpec.kind === "kuaiguai",
      });
      const next = {
        draft: placeSpec,
        x: event.clientX,
        y: event.clientY,
        width: bayRect.width,
        snap,
      };
      pointerRef.current = next;
      setPointerGhost(next);
    };
    const placeFromPointer = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const snap = pointerRef.current?.snap;
      if (!snap) return;
      event.preventDefault();
      event.stopPropagation();
      if (!snap.blocked) onPlaceAt(snap.startU, snap.slot);
    };
    const cancelFromContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      pointerRef.current = null;
      setPointerGhost(null);
      onCancelPlacement?.();
    };
    const cancelFromKeyboard = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        (isImeEditableTarget(event.target) && isImeComposingEvent(event))
      ) return;
      event.preventDefault();
      pointerRef.current = null;
      setPointerGhost(null);
      onCancelPlacement?.();
    };

    document.addEventListener("pointermove", updatePointer, true);
    document.addEventListener("pointerdown", placeFromPointer, true);
    document.addEventListener("contextmenu", cancelFromContextMenu, true);
    document.addEventListener("keydown", cancelFromKeyboard, true);
    return () => {
      document.removeEventListener("pointermove", updatePointer, true);
      document.removeEventListener("pointerdown", placeFromPointer, true);
      document.removeEventListener("contextmenu", cancelFromContextMenu, true);
      document.removeEventListener("keydown", cancelFromKeyboard, true);
      pointerRef.current = null;
    };
  }, [displayFace, onCancelPlacement, onPlaceAt, placeSpec, placing, rack.heightU, rack.items]);

  const activePointer = pointerGhost?.draft === placeSpec ? pointerGhost : null;
  const placeGhost = placing && activePointer?.snap?.zone === "inside" ? activePointer.snap : null;
  const topPlaceGhost = placing && activePointer?.snap?.zone === "top" ? activePointer.snap : null;
  const placeQuarters = widthFractionQuarters(placeSpec?.metadata?.widthFraction);
  // Top-to-bottom U numbers: heightU … 1.
  const unitNumbers = Array.from({ length: rack.heightU }, (_, i) => rack.heightU - i);

  // Status tallies describe the whole cabinet, independent of which mounting
  // face is currently visible. Rack-top packages are not cabinet devices.
  let online = 0;
  let warning = 0;
  let offline = 0;
  const allCabinetItems = rack.items.filter(
    (item) => !isRackTopItem(item, rack.heightU),
  );
  const visibleItems = rack.items.filter(
    (item) =>
      (showRackTop && isRackTopItem(item, rack.heightU)) ||
      (!isRackTopItem(item, rack.heightU) && (item.mountFace ?? "front") === displayFace),
  );
  for (const item of allCabinetItems) {
    const s = itemStatus(item);
    if (s === "warning") warning += 1;
    else if (s === "offline") offline += 1;
    else online += 1;
  }

  // Stagger the slide-in by visual order (top of rack first).
  const order = new Map(
    [...visibleItems]
      .sort((a, b) => b.startU + b.heightU - (a.startU + a.heightU))
      .map((item, index) => [item.id, index] as const),
  );

  const cabShell = rack.shell && rack.shell !== "black" ? rack.shell : undefined;
  const topItems = visibleItems.filter((item) => isRackTopItem(item, rack.heightU));
  const cabinetItems = visibleItems.filter((item) => !isRackTopItem(item, rack.heightU));
  const topClearanceU = Math.max(
    0,
    reserveTopU,
    ...topItems.map((item) => item.heightU),
    placing && placeSpec?.kind === "kuaiguai" ? placeSpec.heightU : 0,
  );
  // Placed devices, top-of-rack first, for the detail summary list.
  const placed = [...visibleItems].sort(
    (a, b) => b.startU + b.heightU - (a.startU + a.heightU),
  );

  return (
    <div
      className={`rk${detailed ? " rk-detailed" : ""}${topClearanceU > 0 ? " has-top-item" : ""}${onToggleFace ? " has-face-toggle" : ""}${turning ? " face-turning" : ""}`}
      data-shell={cabShell}
      data-face={displayFace}
      data-rack-id={rack.id}
      ref={rackRef}
      style={{
        ["--rk-u" as string]: `${unitPx}px`,
        ["--rk-top-clearance" as string]: `${topClearanceU * unitPx}px`,
      }}
    >
      {!hideHeader ? <div className="rk-head">
        <div className="rk-head-txt">
          <span className="rk-name">{rack.name}</span>
          <span className="rk-meta">
            {t("itops.racks.unitCount", { count: rack.heightU })}
            {cabinetItems.length > 0
              ? `  ·  ${t("itops.racks.faceDeviceCount", {
                  face: t(`itops.racks.face.${displayFace}`),
                  count: cabinetItems.length,
                })}`
              : ""}
          </span>
        </div>
        {allCabinetItems.length > 0 ? (
          <div className="rk-pills">
            <span className="rk-pill on" title={t("itops.racks.status.online")}>
              <span className="dot" />
              {online}
            </span>
            {warning > 0 ? (
              <span className="rk-pill warn" title={t("itops.racks.status.warning")}>
                <span className="dot" />
                {warning}
              </span>
            ) : null}
            {offline > 0 ? (
              <span className="rk-pill off" title={t("itops.racks.status.offline")}>
                <span className="dot" />
                {offline}
              </span>
            ) : null}
          </div>
        ) : null}
        {onRunRack ? (
          <button
            type="button"
            className="it-icon-btn sm"
            title={t("itops.racks.runRack")}
            onClick={() => onRunRack(rack)}
          >
            <ItIcon name="run" size={12} />
          </button>
        ) : null}
        {onEditRack ? (
          <button
            type="button"
            className="it-icon-btn sm"
            title={t("itops.racks.editTitle")}
            onClick={() => onEditRack(rack)}
          >
            <ItIcon name="edit" size={13} />
          </button>
        ) : null}
        {onDeleteRack ? (
          <button
            type="button"
            className="it-icon-btn sm danger"
            title={t("itops.racks.deleteTitle")}
            onClick={() => onDeleteRack(rack)}
          >
            <ItIcon name="xmark" size={12} />
          </button>
        ) : null}
      </div> : null}

      <div className="rk-cabinet">
        {onToggleFace ? (
          <button
            type="button"
            className="rk-cabinet-flip"
            title={t("itops.racks.showFace", {
              face: t(`itops.racks.face.${displayFace === "front" ? "rear" : "front"}`),
            })}
            aria-label={t("itops.racks.showFace", {
              face: t(`itops.racks.face.${displayFace === "front" ? "rear" : "front"}`),
            })}
            onClick={onToggleFace}
          >
            <ItIcon name="rerun" size={14} />
          </button>
        ) : null}
        <div
          className={`rk-top-area${canMove ? " drop-target" : ""}`}
          onDragOver={canMove ? (event) => {
            if (event.dataTransfer.types.includes("application/x-itops-rack-kuaiguai")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
          } : undefined}
          onDrop={canMove ? (event) => {
            event.preventDefault();
            if (!event.dataTransfer.getData("application/x-itops-rack-kuaiguai")) return;
            const itemId = event.dataTransfer.getData("application/x-itops-rack-item");
            if (itemId) onMoveItem?.(itemId, rack.id, rack.heightU + 1, undefined, displayFace);
          } : undefined}
        >
          {topItems.map((item) => (
            <div
              className={`rk-top-item${canMove ? " draggable" : ""}`}
              key={item.id}
              style={{ height: item.heightU * unitPx }}
              draggable={canMove}
              onDragStart={canMove ? (event) => {
                event.dataTransfer.setData("application/x-itops-rack-item", item.id);
                event.dataTransfer.setData("application/x-itops-rack-kuaiguai", "true");
                event.dataTransfer.effectAllowed = "move";
              } : undefined}
            >
              <button type="button" className="rk-top-item-main" onClick={() => onEditItem?.(item)}>
                <RackDevice
                  kind={item.kind}
                  label={item.label || t(`itops.racks.kind.${item.kind}`)}
                  status={itemStatus(item)}
                  expiry={item.metadata?.expiry ?? null}
                  rotation={item.metadata?.rotation ?? null}
                  yaw={item.metadata?.yaw ?? null}
                  kuaiguaiSize={item.metadata?.kuaiguaiSize ?? null}
                  kuaiguaiStyle={item.metadata?.kuaiguaiStyle ?? null}
                  face={displayFace}
                  notes={item.metadata?.notes ?? null}
                  formFactor={item.metadata?.formFactor ?? null}
                  serverPanelStyle={item.metadata?.serverPanelStyle ?? null}
                  heightU={item.heightU}
                  seed={item.id}
                />
              </button>
              {editMode && onDeleteItem ? (
                <button
                  type="button"
                  className="rk-top-item-delete"
                  title={t("itops.racks.deleteItemTitle")}
                  aria-label={t("itops.racks.deleteItemTitle")}
                  onClick={() => onDeleteItem(item)}
                >
                  <ItIcon name="xmark" size={11} />
                </button>
              ) : null}
            </div>
          ))}
          {topPlaceGhost && placeSpec ? (
            <div
              className={`rk-top-item rk-place-ghost${topPlaceGhost.blocked ? " blocked" : ""}`}
              style={{ height: placeSpec.heightU * unitPx }}
              aria-hidden="true"
            >
              <RackDevice
                kind={placeSpec.kind}
                label={placeSpec.label || t(`itops.racks.kind.${placeSpec.kind}`)}
                status={placeSpec.metadata?.status ?? "online"}
                expiry={placeSpec.metadata?.expiry ?? null}
                rotation={placeSpec.metadata?.rotation ?? null}
                yaw={placeSpec.metadata?.yaw ?? null}
                kuaiguaiSize={placeSpec.metadata?.kuaiguaiSize ?? null}
                kuaiguaiStyle={placeSpec.metadata?.kuaiguaiStyle ?? null}
                face={displayFace}
                notes={placeSpec.metadata?.notes ?? null}
                formFactor={placeSpec.metadata?.formFactor ?? null}
                serverPanelStyle={placeSpec.metadata?.serverPanelStyle ?? null}
                heightU={placeSpec.heightU}
                seed="place-top-ghost"
              />
            </div>
          ) : null}
        </div>
        <div className="rk-frame">
        <div className="rk-rail" />
        <div className="rk-bay">
          <div
            className={`rk-grid${placing ? " placing" : ""}`}
            style={{ gridTemplateRows: `repeat(${rack.heightU}, var(--rk-u, ${U_PX}px))` }}
            onContextMenu={
              placing
                ? (event) => {
                    event.preventDefault();
                    onCancelPlacement?.();
                  }
                : undefined
            }
          >
            {/* U-number gutter. */}
            {unitNumbers.map((u) => (
              <div className="rk-u" key={`u-${u}`} style={{ gridRow: rack.heightU - u + 1 }}>
                {u}
              </div>
            ))}
            {/* Empty slots — armed-placement targets and drag/drop targets. */}
            {unitNumbers.map((u) =>
              editMode && (placing || canMove) ? (
                <button
                  type="button"
                  className={`rk-slot rk-slot-btn${placing ? "" : " passive"}`}
                  key={`s-${u}`}
                  style={{ gridColumn: 2, gridRow: rack.heightU - u + 1 }}
                  aria-label={t("itops.racks.addAtUnit", { unit: u })}
                  onClick={(event) => {
                    if (!placing) return;
                    const slot = snapPlacementSlot(
                      event.clientX,
                      event.currentTarget.getBoundingClientRect(),
                      placeSpec?.metadata?.widthFraction,
                    );
                    const snap = snapPlacement(u, slot);
                    if (!snap.blocked) onPlaceAt!(snap.startU, snap.slot);
                  }}
                  onDragOver={
                    canMove
                      ? (event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }
                      : undefined
                  }
                  onDrop={
                    canMove
                      ? (event) => {
                          event.preventDefault();
                          const itemId = event.dataTransfer.getData("application/x-itops-rack-item");
                          if (!itemId) return;
                          const rect = event.currentTarget.getBoundingClientRect();
                          const xFraction = Math.max(
                            0,
                            Math.min(0.999, (event.clientX - rect.left) / Math.max(1, rect.width)),
                          );
                          onMoveItem?.(itemId, rack.id, u, xFraction, displayFace);
                        }
                      : undefined
                  }
                />
              ) : (
                <div
                  className="rk-slot"
                  key={`s-${u}`}
                  style={{ gridColumn: 2, gridRow: rack.heightU - u + 1 }}
                />
              ),
            )}
            {/* Items paint over the empty slots they occupy. */}
            {cabinetItems.map((item) => {
              const ghost = item.kind === "connection" && !!isGhost?.(item);
              const text = item.label || t(`itops.racks.kind.${item.kind}`);
              const model = item.metadata?.vendor?.trim() || null;
              // Any device with bound Connections opens the connect popover on
              // click; everything else (unbound, ghost) edits.
              const opens = !ghost && !!onOpenItem && collectBoundConnectionIds(item).length > 0;
              const primary = opens
                ? (anchor: HTMLElement) => onOpenItem!(item, anchor)
                : () => onEditItem?.(item);
              const delay = `${(order.get(item.id) ?? 0) * 0.045}s`;
              // Fractional-width faces occupy a horizontal strip of the bay so
              // several devices (e.g. two modems) can share one U row.
              const xSpan = rackItemXSpan(item.metadata);
              const style: CSSProperties = {
                gridColumn: 2,
                gridRow: `${itemRowStart(rack.heightU, item)} / span ${item.heightU}`,
                animationDelay: delay,
                ...(xSpan.xQuarters < 4
                  ? {
                      width: `${xSpan.xQuarters * 25}%`,
                      marginLeft: `${xSpan.xStart * 25}%`,
                    }
                  : {}),
              };
              const quarterWidth = xSpan.xQuarters === 1;
              const face = (
                <RackDevice
                  kind={item.kind}
                  label={text}
                  subLabel={model ?? hostFor?.(item) ?? null}
                  status={ghost ? "offline" : itemStatus(item)}
                  ports={item.metadata?.ports ?? null}
                  disks={item.metadata?.disks ?? null}
                  battery={item.metadata?.battery ?? null}
                  load={item.metadata?.load ?? null}
                  expiry={item.metadata?.expiry ?? null}
                  rotation={item.metadata?.rotation ?? null}
                  yaw={item.metadata?.yaw ?? null}
                  kuaiguaiSize={item.metadata?.kuaiguaiSize ?? null}
                  kuaiguaiStyle={item.metadata?.kuaiguaiStyle ?? null}
                  face={displayFace}
                  notes={item.metadata?.notes ?? null}
                  formFactor={item.metadata?.formFactor ?? null}
                  serverPanelStyle={item.metadata?.serverPanelStyle ?? null}
                  heightU={item.heightU}
                  accent={item.metadata?.accent ?? null}
                  shell={item.metadata?.shell ?? null}
                  seed={item.id}
                />
              );
              const className = `rk-item dev-in${ghost ? " ghost" : ""}${quarterWidth ? " quarter-width" : ""}`;
              if (!editable) {
                return (
                  <div key={item.id} className={className} style={style} title={text}>
                    {face}
                    {ghost ? (
                      <span className="rk-ghost-badge">{t("itops.racks.ghostBadge")}</span>
                    ) : null}
                  </div>
                );
              }
              return (
                <div
                  key={item.id}
                  className={`${className} rk-item-row${canMove ? " draggable" : ""}${editMode ? " editing" : ""}`}
                  style={style}
                  draggable={canMove}
                  onDragStart={
                    canMove
                      ? (event) => {
                          event.dataTransfer.setData("application/x-itops-rack-item", item.id);
                          if (item.kind === "kuaiguai") {
                            event.dataTransfer.setData("application/x-itops-rack-kuaiguai", "true");
                          }
                          event.dataTransfer.effectAllowed = "move";
                        }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className="rk-item-main"
                    title={opens ? t("itops.racks.openTitle", { name: text }) : text}
                    onClick={(event) => primary(event.currentTarget)}
                  >
                    {face}
                  </button>
                  {ghost ? (
                    <span className="rk-ghost-badge">{t("itops.racks.ghostBadge")}</span>
                  ) : null}
                  {opens ? (
                    <button
                      type="button"
                      className="rk-item-edit"
                      title={t("itops.racks.editItemTitle")}
                      onClick={() => onEditItem?.(item)}
                    >
                      <ItIcon name="edit" size={11} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="rk-item-bind"
                    title={t("itops.racks.bindingsAction")}
                    aria-label={t("itops.racks.bindingsAction")}
                    onClick={(event) => { event.stopPropagation(); onBindItem?.(item); }}
                  >
                    <ItIcon name="link" size={11} />
                  </button>
                  {editMode && onDeleteItem ? (
                    <button
                      type="button"
                      className="rk-item-delete"
                      title={t("itops.racks.deleteItemTitle")}
                      aria-label={t("itops.racks.deleteItemTitle")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteItem(item);
                      }}
                    >
                      <ItIcon name="xmark" size={11} />
                    </button>
                  ) : null}
                </div>
              );
            })}
            {/* Armed placement preview: the configured faceplate tracks the
                hovered slot in realtime; red when the span overlaps a device. */}
            {placing && placeGhost && placeSpec ? (
              <div
                className={`rk-item rk-place-ghost${placeQuarters === 1 ? " quarter-width" : ""}${placeGhost.blocked ? " blocked" : ""}`}
                aria-hidden="true"
                style={{
                  gridColumn: 2,
                  gridRow: `${rack.heightU - (placeGhost.startU + Math.min(placeSpec.heightU, rack.heightU) - 1) + 1} / span ${Math.min(placeSpec.heightU, rack.heightU)}`,
                  ...(placeQuarters < 4
                    ? {
                        width: `${placeQuarters * 25}%`,
                        marginLeft: `${placeGhost.slot * placeQuarters * 25}%`,
                      }
                    : {}),
                }}
              >
                <RackDevice
                  kind={placeSpec.kind}
                  label={placeSpec.label || t(`itops.racks.kind.${placeSpec.kind}`)}
                  subLabel={placeSpec.metadata?.vendor ?? null}
                  status={placeSpec.metadata?.status ?? "online"}
                  ports={placeSpec.metadata?.ports ?? null}
                  disks={placeSpec.metadata?.disks ?? null}
                  battery={placeSpec.metadata?.battery ?? null}
                  load={placeSpec.metadata?.load ?? null}
                  expiry={placeSpec.metadata?.expiry ?? null}
                  rotation={placeSpec.metadata?.rotation ?? null}
                  yaw={placeSpec.metadata?.yaw ?? null}
                  kuaiguaiSize={placeSpec.metadata?.kuaiguaiSize ?? null}
                  kuaiguaiStyle={placeSpec.metadata?.kuaiguaiStyle ?? null}
                  face={displayFace}
                  notes={placeSpec.metadata?.notes ?? null}
                  formFactor={placeSpec.metadata?.formFactor ?? null}
                  serverPanelStyle={placeSpec.metadata?.serverPanelStyle ?? null}
                  heightU={Math.min(placeSpec.heightU, rack.heightU)}
                  accent={placeSpec.metadata?.accent ?? null}
                  shell={placeSpec.metadata?.shell ?? null}
                  seed="place-ghost"
                />
              </div>
            ) : null}
          </div>
        </div>
        <div className="rk-rail" />
        </div>
      </div>
      {detailed ? (
        <div className="rk-detail-list">
          <div className="rk-detail-h">{t("itops.racks.placedDevices")}</div>
          {placed.length === 0 ? (
            <div className="rk-detail-empty">{t("itops.racks.empty")}</div>
          ) : (
            placed.map((item) => {
              const status = itemStatus(item);
              const summary = summarizeRackDeviceMetadata(item.metadata ?? {});
              return (
                <button
                  key={item.id}
                  type="button"
                  className="rk-detail-row"
                  onClick={() => onEditItem?.(item)}
                >
                  <span className={`rk-detail-dot ${status}`} />
                  <span className="rk-detail-nm">
                    {item.label || t(`itops.racks.kind.${item.kind}`)}
                  </span>
                  <span className="rk-detail-u">
                    {`U${item.startU}`}
                    {item.heightU > 1 ? `–${item.startU + item.heightU - 1}` : ""}
                  </span>
                  {summary[0] ? (
                    <span className="rk-detail-meta">{summary[0]}</span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
      {placing && activePointer && !activePointer.snap && placeSpec
        ? createPortal(
            <div
              className="itops-page rk-cursor-ghost"
              aria-hidden="true"
              style={{
                left: activePointer.x,
                top: activePointer.y,
                width: (activePointer.width * placeQuarters) / 4,
                height: Math.max(1, placeSpec.heightU) * unitPx,
              }}
            >
              <RackDevice
                kind={placeSpec.kind}
                label={placeSpec.label || t(`itops.racks.kind.${placeSpec.kind}`)}
                subLabel={placeSpec.metadata?.vendor ?? null}
                status={placeSpec.metadata?.status ?? "online"}
                ports={placeSpec.metadata?.ports ?? null}
                disks={placeSpec.metadata?.disks ?? null}
                battery={placeSpec.metadata?.battery ?? null}
                load={placeSpec.metadata?.load ?? null}
                expiry={placeSpec.metadata?.expiry ?? null}
                rotation={placeSpec.metadata?.rotation ?? null}
                yaw={placeSpec.metadata?.yaw ?? null}
                kuaiguaiSize={placeSpec.metadata?.kuaiguaiSize ?? null}
                kuaiguaiStyle={placeSpec.metadata?.kuaiguaiStyle ?? null}
                face={displayFace}
                notes={placeSpec.metadata?.notes ?? null}
                formFactor={placeSpec.metadata?.formFactor ?? null}
                serverPanelStyle={placeSpec.metadata?.serverPanelStyle ?? null}
                heightU={placeSpec.heightU}
                accent={placeSpec.metadata?.accent ?? null}
                shell={placeSpec.metadata?.shell ?? null}
                seed="cursor-ghost"
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
