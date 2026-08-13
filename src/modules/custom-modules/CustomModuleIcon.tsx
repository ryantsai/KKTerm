import { Package } from "../../lib/reicon";
import "./customModules.css";

export function CustomModuleIcon({
  iconDataUrl,
  size = 18,
}: {
  iconDataUrl?: string | null;
  size?: number;
}) {
  if (!iconDataUrl) return <Package size={size} />;
  const maskImage = `url("${iconDataUrl}")`;
  return (
    <span
      aria-hidden="true"
      className="custom-module-artwork"
      style={{
        WebkitMaskImage: maskImage,
        height: size,
        maskImage,
        width: size,
      }}
    />
  );
}
