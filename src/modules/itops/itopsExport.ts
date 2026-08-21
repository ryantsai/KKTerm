import { isTauriRuntime, pickAndSaveFile, type WidgetFilePickFilter } from "../../lib/tauri";
import type { Rack, RackItem, RackMountFace, Site } from "../../types";
import { groupRackTopology, topologyGroupKey } from "./rackTopology";
import { sortRacksForElevation } from "./roomElevationLayout";
import type { FreePlacementMap } from "./siteTreeState";
import { normalizeRackItemMetadata, summarizeRackDeviceMetadata } from "./rackInventory";
import { rackItemXSpan } from "./rackPlacement";

export type ItOpsExportFormat = "pdf" | "excel";

export interface ItOpsPdfDocument {
  title: string;
  scope: "site" | "serverRoom" | "rack";
  racks: Rack[];
  rooms: Array<{ name: string; racks: Rack[] }>;
  labels: ItOpsExportLabels;
  kindLabel: (kind: RackItem["kind"]) => string;
}

export interface ItOpsExportLabels {
  devices: string;
  noRacks: string;
  noDevices: string;
  inventory: string;
  rack: string;
  group: string;
  ungrouped: string;
  startU: string;
  heightU: string;
  mountingSide: string;
  type: string;
  label: string;
  status: string;
  connection: string;
  specs: string;
  tags: string;
  deviceCount: (count: number) => string;
  faceLabel: (face: RackMountFace) => string;
  statusLabel: (status: string) => string;
}

const encoder = new TextEncoder();

interface PdfTextMaskCommand {
  kind: "textMask";
  x: number;
  y: number;
  size: number;
  value: string;
  color: string;
}

type PdfCommand = string | PdfTextMaskCommand;

function escapedPdfText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;

function pdfText(
  x: number,
  y: number,
  size: number,
  value: string,
  color = "0.12 0.16 0.22",
): PdfCommand {
  return /[^\x20-\x7e]/.test(value)
    ? { kind: "textMask", x, y, size, value, color }
    : `${color} rg BT /F1 ${size} Tf ${x} ${y} Td (${escapedPdfText(value)}) Tj ET`;
}

function pdfRect(x: number, y: number, width: number, height: number, fill: string, stroke = fill) {
  return `${fill} rg ${stroke} RG ${x} ${y} ${width} ${height} re B`;
}

function truncate(value: string, length: number) {
  const characters = [...value];
  return characters.length > length
    ? `${characters.slice(0, Math.max(1, length - 3)).join("")}...`
    : value;
}

function itemColor(item: RackItem): string {
  const status = normalizeRackItemMetadata(item.metadata ?? {}).status ?? "online";
  if (status === "offline") return "0.77 0.25 0.27";
  if (status === "warning") return "0.91 0.61 0.16";
  switch (item.kind) {
    case "switch":
    case "router": return "0.20 0.55 0.78";
    case "storage": return "0.43 0.38 0.75";
    case "pdu":
    case "ups": return "0.18 0.62 0.55";
    case "firewall": return "0.82 0.38 0.20";
    default: return "0.28 0.34 0.43";
  }
}

function rackFaceDrawing(
  rack: Rack,
  face: RackMountFace,
  x: number,
  y: number,
  width: number,
  height: number,
  kindLabel: (kind: RackItem["kind"]) => string,
): PdfCommand[] {
  const commands: PdfCommand[] = [
    pdfRect(x, y, width, height, "0.10 0.13 0.18", "0.37 0.43 0.51"),
  ];
  const gutter = Math.max(4, Math.min(18, width * 0.16));
  const bayX = x + gutter;
  const bayWidth = width - gutter - 5;
  const unitHeight = height / rack.heightU;
  const step = rack.heightU > 24 ? 2 : 1;
  for (let u = step; u < rack.heightU; u += step) {
    const lineY = y + u * unitHeight;
    commands.push(`0.22 0.27 0.34 RG 0.35 w ${bayX} ${lineY} m ${x + width - 5} ${lineY} l S`);
  }
  for (const item of rack.items) {
    if (item.kind !== "kuaiguai" && (item.mountFace ?? "front") !== face) continue;
    if (item.kind === "kuaiguai" && face === "rear") continue;
    const itemY = y + (item.startU - 1) * unitHeight + 0.5;
    const itemHeight = Math.max(2, item.heightU * unitHeight - 1);
    // Fractional-width faces take their horizontal strip of the bay so
    // side-by-side devices don't paint over each other.
    const { xStart, xQuarters } = rackItemXSpan(item.metadata);
    const itemX = bayX + 1 + ((bayWidth - 2) * xStart) / 4;
    const itemWidth = ((bayWidth - 2) * xQuarters) / 4;
    commands.push(pdfRect(itemX, itemY, itemWidth, itemHeight, itemColor(item), "0.08 0.10 0.14"));
    if (itemHeight >= 8 && itemWidth >= 14) {
      const name = item.label || kindLabel(item.kind);
      commands.push(pdfText(itemX + 4, itemY + Math.max(2, itemHeight / 2 - 3), Math.min(8, itemHeight - 2), truncate(name, Math.floor(itemWidth / 5.3)), "1 1 1"));
    }
  }
  commands.push(pdfText(x + 4, y + height - 9, 6, `${rack.heightU}U`, "0.72 0.77 0.84"));
  commands.push(pdfText(x + 4, y + 4, 6, "1U", "0.72 0.77 0.84"));
  return commands;
}

function rackDrawing(
  rack: Rack,
  x: number,
  y: number,
  width: number,
  height: number,
  labels: ItOpsExportLabels,
  kindLabel: (kind: RackItem["kind"]) => string,
): PdfCommand[] {
  const hasRearDevices = rack.items.some(
    (item) => item.kind !== "kuaiguai" && (item.mountFace ?? "front") === "rear",
  );
  if (!hasRearDevices) {
    return rackFaceDrawing(rack, "front", x, y, width, height, kindLabel);
  }

  const gap = Math.max(2, width * 0.025);
  const faceWidth = (width - gap) / 2;
  const commands = [
    ...rackFaceDrawing(rack, "front", x, y, faceWidth, height, kindLabel),
    ...rackFaceDrawing(rack, "rear", x + faceWidth + gap, y, faceWidth, height, kindLabel),
  ];
  if (width >= 70) {
    commands.push(pdfText(x + 2, y + height + 3, 6, labels.faceLabel("front"), "0.40 0.45 0.52"));
    commands.push(pdfText(x + faceWidth + gap + 2, y + height + 3, 6, labels.faceLabel("rear"), "0.40 0.45 0.52"));
  }
  return commands;
}

function pageHeader(title: string, subtitle: string, page: number): PdfCommand[] {
  return [
    pdfRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, "0.965 0.973 0.984"),
    pdfRect(0, PAGE_HEIGHT - 72, PAGE_WIDTH, 72, "0.08 0.12 0.18"),
    pdfText(38, PAGE_HEIGHT - 38, 22, truncate(title, 58), "1 1 1"),
    pdfText(39, PAGE_HEIGHT - 56, 9, subtitle, "0.65 0.74 0.84"),
    pdfText(PAGE_WIDTH - 52, 22, 8, String(page), "0.40 0.45 0.52"),
  ];
}

function graphicalPages(doc: ItOpsPdfDocument): PdfCommand[][] {
  const pages: PdfCommand[][] = [];
  if (doc.scope === "site") {
    const commands = pageHeader(doc.title, `${doc.rooms.length} ${doc.labels.group} / ${doc.racks.length} ${doc.labels.rack}`, 1);
    commands.push(pdfText(38, 508, 13, doc.labels.inventory));
    const cardWidth = 224;
    doc.rooms.slice(0, 6).forEach((room, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = 38 + col * 244;
      const y = 298 - row * 190;
      commands.push(pdfRect(x, y, cardWidth, 160, "1 1 1", "0.79 0.83 0.88"));
      commands.push(pdfText(x + 14, y + 134, 13, truncate(room.name, 27)));
      commands.push(pdfText(x + 14, y + 116, 8, `${room.racks.length} ${doc.labels.rack}`, "0.42 0.47 0.54"));
      room.racks.slice(0, 4).forEach((rack, rackIndex) => {
        const rx = x + 14 + rackIndex * 49;
        commands.push(...rackDrawing(rack, rx, y + 18, 39, 86, doc.labels, doc.kindLabel));
        commands.push(pdfText(rx, y + 7, 6, truncate(rack.name, 7)));
      });
    });
    pages.push(commands);
  }

  const rackChunks = Array.from({ length: Math.max(1, Math.ceil(doc.racks.length / 4)) }, (_, index) =>
    doc.racks.slice(index * 4, index * 4 + 4),
  );
  for (const chunk of rackChunks) {
    const pageNumber = pages.length + 1;
    const commands = pageHeader(doc.title, doc.labels.devices, pageNumber);
    chunk.forEach((rack, index) => {
      const x = 42 + index * 187;
      commands.push(pdfText(x, 512, 12, truncate(rack.name, 22)));
      commands.push(pdfText(x, 496, 7, `${rack.heightU}U / ${rack.depthMm} mm / ${doc.labels.deviceCount(rack.items.length)}`, "0.40 0.45 0.52"));
      commands.push(...rackDrawing(rack, x, 74, 158, 410, doc.labels, doc.kindLabel));
    });
    pages.push(commands);
  }

  const items = doc.racks.flatMap((rack) => rack.items.map((item) => ({ rack, item })));
  const rowsPerPage = 19;
  const inventoryChunks = Array.from({ length: Math.max(1, Math.ceil(items.length / rowsPerPage)) }, (_, index) =>
    items.slice(index * rowsPerPage, index * rowsPerPage + rowsPerPage),
  );
  for (const chunk of inventoryChunks) {
    const pageNumber = pages.length + 1;
    const commands = pageHeader(doc.title, doc.labels.inventory, pageNumber);
    const columns = [38, 128, 181, 242, 314, 402, 478, 558];
    const widths = [90, 53, 61, 72, 88, 76, 80, 196];
    const headings = [doc.labels.rack, doc.labels.startU, doc.labels.heightU, doc.labels.mountingSide, doc.labels.type, doc.labels.label, doc.labels.status, doc.labels.specs];
    commands.push(pdfRect(38, 494, 716, 24, "0.84 0.88 0.93", "0.72 0.77 0.83"));
    headings.forEach((heading, index) => commands.push(pdfText(columns[index] + 5, 502, 7, truncate(heading, Math.floor(widths[index] / 5.2)))));
    chunk.forEach(({ rack, item }, index) => {
      const y = 470 - index * 23;
      if (index % 2 === 0) commands.push(pdfRect(38, y, 716, 23, "0.94 0.95 0.97", "0.94 0.95 0.97"));
      const metadata = normalizeRackItemMetadata(item.metadata ?? {});
      const values = [
        rack.name,
        String(item.startU),
        String(item.heightU),
        doc.labels.faceLabel(item.mountFace ?? "front"),
        doc.kindLabel(item.kind),
        item.label || doc.kindLabel(item.kind),
        doc.labels.statusLabel(metadata.status ?? "online"),
        summarizeRackDeviceMetadata(item.metadata ?? {}).join(", "),
      ];
      values.forEach((value, column) => commands.push(pdfText(columns[column] + 5, y + 8, 7, truncate(value, Math.floor(widths[column] / 4.6)), "0.18 0.22 0.28")));
    });
    if (!chunk.length) commands.push(pdfText(42, 465, 10, doc.labels.noDevices, "0.42 0.47 0.54"));
    pages.push(commands);
  }
  return pages;
}

interface PdfTextMask {
  x: number;
  y: number;
  width: number;
  height: number;
  bits: Uint8Array;
}

function rasterizePdfText(command: PdfTextMaskCommand): PdfTextMask {
  if (typeof document === "undefined") {
    throw new Error("Unicode PDF export requires a browser canvas");
  }
  const scale = 3;
  const pad = 2 * scale;
  const canvas = document.createElement("canvas");
  const measureContext = canvas.getContext("2d");
  if (!measureContext) throw new Error("Unicode PDF export could not create a canvas context");
  const font = `${command.size * scale}px Inter, "Segoe UI", "Microsoft JhengHei", "PingFang TC", "Noto Sans", sans-serif`;
  measureContext.font = font;
  const metrics = measureContext.measureText(command.value);
  const ascent = Math.ceil(metrics.actualBoundingBoxAscent || command.size * scale * 0.82);
  const descent = Math.ceil(metrics.actualBoundingBoxDescent || command.size * scale * 0.22);
  canvas.width = Math.max(1, Math.ceil(metrics.width) + pad * 2);
  canvas.height = Math.max(1, ascent + descent + pad * 2);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unicode PDF export could not create a canvas context");
  context.font = font;
  context.fillStyle = "#000";
  context.textBaseline = "alphabetic";
  context.fillText(command.value, pad, pad + ascent);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const rowBytes = Math.ceil(canvas.width / 8);
  const bits = new Uint8Array(rowBytes * canvas.height);
  bits.fill(0xff);
  for (let pixel = 0; pixel < canvas.width * canvas.height; pixel += 1) {
    if (pixels[pixel * 4 + 3] < 32) continue;
    const px = pixel % canvas.width;
    const py = Math.floor(pixel / canvas.width);
    bits[py * rowBytes + Math.floor(px / 8)] &= ~(0x80 >> (px % 8));
  }
  return {
    x: command.x - pad / scale,
    y: command.y - (descent + pad) / scale,
    width: canvas.width / scale,
    height: canvas.height / scale,
    bits,
  };
}

function asciiHex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

export function createItOpsPdfBytes(doc: ItOpsPdfDocument): Uint8Array {
  const pages = graphicalPages(doc);

  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = addObject("");
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];

  for (const [pageIndex, pageCommands] of pages.entries()) {
    const images: Array<{ name: string; id: number }> = [];
    const stream = pageCommands.map((command) => {
      if (typeof command === "string") return command;
      const mask = rasterizePdfText(command);
      const encodedMask = `${asciiHex(mask.bits)}>`;
      const imageId = addObject(
        `<< /Type /XObject /Subtype /Image /Name /UnicodeText /Width ${Math.ceil(mask.width * 3)} /Height ${Math.ceil(mask.height * 3)} /ImageMask true /BitsPerComponent 1 /Decode [0 1] /Interpolate true /Filter /ASCIIHexDecode /Length ${encodedMask.length} >>\nstream\n${encodedMask}\nendstream`,
      );
      const name = `Im${pageIndex + 1}_${images.length + 1}`;
      images.push({ name, id: imageId });
      return `${command.color} rg q ${mask.width} 0 0 ${mask.height} ${mask.x} ${mask.y} cm /${name} Do Q`;
    }).join("\n");
    const contentId = addObject(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
    const xObjects = images.length
      ? ` /XObject << ${images.map((image) => `/${image.name} ${image.id} 0 R`).join(" ")} >>`
      : "";
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontId} 0 R >>${xObjects} >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(encoder.encode(output).length);
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = encoder.encode(output).length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(output);
}

function downloadBytes(filename: string, bytes: Uint8Array, mime: string) {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function saveExportBytes(
  filename: string,
  bytes: Uint8Array,
  filters: WidgetFilePickFilter[],
  mime: string,
): Promise<string | null> {
  if (isTauriRuntime()) {
    return pickAndSaveFile(filename, bytes, filters);
  }
  downloadBytes(filename, bytes, mime);
  return filename;
}

function safeFilename(value: string): string {
  const invalid = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
  const cleaned = [...value]
    .map((char) => (char.charCodeAt(0) < 32 || invalid.has(char) ? "-" : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "it-ops";
}

export function pdfFilename(name: string): string {
  return `${safeFilename(name)}.pdf`;
}

export function excelFilename(name: string): string {
  return `${safeFilename(name)}.xls`;
}

export function sitePdfDocument({
  site,
  racks,
  unassignedLabel,
  labels,
  kindLabel,
}: {
  site: Site;
  racks: Rack[];
  unassignedLabel: string;
  labels: ItOpsExportLabels;
  kindLabel: (kind: RackItem["kind"]) => string;
}): ItOpsPdfDocument {
  const topology = groupRackTopology(racks);
  return {
    title: site.name,
    scope: "site",
    racks,
    rooms: topology.map((room) => ({ name: room.key || unassignedLabel, racks: room.racks })),
    labels,
    kindLabel,
  };
}

export function serverRoomPdfDocument({
  site,
  roomName,
  racks,
  placement,
  unassignedLabel,
  labels,
  kindLabel,
}: {
  site: Site;
  roomName: string;
  racks: Rack[];
  /** The room's resolved floor-grid placements, so the report reads in the
   *  same order as the elevation view rather than a separate sort. */
  placement: FreePlacementMap;
  unassignedLabel: string;
  labels: ItOpsExportLabels;
  kindLabel: (kind: RackItem["kind"]) => string;
}): ItOpsPdfDocument {
  const title = `${site.name} / ${roomName || unassignedLabel}`;
  const orderedRacks = sortRacksForElevation(racks, placement);
  return {
    title,
    scope: "serverRoom",
    racks: orderedRacks,
    rooms: [{ name: roomName || unassignedLabel, racks: orderedRacks }],
    labels,
    kindLabel,
  };
}

export function rackPdfDocument({
  site,
  rack,
  roomName,
  unassignedLabel,
  labels,
  kindLabel,
}: {
  site: Site;
  rack: Rack;
  roomName: string;
  unassignedLabel: string;
  labels: ItOpsExportLabels;
  kindLabel: (kind: RackItem["kind"]) => string;
}): ItOpsPdfDocument {
  return {
    title: `${site.name} / ${roomName || unassignedLabel} / ${rack.name}`,
    scope: "rack",
    racks: [rack],
    rooms: [{ name: roomName || unassignedLabel, racks: [rack] }],
    labels,
    kindLabel,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function rackExcelBytes({
  site,
  rack,
  roomName,
  unassignedLabel,
  labels,
  kindLabel,
}: {
  site: Site;
  rack: Rack;
  roomName: string;
  unassignedLabel: string;
  labels: ItOpsExportLabels;
  kindLabel: (kind: RackItem["kind"]) => string;
}): Uint8Array {
  const rows = rack.items.map((item) => {
    const metadata = normalizeRackItemMetadata(item.metadata ?? {});
    const specs = summarizeRackDeviceMetadata(item.metadata ?? {});
    return [
      item.startU.toString(),
      item.heightU.toString(),
      labels.faceLabel(item.mountFace ?? "front"),
      kindLabel(item.kind),
      item.label || kindLabel(item.kind),
      labels.statusLabel(metadata.status ?? "online"),
      item.connectionId ?? "",
      specs.join(", "),
      (metadata.tags ?? []).join(", "),
    ];
  });
  const tableRows = [
    [labels.startU, labels.heightU, labels.mountingSide, labels.type, labels.label, labels.status, labels.connection, labels.specs, labels.tags],
    ...rows,
  ];
  const title = `${site.name} / ${roomName || unassignedLabel} / ${rack.name}`;
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    table { border-collapse: collapse; font-family: Segoe UI, Arial, sans-serif; }
    th, td { border: 1px solid #999; padding: 4px 8px; }
    th { background: #e8eef8; font-weight: 700; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <table>${tableRows
    .map((row, index) => {
      const tag = index === 0 ? "th" : "td";
      return `<tr>${row.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join("")}</tr>`;
    })
    .join("")}</table>
</body>
</html>`;
  return encoder.encode(html);
}

// Both spatial room layouts (floor plan + 2.5D) store grid cells (col/row)
// under this one scope; facing and room objects reuse the same scope string.
export function roomIsoLayoutScope(siteId: string, serverRoom: string): string {
  return `roomIso:${siteId}:${topologyGroupKey(serverRoom)}`;
}

export function siteLayoutScope(siteId: string): string {
  return `site:${siteId}`;
}
