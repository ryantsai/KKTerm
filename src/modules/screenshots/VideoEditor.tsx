import { convertFileSrc } from "@tauri-apps/api/core";
import { Timeline, type TimelineState } from "@xzdarcy/react-timeline-editor";
import type { TimelineRow } from "@xzdarcy/timeline-engine";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css";
import { Actions, Btn, DialogShell, Sheet } from "../../app/ui/dialog";
import { Play } from "../../lib/reicon";
import { invokeCommand, type CompletedVideoRecording } from "../../lib/tauri";
import { videoRulerLabel, videoTimelineLayout } from "./videoTimelineModel";

function timestamp(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${(safe % 60).toFixed(1).padStart(4, "0")}`;
}

export function VideoEditor({ recording, onClose, onSaved, onError }: {
  recording: CompletedVideoRecording;
  onClose: () => void;
  onSaved: (path: string) => void;
  onError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const mediaRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<TimelineState>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const fallbackDuration = Math.max(0.1, recording.durationMs / 1000);
  const [duration, setDuration] = useState(fallbackDuration);
  const [range, setRange] = useState({ start: 0, end: fallbackDuration });
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [timelineWidth, setTimelineWidth] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const isGif = recording.fileName.toLowerCase().endsWith(".gif");
  const timelineLayout = useMemo(
    () => videoTimelineLayout(duration, timelineWidth),
    [duration, timelineWidth],
  );

  useEffect(() => {
    void invokeCommand("allow_video_preview", { path: recording.path })
      .then((path) => setPreviewUrl(convertFileSrc(path)))
      .catch(onError);
  }, [onError, recording.path]);

  useEffect(() => {
    const target = timelineContainerRef.current;
    if (!target) return;
    const updateWidth = () => setTimelineWidth(target.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || isGif) return;
    let frame = 0;
    const update = () => {
      const media = mediaRef.current;
      if (!media || media.paused) return;
      if (media.currentTime >= range.end) {
        media.pause();
        media.currentTime = range.end;
        setCurrentTime(range.end);
        timelineRef.current?.setTime(range.end);
        return;
      }
      setCurrentTime(media.currentTime);
      timelineRef.current?.setTime(media.currentTime);
      frame = window.requestAnimationFrame(update);
    };
    frame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frame);
  }, [isGif, playing, range.end]);

  function seek(time: number) {
    const next = Math.min(duration, Math.max(0, time));
    if (mediaRef.current) mediaRef.current.currentTime = next;
    setCurrentTime(next);
    timelineRef.current?.setTime(next);
  }

  async function togglePlayback() {
    const media = mediaRef.current;
    if (!media) return;
    if (!media.paused) {
      media.pause();
      return;
    }
    if (media.currentTime < range.start || media.currentTime >= range.end - 0.01) {
      seek(range.start);
    }
    try {
      await media.play();
    } catch (error) {
      onError(error);
    }
  }

  const rows = useMemo<TimelineRow[]>(() => [{
    id: "recording",
    actions: [{
      id: "clip",
      effectId: "clip",
      start: range.start,
      end: range.end,
      flexible: true,
      movable: false,
      minStart: 0,
      maxEnd: duration,
    }],
  }], [duration, range.end, range.start]);

  async function saveTrimmedCopy() {
    setSaving(true);
    try {
      const path = await invokeCommand("trim_video_recording", {
        request: { sourcePath: recording.path, startSeconds: range.start, endSeconds: range.end },
      });
      onSaved(path);
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell>
      <Sheet
        width={820}
        height={620}
        className="video-editor"
        title={t("screenshots.video.editorTitle")}
        footer={(
          <Actions
            cancel={<Btn disabled={saving} onClick={onClose}>{t("common.close")}</Btn>}
            primary={<Btn kind="primary" disabled={saving} onClick={() => void saveTrimmedCopy()}>{saving ? t("screenshots.video.exporting") : t("screenshots.video.exportTrimmed")}</Btn>}
          />
        )}
      >
        <div className="video-editor__preview">
          {previewUrl ? isGif ? (
            <img src={previewUrl} alt={t("screenshots.video.previewAlt")} />
          ) : (
            <video
              ref={mediaRef}
              src={previewUrl}
              controls
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(event) => {
                if (!playing) {
                  setCurrentTime(event.currentTarget.currentTime);
                  timelineRef.current?.setTime(event.currentTarget.currentTime);
                }
              }}
              onLoadedMetadata={(event) => {
                const next = event.currentTarget.duration;
                if (Number.isFinite(next) && next > 0) {
                  setDuration(next);
                  setRange({ start: 0, end: next });
                  setCurrentTime(0);
                  timelineRef.current?.setTime(0);
                }
              }}
            />
          ) : null}
        </div>
        <div className="video-editor__transport">
          {!isGif ? (
            <div className="video-editor__transport-buttons">
              <button
                type="button"
                onClick={() => seek(currentTime - 5)}
                aria-label={t("screenshots.video.backFiveSeconds")}
                title={t("screenshots.video.backFiveSeconds")}
              >
                −5
              </button>
              <button
                type="button"
                className="video-editor__play"
                onClick={() => void togglePlayback()}
                aria-label={playing ? t("screenshots.video.pausePreview") : t("screenshots.video.playPreview")}
              >
                {playing ? <span aria-hidden="true">Ⅱ</span> : <Play size={13} fill="currentColor" aria-hidden="true" />}
                {playing ? t("screenshots.video.pausePreview") : t("screenshots.video.playPreview")}
              </button>
              <button
                type="button"
                onClick={() => seek(currentTime + 5)}
                aria-label={t("screenshots.video.forwardFiveSeconds")}
                title={t("screenshots.video.forwardFiveSeconds")}
              >
                +5
              </button>
            </div>
          ) : <span />}
          <strong>{recording.fileName}</strong>
          <span className="video-editor__time">{timestamp(currentTime)} / {timestamp(duration)}</span>
        </div>
        <div className="video-editor__range" aria-hidden="true">
          <span>{timestamp(range.start)}</span>
          <span />
          <span>{timestamp(range.end)}</span>
        </div>
        <div ref={timelineContainerRef} className="video-editor__timeline">
          <Timeline
            ref={timelineRef}
            editorData={rows}
            effects={{ clip: { id: "clip" } }}
            scale={timelineLayout.scale}
            scaleWidth={timelineLayout.scaleWidth}
            scaleSplitCount={5}
            startLeft={timelineLayout.startLeft}
            minScaleCount={timelineLayout.scaleCount}
            maxScaleCount={timelineLayout.scaleCount}
            rowHeight={48}
            getScaleRender={videoRulerLabel}
            onClickTimeArea={(time) => {
              seek(time);
              return true;
            }}
            onActionResizeStart={() => mediaRef.current?.pause()}
            onActionResizing={({ start, end, dir }) => {
              seek(dir === "left" ? start : end);
            }}
            onChange={(data) => {
              const action = data[0]?.actions[0];
              if (action) {
                setRange({ start: Math.max(0, action.start), end: Math.min(duration, action.end) });
                seek(Math.max(0, action.start));
              }
            }}
            getActionRender={() => <span className="video-editor__clip">{t("screenshots.video.clip")}</span>}
          />
        </div>
        <p className="video-editor__hint">{t("screenshots.video.trimHint")}</p>
      </Sheet>
    </DialogShell>
  );
}
