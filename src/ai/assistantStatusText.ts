const TRAILING_ELLIPSIS = /\s*(?:\.{2,}|…+|⋯+|。{2,})\s*$/u;

export function withoutTrailingAssistantStatusEllipsis(text: string) {
  return text.replace(TRAILING_ELLIPSIS, "").trimEnd();
}
