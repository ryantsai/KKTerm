import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Actions, Btn, DialogShell, Sheet } from "../../app/ui/dialog";
import { currentPlatform, supportsInstallerHelper } from "../../lib/platform";
import { invokeCommand } from "../../lib/tauri";
import { installRecipeAndWait } from "../installer/progress";

export function VideoDependencyDialog({ onClose, onReady }: { onClose: () => void; onReady: () => void }) {
  const { t } = useTranslation();
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const canInstall = supportsInstallerHelper();
  const platform = currentPlatform();
  const hint = platform === "macos"
    ? "brew install ffmpeg"
    : platform === "linux"
      ? "sudo apt install ffmpeg  ·  sudo dnf install ffmpeg  ·  sudo pacman -S ffmpeg"
      : "ffmpeg";

  async function recheck() {
    setError("");
    const status = await invokeCommand("video_dependency_status", undefined);
    if (status.available) {
      onReady();
    } else {
      setError(t("screenshots.video.ffmpegStillMissing"));
    }
  }

  async function install() {
    setInstalling(true);
    setError("");
    try {
      await invokeCommand("installer_load_catalog", {});
      const result = await installRecipeAndWait("ffmpeg");
      if (result.kind === "completed") {
        await recheck();
      } else if (result.kind === "failed") {
        setError(result.message);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setInstalling(false);
    }
  }

  return (
    <DialogShell>
      <Sheet
        width={500}
        title={t("screenshots.video.ffmpegNeededTitle")}
        footer={(
          <Actions
            cancel={<Btn disabled={installing} onClick={onClose}>{t("common.cancel")}</Btn>}
            primary={canInstall ? (
              <Btn kind="primary" disabled={installing} onClick={() => void install()}>
                {installing ? t("screenshots.video.installingFfmpeg") : t("screenshots.video.installFfmpeg")}
              </Btn>
            ) : (
              <Btn kind="primary" onClick={() => void recheck()}>{t("screenshots.video.recheckFfmpeg")}</Btn>
            )}
          />
        )}
      >
        <p className="video-dependency-copy">{t("screenshots.video.ffmpegNeededBody")}</p>
        {!canInstall ? (
          <div className="video-dependency-command">
            <span>{t("screenshots.video.installHint")}</span>
            <code>{hint}</code>
          </div>
        ) : null}
        {error ? <p className="video-dependency-error" role="status">{error}</p> : null}
      </Sheet>
    </DialogShell>
  );
}
