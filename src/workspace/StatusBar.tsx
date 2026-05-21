import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Cpu,
  LoaderCircle,
  MemoryStick,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AiCodingUsageStatusBar } from "../ai-coding-usage/AiCodingUsageStatusBar";
import { useWorkspaceStore } from "../store";
import { WatchdogStatusBar } from "../watchdog/WatchdogStatusBar";

const NOTIFICATION_FADE_MS = 220;

export function StatusBar({
  onOpenAssistant,
  onOpenDashboardView,
}: {
  onOpenAssistant: () => void;
  onOpenDashboardView: (viewId: string) => void;
}) {
  const { t } = useTranslation();
  const notice = useWorkspaceStore((state) => state.statusBarNotice);
  const clearStatusBarNotice = useWorkspaceStore((state) => state.clearStatusBarNotice);
  const [renderedNotice, setRenderedNotice] = useState(notice);
  const [isNoticeExiting, setIsNoticeExiting] = useState(false);

  useEffect(() => {
    if (!notice) {
      return;
    }
    setRenderedNotice(notice);
    setIsNoticeExiting(false);
    const remainingMs = Math.max(0, notice.expiresAt - Date.now());
    const fadeDelayMs = Math.max(0, remainingMs - NOTIFICATION_FADE_MS);
    const fadeTimeout = window.setTimeout(() => setIsNoticeExiting(true), fadeDelayMs);
    const clearTimeout = window.setTimeout(() => clearStatusBarNotice(notice.id), remainingMs);
    return () => {
      window.clearTimeout(fadeTimeout);
      window.clearTimeout(clearTimeout);
    };
  }, [clearStatusBarNotice, notice]);

  useEffect(() => {
    if (notice) {
      return;
    }
    if (!isNoticeExiting) {
      setRenderedNotice(undefined);
      return;
    }
    const timeout = window.setTimeout(() => {
      setRenderedNotice(undefined);
      setIsNoticeExiting(false);
    }, NOTIFICATION_FADE_MS);
    return () => window.clearTimeout(timeout);
  }, [isNoticeExiting, notice]);

  return (
    <footer className="status-bar">
      <div className="status-bar-module">
        <WorkspaceHostMetrics t={t} />
        <AiCodingUsageStatusBar onOpenDashboardView={onOpenDashboardView} />
      </div>
      <div className="status-bar-notice-area">
        {renderedNotice ? (
          <span
            className={`status-notification ${renderedNotice.tone} ${
              isNoticeExiting ? "is-exiting" : "is-entering"
            }`}
            role="status"
          >
            {renderedNotice.message}
          </span>
        ) : null}
      </div>
      <div className="status-bar-actions">
        <WatchdogStatusBar />
        <AssistantWorkingStatusButton onOpenAssistant={onOpenAssistant} />
      </div>
    </footer>
  );
}

function AssistantWorkingStatusButton({
  onOpenAssistant,
}: {
  onOpenAssistant: () => void;
}) {
  const { t } = useTranslation();
  const assistantWorking = useWorkspaceStore((state) => state.assistantWorking);

  if (!assistantWorking) {
    return null;
  }

  return (
    <button
      className="status-bar-action status-bar-assistant-working"
      aria-label={t("app.aiAssistant")}
      aria-describedby="assistant-working-status-tooltip"
      onClick={onOpenAssistant}
      type="button"
    >
      <LoaderCircle size={14} />
      <span className="status-bar-tooltip" id="assistant-working-status-tooltip" role="tooltip">
        {t("app.aiAssistant")}
      </span>
    </button>
  );
}

function WorkspaceHostMetrics({ t }: { t: (key: string) => string }) {
  const hostUsage = useWorkspaceStore((state) => state.performanceMetrics.hostUsage);

  return (
    <div className="host-metrics" aria-label={t("workspace.hostUsage")}>
      <Metric
        icon={<Cpu size={13} />}
        label={t("workspace.cpu")}
        metric="percent"
        title={t("workspace.cpuUsage")}
        value={formatPercent(hostUsage?.cpuPercent)}
      />
      <Metric
        icon={<MemoryStick size={13} />}
        label={t("workspace.ram")}
        metric="percent"
        title={t("workspace.ramUsage")}
        value={formatPercent(hostUsage?.ramPercent)}
      />
      <NetworkMetric
        downstreamLabel={t("workspace.networkDownstream")}
        downstreamTitle={t("workspace.networkDownstreamUsage")}
        downstreamValue={formatNetwork(hostUsage?.networkDownstreamBytesPerSecond)}
        title={t("workspace.networkUsage")}
        upstreamLabel={t("workspace.networkUpstream")}
        upstreamTitle={t("workspace.networkUpstreamUsage")}
        upstreamValue={formatNetwork(hostUsage?.networkUpstreamBytesPerSecond)}
      />
    </div>
  );
}

function Metric({
  icon,
  label,
  metric,
  title,
  value,
}: {
  icon: ReactNode;
  label: string;
  metric: "network" | "percent";
  title: string;
  value: string;
}) {
  return (
    <span className={`host-metric host-metric-${metric}`} aria-label={`${label} ${value}`} title={title}>
      {icon}
      <strong className="host-metric-value">{value}</strong>
    </span>
  );
}

function NetworkMetric({
  downstreamLabel,
  downstreamTitle,
  downstreamValue,
  title,
  upstreamLabel,
  upstreamTitle,
  upstreamValue,
}: {
  downstreamLabel: string;
  downstreamTitle: string;
  downstreamValue: string;
  title: string;
  upstreamLabel: string;
  upstreamTitle: string;
  upstreamValue: string;
}) {
  return (
    <span
      className="host-metric host-metric-network"
      aria-label={`${downstreamLabel} ${downstreamValue}, ${upstreamLabel} ${upstreamValue}`}
      title={title}
    >
      <span className="host-metric-transfer" title={downstreamTitle}>
        <ArrowDownToLine size={13} />
        <strong className="host-metric-value">{downstreamValue}</strong>
      </span>
      <span className="host-metric-transfer" title={upstreamTitle}>
        <ArrowUpFromLine size={13} />
        <strong className="host-metric-value">{upstreamValue}</strong>
      </span>
    </span>
  );
}

function formatPercent(value: number | undefined) {
  if (value === undefined) {
    return "--%";
  }
  return `${Math.round(value)}%`;
}

function formatNetwork(bytesPerSecond: number | undefined) {
  if (bytesPerSecond === undefined) {
    return "-- MB/s";
  }
  const mb = bytesPerSecond / 1_000_000;
  if (mb < 10) {
    return `${mb.toFixed(1)} MB/s`;
  }
  if (mb < 100) {
    return `${Math.round(mb)} MB/s`;
  }
  return `${Math.min(9999, Math.round(mb))} MB/s`;
}
