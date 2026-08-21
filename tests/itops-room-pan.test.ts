import assert from "node:assert/strict";
import test from "node:test";
import { isoViewHeightForWidth } from "../src/modules/itops/roomIsoLayout";
import {
  preserveRoomPan,
  roomPanFrame,
  roomScrollCenter,
} from "../src/modules/itops/roomViewport";

test("room pan frame keeps scroll range when the scene fits the viewport", () => {
  const frame = roomPanFrame(
    { w: 800, h: 600 },
    { w: 800, h: 600 },
  );

  assert.ok(frame.insetX > 0);
  assert.ok(frame.insetY > 0);
  assert.ok(frame.w > 800);
  assert.ok(frame.h > 600);
  assert.equal(frame.sceneLeft, frame.insetX);
  assert.equal(frame.sceneTop, frame.insetY);
});

test("room pan frame still surrounds a scene larger than the viewport", () => {
  const frame = roomPanFrame(
    { w: 800, h: 600 },
    { w: 1280, h: 900 },
  );

  assert.equal(frame.w, 1280 + frame.insetX * 2);
  assert.equal(frame.h, 900 + frame.insetY * 2);
});

test("floor-plan pan frame exposes no backdrop margin", () => {
  const frame = roomPanFrame(
    { w: 800, h: 600 },
    { w: 1000, h: 750 },
    false,
  );

  assert.deepEqual(frame, {
    w: 1000,
    h: 750,
    insetX: 0,
    insetY: 0,
    sceneLeft: 0,
    sceneTop: 0,
  });
});

test("room reset centers the scrollable content", () => {
  assert.deepEqual(
    roomScrollCenter({ w: 800, h: 600 }, { w: 1200, h: 900 }),
    { left: 200, top: 150 },
  );
  assert.deepEqual(
    roomScrollCenter({ w: 800, h: 600 }, { w: 700, h: 500 }),
    { left: 0, top: 0 },
  );
});

test("room pan re-centers after a viewport resize while preserving manual offset", () => {
  const previousCenter = { left: 224, top: 224 };
  const resizedCenter = { left: 320, top: 320 };

  assert.deepEqual(
    preserveRoomPan(previousCenter, previousCenter, resizedCenter),
    resizedCenter,
  );
  assert.deepEqual(
    preserveRoomPan(
      { left: previousCenter.left + 48, top: previousCenter.top - 32 },
      previousCenter,
      resizedCenter,
    ),
    { left: resizedCenter.left + 48, top: resizedCenter.top - 32 },
  );
});

test("wide 2.5D floors grow the clip box enough for the bottom point", () => {
  const height = isoViewHeightForWidth(2000, 100);
  assert.ok(height >= Math.ceil((2000 - 48) * Math.cos((55 * Math.PI) / 180)) + 184);
});
