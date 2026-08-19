import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Btn, TextInput } from "../../app/ui/dialog";

export interface NoteLinkPopoverState {
  from: number;
  to: number;
  text: string;
  href: string;
  existing: boolean;
  position: { left: number; top: number };
}

export function NoteLinkPopover({
  state,
  onCancel,
  onApply,
  onRemove,
}: {
  state: NoteLinkPopoverState | null;
  onCancel: () => void;
  onApply: (text: string, href: string) => boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(state?.text ?? "");
  const [href, setHref] = useState(state?.href ?? "");
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText(state?.text ?? "");
    setHref(state?.href ?? "");
  }, [state]);

  useEffect(() => {
    if (!state) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !popoverRef.current?.contains(target)) {
        onCancel();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onCancel, state]);

  if (!state || typeof document === "undefined") return null;

  function apply() {
    if (onApply(text, href)) {
      onCancel();
    }
  }

  function remove() {
    onRemove();
    onCancel();
  }

  return createPortal(
    <div
      ref={popoverRef}
      className="note-link-popover"
      data-note-link-popover
      role="dialog"
      aria-label={t("notes.toolbar.insertLink")}
      style={{ left: state.position.left, top: state.position.top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <form
        className="note-link-popover-form"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <label className="note-link-popover-field">
          <span>{t("notes.linkPopover.textLabel")}</span>
          <TextInput
            value={text}
            aria-label={t("notes.linkPopover.textLabel")}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <label className="note-link-popover-field">
          <span>{t("notes.linkPopover.urlLabel")}</span>
          <TextInput
            autoFocus
            value={href}
            placeholder={t("notes.linkPopover.urlPlaceholder")}
            aria-label={t("notes.linkPopover.urlLabel")}
            onChange={(event) => setHref(event.target.value)}
          />
        </label>
        <div className="note-link-popover-actions">
          {state.existing ? (
            <Btn className="note-link-popover-remove" sm onClick={remove}>
              {t("common.remove")}
            </Btn>
          ) : null}
          <Btn sm onClick={onCancel}>
            {t("common.cancel")}
          </Btn>
          <Btn kind="primary" sm type="submit">
            {t("common.save")}
          </Btn>
        </div>
      </form>
    </div>,
    document.body,
  );
}
