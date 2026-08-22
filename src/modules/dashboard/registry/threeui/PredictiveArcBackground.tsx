import { useEffect, useRef } from "react";

import { useDashboardAnimationActive } from "../../view/animationGating";
import {
  createPredictiveArcRenderer,
  PREDICTIVE_ARC_DEFAULTS,
} from "./predictiveArcRenderer";

export function PredictiveArcBackground() {
  const active = useDashboardAnimationActive();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return undefined;

    const renderer = createPredictiveArcRenderer(canvas, () => PREDICTIVE_ARC_DEFAULTS);
    if (!renderer) return undefined;

    let frame = 0;
    let visible = true;

    const resize = () => {
      const bounds = host.getBoundingClientRect();
      renderer.resize(bounds.width, bounds.height);
      renderer.render();
    };
    const tick = () => {
      renderer.render();
      frame = visible && !document.hidden ? requestAnimationFrame(tick) : 0;
    };
    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible && !frame) frame = requestAnimationFrame(tick);
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    });
    const onVisibilityChange = () => {
      if (document.hidden && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (!document.hidden && visible && !frame) {
        frame = requestAnimationFrame(tick);
      }
    };

    resizeObserver.observe(host);
    intersectionObserver.observe(host);
    document.addEventListener("visibilitychange", onVisibilityChange);
    resize();
    frame = requestAnimationFrame(tick);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active]);

  return (
    <div ref={hostRef} className="threeui-background predictive-arc">
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
