import { useEffect, useState } from "react";
import { ThinkingOrb, type OrbSize, type OrbTheme } from "thinking-orbs";

function currentOrbTheme(): OrbTheme {
  if (typeof document === "undefined") return "light";
  const surface = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
  const hex = surface.match(/^#([\da-f]{6})$/i)?.[1];
  if (!hex) return "auto";
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
  return luminance < 128 ? "dark" : "light";
}

export function SystemCleanerScanOrb({
  className,
  label,
  size,
}: {
  className?: string;
  label: string;
  size: OrbSize;
}) {
  const [theme, setTheme] = useState<OrbTheme>(() => currentOrbTheme());

  useEffect(() => {
    const root = document.documentElement;
    const updateTheme = () => setTheme(currentOrbTheme());
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-color-scheme"] });
    return () => observer.disconnect();
  }, []);

  return <ThinkingOrb aria-label={label} className={className} size={size} state="solving" theme={theme} />;
}
