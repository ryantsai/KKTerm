// IT Ops Module shell. The visible module is Site-first; Batch Run and
// Automation runtime plumbing stays mounted here so backend events and
// programmatic run requests keep working across the separate Site-owned pages.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { Actions, Btn, DialogShell, Sheet } from "../../app/ui/dialog";
import {
  ModuleHeader,
  ModuleHeaderLead,
  ModuleHeaderTitle,
  ModuleIconTile,
} from "../../app/ModuleHeader";
import { isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type { RunEvent, RunScope } from "../../types";
import { ItOpsModuleIcon } from "./icons";
import { SitesTab } from "./SitesTab";
import { BatchRunDialog } from "./BatchRunDialog";
import { useItOpsStore } from "./state";

type AutomationActionEvent = {
  kind: string;
  automationName?: string;
  title?: string;
  body?: string;
};

export function ItOpsModule({
  active,
  siteTreeCollapsed,
  onShowWorkspace,
}: {
  active: boolean;
  siteTreeCollapsed: boolean;
  onShowWorkspace: () => void;
}) {
  const { t } = useTranslation();
  const [batchDialogGroupId, setBatchDialogGroupId] = useState<string | null | undefined>(
    undefined,
  );
  const [batchDialogScope, setBatchDialogScope] = useState<RunScope | null>(null);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [automationPopup, setAutomationPopup] = useState<{ title: string; body: string } | null>(
    null,
  );

  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const loadSites = useItOpsStore((state) => state.loadSites);
  const loadRunHistory = useItOpsStore((state) => state.loadRunHistory);
  const loadTasks = useItOpsStore((state) => state.loadTasks);
  const loadAutomations = useItOpsStore((state) => state.loadAutomations);
  const applyRunEvent = useItOpsStore((state) => state.applyRunEvent);
  const newRunRequest = useItOpsStore((state) => state.newRunRequest);
  const pendingRunGroupId = useItOpsStore((state) => state.pendingRunGroupId);
  const pendingRunScope = useItOpsStore((state) => state.pendingRunScope);
  const pendingRunTask = useItOpsStore((state) => state.pendingRunTask);

  useEffect(() => {
    void loadSites();
    void loadRunHistory();
    void loadTasks();
    void loadAutomations();
  }, [loadSites, loadRunHistory, loadTasks, loadAutomations]);

  useEffect(() => {
    const reload = () => {
      void loadSites();
      void loadRunHistory();
      void loadTasks();
      void loadAutomations();
    };
    window.addEventListener("kkterm:itops-invalidated", reload);
    return () => window.removeEventListener("kkterm:itops-invalidated", reload);
  }, [loadSites, loadRunHistory, loadTasks, loadAutomations]);

  // Stream live Batch Run progress into the store.
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    const unlisten = listen<RunEvent>("itops://run", (event) => applyRunEvent(event.payload));
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [applyRunEvent]);

  // Surface Automation notify/popup actions (docs/ITOPS.md Phase 4).
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    const unlisten = listen<AutomationActionEvent>("itops://automation", (event) => {
      const payload = event.payload;
      if (payload.kind === "popup") {
        setAutomationPopup({ title: payload.title ?? "", body: payload.body ?? "" });
      } else if (payload.kind === "notify") {
        showStatusBarNotice(
          t("itops.automations.triggeredNotice", { name: payload.automationName ?? "" }),
          { tone: "warning" },
        );
      }
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [showStatusBarNotice, t]);

  function openBatchRunDialog(groupId?: string | null, scope?: RunScope | null) {
    setBatchDialogGroupId(groupId);
    setBatchDialogScope(scope ?? null);
    setBatchDialogOpen(true);
  }

  // Hidden Batch Run affordances can still request a run; open the launcher
  // preselected to that group (and scope) without showing the old tab bar.
  const seenNewRunRequest = useRef(newRunRequest);
  useEffect(() => {
    if (newRunRequest !== seenNewRunRequest.current) {
      seenNewRunRequest.current = newRunRequest;
      openBatchRunDialog(pendingRunGroupId, pendingRunScope);
    }
  }, [newRunRequest, pendingRunGroupId, pendingRunScope]);

  return (
    <div className="it">
      <div className="it-content">
        <SitesTab
          active={active}
          treeCollapsed={siteTreeCollapsed}
          onShowWorkspace={onShowWorkspace}
          renderSidebarHeader={({ actions, collapsed }) => (
            <ModuleHeader className="it-side-head">
              <ModuleHeaderLead className="it-head-txt">
                <ModuleIconTile module="itops">
                  <ItOpsModuleIcon size={16} />
                </ModuleIconTile>
                {collapsed ? null : (
                  <>
                    <ModuleHeaderTitle>{t("itops.title")}</ModuleHeaderTitle>
                    {actions ? <div className="it-head-actions">{actions}</div> : null}
                  </>
                )}
              </ModuleHeaderLead>
            </ModuleHeader>
          )}
        />
      </div>

      {batchDialogOpen ? (
        <BatchRunDialog
          defaultGroupId={batchDialogGroupId}
          defaultScope={batchDialogScope}
          defaultTask={pendingRunTask}
          onClose={() => setBatchDialogOpen(false)}
          onStarted={() => setBatchDialogOpen(false)}
        />
      ) : null}
      {automationPopup ? (
        <DialogShell onBackdrop={() => setAutomationPopup(null)}>
          <Sheet
            width={420}
            title={automationPopup.title}
            ariaLabel={automationPopup.title}
            footer={
              <Actions
                primary={
                  <Btn kind="primary" onClick={() => setAutomationPopup(null)}>
                    {t("watchdog.close")}
                  </Btn>
                }
              />
            }
          >
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{automationPopup.body}</p>
          </Sheet>
        </DialogShell>
      ) : null}
    </div>
  );
}
