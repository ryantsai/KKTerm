// Install Helper confirm dialog. Built on the shared ConfirmSheet template so
// it matches the app's confirmation-dialog design language (tinted glyph, single
// title, platform-ordered footer). Unlike the generic ConfirmDialog it accepts a
// structured `items` list to render bullet-list bodies for prerequisite plans and
// dependent warnings — those flows are unreadable as a single string.

import { useTranslation } from "react-i18next";
import { ConfirmSheet } from "../../app/ui/dialog";

export interface InstallerConfirmDialogProps {
  title: string;
  body?: string;
  items?: string[];
  footer?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger" | "warn";
  /** Stacked-dialog escape (e.g. "kk-qc-subdialog") when opened above another dialog. */
  zClassName?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function InstallerConfirmDialog({
  title,
  body,
  items,
  footer,
  confirmLabel,
  cancelLabel,
  tone = "default",
  zClassName,
  onConfirm,
  onCancel,
}: InstallerConfirmDialogProps) {
  const { t } = useTranslation();
  const message = (
    <>
      {body ? <p>{body}</p> : null}
      {items && items.length > 0 ? (
        <ul className="installer-confirm-items">
          {items.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      ) : null}
      {footer ? <p className="installer-confirm-footer">{footer}</p> : null}
    </>
  );

  return (
    <ConfirmSheet
      ariaLabel={title}
      tone={tone === "danger" ? "danger" : tone === "warn" ? "warn" : "info"}
      icon={tone === "danger" ? "trash" : tone === "warn" ? "alert" : "download"}
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      confirmIcon={tone === "danger" ? "trash" : tone === "default" ? "download" : undefined}
      cancelLabel={cancelLabel ?? t("common.cancel")}
      width={460}
      zClassName={zClassName}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
