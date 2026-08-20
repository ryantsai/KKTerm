import { useEffect, useRef } from "react";
import {
  Color,
  FogExp2,
  MathUtils,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { uniform } from "three/tsl";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { useDashboardAnimationActive } from "../view/animationGating";

// These modules remain JavaScript so the Poseidon ocean implementation stays
// byte-for-byte identical to the MIT-licensed reference repository.
// @ts-expect-error Poseidon source is intentionally preserved as JavaScript.
import { params } from "./poseidon/maelstrom-v0147/params.js";
// @ts-expect-error Poseidon source is intentionally preserved as JavaScript.
import { Ocean } from "./poseidon/maelstrom-v0147/Ocean.js";
// @ts-expect-error Poseidon source is intentionally preserved as JavaScript.
import { createOceanSurfaceMaterial } from "./poseidon/maelstrom-v0147/oceanSurfaceMaterial.js";
// @ts-expect-error Poseidon source is intentionally preserved as JavaScript.
import { makeDetailTexture } from "./poseidon/maelstrom-v0147/detailTexture.js";
// @ts-expect-error Poseidon source is intentionally preserved as JavaScript.
import { createSkyDome } from "./poseidon/maelstrom-v0147/sky.js";

// Poseidon is MIT-licensed: https://github.com/owenyuwono/poseidon
export const MAELSTROM_FFT_RESOLUTION = 256;
export const MAELSTROM_CASCADE_COUNT = 3;
export const MAELSTROM_LENGTH_SCALES = [250, 17, 5] as const;

type MaelstromRuntime = {
  start: () => void;
  stop: () => void;
};

export function MaelstromBg() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const active = useDashboardAnimationActive();
  const activeRef = useRef(active);
  const runtimeRef = useRef<MaelstromRuntime | null>(null);

  useEffect(() => {
    const hostElement = hostRef.current;
    if (!hostElement) return;
    const host = hostElement;

    let disposed = false;
    let raf = 0;
    let last = 0;
    let elapsed = 0;
    let renderer: WebGPURenderer | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let oceanGeometry: PlaneGeometry | null = null;
    let oceanMaterial: { dispose: () => void } | null = null;
    let detailTexture: { dispose: () => void } | null = null;

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    }

    async function initialise() {
      if (WebGPU.isAvailable() === false) {
        console.error("Maelstrom requires WebGPU, matching the Poseidon reference renderer.");
        return;
      }

      const colors = params.colors;
      const scene = new Scene();
      scene.fog = new FogExp2(new Color(colors.skyHorizon).getHex(), 0.0045);

      const camera = new PerspectiveCamera(55, 1, 0.5, 30000);
      camera.position.set(0, 16, 68);
      camera.lookAt(0, 0, -20);

      const nextRenderer = new WebGPURenderer({ antialias: true, trackTimestamp: false });
      renderer = nextRenderer;
      nextRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      nextRenderer.setClearColor(new Color(colors.skyHorizon), 1);
      host.appendChild(nextRenderer.domElement);
      await nextRenderer.init();

      if (disposed) return;
      if (!(nextRenderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
        console.error("Maelstrom's Poseidon renderer fell back from WebGPU.");
        return;
      }

      const shading = {
        sunDir: uniform(new Vector3()),
        sunColor: uniform(new Color(colors.sun)),
        horizon: uniform(new Color(colors.skyHorizon)),
        zenith: uniform(new Color(colors.skyZenith)),
        deepColor: uniform(new Color(colors.deep)),
        scatterColor: uniform(new Color(colors.scatter)),
        sssStrength: uniform(params.sssStrength),
        foamColor: uniform(new Color(colors.foam)),
        foamThreshold: uniform(params.foamThreshold),
        foamScale: uniform(params.foamScale),
        detail: uniform(params.detailStrength),
        time: uniform(0),
      };
      const azimuth = MathUtils.degToRad(params.sunAzimuth);
      const elevation = MathUtils.degToRad(params.sunElevation);
      shading.sunDir.value
        .set(
          Math.cos(elevation) * Math.sin(azimuth),
          Math.sin(elevation),
          Math.cos(elevation) * Math.cos(azimuth),
        )
        .normalize();

      scene.add(createSkyDome(shading));

      const ocean = new Ocean(nextRenderer, params);
      await ocean.updateInitialSpectrum();
      if (disposed) return;

      const nextDetailTexture = makeDetailTexture();
      detailTexture = nextDetailTexture;
      const nextOceanMaterial = createOceanSurfaceMaterial(ocean.cascades, {
        lengthScales: params.lengthScales,
        shading,
        detailTex: nextDetailTexture,
      });
      oceanMaterial = nextOceanMaterial;
      oceanGeometry = new PlaneGeometry(400, 400, 900, 900);
      const oceanMesh = new Mesh(oceanGeometry, nextOceanMaterial);
      oceanMesh.frustumCulled = false;
      scene.add(oceanMesh);

      function resize() {
        const rect = host.getBoundingClientRect();
        const width = Math.max(2, Math.floor(rect.width));
        const height = Math.max(2, Math.floor(rect.height));
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        nextRenderer.setSize(width, height);
      }

      function frame(now: number) {
        if (disposed || !activeRef.current) {
          raf = 0;
          return;
        }
        const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
        last = now;
        elapsed += dt * params.timeScale;
        ocean.evolve(elapsed, dt * params.timeScale);
        shading.time.value = elapsed;
        nextRenderer.render(scene, camera);
        raf = requestAnimationFrame(frame);
      }

      function start() {
        if (disposed || raf || !activeRef.current) return;
        last = 0;
        raf = requestAnimationFrame(frame);
      }

      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      resize();
      runtimeRef.current = { start, stop };
      start();
    }

    void initialise().catch((error: unknown) => {
      console.error("Failed to initialise the Poseidon Maelstrom background.", error);
    });

    return () => {
      disposed = true;
      stop();
      resizeObserver?.disconnect();
      resizeObserver = null;
      runtimeRef.current = null;
      oceanGeometry?.dispose();
      oceanMaterial?.dispose();
      detailTexture?.dispose();
      renderer?.dispose();
      renderer?.domElement.remove();
      renderer = null;
    };
  }, []);

  useEffect(() => {
    activeRef.current = active;
    if (active) runtimeRef.current?.start();
    else runtimeRef.current?.stop();
  }, [active]);

  return <div ref={hostRef} className="dw-dynamic-bg-canvas" />;
}
