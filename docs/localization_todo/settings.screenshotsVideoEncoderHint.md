# settings.screenshotsVideoEncoderHint

- **English value**: `GPU encoding uses less CPU but depends on your graphics driver. If recordings flicker, choose CPU. This affects MP4 encoding only.`
- **Namespace**: `settings`
- **File/component**: `src/modules/settings/ScreenshotsSettings.tsx`
- **UI role**: tooltip
- **User flow**: Settings → Screenshots → Recording, choosing MP4 encoding before starting a recording.
- **Tone**: concise, neutral
- **Placeholders**: none
- **Context/meaning**: Recording means screen video capture. CPU/GPU selects software/hardware MP4 encoding, not the capture acquisition engine. GPU is the default; CPU is available if recordings flicker. GPU can be retried after graphics driver updates.
- **Domain notes**: Keep CPU, GPU and MP4 as technical abbreviations. Preserve Taiwan terminology in zh-TW. Best-effort translations are present; keep this record pending intentional localization review.
