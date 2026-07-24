import { ImageUp, Link, Unlink, X } from "../../../../../lib/reicon";
import { SaveAsIcon } from "../../../../../app/ui/SaveAsIcon";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { technicalInputProps } from "../../../../../lib/inputBehavior";
import {
  isTauriRuntime,
  pickAndReadFile,
  pickAndSaveFile,
} from "../../../../../lib/tauri";
import { useWorkspaceStore } from "../../../../../store";
import {
  calculateExactDimensions,
  calculatePercentageDimensions,
  outputFilename,
  outputMimeType,
  validateImageDimensions,
  type ImageDimensions,
  type ImageOutputFormat,
} from "./imageConverterTools";

type ResizeMode = "exact" | "percentage";

interface SourceImage {
  bitmap: ImageBitmap;
  bytes: number;
  height: number;
  name: string;
  previewUrl: string;
  width: number;
}

const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const PERCENTAGE_PRESETS = [25, 50, 75, 100, 200];

export function ImageConverterPanel() {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [format, setFormat] = useState<ImageOutputFormat>("png");
  const [quality, setQuality] = useState(85);
  const [resizeMode, setResizeMode] = useState<ResizeMode>("exact");
  const [lockAspectRatio, setLockAspectRatio] = useState(true);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [percentage, setPercentage] = useState("100");
  const [busy, setBusy] = useState(false);

  useEffect(() => () => {
    source?.bitmap.close();
    if (source) URL.revokeObjectURL(source.previewUrl);
  }, [source]);

  const targetDimensions = useMemo<ImageDimensions | null>(() => {
    if (!source) return null;
    if (resizeMode === "percentage") {
      const parsed = Number(percentage);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 500) return null;
      return calculatePercentageDimensions(source.width, source.height, parsed);
    }
    const parsedWidth = Number(width);
    const parsedHeight = Number(height);
    if (!Number.isFinite(parsedWidth) || !Number.isFinite(parsedHeight)) return null;
    return { width: Math.round(parsedWidth), height: Math.round(parsedHeight) };
  }, [height, percentage, resizeMode, source, width]);
  const dimensionError = targetDimensions
    ? validateImageDimensions(targetDimensions.width, targetDimensions.height)
    : "invalid";

  async function chooseImage() {
    try {
      const file = await pickAndReadFile([
        { name: t("dashboard.imageConverter.imageFiles"), extensions: ["jpg", "jpeg", "png", "webp"] },
      ]);
      if (!file) return;
      if (file.bytes.byteLength > MAX_INPUT_BYTES) {
        showStatusBarNotice(t("dashboard.imageConverter.fileTooLarge"), { tone: "warning" });
        return;
      }
      const bytes = file.bytes.slice();
      const blob = new Blob([bytes.buffer], { type: mimeTypeForName(file.name) });
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      const inputError = validateImageDimensions(bitmap.width, bitmap.height);
      if (inputError) {
        bitmap.close();
        showStatusBarNotice(dimensionErrorMessage(t, inputError), { tone: "warning" });
        return;
      }
      setSource({
        bitmap,
        bytes: file.bytes.byteLength,
        height: bitmap.height,
        name: file.name,
        previewUrl: URL.createObjectURL(blob),
        width: bitmap.width,
      });
      setWidth(String(bitmap.width));
      setHeight(String(bitmap.height));
      setPercentage("100");
    } catch {
      showStatusBarNotice(t("dashboard.imageConverter.openFailed"), { tone: "error" });
    }
  }

  function updateExactDimension(changed: "width" | "height", value: string) {
    if (!source) return;
    if (changed === "width") setWidth(value);
    else setHeight(value);
    const parsed = Number(value);
    if (!lockAspectRatio || !Number.isFinite(parsed) || parsed <= 0) return;
    const next = calculateExactDimensions(
      source.width,
      source.height,
      changed === "width" ? parsed : Number(width),
      changed === "height" ? parsed : Number(height),
      changed,
      true,
    );
    setWidth(String(next.width));
    setHeight(String(next.height));
  }

  function clearSource() {
    setSource(null);
    setWidth("");
    setHeight("");
    setPercentage("100");
  }

  async function convertAndSave() {
    if (!source || !targetDimensions || dimensionError) return;
    setBusy(true);
    try {
      const resizedCanvas = document.createElement("canvas");
      resizedCanvas.width = targetDimensions.width;
      resizedCanvas.height = targetDimensions.height;
      if (targetDimensions.width === source.width && targetDimensions.height === source.height) {
        const context = resizedCanvas.getContext("2d");
        if (!context) throw new Error("Canvas is unavailable.");
        context.drawImage(source.bitmap, 0, 0);
      } else {
        const { default: pica } = await import("pica");
        await pica().resize(source.bitmap, resizedCanvas, { filter: "mks2013" });
      }

      const outputCanvas = format === "jpg"
        ? compositeOnWhite(resizedCanvas)
        : resizedCanvas;
      const mimeType = outputMimeType(format);
      const blob = await canvasToBlob(outputCanvas, mimeType, quality / 100);
      if (blob.type !== mimeType) {
        showStatusBarNotice(
          t("dashboard.imageConverter.unsupportedFormat", { format: format.toUpperCase() }),
          { tone: "error" },
        );
        return;
      }
      const filename = outputFilename(source.name, format);
      const savedPath = await pickAndSaveFile(
        filename,
        new Uint8Array(await blob.arrayBuffer()),
        [{ name: format.toUpperCase(), extensions: [format] }],
      );
      if (savedPath) {
        showStatusBarNotice(t("dashboard.imageConverter.saved", { name: filename }), { tone: "success" });
      }
    } catch {
      showStatusBarNotice(t("dashboard.imageConverter.convertFailed"), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  if (!isTauriRuntime()) {
    return <div className="dw-image-empty">{t("dashboard.imageConverter.desktopOnly")}</div>;
  }

  return (
    <div className="dw-image-converter">
      {source ? (
        <div className="dw-image-source">
          <img src={source.previewUrl} alt="" />
          <div>
            <strong title={source.name}>{source.name}</strong>
            <span>{source.width} × {source.height} · {formatBytes(source.bytes)}</span>
          </div>
          <button type="button" className="dashboard-widget-icon-button" onClick={clearSource} aria-label={t("common.remove")} title={t("common.remove")}>
            <X size={13} />
          </button>
        </div>
      ) : (
        <button type="button" className="dw-image-choose secondary-button" onClick={() => void chooseImage()}>
          <ImageUp size={14} />
          {t("dashboard.imageConverter.chooseImage")}
        </button>
      )}

      <div className="dw-image-options">
        <label>
          <span>{t("dashboard.imageConverter.outputFormat")}</span>
          <select value={format} onChange={(event) => setFormat(event.currentTarget.value as ImageOutputFormat)}>
            <option value="jpg">JPG</option>
            <option value="png">PNG</option>
            <option value="webp">WebP</option>
          </select>
        </label>
        {format !== "png" ? (
          <label className="dw-image-quality">
            <span>{t("dashboard.imageConverter.quality", { value: quality })}</span>
            <input type="range" min="1" max="100" value={quality} onChange={(event) => setQuality(Number(event.currentTarget.value))} />
          </label>
        ) : (
          <span className="dw-image-lossless">{t("dashboard.imageConverter.pngLossless")}</span>
        )}
      </div>

      <div className="dw-image-resize-modes" role="radiogroup" aria-label={t("dashboard.imageConverter.resizeMode")}>
        {(["exact", "percentage"] as ResizeMode[]).map((mode) => (
          <button key={mode} type="button" role="radio" aria-checked={resizeMode === mode} className={resizeMode === mode ? "is-active" : ""} onClick={() => setResizeMode(mode)}>
            {t(`dashboard.imageConverter.${mode}`)}
          </button>
        ))}
      </div>

      {resizeMode === "exact" ? (
        <div className="dw-image-dimensions">
          <label>
            <span>{t("dashboard.imageConverter.width")}</span>
            <input type="number" min="1" max="16384" value={width} onChange={(event) => updateExactDimension("width", event.currentTarget.value)} {...technicalInputProps} />
          </label>
          <button type="button" className="dashboard-widget-icon-button" aria-pressed={lockAspectRatio} aria-label={t("dashboard.imageConverter.lockAspectRatio")} title={t("dashboard.imageConverter.lockAspectRatio")} onClick={() => setLockAspectRatio((locked) => !locked)}>
            {lockAspectRatio ? <Link size={13} /> : <Unlink size={13} />}
          </button>
          <label>
            <span>{t("dashboard.imageConverter.height")}</span>
            <input type="number" min="1" max="16384" value={height} onChange={(event) => updateExactDimension("height", event.currentTarget.value)} {...technicalInputProps} />
          </label>
        </div>
      ) : (
        <div className="dw-image-percentage">
          <label>
            <span>{t("dashboard.imageConverter.percentage")}</span>
            <div><input type="number" min="1" max="500" value={percentage} onChange={(event) => setPercentage(event.currentTarget.value)} {...technicalInputProps} /><span>%</span></div>
          </label>
          <div className="dw-image-presets">
            {PERCENTAGE_PRESETS.map((preset) => (
              <button key={preset} type="button" className={percentage === String(preset) ? "is-active" : ""} onClick={() => setPercentage(String(preset))}>{preset}%</button>
            ))}
          </div>
        </div>
      )}

      <div className="dw-image-footer">
        <span className={source && dimensionError ? "is-error" : ""}>
          {source && targetDimensions && !dimensionError
            ? t("dashboard.imageConverter.outputDimensions", {
                width: targetDimensions.width,
                height: targetDimensions.height,
              })
            : source
              ? dimensionErrorMessage(t, dimensionError)
              : t("dashboard.imageConverter.selectHint")}
        </span>
        <button type="button" className="primary-button" disabled={!source || Boolean(dimensionError) || busy} onClick={() => void convertAndSave()}>
          <SaveAsIcon size={13} />
          {busy ? t("dashboard.imageConverter.converting") : t("dashboard.imageConverter.convertAndSave")}
        </button>
      </div>
    </div>
  );
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas encoding returned no image."));
    }, mimeType, quality);
  });
}

function compositeOnWhite(source: HTMLCanvasElement) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0);
  return canvas;
}

function mimeTypeForName(name: string) {
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  return "image/jpeg";
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dimensionErrorMessage(
  t: ReturnType<typeof useTranslation>["t"],
  error: ReturnType<typeof validateImageDimensions>,
) {
  if (error === "dimension") return t("dashboard.imageConverter.dimensionLimit");
  if (error === "pixels") return t("dashboard.imageConverter.pixelLimit");
  return t("dashboard.imageConverter.invalidDimensions");
}
