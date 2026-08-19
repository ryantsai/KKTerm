import { Mark } from "@tiptap/core";

/** Attribute that identifies a text range as visually masked. */
export const NOTE_MASK_ATTRIBUTE = "data-note-mask";

/** Runtime identity used to keep one mask revealed across editor transactions. */
export const NOTE_MASK_ID_ATTRIBUTE = "data-note-mask-id";

/** DOM-only state; it is never rendered by the mark or persisted to the note. */
export const NOTE_MASK_REVEALED_ATTRIBUTE = "data-note-mask-revealed";

let noteMaskSequence = 0;

/** Runtime-only identity for a mask mark. The saved HTML strips this value. */
export function createNoteMaskId() {
  noteMaskSequence += 1;
  return `note-mask-${noteMaskSequence}`;
}

/** Tiptap mark for text that should be hidden until the user reveals it. */
export const NoteMask = Mark.create({
  name: "noteMask",
  inclusive: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute(NOTE_MASK_ID_ATTRIBUTE) ?? createNoteMaskId(),
        renderHTML: (attributes: { id?: string | null }) => ({
          [NOTE_MASK_ID_ATTRIBUTE]: attributes.id ?? createNoteMaskId(),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[${NOTE_MASK_ATTRIBUTE}="true"]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      { ...HTMLAttributes, [NOTE_MASK_ATTRIBUTE]: "true" },
      0,
    ];
  },
});
