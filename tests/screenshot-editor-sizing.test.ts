import assert from "node:assert/strict";
import test from "node:test";
import { cropImagePlacement, cursorImagePoint, fitImageDimensions } from "../src/modules/screenshots/editorSizing";

test("Fit mode contains a large image inside the padded editor stage", () => {
  assert.deepEqual(
    fitImageDimensions(3840, 2160, 1960, 900, 18),
    { width: 1536, height: 864 },
  );
});

test("Fit mode does not enlarge images that already fit", () => {
  assert.deepEqual(
    fitImageDimensions(640, 480, 1000, 800, 18),
    { width: 640, height: 480 },
  );
});

test("Crop placement preserves transparent padding outside the image", () => {
  assert.deepEqual(
    cropImagePlacement({ x: -120, y: 40, width: 500, height: 300 }, 1000, 800),
    {
      source: { x: 0, y: 40, width: 380, height: 300 },
      destination: { x: 120, y: 0, width: 380, height: 300 },
    },
  );
});

test("The cursor readout reports the same image pixel at every zoom level", () => {
  // Same relative pointer position over a 50%, 100%, and 200% rendering of a
  // 1000x800 image must report one 1x image coordinate.
  assert.deepEqual(cursorImagePoint(125, 100, 500, 400, 1000, 800), { x: 250, y: 200 });
  assert.deepEqual(cursorImagePoint(250, 200, 1000, 800, 1000, 800), { x: 250, y: 200 });
  assert.deepEqual(cursorImagePoint(500, 400, 2000, 1600, 1000, 800), { x: 250, y: 200 });
});

test("The cursor readout stays inside the image bounds", () => {
  assert.deepEqual(cursorImagePoint(0, 0, 1000, 800, 1000, 800), { x: 0, y: 0 });
  assert.deepEqual(cursorImagePoint(1000, 800, 1000, 800, 1000, 800), { x: 999, y: 799 });
  assert.deepEqual(cursorImagePoint(-40, 900, 1000, 800, 1000, 800), { x: 0, y: 799 });
});
