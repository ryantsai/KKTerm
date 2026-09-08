import assert from "node:assert/strict";
import test from "node:test";
import { canOptimizePngs } from "../src/modules/screenshots/libraryModel";

test("PNG optimization requires a nonempty selection containing only PNG images", () => {
  const png = { fileName: "capture.png", mediaType: "image" as const };
  assert.equal(canOptimizePngs([]), false);
  assert.equal(canOptimizePngs([png]), true);
  assert.equal(canOptimizePngs([png, { ...png, fileName: "second.PNG" }]), true);
  for (const fileName of ["photo.jpg", "photo.webp", "animation.gif", "clip.mp4", "no-extension"]) {
    assert.equal(canOptimizePngs([png, { ...png, fileName }]), false);
  }
  assert.equal(canOptimizePngs([{ ...png, mediaType: "video" }]), false);
});
