import { invokeCommand } from "../../lib/tauri";
import type { ConnectionNote } from "../../lib/tauri";

export type { ConnectionNote };

/** Read the note bound to a Connection, or `null` when it has none yet. */
export function getConnectionNote(connectionId: string) {
  return invokeCommand("get_connection_note", { connectionId });
}

/** Ids of every Connection that currently owns a note. */
export function listConnectionNoteIds() {
  return invokeCommand("list_connection_note_ids", undefined);
}

/** Create or update a Connection's note. Saving is what binds it. */
export function saveConnectionNote(connectionId: string, contentHtml: string) {
  return invokeCommand("save_connection_note", { connectionId, contentHtml });
}

/** Unbind and delete a Connection's note together with its images. */
export function deleteConnectionNote(connectionId: string) {
  return invokeCommand("delete_connection_note", { connectionId });
}

/** Store one embedded image and return the asset id the note HTML references. */
export function putNoteAsset(connectionId: string, mimeType: string, bytes: Uint8Array) {
  return invokeCommand("put_note_asset", {
    connectionId,
    mimeType,
    bytes: Array.from(bytes),
  });
}

/** Read one embedded image back for rendering. */
export function getNoteAsset(assetId: string) {
  return invokeCommand("get_note_asset", { assetId });
}

/** Drop images the saved HTML no longer references. */
export function pruneNoteAssets(connectionId: string, referencedIds: string[]) {
  return invokeCommand("prune_note_assets", { connectionId, referencedIds });
}
