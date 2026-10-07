import { useEffect, useId, useMemo, useRef, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { Field, Select, TextArea, TextInput } from "../../app/ui/dialog";
import { invokeCommand, isTauriRuntime, openExternalUrl } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type { Connection, ConnectionPasswordCredentialEntry } from "../../types";
import { flattenConnections } from "../workspace/connections/treeUtils";
import { customFieldLinkChoices, customFieldLinkKey, customFieldNavigationRequest, customFieldRecordValues, customFieldValueValid, parseCustomFieldNumber, CUSTOM_FIELD_LINK_KINDS, type CustomFieldCatalog } from "./customFieldModel";
import type { CustomFieldLink, CustomFieldRecordKind, CustomFieldValue, CustomFieldValues } from "./customFieldTypes";
import { useItOpsStore } from "./state";

export function useCustomFieldDraft(kind: CustomFieldRecordKind, id?: string) {
  const { t } = useTranslation();
  const notice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const editorRef = useRef<HTMLFieldSetElement>(null);
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
  function validate() {
    if (!loaded) return false;
    const invalid = fields.find((field) => !customFieldValueValid(field, values[field.id]));
    if (!invalid) return true;
    notice(t("itops.customFields.errors.invalidValue", { name: invalid.name }), { tone: "error" });
    editorRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    return false;
  }
  return { values, setValues, loaded, validate, editorRef };
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

function CustomFieldNumberInput({ value, onChange }: {
  value: CustomFieldValue | null | undefined; onChange: (value: CustomFieldValue | null) => void;
}) {
  const [draft, setDraft] = useState({ value, text: value == null ? "" : String(value) });
  return <TextInput inputMode="decimal" aria-invalid={typeof value === "string" || (typeof value === "number" && !Number.isFinite(value)) || undefined}
    value={Object.is(value, draft.value) ? draft.text : value == null ? "" : String(value)}
    onChange={(event) => {
      const text = event.currentTarget.value;
      const next = parseCustomFieldNumber(text);
      setDraft({ value: next, text });
      onChange(next);
    }} />;
}

export function CustomFieldEditor({ kind, values, onChange, editorRef }: {
  kind: CustomFieldRecordKind; values: CustomFieldValues; onChange: (values: CustomFieldValues) => void;
  editorRef?: Ref<HTMLFieldSetElement>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const definitions = useItOpsStore((state) => state.customFields.fields);
  const fields = definitions.filter((field) => field.recordKind === kind);
  const catalog = useCustomFieldCatalog(fields.some((field) => ["link", "credential"].includes(field.type)));
  const choices = useMemo(() => customFieldLinkChoices(catalog), [catalog]);
  const [linkKinds, setLinkKinds] = useState<Record<string, CustomFieldLink["kind"]>>({});
  if (fields.length === 0) return null;
  function setValue(id: string, value: CustomFieldValue | null) { onChange({ ...values, [id]: value }); }
  return <fieldset ref={editorRef} className="it-custom-field-editor kk-surface"><legend>{t("itops.customFields.heading")}</legend>
    <div className="it-custom-field-value-grid">{fields.map((field) => {
      const value = values[field.id];
      const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
      const unavailable = t("itops.customFields.unavailable");
      const invalid = !customFieldValueValid(field, value) || undefined;
      let control;
      if (field.type === "multiline") {
        control = <TextArea rows={3} aria-invalid={invalid} value={text} onChange={(event) => setValue(field.id, event.currentTarget.value || null)} />;
      } else if (field.type === "number") {
        control = <CustomFieldNumberInput value={value} onChange={(next) => setValue(field.id, next)} />;
      } else if (field.type === "boolean" || field.type === "select") {
        const selected = field.type === "boolean" ? typeof value === "boolean" ? String(value) : "" : text;
        control = <Select aria-invalid={invalid} value={selected} options={[{ value: "", label: "—" }, ...(field.type === "select" && selected && !field.options.includes(selected) ? [{ value: selected, label: selected }] : []), ...(field.type === "boolean"
          ? [{ value: "true", label: t("itops.customFields.yes") }, { value: "false", label: t("itops.customFields.no") }]
          : field.options.map((option) => ({ value: option, label: option })))]}
          onChange={(event) => { const next = event.currentTarget.value; setValue(field.id, next === "" ? null : field.type === "boolean" ? next === "true" : next); }} />;
      } else if (field.type === "credential") {
        const selected = value && typeof value === "object" && value.kind === "credential" ? value.credentialId : "";
        const options = catalog.credentials.map((entry) => ({ value: entry.id, label: [entry.label, entry.username].filter(Boolean).join(" · ") || entry.id }));
        control = <Select aria-invalid={invalid} value={selected} options={[{ value: "", label: "—" }, ...(selected && !options.some((option) => option.value === selected) ? [{ value: selected, label: unavailable }] : []), ...options]}
          onChange={(event) => setValue(field.id, event.currentTarget.value ? { kind: "credential", credentialId: event.currentTarget.value } : null)} />;
      } else if (field.type === "link") {
        const link = value && typeof value === "object" && value.kind !== "credential" ? value : null;
        const linkKind = link?.kind ?? linkKinds[field.id] ?? "connection";
        const selected = link ? customFieldLinkKey(link) : "";
        const targets = choices.filter((choice) => choice.value.kind === linkKind);
        control = <div className="it-custom-field-link-controls">
          <Field label={t("itops.customFields.linkKind")}><Select value={linkKind} options={CUSTOM_FIELD_LINK_KINDS.map((kind) => ({ value: kind, label: t(`itops.customFields.linkType.${kind}`) }))}
            onChange={(event) => { const next = event.currentTarget.value as CustomFieldLink["kind"]; setLinkKinds((current) => ({ ...current, [field.id]: next })); setValue(field.id, null); }} /></Field>
          <Field label={t("itops.customFields.linkTarget")}><Select aria-invalid={invalid} value={selected} options={[{ value: "", label: "—" }, ...(selected && !targets.some((target) => customFieldLinkKey(target.value) === selected) ? [{ value: selected, label: unavailable }] : []), ...targets.map((target) => ({ value: customFieldLinkKey(target.value), label: target.label }))]}
            onChange={(event) => setValue(field.id, targets.find((target) => customFieldLinkKey(target.value) === event.currentTarget.value)?.value ?? null)} /></Field>
        </div>;
      } else {
        control = <TextInput type={field.type === "date" ? "date" : field.type === "url" ? "url" : "text"}
          aria-invalid={invalid} value={text}
          onChange={(event) => { const next = event.currentTarget.value; setValue(field.id, next === "" ? null : next); }} />;
      }
      if (field.type === "link") return <div key={field.id} className="kk-field it-custom-field-wide" role="group" aria-labelledby={`${id}-${field.id}`}>
        <span className="kk-lbl" id={`${id}-${field.id}`}>{field.name}</span>{control}
      </div>;
      return <Field key={field.id} className={field.type === "multiline" ? "it-custom-field-wide" : undefined} label={field.name} hint={field.type === "credential" ? t("itops.customFields.credentialHint") : field.type === "url" ? t("itops.customFields.urlHint") : field.type === "number" ? t("itops.customFields.numberHint") : undefined}>{control}</Field>;
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
