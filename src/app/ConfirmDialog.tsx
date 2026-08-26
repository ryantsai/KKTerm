import { ConfirmSheet, type DialogIconName } from "./ui/dialog";

export function ConfirmDialog({
  autoFocusConfirm,
  cancelLabel,
  confirmIcon,
  confirmLabel,
  icon,
  message,
  onCancel,
  onConfirm,
  title,
  tone = "default",
}: {
  autoFocusConfirm?: boolean;
  cancelLabel?: string;
  /** Override the confirm-button glyph. Defaults to a trash icon for danger. */
  confirmIcon?: DialogIconName;
  confirmLabel: string;
  /** Override the tinted header glyph. Defaults to the tone glyph (info/trash). */
  icon?: DialogIconName;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  tone?: "default" | "danger";
}) {
  return (
    <ConfirmSheet
      autoFocusConfirm={autoFocusConfirm}
      tone={tone === "danger" ? "danger" : "info"}
      icon={icon}
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      confirmIcon={confirmIcon ?? (tone === "danger" ? "trash" : undefined)}
      cancelLabel={cancelLabel}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
