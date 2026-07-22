import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import {
  SearchAddon,
  type ISearchOptions,
  type ISearchResultChangeEvent,
} from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  Terminal as XtermTerminal,
  type IDisposable,
  type ILink,
  type IMarker,
  type ITerminalOptions,
  type ITheme,
} from "@xterm/xterm";
import { writeToClipboard } from "../../../../lib/clipboard";
import { isMacPlatform } from "../../../../lib/platform";
import { logUiDebug, openExternalUrl } from "../../../../lib/tauri";
import type { TerminalHyperlinkRule, TerminalSettings } from "../../../../types";
import {
  hexColorWithAlpha,
  resolveTerminalColorScheme,
  type TerminalColorScheme,
} from "./colorSchemes";
import {
  buildHyperlinkRuleUrl,
  decodeOsc777Notification,
  parseOsc133Sequence,
  type TerminalNotification,
} from "./oscSequences";
import { refreshTerminalFontAtlases, type TerminalFontAtlasRefreshTarget } from "./fontAtlasRefresh";
import {
  appendMacImeRawKey,
  macImeRawKey,
  resolveMacImeCompositionCommit,
  shouldSuppressMacImeCompositionKey,
} from "./imeInput";

export type { TerminalNotification } from "./oscSequences";

export type TerminalRendererBackend = "xterm";

export type TerminalRendererCapability =
  | "alternateScreen"
  | "bracketedPaste"
  | "copySelection"
  | "hyperlinks"
  | "mouseTracking"
  | "osc52Clipboard"
  | "resize"
  | "search"
  | "scrollback";

export interface TerminalDimensions {
  cols: number;
  pixelHeight: number;
  pixelWidth: number;
  rows: number;
}

/** Screen geometry for overlays (Quick Select hints), relative to the host element. */
export interface TerminalScreenGeometry {
  left: number;
  top: number;
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
}

export interface TerminalRenderer {
  readonly backend: TerminalRendererBackend;
  readonly capabilities: readonly TerminalRendererCapability[];
  readonly dimensions: TerminalDimensions;
  blur: () => void;
  clearSearch: () => void;
  dispose: () => void;
  fit: () => TerminalDimensions;
  findNext: (term: string) => boolean;
  findPrevious: (term: string) => boolean;
  focus: () => void;
  attachCustomKeyEventHandler: (handler: (event: KeyboardEvent) => boolean) => void;
  getSelection: () => string;
  onCwdChange: (handler: (cwd: string) => void) => IDisposable;
  onNotification: (handler: (notification: TerminalNotification) => void) => IDisposable;
  onData: (handler: (data: string) => void) => IDisposable;
  getLastCommandOutput: () => string | null;
  getViewportLines: () => string[];
  getScreenGeometry: () => TerminalScreenGeometry | null;
  setColorScheme: (schemeId: string) => void;
  onSearchResultsChange: (handler: (result: ISearchResultChangeEvent) => void) => IDisposable;
  onSelectionChange: (handler: () => void) => IDisposable;
  open: (element: HTMLElement) => void;
  setWheelScrollbackOverride: (enabled: boolean, handler?: (lines: number) => void) => void;
  setBackgroundOpacity: (opacity: number) => void;
  paste: (data: string) => void;
  write: (data: string) => void;
  writeln: (data: string) => void;
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  getFontSize: () => number;
  getBufferText: () => string;
  getRecordingBufferText: () => string;
  onFocus: (handler: () => void) => IDisposable;
}

const XTERM_CAPABILITIES = [
  "alternateScreen",
  "bracketedPaste",
  "copySelection",
  "hyperlinks",
  "mouseTracking",
  "osc52Clipboard",
  "resize",
  "search",
  "scrollback",
] satisfies TerminalRendererCapability[];

const MAX_OSC52_CLIPBOARD_BYTES = 1_000_000;
const MAX_OSC52_BASE64_LENGTH = Math.ceil(MAX_OSC52_CLIPBOARD_BYTES / 3) * 4;
const liveTerminalRenderers = new Set<XtermTerminalRenderer>();
const pendingFontAtlasRefreshReasons = new Set<string>();
let fontAtlasRefreshScheduled = false;
let nextTerminalRendererId = 1;

const SEARCH_OPTIONS: ISearchOptions = {
  decorations: {
    matchBackground: "#24384f",
    matchBorder: "#5aa0ff",
    matchOverviewRuler: "#5aa0ff",
    activeMatchBackground: "#f7c948",
    activeMatchBorder: "#f7c948",
    activeMatchColorOverviewRuler: "#f7c948",
  },
};

export function createTerminalRenderer(settings: TerminalSettings, backgroundOpacity = 95): TerminalRenderer {
  return new XtermTerminalRenderer(settings, backgroundOpacity);
}

export function scheduleTerminalFontAtlasRefresh(reason = "unspecified") {
  pendingFontAtlasRefreshReasons.add(reason);
  if (fontAtlasRefreshScheduled) {
    return;
  }

  fontAtlasRefreshScheduled = true;
  queueMicrotask(() => {
    fontAtlasRefreshScheduled = false;
    const reasons = [...pendingFontAtlasRefreshReasons];
    pendingFontAtlasRefreshReasons.clear();
    const renderers = [...liveTerminalRenderers];
    logUiDebug("terminal.font_atlas_refresh", {
      reasons,
      rendererCount: renderers.length,
      renderers: renderers.map((renderer) => renderer.fontAtlasDiagnostic()),
    });
    refreshTerminalFontAtlases(renderers);
  });
}

export function logTerminalFontAtlasState(reason: string) {
  const renderers = [...liveTerminalRenderers];
  logUiDebug("terminal.font_atlas_state", {
    reason,
    rendererCount: renderers.length,
    renderers: renderers.map((renderer) => renderer.fontAtlasDiagnostic()),
  });
}

class XtermTerminalRenderer implements TerminalRenderer, TerminalFontAtlasRefreshTarget {
  readonly backend = "xterm";
  readonly capabilities = XTERM_CAPABILITIES;
  private readonly rendererId = nextTerminalRendererId++;
  private readonly fitAddon = new FitAddon();
  private hostElement: HTMLElement | null = null;
  private imeCompositionActive = false;
  private imeCompositionCleanup: (() => void) | null = null;
  private imeCommitResetTimer: number | null = null;
  private macImeLeadingKey = "";
  private macImeLeadingKeyResetTimer: number | null = null;
  private macImeRawInput = "";
  private pendingMacImeCommit: { data: string; rawInput: string } | null = null;
  private readonly searchAddon = new SearchAddon({ highlightLimit: 500 });
  private readonly osc52Disposable: IDisposable | null = null;
  private readonly cwdListeners = new Set<(cwd: string) => void>();
  private readonly notificationListeners = new Set<(notification: TerminalNotification) => void>();
  private readonly osc7Disposable: IDisposable | null = null;
  private readonly oscSequenceDisposables: IDisposable[] = [];
  private readonly terminal: XtermTerminal;
  private backgroundOpacity: number;
  private colorScheme: TerminalColorScheme;
  private webglAddon: WebglAddon | null = null;
  private webglContextLossDisposable: IDisposable | null = null;
  private wheelScrollbackHandler: ((lines: number) => void) | null = null;
  private wheelScrollbackOverride = false;
  // OSC 133 shell-integration zones: the last command's output span and exit
  // status, kept for the failed-command gutter mark (and so the copy-last-
  // command-output surface can return once shell integration is injectable).
  private lastOutputStartMarker: IMarker | null = null;
  private lastOutputEndMarker: IMarker | null = null;
  private runningOutputStartMarker: IMarker | null = null;

  constructor(settings: TerminalSettings, backgroundOpacity: number) {
    this.backgroundOpacity = backgroundOpacity;
    this.colorScheme = resolveTerminalColorScheme(settings.colorScheme);
    this.terminal = new XtermTerminal(
      terminalOptionsFor(settings, this.colorScheme, backgroundOpacity),
    );
    this.terminal.attachCustomWheelEventHandler((event) => this.handleWheelEvent(event));
    // xterm defaults to its built-in Unicode v6 width tables, where emoji are
    // still 1 cell wide. Modern shells emit emoji that fonts paint two cells
    // wide, so the v6 model under-counts the cursor advance and every column
    // after an emoji drifts (issue #454). Activate Unicode 11 widths so wide
    // codepoints reserve two cells and stay aligned.
    this.terminal.loadAddon(new Unicode11Addon());
    this.terminal.unicode.activeVersion = "11";
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.searchAddon);
    this.terminal.loadAddon(new WebLinksAddon(handleTerminalLink));
    if (settings.enableInlineImages) {
      // Sixel + iTerm2 inline image protocol (imgcat and friends). The addon
      // enforces its own memory limits, so no extra bookkeeping is needed.
      this.terminal.loadAddon(new ImageAddon());
    }
    this.registerHyperlinkRuleProvider(settings.hyperlinkRules);
    this.osc7Disposable = this.terminal.parser.registerOscHandler(7, (data) =>
      this.handleOsc7CwdSequence(data),
    );
    this.oscSequenceDisposables.push(
      this.terminal.parser.registerOscHandler(133, (data) =>
        this.handleOsc133Sequence(data),
      ),
      this.terminal.parser.registerOscHandler(9, (data) => {
        // OSC 9;4;… is the ConEmu/Windows Terminal progress protocol, not a
        // notification — shells emit it constantly, so it must not notify.
        if (data && !data.startsWith("4;")) {
          this.emitNotification({ title: null, body: data });
        }
        return true;
      }),
      this.terminal.parser.registerOscHandler(777, (data) => {
        const notification = decodeOsc777Notification(data);
        if (notification) {
          this.emitNotification(notification);
        }
        return true;
      }),
    );
    if (settings.allowOsc52Clipboard) {
      this.osc52Disposable = this.terminal.parser.registerOscHandler(52, (data) =>
        handleOsc52ClipboardSequence(data),
      );
    }
  }

  get dimensions() {
    const pixels =
      screenPixelDimensionsFor(this.terminal.element ?? null) ??
      contentPixelDimensionsFor(this.terminal.element ?? this.hostElement);
    return {
      cols: this.terminal.cols,
      pixelHeight: pixels.pixelHeight,
      pixelWidth: pixels.pixelWidth,
      rows: this.terminal.rows,
    };
  }

  dispose() {
    liveTerminalRenderers.delete(this);
    this.hostElement = null;
    this.imeCompositionCleanup?.();
    this.imeCompositionCleanup = null;
    if (this.imeCommitResetTimer !== null) {
      window.clearTimeout(this.imeCommitResetTimer);
      this.imeCommitResetTimer = null;
    }
    if (this.macImeLeadingKeyResetTimer !== null) {
      window.clearTimeout(this.macImeLeadingKeyResetTimer);
      this.macImeLeadingKeyResetTimer = null;
    }
    this.osc52Disposable?.dispose();
    this.osc7Disposable?.dispose();
    for (const disposable of this.oscSequenceDisposables) {
      disposable.dispose();
    }
    this.oscSequenceDisposables.length = 0;
    this.notificationListeners.clear();
    this.disposeWebglAddon();
    this.terminal.dispose();
  }

  clearSearch() {
    this.searchAddon.clearDecorations();
    this.terminal.clearSelection();
  }

  fit() {
    this.fitAddon.fit();
    this.trimRowsToVisibleScreen();
    return this.dimensions;
  }

  findNext(term: string) {
    const normalizedTerm = term.trim();
    if (!normalizedTerm) {
      this.clearSearch();
      return false;
    }

    return this.searchAddon.findNext(normalizedTerm, {
      ...SEARCH_OPTIONS,
      incremental: true,
    });
  }

  findPrevious(term: string) {
    const normalizedTerm = term.trim();
    if (!normalizedTerm) {
      this.clearSearch();
      return false;
    }

    return this.searchAddon.findPrevious(normalizedTerm, SEARCH_OPTIONS);
  }

  focus() {
    this.terminal.focus();
  }

  blur() {
    this.terminal.blur();
  }

  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
    this.terminal.attachCustomKeyEventHandler((event) => {
      if (this.imeCompositionActive) {
        this.macImeRawInput = appendMacImeRawKey(this.macImeRawInput, event, true);
      } else {
        const leadingKey = macImeRawKey(event);
        if (leadingKey) {
          this.macImeLeadingKey = leadingKey;
          if (this.macImeLeadingKeyResetTimer !== null) {
            window.clearTimeout(this.macImeLeadingKeyResetTimer);
          }
          this.macImeLeadingKeyResetTimer = window.setTimeout(() => {
            this.macImeLeadingKey = "";
            this.macImeLeadingKeyResetTimer = null;
          }, 0);
        }
      }
      if (shouldSuppressMacImeCompositionKey(event, this.imeCompositionActive)) {
        return false;
      }
      return handler(event);
    });
  }

  getSelection() {
    return this.terminal.getSelection();
  }

  onData(handler: (data: string) => void) {
    return this.terminal.onData((data) => {
      if (!this.pendingMacImeCommit) {
        handler(data);
        return;
      }

      const { data: compositionEndData, rawInput } = this.pendingMacImeCommit;
      this.pendingMacImeCommit = null;
      if (this.imeCommitResetTimer !== null) {
        window.clearTimeout(this.imeCommitResetTimer);
        this.imeCommitResetTimer = null;
      }
      handler(resolveMacImeCompositionCommit(data, compositionEndData, rawInput));
    });
  }

  onCwdChange(handler: (cwd: string) => void) {
    this.cwdListeners.add(handler);
    return {
      dispose: () => {
        this.cwdListeners.delete(handler);
      },
    };
  }

  onNotification(handler: (notification: TerminalNotification) => void) {
    this.notificationListeners.add(handler);
    return {
      dispose: () => {
        this.notificationListeners.delete(handler);
      },
    };
  }

  getLastCommandOutput() {
    const start = this.lastOutputStartMarker;
    const end = this.lastOutputEndMarker;
    if (!start || !end || start.isDisposed || end.isDisposed || end.line <= start.line) {
      return null;
    }
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let line = start.line; line < end.line; line += 1) {
      const bufferLine = buffer.getLine(line);
      if (bufferLine) {
        lines.push(bufferLine.translateToString(true));
      }
    }
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines.length > 0 ? lines.join("\n") : null;
  }

  getViewportLines() {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < this.terminal.rows; row += 1) {
      const line = buffer.getLine(buffer.viewportY + row);
      lines.push(line ? line.translateToString(true) : "");
    }
    return lines;
  }

  getScreenGeometry(): TerminalScreenGeometry | null {
    const host = this.hostElement;
    const screen = this.terminal.element?.querySelector<HTMLElement>(".xterm-screen");
    if (!host || !screen || this.terminal.cols <= 0 || this.terminal.rows <= 0) {
      return null;
    }
    const hostRect = host.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    if (screenRect.width <= 0 || screenRect.height <= 0) {
      return null;
    }
    return {
      left: screenRect.left - hostRect.left,
      top: screenRect.top - hostRect.top,
      cellWidth: screenRect.width / this.terminal.cols,
      cellHeight: screenRect.height / this.terminal.rows,
      cols: this.terminal.cols,
      rows: this.terminal.rows,
    };
  }

  setColorScheme(schemeId: string) {
    const scheme = resolveTerminalColorScheme(schemeId);
    if (scheme.id === this.colorScheme.id) {
      return;
    }
    this.colorScheme = scheme;
    this.terminal.options.theme = themeForScheme(scheme, this.backgroundOpacity);
    this.applyHostBackground(this.backgroundOpacity);
  }

  private emitNotification(notification: TerminalNotification) {
    const body = notification.body.slice(0, 512);
    for (const listener of this.notificationListeners) {
      listener({ title: notification.title, body });
    }
  }

  private handleOsc133Sequence(data: string) {
    const sequence = parseOsc133Sequence(data);
    if (!sequence) {
      return true;
    }
    if (sequence.kind === "C") {
      this.runningOutputStartMarker = this.terminal.registerMarker(0) ?? null;
    } else if (sequence.kind === "D") {
      const start = this.runningOutputStartMarker;
      this.runningOutputStartMarker = null;
      const end = this.terminal.registerMarker(0);
      if (start && !start.isDisposed && end) {
        this.lastOutputStartMarker = start;
        this.lastOutputEndMarker = end;
        if (typeof sequence.exitCode === "number" && sequence.exitCode !== 0) {
          this.markFailedCommand(end);
        }
      }
    }
    return true;
  }

  private markFailedCommand(marker: IMarker) {
    const decoration = this.terminal.registerDecoration({ marker, width: 1 });
    decoration?.onRender((element) => {
      element.classList.add("terminal-command-failed-mark");
      element.style.setProperty("--terminal-failed-mark-color", this.colorScheme.palette.red);
    });
  }

  private registerHyperlinkRuleProvider(rules: TerminalHyperlinkRule[] | undefined) {
    const compiled = compileHyperlinkRules(rules);
    if (compiled.length === 0) {
      return;
    }
    this.terminal.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) => {
        const line = this.terminal.buffer.active.getLine(bufferLineNumber - 1);
        if (!line) {
          callback(undefined);
          return;
        }
        const text = line.translateToString(true);
        const links: ILink[] = [];
        for (const rule of compiled) {
          rule.pattern.lastIndex = 0;
          for (const match of text.matchAll(rule.pattern)) {
            const url = buildHyperlinkRuleUrl(rule.urlTemplate, match);
            if (!url) {
              continue;
            }
            const start = match.index ?? 0;
            links.push({
              range: {
                start: { x: start + 1, y: bufferLineNumber },
                end: { x: start + match[0].length, y: bufferLineNumber },
              },
              text: match[0],
              activate: (event) => handleTerminalLink(event, url),
            });
          }
        }
        callback(links.length > 0 ? links : undefined);
      },
    });
  }

  onSearchResultsChange(handler: (result: ISearchResultChangeEvent) => void) {
    return this.searchAddon.onDidChangeResults(handler);
  }

  onSelectionChange(handler: () => void) {
    return this.terminal.onSelectionChange(handler);
  }

  setWheelScrollbackOverride(enabled: boolean, handler?: (lines: number) => void) {
    this.wheelScrollbackOverride = enabled;
    this.wheelScrollbackHandler = enabled ? handler ?? null : null;
  }

  setBackgroundOpacity(opacity: number) {
    this.backgroundOpacity = opacity;
    this.terminal.options.theme = {
      ...this.terminal.options.theme,
      background: schemeBackgroundColor(this.colorScheme, opacity),
    };
    this.applyHostBackground(opacity);
  }

  open(element: HTMLElement) {
    this.hostElement = element;
    this.applyHostBackground(this.backgroundOpacity);
    this.terminal.open(element);
    const imeTextarea = this.terminal.textarea;
    if (imeTextarea) {
      const handleCompositionStart = () => {
        this.imeCompositionActive = true;
        this.macImeRawInput = this.macImeLeadingKey;
        this.macImeLeadingKey = "";
        if (this.macImeLeadingKeyResetTimer !== null) {
          window.clearTimeout(this.macImeLeadingKeyResetTimer);
          this.macImeLeadingKeyResetTimer = null;
        }
        this.pendingMacImeCommit = null;
        if (this.imeCommitResetTimer !== null) {
          window.clearTimeout(this.imeCommitResetTimer);
          this.imeCommitResetTimer = null;
        }
      };
      const handleCompositionEnd = (event: CompositionEvent) => {
        this.imeCompositionActive = false;
        if (isMacPlatform()) {
          this.pendingMacImeCommit = { data: event.data, rawInput: this.macImeRawInput };
          this.macImeRawInput = "";
          if (this.imeCommitResetTimer !== null) {
            window.clearTimeout(this.imeCommitResetTimer);
          }
          this.imeCommitResetTimer = window.setTimeout(() => {
            this.pendingMacImeCommit = null;
            this.imeCommitResetTimer = null;
          }, 0);
        }
      };
      const handleBlur = () => {
        this.imeCompositionActive = false;
        this.macImeLeadingKey = "";
        this.macImeRawInput = "";
        if (this.macImeLeadingKeyResetTimer !== null) {
          window.clearTimeout(this.macImeLeadingKeyResetTimer);
          this.macImeLeadingKeyResetTimer = null;
        }
        this.pendingMacImeCommit = null;
        if (this.imeCommitResetTimer !== null) {
          window.clearTimeout(this.imeCommitResetTimer);
          this.imeCommitResetTimer = null;
        }
      };
      imeTextarea.addEventListener("compositionstart", handleCompositionStart);
      imeTextarea.addEventListener("compositionend", handleCompositionEnd);
      imeTextarea.addEventListener("blur", handleBlur);
      this.imeCompositionCleanup = () => {
        imeTextarea.removeEventListener("compositionstart", handleCompositionStart);
        imeTextarea.removeEventListener("compositionend", handleCompositionEnd);
        imeTextarea.removeEventListener("blur", handleBlur);
      };
    }
    this.tryEnableWebglRenderer();
    liveTerminalRenderers.add(this);
    this.refreshAtlasWhenFontsReady();
  }

  private refreshAtlasWhenFontsReady() {
    // Custom fonts (e.g. Nerd Fonts dropped into the app fonts folder) register
    // asynchronously through the FontFace API. If a terminal opens before its
    // configured font finishes loading, the glyph atlas caches fallback boxes.
    // Rebuild the atlas once fonts settle so powerline/Nerd glyphs render
    // without a reload.
    if (typeof document === "undefined" || !document.fonts?.ready) {
      return;
    }
    void document.fonts.ready.then(() => {
      if (liveTerminalRenderers.has(this)) {
        scheduleTerminalFontAtlasRefresh("document-fonts-ready");
      }
    });
  }

  private applyHostBackground(opacity: number) {
    if (!this.hostElement) {
      return;
    }
    this.hostElement.style.setProperty(
      "--terminal-surface-background",
      schemeBackgroundColor(this.colorScheme, opacity),
    );
  }

  private tryEnableWebglRenderer() {
    if (this.webglAddon) {
      return;
    }

    let addon: WebglAddon;
    try {
      addon = new WebglAddon();
    } catch {
      // WebGL2 unavailable (driver, headless RDP, blocklist) — stay on DOM.
      return;
    }

    try {
      this.terminal.loadAddon(addon);
    } catch {
      addon.dispose();
      return;
    }

    this.webglContextLossDisposable = addon.onContextLoss(() => {
      // GPU context evicted (sleep/wake, GPU reset). Drop the addon and let
      // xterm fall back to its DOM renderer for subsequent frames.
      this.disposeWebglAddon();
    });
    this.webglAddon = addon;
  }

  private disposeWebglAddon() {
    this.webglContextLossDisposable?.dispose();
    this.webglContextLossDisposable = null;
    this.webglAddon?.dispose();
    this.webglAddon = null;
  }

  private trimRowsToVisibleScreen() {
    const element = this.terminal.element;
    const screen = element?.querySelector<HTMLElement>(".xterm-screen");
    if (!element || !screen || !element.isConnected) {
      return;
    }

    const style = window.getComputedStyle(element);
    const paddingBottom = numericStyleValue(style.paddingBottom);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const elementRect = element.getBoundingClientRect();
      const screenRect = screen.getBoundingClientRect();
      const maxScreenBottom = elementRect.bottom - paddingBottom + 0.5;
      if (screenRect.bottom <= maxScreenBottom || this.terminal.rows <= 1) {
        return;
      }
      this.terminal.resize(this.terminal.cols, this.terminal.rows - 1);
    }
  }

  write(data: string) {
    this.terminal.write(data);
  }

  paste(data: string) {
    this.terminal.paste(data);
  }

  writeln(data: string) {
    this.terminal.writeln(data);
  }

  setFontSize(size: number) {
    const clamped = Math.min(Math.max(Math.round(size), 6), 64);
    this.terminal.options.fontSize = clamped;
    try {
      this.fitAddon.fit();
      this.trimRowsToVisibleScreen();
    } catch {
      // Fit may throw if the host is detached; safe to ignore.
    }
  }

  setFontFamily(family: string) {
    if (this.terminal.options.fontFamily === family) {
      return;
    }
    this.terminal.options.fontFamily = family;
    scheduleTerminalFontAtlasRefresh("font-family-change");
  }

  clearFontAtlas() {
    try {
      this.terminal.clearTextureAtlas();
    } catch {
      // The renderer may have fallen back from WebGL or been disposed.
    }
  }

  redraw() {
    try {
      if (this.terminal.rows > 0) {
        this.terminal.refresh(0, this.terminal.rows - 1);
      }
    } catch {
      // A hidden or detached host will redraw when it becomes active.
    }
  }

  fontAtlasDiagnostic() {
    return {
      rendererId: this.rendererId,
      fontFamily: this.terminal.options.fontFamily,
      fontSize: this.terminal.options.fontSize,
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      clientWidth: this.hostElement?.clientWidth ?? 0,
      clientHeight: this.hostElement?.clientHeight ?? 0,
      connected: this.hostElement?.isConnected ?? false,
      visible: Boolean(this.hostElement?.clientWidth && this.hostElement?.clientHeight),
      webgl: this.webglAddon !== null,
    };
  }

  getFontSize() {
    return this.terminal.options.fontSize ?? 14;
  }

  private bufferText(includeAlternate: boolean) {
    const lines: string[] = [];
    const buffers = includeAlternate
      ? [this.terminal.buffer.normal, this.terminal.buffer.alternate]
      : [this.terminal.buffer.normal];
    const seen = new Set<typeof buffers[number]>();
    for (const buffer of buffers) {
      if (!buffer || seen.has(buffer)) {
        continue;
      }
      seen.add(buffer);
      const total = buffer.length;
      for (let row = 0; row < total; row += 1) {
        const line = buffer.getLine(row);
        if (!line) {
          continue;
        }
        lines.push(line.translateToString(true));
      }
    }
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines.join("\n");
  }

  getBufferText() {
    return this.bufferText(true);
  }

  getRecordingBufferText() {
    return this.bufferText(false);
  }

  onFocus(handler: () => void) {
    return this.terminal.textarea
      ? listenToFocus(this.terminal.textarea, handler)
      : { dispose: () => undefined };
  }

  private handleWheelEvent(event: WheelEvent) {
    if (!this.wheelScrollbackOverride) {
      return true;
    }

    const lines = wheelScrollLinesForEvent(event, this.terminal.rows, terminalCellHeight(this.terminal.element ?? null));
    if (lines !== 0) {
      if (this.wheelScrollbackHandler) {
        this.wheelScrollbackHandler(lines);
      } else {
        this.terminal.scrollLines(lines);
      }
    }
    event.preventDefault();
    event.stopPropagation();
    return false;
  }

  private handleOsc7CwdSequence(data: string) {
    const cwd = decodeOsc7Cwd(data);
    if (cwd) {
      for (const listener of this.cwdListeners) {
        listener(cwd);
      }
    }
    return true;
  }
}

function listenToFocus(textarea: HTMLTextAreaElement, handler: () => void): IDisposable {
  textarea.addEventListener("focus", handler);
  return {
    dispose: () => textarea.removeEventListener("focus", handler),
  };
}

function contentPixelDimensionsFor(element: HTMLElement | null) {
  const style = element ? window.getComputedStyle(element) : null;
  const horizontalPadding =
    numericStyleValue(style?.paddingLeft) + numericStyleValue(style?.paddingRight);
  const verticalPadding =
    numericStyleValue(style?.paddingTop) + numericStyleValue(style?.paddingBottom);

  return {
    pixelHeight: Math.max(0, Math.round((element?.clientHeight ?? 0) - verticalPadding)),
    pixelWidth: Math.max(0, Math.round((element?.clientWidth ?? 0) - horizontalPadding)),
  };
}

function screenPixelDimensionsFor(element: HTMLElement | null) {
  const screen = element?.querySelector<HTMLElement>(".xterm-screen");
  if (!screen) {
    return null;
  }
  const rect = screen.getBoundingClientRect();
  const pixelHeight = Math.round(rect.height);
  const pixelWidth = Math.round(rect.width);
  if (pixelHeight <= 0 || pixelWidth <= 0) {
    return null;
  }
  return { pixelHeight, pixelWidth };
}

function numericStyleValue(value: string | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function terminalCellHeight(element: HTMLElement | null) {
  const row = element?.querySelector<HTMLElement>(".xterm-rows > div");
  const height = row?.getBoundingClientRect().height;
  return height && Number.isFinite(height) && height > 0 ? height : 16;
}

export function wheelScrollLinesForEvent(event: WheelEvent, rows: number, cellHeight: number) {
  if (event.deltaY === 0) {
    return 0;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return Math.trunc(Math.sign(event.deltaY) * Math.max(1, rows - 1));
  }

  const rawLines =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? event.deltaY
      : event.deltaY / Math.max(1, cellHeight);
  const magnitude = Math.min(Math.max(1, Math.ceil(Math.abs(rawLines))), Math.max(1, rows - 1));
  return Math.sign(event.deltaY) * magnitude;
}


function schemeBackgroundColor(scheme: TerminalColorScheme, opacity: number) {
  const alpha = Math.min(Math.max(Math.round(opacity), 0), 100) / 100;
  return hexColorWithAlpha(scheme.palette.background, alpha);
}

export function themeForScheme(scheme: TerminalColorScheme, backgroundOpacity: number): ITheme {
  const palette = scheme.palette;
  const selection = palette.selectionBackground ?? "#305f95";
  return {
    background: schemeBackgroundColor(scheme, backgroundOpacity),
    foreground: palette.foreground,
    cursor: palette.cursor ?? palette.foreground,
    selectionBackground: selection,
    selectionInactiveBackground: hexColorWithAlpha(selection, 0.55),
    black: palette.black,
    red: palette.red,
    green: palette.green,
    yellow: palette.yellow,
    blue: palette.blue,
    magenta: palette.magenta,
    cyan: palette.cyan,
    white: palette.white,
    brightBlack: palette.brightBlack,
    brightRed: palette.brightRed,
    brightGreen: palette.brightGreen,
    brightYellow: palette.brightYellow,
    brightBlue: palette.brightBlue,
    brightMagenta: palette.brightMagenta,
    brightCyan: palette.brightCyan,
    brightWhite: palette.brightWhite,
    scrollbarSliderBackground: "rgba(149, 167, 187, 0.48)",
    scrollbarSliderHoverBackground: "rgba(185, 202, 224, 0.72)",
    scrollbarSliderActiveBackground: "rgba(217, 226, 239, 0.86)",
  };
}

function terminalOptionsFor(
  settings: TerminalSettings,
  scheme: TerminalColorScheme,
  backgroundOpacity: number,
): ITerminalOptions {
  return {
    altClickMovesCursor: false,
    // @xterm/addon-search renders match decorations through xterm's proposed
    // decoration API. Without this, the first decorated scrollback search can
    // throw from the renderer path and leave the Tauri WebView unusable.
    allowProposedApi: true,
    allowTransparency: true,
    convertEol: false,
    customGlyphs: true,
    cursorBlink: true,
    cursorInactiveStyle: "outline",
    cursorStyle: settings.cursorStyle,
    drawBoldTextInBrightColors: true,
    fastScrollSensitivity: 5,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    ignoreBracketedPasteMode: false,
    lineHeight: settings.lineHeight,
    macOptionClickForcesSelection: true,
    macOptionIsMeta: true,
    minimumContrastRatio: 1,
    rightClickSelectsWord: false,
    scrollOnEraseInDisplay: true,
    scrollOnUserInput: true,
    scrollback: clampScrollback(settings.scrollbackLines),
    smoothScrollDuration: 0,
    theme: themeForScheme(scheme, backgroundOpacity),
  };
}

interface CompiledHyperlinkRule {
  pattern: RegExp;
  urlTemplate: string;
}

function compileHyperlinkRules(rules: TerminalHyperlinkRule[] | undefined): CompiledHyperlinkRule[] {
  const compiled: CompiledHyperlinkRule[] = [];
  for (const rule of rules ?? []) {
    const pattern = rule.pattern.trim();
    const urlTemplate = rule.urlTemplate.trim();
    if (!pattern || !/^https?:\/\//.test(urlTemplate)) {
      continue;
    }
    try {
      compiled.push({ pattern: new RegExp(pattern, "g"), urlTemplate });
    } catch {
      // Invalid user regex — skip the rule instead of breaking the terminal.
    }
  }
  return compiled;
}

async function handleOsc52ClipboardSequence(data: string) {
  const text = decodeOsc52ClipboardText(data);
  if (text === null) {
    return true;
  }

  try {
    await writeToClipboard(text);
  } catch (error) {
    console.warn("OSC 52 clipboard write failed.", error);
  }
  return true;
}

export function decodeOsc7Cwd(data: string) {
  const trimmed = data.trim();
  if (!trimmed.startsWith("file://")) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname) {
      return null;
    }
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      return pathname.slice(1);
    }
    return pathname;
  } catch {
    return null;
  }
}

function handleTerminalLink(event: MouseEvent, uri: string) {
  if (!event.ctrlKey) {
    return;
  }
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  void openExternalUrl(url.href).catch((error) => {
    console.warn("Terminal external link open failed.", error);
  });
}

export function decodeOsc52ClipboardText(data: string) {
  const separatorIndex = data.indexOf(";");
  if (separatorIndex < 0) {
    return null;
  }

  const target = data.slice(0, separatorIndex);
  const encoded = data.slice(separatorIndex + 1);
  if (!target || target.includes("?") || encoded === "?") {
    return null;
  }
  if (encoded.length > MAX_OSC52_BASE64_LENGTH) {
    return null;
  }

  try {
    const binary = atob(encoded);
    if (binary.length > MAX_OSC52_CLIPBOARD_BYTES) {
      return null;
    }
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function clampScrollback(lines: number) {
  if (!Number.isFinite(lines)) {
    return 5000;
  }

  return Math.min(Math.max(Math.round(lines), 100), 100_000);
}
