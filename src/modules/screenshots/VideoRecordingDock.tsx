import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { Pause, Play, Square } from "../../lib/reicon";
import { isMacPlatform } from "../../lib/platform";
import {
  VIDEO_RECORDING_COMPLETED_EVENT,
  VIDEO_RECORDING_STARTED_EVENT,
  invokeCommand,
  isTauriRuntime,
  type VideoRecordingStatus,
} from "../../lib/tauri";
import "./videoRecordingDock.css";

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

export function VideoRecordingDock() {
  const { t } = useTranslation();
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isMacPlatform() || !isTauriRuntime()) return;
    let mounted = true;
    let interval: number | undefined;

    const refresh = () => {
      void invokeCommand("video_recording_status", undefined)
        .then((next) => {
          if (mounted) setStatus(next);
        })
        .catch(() => {
          // The next poll tick retries; a failed background read must not
          // surface an unhandled rejection while recording continues.
        });
    };
    const startPolling = () => {
      if (interval !== undefined) return;
      refresh();
      interval = window.setInterval(refresh, 250);
    };
    const stopPolling = () => {
      if (interval === undefined) return;
      window.clearInterval(interval);
      interval = undefined;
    };

    const unlistenStarted = listen(VIDEO_RECORDING_STARTED_EVENT, startPolling);
    const unlistenCompleted = listen(VIDEO_RECORDING_COMPLETED_EVENT, () => {
      stopPolling();
      setStatus(EMPTY_STATUS);
    });

    void invokeCommand("video_recording_status", undefined)
      .then((next) => {
        if (!mounted) return;
        setStatus(next);
        if (next.active) startPolling();
      })
      .catch(() => {
        // Nothing to recover on the one-shot mount check.
      });

    return () => {
      mounted = false;
      stopPolling();
      void unlistenStarted.then((dispose) => dispose());
      void unlistenCompleted.then((dispose) => dispose());
    };
  }, []);

  if (!status.active) return null;

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
    <div className="video-recording-dock" role="status" aria-label={stateLabel} aria-busy={busy}>
      <span
        className={`video-recording-dock__dot${status.paused ? " paused" : ""}`}
        aria-hidden="true"
      />
      <div className="video-recording-dock__actions">
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
    </div>
  );
}
