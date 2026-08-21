import { useState } from "react";
import { HexColorPicker } from "react-colorful";
import { GradientPicker } from "react-linear-gradient-picker";
import "react-linear-gradient-picker/dist/index.css";
import { useTranslation } from "react-i18next";
import type { GradientColorStop } from "../types";

// The widget positions stops as a 0-1 fraction of its track width (matching
// its own README examples), while our stored offsets and the CSS we render
// elsewhere use 0-100 percent — convert only at this boundary.
interface WidgetPaletteStop {
  id?: number;
  color: string;
  offset: number;
}

function WrappedColorPicker({ color, onSelect }: { color?: string; onSelect: (color: string) => void }) {
  return <HexColorPicker color={color || "#6366f1"} onChange={onSelect} />;
}

let nextGradientStopId = 0;

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
  // Keeping the widget's own stop `id`s in local state (rather than handing
  // it a freshly id-less array derived from props on every render) is what
  // keeps a stop's drag identity stable across renders — without it the
  // marker being dragged loses track of itself and jitters/snaps back.
  const [palette, setPalette] = useState<WidgetPaletteStop[]>(() =>
    stops.map((stop) => ({ id: nextGradientStopId++, color: stop.color, offset: stop.offset / 100 })),
  );

  function handlePaletteChange(nextPalette: WidgetPaletteStop[]) {
    setPalette(nextPalette);
    onChange({
      stops: nextPalette.map((stop) => ({ color: stop.color, offset: stop.offset * 100 })),
      angle,
    });
  }

  return (
    <div className="dw-bg-gradient-builder">
      <GradientPicker
        palette={palette}
        onPaletteChange={handlePaletteChange}
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
