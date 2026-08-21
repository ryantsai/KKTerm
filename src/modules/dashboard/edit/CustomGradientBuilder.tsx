import { HexColorPicker } from "react-colorful";
import { GradientPicker } from "react-linear-gradient-picker";
import "react-linear-gradient-picker/dist/index.css";
import { useTranslation } from "react-i18next";
import type { GradientColorStop } from "../types";

function WrappedColorPicker({ color, onSelect }: { color?: string; onSelect: (color: string) => void }) {
  return <HexColorPicker color={color || "#6366f1"} onChange={onSelect} />;
}

export function CustomGradientBuilder({
  stops,
  angle,
  onChange,
}: {
  stops: GradientColorStop[];
  angle: number;
  onChange: (next: { stops: GradientColorStop[]; angle: number }) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="dw-bg-gradient-builder">
      <GradientPicker
        palette={stops}
        onPaletteChange={(nextPalette) => {
          onChange({
            stops: nextPalette.map((stop) => ({ color: stop.color, offset: stop.offset })),
            angle,
          });
        }}
        width={272}
        paletteHeight={26}
        colorPickerMode="static"
        minStops={2}
        maxStops={6}
      >
        <WrappedColorPicker onSelect={() => {}} />
      </GradientPicker>
      <label className="dw-bg-gradient-angle">
        <span>{t("dashboard.backgroundGradientAngle")}</span>
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={angle}
          onChange={(event) => onChange({ stops, angle: Number(event.target.value) })}
        />
        <span className="dw-bg-gradient-angle-value">{angle}°</span>
      </label>
    </div>
  );
}
