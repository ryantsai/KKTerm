import { invokeCommand } from "../../lib/tauri";
import { isRemoteDesktopConnectionType } from "../workspace/connections/utils";
import { useItOpsStore } from "../itops/state";
import { useWorkspaceStore } from "../../store";

/** A link from inside a note to another KKTerm app element. Notes store these
 *  as one attribute on a mention node, so a renamed or deleted target degrades
 *  to an "unavailable" chip instead of corrupting the note. */
export type NoteDeepLink =
  | { kind: "connection"; connectionId: string }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "rackItem"; siteId: string; rackId: string; rackItemId: string };

export type NoteDeepLinkKind = NoteDeepLink["kind"];

/** Serialize a Deep Link into the single string a mention node carries. One
 *  flat attribute keeps note HTML sanitizer-friendly. */
export function serializeNoteDeepLink(link: NoteDeepLink): string {
  switch (link.kind) {
    case "connection":
      return `connection:${link.connectionId}`;
    case "workspace":
      return `workspace:${link.workspaceId}`;
    case "rackItem":
      return `rackItem:${link.siteId}:${link.rackId}:${link.rackItemId}`;
  }
}

/** Parse a serialized Deep Link. Returns `null` for anything unrecognized so
 *  hand-edited or future-version note HTML cannot throw while rendering. */
export function parseNoteDeepLink(value: string | null | undefined): NoteDeepLink | null {
  if (!value) return null;
  const parts = value.split(":");
  const [kind] = parts;
  if (kind === "connection" && parts.length === 2 && parts[1]) {
    return { kind: "connection", connectionId: parts[1] };
  }
  if (kind === "workspace" && parts.length === 2 && parts[1]) {
    return { kind: "workspace", workspaceId: parts[1] };
  }
  if (kind === "rackItem" && parts.length === 4 && parts[1] && parts[2] && parts[3]) {
    return { kind: "rackItem", siteId: parts[1], rackId: parts[2], rackItemId: parts[3] };
  }
  return null;
}

/** Follow a Deep Link. Resolves `false` when the target no longer exists so the
 *  caller can report it instead of silently doing nothing. */
export async function navigateNoteDeepLink(
  link: NoteDeepLink,
  showWorkspace: () => void,
  showItOps: () => void,
): Promise<boolean> {
  const store = useWorkspaceStore.getState();

  if (link.kind === "workspace") {
    if (!store.workspaces.some((workspace) => workspace.id === link.workspaceId)) {
      return false;
    }
    store.setActiveWorkspace(link.workspaceId);
    showWorkspace();
    return true;
  }

  if (link.kind === "rackItem") {
    useItOpsStore.getState().requestNavigation({
      siteId: link.siteId,
      destination: "site",
      rackId: link.rackId,
      rackItemId: link.rackItemId,
    });
    showItOps();
    return true;
  }

  // A note may reference a Connection in any Workspace, so this resolves by id
  // through the backend rather than the active Workspace's tree.
  const connection = await invokeCommand("itops_get_connection", {
    id: link.connectionId,
  }).catch(() => null);
  if (!connection) {
    return false;
  }
  const openTab = store.tabs.find((tab) => tab.connection?.id === connection.id);
  if (openTab) {
    store.activateTab(openTab.id);
    showWorkspace();
    return true;
  }
  // Native-surface Sessions (WebView2/RDP/VNC) must come up while the Workspace
  // is visible; see docs/ARCHITECTURE.md native-window rules.
  if (connection.type === "url" || isRemoteDesktopConnectionType(connection.type)) {
    store.openConnection(connection);
    showWorkspace();
    return true;
  }
  store.openConnection(connection);
  showWorkspace();
  return true;
}
