import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { invokeCommand, isTauriRuntime, openExternalUrl } from "../lib/tauri";
import { useWorkspaceStore } from "../store";
import { ConfirmSheet } from "./ui/dialog";

const STORE_TRIAL_STATUS_EVENT = "kkterm://store-trial-status";
const MICROSOFT_STORE_URL = "https://apps.microsoft.com/detail/9nvqc5cnwwjk";

export function StoreLicensePrompt({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [trialExpired, setTrialExpired] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!enabled || !isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listen<boolean>(STORE_TRIAL_STATUS_EVENT, ({ payload }) => {
        if (!disposed) {
          setTrialExpired(payload);
          setDismissed(false);
        }
      });
      const expired = await invokeCommand("get_store_trial_expired");
      if (!disposed && expired !== null) {
        setTrialExpired(expired);
      }
    })().catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [enabled]);

  if (!trialExpired || dismissed) {
    return null;
  }

  async function openStoreListing() {
    try {
      await openExternalUrl(MICROSOFT_STORE_URL);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("app.storePurchaseOpenFailed", { message }), { tone: "error" });
    }
  }

  return (
    <ConfirmSheet
      tone="info"
      icon="clock"
      title={t("app.storeTrialExpiredTitle")}
      message={t("app.storeTrialExpiredMessage")}
      confirmLabel={t("app.storePurchaseAction")}
      confirmIcon="globe"
      cancelLabel={t("common.close")}
      onConfirm={() => void openStoreListing()}
      onCancel={() => setDismissed(true)}
    />
  );
}
