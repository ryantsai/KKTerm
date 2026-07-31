import assert from "node:assert/strict";
import test from "node:test";
import { resolveVncPerformanceTuning } from "../src/lib/vncPerformance";

const custom = {
  preferredEncoding: "raw" as const,
  colorLevel: "64" as const,
  compressionLevel: 9,
  jpegQuality: 1,
  jpegEnabled: false,
};

test("VNC fixed presets expose the backend tuning values", () => {
  assert.deepEqual(resolveVncPerformanceTuning("auto", custom), {
    preferredEncoding: "tight",
    colorLevel: "full",
    compressionLevel: 2,
    jpegQuality: 7,
    jpegEnabled: true,
  });
  assert.deepEqual(resolveVncPerformanceTuning("lan", custom), {
    preferredEncoding: "tight",
    colorLevel: "full",
    compressionLevel: 1,
    jpegQuality: 8,
    jpegEnabled: true,
  });
  assert.deepEqual(resolveVncPerformanceTuning("lowBandwidth", custom), {
    preferredEncoding: "tight",
    colorLevel: "full",
    compressionLevel: 6,
    jpegQuality: 4,
    jpegEnabled: true,
  });
  assert.deepEqual(resolveVncPerformanceTuning("lossless", custom), {
    preferredEncoding: "zrle",
    colorLevel: "full",
    compressionLevel: 2,
    jpegQuality: 9,
    jpegEnabled: false,
  });
});

test("VNC custom preserves user tuning", () => {
  assert.equal(resolveVncPerformanceTuning("custom", custom), custom);
});
