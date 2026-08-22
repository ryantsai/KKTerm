import { useEffect, useRef } from "react";
import { CONDENSATION_DEFAULTS, createCondensationRenderer, type CondensationOptions } from "./condensationRenderer";

export type CondensationBackgroundProps = Partial<CondensationOptions> & { className?: string };
export function CondensationBackground({ className = "", ...props }: CondensationBackgroundProps) {
  const hostRef = useRef<HTMLDivElement>(null), canvasRef = useRef<HTMLCanvasElement>(null), optionsRef = useRef({ ...CONDENSATION_DEFAULTS, ...props }); optionsRef.current = { ...CONDENSATION_DEFAULTS, ...props };
  useEffect(() => { const host = hostRef.current, canvas = canvasRef.current; if (!host || !canvas) return undefined; const renderer = createCondensationRenderer(canvas, () => optionsRef.current); let frame = 0, visible = true;
    const resize = () => { const bounds = host.getBoundingClientRect(); renderer.resize(bounds.width, bounds.height); renderer.render(performance.now()); }; const tick = (now: number) => { renderer.render(now); frame = visible && !document.hidden ? requestAnimationFrame(tick) : 0; }; const resizeObserver = new ResizeObserver(resize), intersection = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true; if (visible && !frame) frame = requestAnimationFrame(tick); if (!visible && frame) cancelAnimationFrame(frame), frame = 0; }); resizeObserver.observe(host); intersection.observe(host); resize(); frame = requestAnimationFrame(tick); return () => { if (frame) cancelAnimationFrame(frame); resizeObserver.disconnect(); intersection.disconnect(); renderer.dispose(); };
  }, []);
  return <div ref={hostRef} className={`threeui-background condensation${className ? ` ${className}` : ""}`} style={{ opacity: optionsRef.current.opacity }}><canvas ref={canvasRef} /></div>;
}
