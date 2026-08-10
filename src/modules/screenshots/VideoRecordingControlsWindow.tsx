import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GripVertical, Pause, Play, Square } from "../../lib/reicon";
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
};

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

  const stateLabel = status.paused
    ? t("screenshots.video.paused")
    : t("screenshots.video.recording");
  const pauseLabel = status.paused
    ? t("screenshots.video.resume")
    : t("screenshots.video.pause");

  return (
    <main className="video-recording-controls" aria-busy={busy}>
      <div
        className="video-recording-controls__drag"
        data-tauri-drag-region
        role="status"
        aria-label={stateLabel}
        title={stateLabel}
      >
        <GripVertical size={14} aria-hidden="true" />
        <span className={`video-recording-controls__dot${status.paused ? " paused" : ""}`} />
      </div>
      <div className="video-recording-controls__actions">
        <button
          type="button"
          disabled={busy || !status.active}
          onClick={() => void togglePause()}
          aria-label={pauseLabel}
          title={pauseLabel}
        >
          {status.paused
            ? <Play size={14} fill="currentColor" aria-hidden="true" />
            : <Pause size={15} fill="currentColor" aria-hidden="true" />}
        </button>
        <button
          className="stop"
          type="button"
          disabled={busy || !status.active}
          onClick={() => void stop()}
          aria-label={t("screenshots.video.stop")}
          title={t("screenshots.video.stop")}
        >
          <Square size={12} fill="currentColor" aria-hidden="true" />
        </button>
      </div>
    </main>
  );
}
