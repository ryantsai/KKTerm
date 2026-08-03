// Single-rack stage (docs/SITE.md Rack View). Centers a <RackElevation> and
// overlays per-device "balloon" callouts that point to each device's U slot.
// One-face mode alternates left/right; two-face mode gives Front and Rear
// separate outer lanes so leaders never cross between cabinets. Balloon Y is
// measured from the live device grids and same-lane balloons spread apart.

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  Rack,
  RackItem,
  RackItemStatus,
  RackMountFace,
  SiteHost,
} from "../../types";
import { childHostsOf, hostDisplayName } from "./hostTree";
import { collectBoundConnectionIds, summarizeRackDeviceMetadata } from "./rackInventory";
import { RackElevation, U_PX } from "./RackElevation";
import { KUAIGUAI_TOP_CLEARANCE_U } from "./rackPlacement";
import type { RackItemDraft } from "./RackItemDialog";

/** Child-host names for a device balloon: first two, then a "+N" overflow. */
const BALLOON_CHILD_HOSTS = 2;

const BALLOON_MIN_GAP = 60; // px between same-lane balloon centers

const MIN_RACK_U_PX = 12;
const RACK_VERTICAL_CHROME_PX = 48;

/** Fit the cabinet to the visible Rack View height without enlarging its
 *  normal 26 px rack units. Very short windows retain a legible 12 px floor
 *  and let the drill pane scroll only when it is genuinely unavoidable. */
export function fittedRackUnitPx(
  availableHeight: number,
  rackHeightU: number,
  topClearanceU: number,
): number {
  const totalU = Math.max(1, rackHeightU + topClearanceU);
  const fitted = Math.floor((Math.max(0, availableHeight) - RACK_VERTICAL_CHROME_PX) / totalU);
  return Math.max(MIN_RACK_U_PX, Math.min(U_PX, fitted));
}

function itemStatus(item: RackItem): RackItemStatus {
  return item.metadata?.status ?? "online";
}

// One concise spec line per device kind.
function specOf(item: RackItem, t: (k: string, o?: Record<string, unknown>) => string): string {
  const summary = summarizeRackDeviceMetadata(item.metadata ?? {});
  if (summary.length > 0) return summary[0];
  const m = item.metadata ?? {};
  switch (item.kind) {
    case "switch":
    case "router":
    case "patchPanel":
      return m.ports != null ? t("itops.racks.portsSpec", { count: m.ports }) : "";
    case "server":
    case "storage":
    case "connection":
      return m.disks != null ? t("itops.racks.disksSpec", { count: m.disks }) : "";
    case "ups":
      return m.battery != null ? `${m.battery}%` : "";
    case "pdu":
      return m.load != null ? `${m.load}%` : "";
    default:
      return "";
  }
}

interface Balloon {
  item: RackItem;
  face: RackMountFace;
  side: "left" | "right";
  y: number; // px from stage top
}

interface RackGeometry {
  top: number;
  height: number;
  left: number;
  right: number;
}

/** Keep one callout lane readable without letting its first/last balloon drift
 * outside the stage. Dense racks compress the gap only as much as necessary. */
function spreadBalloonLane(lane: Balloon[], minY: number, maxY: number): void {
  if (lane.length === 0) return;
  lane.sort((a, b) => a.y - b.y);
  const gap =
    lane.length > 1
      ? Math.min(BALLOON_MIN_GAP, Math.max(0, maxY - minY) / (lane.length - 1))
      : 0;
  let previous = minY - gap;
  for (const balloon of lane) {
    balloon.y = Math.max(balloon.y, previous + gap);
    previous = balloon.y;
  }
  const overflow = lane[lane.length - 1].y - maxY;
  if (overflow > 0) {
    for (const balloon of lane) balloon.y -= overflow;
  }
  const underflow = minY - lane[0].y;
  if (underflow > 0) {
    for (const balloon of lane) balloon.y += underflow;
  }
}

export function RackStage({
  rack,
  hosts,
  hostFor,
  isGhost,
  onOpenItem,
  onEditItem,
  onBindItem,
  onEditRack,
  onDeleteRack,
  onRunRack,
  onMoveItem,
  onDeleteItem,
  editMode = false,
  placeSpec,
  onPlaceAt,
  onCancelPlacement,
}: {
  rack: Rack;
  /** The Site's Host inventory; devices with a bound `metadata.hostId` list
   *  their Host and its child Hosts (VMs/containers) in the balloon callout. */
  hosts?: SiteHost[];
  hostFor?: (item: RackItem) => string | null;
  isGhost?: (item: RackItem) => boolean;
  onOpenItem?: (item: RackItem, anchor: HTMLElement) => void;
  onEditItem?: (item: RackItem) => void;
  onBindItem?: (item: RackItem) => void;
  onEditRack?: (rack: Rack) => void;
  onDeleteRack?: (rack: Rack) => void;
  onRunRack?: (rack: Rack) => void;
  onMoveItem?: (
    itemId: string,
    targetRackId: string,
    startU: number,
    xFraction?: number,
    mountFace?: RackMountFace,
  ) => void;
  onDeleteItem?: (item: RackItem) => void;
  editMode?: boolean;
  /** Armed picker placement pass-through (see RackElevation). */
  placeSpec?: RackItemDraft | null;
  onPlaceAt?: (startU: number, slot?: number, face?: RackMountFace) => void;
  onCancelPlacement?: () => void;
}) {
  const { t } = useTranslation();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [unitPx, setUnitPx] = useState(U_PX);
  const [geometry, setGeometry] = useState<
    Partial<Record<RackMountFace, RackGeometry>>
  >({});
  const frontItems = rack.items.filter(
    (item) => item.kind !== "kuaiguai" && (item.mountFace ?? "front") === "front",
  );
  const rearItems = rack.items.filter(
    (item) => item.kind !== "kuaiguai" && item.mountFace === "rear",
  );
  const dualFace = editMode || (frontItems.length > 0 && rearItems.length > 0);
  const faces: RackMountFace[] = dualFace
    ? ["front", "rear"]
    : rearItems.length > 0 && frontItems.length === 0
      ? ["rear"]
      : ["front"];
  const facesKey = faces.join(",");
  // Rack View is the only elevation that adapts its U height to the current
  // drill viewport. Other rack previews keep their normal fixed-size skin.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const drill = stage.closest(".ft-drill") as HTMLElement | null;
    const measure = () => {
      const stageTop = stage.getBoundingClientRect().top;
      const drillBottom = drill?.getBoundingClientRect().bottom ?? window.innerHeight;
      const visibleBottom = Math.min(window.innerHeight, drillBottom);
      const availableHeight = Math.max(0, visibleBottom - stageTop - 4);
      setUnitPx(fittedRackUnitPx(availableHeight, rack.heightU, KUAIGUAI_TOP_CLEARANCE_U));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(drill ?? stage);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [rack.heightU]);

  // Measure every visible device grid relative to the stage. Dual-face mode
  // needs independent anchors because Front and Rear can differ horizontally.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measuredFaces = facesKey.split(",") as RackMountFace[];
    const grids = measuredFaces
      .map(
        (face) =>
          stage.querySelector(`.rk-stage-rack[data-face="${face}"] .rk-grid`) as
            | HTMLElement
            | null,
      )
      .filter((grid): grid is HTMLElement => grid != null);
    const measure = () => {
      const s = stage.getBoundingClientRect();
      const next: Partial<Record<RackMountFace, RackGeometry>> = {};
      for (const face of measuredFaces) {
        const grid = stage.querySelector(
          `.rk-stage-rack[data-face="${face}"] .rk-grid`,
        ) as HTMLElement | null;
        if (!grid) continue;
        const g = grid.getBoundingClientRect();
        next[face] = {
          top: g.top - s.top,
          height: g.height,
          left: g.left - s.left,
          right: g.right - s.left,
        };
      }
      setGeometry(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    for (const grid of grids) ro.observe(grid);
    return () => ro.disconnect();
  }, [facesKey, rack.id, rack.heightU, rack.items.length]);

  // A single elevation alternates callouts on both sides. With two elevations,
  // each mounting face owns its outer lane: Front left, Rear right. The
  // face-neutral rack-top package is drawn on both elevations but contributes
  // only one Front-lane callout, so it never masquerades as two devices.
  const balloons: Balloon[] = [];
  for (const face of faces) {
    const geom = geometry[face];
    if (!geom) continue;
    const faceItems = rack.items.filter((item) =>
      item.kind === "kuaiguai"
        ? faces.length === 1 || face === "front"
        : (item.mountFace ?? "front") === face,
    );
    const rowPx = geom.height / rack.heightU;
    const ordered = [...faceItems].sort(
      (a, b) => b.startU + b.heightU - (a.startU + a.heightU),
    );
    ordered.forEach((item, index) => {
      const topRow0 = rack.heightU - (item.startU + item.heightU - 1);
      const y = geom.top + (topRow0 + item.heightU / 2) * rowPx;
      balloons.push({
        item,
        face,
        side: dualFace
          ? face === "front"
            ? "left"
            : "right"
          : index % 2 === 0
            ? "left"
            : "right",
        y,
      });
    });
  }
  for (const face of faces) {
    const geom = geometry[face];
    if (!geom) continue;
    for (const side of ["left", "right"] as const) {
      spreadBalloonLane(
        balloons.filter((balloon) => balloon.face === face && balloon.side === side),
        geom.top + 22,
        Math.max(geom.top + 22, geom.top + geom.height - 22),
      );
    }
  }

  return (
    <div className={`rk-stage${dualFace ? " dual-face" : ""}`} ref={stageRef}>
      <div className="rk-stage-racks">
        {faces.map((face) => (
          <div className="rk-stage-rack" data-face={face} key={face}>
            <div className="rk-stage-face-label">{t(`itops.racks.face.${face}`)}</div>
            <RackElevation
              rack={rack}
              face={face}
              unitPx={unitPx}
              hideHeader
              showRackTop
              reserveTopU={KUAIGUAI_TOP_CLEARANCE_U}
              hostFor={hostFor}
              isGhost={isGhost}
              editMode={editMode}
              onOpenItem={onOpenItem}
              onEditItem={onEditItem}
              onBindItem={onBindItem}
              onEditRack={onEditRack}
              onDeleteRack={onDeleteRack}
              onRunRack={onRunRack}
              onMoveItem={onMoveItem}
              onDeleteItem={onDeleteItem}
              placeSpec={
                placeSpec?.kind === "kuaiguai"
                  ? faces.length === 1 || face === "front"
                    ? placeSpec
                    : null
                  : placeSpec
                    ? { ...placeSpec, mountFace: face }
                    : null
              }
              onPlaceAt={
                onPlaceAt
                  ? (startU, slot) => onPlaceAt(startU, slot, face)
                  : undefined
              }
              onCancelPlacement={onCancelPlacement}
            />
          </div>
        ))}
      </div>
      {balloons.map((b) => {
        const geom = geometry[b.face];
        if (!geom) return null;
        const status = isGhost?.(b.item) ? "offline" : itemStatus(b.item);
        const spec = specOf(b.item, t);
        const model = b.item.metadata?.vendor?.trim() || null;
        const notes = b.item.metadata?.notes?.trim() || null;
        const boundConnectionCount = collectBoundConnectionIds(b.item).length;
        const sub = hostFor?.(b.item);
        const boundHost = b.item.metadata?.hostId
          ? hosts?.find((entry) => entry.id === b.item.metadata?.hostId)
          : undefined;
        const childHosts = boundHost ? childHostsOf(hosts ?? [], boundHost.id) : [];
        const shownChildren = childHosts.slice(0, BALLOON_CHILD_HOSTS);
        const overflow = childHosts.length - shownChildren.length;
        // Left balloons fill from the stage's left edge to the rack's left
        // edge; right balloons from the rack's right edge to the stage's end.
        const style =
          b.side === "left"
            ? { top: b.y, left: 0, width: geom.left }
            : { top: b.y, left: geom.right, right: 0 };
        const box = (
          <span className="rk-balloon-box">
            <span className={`rk-balloon-dot ${status}`} />
            <span className="rk-balloon-txt">
              <span className="rk-balloon-nm">
                {b.item.label || t(`itops.racks.kind.${b.item.kind}`)}
              </span>
              {model || sub || spec ? (
                <span className="rk-balloon-meta">
                  {model ? <span className="model">{model}</span> : null}
                  {sub ? <span className="host">{sub}</span> : null}
                  {spec ? <span className="spec">{spec}</span> : null}
                </span>
              ) : null}
              {notes ? (
                <span className="rk-balloon-notes" title={notes}>
                  {notes}
                </span>
              ) : null}
              {boundConnectionCount > 0 ? (
                <span className="rk-balloon-connections">
                  {t("itops.racks.boundConnectionCount", { count: boundConnectionCount })}
                </span>
              ) : null}
              {boundHost ? (
                <span className="rk-balloon-hosts">
                  <span className="hostname">{boundHost.hostname}</span>
                  {shownChildren.map((child) => (
                    <span key={child.id} className="child">
                      {hostDisplayName(child)}
                    </span>
                  ))}
                  {overflow > 0 ? (
                    <span className="more">
                      {t("itops.hosts.childOverflow", { count: overflow })}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </span>
          </span>
        );
        return (
          <div
            key={`${b.face}:${b.item.id}`}
            className={`rk-balloon ${b.side}`}
            data-face={b.face}
            style={style}
            onClick={() => onEditItem?.(b.item)}
          >
            {b.side === "right" ? <span className="rk-balloon-leader" /> : null}
            {box}
            {b.side === "left" ? <span className="rk-balloon-leader" /> : null}
          </div>
        );
      })}
    </div>
  );
}
