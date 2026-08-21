import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { asBackground } from "react-linear-gradient-picker";
import { DIcon } from "../../../app/ui/dialog";
import { isTauriRuntime, openExternalUrl } from "../../../lib/tauri";
import { BACKGROUND_PRESETS } from "../registry/backgroundPresets";
import { DashboardDynamicBackground, DYNAMIC_BACKGROUNDS } from "../registry/dynamicBackgrounds";
import { importBackgroundImage } from "../state/persistence";
import { BACKGROUND_FITS, type BackgroundFit, type DashboardBackground, type GradientColorStop } from "../types";
import { CustomGradientBuilder } from "./CustomGradientBuilder";

type Mode = "preset" | "media" | "dynamic";
type MediaBackground = Extract<DashboardBackground, { kind: "image" | "video" }>;
type CustomGradientBackground = Extract<DashboardBackground, { kind: "customGradient" }>;

const DEFAULT_GRADIENT_STOPS: GradientColorStop[] = [
  { color: "#6366f1", offset: 0 },
  { color: "#ec4899", offset: 100 },
];
const DEFAULT_GRADIENT_ANGLE = 135;

function customGradientCss(background: CustomGradientBackground): string {
  return asBackground({ angle: background.angle, stops: background.stops, type: "linear" });
}

function modeOf(background: DashboardBackground | null): Mode {
  if (!background) return "preset";
  if (background.kind === "preset" || background.kind === "customGradient") return "preset";
  if (background.kind === "dynamic") return "dynamic";
  return "media";
}

function isMediaBackground(background: DashboardBackground | null): background is MediaBackground {
  return background?.kind === "image" || background?.kind === "video";
}

function mediaKindForFile(file: string): "image" | "video" {
  return /\.(mp4|webm|mov|m4v|ogv)$/i.test(file) ? "video" : "image";
}

export interface SharedBackgroundPopoverProps {
  background: DashboardBackground | null;
  titleKey: string;
  defaultHintKey: string;
  className?: string;
  onBackgroundChange: (background: DashboardBackground | null) => void | Promise<void>;
  onLoadBackgroundImage: (file: string) => void | Promise<void>;
  onClose: () => void;
}

export function SharedBackgroundPopover({
  background,
  titleKey,
  defaultHintKey,
  className = "",
  onBackgroundChange,
  onLoadBackgroundImage,
  onClose,
}: SharedBackgroundPopoverProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<Mode>(modeOf(background));
  const [importError, setImportError] = useState("");
  const [hoveredDynamicId, setHoveredDynamicId] = useState<string | null>(null);
  const [customGradientOpen, setCustomGradientOpen] = useState(false);
  const mediaBackground = isMediaBackground(background) ? background : null;
  const customGradientBackground = background?.kind === "customGradient" ? background : null;

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function applyDefault() {
    setMode("preset");
    void onBackgroundChange(null);
  }

  function applyPreset(presetId: string) {
    setMode("preset");
    void onBackgroundChange({ kind: "preset", preset: presetId });
  }

  function applyDynamic(dynamicId: string) {
    setMode("dynamic");
    void onBackgroundChange({ kind: "dynamic", dynamic: dynamicId });
  }

  function applyCustomGradient(next: { stops: GradientColorStop[]; angle: number }) {
    setMode("preset");
    void onBackgroundChange({ kind: "customGradient", stops: next.stops, angle: next.angle });
  }

  function toggleCustomGradient() {
    if (!customGradientBackground) {
      applyCustomGradient({ stops: DEFAULT_GRADIENT_STOPS, angle: DEFAULT_GRADIENT_ANGLE });
      setCustomGradientOpen(true);
      return;
    }
    setCustomGradientOpen((open) => !open);
  }

  function applyMediaPatch(patch: Partial<Omit<MediaBackground, "kind">>) {
    const base: MediaBackground = mediaBackground ?? { kind: "image", file: "", fit: "fill", dim: 0 };
    if (!base.file && !patch.file) return;
    void onBackgroundChange({ ...base, ...patch });
  }

  async function chooseMedia() {
    setImportError("");
    try {
      let sourcePath: string | null = null;
      if (isTauriRuntime()) {
        const selected = await openDialog({
          directory: false,
          multiple: false,
          title: t("dashboard.backgroundChooseMedia"),
          filters: [{
            name: t("dashboard.backgroundMediaFilter"),
            extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "mp4", "webm", "mov", "m4v", "ogv"],
          }],
        });
        sourcePath = typeof selected === "string" ? selected : null;
      } else {
        sourcePath = "preview-media.png";
      }
      if (!sourcePath) return;
      const file = await importBackgroundImage(sourcePath);
      await onLoadBackgroundImage(file);
      setMode("media");
      const base = mediaBackground ?? { fit: "fill" as BackgroundFit, dim: 0 };
      void onBackgroundChange({ kind: mediaKindForFile(file), file, fit: base.fit, dim: base.dim });
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div ref={ref} className={["dw-bg-popover", className].filter(Boolean).join(" ")}>
      <div className="dw-bg-popover-head">
        <DIcon name="stack" size={15} />
        <span>{t(titleKey)}</span>
      </div>

      <div className="dw-bg-seg">
        <button className={mode === "preset" ? "active" : ""} onClick={() => setMode("preset")} type="button">
          <DIcon name="palette" size={13} />
          <span>{t("dashboard.backgroundModePreset")}</span>
        </button>
        <button className={mode === "media" ? "active" : ""} onClick={() => setMode("media")} type="button">
          <DIcon name="gallery" size={13} />
          <span>{t("dashboard.backgroundModeMedia")}</span>
        </button>
        <button className={mode === "dynamic" ? "active" : ""} onClick={() => setMode("dynamic")} type="button">
          <DIcon name="bolt" size={13} />
          <span>{t("dashboard.backgroundModeDynamic")}</span>
        </button>
      </div>

      <div className="dw-bg-popover-body">
        {mode === "preset" && (
          <div className="dw-bg-preset-grid">
            <button
              className={"dw-bg-preset-default" + (!background ? " active" : "")}
              title={t(defaultHintKey)}
              aria-label={t("dashboard.backgroundModeDefault")}
              onClick={applyDefault}
              type="button"
            />
            {BACKGROUND_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className={background?.kind === "preset" && background.preset === preset.id ? "active" : ""}
                style={{ background: preset.css }}
                title={t(preset.labelKey)}
                aria-label={t(preset.labelKey)}
                onClick={() => applyPreset(preset.id)}
                type="button"
              />
            ))}
            <button
              className={"dw-bg-preset-custom" + (customGradientBackground ? " active" : "")}
              style={customGradientBackground ? { background: customGradientCss(customGradientBackground) } : undefined}
              title={t("dashboard.backgroundCustomGradient")}
              aria-label={t("dashboard.backgroundCustomGradient")}
              onClick={toggleCustomGradient}
              type="button"
            >
              {!customGradientBackground && <DIcon name="plus" size={14} />}
            </button>
          </div>
        )}

        {mode === "dynamic" && (
          <div className="dw-bg-dynamic">
            <div className="dw-bg-thumb-grid">
              {DYNAMIC_BACKGROUNDS.map((backgroundOption) => {
                const isActive = background?.kind === "dynamic" && background.dynamic === backgroundOption.id;
                const isHovered = hoveredDynamicId === backgroundOption.id;
                return (
                  <button
                    key={backgroundOption.id}
                    className={"dw-bg-thumb-card" + (isActive ? " active" : "")}
                    onClick={() => applyDynamic(backgroundOption.id)}
                    onMouseEnter={() => setHoveredDynamicId(backgroundOption.id)}
                    onMouseLeave={() => setHoveredDynamicId((current) => (current === backgroundOption.id ? null : current))}
                    type="button"
                    title={t(backgroundOption.labelKey)}
                  >
                    <span className="dw-bg-thumb-frame">
                      <img
                        className="dw-bg-thumb-static"
                        src={`/dynamic-bg-thumbs/${backgroundOption.id}.webp`}
                        alt=""
                        loading="lazy"
                      />
                      {isHovered && (
                        <span className="dw-bg-thumb-live">
                          <DashboardDynamicBackground id={backgroundOption.id} active />
                        </span>
                      )}
                      {isActive && (
                        <span className="dw-bg-thumb-check">
                          <DIcon name="check" size={11} />
                        </span>
                      )}
                    </span>
                    <span className="dw-bg-thumb-name">{t(backgroundOption.labelKey)}</span>
                  </button>
                );
              })}
            </div>
            <p className="dw-warning-text">{t("dashboard.backgroundDynamicHint")}</p>
          </div>
        )}

        {mode === "media" && (
          <div className="dw-bg-image">
            <div className="dw-bg-image-actions">
              <button className="dw-secondary-button" onClick={() => { void chooseMedia(); }} type="button">
                {t("dashboard.backgroundChooseMedia")}
              </button>
              {mediaBackground && (
                <button className="dw-secondary-button" onClick={applyDefault} type="button">
                  {t("dashboard.backgroundRemoveImage")}
                </button>
              )}
            </div>
            <p className="dw-muted">
              {t("dashboard.backgroundMediaSourcePrefix")}{" "}
              <a
                href="https://pixabay.com/videos/search/wallpaper"
                onClick={(event) => {
                  event.preventDefault();
                  void openExternalUrl("https://pixabay.com/videos/search/wallpaper");
                }}
              >
                {t("dashboard.backgroundMediaSourceLink")}
              </a>
            </p>
            {importError && <small className="dw-muted">{importError}</small>}
            {mediaBackground && (
              <>
                <label className="dw-field">
                  <span>{t("dashboard.backgroundFitLabel")}</span>
                  <select
                    value={mediaBackground.fit}
                    onChange={(event) => applyMediaPatch({ fit: event.target.value as BackgroundFit })}
                  >
                    {BACKGROUND_FITS.map((fit) => (
                      <option key={fit} value={fit}>{t(`dashboard.backgroundFit.${fit}`)}</option>
                    ))}
                  </select>
                </label>
                <label className="dw-field">
                  <span>{t("dashboard.backgroundDimLabel")}</span>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    step={1}
                    value={mediaBackground.dim}
                    onChange={(event) => applyMediaPatch({ dim: Number(event.target.value) })}
                  />
                  <small className="dw-muted">{mediaBackground.dim}</small>
                </label>
              </>
            )}
            {!mediaBackground && <p className="dw-muted">{t("dashboard.backgroundMediaHint")}</p>}
          </div>
        )}
      </div>

      {mode === "preset" && customGradientOpen && customGradientBackground && (
        <div
          className="dw-bg-gradient-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) setCustomGradientOpen(false);
          }}
        >
          <div className="dw-bg-gradient-panel">
            <button
              className="dw-bg-gradient-close"
              aria-label={t("common.close")}
              onClick={() => setCustomGradientOpen(false)}
              type="button"
            >
              <DIcon name="close" size={14} />
            </button>
            <CustomGradientBuilder
              stops={customGradientBackground.stops}
              angle={customGradientBackground.angle}
              onChange={applyCustomGradient}
            />
          </div>
        </div>
      )}
    </div>
  );
}
