import assert from "node:assert/strict";
import test from "node:test";
import type { Rack, Site } from "../src/types";
import {
  createItOpsPdfBytes,
  rackPdfDocument,
  serverRoomPdfDocument,
  type ItOpsExportLabels,
} from "../src/modules/itops/itopsExport";

const labels: ItOpsExportLabels = {
  devices: "Devices", noRacks: "No racks", noDevices: "No devices", inventory: "Inventory",
  rack: "Rack", group: "Group", ungrouped: "Ungrouped", startU: "Start U", heightU: "Height U",
  mountingSide: "Mounting side",
  type: "Type", label: "Label", status: "Status", connection: "Connection", specs: "Specs", tags: "Tags",
  deviceCount: (count) => `${count} devices`, faceLabel: (face) => face, statusLabel: (status) => status,
};
const site = { id: "site-1", name: "Taipei", connectionIds: [], filter: null } as Site;
const rack = {
  id: "rack-1", siteId: site.id, name: "Core Rack", serverRoom: "Room A", rackGroup: "Network",
  heightU: 42, depthMm: 1000,
  items: [{ id: "device-1", rackId: "rack-1", kind: "switch", label: "Distribution Switch",
    startU: 20, heightU: 2, metadata: { status: "warning", ports: 48, tags: ["core"] } }],
} as Rack;

test("IT Ops PDF contains vector rack graphics and inventory data", () => {
  const document = rackPdfDocument({ site, rack, roomName: rack.serverRoom, unassignedLabel: "Unassigned",
    labels, kindLabel: (kind) => kind });
  const pdf = new TextDecoder().decode(createItOpsPdfBytes(document));
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /\/MediaBox \[0 0 792 612\]/);
  assert.match(pdf, /Distribution Switch/);
  assert.match(pdf, /Inventory/);
  assert.match(pdf, / re B/);
  assert.match(pdf, / m .* l S/);
  assert.ok((pdf.match(/\/Type \/Page\b/g) ?? []).length >= 2);
});

test("IT Ops PDF preserves non-ASCII labels as rendered text masks", () => {
  const originalDocument = globalThis.document;
  const canvasContext = {
    font: "",
    fillStyle: "",
    textBaseline: "alphabetic",
    measureText: (value: string) => ({
      width: value.length * 18,
      actualBoundingBoxAscent: 20,
      actualBoundingBoxDescent: 5,
    }),
    fillText: () => undefined,
    getImageData: (_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255;
      return { data };
    },
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => canvasContext,
      }),
    },
  });

  try {
    const unicodeSite = { ...site, name: "臺北" };
    const unicodeRack = { ...rack, name: "網路機櫃", items: [{ ...rack.items[0], label: "核心交換器" }] };
    const document = rackPdfDocument({
      site: unicodeSite,
      rack: unicodeRack,
      roomName: "機房",
      unassignedLabel: "未分配",
      labels: { ...labels, inventory: "設備清冊", devices: "設備" },
      kindLabel: () => "交換器",
    });
    const pdf = new TextDecoder().decode(createItOpsPdfBytes(document));

    assert.match(pdf, /\/ImageMask true/);
    assert.match(pdf, /\/UnicodeText\b/);
    assert.doesNotMatch(pdf, /\(\?+\) Tj/);
  } finally {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
  }
});

test("Server Room PDF uses the same natural Rack order as elevation view", () => {
  const roomRacks = [
    { ...rack, id: "C2", name: "C2", rackGroup: "C", sortOrder: 0 },
    { ...rack, id: "C1", name: "C1", rackGroup: "C", sortOrder: 1 },
    { ...rack, id: "A10", name: "A10", rackGroup: "A", sortOrder: 2 },
    { ...rack, id: "A2", name: "A2", rackGroup: "A", sortOrder: 3 },
  ];

  const document = serverRoomPdfDocument({
    site,
    roomName: "Room A",
    racks: roomRacks,
    unassignedLabel: "Unassigned",
    labels,
    kindLabel: (kind) => kind,
  });

  assert.deepEqual(document.racks.map((entry) => entry.name), ["A2", "A10", "C1", "C2"]);
  assert.deepEqual(roomRacks.map((entry) => entry.name), ["C2", "C1", "A10", "A2"]);
});
