// Renders a DashboardBackground (preset / dynamic / image / video) as an
// absolutely-positioned layer behind a file pane's content view. Mirrors the
// terminal background layer but uses file-browser-scoped CSS classes so the SFTP
// surface stays independent of terminal styling.
import { useEffect, useState, type CSSProperties, type JSX } from "react";
import { asBackground } from "react-linear-gradient-picker";
import { resolveBackgroundPreset } from "../../../dashboard/registry/backgroundPresets";
import { DashboardDynamicBackground } from "../../../dashboard/registry/dynamicBackgrounds";
import { loadBackgroundImage } from "../../../dashboard/state/persistence";
import { type BackgroundFit, type DashboardBackground } from "../../../dashboard/types";

function backgroundFitStyle(fit: BackgroundFit): CSSProperties {
  switch (fit) {
    case "fill":    return { backgroundSize: "cover", backgroundRepeat: "no-repeat", backgroundPosition: "center" };
    case "fit":     return { backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" };
    case "stretch": return { backgroundSize: "100% 100%", backgroundRepeat: "no-repeat" };
    case "tile":    return { backgroundSize: "auto", backgroundRepeat: "repeat" };
    case "center":  return { backgroundSize: "auto", backgroundRepeat: "no-repeat", backgroundPosition: "center" };
  }
}

function videoFitStyle(fit: BackgroundFit): CSSProperties {
  switch (fit) {
    case "fill":    return { objectFit: "cover" };
    case "fit":     return { objectFit: "contain" };
    case "stretch": return { objectFit: "fill" };
    case "tile":    return { objectFit: "cover" };
    case "center":  return { objectFit: "none" };
  }
}

function dimColor(dim: number): string | undefined {
  if (dim === 0) return undefined;
  const alpha = Math.min(Math.abs(dim), 100) / 100;
  return dim < 0
    ? `rgba(0, 0, 0, ${alpha})`
    : `rgba(255, 255, 255, ${alpha})`;
}

export function SftpBackgroundLayer({
  active,
  background,
}: {
  active: boolean;
  background: DashboardBackground | null | undefined;
}) {
  const [mediaDataUrl, setMediaDataUrl] = useState("");
  const mediaFile = background?.kind === "image" || background?.kind === "video" ? background.file : "";

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
    layer = <div className="sftp-bg-fill" style={{ background: resolveBackgroundPreset(background.preset).css }} />;
  } else if (background.kind === "dynamic") {
    layer = <DashboardDynamicBackground active={active} id={background.dynamic} />;
  } else if (background.kind === "customGradient") {
    layer = (
      <div
        className="sftp-bg-fill"
        style={{ background: asBackground({ angle: background.angle, stops: background.stops, type: "linear" }) }}
      />
    );
  } else if (background.kind === "image" && mediaDataUrl) {
    const style: CSSProperties = {
      backgroundImage: `url("${mediaDataUrl}")`,
      ...backgroundFitStyle(background.fit),
    };
    const dim = dimColor(background.dim);
    if (dim) (style as Record<string, string>)["--sftp-bg-dim-color"] = dim;
    layer = <div className="sftp-bg-fill sftp-bg-media" style={style} />;
  } else if (background.kind === "video" && mediaDataUrl) {
    const dim = dimColor(background.dim);
    const style = dim ? ({ "--sftp-bg-dim-color": dim } as CSSProperties) : undefined;
    layer = (
      <div className="sftp-bg-fill sftp-bg-media" style={style}>
        <video aria-hidden="true" autoPlay loop muted playsInline src={mediaDataUrl} style={videoFitStyle(background.fit)} />
      </div>
    );
  }

  return layer ? <div className="sftp-bg-layer" aria-hidden="true">{layer}</div> : null;
}
