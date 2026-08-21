// Renders a DashboardBackground (preset / dynamic / image / video) as an
// absolutely-positioned layer behind an IT Ops drill view (site cards, server
// room racks, single rack stage). A direct port of SftpBackgroundLayer using
// itops-scoped CSS classes so the IT Ops surface stays independent of terminal/
// file-browser styling, while reusing the same Dashboard background machinery.

import {
  useEffect,
  useState,
  type CSSProperties,
  type JSX,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { asBackground } from "react-linear-gradient-picker";
import { resolveBackgroundPreset } from "../dashboard/registry/backgroundPresets";
import { DashboardDynamicBackground } from "../dashboard/registry/dynamicBackgrounds";
import { loadBackgroundImage } from "../dashboard/state/persistence";
import { type BackgroundFit, type DashboardBackground } from "../dashboard/types";

function backgroundFitStyle(fit: BackgroundFit): CSSProperties {
  switch (fit) {
    case "fill":
      return { backgroundSize: "cover", backgroundRepeat: "no-repeat", backgroundPosition: "center" };
    case "fit":
      return { backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" };
    case "stretch":
      return { backgroundSize: "100% 100%", backgroundRepeat: "no-repeat" };
    case "tile":
      return { backgroundSize: "auto", backgroundRepeat: "repeat" };
    case "center":
      return { backgroundSize: "auto", backgroundRepeat: "no-repeat", backgroundPosition: "center" };
  }
}

function videoFitStyle(fit: BackgroundFit): CSSProperties {
  switch (fit) {
    case "fill":
      return { objectFit: "cover" };
    case "fit":
      return { objectFit: "contain" };
    case "stretch":
      return { objectFit: "fill" };
    case "tile":
      return { objectFit: "cover" };
    case "center":
      return { objectFit: "none" };
  }
}

function dimColor(dim: number): string | undefined {
  if (dim === 0) return undefined;
  const alpha = Math.min(Math.abs(dim), 100) / 100;
  return dim < 0 ? `rgba(0, 0, 0, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
}

/** The raw background media layer (no positioning context of its own). */
export function ItOpsBackgroundLayer({
  active,
  background,
}: {
  active: boolean;
  background: DashboardBackground | null | undefined;
}) {
  const [mediaDataUrl, setMediaDataUrl] = useState("");
  const mediaFile =
    background?.kind === "image" || background?.kind === "video" ? background.file : "";

  useEffect(() => {
    let cancelled = false;
    setMediaDataUrl("");
    if (!mediaFile) return;
    void loadBackgroundImage(mediaFile).then((dataUrl) => {
      if (!cancelled) setMediaDataUrl(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [mediaFile]);

  if (!background) return null;

  let layer: JSX.Element | null = null;
  if (background.kind === "preset") {
    layer = (
      <div className="itops-bg-fill" style={{ background: resolveBackgroundPreset(background.preset).css }} />
    );
  } else if (background.kind === "dynamic") {
    layer = <DashboardDynamicBackground active={active} id={background.dynamic} />;
  } else if (background.kind === "customGradient") {
    layer = (
      <div
        className="itops-bg-fill"
        style={{ background: asBackground({ angle: background.angle, stops: background.stops, type: "linear" }) }}
      />
    );
  } else if (background.kind === "image" && mediaDataUrl) {
    const style: CSSProperties = {
      backgroundImage: `url("${mediaDataUrl}")`,
      ...backgroundFitStyle(background.fit),
    };
    const dim = dimColor(background.dim);
    if (dim) (style as Record<string, string>)["--itops-bg-dim-color"] = dim;
    layer = <div className="itops-bg-fill itops-bg-media" style={style} />;
  } else if (background.kind === "video" && mediaDataUrl) {
    const dim = dimColor(background.dim);
    const style = dim ? ({ "--itops-bg-dim-color": dim } as CSSProperties) : undefined;
    layer = (
      <div className="itops-bg-fill itops-bg-media" style={style}>
        <video
          aria-hidden="true"
          autoPlay
          loop
          muted
          playsInline
          src={mediaDataUrl}
          style={videoFitStyle(background.fit)}
        />
      </div>
    );
  }

  return layer ? (
    <div className="itops-bg-layer" aria-hidden="true">
      {layer}
    </div>
  ) : null;
}

/** A positioned wrapper that paints `background` behind its children. */
export function ItOpsBackground({
  background,
  className = "",
  onContextMenu,
  children,
}: {
  background: DashboardBackground | null | undefined;
  className?: string;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div
      className={`itops-bg-host${background ? " has-bg" : ""} ${className}`.trim()}
      onContextMenu={onContextMenu}
    >
      <ItOpsBackgroundLayer active background={background} />
      <div className="itops-bg-content">{children}</div>
    </div>
  );
}
