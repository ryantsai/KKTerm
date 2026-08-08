import type { WorkspaceTab } from "../../types";

function tabWorkspaceId(tab: Pick<WorkspaceTab, "workspaceId">) {
  return tab.workspaceId ?? "default";
}

export function reorderWorkspaceTabs(
  tabs: WorkspaceTab[],
  draggedTabId: string,
  targetTabId: string,
) {
  const fromIndex = tabs.findIndex((tab) => tab.id === draggedTabId);
  const targetIndex = tabs.findIndex((tab) => tab.id === targetTabId);
  if (fromIndex === -1 || targetIndex === -1 || fromIndex === targetIndex) {
    return tabs;
  }
  if (tabWorkspaceId(tabs[fromIndex]) !== tabWorkspaceId(tabs[targetIndex])) {
    return tabs;
  }
  const next = [...tabs];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}
