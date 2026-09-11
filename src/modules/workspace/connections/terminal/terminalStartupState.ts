import type { TerminalSessionStarted } from "../../../../lib/tauri";
import type { TerminalPane } from "../../../../types";

// The input handle and actual SSH readiness can arrive in either order. Keep
// this state with the live Pane runtime, including across renderer moves.
export function createTerminalStartupState(
  sessionId: string,
  updateX11: (status: NonNullable<TerminalPane["x11ForwardingStatus"]>) => void,
) {
  let ended = false;
  let readyResult: TerminalSessionStarted | undefined;
  let startResult: TerminalSessionStarted | undefined;
  let postLoginClaimed = false;
  let updateStatus: typeof updateX11 | undefined = updateX11;
  let resolveReady!: (result: TerminalSessionStarted | null) => void;
  const ready = new Promise<TerminalSessionStarted | null>((resolve) => {
    resolveReady = resolve;
  });
  return {
    ready(event: TerminalSessionStarted) {
      if (ended || event.sessionId !== sessionId) return;
      readyResult = event;
      if (event.x11ForwardingStatus) updateStatus?.(event.x11ForwardingStatus);
      if (startResult) resolveReady(event);
    },
    started(result: TerminalSessionStarted, fallback: NonNullable<TerminalPane["x11ForwardingStatus"]>) {
      if (ended || result.sessionId !== sessionId) return;
      startResult = result;
      if (!readyResult) updateStatus?.(result.x11ForwardingStatus ?? fallback);
      if (readyResult || !result.startupPending) resolveReady(readyResult ?? result);
    },
    waitUntilReady() {
      return ready;
    },
    claimPostLoginActions() {
      if (ended || postLoginClaimed || !startResult || (startResult.startupPending && !readyResult)) return false;
      postLoginClaimed = true;
      return true;
    },
    attach(update: typeof updateX11) {
      updateStatus = update;
      if (!ended && readyResult?.x11ForwardingStatus) updateStatus(readyResult.x11ForwardingStatus);
    },
    detach() {
      updateStatus = undefined;
    },
    end() {
      ended = true;
      updateStatus = undefined;
      resolveReady(null);
    },
  };
}

export type TerminalStartupState = ReturnType<typeof createTerminalStartupState>;
