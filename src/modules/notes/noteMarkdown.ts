import TurndownService from "turndown";
import { NOTE_ASSET_ATTRIBUTE } from "./noteHtml";

/** Directory, relative to the app data directory, that holds note images. An
 *  exported note keeps this path as the image's reference instead of copying
 *  or inlining the bytes, so a reader can still find the original file. */
const NOTE_IMAGE_DIRECTORY = "note-images";

/** Build the serializer used for note export. Notes carry a few structures
 *  Turndown does not model on its own — GFM tables, Tiptap checklists, and
 *  out-of-line images — so each gets an explicit rule. */
function createNoteMarkdownSerializer() {
  const serializer = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    headingStyle: "atx",
    hr: "---",
  });

  // Images are stored as files beside the database and are deliberately not
  // exported. The Markdown keeps a reference to the asset's on-disk path so
  // the image is still identifiable from the exported file alone.
  serializer.addRule("noteImage", {
    filter: "img",
    replacement: (_content, node) => {
      const assetId = (node as HTMLElement).getAttribute(NOTE_ASSET_ATTRIBUTE);
      if (!assetId) return "";
      const alt = (node as HTMLElement).getAttribute("alt")?.trim();
      return `![${alt || assetId.split("/").pop()}](${NOTE_IMAGE_DIRECTORY}/${assetId})`;
    },
  });

  // Tiptap checklist items keep their state in `data-checked`; the generic
  // list-item rule would drop it and export every item as a plain bullet.
  serializer.addRule("noteTaskItem", {
    filter: (node) =>
      node.nodeName === "LI" && (node as HTMLElement).getAttribute("data-type") === "taskItem",
    replacement: (content, node) => {
      const body = content
        .replace(/^\n+/, "")
        .replace(/\n+$/, "")
        // Continuation lines align under the checkbox, so a multi-paragraph
        // item stays part of that item rather than closing the list.
        .replace(/\n/gm, "\n      ");
      const checked = (node as HTMLElement).getAttribute("data-checked") === "true";
      return `- [${checked ? "x" : " "}] ${body}${node.nextSibling ? "\n" : ""}`;
    },
  });

  // GFM strikethrough. Turndown's core rules cover bold, italic, links, and
  // code, but not the `s` element the note toolbar produces.
  serializer.addRule("noteStrikethrough", {
    filter: ["del", "s"],
    replacement: (content) => (content.trim() ? `~~${content}~~` : content),
  });

  // Turndown has no table support, so a note's tables would otherwise collapse
  // into one run-on line. Mirrors the Dashboard Notes widget's GFM output.
  serializer.addRule("noteTable", {
    filter: "table",
    replacement: (_content, node) => {
      const rows = Array.from((node as HTMLTableElement).rows);
      if (rows.length === 0) return "";
      const columnCount = Math.max(...rows.map((row) => row.cells.length), 1);
      const serializeCell = (cell: HTMLTableCellElement | undefined) =>
        (cell
          ? serializer
              .turndown(cell.innerHTML)
              .replace(/\|/g, "\\|")
              .replace(/\r?\n+/g, "<br>")
              .trim()
          : "") || " ";
      const serializeRow = (row: HTMLTableRowElement | undefined) =>
        `| ${Array.from({ length: columnCount }, (_, index) =>
          serializeCell(row?.cells[index]),
        ).join(" | ")} |`;
      return [
        "\n\n",
        [
          serializeRow(rows[0]),
          `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`,
          ...rows.slice(1).map(serializeRow),
        ].join("\n"),
        "\n\n",
      ].join("");
    },
  });

  return serializer;
}

const noteMarkdownSerializer = createNoteMarkdownSerializer();

/** Convert a saved note body to Markdown. The input is the same sanitized,
 *  dehydrated HTML the note is stored as, so images arrive as asset ids and
 *  Deep Link chips as their captured labels. */
export function noteHtmlToMarkdown(html: string): string {
  return `${noteMarkdownSerializer.turndown(html).trim()}\n`;
}

/** A Connection name is free text, so it cannot be handed to a file picker as
 *  a default file name unchanged. Keeps the name recognizable while dropping
 *  the characters Windows, macOS, and Linux reject in a path segment. */
export function noteMarkdownFilename(connectionName: string): string {
  const base = connectionName
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "")
    .slice(0, 80)
    .trim();
  return `${base || "note"}.md`;
}
