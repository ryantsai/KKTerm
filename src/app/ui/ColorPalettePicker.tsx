import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { HexColorPicker } from "react-colorful";
import "./colorPalettePicker.css";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: string | null | undefined): value is `#${string}` {
  return typeof value === "string" && HEX_COLOR.test(value);
}

export function ColorPalettePicker({
  value,
  onChange,
  className = "",
  trigger = "rainbow",
  ariaLabel,
  onClear,
}: {
  value?: string | null;
  onChange: (color: `#${string}`) => void;
  className?: string;
  trigger?: "rainbow" | "swatch";
  ariaLabel?: string;
  onClear?: () => void;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>(isHexColor(value) ? value : "#0a84ff");
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (isHexColor(value)) setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || trigger !== "swatch") {
      setPopoverPosition(null);
      return;
    }
    const update = () => {
      const anchor = rootRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = popoverRef.current?.offsetWidth ?? 224;
      const height = popoverRef.current?.offsetHeight ?? 252;
      const edge = 12;
      const gap = 8;
      const left = Math.min(Math.max(edge, anchor.left), Math.max(edge, window.innerWidth - width - edge));
      const top = window.innerHeight - anchor.bottom >= height + gap
        ? anchor.bottom + gap
        : Math.max(edge, anchor.top - height - gap);
      setPopoverPosition({ left, top });
    };
    update();
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [open, trigger]);

  const selectColor = (next: string) => {
    const normalized = next.startsWith("#") ? next : `#${next}`;
    setDraft(normalized);
    if (isHexColor(normalized)) onChange(normalized.toLowerCase() as `#${string}`);
  };

  const popover = open ? (
    <div
      aria-label={ariaLabel ?? t("common.customColor")}
      className={`color-palette-popover${trigger === "swatch" ? " portaled" : ""}`}
      ref={popoverRef}
      role="dialog"
      style={trigger === "swatch" && popoverPosition ? popoverPosition : undefined}
      onClick={(event) => event.stopPropagation()}
    >
      <HexColorPicker color={isHexColor(draft) ? draft : "#0a84ff"} onChange={selectColor} />
      <label className="color-palette-hex-field">
        <span>{t("common.hexColor")}</span>
        <span className="color-palette-hex-input">
          <i style={{ background: isHexColor(draft) ? draft : "transparent" }} />
          <input
            aria-label={t("common.hexColor")}
            maxLength={7}
            onChange={(event) => selectColor(event.currentTarget.value)}
            spellCheck={false}
            value={draft}
          />
        </span>
      </label>
      {onClear ? (
        <button
          className="color-palette-clear"
          onClick={() => {
            onClear();
            setOpen(false);
          }}
          type="button"
        >
          {t("common.clear")}
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <div className={`color-palette-picker ${className}`.trim()} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel ?? t("common.customColor")}
        className={`color-palette-${trigger}${isHexColor(value) ? " selected" : " empty"}`}
        onClick={() => setOpen((current) => !current)}
        style={trigger === "swatch" && isHexColor(value) ? { "--color-palette-swatch": value } as CSSProperties : undefined}
        type="button"
      />
      {trigger === "swatch" && popover && typeof document !== "undefined"
        ? createPortal(popover, document.body)
        : popover}
    </div>
  );
}
