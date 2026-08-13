import type { RunHistoryEntry, SiteHost } from "../../types";
import type { LiveRun, LiveRunHostStatus } from "./state";

export interface HostRunStatus {
  current: LiveRunHostStatus | null;
  last: "ok" | "failed" | null;
}

/** Match live and persisted Batch Run results back to Hosts through their
 * ordered Connection bindings. Run History is newest-first. */
export function hostRunStatuses(
  hosts: SiteHost[],
  siteId: string,
  activeRun: LiveRun | null,
  runHistory: RunHistoryEntry[],
): Map<string, HostRunStatus> {
  const currentByConnection = new Map<string, LiveRunHostStatus>();
  const currentByHost = new Map<string, LiveRunHostStatus>();
  if (activeRun?.state === "running" && activeRun.siteId === siteId) {
    for (const host of activeRun.hosts) {
      currentByConnection.set(host.connectionId, host.status);
      if (host.hostId) currentByHost.set(host.hostId, host.status);
    }
  }

  return new Map(
    hosts.map((host) => {
      const currentConnection = host.connectionIds.find((id) => currentByConnection.has(id));
      const connectionIds = new Set(host.connectionIds);
      const lastReport = runHistory
        .filter((run) => run.siteId === siteId)
        .flatMap((run) => run.report.hosts)
        .find((report) => report.hostId === host.id || connectionIds.has(report.connectionId));
      return [
        host.id,
        {
          current: currentByHost.get(host.id) ?? (currentConnection ? (currentByConnection.get(currentConnection) ?? null) : null),
          last: lastReport ? (lastReport.ok ? "ok" : "failed") : null,
        },
      ];
    }),
  );
}
