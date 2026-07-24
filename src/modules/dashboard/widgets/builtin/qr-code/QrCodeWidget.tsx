import { Copy } from "../../../../../lib/reicon";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SaveAsIcon } from "../../../../../app/ui/SaveAsIcon";
import type { BuiltInWidgetBodyProps } from "../../../registry/builtInRegistry";
import { technicalInputProps } from "../../../../../lib/inputBehavior";
import { isTauriRuntime, pickAndSaveFile } from "../../../../../lib/tauri";
import { useWidgetConfig } from "../../widgetLocalStorage";
import { resolveQrCanvasSize } from "./qrSizing";

type CodeMode = "qr" | "barcode";

interface QrConfig {
  text: string;
  mode: CodeMode;
}

const DEFAULT_CONFIG: QrConfig = { text: "", mode: "qr" };
const RENDER_DEBOUNCE_MS = 220;
const QR_STAGE_PADDING = 12;

function storageKey(instanceId: string) {
  return `kkterm.dashboard.qrCode.${instanceId}.v1`;
}

function normalizeConfig(value: unknown): QrConfig {
  if (!value || typeof value !== "object") return DEFAULT_CONFIG;
  const candidate = value as Partial<QrConfig>;
  return {
    text: typeof candidate.text === "string" ? candidate.text : "",
    mode: candidate.mode === "barcode" ? "barcode" : "qr",
  };
}

function resolvedColor(element: HTMLElement, variable: string, fallback: string) {
  const value = getComputedStyle(element).getPropertyValue(variable).trim();
  return value || fallback;
}

export function QrCodeBody({ instance }: BuiltInWidgetBodyProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useWidgetConfig(
    storageKey(instance.id),
    DEFAULT_CONFIG,
    normalizeConfig,
  );
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [qrCanvasSize, setQrCanvasSize] = useState(360);
  const [renderError, setRenderError] = useState(false);
  const [copied, setCopied] = useState(false);
  const trimmed = config.text.trim();

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateSize = () => {
      setQrCanvasSize(
        resolveQrCanvasSize({
          width: stage.clientWidth,
          height: stage.clientHeight,
          padding: QR_STAGE_PADDING,
        }),
      );
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !trimmed) {
      setRenderError(false);
      return;
    }
    const timer = window.setTimeout(() => {
      const dark = resolvedColor(canvas, "--text", "#17202b");
      const revealAfterRender = () => {
        setRenderError(false);
        // Restart the reveal animation on each regeneration.
        canvas.style.animation = "none";
        void canvas.offsetWidth;
        canvas.style.animation = "";
      };
      if (config.mode === "qr") {
        QRCode.toCanvas(canvas, trimmed, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: qrCanvasSize,
          color: { dark, light: "#00000000" },
        })
          .then(revealAfterRender)
          .catch(() => setRenderError(true));
        return;
      }
      try {
        JsBarcode(canvas, trimmed, {
          format: "CODE128",
          lineColor: dark,
          background: "transparent",
          displayValue: true,
          font: "ui-monospace, Consolas, monospace",
          fontSize: 26,
          margin: 12,
        });
        revealAfterRender();
      } catch {
        setRenderError(true);
      }
    }, RENDER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [trimmed, config.mode, qrCanvasSize]);

  function withCanvasBlob(handler: (blob: Blob) => void | Promise<void>) {
    canvasRef.current?.toBlob((blob) => {
      if (blob) void handler(blob);
    }, "image/png");
  }

  function copyImage() {
    withCanvasBlob(async (blob) => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      } catch {
        // Clipboard image write can be unavailable; copying is best-effort.
      }
    });
  }

  function saveImage() {
    withCanvasBlob(async (blob) => {
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await pickAndSaveFile(config.mode === "qr" ? "qr-code.png" : "barcode.png", bytes, [
          { name: "PNG", extensions: ["png"] },
        ]);
      } catch {
        // User cancelled or the dialog is unavailable outside Tauri.
      }
    });
  }

  const showCode = trimmed.length > 0 && !renderError;

  return (
    <div className="dw-qr">
      <div className="dw-qr-toolbar">
        <div className="dw-qr-modes" role="radiogroup" aria-label={t("dashboard.qrModeLabel")}>
          {(["qr", "barcode"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={config.mode === mode}
              className={`dw-qr-mode${config.mode === mode ? " is-active" : ""}`}
              onClick={() => setConfig({ ...config, mode })}
            >
              {mode === "qr" ? t("dashboard.qrModeQr") : t("dashboard.qrModeBarcode")}
            </button>
          ))}
        </div>
        <div className="dw-qr-actions">
          <button
            type="button"
            className="dashboard-widget-icon-button"
            aria-label={t("dashboard.widgetCopyValue")}
            title={copied ? t("dashboard.widgetCopied") : t("dashboard.widgetCopyValue")}
            disabled={!showCode}
            onClick={copyImage}
          >
            <Copy size={14} className={copied ? "dw-qr-copied-icon" : undefined} />
          </button>
          {isTauriRuntime() ? (
            <button
              type="button"
              className="dashboard-widget-icon-button"
              aria-label={t("dashboard.qrSaveImage")}
              title={t("dashboard.qrSaveImage")}
              disabled={!showCode}
              onClick={saveImage}
            >
              <SaveAsIcon size={14} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="dw-qr-stage" ref={stageRef}>
        <canvas
          ref={canvasRef}
          className={`dw-qr-canvas dw-qr-canvas--${config.mode}${showCode ? "" : " is-hidden"}`}
          aria-hidden={!showCode}
        />
        {!trimmed ? <div className="dw-qr-empty">{t("dashboard.qrHint")}</div> : null}
        {trimmed && renderError ? <div className="dw-qr-empty">{t("dashboard.qrError")}</div> : null}
      </div>
      <textarea
        className="dw-qr-input"
        value={config.text}
        onChange={(event) => setConfig({ ...config, text: event.target.value })}
        placeholder={t("dashboard.qrPlaceholder")}
        aria-label={t("dashboard.qrPlaceholder")}
        rows={2}
        {...technicalInputProps}
      />
    </div>
  );
}
