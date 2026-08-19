import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import { Terminal } from "../../lib/reicon";

export interface NoteCodeBlockSendTarget {
  onSend: (text: string) => void;
}

/** Threaded through React portals (which carry Context same as any other
 *  React child) rather than editor extension options, since the note's
 *  Connection type resolves asynchronously after the editor — built once —
 *  already exists. `null` when the note's Connection isn't a terminal type,
 *  hiding the button entirely rather than showing an always-inert one. */
export const NoteCodeBlockSendContext = createContext<NoteCodeBlockSendTarget | null>(null);

/** A note code block with a button to send its text to the note's own
 *  Connection, when that Connection is a live terminal. */
export function NoteCodeBlockView({ node }: ReactNodeViewProps) {
  const { t } = useTranslation();
  const target = useContext(NoteCodeBlockSendContext);

  return (
    <NodeViewWrapper className="note-code-block-view">
      <pre>
        <NodeViewContent<"code"> as="code" spellCheck={false} />
      </pre>
      {target ? (
        <button
          aria-label={t("notes.editor.sendCodeToTerminal")}
          className="note-code-block-send"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => target.onSend(node.textContent)}
          title={t("notes.editor.sendCodeToTerminal")}
          type="button"
        >
          <Terminal size={13} />
        </button>
      ) : null}
    </NodeViewWrapper>
  );
}
