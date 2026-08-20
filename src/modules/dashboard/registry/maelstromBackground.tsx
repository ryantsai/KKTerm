import { useEffect, useRef } from "react";
import {
  Color,
  MathUtils,
  Mesh,
  NeutralToneMapping,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { uniform } from "three/tsl";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { useDashboardAnimationActive } from "../view/animationGating";

// Poseidon's ocean modules stay in JavaScript so the v0.0.2 implementation is
// preserved apart from the documented multi-instance sky adaptation.
// @ts-expect-error Poseidon source is intentionally preserved as JavaScript.
import { params, applySky, SKIES } from "./poseidon/params.js";
// @ts-expect-error Poseidon source is intentionally preserved as JavaScript.
import { Ocean } from "./poseidon/Ocean.js";
// @ts-expect-error Poseidon source is intentionally preserved as JavaScript.
import { createOceanSurfaceMaterial } from "./poseidon/oceanSurfaceMaterial.js";
// @ts-expect-error Poseidon source is intentionally preserved as JavaScript.
import { makeDetailTexture } from "./poseidon/detailTexture.js";
// @ts-expect-error Poseidon source is intentionally preserved as JavaScript.
import { createSkyDome, loadSkyTexture } from "./poseidon/sky.js";
// @ts-expect-error Poseidon source is intentionally preserved as JavaScript.
import { createRadialGrid } from "./poseidon/oceanGrid.js";
// @ts-expect-error Poseidon source is intentionally preserved as JavaScript.
import { createAerialPerspective } from "./poseidon/atmosphere.js";

// Poseidon is MIT-licensed: https://github.com/owenyuwono/poseidon
export const MAELSTROM_FFT_RESOLUTION = 256;
export const MAELSTROM_CASCADE_COUNT = 3;
export const MAELSTROM_LENGTH_SCALES = [1024, 144, 24] as const;

export type PoseidonOceanSceneId =
  | "maelstrom"
  | "sunGlitter"
  | "whitecaps"
  | "subsurfaceScatter"
  | "waveField"
  | "openOceanBlue"
  | "tropicalGreen";

type PoseidonCamera = {
  position: readonly [number, number, number];
  target?: readonly [number, number, number];
  fov: number;
  sunChase?: boolean;
};

type PoseidonScene = {
  sky: "golden" | "midday";
  palette: 0 | 1;
  camera: PoseidonCamera;
};

// These are Poseidon's v0.0.2 capture framings used for the six README images.
export const POSEIDON_OCEAN_SCENES: Readonly<Record<PoseidonOceanSceneId, PoseidonScene>> = {
  maelstrom: {
    sky: "midday",
    palette: 1,
    camera: { position: [0, 16, 68], target: [0, 2, -20], fov: 55 },
  },
  sunGlitter: {
    sky: "golden",
    palette: 1,
    camera: { position: [0, 6, 0], fov: 60, sunChase: true },
  },
  whitecaps: {
    sky: "golden",
    palette: 1,
    // The current README image replaced the earlier near-field/midday shot
    // with the golden-hour swell framing so every bright mark is foam rather
    // than midday specular reflection.
    camera: { position: [0, 16, 68], target: [0, 2, -20], fov: 55 },
  },
  subsurfaceScatter: {
    sky: "golden",
    palette: 0,
    camera: { position: [-30, 1.4, 20], target: [10, 6, -25], fov: 70 },
  },
  waveField: {
    sky: "midday",
    palette: 1,
    camera: { position: [0, 90, 180], target: [0, 0, -60], fov: 55 },
  },
  openOceanBlue: {
    sky: "midday",
    palette: 1,
    camera: { position: [0, 9, 40], target: [0, 0.5, -90], fov: 62 },
  },
  tropicalGreen: {
    sky: "midday",
    palette: 0,
    camera: { position: [0, 9, 40], target: [0, 0.5, -90], fov: 62 },
  },
};

type PoseidonRuntime = {
  start: () => void;
  stop: () => void;
};

function clonePoseidonParams(scene: PoseidonScene) {
  const sceneParams = JSON.parse(JSON.stringify(params));
  sceneParams.sky = scene.sky;
  sceneParams.palette = scene.palette;
  applySky(sceneParams);
  return sceneParams;
}

function aimCamera(camera: PerspectiveCamera, scene: PoseidonScene, sceneParams: typeof params) {
  const { position, target, fov, sunChase } = scene.camera;
  camera.position.set(...position);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  if (sunChase) {
    const azimuth = MathUtils.degToRad(sceneParams.sunAzimuth);
    const elevation = Math.min(MathUtils.degToRad(sceneParams.sunElevation), 0.3);
    camera.lookAt(
      position[0] + Math.cos(elevation) * Math.sin(azimuth) * 100,
      position[1] + Math.sin(elevation) * 100,
      position[2] + Math.cos(elevation) * Math.cos(azimuth) * 100,
    );
    return;
  }
  if (target) camera.lookAt(...target);
}

function PoseidonOceanBg({ sceneId }: { sceneId: PoseidonOceanSceneId }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const active = useDashboardAnimationActive();
  const activeRef = useRef(active);
  const runtimeRef = useRef<PoseidonRuntime | null>(null);

  useEffect(() => {
    const hostElement = hostRef.current;
    if (!hostElement) return;
    const host = hostElement;
    const sceneConfig = POSEIDON_OCEAN_SCENES[sceneId];
    const sceneParams = clonePoseidonParams(sceneConfig);

    let disposed = false;
    let raf = 0;
    let last = 0;
    let elapsed = 0;
    let renderer: WebGPURenderer | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let oceanGeometry: { dispose: () => void } | null = null;
    let oceanMaterial: { dispose: () => void } | null = null;
    let detailTexture: { dispose: () => void } | null = null;
    let skyTexture: { dispose: () => void } | null = null;
    let skyGeometry: { dispose: () => void } | null = null;
    let skyMaterial: { dispose: () => void } | null = null;

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    }

    async function initialise() {
      if (WebGPU.isAvailable() === false) {
        console.error(`${sceneId} requires WebGPU, matching the Poseidon v0.0.2 renderer.`);
        return;
      }

      const colors = sceneParams.colors;
      const scene = new Scene();
      const camera = new PerspectiveCamera(55, 1, 0.5, 60000);
      aimCamera(camera, sceneConfig, sceneParams);

      const nextRenderer = new WebGPURenderer({ antialias: true, trackTimestamp: false });
      renderer = nextRenderer;
      nextRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      nextRenderer.setClearColor(new Color(colors.skyHorizon), 1);
      nextRenderer.toneMapping = NeutralToneMapping;
      nextRenderer.toneMappingExposure = sceneParams.exposure ?? 1.2;
      host.appendChild(nextRenderer.domElement);
      await nextRenderer.init();

      if (disposed) return;
      if (!(nextRenderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
        console.error(`${sceneId}'s Poseidon renderer fell back from WebGPU.`);
        return;
      }

      const skyDefinition = SKIES[sceneParams.sky];
      const nextSkyTexture = loadSkyTexture(sceneParams.sky);
      skyTexture = nextSkyTexture;
      const shading = {
        sunDir: uniform(new Vector3()),
        sunColor: uniform(new Color(colors.sun).multiplyScalar(sceneParams.sunIntensity)),
        horizon: uniform(new Color(colors.skyHorizon)),
        zenith: uniform(new Color(colors.skyZenith)),
        ambient: uniform(new Color(colors.ambient)),
        deepColor: uniform(new Color(colors.deep)),
        scatterColor: uniform(new Color(colors.scatter)),
        palette: uniform(sceneParams.palette),
        sssStrength: uniform(sceneParams.sssStrength),
        foamColor: uniform(new Color(colors.foam)),
        foamThreshold: uniform(sceneParams.foamThreshold),
        foamScale: uniform(sceneParams.foamScale),
        foamBright: uniform(sceneParams.foamBright),
        foamRelief: uniform(sceneParams.foamRelief),
        foamMilk: uniform(sceneParams.foamMilk),
        detail: uniform(sceneParams.detailStrength),
        time: uniform(0),
        originXZ: uniform(new Vector2()),
        hazeWater: uniform(1 / skyDefinition.hazeWater),
        hazeAir: uniform(1 / skyDefinition.hazeAir),
        specBoost: uniform(skyDefinition.specBoost ?? 0),
        skyTexture: nextSkyTexture,
        skyKnee: uniform(skyDefinition.knee),
        skyBoost: uniform(skyDefinition.boost),
      };
      const azimuth = MathUtils.degToRad(sceneParams.sunAzimuth);
      const elevation = MathUtils.degToRad(sceneParams.sunElevation);
      shading.sunDir.value
        .set(
          Math.cos(elevation) * Math.sin(azimuth),
          Math.sin(elevation),
          Math.cos(elevation) * Math.cos(azimuth),
        )
        .normalize();

      const skyDome = createSkyDome(shading, 45000);
      skyGeometry = skyDome.geometry;
      skyMaterial = skyDome.material;
      scene.add(skyDome);
      scene.fogNode = createAerialPerspective(shading, { density: shading.hazeAir });

      const nextDetailTexture = makeDetailTexture();
      detailTexture = nextDetailTexture;
      const ocean = new Ocean(nextRenderer, sceneParams);
      await ocean.updateInitialSpectrum();
      if (disposed) return;

      const nextOceanMaterial = createOceanSurfaceMaterial(ocean.cascades, {
        lengthScales: sceneParams.lengthScales,
        shading,
        detailTex: nextDetailTexture,
      });
      oceanMaterial = nextOceanMaterial;
      const grid = createRadialGrid({ rings: 620, sectors: 1280, spacing: 0.35, soften: 41 });
      oceanGeometry = grid.geometry;
      const oceanMesh = new Mesh(grid.geometry, nextOceanMaterial);
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
        elapsed += dt * sceneParams.timeScale;
        ocean.evolve(elapsed, dt * sceneParams.timeScale);
        shading.time.value = elapsed;

        const originX = Math.round(camera.position.x / grid.innerSpacing) * grid.innerSpacing;
        const originZ = Math.round(camera.position.z / grid.innerSpacing) * grid.innerSpacing;
        oceanMesh.position.set(originX, 0, originZ);
        shading.originXZ.value.set(originX, originZ);
        skyDome.position.copy(camera.position);

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
      console.error(`Failed to initialise the Poseidon ${sceneId} background.`, error);
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
      skyTexture?.dispose();
      skyGeometry?.dispose();
      skyMaterial?.dispose();
      renderer?.dispose();
      renderer?.domElement.remove();
      renderer = null;
    };
  }, [sceneId]);

  useEffect(() => {
    activeRef.current = active;
    if (active) runtimeRef.current?.start();
    else runtimeRef.current?.stop();
  }, [active]);

  return <div ref={hostRef} className="dw-dynamic-bg-canvas" />;
}

export function MaelstromBg() {
  return <PoseidonOceanBg sceneId="maelstrom" />;
}

export function SunGlitterBg() {
  return <PoseidonOceanBg sceneId="sunGlitter" />;
}

export function WhitecapsBg() {
  return <PoseidonOceanBg sceneId="whitecaps" />;
}

export function SubsurfaceScatterBg() {
  return <PoseidonOceanBg sceneId="subsurfaceScatter" />;
}

export function WaveFieldBg() {
  return <PoseidonOceanBg sceneId="waveField" />;
}

export function OpenOceanBlueBg() {
  return <PoseidonOceanBg sceneId="openOceanBlue" />;
}

export function TropicalGreenBg() {
  return <PoseidonOceanBg sceneId="tropicalGreen" />;
}
