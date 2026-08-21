import { useEffect, useRef } from "react";
import {
  Color,
  Mesh,
  NoToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  WebGPURenderer,
} from "three/webgpu";
import type { BufferGeometry, DirectionalLight, Group, Material, Texture } from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { useDashboardAnimationActive } from "../view/animationGating";

import {
  bakeSkyEnvironment,
  CausticsPass,
  createSandMaterial,
  createSkyDome,
  createSunLight,
  Rng,
  runFftSelfTest,
  SKY_ENVIRONMENT_INTENSITY,
  SubmergedOcean,
  UnderwaterMediumPipeline,
} from "./submergedSnellOcean/underwater-snell-ocean";
import { createSaucerSeabedGeometry, createWaterlineTower, TOWER_Z } from "./submergedSnellOcean/scene-props";

/**
 * A fully submerged view near the seabed, looking up through the rippled
 * ocean surface at a waterline tower crossing the Snell's-window cone. This
 * is a faithful port of the reference gallery's submerged-snell-ocean
 * scene.js: real SubmergedOcean/CausticsPass/UnderwaterMediumPipeline optics
 * (vendored verbatim under ./submergedSnellOcean), not an approximated
 * shader silhouette. The camera is static, matching this background's fixed
 * framing — there is no orbit/pan control here.
 */
const CAMERA_POSITION: [number, number, number] = [19, -23.17, -22];
const CAMERA_TARGET: [number, number, number] = [7.2, 1.54, -35.73];
const CLEAR_COLOR = 0x061b2d;
const INITIAL_ELAPSED_SECONDS = 28;

type SubmergedSnellOceanRuntime = {
  start: () => void;
  stop: () => void;
};

export function SubmergedSnellOceanBg() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const active = useDashboardAnimationActive();
  const activeRef = useRef(active);
  const runtimeRef = useRef<SubmergedSnellOceanRuntime | null>(null);

  useEffect(() => {
    const hostElement = hostRef.current;
    if (!hostElement) return;
    const host = hostElement;

    let disposed = false;
    let raf = 0;
    let last = 0;
    let elapsed = INITIAL_ELAPSED_SECONDS;
    let renderer: WebGPURenderer | null = null;
    let resizeObserver: ResizeObserver | null = null;

    // Populated once initialise() completes; torn down in the effect cleanup.
    let scene: Scene | null = null;
    let seabed: Mesh | null = null;
    let seabedGeometry: BufferGeometry | null = null;
    let seabedMaterial: Material | null = null;
    let skyDome: Mesh | null = null;
    let skyEnvironment: { texture: Texture; dispose: () => void } | null = null;
    let towerGroup: Group | null = null;
    let towerMaterials: Material[] = [];
    let sunLight: DirectionalLight | null = null;
    let ocean: SubmergedOcean | null = null;
    let caustics: CausticsPass | null = null;
    let medium: UnderwaterMediumPipeline | null = null;

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    }

    async function initialise() {
      if (WebGPU.isAvailable() === false) {
        console.error("Submerged Snell ocean requires WebGPU, matching the reference renderer.");
        return;
      }

      const nextScene = new Scene();
      scene = nextScene;
      const camera = new PerspectiveCamera(50, 1, 0.1, 5000);
      camera.position.set(...CAMERA_POSITION);
      camera.lookAt(...CAMERA_TARGET);

      const nextRenderer = new WebGPURenderer({ antialias: false });
      renderer = nextRenderer;
      nextRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      nextRenderer.setClearColor(new Color(CLEAR_COLOR), 1);
      nextRenderer.toneMapping = NoToneMapping;
      nextRenderer.toneMappingExposure = 1;
      host.appendChild(nextRenderer.domElement);
      await nextRenderer.init();

      if (disposed) return;
      if (!(nextRenderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
        console.error("Submerged Snell ocean's renderer fell back from WebGPU.");
        return;
      }

      nextRenderer.shadowMap.enabled = true;
      nextRenderer.shadowMap.type = PCFSoftShadowMap;

      // A correctness self-check on the WebGPU-compute IFFT, not a rendering
      // requirement: warn rather than throw so a false negative in this
      // environment cannot blank a decorative background.
      try {
        const fftValidation = await runFftSelfTest(nextRenderer);
        if (fftValidation.maxErrorConstant >= 1e-3 || fftValidation.maxErrorWave >= 1e-3) {
          console.warn(
            `Submerged Snell ocean: IFFT self-test exceeded tolerance (constant=${fftValidation.maxErrorConstant}, wave=${fftValidation.maxErrorWave}).`,
          );
        }
      } catch (fftError) {
        console.warn("Submerged Snell ocean: IFFT self-test failed to run.", fftError);
      }
      if (disposed) return;

      const sky = createSkyDome();
      skyDome = sky;
      nextScene.add(sky);
      const environment = bakeSkyEnvironment(nextRenderer, sky);
      skyEnvironment = environment;
      nextScene.environment = environment.texture;
      nextScene.environmentIntensity = SKY_ENVIRONMENT_INTENSITY;

      const sun = createSunLight(2048);
      sunLight = sun;
      sun.shadow.camera.left = -80;
      sun.shadow.camera.right = 80;
      sun.shadow.camera.top = 80;
      sun.shadow.camera.bottom = -80;
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 900;
      nextScene.add(sun, sun.target);

      const nextOcean = new SubmergedOcean(nextScene, new Rng(19051906), { segments: 384 });
      ocean = nextOcean;
      const nextCaustics = new CausticsPass(nextOcean.simulation, 1024);
      caustics = nextCaustics;
      const nextMedium = new UnderwaterMediumPipeline(nextRenderer, nextScene, camera, nextCaustics, {
        godraySteps: 14,
        particulateCount: 18_000,
        submerged: nextOcean.submerged,
      });
      medium = nextMedium;

      const nextSeabedMaterial = createSandMaterial((material, strength) =>
        nextMedium.applyCaustics(material, strength),
      );
      seabedMaterial = nextSeabedMaterial;
      const seabedGeom = createSaucerSeabedGeometry();
      seabedGeometry = seabedGeom;
      const nextSeabed = new Mesh(seabedGeom, nextSeabedMaterial);
      seabed = nextSeabed;
      nextSeabed.receiveShadow = true;
      nextScene.add(nextSeabed);

      const tower = createWaterlineTower(nextMedium);
      towerGroup = tower.group;
      towerMaterials = tower.materials;
      tower.group.position.z = TOWER_Z;
      nextScene.add(tower.group);
      // The tower's air-side geometry is registered with the interface layer, so
      // the Snell window shows its forward-refracted image instead of bare sky.
      nextOcean.register({
        name: "waterline tower",
        root: tower.group,
        meshes: tower.airSide,
        maxEdgeLength: 1.2,
        minimumLocalY: -0.1,
        stableMeanSurface: true,
        liveInterfaceMotion: true,
        underwaterOnly: true,
        maxCameraDistance: 130,
      });

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
        elapsed += dt;
        nextOcean.update(nextRenderer, camera, nextScene, elapsed, Math.max(dt, 1 / 120));
        nextCaustics.update(nextRenderer);
        nextMedium.update(elapsed);
        sky.position.copy(camera.position);
        // UnderwaterMediumPipeline.render() draws the composited output via its
        // own internal RenderPipeline; it replaces renderer.render(scene, camera).
        nextMedium.render();
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
      console.error("Failed to initialise the Submerged Snell Ocean background.", error);
    });

    return () => {
      disposed = true;
      stop();
      resizeObserver?.disconnect();
      resizeObserver = null;
      runtimeRef.current = null;

      medium?.dispose();
      caustics?.dispose();
      if (ocean && scene) ocean.dispose(scene);
      if (scene) {
        if (seabed) scene.remove(seabed);
        if (skyDome) scene.remove(skyDome);
        if (towerGroup) scene.remove(towerGroup);
        if (sunLight) scene.remove(sunLight, sunLight.target);
        scene.environment = null;
      }
      skyEnvironment?.dispose();
      seabedGeometry?.dispose();
      seabedMaterial?.dispose();
      skyDome?.geometry.dispose();
      (skyDome?.material as Material | undefined)?.dispose();
      if (towerGroup) {
        const geometries = new Set<BufferGeometry>();
        towerGroup.traverse((object) => {
          if ((object as Mesh).isMesh) geometries.add((object as Mesh).geometry);
        });
        for (const geometry of geometries) geometry.dispose();
      }
      for (const material of towerMaterials) material.dispose();

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
