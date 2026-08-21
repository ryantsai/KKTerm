import GridLayout, { type Layout, WidthProvider } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useEffect, useMemo, type CSSProperties, type JSX, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { asBackground } from "react-linear-gradient-picker";
import { showNativeContextMenu } from "../../../lib/nativeContextMenu";
import { nativeMenuIcons } from "../../../lib/nativeMenuIcons";
import { resolveBackgroundPreset } from "../registry/backgroundPresets";
import { clampDashboardGridY } from "../grid";
import { DashboardDynamicBackground } from "../registry/dynamicBackgrounds";
import { useDashboardStore } from "../state/dashboardStore";
import type { BackgroundFit, DashboardView, DashboardWidgetInstance, GridDensity } from "../types";
import { WidgetFrame, type DashboardWidgetDeleteRequest } from "./WidgetFrame";

const ResponsiveGrid = WidthProvider(GridLayout);

export const DENSITY_SETTINGS: Record<GridDensity, { rowHeight: number; margin: [number, number] }> = {
  compact:  { rowHeight: 52, margin: [6, 6]   },
  default:  { rowHeight: 68, margin: [16, 16] },
  roomy:    { rowHeight: 92, margin: [30, 30] },
};

function backgroundFitStyle(fit: BackgroundFit): CSSProperties {
  switch (fit) {
    case "fill":    return { backgroundSize: "cover", backgroundRepeat: "no-repeat", backgroundPosition: "center" };
    case "fit":     return { backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" };
    case "stretch": return { backgroundSize: "100% 100%", backgroundRepeat: "no-repeat" };
    case "tile":    return { backgroundSize: "auto", backgroundRepeat: "repeat" };
    case "center":  return { backgroundSize: "auto", backgroundRepeat: "no-repeat", backgroundPosition: "center" };
  }
}

function dimColor(dim: number): string | undefined {
  if (dim === 0) return undefined;
  const alpha = Math.min(Math.abs(dim), 100) / 100;
  return dim < 0
    ? `rgba(0, 0, 0, ${alpha})`
    : `rgba(255, 255, 255, ${alpha})`;
}

export interface DashboardCanvasProps {
  view: DashboardView;
  instances: DashboardWidgetInstance[];
  isViewActive: boolean;
  onCustomize: (instance: DashboardWidgetInstance, anchor: HTMLElement) => void;
  onOpenCatalog: () => void;
  onOpenBackground: () => void;
  onToggleEditMode: () => void;
  onRequestWidgetDelete: (request: DashboardWidgetDeleteRequest) => void;
}

export function DashboardCanvas({
  view,
  instances,
  isViewActive,
  onCustomize,
  onOpenCatalog,
  onOpenBackground,
  onToggleEditMode,
  onRequestWidgetDelete,
}: DashboardCanvasProps) {
  const { t } = useTranslation();
  const editMode = useDashboardStore((s) => s.editMode);
  const applyLayout = useDashboardStore((s) => s.applyLayout);
  const backgroundImages = useDashboardStore((s) => s.backgroundImages);
  const loadBackgroundImage = useDashboardStore((s) => s.loadBackgroundImage);

  const background = view.background;
  const mediaFile = background?.kind === "image" ? background.file : null;

  useEffect(() => {
    if (mediaFile) void loadBackgroundImage(mediaFile);
  }, [mediaFile, loadBackgroundImage]);

  const settings = DENSITY_SETTINGS[view.gridDensity];
  const layout: Layout = useMemo(
    () => instances.map((i) => ({
      i: i.id,
      x: i.gridX,
      y: clampDashboardGridY(i.gridY, i.gridH),
      w: i.gridW,
      h: i.gridH,
      minW: 1,
      minH: 1,
    })),
    [instances],
  );

  function onLayoutChange(next: Layout) {
    if (!editMode) return;
    applyLayout(view.id, next.map((l) => ({ id: l.i, gridX: l.x, gridY: l.y, gridW: l.w, gridH: l.h })));
  }

  async function onCanvasContextMenu(event: MouseEvent<HTMLDivElement>) {
    // Only react on empty canvas space.
    if ((event.target as HTMLElement).closest(".react-grid-item")) return;
    event.preventDefault();
    await showNativeContextMenu(
      [
        { kind: "item", label: t("dashboard.addWidgetLabel"), iconSvg: nativeMenuIcons.plus, action: onOpenCatalog },
        { kind: "item", label: editMode ? t("dashboard.editDone") : t("dashboard.editLayout"), iconSvg: nativeMenuIcons.pencil, action: onToggleEditMode },
        { kind: "separator" },
        { kind: "item", label: t("dashboard.changeBackground"), iconSvg: nativeMenuIcons.image, action: onOpenBackground },
      ],
      { x: event.clientX, y: event.clientY },
    );
  }

  let backgroundLayer: JSX.Element | null = null;
  if (background?.kind === "preset") {
    backgroundLayer = (
      <div
        className="dw-canvas-bg"
        style={{ background: resolveBackgroundPreset(background.preset).css }}
      />
    );
  } else if (background?.kind === "image") {
    const dataUrl = backgroundImages[background.file];
    if (dataUrl) {
      const style: CSSProperties = {
        backgroundImage: `url("${dataUrl}")`,
        ...backgroundFitStyle(background.fit),
      };
      const dim = dimColor(background.dim);
      if (dim) {
        (style as Record<string, string>)["--dw-bg-dim-color"] = dim;
      }
      backgroundLayer = <div className="dw-canvas-bg" style={style} />;
    }
  } else if (background?.kind === "dynamic") {
    backgroundLayer = (
      <DashboardDynamicBackground active={isViewActive} id={background.dynamic} />
    );
  } else if (background?.kind === "customGradient") {
    backgroundLayer = (
      <div
        className="dw-canvas-bg"
        style={{ background: asBackground({ angle: background.angle, stops: background.stops, type: "linear" }) }}
      />
    );
  }

  return (
    <div className="dw-canvas-host" data-dashboard-view-id={view.id} onContextMenu={onCanvasContextMenu}>
      {backgroundLayer}
      {editMode ? <div className="dw-canvas-blueprint" /> : null}
      <ResponsiveGrid
        className="dw-canvas"
        cols={12}
        rowHeight={settings.rowHeight}
        margin={settings.margin}
        layout={layout}
        isDraggable={editMode}
        isResizable={editMode}
        compactType="vertical"
        preventCollision={false}
        draggableHandle=".drag-handle"
        draggableCancel=".react-resizable-handle, .dw-controls, .dw-ctrl, button, input, textarea, select, a, [role='button']"
        resizeHandles={editMode ? ["n", "e", "s", "w", "nw", "ne", "sw", "se"] : []}
        onLayoutChange={onLayoutChange}
      >
        {instances.map((i) => (
          <div key={i.id}>
            <WidgetFrame
              instance={i}
              isViewActive={isViewActive}
              onCustomize={onCustomize}
              onRequestDelete={onRequestWidgetDelete}
            />
          </div>
        ))}
      </ResponsiveGrid>
    </div>
  );
}
