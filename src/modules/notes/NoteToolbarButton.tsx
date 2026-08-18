import { useTranslation } from "react-i18next";
import { FileText } from "../../lib/reicon";
import { useConnectionHasNote } from "./noteBindings";

/** The post-it affordance shown in every Connection pane toolbar. It renders in
 *  a distinct "bound" state when the Connection already owns a note, so an
 *  operator can see a Connection is documented without opening it. */
export function NoteToolbarButton({
  connectionId,
  className = "terminal-pane-action",
  onOpen,
}: {
  connectionId: string;
  className?: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const hasNote = useConnectionHasNote(connectionId);

  return (
    <button
      className={`${className} note-toolbar-button${hasNote ? " has-note" : ""}`}
      aria-label={hasNote ? t("notes.toolbarButton.open") : t("notes.toolbarButton.create")}
      data-tutorial-id="notes.openNote"
      onClick={onOpen}
      title={hasNote ? t("notes.toolbarButton.open") : t("notes.toolbarButton.create")}
      type="button"
    >
      <FileText size={13} />
    </button>
  );
}
