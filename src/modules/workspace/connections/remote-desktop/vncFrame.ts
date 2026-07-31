export const VNC_FRAME_HEADER_BYTES = 8;
export const VNC_FRAME_RECT_HEADER_BYTES = 18;

export type VncFrameOperation =
  | {
      kind: "raw";
      x: number;
      y: number;
      width: number;
      height: number;
      bytes: Uint8Array;
    }
  | {
      kind: "jpeg";
      x: number;
      y: number;
      width: number;
      height: number;
      bytes: Uint8Array;
    }
  | {
      kind: "copy";
      x: number;
      y: number;
      width: number;
      height: number;
      sourceX: number;
      sourceY: number;
    };

export type VncFrameBatch = {
  operations: VncFrameOperation[];
};

function asBytes(value: ArrayBuffer | Uint8Array) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export function parseVncFrameBatch(value: ArrayBuffer | Uint8Array): VncFrameBatch {
  const bytes = asBytes(value);
  if (bytes.byteLength < VNC_FRAME_HEADER_BYTES) {
    throw new Error("VNC frame batch is truncated.");
  }
  if (bytes[0] !== 0x4b || bytes[1] !== 0x56 || bytes[2] !== 0x46 || bytes[3] !== 0x31) {
    throw new Error("VNC frame batch has an invalid signature.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(4, true) !== 1) {
    throw new Error("VNC frame batch version is not supported.");
  }
  const operationCount = view.getUint16(6, true);
  const operations: VncFrameOperation[] = [];
  let offset = VNC_FRAME_HEADER_BYTES;
  for (let index = 0; index < operationCount; index += 1) {
    if (offset + VNC_FRAME_RECT_HEADER_BYTES > bytes.byteLength) {
      throw new Error("VNC frame rectangle header is truncated.");
    }
    const kind = view.getUint8(offset);
    const x = view.getUint16(offset + 2, true);
    const y = view.getUint16(offset + 4, true);
    const width = view.getUint16(offset + 6, true);
    const height = view.getUint16(offset + 8, true);
    const sourceX = view.getUint16(offset + 10, true);
    const sourceY = view.getUint16(offset + 12, true);
    const payloadLength = view.getUint32(offset + 14, true);
    offset += VNC_FRAME_RECT_HEADER_BYTES;
    if (offset + payloadLength > bytes.byteLength) {
      throw new Error("VNC frame rectangle payload is truncated.");
    }
    if (kind === 2) {
      if (payloadLength !== 0) {
        throw new Error("VNC CopyRect operation contains unexpected pixel data.");
      }
      operations.push({ kind: "copy", x, y, width, height, sourceX, sourceY });
    } else if (kind === 0 || kind === 1) {
      if (kind === 0 && payloadLength !== width * height * 4) {
        throw new Error("VNC raw rectangle has an invalid RGBA payload length.");
      }
      operations.push({
        kind: kind === 0 ? "raw" : "jpeg",
        x,
        y,
        width,
        height,
        bytes: bytes.subarray(offset, offset + payloadLength),
      });
    } else {
      throw new Error(`VNC frame rectangle kind ${kind} is not supported.`);
    }
    offset += payloadLength;
  }
  if (offset !== bytes.byteLength) {
    throw new Error("VNC frame batch contains trailing data.");
  }
  return { operations };
}
