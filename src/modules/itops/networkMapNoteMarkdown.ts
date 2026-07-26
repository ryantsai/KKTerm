export type NetworkMapNoteFormatAction =
  | "heading1"
  | "heading2"
  | "bold"
  | "italic"
  | "bulletedList"
  | "numberedList"
  | "quote"
  | "inlineCode"
  | "link";

export type NetworkMapNoteFormatResult = {
  text: string;
  selectionStart: number;
  selectionEnd: number;
};

function wrapSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  open: string,
  close = open,
): NetworkMapNoteFormatResult {
  const selected = text.slice(selectionStart, selectionEnd);
  const alreadyWrapped =
    selectionStart >= open.length &&
    text.slice(selectionStart - open.length, selectionStart) === open &&
    text.slice(selectionEnd, selectionEnd + close.length) === close;

  if (alreadyWrapped) {
    return {
      text:
        text.slice(0, selectionStart - open.length) +
        selected +
        text.slice(selectionEnd + close.length),
      selectionStart: selectionStart - open.length,
      selectionEnd: selectionEnd - open.length,
    };
  }

  const formatted = `${open}${selected}${close}`;
  const nextText =
    text.slice(0, selectionStart) + formatted + text.slice(selectionEnd);
  const contentStart = selectionStart + open.length;
  return {
    text: nextText,
    selectionStart: contentStart,
    selectionEnd: selected ? contentStart + selected.length : contentStart,
  };
}

function prefixSelectedLines(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  prefixForLine: (index: number) => string,
  prefixPattern: RegExp,
): NetworkMapNoteFormatResult {
  const lineStart = text.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
  const effectiveEnd =
    selectionEnd > selectionStart && text[selectionEnd - 1] === "\n"
      ? selectionEnd - 1
      : selectionEnd;
  const nextLineBreak = text.indexOf("\n", effectiveEnd);
  const lineEnd = nextLineBreak < 0 ? text.length : nextLineBreak;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const contentLines = lines.filter((line) => line.length > 0);
  const shouldRemove =
    contentLines.length > 0 && contentLines.every((line) => prefixPattern.test(line));
  const formatted = lines
    .map((line, index) => {
      if (!line) return line;
      return shouldRemove ? line.replace(prefixPattern, "") : `${prefixForLine(index)}${line}`;
    })
    .join("\n");

  return {
    text: text.slice(0, lineStart) + formatted + text.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + formatted.length,
  };
}

export function formatNetworkMapNoteMarkdown(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  action: NetworkMapNoteFormatAction,
): NetworkMapNoteFormatResult {
  const start = Math.max(0, Math.min(text.length, selectionStart));
  const end = Math.max(start, Math.min(text.length, selectionEnd));

  switch (action) {
    case "heading1":
      return prefixSelectedLines(text, start, end, () => "# ", /^# /);
    case "heading2":
      return prefixSelectedLines(text, start, end, () => "## ", /^## /);
    case "bulletedList":
      return prefixSelectedLines(text, start, end, () => "- ", /^[-*+] /);
    case "numberedList":
      return prefixSelectedLines(text, start, end, (index) => `${index + 1}. `, /^\d+\. /);
    case "quote":
      return prefixSelectedLines(text, start, end, () => "> ", /^> /);
    case "bold":
      return wrapSelection(text, start, end, "**");
    case "italic":
      return wrapSelection(text, start, end, "_");
    case "inlineCode":
      return wrapSelection(text, start, end, "`");
    case "link": {
      const selected = text.slice(start, end);
      const formatted = `[${selected}]()`;
      const nextText = text.slice(0, start) + formatted + text.slice(end);
      const caret = selected ? start + selected.length + 3 : start + 1;
      return { text: nextText, selectionStart: caret, selectionEnd: caret };
    }
  }
}
