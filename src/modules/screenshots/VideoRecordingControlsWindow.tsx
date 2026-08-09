import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Play, Square } from "../../lib/reicon";
import {
  invokeCommand,
  type VideoRecordingStatus,
} from "../../lib/tauri";
import "./videoRecordingControls.css";

const EMPTY_STATUS: VideoRecordingStatus = {
  active: false,
  paused: false,
  fileName: null,
  startedAt: null,
  elapsedMs: 0,
  mode: null,
  format: null,
  width: null,
  height: null,
  previewDataUrl: null,
};

function elapsedLabel(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function VideoRecordingControlsWindow() {
  const { t } = useTranslation();
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      void invokeCommand("video_recording_status", undefined)
        .then((next) => {
          if (mounted) setStatus(next);
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 250);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  async function togglePause() {
    setBusy(true);
    try {
      await invokeCommand(
        status.paused ? "resume_video_recording" : "pause_video_recording",
        undefined,
      );
      setStatus((current) => ({ ...current, paused: !current.paused }));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await invokeCommand("stop_video_recording", undefined);
    } finally {
      setBusy(false);
    }
  }

  const modeLabel = status.mode === "window"
    ? t("screenshots.captureWindow")
    : status.mode === "region"
      ? t("screenshots.captureRegion")
      : t("screenshots.captureFullscreen");
  const dimensions = status.width && status.height
    ? `${status.width}×${status.height}`
    : t("screenshots.video.systemFullscreen");

  return (
    <main className="video-recording-controls">
      <div
        className="video-recording-controls__drag"
        data-tauri-drag-region
      >
        <span className={`video-recording-controls__dot${status.paused ? " paused" : ""}`} />
        <span>{status.paused ? t("screenshots.video.paused") : t("screenshots.video.recording")}</span>
        <strong>{elapsedLabel(status.elapsedMs)}</strong>
      </div>
      <div className="video-recording-controls__body">
        <div className="video-recording-controls__target">
          {status.previewDataUrl ? <img src={status.previewDataUrl} alt="" /> : <span />}
          <div>
            <strong>{modeLabel}</strong>
            <small>{dimensions} · {status.format?.toUpperCase()}</small>
          </div>
        </div>
        <div className="video-recording-controls__actions">
          <button type="button" disabled={busy || !status.active} onClick={() => void togglePause()}>
            {status.paused ? <Play size={14} fill="currentColor" /> : <span aria-hidden="true">Ⅱ</span>}
            {status.paused ? t("screenshots.video.resume") : t("screenshots.video.pause")}
          </button>
          <button className="stop" type="button" disabled={busy || !status.active} onClick={() => void stop()}>
            <Square size={12} fill="currentColor" />
            {t("screenshots.video.stop")}
          </button>
        </div>
      </div>
    </main>
  );
}
