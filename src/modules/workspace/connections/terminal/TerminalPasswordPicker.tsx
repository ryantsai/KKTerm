import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { KeyRound, Search } from "../../../../lib/reicon";
import { technicalInputProps } from "../../../../lib/inputBehavior";
import { Actions } from "../../../../app/ui/dialog";
import { filterTerminalPasswordChoices, type TerminalPasswordChoice } from "./terminalPasswordChoices";

export function TerminalPasswordPicker({
  anchor,
  choices,
  currentConnectionId,
  busy,
  onClose,
  onSend,
}: {
  anchor: { x: number; y: number };
  choices: TerminalPasswordChoice[];
  currentConnectionId: string;
  busy: boolean;
  onClose: (restoreFocus?: boolean) => void;
  onSend: (connectionId: string) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(choices[0]?.id ?? "");
  const filtered = useMemo(() => filterTerminalPasswordChoices(choices, query), [choices, query]);
  const activeId = filtered.some((choice) => choice.id === selectedId)
    ? selectedId
    : filtered[0]?.id ?? "";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!busy && !ref.current?.contains(event.target as Node)) onClose(false);
    };
    const closeOnWindowChange = () => {
      if (!busy) onClose(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", closeOnWindowChange);
    window.addEventListener("blur", closeOnWindowChange);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", closeOnWindowChange);
      window.removeEventListener("blur", closeOnWindowChange);
    };
  }, [busy, onClose]);

  const width = 304;
  const left = Math.max(8, Math.min(anchor.x - 40, window.innerWidth - width - 8));
  const estimatedHeight = 274;
  const top = anchor.y + estimatedHeight + 8 <= window.innerHeight
    ? anchor.y + 8
    : Math.max(8, anchor.y - estimatedHeight - 8);

  return createPortal(
    <div
      aria-label={t("terminal.savedPasswordPickerTitle")}
      className="terminal-password-picker"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          if (!busy) onClose();
        } else if (event.key === "Enter" && event.target === inputRef.current && activeId && !busy) {
          event.preventDefault();
          onSend(activeId);
        } else if (filtered.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          const index = filtered.findIndex((choice) => choice.id === activeId);
          const next = (index + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length;
          setSelectedId(filtered[next]?.id ?? "");
        }
      }}
      onMouseDown={(event) => event.stopPropagation()}
      ref={ref}
      role="dialog"
      style={{ left, top }}
    >
      <div className="terminal-password-picker-heading">
        <KeyRound size={15} />
        <strong>{t("terminal.savedPasswordPickerTitle")}</strong>
      </div>
      <label className="terminal-password-picker-search">
        <Search size={14} />
        <input
          {...technicalInputProps}
          aria-label={t("terminal.searchSavedPasswords")}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("terminal.searchSavedPasswords")}
          ref={inputRef}
          value={query}
        />
      </label>
      <div className="terminal-password-picker-list" role="listbox">
        {filtered.length ? filtered.map((choice) => (
          <button
            aria-selected={choice.id === activeId}
            className={`terminal-password-picker-choice${choice.id === activeId ? " selected" : ""}`}
            key={choice.id}
            onClick={() => setSelectedId(choice.id)}
            role="option"
            type="button"
          >
            <span className="terminal-password-picker-radio" />
            <span className="terminal-password-picker-choice-text">
              <strong>{choice.name}</strong>
              <small>{choice.host}</small>
            </span>
            {choice.id === currentConnectionId ? (
              <span className="terminal-password-picker-current">{t("terminal.currentConnectionPassword")}</span>
            ) : null}
          </button>
        )) : <div className="terminal-password-picker-empty">{t("terminal.noTerminalPasswords")}</div>}
      </div>
      <div className="terminal-password-picker-actions">
        <Actions
          cancel={<button disabled={busy} onClick={() => onClose()} type="button">{t("common.cancel")}</button>}
          primary={
            <button className="terminal-password-picker-send" disabled={!activeId || busy} onClick={() => onSend(activeId)} type="button">
              {t("terminal.sendSavedPassword")}
            </button>
          }
        />
      </div>
    </div>,
    document.body,
  );
}
