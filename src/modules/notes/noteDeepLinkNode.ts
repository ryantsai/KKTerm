import { Node, mergeAttributes } from "@tiptap/core";
import { NOTE_DEEP_LINK_ATTRIBUTE } from "./noteHtml";
import type { NoteDeepLink } from "./noteDeepLink";
import { serializeNoteDeepLink } from "./noteDeepLink";

/** An inline, atomic chip standing for another KKTerm app element. The chip
 *  stores its target as one serialized attribute plus the label captured when
 *  it was inserted, so a note still reads sensibly after the target is renamed
 *  or deleted. */
export const NoteDeepLinkNode = Node.create({
  name: "noteDeepLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      target: {
        default: null,
        parseHTML: (element) => element.getAttribute(NOTE_DEEP_LINK_ATTRIBUTE),
        renderHTML: (attributes) =>
          attributes.target ? { [NOTE_DEEP_LINK_ATTRIBUTE]: attributes.target } : {},
      },
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-note-label") ?? element.textContent,
        renderHTML: (attributes) =>
          attributes.label ? { "data-note-label": attributes.label } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[${NOTE_DEEP_LINK_ATTRIBUTE}]` }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "note-deep-link" }),
      node.attrs.label || "",
    ];
  },

  renderText({ node }) {
    return node.attrs.label || "";
  },
});

/** Build the attributes for a Deep Link chip. */
export function noteDeepLinkAttributes(link: NoteDeepLink, label: string) {
  return { target: serializeNoteDeepLink(link), label };
}
