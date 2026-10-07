import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, Select, TextArea, TextInput } from "../../app/ui/dialog";
import { invokeCommand, isTauriRuntime, openExternalUrl } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type { Connection, ConnectionPasswordCredentialEntry } from "../../types";
import { flattenConnections } from "../workspace/connections/treeUtils";
import { customFieldLinkChoices, customFieldLinkKey, customFieldNavigationRequest, customFieldRecordValues, customFieldValueValid, CUSTOM_FIELD_LINK_KINDS, type CustomFieldCatalog } from "./customFieldModel";
import type { CustomFieldLink, CustomFieldRecordKind, CustomFieldValue, CustomFieldValues } from "./customFieldTypes";
import { useItOpsStore } from "./state";

export function useCustomFieldDraft(kind: CustomFieldRecordKind, id?: string) {
  const snapshot = useItOpsStore((state) => state.customFields);
  const loaded = useItOpsStore((state) => state.customFieldsLoaded);
  const initialized = useRef(loaded);
  const [values, setValues] = useState<CustomFieldValues>(() => customFieldRecordValues(snapshot, kind, id));
  useEffect(() => {
    if (loaded && !initialized.current) {
      initialized.current = true;
      setValues(customFieldRecordValues(snapshot, kind, id));
    }
  }, [loaded, snapshot, kind, id]);
  const fields = snapshot.fields.filter((field) => field.recordKind === kind);
  return { values, setValues, valid: loaded && fields.every((field) => customFieldValueValid(field, values[field.id])) };
}

/** Fetch target metadata on demand; no secrets or recurring command polling. */
export function useCustomFieldCatalog(enabled: boolean): CustomFieldCatalog {
  const sites = useItOpsStore((state) => state.sites);
  const racksBySite = useItOpsStore((state) => state.racksBySite);
  const maps = useItOpsStore((state) => state.networkMaps);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [credentials, setCredentials] = useState<ConnectionPasswordCredentialEntry[]>([]);
  const rackLoads = useRef(new Set<string>());
  const notice = useWorkspaceStore((state) => state.showStatusBarNotice);
  useEffect(() => {
    if (!enabled || !isTauriRuntime()) return;
    let active = true;
    const store = useItOpsStore.getState();
    void Promise.all([
      invokeCommand("list_connection_tree"),
      invokeCommand("list_connection_password_credentials"),
      store.loaded ? Promise.resolve() : store.loadSites(),
      store.networkMapsLoaded ? Promise.resolve() : store.loadNetworkMaps(),
    ]).then(([tree, entries]) => {
      if (active) { setConnections(flattenConnections(tree)); setCredentials(entries); }
    }).catch((error: unknown) => { if (active) notice(String(error), { tone: "error" }); });
    return () => { active = false; };
  }, [enabled, notice]);
  useEffect(() => {
    if (!enabled || !isTauriRuntime()) return;
    const store = useItOpsStore.getState();
    void Promise.all(sites.filter((site) => !racksBySite[site.id] && !rackLoads.current.has(site.id)).map(async (site) => {
      rackLoads.current.add(site.id);
      try { await store.loadRacks(site.id); }
      finally { rackLoads.current.delete(site.id); }
    }))
      .catch((error: unknown) => notice(String(error), { tone: "error" }));
  }, [enabled, sites, racksBySite, notice]);
  return useMemo(() => ({ connections, credentials, sites, racksBySite, maps }), [connections, credentials, sites, racksBySite, maps]);
}

export async function navigateCustomFieldLink(link: CustomFieldLink, showWorkspace: () => void): Promise<boolean> {
  const workspace = useWorkspaceStore.getState();
  if (link.kind === "connection") {
    const connection = await invokeCommand("itops_get_connection", { id: link.connectionId });
    if (!connection) return false;
    const tab = workspace.tabs.find((tab) => tab.connection?.id === connection.id);
    if (tab) workspace.activateTab(tab.id);
    else workspace.openConnection(connection);
    showWorkspace();
    return true;
  }
  const store = useItOpsStore.getState();
  if (link.kind === "networkNode") {
    await store.loadNetworkMaps();
    if (!useItOpsStore.getState().networkMaps.some((map) => map.id === link.mapId && map.graph.nodes.some((node) => node.id === link.nodeId))) return false;
  } else {
    await store.loadSites();
    if (!useItOpsStore.getState().sites.some((site) => site.id === link.siteId)) return false;
    await store.loadRacks(link.siteId);
    const rack = useItOpsStore.getState().racksBySite[link.siteId]?.find((rack) => rack.id === link.rackId);
    if (!rack || (link.kind === "rackItem" && !rack.items.some((item) => item.id === link.rackItemId))) return false;
  }
  store.requestNavigation(customFieldNavigationRequest(link));
  return true;
}

export function CustomFieldEditor({ kind, values, onChange }: {
  kind: CustomFieldRecordKind; values: CustomFieldValues; onChange: (values: CustomFieldValues) => void;
}) {
  const { t } = useTranslation();
  const definitions = useItOpsStore((state) => state.customFields.fields);
  const fields = definitions.filter((field) => field.recordKind === kind);
  const catalog = useCustomFieldCatalog(fields.some((field) => ["link", "credential"].includes(field.type)));
  const choices = useMemo(() => customFieldLinkChoices(catalog), [catalog]);
  const [linkKinds, setLinkKinds] = useState<Record<string, CustomFieldLink["kind"]>>({});
  if (fields.length === 0) return null;
  function setValue(id: string, value: CustomFieldValue | null) { onChange({ ...values, [id]: value }); }
  return <fieldset className="it-custom-field-editor kk-surface"><legend>{t("itops.customFields.heading")}</legend>
    <div className="it-custom-field-value-grid">{fields.map((field) => {
      const value = values[field.id];
      const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
      const unavailable = t("itops.customFields.unavailable");
      let control;
      if (field.type === "multiline") {
        control = <TextArea rows={3} value={text} onChange={(event) => setValue(field.id, event.currentTarget.value || null)} />;
      } else if (field.type === "boolean" || field.type === "select") {
        const selected = field.type === "boolean" ? typeof value === "boolean" ? String(value) : "" : text;
        control = <Select value={selected} options={[{ value: "", label: "—" }, ...(field.type === "boolean"
          ? [{ value: "true", label: t("itops.customFields.yes") }, { value: "false", label: t("itops.customFields.no") }]
          : field.options.map((option) => ({ value: option, label: option })))]}
          onChange={(event) => { const next = event.currentTarget.value; setValue(field.id, next === "" ? null : field.type === "boolean" ? next === "true" : next); }} />;
      } else if (field.type === "credential") {
        const selected = value && typeof value === "object" && value.kind === "credential" ? value.credentialId : "";
        const options = catalog.credentials.map((entry) => ({ value: entry.id, label: [entry.label, entry.username].filter(Boolean).join(" · ") || entry.id }));
        control = <Select value={selected} options={[{ value: "", label: "—" }, ...(selected && !options.some((option) => option.value === selected) ? [{ value: selected, label: unavailable }] : []), ...options]}
          onChange={(event) => setValue(field.id, event.currentTarget.value ? { kind: "credential", credentialId: event.currentTarget.value } : null)} />;
      } else if (field.type === "link") {
        const link = value && typeof value === "object" && value.kind !== "credential" ? value : null;
        const linkKind = link?.kind ?? linkKinds[field.id] ?? "connection";
        const selected = link ? customFieldLinkKey(link) : "";
        const targets = choices.filter((choice) => choice.value.kind === linkKind);
        control = <div className="it-custom-field-link-controls">
          <Select aria-label={t("itops.customFields.linkKind")} value={linkKind} options={CUSTOM_FIELD_LINK_KINDS.map((kind) => ({ value: kind, label: t(`itops.customFields.linkType.${kind}`) }))}
            onChange={(event) => { const next = event.currentTarget.value as CustomFieldLink["kind"]; setLinkKinds((current) => ({ ...current, [field.id]: next })); setValue(field.id, null); }} />
          <Select aria-label={t("itops.customFields.linkTarget")} value={selected} options={[{ value: "", label: "—" }, ...(selected && !targets.some((target) => customFieldLinkKey(target.value) === selected) ? [{ value: selected, label: unavailable }] : []), ...targets.map((target) => ({ value: customFieldLinkKey(target.value), label: target.label }))]}
            onChange={(event) => setValue(field.id, targets.find((target) => customFieldLinkKey(target.value) === event.currentTarget.value)?.value ?? null)} />
        </div>;
      } else {
        control = <TextInput type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "url" ? "url" : "text"}
          step={field.type === "number" ? "any" : undefined} value={text}
          onChange={(event) => { const next = event.currentTarget.value; setValue(field.id, next === "" ? null : field.type === "number" ? Number(next) : next); }} />;
      }
      return <Field key={field.id} className={["multiline", "link"].includes(field.type) ? "it-custom-field-wide" : undefined} label={field.name} hint={field.type === "credential" ? t("itops.customFields.credentialHint") : field.type === "url" ? t("itops.customFields.urlHint") : undefined}>{control}</Field>;
    })}</div>
  </fieldset>;
}

export function CustomFieldSummary({ kind, recordId, catalog, onNavigate }: {
  kind: CustomFieldRecordKind; recordId: string; catalog: CustomFieldCatalog; onNavigate: (link: CustomFieldLink) => void;
}) {
  const { t } = useTranslation();
  const snapshot = useItOpsStore((state) => state.customFields);
  const notice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const values = customFieldRecordValues(snapshot, kind, recordId);
  const choices = customFieldLinkChoices(catalog);
  const populated = snapshot.fields.filter((field) => field.recordKind === kind && values[field.id] != null);
  if (populated.length === 0) return null;
  return <span className="it-custom-field-summary">{populated.map((field) => {
    const value = values[field.id]!;
    let display = String(value);
    let link: CustomFieldLink | null = null;
    if (typeof value === "boolean") display = t(value ? "itops.customFields.yes" : "itops.customFields.no");
    else if (typeof value === "object") {
      if (value.kind === "credential") {
        const entry = catalog.credentials.find((entry) => entry.id === value.credentialId);
        display = entry ? [entry.label, entry.username].filter(Boolean).join(" · ") : t("itops.customFields.unavailable");
      } else {
        const target = choices.find((choice) => customFieldLinkKey(choice.value) === customFieldLinkKey(value));
        display = target?.label ?? t("itops.customFields.unavailable");
        if (target) link = value;
      }
    }
    return <span className="it-custom-field-chip" key={field.id} title={`${field.name}: ${display}`}><b>{field.name}:</b>{link
      ? <button type="button" data-preserve-content-focus="true" onClick={() => onNavigate(link!)}>{display}</button>
      : field.type === "url" && typeof value === "string" && customFieldValueValid(field, value)
        ? <button type="button" data-preserve-content-focus="true" onClick={() => void openExternalUrl(value).catch((error: unknown) => notice(String(error), { tone: "error" }))}>{display}</button> : <span>{display}</span>}</span>;
  })}</span>;
}
