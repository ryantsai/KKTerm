import { useTranslation } from "react-i18next";
import { useDashboardAnimationActive } from "../view/animationGating";
import clearwaterPageUrl from "./clearwater/clearwater.html?url";

export function ClearwaterBg() {
  const { t } = useTranslation();
  const active = useDashboardAnimationActive();

  if (!active) {
    return (
      <div
        className="dw-dynamic-bg-canvas"
        aria-hidden="true"
        style={{ background: "#0d2a2a" }}
      />
    );
  }

  return (
    <iframe
      className="dw-dynamic-bg-canvas"
      title={t("dashboard.dynamicBackgrounds.clearwater")}
      src={clearwaterPageUrl}
      sandbox="allow-scripts"
      aria-hidden="true"
      tabIndex={-1}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        border: 0,
        pointerEvents: "none",
        background: "#0d2a2a",
      }}
    />
  );
}
