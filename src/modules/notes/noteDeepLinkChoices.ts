import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Fuse from "fuse.js";
import { invokeCommand } from "../../lib/tauri";
import { useItOpsStore } from "../itops/state";
import { useWorkspaceStore } from "../../store";
import type { NoteDeepLink } from "./noteDeepLink";

export interface NoteDeepLinkChoice {
  key: string;
  label: string;
  detail: string;
  link: NoteDeepLink;
}

/** Longest list either Deep Link surface renders at once. Both the picker and
 *  the `@` menu are keyboard-driven, so an unbounded list only costs scrolling. */
export const NOTE_DEEP_LINK_RESULT_LIMIT = 50;

/** Rank Deep Link targets for a query. An empty query keeps source order —
 *  Connections first — so the `@` menu opens on something useful before the
 *  user has typed anything. */
export function filterNoteDeepLinkChoices(
  choices: NoteDeepLinkChoice[],
  query: string,
  limit = NOTE_DEEP_LINK_RESULT_LIMIT,
): NoteDeepLinkChoice[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return choices.slice(0, limit);
  }
  const fuse = new Fuse(choices, { keys: ["label", "detail"], threshold: 0.35 });
  return fuse
    .search(trimmed)
    .slice(0, limit)
    .map((result) => result.item);
}

/** Every Deep Link target a note can point at: Connections across *all*
 *  Workspaces, the Workspaces themselves, and IT Ops rack devices. Shared by
 *  the toolbar picker and the `@` trigger menu so the two never drift. */
export function useNoteDeepLinkChoices(): NoteDeepLinkChoice[] {
  const { t } = useTranslation();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const sites = useItOpsStore((state) => state.sites);
  const racksBySite = useItOpsStore((state) => state.racksBySite);
  const [connections, setConnections] = useState<NoteDeepLinkChoice[]>([]);

  // The Connection tree in the store is scoped to the active Workspace, so the
  // full cross-Workspace list is read from the backend instead.
  useEffect(() => {
    let cancelled = false;
    void invokeCommand("list_connection_tree", undefined)
      .then((tree) => {
        if (cancelled) return;
        const collected: NoteDeepLinkChoice[] = [];
        const walk = (node: { connections?: unknown[]; folders?: unknown[] }) => {
          (node.connections as { id: string; name: string; host?: string }[] | undefined)?.forEach(
            (connection) => {
              collected.push({
                key: `connection:${connection.id}`,
                label: connection.name,
                detail: connection.host || t("notes.deepLink.kind.connection"),
                link: { kind: "connection", connectionId: connection.id },
              });
            },
          );
          (node.folders as { connections?: unknown[]; folders?: unknown[] }[] | undefined)?.forEach(
            walk,
          );
        };
        walk(tree as { connections?: unknown[]; folders?: unknown[] });
        setConnections(collected);
      })
      .catch(() => {
        if (!cancelled) setConnections([]);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  return useMemo(() => {
    const workspaceChoices: NoteDeepLinkChoice[] = workspaces.map((workspace) => ({
      key: `workspace:${workspace.id}`,
      label: workspace.name,
      detail: t("notes.deepLink.kind.workspace"),
      link: { kind: "workspace", workspaceId: workspace.id },
    }));
    const rackChoices: NoteDeepLinkChoice[] = [];
    sites.forEach((site) => {
      (racksBySite[site.id] ?? []).forEach((rack) => {
        rack.items.forEach((item) => {
          rackChoices.push({
            key: `rackItem:${site.id}:${rack.id}:${item.id}`,
            label: item.label || t(`itops.racks.kind.${item.kind}`),
            detail: `${site.name} · ${rack.name}`,
            link: {
              kind: "rackItem",
              siteId: site.id,
              rackId: rack.id,
              rackItemId: item.id,
            },
          });
        });
      });
    });
    return [...connections, ...workspaceChoices, ...rackChoices];
  }, [connections, workspaces, sites, racksBySite, t]);
}
