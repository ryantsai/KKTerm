// ConfirmSheet — the KKTerm confirmation-dialog template. One compact alert
// sheet with a tinted glyph, a single title, optional body, and a footer in
// host-platform button order. Covers the three reference presets:
//   tone="info"   informational / run-command confirmations
//   tone="danger" destructive deletes
//   tone="warn"   + extraLeft "Don't Save" → unsaved-changes
// Per AGENTS.md, the footer carries the dismiss action so there is no title-bar X.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Actions, Btn, DialogShell, Sheet, type ButtonKind } from "./Sheet";
import { DIcon, type DialogIconName } from "./icons";

export type ConfirmTone = "info" | "danger" | "warn";

const TONE_ICON: Record<ConfirmTone, DialogIconName> = {
  info: "info",
  danger: "trash",
  warn: "alert",
};

const TONE_BUTTON: Record<ConfirmTone, ButtonKind> = {
  info: "primary",
  danger: "danger",
  warn: "primary",
};

export function ConfirmSheet({
  tone = "info",
  icon,
  title,
  message,
  confirmLabel,
  confirmIcon,
  cancelLabel,
  extraLeft,
  width = 410,
  onConfirm,
  onCancel,
  ariaLabel,
  zClassName,
  autoFocusConfirm = false,
}: {
  tone?: ConfirmTone;
  icon?: DialogIconName;
  title: ReactNode;
  /** Body content. A string renders as a paragraph; pass a node for rich copy. */
  message?: ReactNode;
  confirmLabel: ReactNode;
  confirmIcon?: DialogIconName;
  cancelLabel?: ReactNode;
  /** Left-anchored extra action (e.g. a destructive "Don't Save"). */
  extraLeft?: ReactNode;
  width?: number;
  onConfirm: () => void;
  onCancel: () => void;
  ariaLabel?: string;
  /** Stacked-dialog escape (e.g. "kk-qc-subdialog") when opened above another dialog. */
  zClassName?: string;
  /** Move focus to the confirm action when this prompt is safe to accept with Enter. */
  autoFocusConfirm?: boolean;
}) {
  const { t } = useTranslation();
  const glyph = icon ?? TONE_ICON[tone];
  return (
    <DialogShell onBackdrop={onCancel} zClassName={zClassName}>
      <Sheet
        width={width}
        ariaLabel={ariaLabel ?? (typeof title === "string" ? title : undefined)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        footer={
          <Actions
            extraLeft={extraLeft}
            cancel={<Btn onClick={onCancel}>{cancelLabel ?? t("common.cancel")}</Btn>}
            primary={
              <Btn autoFocus={autoFocusConfirm} kind={TONE_BUTTON[tone]} icon={confirmIcon} onClick={onConfirm}>
                {confirmLabel}
              </Btn>
            }
          />
        }
      >
        <div className="kk-confirm-body">
          <span className={`kk-confirm-ico ${tone}`}>
            <DIcon name={glyph} size={tone === "danger" ? 23 : 24} />
          </span>
          <div className="kk-ct">
            <h2>{title}</h2>
            {typeof message === "string" ? <p>{message}</p> : message}
          </div>
        </div>
      </Sheet>
    </DialogShell>
  );
}
