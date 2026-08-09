import assert from "node:assert/strict";
import test from "node:test";
import { videoTimelineLayout } from "../src/modules/screenshots/videoTimelineModel.ts";

test("short recordings fill the trim timeline without changing their duration", () => {
  const layout = videoTimelineLayout(7.3, 1160);
  assert.equal(layout.scale, 1);
  assert.equal(layout.scaleCount, 8);
  assert.equal(layout.timelineEnd, 8);
  assert.ok(layout.scaleWidth > 140 && layout.scaleWidth < 145);
  assert.ok(Math.abs(7.3 / layout.timelineEnd - 0.9125) < 0.0001);
});

test("long recordings use readable major ticks and still fit the available width", () => {
  const layout = videoTimelineLayout(125, 1000);
  assert.equal(layout.scale, 15);
  assert.equal(layout.scaleCount, 9);
  assert.equal(layout.timelineEnd, 135);
  assert.ok(layout.scaleWidth > 109 && layout.scaleWidth < 111);
});

test("invalid media metadata produces a safe one-second timeline", () => {
  assert.deepEqual(videoTimelineLayout(Number.NaN, 0), {
    scale: 0.2,
    scaleCount: 5,
    scaleWidth: 48,
    startLeft: 8,
    timelineEnd: 1,
  });
});
