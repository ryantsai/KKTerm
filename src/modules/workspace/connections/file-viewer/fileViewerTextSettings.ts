/**
 * Per-connection text presentation for the Document Connection (font family,
 * font size, and decode encoding), persisted in `localStorage` keyed by
 * connection id. These are workspace UI preferences, not durable Connection
 * data, so they live in browser storage (matching the layout persistence
 * pattern in `store.ts`) rather than SQLite.
 */

const STORAGE_PREFIX = "kkterm.fileViewer.text.";
const SOFT_WRAP_SESSION_PREFIX = "kkterm.fileViewer.softWrap.";

/** Sentinel encoding meaning "auto-detect" — the backend guesses the charset. */
export const AUTO_ENCODING = "auto";

export interface DocumentTextSettings {
  /** CSS font-family stack; empty string inherits the app monospace font. */
  fontFamily: string;
  /** Editor/text font size in px; `0` inherits the app default (`--mono-size`). */
  fontSize: number;
  /** `encoding_rs` label, or `AUTO_ENCODING` to auto-detect. */
  encoding: string;
}

export const DEFAULT_TEXT_SETTINGS: DocumentTextSettings = {
  fontFamily: "",
  fontSize: 0,
  encoding: AUTO_ENCODING,
};

export const DEFAULT_SOFT_WRAP = true;

/** Selectable font sizes (px) for the Font menu. `0` is the inherit-default option. */
export const FONT_SIZE_OPTIONS = [0, 11, 12, 13, 14, 15, 16, 18, 20] as const;

/** Font family choices. `value` is the CSS font-family stack written to the
 * `--fv-font-family` variable; the empty value inherits the app mono font. The
 * `labelKey` is resolved against `workspace.fileViewer.font*` i18n keys, except
 * the named stacks which are shown verbatim. */
export interface FontFamilyOption {
  value: string;
  /** Display label (font names are shown verbatim, not translated). */
  label: string;
}

export const FONT_FAMILY_OPTIONS: FontFamilyOption[] = [
  { value: "", label: "Default (monospace)" },
  { value: '"Cascadia Code", "Cascadia Mono", monospace', label: "Cascadia Code" },
  { value: '"Consolas", monospace', label: "Consolas" },
  { value: '"JetBrains Mono", monospace', label: "JetBrains Mono" },
  { value: '"Fira Code", monospace', label: "Fira Code" },
  { value: '"Source Code Pro", monospace', label: "Source Code Pro" },
  { value: '"Courier New", monospace', label: "Courier New" },
  {
    value:
      'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    label: "System Sans",
  },
  { value: 'Georgia, "Times New Roman", serif', label: "Serif" },
];

/** Encoding choices for the Encoding menu (`encoding_rs` labels). `Auto` first. */
export interface EncodingOption {
  value: string;
  label: string;
}

export const ENCODING_OPTIONS: EncodingOption[] = [
  { value: "utf-8", label: "UTF-8" },
  { value: "utf-16le", label: "UTF-16 LE" },
  { value: "utf-16be", label: "UTF-16 BE" },
  { value: "gbk", label: "GBK (Simplified Chinese)" },
  { value: "gb18030", label: "GB18030" },
  { value: "big5", label: "Big5 (Traditional Chinese)" },
  { value: "shift_jis", label: "Shift_JIS (Japanese)" },
  { value: "euc-jp", label: "EUC-JP (Japanese)" },
  { value: "euc-kr", label: "EUC-KR (Korean)" },
  { value: "windows-1252", label: "Windows-1252" },
  { value: "iso-8859-1", label: "ISO-8859-1 (Latin-1)" },
  { value: "windows-1251", label: "Windows-1251 (Cyrillic)" },
  { value: "koi8-r", label: "KOI8-R (Cyrillic)" },
];

function isDocumentTextSettings(value: unknown): value is Partial<DocumentTextSettings> {
  return !!value && typeof value === "object";
}

export function loadDocumentTextSettings(connectionId: string | undefined): DocumentTextSettings {
  if (!connectionId || typeof window === "undefined") {
    return { ...DEFAULT_TEXT_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${connectionId}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!isDocumentTextSettings(parsed)) {
      return { ...DEFAULT_TEXT_SETTINGS };
    }
    return {
      fontFamily:
        typeof parsed.fontFamily === "string" ? parsed.fontFamily : DEFAULT_TEXT_SETTINGS.fontFamily,
      fontSize:
        typeof parsed.fontSize === "number" && Number.isFinite(parsed.fontSize)
          ? parsed.fontSize
          : DEFAULT_TEXT_SETTINGS.fontSize,
      encoding:
        typeof parsed.encoding === "string" && parsed.encoding
          ? parsed.encoding
          : DEFAULT_TEXT_SETTINGS.encoding,
    };
  } catch {
    return { ...DEFAULT_TEXT_SETTINGS };
  }
}

export function persistDocumentTextSettings(
  connectionId: string | undefined,
  settings: DocumentTextSettings,
) {
  if (!connectionId || typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${connectionId}`, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable (private mode, quota); fail silently.
  }
}

export function loadDocumentSoftWrap(connectionId: string | undefined): boolean {
  if (!connectionId || typeof window === "undefined") {
    return DEFAULT_SOFT_WRAP;
  }
  try {
    const raw = window.sessionStorage.getItem(`${SOFT_WRAP_SESSION_PREFIX}${connectionId}`);
    if (raw === "true") {
      return true;
    }
    if (raw === "false") {
      return false;
    }
  } catch {
    // Storage may be unavailable; fall through to the default.
  }
  return DEFAULT_SOFT_WRAP;
}

export function persistDocumentSoftWrap(connectionId: string | undefined, softWrap: boolean) {
  if (!connectionId || typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(`${SOFT_WRAP_SESSION_PREFIX}${connectionId}`, String(softWrap));
  } catch {
    // Storage may be unavailable (private mode, quota); fail silently.
  }
}
