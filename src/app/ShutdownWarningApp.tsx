import { listen } from "@tauri-apps/api/event";
import { Power, Timer } from "../lib/reicon";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invokeCommand } from "../lib/tauri";
import { Btn } from "./ui/dialog";
import {
  formatShutdownTimerRemaining,
  type ShutdownTimerStatus,
} from "./shutdownTimerModel";

export function ShutdownWarningApp() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ShutdownTimerStatus | null>(null);
  const [nowUnixMs, setNowUnixMs] = useState(Date.now());
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    void invokeCommand("get_shutdown_timer_status").then(setStatus).catch(() => undefined);
    const unlistenPromise = listen<ShutdownTimerStatus | null>(
      "kkterm://shutdown-timer-changed",
      (event) => setStatus(event.payload),
    );
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNowUnixMs(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  async function cancelShutdown() {
    if (cancelling) {
      return;
    }
    setCancelling(true);
    try {
      await invokeCommand("cancel_shutdown_timer");
    } finally {
      setCancelling(false);
    }
  }

  if (!status || status.phase !== "warning") {
    return <main className="shutdown-warning-window" aria-hidden="true" />;
  }

  const remaining = formatShutdownTimerRemaining(status, nowUnixMs);

  return (
    <main className="shutdown-warning-window">
      <section className="shutdown-warning-card" role="alertdialog" aria-modal="true">
        <span className="shutdown-warning-icon" aria-hidden="true">
          <Power size={24} />
        </span>
        <div className="shutdown-warning-copy">
          <h1>{t("app.shutdownTimerWarningTitle")}</h1>
          <p>{t("app.shutdownTimerWarningMessage")}</p>
          <span className="shutdown-warning-countdown" aria-live="polite">
            <Timer size={14} aria-hidden="true" />
            {t("app.shutdownTimerCountdown", { time: remaining })}
          </span>
        </div>
        <Btn
          className="shutdown-warning-cancel"
          disabled={cancelling}
          onClick={() => void cancelShutdown()}
        >
          {t("app.shutdownTimerWarningCancel")}
        </Btn>
      </section>
    </main>
  );
}
