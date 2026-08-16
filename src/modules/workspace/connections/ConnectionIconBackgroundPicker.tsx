import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ariaPressed } from "../../../lib/aria";
import { ColorPalettePicker, isHexColor } from "../../../app/ui/ColorPalettePicker";

// Apple system hues, matching the connection-dialog redesign palette verbatim.
const CONNECTION_ICON_COLORS = [
  { name: "blue", color: "#0a84ff" },
  { name: "indigo", color: "#5e5ce6" },
  { name: "purple", color: "#bf5af2" },
  { name: "red", color: "#ff375f" },
  { name: "amber", color: "#ff9f0a" },
  { name: "green", color: "#34c759" },
  { name: "teal", color: "#30b0c7" },
  { name: "gray", color: "#8e8e93" },
  { name: "white", color: "#ffffff" },
  { name: "black", color: "#000000" },
];

type IconColorKind = "foreground" | "background";

export function ConnectionIconColorPicker({
  color,
  kind,
  onChange,
}: {
  color?: string | null;
  kind: IconColorKind;
  onChange: (color: string | null) => void;
}) {
  return (
    <ConnectionIconPalettePicker
      color={color}
      kind={kind}
      onChange={onChange}
    />
  );
}

export function ConnectionIconBackgroundPicker({
  color,
  onChange,
}: {
  color?: string | null;
  onChange: (color: string | null) => void;
}) {
  return (
    <ConnectionIconPalettePicker
      color={color}
      kind="background"
      onChange={onChange}
    />
  );
}

function ConnectionIconPalettePicker({
  color,
  kind,
  onChange,
}: {
  color?: string | null;
  kind: IconColorKind;
  onChange: (color: string | null) => void;
}) {
  const { t } = useTranslation();
  const currentColor = color ?? null;
  const isForeground = kind === "foreground";
  const isCustomColor = Boolean(
    currentColor
      && isHexColor(currentColor)
      && !CONNECTION_ICON_COLORS.some(
        (accent) => accent.color.toLowerCase() === currentColor.toLowerCase(),
      ),
  );

  return (
    <div
      className={`connection-swatches ${isForeground ? "foreground" : "background"}`}
      role="group"
      aria-label={t(isForeground ? "connections.iconForeground" : "connections.iconBackground")}
    >
      <button
        aria-label={t(
          isForeground
            ? "connections.defaultIconForeground"
            : "connections.transparentIconBackground",
        )}
        className={currentColor === null ? "connection-swatch none selected" : "connection-swatch none"}
        onClick={() => onChange(null)}
        type="button"
        {...ariaPressed(currentColor === null)}
      />
      {CONNECTION_ICON_COLORS.map((accent) => {
        const selected = currentColor?.toLowerCase() === accent.color.toLowerCase();
        return (
          <button
            aria-label={t(
              isForeground
                ? "connections.selectIconForeground"
                : "connections.selectIconBackground",
              { color: accent.name },
            )}
            className={selected ? "connection-swatch selected" : "connection-swatch"}
            key={accent.name}
            onClick={() => onChange(accent.color)}
            style={{ "--connection-swatch": accent.color } as CSSProperties}
            type="button"
            {...ariaPressed(selected)}
          />
        );
      })}
      <ColorPalettePicker
        className="connection-custom-color"
        onChange={onChange}
        value={isCustomColor ? currentColor : null}
      />
    </div>
  );
}
