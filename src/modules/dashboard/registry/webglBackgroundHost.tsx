import { useEffect, useRef } from "react";
import * as THREE from "three";
import { dynamicBackgroundDevicePixelRatio } from "./dynamicBackgroundCanvas";
import { useDashboardAnimationActive } from "../view/animationGating";

export interface WebGLBackgroundHandle {
  render(width: number, height: number, time: number, dt: number): void;
  onResize?(width: number, height: number, dpr: number): void;
  dispose(): void;
}

export type WebGLBackgroundSetup = (
  canvas: HTMLCanvasElement,
  renderer: THREE.WebGLRenderer,
) => WebGLBackgroundHandle;

/**
 * WebGL counterpart to the Canvas2D `useCanvasAnim` hook used across this
 * registry: same resize/animation-gating/dispose lifecycle, but hands the
 * caller a real THREE.WebGLRenderer sized to the parent element instead of a
 * 2D context.
 */
export function useWebGLBackground(setup: WebGLBackgroundSetup) {
  const active = useDashboardAnimationActive();
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const ref = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);
  const runtimeRef = useRef<{ start: () => void; stop: () => void } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const dpr = dynamicBackgroundDevicePixelRatio(window.devicePixelRatio);
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(dpr);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const handle = setupRef.current(canvas, renderer);

    let raf = 0;
    let width = 0;
    let height = 0;
    let elapsed = 0;
    let lastNow = 0;

    function resize() {
      const rect = parent!.getBoundingClientRect();
      width = Math.max(2, Math.floor(rect.width));
      height = Math.max(2, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      handle.onResize?.(width, height, dpr);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);
    resize();

    function frame(now: number) {
      const dt = lastNow ? (now - lastNow) / 1000 : 0;
      lastNow = now;
      elapsed += Math.min(dt, 0.05);
      try {
        handle.render(width, height, elapsed, Math.min(dt, 0.05));
      } catch (error) {
        console.warn("webgl background render error (loop kept alive):", error);
      }
      raf = activeRef.current ? requestAnimationFrame(frame) : 0;
    }

    function start() {
      if (raf || !activeRef.current) return;
      lastNow = 0;
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      lastNow = 0;
    }

    runtimeRef.current = { start, stop };
    if (activeRef.current) start();

    return () => {
      stop();
      resizeObserver.disconnect();
      handle.dispose();
      renderer.dispose();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    activeRef.current = active;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (active) runtime.start();
    else runtime.stop();
  }, [active]);

  return ref;
}

export function WebGLBackgroundCanvas({ setup }: { setup: WebGLBackgroundSetup }) {
  const ref = useWebGLBackground(setup);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}
