import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Actions, Btn, DialogShell, Sheet } from "../app/ui/dialog";
import { useWatchdogStore } from "./store";
import type { WatchdogInterventionEntry } from "./store";
import { isTerminalState } from "./types";
import type {
  WatchdogAction,
  WatchdogNotification,
  WatchdogState,
  WatchdogStop,
  WatchdogTarget,
  WatchdogTick,
} from "./types";
import {
  WatchdogStateIcon,
  WatchdogStateLabel,
  formatLastValue,
} from "./WatchdogStatusBar";

/// Detail dialog. Listens to live tick events through the store, so the
/// sparkline animates while open.
export function WatchdogDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const summary = useWatchdogStore((s) => s.summaries[id]);
  const ticks = useWatchdogStore((s) => s.ticks[id]);
  const triggers = useWatchdogStore((s) => s.triggers[id]);
  const interventions = useWatchdogStore((s) => s.interventions[id]);
  const report = useWatchdogStore((s) => s.reports[id]);
  const aiSummary = useWatchdogStore((s) => s.aiSummaries[id]);
  const summaryInFlight = useWatchdogStore((s) => Boolean(s.summaryInFlight[id]));
  const cancel = useWatchdogStore((s) => s.cancel);
  const dismiss = useWatchdogStore((s) => s.dismiss);
  const generateSummary = useWatchdogStore((s) => s.generateSummary);
  const saveReport = useWatchdogStore((s) => s.saveReport);
  const refreshWatchdog = useWatchdogStore((s) => s.refreshWatchdog);

  // Escape closes the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    void refreshWatchdog(id);
  }, [id, refreshWatchdog]);

  if (!summary) {
    // Dismissed mid-render — close cleanly.
    onClose();
    return null;
  }

  const terminal = isTerminalState(summary.state);

  return (
    <DialogShell onBackdrop={onClose}>
      <Sheet
        width={500}
        className="watchdog-detail"
        ariaLabel={summary.name}
        rule
        title={
          <span className="watchdog-detail-title">
            <span className="watchdog-detail-title-main">
              <WatchdogStateIcon state={summary.state} />
              <span className="watchdog-detail-name">{summary.name}</span>
            </span>
            <span className="watchdog-detail-state">
              <WatchdogStateLabel state={summary.state} />
            </span>
          </span>
        }
        footer={
          <Actions
            extraLeft={
              <Btn icon="download" onClick={() => void saveReport(id)}>
                {t("watchdog.saveReport")}
              </Btn>
            }
            primary={
              terminal ? (
                <Btn
                  kind="primary"
                  icon="check"
                  onClick={() => {
                    dismiss(id);
                    onClose();
                  }}
                >
                  {t("watchdog.completedAction")}
                </Btn>
              ) : (
                <Btn kind="danger" onClick={() => void cancel(id)}>
                  {t("watchdog.cancel")}
                </Btn>
              )
            }
            cancel={
              terminal ? undefined : <Btn onClick={onClose}>{t("watchdog.close")}</Btn>
            }
          />
        }
      >
        <section className="watchdog-detail-chart">
          <h3>{t("watchdog.detail.sparkline")}</h3>
          <Sparkline ticks={ticks ?? []} />
        </section>
        <dl className="watchdog-detail-stats">
          <Stat label={t("watchdog.detail.elapsed")} value={formatElapsed(summary.createdAt)} />
          <Stat
            label={t("watchdog.detail.nextCheck")}
            value={formatNextCheck(summary.state, summary.pollMs, ticks ?? [])}
          />
          <Stat
            label={t("watchdog.detail.lastValue")}
            value={formatLastValue(summary.lastValue)}
          />
          <Stat label={t("watchdog.detail.polls")} value={String(summary.pollCount)} />
          <Stat label={t("watchdog.detail.triggers")} value={String(summary.triggerCount)} />
          <Stat
            label={t("watchdog.detail.interval")}
            value={`${(summary.pollMs / 1000).toFixed(1)}s`}
          />
          {report ? (
            <>
              <Stat
                label={t("watchdog.detail.watchSummary")}
                value={describeTarget(report.config.target, t)}
              />
              <Stat
                label={t("watchdog.detail.exitCondition")}
                value={describeStop(report.config.stop, t)}
              />
              <Stat
                label={t("watchdog.detail.notificationMethod")}
                value={describeNotification(report.config.notification, t)}
              />
              <Stat
                label={t("watchdog.detail.actionMode")}
                value={describeAction(report.config.action, t)}
              />
            </>
          ) : null}
        </dl>
        <TriggerList triggers={triggers ?? []} />
        <InterventionList interventions={interventions ?? []} />
        <SummarySection
          summary={aiSummary}
          inFlight={summaryInFlight}
          onGenerate={() => void generateSummary(id)}
        />
      </Sheet>
    </DialogShell>
  );
}

function formatElapsed(createdAt: number) {
  return formatDuration(Date.now() - createdAt);
}

function formatNextCheck(state: WatchdogState, pollMs: number, ticks: WatchdogTick[]) {
  if (isTerminalState(state)) {
    return "—";
  }
  // The `Running` state's `lastPollAt` is only stamped once at startup, so the
  // last observed tick is the accurate anchor for the next poll. Fall back to
  // the state field (then now) before any tick has arrived.
  const lastTickAt = ticks.length > 0 ? ticks[ticks.length - 1].at : undefined;
  const lastPollAt =
    lastTickAt ?? ("lastPollAt" in state ? state.lastPollAt : Date.now());
  return formatDuration(Math.max(0, lastPollAt + pollMs - Date.now()));
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

function describeTarget(target: WatchdogTarget, t: (key: string, options?: Record<string, unknown>) => string) {
  switch (target.kind) {
    case "performanceCounter":
      return t("watchdog.detail.targetPerformance", { metric: target.metric });
    case "sshSessionOutputSilence":
      return t("watchdog.detail.targetSshSilence");
    case "ping":
      return t("watchdog.detail.targetPing", { host: target.host });
    case "tcpReachable":
      return t("watchdog.detail.targetTcp", { host: target.host, port: target.port });
    case "schedule":
      return t("watchdog.detail.targetSchedule", { cron: target.cron });
    case "logFile":
      return t("watchdog.detail.targetLogFile", { path: target.path, pattern: target.pattern });
    case "outputMatch":
      return t("watchdog.detail.targetOutputMatch", { pattern: target.pattern });
    case "mock":
      return t("watchdog.detail.targetMock");
  }
}

function describeStop(stop: WatchdogStop, t: (key: string, options?: Record<string, unknown>) => string) {
  switch (stop.kind) {
    case "afterDuration":
      return t("watchdog.detail.stopAfterDuration", { duration: formatDuration(stop.ms) });
    case "afterTriggerCount":
      return t("watchdog.detail.stopAfterTriggerCount", { count: stop.n });
    case "afterFirstTrigger":
      return t("watchdog.detail.stopAfterFirstTrigger");
    case "afterPollCount":
      return t("watchdog.detail.stopAfterPollCount", { count: stop.n });
    case "untilCanceled":
      return t("watchdog.detail.stopUntilCanceled");
  }
}

function describeNotification(
  notification: WatchdogNotification,
  t: (key: string) => string,
) {
  return t(`watchdog.detail.notification.${notification}`);
}

function describeAction(action: WatchdogAction, t: (key: string) => string) {
  return t(`watchdog.detail.action.${action.kind}`);
}

function SummarySection({
  summary,
  inFlight,
  onGenerate,
}: {
  summary: { text: string; generatedAt: number } | undefined;
  inFlight: boolean;
  onGenerate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="watchdog-detail-summary">
      <div className="watchdog-detail-summary-header">
        <h4>{t("watchdog.detail.aiSummary")}</h4>
        <Btn
          sm
          icon={summary ? "refresh" : "wand"}
          className="watchdog-detail-summary-button"
          onClick={onGenerate}
          disabled={inFlight}
        >
          {inFlight
            ? t("watchdog.detail.summarizing")
            : summary
              ? t("watchdog.detail.regenerate")
              : t("watchdog.detail.summarize")}
        </Btn>
      </div>
      {summary ? (
        <p className="watchdog-detail-summary-text">{summary.text}</p>
      ) : (
        <p className="watchdog-detail-summary-empty">
          {t("watchdog.detail.summaryEmpty")}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="watchdog-detail-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/// SVG sparkline of the last N numeric ticks. Non-numeric values
/// (string/null) are ignored — the line just skips them.
function Sparkline({ ticks }: { ticks: WatchdogTick[] }) {
  const { t } = useTranslation();
  const points = useMemo(() => {
    return ticks
      .map((tick) => (typeof tick.value === "number" ? tick.value : null))
      .filter((v): v is number => v !== null);
  }, [ticks]);

  if (points.length < 2) {
    return <div className="watchdog-detail-sparkline-empty">{t("watchdog.detail.notEnoughData")}</div>;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const width = 320;
  const height = 64;
  const step = width / (points.length - 1);
  const yForValue = (value: number) =>
    span === 0 ? height / 2 : height - ((value - min) / span) * height;

  const path = points
    .map((value, i) => {
      const x = i * step;
      const y = yForValue(value);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const lastY = yForValue(points[points.length - 1]);

  return (
    <svg
      className="watchdog-detail-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={t("watchdog.detail.sparkline")}
    >
      <path d={path} className="watchdog-detail-sparkline-line" />
      <circle
        cx={width}
        cy={lastY}
        r={2.5}
        className="watchdog-detail-sparkline-tip"
      />
    </svg>
  );
}

function InterventionList({
  interventions,
}: {
  interventions: WatchdogInterventionEntry[];
}) {
  const { t } = useTranslation();
  if (interventions.length === 0) {
    return null;
  }
  return (
    <div className="watchdog-detail-interventions">
      <h4>{t("watchdog.detail.interventions")}</h4>
      <ul>
        {interventions
          .slice(-6)
          .reverse()
          .map((entry) => (
            <li
              key={entry.interventionId}
              className={
                entry.inFlight
                  ? "is-in-flight"
                  : entry.ok
                    ? "is-ok"
                    : "is-error"
              }
            >
              <span className="watchdog-detail-intervention-time">
                {new Date(entry.at).toLocaleTimeString()}
              </span>
              <span className="watchdog-detail-intervention-summary">
                {entry.summary}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}

function TriggerList({ triggers }: { triggers: { at: number; valueAtTrigger: unknown }[] }) {
  const { t } = useTranslation();
  if (triggers.length === 0) {
    return null;
  }
  return (
    <div className="watchdog-detail-triggers">
      <h4>{t("watchdog.detail.triggerEvents")}</h4>
      <ul>
        {triggers.slice(-8).reverse().map((trig, i) => (
          <li key={`${trig.at}-${i}`}>
            <span className="watchdog-detail-trigger-time">
              {new Date(trig.at).toLocaleTimeString()}
            </span>
            <span className="watchdog-detail-trigger-value">
              {formatLastValue(trig.valueAtTrigger)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
