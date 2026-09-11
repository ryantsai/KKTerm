import type { TerminalSessionStarted } from "../../../../lib/tauri";
import type { TerminalPane } from "../../../../types";

// A ready event may arrive before the start command resolves. Keep its final
// status authoritative, and stop accepting updates when this Session ends.
export function createTerminalStartupState(
  sessionId: string,
  updateX11: (status: NonNullable<TerminalPane["x11ForwardingStatus"]>) => void,
) {
  let ended = false;
  let receivedReady = false;
  return {
    ready(event: TerminalSessionStarted) {
      if (ended || event.sessionId !== sessionId) return;
      receivedReady = true;
      if (event.x11ForwardingStatus) updateX11(event.x11ForwardingStatus);
    },
    started(result: TerminalSessionStarted, fallback: NonNullable<TerminalPane["x11ForwardingStatus"]>) {
      if (ended || receivedReady || result.sessionId !== sessionId) return;
      updateX11(result.x11ForwardingStatus ?? fallback);
    },
    end() {
      ended = true;
    },
  };
}
