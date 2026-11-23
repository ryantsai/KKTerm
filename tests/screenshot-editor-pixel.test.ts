import assert from "node:assert/strict";
import test from "node:test";
import { sourcePixelColor } from "../src/modules/screenshots/editorPixel";
import { cursorImagePoint } from "../src/modules/screenshots/editorSizing";

// Distinct pixels make an off-by-one, crop-origin or zoom error observable.
function sourceImage() {
  const width = 4;
  const height = 3;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels.set([x * 50, y * 60, x + y, x === 0 ? 128 : 255], (y * width + x) * 4);
    }
  }
  const reads: number[][] = [];
  return {
    canvas: { width, height },
    reads,
    getImageData(x: number, y: number, w: number, h: number): ImageData {
      assert.equal(w, 1);
      assert.equal(h, 1);
      assert.ok(x >= 0 && x < width && y >= 0 && y < height);
      reads.push([x, y]);
      const offset = (y * width + x) * 4;
      return { data: pixels.slice(offset, offset + 4), width: 1, height: 1, colorSpace: "srgb" };
    },
  };
}

test("pixel color follows image coordinates at every zoom and viewport position", () => {
  const source = sourceImage();
  for (const zoom of [0.25, 0.5, 1, 1.25, 2]) {
    // Offsets are relative to the canvas rect, so scrolling/panning its screen
    // origin never changes the source pixel selected by a given image position.
    for (const left of [-120, 0, 350]) {
      const clientX = left + 2.5 * zoom;
      const point = cursorImagePoint(clientX - left, 1.5 * zoom, 4 * zoom, 3 * zoom, 4, 3);
      assert.deepEqual(sourcePixelColor(source, point, null), { red: 100, green: 60, blue: 3, alpha: 255 });
    }
  }
});

test("cropped coordinates sample the original source and retain its alpha", () => {
  const source = sourceImage();
  assert.deepEqual(
    sourcePixelColor(source, { x: 1, y: 0 }, { x: 1, y: 2, width: 3, height: 1 }),
    { red: 100, green: 120, blue: 4, alpha: 255 },
  );
  assert.deepEqual(
    sourcePixelColor(source, { x: 0, y: 0 }, { x: 0, y: 1, width: 2, height: 2 }),
    { red: 0, green: 60, blue: 1, alpha: 128 },
  );
  assert.deepEqual(source.reads, [[2, 2], [0, 1]]);
});

test("crop padding samples transparent pixels without reading outside the source", () => {
  const source = sourceImage();
  const crop = { x: -1, y: -1, width: 6, height: 5 };
  for (const point of [{ x: 0, y: 0 }, { x: 5, y: 4 }, { x: 2, y: 4 }]) {
    assert.deepEqual(sourcePixelColor(source, point, crop), { red: 0, green: 0, blue: 0, alpha: 0 });
  }
  assert.deepEqual(source.reads, []);
  assert.deepEqual(sourcePixelColor(source, { x: 3, y: 2 }, crop), { red: 100, green: 60, blue: 3, alpha: 255 });
});

test("invalid or stale coordinates and failed readbacks do not expose a stale color", () => {
  const source = sourceImage();
  for (const point of [{ x: -1, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }, { x: 1.5, y: 0 }, { x: NaN, y: 1 }]) {
    assert.equal(sourcePixelColor(source, point, null), null);
  }
  assert.equal(sourcePixelColor(source, { x: 2, y: 0 }, { x: 1, y: 0, width: 2, height: 1 }), null);
  assert.deepEqual(source.reads, []);
  assert.equal(sourcePixelColor({
    canvas: source.canvas,
    getImageData() { throw new Error("readback unavailable"); },
  }, { x: 0, y: 0 }, null), null);
});
