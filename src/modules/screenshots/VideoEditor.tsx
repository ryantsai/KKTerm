import { convertFileSrc } from "@tauri-apps/api/core";
import { Timeline } from "@xzdarcy/react-timeline-editor";
import type { TimelineRow } from "@xzdarcy/timeline-engine";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css";
import { Actions, Btn, DialogShell, Sheet } from "../../app/ui/dialog";
import { invokeCommand, type CompletedVideoRecording } from "../../lib/tauri";

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
  const fallbackDuration = Math.max(0.1, recording.durationMs / 1000);
  const [duration, setDuration] = useState(fallbackDuration);
  const [range, setRange] = useState({ start: 0, end: fallbackDuration });
  const [previewUrl, setPreviewUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const isGif = recording.fileName.toLowerCase().endsWith(".gif");
  const timelineScale = Math.max(1, Math.ceil(duration / 10));
  const timelineScaleCount = Math.max(5, Math.ceil(duration / timelineScale) + 1);

  useEffect(() => {
    void invokeCommand("allow_video_preview", { path: recording.path })
      .then((path) => setPreviewUrl(convertFileSrc(path)))
      .catch(onError);
  }, [onError, recording.path]);

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
              onLoadedMetadata={(event) => {
                const next = event.currentTarget.duration;
                if (Number.isFinite(next) && next > 0) {
                  setDuration(next);
                  setRange({ start: 0, end: next });
                }
              }}
            />
          ) : null}
        </div>
        <div className="video-editor__range">
          <span>{timestamp(range.start)}</span>
          <strong>{recording.fileName}</strong>
          <span>{timestamp(range.end)}</span>
        </div>
        <div className="video-editor__timeline">
          <Timeline
            editorData={rows}
            effects={{ clip: { id: "clip" } }}
            scale={timelineScale}
            scaleWidth={80}
            minScaleCount={timelineScaleCount}
            maxScaleCount={timelineScaleCount}
            rowHeight={48}
            onClickTimeArea={(time) => {
              if (mediaRef.current) mediaRef.current.currentTime = Math.min(duration, Math.max(0, time));
              return true;
            }}
            onActionResizing={({ start, end, dir }) => {
              if (mediaRef.current) mediaRef.current.currentTime = dir === "left" ? start : end;
            }}
            onChange={(data) => {
              const action = data[0]?.actions[0];
              if (action) {
                setRange({ start: Math.max(0, action.start), end: Math.min(duration, action.end) });
                if (mediaRef.current) mediaRef.current.currentTime = Math.max(0, action.start);
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
