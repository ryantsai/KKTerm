import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";

import { applyHeroGeometricFrame } from "../src/modules/dashboard/registry/componentry/hero-geometric.tsx";

test("Hero Geometric updates the mounted shader material uniforms", async () => {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2() },
      uColor1: { value: new THREE.Color("#000000") },
      uColor2: { value: new THREE.Color("#000000") },
    },
  });

  applyHeroGeometricFrame(
    material,
    2.5,
    { width: 800, height: 600 },
    "#112233",
    "#abcdef",
    2,
  );

  assert.equal(material.uniforms.uTime.value, 5);
  assert.deepEqual(material.uniforms.uResolution.value.toArray(), [800, 600]);
  assert.equal(material.uniforms.uColor1.value.getHexString(), "112233");
  assert.equal(material.uniforms.uColor2.value.getHexString(), "abcdef");

  const source = await readFile(
    new URL("../src/modules/dashboard/registry/componentry/hero-geometric.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /ref=\{materialRef\}/);
  assert.match(source, /applyHeroGeometricFrame\(\s*materialRef\.current/);
});
