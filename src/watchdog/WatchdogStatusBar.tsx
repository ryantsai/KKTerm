import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Eye, X, CheckCircle2, AlertTriangle, Circle } from "lucide-react";
import {
  useWatchdogActiveCount,
  useWatchdogStore,
  useWatchdogSubscription,
  useWatchdogSummariesSorted,
  useWatchdogTotalCount,
} from "./store";
import { isTerminalState, type WatchdogState, type WatchdogSummary } from "./types";
import { WatchdogDetail } from "./WatchdogDetail";

/// Top-level. Mount inside `.status-bar-actions`. Renders nothing when no
/// watchdogs exist (active or terminal-undismissed) — keeps the status bar
/// quiet for users who don't use the feature.
export function WatchdogStatusBar() {
  useWatchdogSubscription();
  const total = useWatchdogTotalCount();
  const active = useWatchdogActiveCount();
  const popoverOpen = useWatchdogStore((s) => s.popoverOpen);
  const togglePopover = useWatchdogStore((s) => s.togglePopover);
  const setPopoverOpen = useWatchdogStore((s) => s.setPopoverOpen);
  const selectedId = useWatchdogStore((s) => s.selectedId);
  const setSelected = useWatchdogStore((s) => s.setSelected);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const { t } = useTranslation();

  // Click outside closes the popover. Detail dialog is rendered into the
  // same hierarchy below so clicking it counts as inside.
  useEffect(() => {
    if (!popoverOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setPopoverOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [popoverOpen, setPopoverOpen]);

  if (total === 0) {
    return null;
  }

  const allDone = active === 0;
  const label = t("watchdog.statusBarLabel", { count: total });

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`status-bar-action watchdog-status-button${allDone ? " is-all-done" : ""}`}
        aria-label={label}
        aria-expanded={popoverOpen}
        onClick={togglePopover}
        title={label}
      >
        {allDone ? <CheckCircle2 size={14} /> : <Eye size={14} />}
        {total > 0 ? <span className="watchdog-status-badge">{total}</span> : null}
      </button>
      {popoverOpen ? (
        <div ref={popoverRef} className="watchdog-popover" role="dialog" aria-label={label}>
          <WatchdogPopoverList onSelect={(id) => setSelected(id)} />
        </div>
      ) : null}
      {selectedId ? (
        <WatchdogDetail id={selectedId} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}

function WatchdogPopoverList({ onSelect }: { onSelect: (id: string) => void }) {
  const summaries = useWatchdogSummariesSorted();
  const { t } = useTranslation();
  if (summaries.length === 0) {
    return <div className="watchdog-popover-empty">{t("watchdog.empty")}</div>;
  }
  return (
    <ul className="watchdog-popover-list">
      {summaries.map((s) => (
        <WatchdogPopoverRow key={s.id} summary={s} onSelect={onSelect} />
      ))}
    </ul>
  );
}

function WatchdogPopoverRow({
  summary,
  onSelect,
}: {
  summary: WatchdogSummary;
  onSelect: (id: string) => void;
}) {
  const cancel = useWatchdogStore((s) => s.cancel);
  const dismiss = useWatchdogStore((s) => s.dismiss);
  const { t } = useTranslation();
  const terminal = isTerminalState(summary.state);

  return (
    <li className="watchdog-popover-row">
      <button
        type="button"
        className="watchdog-popover-row-main"
        onClick={() => onSelect(summary.id)}
        aria-label={t("watchdog.openDetail", { name: summary.name })}
      >
        <WatchdogStateIcon state={summary.state} />
        <span className="watchdog-popover-row-text">
          <span className="watchdog-popover-row-name">{summary.name}</span>
          <span className="watchdog-popover-row-meta">
            <WatchdogStateLabel state={summary.state} /> · {formatLastValue(summary.lastValue)}
            {summary.triggerCount > 0
              ? ` · ${t("watchdog.triggersCount", { count: summary.triggerCount })}`
              : ""}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="watchdog-popover-row-action"
        onClick={(e) => {
          e.stopPropagation();
          if (terminal) {
            dismiss(summary.id);
          } else {
            void cancel(summary.id);
          }
        }}
        aria-label={terminal ? t("watchdog.dismiss") : t("watchdog.cancel")}
        title={terminal ? t("watchdog.dismiss") : t("watchdog.cancel")}
      >
        <X size={12} />
      </button>
    </li>
  );
}

export function WatchdogStateIcon({ state }: { state: WatchdogState }) {
  switch (state.kind) {
    case "armed":
    case "running":
      return <Circle size={12} className="watchdog-state-icon is-running" />;
    case "triggered":
      return <AlertTriangle size={12} className="watchdog-state-icon is-triggered" />;
    case "intervening":
    case "suppressed":
      return <Circle size={12} className="watchdog-state-icon is-intervening" />;
    case "completed":
      return <CheckCircle2 size={12} className="watchdog-state-icon is-completed" />;
    case "canceled":
      return <X size={12} className="watchdog-state-icon is-canceled" />;
    case "error":
      return <AlertTriangle size={12} className="watchdog-state-icon is-error" />;
    default:
      return null;
  }
}

export function WatchdogStateLabel({ state }: { state: WatchdogState }) {
  const { t } = useTranslation();
  return <>{t(`watchdog.state.${state.kind}`)}</>;
}

function formatLastValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "number") {
    // Heuristics: percent-like ≤100 keeps one decimal; bigger numbers use
    // SI-ish formatting so RAM/network values stay readable.
    if (Math.abs(value) < 100) {
      return value.toFixed(1);
    }
    if (Math.abs(value) < 1_000_000) {
      return Math.round(value).toLocaleString();
    }
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (typeof value === "string") {
    return value.length > 24 ? value.slice(0, 24) + "…" : value;
  }
  return JSON.stringify(value);
}

export { formatLastValue };
