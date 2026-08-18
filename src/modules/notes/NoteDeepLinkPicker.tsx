import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Actions, Btn, DialogShell, Sheet, TextInput } from "../../app/ui/dialog";
import { filterNoteDeepLinkChoices, useNoteDeepLinkChoices } from "./noteDeepLinkChoices";
import type { NoteDeepLink } from "./noteDeepLink";

/** Toolbar route to a note Deep Link. The `@` trigger menu is the fast path;
 *  this dialog is the discoverable one, and both read the same choice source. */
export function NoteDeepLinkPicker({
  onCancel,
  onPick,
}: {
  onCancel: () => void;
  onPick: (link: NoteDeepLink, label: string) => void;
}) {
  const { t } = useTranslation();
  const choices = useNoteDeepLinkChoices();
  const [query, setQuery] = useState("");
  const results = useMemo(
    () => filterNoteDeepLinkChoices(choices, query),
    [choices, query],
  );

  return (
    <DialogShell onBackdrop={onCancel} zClassName="kk-qc-subdialog">
      <Sheet
        width={460}
        title={t("notes.deepLink.title")}
        footer={<Actions cancel={<Btn onClick={onCancel}>{t("common.cancel")}</Btn>} />}
      >
        <TextInput
          autoFocus
          value={query}
          placeholder={t("notes.deepLink.searchPlaceholder")}
          aria-label={t("notes.deepLink.searchPlaceholder")}
          onChange={(event) => setQuery(event.target.value)}
        />
        <p className="note-deep-link-hint">{t("notes.deepLink.triggerHint")}</p>
        <ul className="note-deep-link-list">
          {results.length === 0 ? (
            <li className="note-deep-link-empty">{t("notes.deepLink.noResults")}</li>
          ) : (
            results.map((choice) => (
              <li key={choice.key}>
                <button
                  className="note-deep-link-option"
                  onClick={() => onPick(choice.link, choice.label)}
                  type="button"
                >
                  <span className="note-deep-link-option-label">{choice.label}</span>
                  <span className="note-deep-link-option-detail">{choice.detail}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </Sheet>
    </DialogShell>
  );
}
