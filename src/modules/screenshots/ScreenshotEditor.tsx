import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  Crop,
  ExternalLink,
  Floppy,
  FolderOpen,
  Grid2x2,
  Hand,
  Maximize2,
  MousePointer2,
  Pencil,
  RotateCcw,
  Square,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut,
} from "../../lib/reicon";
import {
  Actions,
  Btn,
  ConfirmSheet,
  DialogShell,
  Sheet,
} from "../../app/ui/dialog";
import { ColorPalettePicker } from "../../app/ui/ColorPalettePicker";
import { writeToClipboard } from "../../lib/clipboard";
import {
  showNativeContextMenu,
  type NativeContextMenuItem,
} from "../../lib/nativeContextMenu";
import {
  invokeCommand,
  selectScreenshotSavePath,
  writeDataUrlFile,
  type FullScreenshot,
  type StoredScreenshot,
} from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import { workspaceShortcutFromKeyboardEvent } from "../workspace/keymap";
import { formatScreenshotBytes } from "./LibraryView";
import { cropImagePlacement, fitImageDimensions } from "./editorSizing";

type EditorTool = "pan" | "select" | "pencil" | "arrow" | "rectangle" | "ellipse" | "text" | "mosaic" | "crop";
type ShapeKind = "arrow" | "rectangle" | "ellipse";
type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };
type ZoomLevel = "fit" | number;
type TextFont = "app" | "sans-serif" | "serif" | "monospace";
type PendingEditorAction = "close" | -1 | 1;

type ShapeAnnotation = {
  id: number;
  kind: ShapeKind;
  start: Point;
  end: Point;
  color: string;
  stroke: number;
};
type MosaicAnnotation = { id: number; kind: "mosaic"; start: Point; end: Point };
type FreehandAnnotation = {
  id: number;
  kind: "pencil";
  points: Point[];
  color: string;
  stroke: number;
};
type TextAnnotation = {
  id: number;
  kind: "text";
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  font: TextFont;
  bold: boolean;
  italic: boolean;
};
type Annotation = ShapeAnnotation | MosaicAnnotation | FreehandAnnotation | TextAnnotation;
type EditorSnapshot = { annotations: Annotation[]; cropRect: Rect | null };
type TextDraft = {
  id: number | null;
  x: number;
  y: number;
  draft: string;
  color: string;
  size: number;
  font: TextFont;
  bold: boolean;
  italic: boolean;
};
type SelectionHandle = "nw" | "ne" | "sw" | "se" | "start" | "end";

const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200] as const;
const FIT_PADDING = 18;
const TEXT_LINE_HEIGHT = 1.25;
const UNDO_LIMIT = 50;
const EDITOR_TOOLS: Array<{
  id: EditorTool;
  icon: typeof ArrowRight;
  key: string;
}> = [
  { id: "pan", icon: Hand, key: "screenshots.editor.pan" },
  { id: "select", icon: MousePointer2, key: "screenshots.editor.select" },
  { id: "pencil", icon: Pencil, key: "screenshots.editor.pencil" },
  { id: "arrow", icon: ArrowRight, key: "screenshots.editor.arrow" },
  { id: "rectangle", icon: Square, key: "screenshots.editor.rectangle" },
  { id: "ellipse", icon: Circle, key: "screenshots.editor.ellipse" },
  { id: "text", icon: Type, key: "screenshots.editor.text" },
  { id: "mosaic", icon: Grid2x2, key: "screenshots.editor.mosaic" },
  { id: "crop", icon: Crop, key: "screenshots.editor.crop" },
];
const STROKE_OPTIONS = [
  { width: 2, dot: 3, key: "screenshots.editor.strokeThin" },
  { width: 4, dot: 6, key: "screenshots.editor.strokeMedium" },
  { width: 7, dot: 9, key: "screenshots.editor.strokeThick" },
] as const;
const TEXT_FONTS: TextFont[] = ["app", "sans-serif", "serif", "monospace"];
const TEXT_FONT_KEYS: Record<TextFont, string> = {
  app: "screenshots.editor.appFont",
  "sans-serif": "screenshots.editor.sansSerif",
  serif: "screenshots.editor.serif",
  monospace: "screenshots.editor.monospace",
};

function canvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
    y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
  };
}

function cssToken(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// Swatches are canvas ink baked into the exported image, not themed UI chrome;
// black/white have no scheme token, and token fallbacks only cover a missing
// computed style.
function annotationSwatches() {
  return [
    { key: "screenshots.editor.colorRed", value: cssToken("--red", "#ff453a") },
    { key: "screenshots.editor.colorOrange", value: cssToken("--amber", "#ff9f0a") },
    { key: "screenshots.editor.colorGreen", value: cssToken("--green", "#34c759") },
    { key: "screenshots.editor.colorBlue", value: cssToken("--accent", "#0a84ff") },
    { key: "screenshots.editor.colorBlack", value: "#111111" },
    { key: "screenshots.editor.colorWhite", value: "#ffffff" },
  ];
}

function annotationFontFamily() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--app-ui-font-family")
    .trim() || "sans-serif";
}

function resolvedTextFont(font: TextFont) {
  return font === "app" ? annotationFontFamily() : font;
}

function textFontString(size: number, font: TextFont, bold: boolean, italic: boolean) {
  return `${italic ? "italic " : ""}${bold ? 700 : 400} ${size}px ${resolvedTextFont(font)}`;
}

function lineWidthFor(canvasWidth: number, stroke: number) {
  return stroke * Math.max(1, canvasWidth / 1560);
}

function normalizedRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function pixelCropRect(rect: Rect): Rect {
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  const right = Math.ceil(rect.x + rect.width);
  const bottom = Math.ceil(rect.y + rect.height);
  return { x, y, width: right - x, height: bottom - y };
}

function suggestedSaveAsPath(path: string) {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dot = path.lastIndexOf(".");
  const stem = dot > separator ? path.slice(0, dot) : path;
  return `${stem}-edited`;
}

function fileNameFromPath(path: string) {
  return path.split(/[/\\]/).pop() ?? path;
}

function saveAsDataUrl(canvas: HTMLCanvasElement, path: string) {
  if (!/\.jpe?g$/i.test(path)) {
    return canvas.toDataURL("image/png");
  }
  const jpeg = document.createElement("canvas");
  jpeg.width = canvas.width;
  jpeg.height = canvas.height;
  const context = jpeg.getContext("2d");
  if (!context) {
    return canvas.toDataURL("image/jpeg", 0.9);
  }
  context.fillStyle = "white";
  context.fillRect(0, 0, jpeg.width, jpeg.height);
  context.drawImage(canvas, 0, 0);
  return jpeg.toDataURL("image/jpeg", 0.9);
}

function rectsIntersect(a: Rect, b: Rect) {
  return (
    a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
  );
}

function expandRect(rect: Rect, pad: number): Rect {
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}

function pointInRect(point: Point, rect: Rect, tolerance: number) {
  return (
    point.x >= rect.x - tolerance
    && point.x <= rect.x + rect.width + tolerance
    && point.y >= rect.y - tolerance
    && point.y <= rect.y + rect.height + tolerance
  );
}

function distanceToSegment(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function textBounds(context: CanvasRenderingContext2D, annotation: {
  x: number;
  y: number;
  text: string;
  size: number;
  font: TextFont;
  bold: boolean;
  italic: boolean;
}): Rect {
  context.save();
  context.font = textFontString(annotation.size, annotation.font, annotation.bold, annotation.italic);
  let width = 0;
  const lines = annotation.text.split("\n");
  for (const line of lines) {
    width = Math.max(width, context.measureText(line).width);
  }
  context.restore();
  return {
    x: annotation.x,
    y: annotation.y,
    width: Math.max(width, annotation.size / 2),
    height: lines.length * annotation.size * TEXT_LINE_HEIGHT,
  };
}

function freehandBounds(context: CanvasRenderingContext2D, annotation: FreehandAnnotation): Rect {
  const xs = annotation.points.map((point) => point.x);
  const ys = annotation.points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return expandRect(
    {
      x: left,
      y: top,
      width: Math.max(...xs) - left,
      height: Math.max(...ys) - top,
    },
    lineWidthFor(context.canvas.width, annotation.stroke) / 2,
  );
}

function annotationBounds(context: CanvasRenderingContext2D, annotation: Annotation): Rect {
  if (annotation.kind === "text") {
    return textBounds(context, annotation);
  }
  if (annotation.kind === "pencil") {
    return freehandBounds(context, annotation);
  }
  const rect = normalizedRect(annotation.start, annotation.end);
  if (annotation.kind === "mosaic") {
    return rect;
  }
  return expandRect(rect, lineWidthFor(context.canvas.width, annotation.stroke) / 2);
}

function hitTest(
  context: CanvasRenderingContext2D,
  annotations: Annotation[],
  point: Point,
  tolerance: number,
): Annotation | null {
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index];
    if (annotation.kind === "arrow") {
      const reach = tolerance + lineWidthFor(context.canvas.width, annotation.stroke) / 2;
      if (distanceToSegment(point, annotation.start, annotation.end) <= reach) {
        return annotation;
      }
      continue;
    }
    if (annotation.kind === "pencil") {
      const reach = tolerance + lineWidthFor(context.canvas.width, annotation.stroke) / 2;
      const hit = annotation.points.some((current, pointIndex) => {
        const next = annotation.points[pointIndex + 1] ?? current;
        return distanceToSegment(point, current, next) <= reach;
      });
      if (hit) {
        return annotation;
      }
      continue;
    }
    if (pointInRect(point, annotationBounds(context, annotation), tolerance)) {
      return annotation;
    }
  }
  return null;
}

function translateAnnotation(annotation: Annotation, dx: number, dy: number): Annotation {
  if (annotation.kind === "text") {
    return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
  }
  if (annotation.kind === "pencil") {
    return {
      ...annotation,
      points: annotation.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
    };
  }
  return {
    ...annotation,
    start: { x: annotation.start.x + dx, y: annotation.start.y + dy },
    end: { x: annotation.end.x + dx, y: annotation.end.y + dy },
  };
}

function rectCornerAnchor(rect: Rect, handle: SelectionHandle): Point {
  return {
    x: handle === "nw" || handle === "sw" ? rect.x + rect.width : rect.x,
    y: handle === "nw" || handle === "ne" ? rect.y + rect.height : rect.y,
  };
}

function resizeAnnotation(
  context: CanvasRenderingContext2D,
  original: Annotation,
  handle: SelectionHandle,
  point: Point,
): Annotation {
  if (original.kind === "pencil") {
    return original;
  }
  if (original.kind !== "text") {
    if (handle === "start" || handle === "end") {
      return { ...original, [handle]: point };
    }
    const rect = normalizedRect(original.start, original.end);
    return { ...original, start: rectCornerAnchor(rect, handle), end: point };
  }
  if (handle === "start" || handle === "end") {
    return original;
  }
  const bounds = textBounds(context, original);
  const anchor = rectCornerAnchor(bounds, handle);
  const ratio = bounds.width > 0
    ? Math.max(0.05, Math.abs(point.x - anchor.x) / bounds.width)
    : 1;
  const size = Math.min(512, Math.max(8, Math.round(original.size * ratio)));
  const applied = size / original.size;
  return {
    ...original,
    size,
    x: handle === "nw" || handle === "sw" ? anchor.x - bounds.width * applied : anchor.x,
    y: handle === "nw" || handle === "ne" ? anchor.y - bounds.height * applied : anchor.y,
  };
}

function initialEditorSize() {
  return {
    width: Math.max(720, Math.round(window.innerWidth * 0.8)),
    height: Math.max(480, Math.round(window.innerHeight * 0.8)),
  };
}

function MultipleFloppy({ size = 15 }: { size?: number }) {
  return (
    <span className="screenshots-editor__multi-floppy" aria-hidden="true">
      <Floppy size={size} />
      <Floppy size={size} />
    </span>
  );
}

function drawShape(
  context: CanvasRenderingContext2D,
  kind: ShapeKind,
  start: Point,
  end: Point,
  color: string,
  lineWidth: number,
) {
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (kind === "rectangle") {
    context.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
  } else if (kind === "ellipse") {
    context.beginPath();
    context.ellipse(
      (start.x + end.x) / 2,
      (start.y + end.y) / 2,
      Math.abs(end.x - start.x) / 2,
      Math.abs(end.y - start.y) / 2,
      0,
      0,
      Math.PI * 2,
    );
    context.stroke();
  } else {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = Math.max(14, lineWidth * 4);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.beginPath();
    context.moveTo(end.x, end.y);
    context.lineTo(
      end.x - head * Math.cos(angle - Math.PI / 6),
      end.y - head * Math.sin(angle - Math.PI / 6),
    );
    context.lineTo(
      end.x - head * Math.cos(angle + Math.PI / 6),
      end.y - head * Math.sin(angle + Math.PI / 6),
    );
    context.closePath();
    context.fill();
  }
  context.restore();
}

function drawText(context: CanvasRenderingContext2D, annotation: TextAnnotation) {
  context.save();
  context.fillStyle = annotation.color;
  context.font = textFontString(annotation.size, annotation.font, annotation.bold, annotation.italic);
  context.textBaseline = "top";
  annotation.text.split("\n").forEach((line, index) => {
    context.fillText(line, annotation.x, annotation.y + index * annotation.size * TEXT_LINE_HEIGHT);
  });
  context.restore();
}

function drawFreehand(
  context: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  lineWidth: number,
) {
  const first = points[0];
  if (!first) {
    return;
  }
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (points.length === 1) {
    context.beginPath();
    context.arc(first.x, first.y, lineWidth / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (const point of points.slice(1)) {
      context.lineTo(point.x, point.y);
    }
    context.stroke();
  }
  context.restore();
}

function mosaicRegion(context: CanvasRenderingContext2D, start: Point, end: Point) {
  const x = Math.max(0, Math.floor(Math.min(start.x, end.x)));
  const y = Math.max(0, Math.floor(Math.min(start.y, end.y)));
  const width = Math.min(context.canvas.width - x, Math.ceil(Math.abs(end.x - start.x)));
  const height = Math.min(context.canvas.height - y, Math.ceil(Math.abs(end.y - start.y)));
  if (width < 2 || height < 2) {
    return;
  }
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  source.getContext("2d")?.putImageData(context.getImageData(x, y, width, height), 0, 0);
  const pixelSize = Math.max(8, Math.round(Math.max(width, height) / 45));
  const tiny = document.createElement("canvas");
  tiny.width = Math.max(1, Math.ceil(width / pixelSize));
  tiny.height = Math.max(1, Math.ceil(height / pixelSize));
  const tinyContext = tiny.getContext("2d");
  if (!tinyContext) {
    return;
  }
  tinyContext.drawImage(source, 0, 0, tiny.width, tiny.height);
  context.save();
  context.imageSmoothingEnabled = false;
  context.drawImage(tiny, 0, 0, tiny.width, tiny.height, x, y, width, height);
  context.restore();
}

function drawAnnotation(context: CanvasRenderingContext2D, annotation: Annotation) {
  if (annotation.kind === "text") {
    drawText(context, annotation);
  } else if (annotation.kind === "pencil") {
    drawFreehand(
      context,
      annotation.points,
      annotation.color,
      lineWidthFor(context.canvas.width, annotation.stroke),
    );
  } else if (annotation.kind === "mosaic") {
    mosaicRegion(context, annotation.start, annotation.end);
  } else {
    drawShape(
      context,
      annotation.kind,
      annotation.start,
      annotation.end,
      annotation.color,
      lineWidthFor(context.canvas.width, annotation.stroke),
    );
  }
}

export function ScreenshotEditor({
  screenshot,
  hasPrevious,
  hasNext,
  onNavigate,
  onCopyEdited,
  onOpenExternal,
  onReveal,
  onDelete,
  onSaved,
  onExported,
  onError,
  onClose,
}: {
  screenshot: StoredScreenshot;
  hasPrevious: boolean;
  hasNext: boolean;
  onNavigate: (direction: -1 | 1) => void;
  onCopyEdited: (dataUrl: string) => void;
  onOpenExternal: () => void;
  onReveal: () => void;
  onDelete: () => void;
  onSaved: (saved: StoredScreenshot, navigateDirection?: -1 | 1) => void;
  onExported: (fileName: string) => void;
  onError: (error: unknown) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const shortcutOverrides = useWorkspaceStore((state) => state.generalSettings.workspaceShortcuts);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const undoRef = useRef<EditorSnapshot[]>([]);
  const annotationsRef = useRef<Annotation[]>([]);
  const cropRectRef = useRef<Rect | null>(null);
  const editingRef = useRef<TextDraft | null>(null);
  const idRef = useRef(1);
  const drawingRef = useRef<{ start: Point } | null>(null);
  const cropDragRef = useRef<{ pointerId: number; start: Point; end: Point } | null>(null);
  const freehandRef = useRef<{ pointerId: number; points: Point[] } | null>(null);
  const moveDragRef = useRef<{
    pointerId: number;
    id: number;
    origin: Point;
    before: Annotation[];
    moved: boolean;
  } | null>(null);
  const handleDragRef = useRef<{
    pointerId: number;
    handle: SelectionHandle;
    original: Annotation;
    before: Annotation[];
    changed: boolean;
  } | null>(null);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    width: number;
    height: number;
  } | null>(null);
  const [tool, setTool] = useState<EditorTool>("arrow");
  const [swatches] = useState(annotationSwatches);
  const [color, setColor] = useState(swatches[0].value);
  const [stroke, setStroke] = useState<number>(STROKE_OPTIONS[1].width);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [cropRect, setCropRect] = useState<Rect | null>(null);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<TextDraft | null>(null);
  const [textSize, setTextSize] = useState(32);
  const [canvasSize, setCanvasSize] = useState({ width: screenshot.width, height: screenshot.height });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [editorSize, setEditorSize] = useState(initialEditorSize);
  const [zoom, setZoom] = useState<ZoomLevel>("fit");
  const [ready, setReady] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingEditorAction | null>(null);
  const dirty = annotations.length > 0 || cropRect !== null;
  const editingId = editing?.id ?? null;

  function applyAnnotations(next: Annotation[]) {
    annotationsRef.current = next;
    setAnnotations(next);
  }

  function applyEditing(next: TextDraft | null) {
    editingRef.current = next;
    setEditing(next);
  }

  function applyCropRect(next: Rect | null) {
    const canvas = canvasRef.current;
    const base = baseRef.current;
    cropRectRef.current = next;
    setCropRect(next);
    if (!canvas || !base) {
      return;
    }
    const width = next?.width ?? base.width;
    const height = next?.height ?? base.height;
    canvas.width = width;
    canvas.height = height;
    setCanvasSize({ width, height });
  }

  function drawBase(context: CanvasRenderingContext2D) {
    const base = baseRef.current;
    if (!base) {
      return;
    }
    const source = cropRectRef.current ?? { x: 0, y: 0, width: base.width, height: base.height };
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    const placement = cropImagePlacement(source, base.width, base.height);
    if (!placement) {
      return;
    }
    context.drawImage(
      base,
      placement.source.x,
      placement.source.y,
      placement.source.width,
      placement.source.height,
      placement.destination.x,
      placement.destination.y,
      placement.destination.width,
      placement.destination.height,
    );
  }

  function renderCanvas() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    drawBase(context);
    const hiddenId = editingRef.current?.id ?? null;
    for (const annotation of annotationsRef.current) {
      if (annotation.id !== hiddenId) {
        drawAnnotation(context, annotation);
      }
    }
  }

  useEffect(() => {
    workspaceRef.current?.focus();
  }, []);

  useEffect(() => {
    let disposed = false;
    setReady(false);
    setSaving(false);
    setPendingAction(null);
    setZoom("fit");
    setUndoCount(0);
    setSelectedId(null);
    undoRef.current = [];
    cropRectRef.current = null;
    setCropRect(null);
    annotationsRef.current = [];
    setAnnotations([]);
    editingRef.current = null;
    setEditing(null);
    drawingRef.current = null;
    cropDragRef.current = null;
    setCropDraft(null);
    freehandRef.current = null;
    moveDragRef.current = null;
    handleDragRef.current = null;
    panRef.current = null;
    invokeCommand("read_screenshot", { id: screenshot.id })
      .then((full: FullScreenshot) => {
        const image = new Image();
        image.onload = () => {
          if (disposed || !canvasRef.current) {
            return;
          }
          const base = document.createElement("canvas");
          base.width = full.width;
          base.height = full.height;
          base.getContext("2d")?.drawImage(image, 0, 0);
          baseRef.current = base;
          const canvas = canvasRef.current;
          canvas.width = full.width;
          canvas.height = full.height;
          canvas.getContext("2d")?.drawImage(image, 0, 0);
          setCanvasSize({ width: full.width, height: full.height });
          setTextSize(Math.round(Math.max(22, full.width / 44)));
          setReady(true);
        };
        image.onerror = () => {
          if (!disposed) {
            onError(new Error(t("screenshots.editor.loadError")));
          }
        };
        image.src = full.dataUrl;
      })
      .catch(onError);
    return () => {
      disposed = true;
    };
  }, [onError, screenshot.id, t]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const measure = () => {
      setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (ready) {
      renderCanvas();
    }
    // Canvas rendering reads the latest refs; these values are intentional redraw triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, annotations, editingId]);

  function pushUndo(before: Annotation[]) {
    undoRef.current = [
      ...undoRef.current.slice(-(UNDO_LIMIT - 1)),
      { annotations: before, cropRect: cropRectRef.current },
    ];
    setUndoCount(undoRef.current.length);
  }

  function undo() {
    if (editingRef.current) {
      return;
    }
    const previous = undoRef.current.pop();
    if (!previous) {
      return;
    }
    setUndoCount(undoRef.current.length);
    applyCropRect(previous.cropRect);
    applyAnnotations(previous.annotations);
    setSelectedId((current) => (
      current !== null && previous.annotations.some((annotation) => annotation.id === current) ? current : null
    ));
  }

  function applyCrop(requested: Rect) {
    const canvas = canvasRef.current;
    const base = baseRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !base || !context) {
      return;
    }
    const crop = pixelCropRect(requested);
    if (crop.width < 2 || crop.height < 2 || !cropImagePlacement(crop, canvas.width, canvas.height)) {
      renderCanvas();
      return;
    }
    const before = annotationsRef.current;
    pushUndo(before);
    const translated = before
      .filter((annotation) => rectsIntersect(annotationBounds(context, annotation), crop))
      .map((annotation) => translateAnnotation(annotation, -crop.x, -crop.y));
    const source = cropRectRef.current ?? { x: 0, y: 0, width: base.width, height: base.height };
    applyCropRect({
      x: source.x + crop.x,
      y: source.y + crop.y,
      width: crop.width,
      height: crop.height,
    });
    applyAnnotations(translated);
    setSelectedId(null);
    setZoom("fit");
  }

  function annotationById(id: number | null) {
    return id === null
      ? null
      : annotationsRef.current.find((annotation) => annotation.id === id) ?? null;
  }

  function updateAnnotationWithUndo(id: number, updater: (annotation: Annotation) => Annotation) {
    const before = annotationsRef.current;
    if (!before.some((annotation) => annotation.id === id)) {
      return;
    }
    pushUndo(before);
    applyAnnotations(before.map((annotation) => (
      annotation.id === id ? updater(annotation) : annotation
    )));
  }

  function deleteAnnotation(id: number) {
    const before = annotationsRef.current;
    if (!before.some((annotation) => annotation.id === id)) {
      return;
    }
    pushUndo(before);
    applyAnnotations(before.filter((annotation) => annotation.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  }

  function applyColor(next: string) {
    setColor(next);
    const draft = editingRef.current;
    if (draft) {
      applyEditing({ ...draft, color: next });
      return;
    }
    if (tool === "select" && selectedId !== null) {
      const target = annotationById(selectedId);
      if (target && target.kind !== "mosaic") {
        updateAnnotationWithUndo(selectedId, (annotation) => ({ ...annotation, color: next }));
      }
    }
  }

  function applyStroke(next: number) {
    setStroke(next);
    if (tool === "select" && selectedId !== null) {
      const target = annotationById(selectedId);
      if (target && target.kind !== "mosaic" && target.kind !== "text") {
        updateAnnotationWithUndo(selectedId, (annotation) => ({ ...annotation, stroke: next }));
      }
    }
  }

  function startTextDraft(point: Point) {
    setSelectedId(null);
    applyEditing({
      id: null,
      x: point.x,
      y: point.y,
      draft: "",
      color,
      size: textSize,
      font: "app",
      bold: true,
      italic: false,
    });
  }

  function editTextAnnotation(annotation: TextAnnotation) {
    setSelectedId(annotation.id);
    applyEditing({
      id: annotation.id,
      x: annotation.x,
      y: annotation.y,
      draft: annotation.text,
      color: annotation.color,
      size: annotation.size,
      font: annotation.font,
      bold: annotation.bold,
      italic: annotation.italic,
    });
  }

  function commitTextDraft() {
    const draft = editingRef.current;
    if (!draft) {
      return;
    }
    applyEditing(null);
    const before = annotationsRef.current;
    if (!draft.draft.trim()) {
      if (draft.id !== null) {
        pushUndo(before);
        applyAnnotations(before.filter((annotation) => annotation.id !== draft.id));
        setSelectedId(null);
      }
      return;
    }
    if (draft.id !== null) {
      const original = before.find((annotation) => annotation.id === draft.id);
      if (
        original?.kind === "text"
        && original.text === draft.draft
        && original.color === draft.color
        && original.size === draft.size
        && original.font === draft.font
        && original.bold === draft.bold
        && original.italic === draft.italic
      ) {
        return;
      }
      pushUndo(before);
      applyAnnotations(before.map((annotation) => (
        annotation.id === draft.id
          ? {
              id: annotation.id,
              kind: "text" as const,
              x: draft.x,
              y: draft.y,
              text: draft.draft,
              color: draft.color,
              size: draft.size,
              font: draft.font,
              bold: draft.bold,
              italic: draft.italic,
            }
          : annotation
      )));
      return;
    }
    const id = idRef.current++;
    pushUndo(before);
    applyAnnotations([
      ...before,
      {
        id,
        kind: "text",
        x: draft.x,
        y: draft.y,
        text: draft.draft,
        color: draft.color,
        size: draft.size,
        font: draft.font,
        bold: draft.bold,
        italic: draft.italic,
      },
    ]);
  }

  function discardEditingTarget() {
    const draft = editingRef.current;
    applyEditing(null);
    if (draft?.id !== null && draft?.id !== undefined) {
      deleteAnnotation(draft.id);
    }
  }

  function checkLabel(label: string, active: boolean) {
    return active ? `✓ ${label}` : label;
  }

  function fontSizeChoices(current: number) {
    const sizes = [0.5, 0.75, 1, 1.5, 2, 3].map((multiple) => Math.round(textSize * multiple));
    sizes.push(current);
    return [...new Set(sizes)].sort((a, b) => a - b);
  }

  function textMenuItems(
    current: { text: string; bold: boolean; italic: boolean; size: number; font: TextFont },
    apply: (patch: Partial<Pick<TextDraft, "bold" | "italic" | "size" | "font">>) => void,
    remove: () => void,
  ): NativeContextMenuItem[] {
    return [
      {
        kind: "item",
        label: checkLabel(t("screenshots.editor.bold"), current.bold),
        action: () => apply({ bold: !current.bold }),
      },
      {
        kind: "item",
        label: checkLabel(t("screenshots.editor.italic"), current.italic),
        action: () => apply({ italic: !current.italic }),
      },
      {
        kind: "submenu",
        label: t("workspace.fileViewer.fontSize"),
        items: fontSizeChoices(current.size).map((size) => ({
          kind: "item" as const,
          label: checkLabel(String(size), size === current.size),
          action: () => apply({ size }),
        })),
      },
      {
        kind: "submenu",
        label: t("workspace.fileViewer.font"),
        items: TEXT_FONTS.map((font) => ({
          kind: "item" as const,
          label: checkLabel(t(TEXT_FONT_KEYS[font]), font === current.font),
          action: () => apply({ font }),
        })),
      },
      { kind: "separator" },
      {
        kind: "item",
        label: t("common.cut"),
        action: () => {
          void writeToClipboard(current.text);
          remove();
        },
      },
      {
        kind: "item",
        label: t("common.copy"),
        action: () => {
          void writeToClipboard(current.text);
        },
      },
      { kind: "separator" },
      { kind: "item", label: t("common.delete"), action: remove },
    ];
  }

  function editingContextMenu(event: ReactMouseEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    const draft = editingRef.current;
    if (!draft) {
      return;
    }
    void showNativeContextMenu(
      textMenuItems(
        { text: draft.draft, bold: draft.bold, italic: draft.italic, size: draft.size, font: draft.font },
        (patch) => {
          const current = editingRef.current;
          if (current) {
            applyEditing({ ...current, ...patch });
          }
        },
        discardEditingTarget,
      ),
      { x: event.clientX, y: event.clientY },
    );
  }

  function canvasContextMenu(event: ReactMouseEvent<HTMLCanvasElement>) {
    event.preventDefault();
    if (!ready || saving || editingRef.current || tool !== "select") {
      return;
    }
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const point = canvasPoint(canvas, event.clientX, event.clientY);
    const tolerance = 8 * (canvas.width / Math.max(1, canvas.getBoundingClientRect().width));
    const hit = hitTest(context, annotationsRef.current, point, tolerance);
    if (!hit) {
      return;
    }
    setSelectedId(hit.id);
    const items: NativeContextMenuItem[] = hit.kind === "text"
      ? textMenuItems(
          hit,
          (patch) => updateAnnotationWithUndo(hit.id, (annotation) => ({ ...annotation, ...patch })),
          () => deleteAnnotation(hit.id),
        )
      : [{ kind: "item", label: t("common.delete"), action: () => deleteAnnotation(hit.id) }];
    void showNativeContextMenu(items, { x: event.clientX, y: event.clientY });
  }

  function stepZoom(direction: -1 | 1) {
    const current = zoom === "fit" ? 100 : zoom;
    const exactIndex = ZOOM_STEPS.findIndex((value) => value === current);
    const index = exactIndex >= 0 ? exactIndex : ZOOM_STEPS.indexOf(100);
    const nextIndex = Math.max(0, Math.min(ZOOM_STEPS.length - 1, index + direction));
    setZoom(ZOOM_STEPS[nextIndex]);
  }

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context || !ready || event.button !== 0) {
      return;
    }
    if (tool === "crop") {
      return;
    }
    if (tool === "pan") {
      const stage = stageRef.current;
      if (!stage) {
        return;
      }
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      panRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: stage.scrollLeft,
        scrollTop: stage.scrollTop,
      };
      return;
    }
    const point = canvasPoint(canvas, event.clientX, event.clientY);
    if (tool === "text") {
      event.preventDefault();
      if (editingRef.current) {
        commitTextDraft();
        return;
      }
      startTextDraft(point);
      return;
    }
    if (editingRef.current) {
      commitTextDraft();
    }
    if (tool === "select") {
      const tolerance = 8 * (canvas.width / Math.max(1, canvas.getBoundingClientRect().width));
      const hit = hitTest(context, annotationsRef.current, point, tolerance);
      setSelectedId(hit ? hit.id : null);
      if (hit) {
        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        moveDragRef.current = {
          pointerId: event.pointerId,
          id: hit.id,
          origin: point,
          before: annotationsRef.current,
          moved: false,
        };
      }
      return;
    }
    if (tool === "pencil") {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      freehandRef.current = { pointerId: event.pointerId, points: [point] };
      renderCanvas();
      drawFreehand(context, [point], color, lineWidthFor(canvas.width, stroke));
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = { start: point };
  }

  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (tool === "crop") {
      return;
    }
    if (tool === "pan") {
      const pan = panRef.current;
      const stage = stageRef.current;
      if (pan && stage && pan.pointerId === event.pointerId) {
        stage.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
        stage.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
      }
      return;
    }
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    if (tool === "select") {
      const moveDrag = moveDragRef.current;
      if (moveDrag && moveDrag.pointerId === event.pointerId) {
        const point = canvasPoint(canvas, event.clientX, event.clientY);
        const dx = point.x - moveDrag.origin.x;
        const dy = point.y - moveDrag.origin.y;
        if (dx !== 0 || dy !== 0) {
          moveDrag.moved = true;
        }
        applyAnnotations(moveDrag.before.map((annotation) => (
          annotation.id === moveDrag.id ? translateAnnotation(annotation, dx, dy) : annotation
        )));
      }
      return;
    }
    if (tool === "pencil") {
      const freehand = freehandRef.current;
      if (freehand && freehand.pointerId === event.pointerId) {
        const point = canvasPoint(canvas, event.clientX, event.clientY);
        const previous = freehand.points[freehand.points.length - 1];
        if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.75) {
          freehand.points.push(point);
          drawFreehand(
            context,
            previous ? [previous, point] : [point],
            color,
            lineWidthFor(canvas.width, stroke),
          );
        }
      }
      return;
    }
    const drawing = drawingRef.current;
    if (!drawing || tool === "text") {
      return;
    }
    const end = canvasPoint(canvas, event.clientX, event.clientY);
    renderCanvas();
    if (tool === "mosaic") {
      const cssPixel = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
      const rect = normalizedRect(drawing.start, end);
      context.save();
      context.strokeStyle = "rgba(127, 127, 127, 0.9)";
      context.lineWidth = cssPixel;
      context.setLineDash([6 * cssPixel, 4 * cssPixel]);
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      context.restore();
    } else {
      drawShape(context, tool, drawing.start, end, color, lineWidthFor(canvas.width, stroke));
    }
  }

  function pointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (tool === "crop") {
      return;
    }
    if (tool === "pan") {
      if (panRef.current?.pointerId === event.pointerId) {
        panRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (tool === "select") {
      const moveDrag = moveDragRef.current;
      if (moveDrag && moveDrag.pointerId === event.pointerId) {
        moveDragRef.current = null;
        if (moveDrag.moved) {
          pushUndo(moveDrag.before);
        }
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (tool === "pencil") {
      const freehand = freehandRef.current;
      const canvas = event.currentTarget;
      if (!freehand || freehand.pointerId !== event.pointerId) {
        return;
      }
      const point = canvasPoint(canvas, event.clientX, event.clientY);
      const previous = freehand.points[freehand.points.length - 1];
      if (!previous || point.x !== previous.x || point.y !== previous.y) {
        freehand.points.push(point);
      }
      freehandRef.current = null;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      const before = annotationsRef.current;
      pushUndo(before);
      applyAnnotations([
        ...before,
        {
          id: idRef.current++,
          kind: "pencil",
          points: freehand.points,
          color,
          stroke,
        },
      ]);
      return;
    }
    const drawing = drawingRef.current;
    const canvas = event.currentTarget;
    if (!drawing || tool === "text") {
      return;
    }
    drawingRef.current = null;
    freehandRef.current = null;
    canvas.releasePointerCapture(event.pointerId);
    const end = canvasPoint(canvas, event.clientX, event.clientY);
    const rect = normalizedRect(drawing.start, end);
    if (rect.width < 2 && rect.height < 2) {
      renderCanvas();
      return;
    }
    const before = annotationsRef.current;
    pushUndo(before);
    if (tool === "mosaic") {
      applyAnnotations([
        ...before,
        { id: idRef.current++, kind: "mosaic", start: drawing.start, end },
      ]);
    } else {
      applyAnnotations([
        ...before,
        { id: idRef.current++, kind: tool, start: drawing.start, end, color, stroke },
      ]);
    }
  }

  function pointerCancel() {
    const moveDrag = moveDragRef.current;
    if (moveDrag) {
      applyAnnotations(moveDrag.before);
    }
    drawingRef.current = null;
    freehandRef.current = null;
    moveDragRef.current = null;
    panRef.current = null;
    renderCanvas();
  }

  function cropPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const canvas = canvasRef.current;
    if (tool !== "crop" || !canvas || !ready || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = canvasPoint(canvas, event.clientX, event.clientY);
    cropDragRef.current = { pointerId: event.pointerId, start: point, end: point };
    setCropDraft(normalizedRect(point, point));
  }

  function cropPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = cropDragRef.current;
    const canvas = canvasRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !canvas) {
      return;
    }
    drag.end = canvasPoint(canvas, event.clientX, event.clientY);
    setCropDraft(normalizedRect(drag.start, drag.end));
  }

  function cropPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    cropDragRef.current = null;
    setCropDraft(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    applyCrop(normalizedRect(drag.start, drag.end));
  }

  function cropPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (cropDragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    cropDragRef.current = null;
    setCropDraft(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function canvasDoubleClick(event: ReactMouseEvent<HTMLCanvasElement>) {
    if (tool !== "select" || !ready || editingRef.current) {
      return;
    }
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const point = canvasPoint(canvas, event.clientX, event.clientY);
    const tolerance = 8 * (canvas.width / Math.max(1, canvas.getBoundingClientRect().width));
    const hit = hitTest(context, annotationsRef.current, point, tolerance);
    if (hit?.kind === "text") {
      editTextAnnotation(hit);
    }
  }

  function beginHandleDrag(event: ReactPointerEvent<HTMLSpanElement>, handle: SelectionHandle) {
    if (event.button !== 0) {
      return;
    }
    const target = annotationById(selectedId);
    if (!target) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    handleDragRef.current = {
      pointerId: event.pointerId,
      handle,
      original: target,
      before: annotationsRef.current,
      changed: false,
    };
  }

  function handleDragMove(event: ReactPointerEvent<HTMLSpanElement>) {
    const drag = handleDragRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!drag || drag.pointerId !== event.pointerId || !canvas || !context) {
      return;
    }
    const point = canvasPoint(canvas, event.clientX, event.clientY);
    drag.changed = true;
    const next = resizeAnnotation(context, drag.original, drag.handle, point);
    applyAnnotations(drag.before.map((annotation) => (
      annotation.id === drag.original.id ? next : annotation
    )));
  }

  function endHandleDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    const drag = handleDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    handleDragRef.current = null;
    if (drag.changed) {
      pushUndo(drag.before);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function exportComposite() {
    const canvas = canvasRef.current;
    const base = baseRef.current;
    const output = document.createElement("canvas");
    output.width = canvas?.width ?? canvasSize.width;
    output.height = canvas?.height ?? canvasSize.height;
    const context = output.getContext("2d");
    if (!context || !base) {
      return output;
    }
    drawBase(context);
    for (const annotation of annotationsRef.current) {
      drawAnnotation(context, annotation);
    }
    return output;
  }

  function copyEditedImage() {
    if (!canvasRef.current || !ready || saving) {
      return;
    }
    commitTextDraft();
    onCopyEdited(exportComposite().toDataURL("image/png"));
  }

  async function saveAs() {
    if (!canvasRef.current || !ready || saving) {
      return;
    }
    commitTextDraft();
    try {
      const path = await selectScreenshotSavePath(
        suggestedSaveAsPath(screenshot.path),
        t("screenshots.editor.saveAs"),
      );
      if (!path) {
        return;
      }
      setSaving(true);
      const flattened = exportComposite();
      await writeDataUrlFile(path, saveAsDataUrl(flattened, path));
      setSaving(false);
      onExported(fileNameFromPath(path));
    } catch (error) {
      setSaving(false);
      onError(error);
    }
  }

  async function save(navigateDirection?: -1 | 1) {
    if (!canvasRef.current || !ready || saving) {
      return;
    }
    commitTextDraft();
    if (annotationsRef.current.length === 0 && cropRectRef.current === null) {
      return;
    }
    setSaving(true);
    try {
      const flattened = exportComposite();
      const created = await invokeCommand("save_edited_screenshot", {
        request: {
          id: screenshot.id,
          dataUrl: flattened.toDataURL("image/png"),
          saveAsCopy: false,
        },
      });
      const savedBase = document.createElement("canvas");
      savedBase.width = flattened.width;
      savedBase.height = flattened.height;
      savedBase.getContext("2d")?.drawImage(flattened, 0, 0);
      baseRef.current = savedBase;
      applyCropRect(null);
      undoRef.current = [];
      setUndoCount(0);
      applyAnnotations([]);
      setSelectedId(null);
      renderCanvas();
      setSaving(false);
      onSaved(created, navigateDirection);
    } catch (error) {
      setSaving(false);
      onError(error);
    }
  }

  function requestClose() {
    if (saving) {
      return;
    }
    if (dirty) {
      setPendingAction("close");
    } else {
      onClose();
    }
  }

  function requestNavigation(direction: -1 | 1) {
    if (saving) {
      return;
    }
    if (dirty) {
      setPendingAction(direction);
    } else {
      onNavigate(direction);
    }
  }

  function continueWithoutSaving() {
    const action = pendingAction;
    setPendingAction(null);
    if (action === "close") {
      onClose();
    } else if (action) {
      onNavigate(action);
    }
  }

  function clampEditorSize(width: number, height: number) {
    return {
      width: Math.min(Math.max(640, Math.round(width)), Math.max(640, window.innerWidth - 24)),
      height: Math.min(Math.max(420, Math.round(height)), Math.max(420, window.innerHeight - 24)),
    };
  }

  function finishResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (resizeRef.current?.pointerId !== event.pointerId) {
      return;
    }
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const zoomScale = zoom === "fit" ? null : zoom / 100;
  const scaledWidth = zoomScale ? Math.max(1, Math.round(canvasSize.width * zoomScale)) : null;
  const scaledHeight = zoomScale ? Math.max(1, Math.round(canvasSize.height * zoomScale)) : null;
  const fitSize = zoom === "fit" && stageSize.width > 0 && stageSize.height > 0
    ? fitImageDimensions(
        canvasSize.width,
        canvasSize.height,
        stageSize.width,
        stageSize.height,
        FIT_PADDING,
      )
    : null;
  const displayWidth = scaledWidth ?? fitSize?.width ?? null;
  const displayHeight = scaledHeight ?? fitSize?.height ?? null;
  const displayScale = displayWidth ? displayWidth / Math.max(1, canvasSize.width) : null;
  const cropDraftStyle = cropDraft && displayScale ? {
    left: cropDraft.x * displayScale,
    top: cropDraft.y * displayScale,
    width: cropDraft.width * displayScale,
    height: cropDraft.height * displayScale,
  } : null;

  const measureContext = ready ? canvasRef.current?.getContext("2d") ?? null : null;
  let selectionBox: { left: number; top: number; width: number; height: number } | null = null;
  let selectionHandles: Array<{ id: SelectionHandle; left: number; top: number }> = [];
  if (tool === "select" && selectedId !== null && displayScale && measureContext) {
    const selected = annotations.find((annotation) => annotation.id === selectedId);
    if (selected && editingId !== selected.id) {
      const bounds = annotationBounds(measureContext, selected);
      selectionBox = {
        left: bounds.x * displayScale,
        top: bounds.y * displayScale,
        width: bounds.width * displayScale,
        height: bounds.height * displayScale,
      };
      selectionHandles = selected.kind === "pencil"
        ? []
        : selected.kind === "arrow"
        ? [
            {
              id: "start",
              left: (selected.start.x - bounds.x) * displayScale,
              top: (selected.start.y - bounds.y) * displayScale,
            },
            {
              id: "end",
              left: (selected.end.x - bounds.x) * displayScale,
              top: (selected.end.y - bounds.y) * displayScale,
            },
          ]
        : [
            { id: "nw", left: 0, top: 0 },
            { id: "ne", left: selectionBox.width, top: 0 },
            { id: "sw", left: 0, top: selectionBox.height },
            { id: "se", left: selectionBox.width, top: selectionBox.height },
          ];
    }
  }

  let editingBox: { width: number; height: number } | null = null;
  if (editing && displayScale && measureContext) {
    const bounds = textBounds(measureContext, {
      x: editing.x,
      y: editing.y,
      text: editing.draft || " ",
      size: editing.size,
      font: editing.font,
      bold: editing.bold,
      italic: editing.italic,
    });
    editingBox = {
      width: Math.max(bounds.width, editing.size * 2) * displayScale + 14,
      height: bounds.height * displayScale + 8,
    };
  }

  return (
    <DialogShell>
      <Sheet
        width={editorSize.width}
        height={editorSize.height}
        className="screenshots-editor"
        title={screenshot.fileName}
        ariaLabel={screenshot.fileName}
        closeAriaLabel={t("common.close")}
        onClose={requestClose}
        footer={
          <Actions
            extraLeft={
              <span className="screenshots-editor__footer-meta">
                {canvasSize.width}×{canvasSize.height} · {formatScreenshotBytes(screenshot.fileSizeBytes)}
              </span>
            }
          />
        }
      >
        <div
          ref={workspaceRef}
          className="screenshots-editor__workspace"
          tabIndex={-1}
          onKeyDown={(event) => {
            const editingText = event.target instanceof HTMLInputElement
              || event.target instanceof HTMLTextAreaElement
              || event.target instanceof HTMLSelectElement;
            if (event.key === "Escape" && !saving) {
              event.preventDefault();
              requestClose();
              return;
            }
            if (editingText) {
              return;
            }
            const shortcutAction = workspaceShortcutFromKeyboardEvent(
              event.nativeEvent,
              shortcutOverrides,
              "screenshotEditor",
            );
            if (shortcutAction === "screenshotEditorCopy") {
              event.preventDefault();
              copyEditedImage();
              return;
            }
            if (shortcutAction === "screenshotEditorSave") {
              event.preventDefault();
              void save();
              return;
            }
            if (shortcutAction === "screenshotEditorSaveAs") {
              event.preventDefault();
              void saveAs();
              return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
              event.preventDefault();
              undo();
            } else if (
              (event.key === "Delete" || event.key === "Backspace")
              && selectedId !== null
              && tool === "select"
            ) {
              event.preventDefault();
              deleteAnnotation(selectedId);
            } else if (event.key === "ArrowLeft" && hasPrevious) {
              event.preventDefault();
              requestNavigation(-1);
            } else if (event.key === "ArrowRight" && hasNext) {
              event.preventDefault();
              requestNavigation(1);
            }
          }}
        >
          <div className="screenshots-editor__toolbar" role="toolbar">
            <div className="screenshots-editor__nav-group">
              <button
                type="button"
                title={t("common.back")}
                aria-label={t("common.back")}
                disabled={!hasPrevious || saving}
                onClick={() => requestNavigation(-1)}
              >
                <ChevronLeft size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                title={t("common.forward")}
                aria-label={t("common.forward")}
                disabled={!hasNext || saving}
                onClick={() => requestNavigation(1)}
              >
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </div>
            <span className="screenshots-editor__divider" aria-hidden="true" />
            <div className="screenshots-editor__action-group">
              <button
                type="button"
                title={t("common.save")}
                aria-label={t("common.save")}
                disabled={!ready || !dirty || saving}
                onClick={() => void save()}
              >
                <Floppy size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                title={t("screenshots.editor.saveAs")}
                aria-label={t("screenshots.editor.saveAs")}
                disabled={!ready || saving}
                onClick={() => void saveAs()}
              >
                <MultipleFloppy />
              </button>
              <button
                type="button"
                title={t("screenshots.editor.undo")}
                aria-label={t("screenshots.editor.undo")}
                disabled={!undoCount || saving}
                onClick={undo}
              >
                <RotateCcw size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                title={t("screenshots.menu.copy")}
                aria-label={t("screenshots.menu.copy")}
                disabled={!ready || saving}
                onClick={copyEditedImage}
              >
                <Copy size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                title={t("screenshots.menu.openExternal")}
                aria-label={t("screenshots.menu.openExternal")}
                disabled={saving}
                onClick={onOpenExternal}
              >
                <ExternalLink size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                title={t("screenshots.menu.reveal")}
                aria-label={t("screenshots.menu.reveal")}
                disabled={saving}
                onClick={onReveal}
              >
                <FolderOpen size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="danger"
                title={t("common.delete")}
                aria-label={t("common.delete")}
                disabled={saving}
                onClick={onDelete}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
            <span className="screenshots-editor__divider" aria-hidden="true" />
            {EDITOR_TOOLS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={tool === item.id ? "active" : ""}
                  aria-pressed={tool === item.id}
                  aria-label={t(item.key)}
                  title={t(item.key)}
                  onClick={() => {
                    if (editingRef.current) {
                      commitTextDraft();
                    }
                    setTool(item.id);
                    if (item.id !== "select") {
                      setSelectedId(null);
                    }
                  }}
                >
                  <Icon size={15} aria-hidden="true" />
                </button>
              );
            })}
            <span className="screenshots-editor__divider" aria-hidden="true" />
            <div
              className="screenshots-editor__swatches"
              role="group"
              aria-label={t("screenshots.editor.color")}
            >
              <span className="screenshots-editor__optionsbar-label">
                {t("screenshots.editor.color")}
              </span>
              {swatches.map((swatch) => (
                <button
                  key={swatch.key}
                  type="button"
                  className={`screenshots-editor__swatch${
                    color.toLowerCase() === swatch.value.toLowerCase() ? " active" : ""
                  }`}
                  style={{ background: swatch.value }}
                  aria-label={t(swatch.key)}
                  title={t(swatch.key)}
                  aria-pressed={color.toLowerCase() === swatch.value.toLowerCase()}
                  onClick={() => applyColor(swatch.value)}
                />
              ))}
              <ColorPalettePicker
                className="screenshots-editor__custom-color"
                value={color}
                onChange={applyColor}
              />
            </div>
            <span className="screenshots-editor__divider" aria-hidden="true" />
            <div
              className="screenshots-editor__strokes"
              role="group"
              aria-label={t("screenshots.editor.strokeWidth")}
            >
              <span className="screenshots-editor__optionsbar-label">
                {t("screenshots.editor.strokeWidth")}
              </span>
              {STROKE_OPTIONS.map((option) => (
                <button
                  key={option.width}
                  type="button"
                  className={`screenshots-editor__stroke${stroke === option.width ? " active" : ""}`}
                  aria-label={t(option.key)}
                  title={t(option.key)}
                  aria-pressed={stroke === option.width}
                  onClick={() => applyStroke(option.width)}
                >
                  <i style={{ width: option.dot, height: option.dot, background: color }} />
                </button>
              ))}
            </div>
            <span className="screenshots-editor__toolbar-spacer" />
            <div className="screenshots-editor__zoom" aria-label={t("workspace.fileViewer.zoomIn")}>
              <button
                type="button"
                title={t("workspace.fileViewer.zoomOut")}
                aria-label={t("workspace.fileViewer.zoomOut")}
                disabled={zoom === ZOOM_STEPS[0]}
                onClick={() => stepZoom(-1)}
              >
                <ZoomOut size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                title={t("workspace.fileViewer.zoomIn")}
                aria-label={t("workspace.fileViewer.zoomIn")}
                disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                onClick={() => stepZoom(1)}
              >
                <ZoomIn size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={zoom === "fit" ? "active" : ""}
                title={t("workspace.fileViewer.fit")}
                aria-label={t("workspace.fileViewer.fit")}
                onClick={() => setZoom("fit")}
              >
                <Maximize2 size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div
            ref={stageRef}
            className={`screenshots-editor__stage${zoom === "fit" ? " is-fit" : ""}${tool === "crop" ? " is-crop" : ""}`}
            onPointerDown={cropPointerDown}
            onPointerMove={cropPointerMove}
            onPointerUp={cropPointerUp}
            onPointerCancel={cropPointerCancel}
          >
            <div
              className={`screenshots-editor__canvas-wrap${zoom === "fit" ? " is-fit" : ""}`}
              style={scaledWidth && scaledHeight
                ? { width: scaledWidth + 36, height: scaledHeight + 36 }
                : undefined}
            >
              <div
                className="screenshots-editor__canvas-frame"
                style={displayWidth && displayHeight
                  ? { width: displayWidth, height: displayHeight }
                  : undefined}
              >
                <canvas
                  ref={canvasRef}
                  className={`${zoom === "fit" ? "is-fit" : "is-scaled"}${
                    tool === "pan" ? " is-pan" : tool === "select" ? " is-select" : tool === "text" ? " is-text" : ""
                  }`}
                  aria-label={screenshot.fileName}
                  onPointerDown={pointerDown}
                  onPointerMove={pointerMove}
                  onPointerUp={pointerUp}
                  onPointerCancel={pointerCancel}
                  onDoubleClick={canvasDoubleClick}
                  onContextMenu={canvasContextMenu}
                />
                {cropDraftStyle ? (
                  <div className="screenshots-editor__crop-selection" style={cropDraftStyle} />
                ) : null}
                {selectionBox ? (
                  <div
                    className="screenshots-editor__selection"
                    style={{
                      left: selectionBox.left,
                      top: selectionBox.top,
                      width: selectionBox.width,
                      height: selectionBox.height,
                    }}
                  >
                    {selectionHandles.map((handle) => (
                      <span
                        key={handle.id}
                        className={`screenshots-editor__handle is-${handle.id}`}
                        style={{ left: handle.left, top: handle.top }}
                        onPointerDown={(event) => beginHandleDrag(event, handle.id)}
                        onPointerMove={handleDragMove}
                        onPointerUp={endHandleDrag}
                        onPointerCancel={endHandleDrag}
                      />
                    ))}
                  </div>
                ) : null}
                {editing && displayScale && editingBox ? (
                  <textarea
                    className="screenshots-editor__text-input"
                    style={{
                      left: editing.x * displayScale - 2,
                      top: editing.y * displayScale - 2,
                      width: editingBox.width,
                      height: editingBox.height,
                      fontSize: editing.size * displayScale,
                      lineHeight: TEXT_LINE_HEIGHT,
                      fontFamily: resolvedTextFont(editing.font),
                      fontWeight: editing.bold ? 700 : 400,
                      fontStyle: editing.italic ? "italic" : "normal",
                      color: editing.color,
                      caretColor: editing.color,
                    }}
                    value={editing.draft}
                    aria-label={t("screenshots.editor.textPlaceholder")}
                    autoFocus
                    spellCheck={false}
                    onChange={(event) => {
                      const draft = editingRef.current;
                      if (draft) {
                        applyEditing({ ...draft, draft: event.currentTarget.value });
                      }
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Escape") {
                        event.preventDefault();
                        applyEditing(null);
                      }
                    }}
                    onBlur={commitTextDraft}
                    onPointerDown={(event) => event.stopPropagation()}
                    onContextMenu={editingContextMenu}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <button
          aria-label={t("screenshots.editor.resizeDialog")}
          className="screenshots-editor__resizer"
          onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
              return;
            }
            event.preventDefault();
            const step = event.shiftKey ? 64 : 24;
            setEditorSize((current) => clampEditorSize(
              current.width + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
              current.height + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
            ));
          }}
          onPointerCancel={finishResize}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              width: editorSize.width,
              height: editorSize.height,
            };
          }}
          onPointerMove={(event) => {
            const start = resizeRef.current;
            if (!start || start.pointerId !== event.pointerId) {
              return;
            }
            setEditorSize(clampEditorSize(
              start.width + event.clientX - start.startX,
              start.height + event.clientY - start.startY,
            ));
          }}
          onPointerUp={finishResize}
          title={t("screenshots.editor.resizeDialog")}
          type="button"
        />
      </Sheet>
      {pendingAction !== null ? (
        <ConfirmSheet
          tone="warn"
          title={t("screenshots.editor.unsavedTitle")}
          message={t("screenshots.editor.unsavedMessage")}
          confirmLabel={t("common.save")}
          confirmIcon="check"
          extraLeft={
            <Btn kind="danger" onClick={continueWithoutSaving}>
              {t("screenshots.editor.dontSave")}
            </Btn>
          }
          onConfirm={() => {
            const navigateDirection = typeof pendingAction === "number" ? pendingAction : undefined;
            setPendingAction(null);
            void save(navigateDirection);
          }}
          onCancel={() => setPendingAction(null)}
          zClassName="kk-qc-subdialog"
        />
      ) : null}
    </DialogShell>
  );
}
