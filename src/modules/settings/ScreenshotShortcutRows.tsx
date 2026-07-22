import { useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { X } from "../../lib/reicon";
import { useTranslation } from "react-i18next";
import { bindingFromKeyboardEvent, displayShortcutBinding } from "../workspace/keymap";
import { useScreenshotSettingsDraft } from "./screenshotSettingsDraft";

type ShortcutKey = "regionShortcut" | "windowShortcut" | "fullscreenShortcut";
type EnabledKey =
  | "regionShortcutEnabled"
  | "windowShortcutEnabled"
  | "fullscreenShortcutEnabled";

const SCREENSHOT_SHORTCUTS: ReadonlyArray<{
  labelKey: string;
  shortcutKey: ShortcutKey;
  enabledKey: EnabledKey;
}> = [
  {
    labelKey: "screenshots.captureRegion",
    shortcutKey: "regionShortcut",
    enabledKey: "regionShortcutEnabled",
  },
  {
    labelKey: "screenshots.captureWindow",
    shortcutKey: "windowShortcut",
    enabledKey: "windowShortcutEnabled",
  },
  {
    labelKey: "screenshots.captureFullscreen",
    shortcutKey: "fullscreenShortcut",
    enabledKey: "fullscreenShortcutEnabled",
  },
];

export function ScreenshotShortcutRows() {
  const { t } = useTranslation();
  const draft = useScreenshotSettingsDraft((state) => state.draft);
  const update = useScreenshotSettingsDraft((state) => state.update);
  const [recordingShortcut, setRecordingShortcut] = useState<ShortcutKey | null>(null);

  if (!draft) {
    return null;
  }

  function updateShortcut(
    shortcutKey: ShortcutKey,
    enabledKey: EnabledKey,
    value: string,
  ) {
    update({
      [shortcutKey]: value,
      [enabledKey]: value.trim().length > 0,
    });
  }

  function recordShortcut(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    shortcutKey: ShortcutKey,
    enabledKey: EnabledKey,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecordingShortcut(null);
      return;
    }
    const binding = bindingFromKeyboardEvent(event.nativeEvent);
    if (!binding) {
      return;
    }
    updateShortcut(shortcutKey, enabledKey, binding);
    setRecordingShortcut(null);
  }

  return SCREENSHOT_SHORTCUTS.map(({ labelKey, shortcutKey, enabledKey }) => {
    const label = t(labelKey);
    const value = draft[enabledKey] ? draft[shortcutKey] : "";
    const recording = recordingShortcut === shortcutKey;
    return (
      <div className="shortcut-row" key={shortcutKey}>
        <span className="shortcut-row-label">{label}</span>
        <span className="shortcut-row-controls screenshots-shortcut-controls">
          <button
            aria-label={label}
            className={`shortcut-binding-button${recording ? " recording" : ""}${value ? "" : " unbound"}`}
            onBlur={() => {
              if (recording) {
                setRecordingShortcut(null);
              }
            }}
            onClick={() => setRecordingShortcut(shortcutKey)}
            onKeyDown={(event) => {
              if (recording) {
                recordShortcut(event, shortcutKey, enabledKey);
              }
            }}
            type="button"
          >
            {recording
              ? t("settings.shortcutPressKeys")
              : (value ? displayShortcutBinding(value) : t("settings.shortcutNotSet"))}
          </button>
          {value ? (
            <button
              aria-label={t("settings.shortcutClear")}
              className="shortcut-icon-button"
              onClick={() => updateShortcut(shortcutKey, enabledKey, "")}
              title={t("settings.shortcutClear")}
              type="button"
            >
              <X size={13} />
            </button>
          ) : null}
        </span>
      </div>
    );
  });
}
