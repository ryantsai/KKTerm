import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { withThreeUiFrameContextMenuBridge } from "../threeUiFrameBridge";
import quanteraTradingSource from "./sources/quantera-trading-hero.html?raw";

export type QuanteraTradingBackgroundProps = {
  className?: string;
  style?: CSSProperties;
};

const BACKGROUND_ONLY_STYLE = `<style data-threeui-quantera-background>
html,
body {
  width: 100% !important;
  height: 100% !important;
  min-height: 0 !important;
  margin: 0 !important;
  overflow: hidden !important;
}

body {
  position: relative !important;
  background: #000 !important;
}

.ui {
  visibility: hidden !important;
  pointer-events: none !important;
}

#gl {
  pointer-events: auto !important;
}
</style>`;

function buildBackgroundDocument(reducedMotion: boolean) {
  let documentSource = quanteraTradingSource
    .replace("<title>Quantera — Trade Without a Clock</title>", "<title>Quantera Trading Background — Scene</title>")
    .replace('<link rel="preconnect" href="https://fonts.googleapis.com">\n', "")
    .replace('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n', "")
    .replace('<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@300;400;500;600&display=block" rel="stylesheet">\n', "")
    .replace("</head>", `${BACKGROUND_ONLY_STYLE}</head>`)
    .replace('<div class="ui">', '<div class="ui" aria-hidden="true">')
    .replace("scene.add(headGroup);", "scene.add(headGroup);\nheadGroup.visible = false;")
    .replace("  buildHeadline();", "  /* Background-only adapter: omit the WebGL-painted product headline. */")
    .replace("  scheduleReveals();", "  /* Background-only adapter: omit interface reveal timers. */");

  if (reducedMotion) {
    documentSource = documentSource.replace(
      "const STATIC_T = QT === null ? null : parseFloat(QT);",
      "const STATIC_T = 4;",
    );
  }

  return withThreeUiFrameContextMenuBridge(documentSource);
}

export function QuanteraTradingBackground({
  className = "",
  style,
}: QuanteraTradingBackgroundProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [hostVisible, setHostVisible] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(() => (
    typeof document === "undefined" || !document.hidden
  ));
  const [reducedMotion, setReducedMotion] = useState(() => (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => setHostVisible(entry?.isIntersecting ?? true));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const update = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const source = useMemo(() => buildBackgroundDocument(reducedMotion), [reducedMotion]);
  const mounted = hostVisible && documentVisible;

  useEffect(() => {
    setReady(false);
  }, [mounted, reducedMotion]);

  return (
    <div
      ref={hostRef}
      className={`threeui-background quantera-trading-background${className ? ` ${className}` : ""}`}
      role="img"
      aria-label="Interactive green trading field with volumetric light shafts, equations, and drifting particles"
      data-state={ready ? "ready" : "loading"}
      style={{ background: "#000", pointerEvents: "auto", ...style }}
    >
      {mounted ? (
        <iframe
          key={reducedMotion ? "reduced" : "motion"}
          title="Interactive Quantera trading background"
          srcDoc={source}
          sandbox="allow-scripts"
          loading="eager"
          onLoad={() => setReady(true)}
          style={{
            position: "absolute",
            inset: 0,
            display: "block",
            width: "100%",
            height: "100%",
            border: 0,
            background: "#000",
          }}
        />
      ) : null}
    </div>
  );
}
