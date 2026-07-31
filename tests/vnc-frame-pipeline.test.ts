import assert from "node:assert/strict";
import test from "node:test";
import {
  parseVncFrameBatch,
  VNC_FRAME_HEADER_BYTES,
  VNC_FRAME_RECT_HEADER_BYTES,
} from "../src/modules/workspace/connections/remote-desktop/vncFrame";

function pushU16(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushU32(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function pushRect(
  bytes: number[],
  kind: number,
  rect: { x: number; y: number; width: number; height: number; sourceX?: number; sourceY?: number },
  payload: number[] = [],
) {
  bytes.push(kind, 0);
  pushU16(bytes, rect.x);
  pushU16(bytes, rect.y);
  pushU16(bytes, rect.width);
  pushU16(bytes, rect.height);
  pushU16(bytes, rect.sourceX ?? 0);
  pushU16(bytes, rect.sourceY ?? 0);
  pushU32(bytes, payload.length);
  bytes.push(...payload);
}

test("VNC binary frame batches preserve raw, JPEG, and CopyRect operations", () => {
  const bytes = [0x4b, 0x56, 0x46, 0x31];
  pushU16(bytes, 1);
  pushU16(bytes, 3);
  pushRect(bytes, 0, { x: 1, y: 2, width: 1, height: 1 }, [10, 20, 30, 255]);
  pushRect(bytes, 1, { x: 4, y: 5, width: 20, height: 10 }, [0xff, 0xd8, 0xff, 0xd9]);
  pushRect(bytes, 2, { x: 7, y: 8, width: 9, height: 10, sourceX: 11, sourceY: 12 });

  const batch = parseVncFrameBatch(Uint8Array.from(bytes));

  assert.equal(VNC_FRAME_HEADER_BYTES, 8);
  assert.equal(VNC_FRAME_RECT_HEADER_BYTES, 18);
  assert.deepEqual(batch.operations.map((operation) => operation.kind), ["raw", "jpeg", "copy"]);
  assert.deepEqual([...batch.operations[0].bytes], [10, 20, 30, 255]);
  assert.deepEqual([...batch.operations[1].bytes], [0xff, 0xd8, 0xff, 0xd9]);
  assert.deepEqual(batch.operations[2], {
    kind: "copy",
    x: 7,
    y: 8,
    width: 9,
    height: 10,
    sourceX: 11,
    sourceY: 12,
  });
});

test("VNC binary frame batches reject truncated pixel data", () => {
  const bytes = [0x4b, 0x56, 0x46, 0x31];
  pushU16(bytes, 1);
  pushU16(bytes, 1);
  pushRect(bytes, 0, { x: 0, y: 0, width: 1, height: 1 }, [1, 2, 3, 4]);
  bytes.pop();

  assert.throws(() => parseVncFrameBatch(Uint8Array.from(bytes)), /truncated/i);
});

