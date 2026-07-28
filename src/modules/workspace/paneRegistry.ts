import type { TerminalRenderer } from "./connections/terminal/renderer";

const renderers = new Map<string, TerminalRenderer>();
const inputWriters = new Map<string, (data: string) => void>();
const rdpTextSenders = new Map<string, (text: string, pressEnter: boolean) => Promise<void>>();
const remoteDesktopControllers = new Map<string, RemoteDesktopController>();
const fileBrowserControllers = new Map<string, FileBrowserController>();
const movingTerminalPaneIds = new Set<string>();
const preservedTerminalPaneRuntimes = new Map<string, PreservedTerminalPaneRuntime>();

export type PreservedTerminalPaneRuntime = {
  bufferText: string;
  sessionId: string;
  sessionStarted: boolean;
};

export type RemoteDesktopController = {
  kind: "rdp" | "vnc";
  captureScreenshot: () => Promise<unknown>;
  sendText: (text: string, pressEnter: boolean) => Promise<void>;
  keyPress: (key: string) => Promise<void>;
  mouseClick?: (x: number, y: number, button: "left" | "right" | "middle") => Promise<void>;
};

export type FileBrowserController = {
  kind: "sftp" | "ftp";
  list: (path?: string | null) => Promise<unknown>;
  createFolder: (parentPath: string, name: string) => Promise<unknown>;
  rename: (path: string, newName: string) => Promise<unknown>;
  deletePath: (path: string) => Promise<unknown>;
  snapshot: () => unknown;
};

export function registerPaneRenderer(paneId: string, renderer: TerminalRenderer) {
  renderers.set(paneId, renderer);
}

export function unregisterPaneRenderer(paneId: string, renderer: TerminalRenderer) {
  if (renderers.get(paneId) === renderer) {
    renderers.delete(paneId);
  }
}

export function getPaneRenderer(paneId: string): TerminalRenderer | undefined {
  return renderers.get(paneId);
}

export function focusPaneRenderer(paneId: string) {
  const renderer = renderers.get(paneId);
  if (!renderer) {
    return false;
  }
  renderer.focus();
  return true;
}

export function markPanesForRuntimeMove(paneIds: string[]) {
  for (const paneId of paneIds) {
    movingTerminalPaneIds.add(paneId);
  }
}

export function shouldPreservePaneRuntimeOnUnmount(paneId: string) {
  if (!movingTerminalPaneIds.has(paneId)) {
    return false;
  }
  movingTerminalPaneIds.delete(paneId);
  return true;
}

export function preserveTerminalPaneRuntime(
  paneId: string,
  runtime: PreservedTerminalPaneRuntime,
) {
  preservedTerminalPaneRuntimes.set(paneId, runtime);
}

export function takePreservedTerminalPaneRuntime(paneId: string) {
  const runtime = preservedTerminalPaneRuntimes.get(paneId);
  if (runtime) {
    preservedTerminalPaneRuntimes.delete(paneId);
    // In development, React Strict Mode immediately probes a newly mounted
    // effect with cleanup + setup. Re-arm the move permit for that synchronous
    // cleanup so the second setup can take the same live Session. Expire it in
    // a microtask so a later real Pane close still tears the Session down.
    movingTerminalPaneIds.add(paneId);
    queueMicrotask(() => movingTerminalPaneIds.delete(paneId));
  }
  return runtime;
}

export function registerPaneInputWriter(paneId: string, writer: (data: string) => void) {
  inputWriters.set(paneId, writer);
}

export function unregisterPaneInputWriter(paneId: string, writer: (data: string) => void) {
  if (inputWriters.get(paneId) === writer) {
    inputWriters.delete(paneId);
  }
}

export function writeInputToPane(paneId: string, data: string) {
  const writer = inputWriters.get(paneId);
  if (!writer) {
    return false;
  }
  writer(data);
  return true;
}

// Mirror input to every terminal pane except the originating one. Writers send
// straight to their PTY (not through xterm's onData), so this never re-enters
// the broadcast and cannot loop. Only terminal panes register input writers.
export function broadcastInputToOtherPanes(sourcePaneId: string, data: string) {
  for (const [paneId, writer] of inputWriters) {
    if (paneId !== sourcePaneId) {
      writer(data);
    }
  }
}

export function countRegisteredInputPanes() {
  return inputWriters.size;
}

export function registerRdpTextSender(
  paneId: string,
  sender: (text: string, pressEnter: boolean) => Promise<void>,
) {
  rdpTextSenders.set(paneId, sender);
}

export function unregisterRdpTextSender(
  paneId: string,
  sender: (text: string, pressEnter: boolean) => Promise<void>,
) {
  if (rdpTextSenders.get(paneId) === sender) {
    rdpTextSenders.delete(paneId);
  }
}

export function sendTextToRdpPane(paneId: string, text: string, pressEnter: boolean) {
  const sender = rdpTextSenders.get(paneId);
  if (!sender) {
    return null;
  }
  return sender(text, pressEnter);
}

export function registerRemoteDesktopController(paneId: string, controller: RemoteDesktopController) {
  remoteDesktopControllers.set(paneId, controller);
}

export function unregisterRemoteDesktopController(paneId: string, controller: RemoteDesktopController) {
  if (remoteDesktopControllers.get(paneId) === controller) {
    remoteDesktopControllers.delete(paneId);
  }
}

export function getRemoteDesktopController(paneId: string) {
  return remoteDesktopControllers.get(paneId);
}

export function registerFileBrowserController(tabId: string, controller: FileBrowserController) {
  fileBrowserControllers.set(tabId, controller);
}

export function unregisterFileBrowserController(tabId: string, controller: FileBrowserController) {
  if (fileBrowserControllers.get(tabId) === controller) {
    fileBrowserControllers.delete(tabId);
  }
}

export function getFileBrowserController(tabId: string) {
  return fileBrowserControllers.get(tabId);
}
