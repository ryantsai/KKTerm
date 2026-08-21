import * as THREE from "three";
import { WebGLBackgroundCanvas, type WebGLBackgroundHandle } from "./webglBackgroundHost";

// Spectral Cascade Ocean modules stay in JavaScript so the source example
// (real GPU-FFT Phillips/JONSWAP ocean: spectrum -> IFFT -> displacement +
// derivative maps) is preserved verbatim, matching the convention used by
// maelstromBackground.tsx for its sibling Poseidon ocean modules.
// @ts-expect-error Spectral Cascade Ocean source is intentionally preserved as JavaScript.
import { SpectralOceanSystem } from "./spectralCascadeOcean/ocean-system.js";
// @ts-expect-error Spectral Cascade Ocean source is intentionally preserved as JavaScript.
import { createOceanMaterial, updateOceanMaterialTextures, createSkyMaterial } from "./spectralCascadeOcean/ocean-material.js";
// @ts-expect-error Spectral Cascade Ocean source is intentionally preserved as JavaScript.
import { createOceanDetailTexture } from "./spectralCascadeOcean/detail-texture.js";

// Every parameter below (cascades, spectrum, sun, camera, colors) matches
// the reference gallery's own scene.js exactly, so the look matches the
// real sample instead of an approximation.
const PATCH_LENGTHS: [number, number, number] = [250, 17, 5];
const CLEAR_COLOR = 0x9fb8cc;
const INITIAL_ELAPSED_SECONDS = 18.5;

function setup(_canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer): WebGLBackgroundHandle {
  renderer.setClearColor(CLEAR_COLOR, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(CLEAR_COLOR, 0.0045);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 30000);
  camera.position.set(0, 16, 68);
  camera.lookAt(0, 0, -20);

  const sunAzimuth = THREE.MathUtils.degToRad(135);
  const sunElevation = THREE.MathUtils.degToRad(28);
  const sunDirection = new THREE.Vector3(
    Math.cos(sunElevation) * Math.sin(sunAzimuth),
    Math.sin(sunElevation),
    Math.cos(sunElevation) * Math.cos(sunAzimuth),
  ).normalize();

  const detailTexture = createOceanDetailTexture();

  const oceanOptions = {
    resolution: 256,
    patchLengths: PATCH_LENGTHS,
    boundaryFactor: 6,
    gravity: 9.81,
    depth: 500,
    choppiness: 1.3,
    foamRecovery: 0.4,
    amplitude: 1,
    seed: 481516,
    sunDirection,
    detailTexture,
    local: {
      scale: 1,
      windSpeed: 16,
      directionDegrees: 45,
      fetchMeters: 100000,
      directionality: 1,
      swell: 0.2,
      peakEnhancement: 3.3,
      shortWaveFade: 0.02,
    },
    swell: {
      scale: 0.8,
      windSpeed: 2,
      directionDegrees: 70,
      fetchMeters: 300000,
      directionality: 1,
      swell: 1,
      peakEnhancement: 3.3,
      shortWaveFade: 0.01,
    },
  };

  const oceanSystem = new SpectralOceanSystem(renderer, oceanOptions);

  const oceanGeometry = new THREE.PlaneGeometry(400, 400, 900, 900);
  oceanGeometry.rotateX(-Math.PI / 2);
  const oceanMaterial = createOceanMaterial(oceanSystem.cascades, oceanOptions);
  const oceanMesh = new THREE.Mesh(oceanGeometry, oceanMaterial);
  oceanMesh.frustumCulled = false;
  scene.add(oceanMesh);

  const skyGeometry = new THREE.SphereGeometry(12000, 48, 24);
  const skyMaterial = createSkyMaterial(oceanOptions);
  const skyMesh = new THREE.Mesh(skyGeometry, skyMaterial);
  scene.add(skyMesh);

  let elapsed = INITIAL_ELAPSED_SECONDS;

  return {
    render(_width, _height, _time, dt) {
      elapsed += Math.max(dt, 1 / 120);
      oceanSystem.update(elapsed, Math.max(dt, 1 / 120));
      updateOceanMaterialTextures(oceanMaterial, oceanSystem.cascades);
      oceanMaterial.uniforms.time.value = elapsed;
      renderer.render(scene, camera);
    },
    onResize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    dispose() {
      oceanGeometry.dispose();
      oceanMaterial.dispose();
      skyGeometry.dispose();
      skyMaterial.dispose();
      detailTexture.dispose();
      // SpectralOceanSystem/SpectralCascade don't expose a top-level
      // dispose(); reach the render targets, FFT pipelines, and compute
      // materials each cascade holds directly (see ocean-system.js).
      for (const cascade of oceanSystem.cascades as Array<{
        spectrum?: { dispose(): void };
        heightFrequency?: { dispose(): void };
        horizontalFrequency?: { dispose(): void };
        heightIFFT?: { dispose(): void };
        horizontalIFFT?: { dispose(): void };
        displacementTargets?: Array<{ dispose(): void }>;
        derivatives?: { dispose(): void };
        mesh?: { geometry?: { dispose(): void } };
        heightEvolution?: { dispose(): void };
        horizontalEvolution?: { dispose(): void };
        assembleDisplacement?: { dispose(): void };
        assembleDerivatives?: { dispose(): void };
      }>) {
        cascade.spectrum?.dispose();
        cascade.heightFrequency?.dispose();
        cascade.horizontalFrequency?.dispose();
        cascade.heightIFFT?.dispose();
        cascade.horizontalIFFT?.dispose();
        cascade.displacementTargets?.forEach((target) => target.dispose());
        cascade.derivatives?.dispose();
        cascade.mesh?.geometry?.dispose();
        cascade.heightEvolution?.dispose();
        cascade.horizontalEvolution?.dispose();
        cascade.assembleDisplacement?.dispose();
        cascade.assembleDerivatives?.dispose();
      }
    },
  };
}

export function SpectralCascadeOceanBg() {
  return <WebGLBackgroundCanvas setup={setup} />;
}
