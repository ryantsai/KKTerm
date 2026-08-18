import DOMPurify from "dompurify";
import { getNoteAsset } from "./noteCommands";

/** Attribute carrying an out-of-line image's asset id. The `src` is filled in
 *  only at render time, so stored note HTML never embeds image bytes. */
export const NOTE_ASSET_ATTRIBUTE = "data-note-asset";

/** Attribute carrying a serialized Deep Link on a mention chip. */
export const NOTE_DEEP_LINK_ATTRIBUTE = "data-note-deep-link";

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "u", "s", "code", "pre", "blockquote",
  "h1", "h2", "h3", "h4", "ul", "ol", "li", "hr", "a", "img", "span", "mark",
  "table", "thead", "tbody", "tr", "th", "td", "div",
];

const ALLOWED_ATTR = [
  "href", "target", "rel", "title", "alt", "src", "width", "height",
  "colspan", "rowspan", "colwidth", "style", "class",
  "data-type", "data-checked",
  NOTE_ASSET_ATTRIBUTE,
  NOTE_DEEP_LINK_ATTRIBUTE,
  "data-note-label",
];

/** Sanitize note HTML. Notes are user-authored and local, but they also accept
 *  pasted web content, so everything entering the editor or the DB is cleaned.
 *  `data:` and `blob:` image sources stay allowed because hydrated images use
 *  them; scripts and event handlers never survive. */
export function sanitizeNoteHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input"],
    FORBID_ATTR: ["onerror", "onload", "onclick"],
  });
}

function parseNoteDocument(html: string): Document {
  return new DOMParser().parseFromString(
    `<div id="note-root">${html}</div>`,
    "text/html",
  );
}

function serializeNoteRoot(doc: Document): string {
  return doc.getElementById("note-root")?.innerHTML ?? "";
}

/** Every image asset id referenced by a note body. Backs post-save pruning of
 *  images the user added and then removed in the same editing pass. */
export function collectNoteAssetIds(html: string): string[] {
  const doc = parseNoteDocument(html);
  const ids = new Set<string>();
  doc.querySelectorAll(`img[${NOTE_ASSET_ATTRIBUTE}]`).forEach((image) => {
    const id = image.getAttribute(NOTE_ASSET_ATTRIBUTE);
    if (id) ids.add(id);
  });
  return [...ids];
}

/** Replace every asset-backed image's `src` with a live object URL so the
 *  editor can render it. Returns the object URLs so the caller can revoke them
 *  when the editor closes; a missing asset leaves the image without a source
 *  rather than failing the whole note. */
export async function hydrateNoteAssets(
  html: string,
): Promise<{ html: string; objectUrls: string[] }> {
  const doc = parseNoteDocument(html);
  const images = [...doc.querySelectorAll(`img[${NOTE_ASSET_ATTRIBUTE}]`)];
  const objectUrls: string[] = [];
  await Promise.all(
    images.map(async (image) => {
      const id = image.getAttribute(NOTE_ASSET_ATTRIBUTE);
      if (!id) return;
      const asset = await getNoteAsset(id).catch(() => null);
      if (!asset) {
        image.removeAttribute("src");
        return;
      }
      const blob = new Blob([new Uint8Array(asset.bytes) as BlobPart], { type: asset.mimeType });
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      image.setAttribute("src", url);
    }),
  );
  return { html: serializeNoteRoot(doc), objectUrls };
}

/** Strip the runtime `src` from asset-backed images so the persisted note keeps
 *  only the asset id. Images pasted from the web that were never stored as
 *  assets keep their original source. */
export function dehydrateNoteAssets(html: string): string {
  const doc = parseNoteDocument(html);
  doc.querySelectorAll(`img[${NOTE_ASSET_ATTRIBUTE}]`).forEach((image) => {
    image.removeAttribute("src");
  });
  return serializeNoteRoot(doc);
}

/** True when a note body carries nothing a user would call content. Tiptap
 *  represents an empty document as a single empty paragraph, which must not
 *  count as a note worth binding. */
export function isNoteHtmlEmpty(html: string): boolean {
  const doc = parseNoteDocument(html);
  const root = doc.getElementById("note-root");
  if (!root) return true;
  if (root.querySelector("img, hr, table")) return false;
  return root.textContent?.trim().length === 0;
}
