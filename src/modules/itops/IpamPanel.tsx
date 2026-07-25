import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Actions,
  Btn,
  ConfirmSheet,
  DialogShell,
  Field,
  Select,
  Sheet,
  TextArea,
  TextInput,
} from "../../app/ui/dialog";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type {
  AddressStatus,
  Connection,
  IpAddressRecord,
  IpamPrefixNode,
  PrefixStatus,
  SiteHost,
} from "../../types";
import { flattenConnections } from "../workspace/connections/treeUtils";
import { ItIcon } from "./icons";
import { ItOpsEmptyHint } from "./ItOpsEmptyHint";
import {
  addressesInPrefix,
  collectClaimCandidates,
  filterPrefixTree,
  previewCidr,
  utilizationTone,
  type ClaimCandidate,
} from "./ipamModel";
import { useItOpsStore, type AddressInput, type PrefixInput } from "./state";

const PREFIX_STATUSES: PrefixStatus[] = ["container", "active", "reserved", "deprecated"];
const ADDRESS_STATUSES: AddressStatus[] = ["active", "reserved", "deprecated"];

/** The default routing table shows as a placeholder rather than an empty cell. */
function vrfLabel(vrf: string, fallback: string): string {
  return vrf.trim() || fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A themed fill bar. The tone is a data attribute so the palette lives in CSS. */
function UtilizationMeter({ value, label }: { value: number; label: string }) {
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <span className="it-ipam-meter" title={label}>
      <span className="it-ipam-meter-track">
        <span
          className="it-ipam-meter-fill"
          data-tone={utilizationTone(value)}
          style={{ width: `${percent}%` }}
        />
      </span>
      <small>{percent}%</small>
    </span>
  );
}

function PrefixDialog({
  prefix,
  onClose,
}: {
  prefix: IpamPrefixNode | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createPrefix = useItOpsStore((state) => state.createPrefix);
  const updatePrefix = useItOpsStore((state) => state.updatePrefix);
  const sites = useItOpsStore((state) => state.sites);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [cidr, setCidr] = useState(prefix?.cidr ?? "");
  const [vrf, setVrf] = useState(prefix?.vrf ?? "");
  const [role, setRole] = useState(prefix?.role ?? "");
  const [status, setStatus] = useState<PrefixStatus>(prefix?.status ?? "active");
  const [description, setDescription] = useState(prefix?.description ?? "");
  const [siteId, setSiteId] = useState(prefix?.siteId ?? "");
  const [busy, setBusy] = useState(false);

  // Live echo of what will actually be stored, so a typed host address visibly
  // snaps to its network before the operator commits it.
  const preview = previewCidr(cidr);

  async function save() {
    if (!preview || busy) return;
    setBusy(true);
    const input: PrefixInput = {
      cidr,
      vrf: vrf.trim(),
      role: role.trim(),
      status,
      description,
      siteId: siteId || null,
    };
    try {
      if (prefix) await updatePrefix(prefix.id, input);
      else await createPrefix(input);
      showStatusBarNotice(t("itops.ipam.prefixSavedNotice", { cidr: preview.cidr }), {
        tone: "success",
      });
      onClose();
    } catch (error) {
      showStatusBarNotice(t("itops.errorNotice", { message: errorMessage(error) }), {
        tone: "error",
      });
      setBusy(false);
    }
  }

  return (
    <DialogShell onBackdrop={onClose}>
      <Sheet
        width={520}
        title={prefix ? t("itops.ipam.editPrefixTitle") : t("itops.ipam.newPrefixTitle")}
        sub={t("itops.ipam.prefixDialogSub")}
        footer={
          <Actions
            cancel={<Btn onClick={onClose}>{t("itops.actions.cancel")}</Btn>}
            primary={
              <Btn kind="primary" icon="check" onClick={() => void save()} disabled={!preview || busy}>
                {t("itops.actions.save")}
              </Btn>
            }
          />
        }
      >
        <Field label={t("itops.ipam.cidrLabel")} req hint={t("itops.ipam.cidrHint")}>
          <TextInput
            mono
            value={cidr}
            placeholder={t("itops.ipam.cidrPlaceholder")}
            onChange={(event) => setCidr(event.currentTarget.value)}
          />
        </Field>
        {preview ? (
          <dl className="it-ipam-preview">
            <div>
              <dt>{t("itops.ipam.columnNetwork")}</dt>
              <dd>{preview.cidr}</dd>
            </div>
            <div>
              <dt>{t("itops.ipam.previewRange")}</dt>
              <dd>{`${preview.firstUsable} – ${preview.lastUsable}`}</dd>
            </div>
            <div>
              <dt>{t("itops.ipam.previewUsable")}</dt>
              <dd>{preview.usable.toLocaleString()}</dd>
            </div>
          </dl>
        ) : (
          <p className="it-ipam-preview-empty">{t("itops.ipam.cidrInvalid")}</p>
        )}
        <Field label={t("itops.ipam.roleLabel")} hint={t("itops.ipam.roleHint")}>
          <TextInput
            value={role}
            placeholder={t("itops.ipam.rolePlaceholder")}
            onChange={(event) => setRole(event.currentTarget.value)}
          />
        </Field>
        <Field label={t("itops.ipam.statusLabel")} hint={t("itops.ipam.containerHint")}>
          <Select
            value={status}
            onChange={(event) => setStatus(event.currentTarget.value as PrefixStatus)}
            options={PREFIX_STATUSES.map((value) => ({
              value,
              label: t(`itops.ipam.prefixStatus.${value}`),
            }))}
          />
        </Field>
        <Field label={t("itops.ipam.vrfLabel")} hint={t("itops.ipam.vrfHint")}>
          <TextInput
            value={vrf}
            placeholder={t("itops.ipam.vrfPlaceholder")}
            onChange={(event) => setVrf(event.currentTarget.value)}
          />
        </Field>
        <Field label={t("itops.ipam.siteLabel")} hint={t("itops.ipam.siteHint")}>
          <Select
            value={siteId}
            onChange={(event) => setSiteId(event.currentTarget.value)}
            options={[
              { value: "", label: t("itops.ipam.siteUnscoped") },
              ...sites.map((site) => ({ value: site.id, label: site.name })),
            ]}
          />
        </Field>
        <Field label={t("itops.ipam.descriptionLabel")}>
          <TextArea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
        </Field>
      </Sheet>
    </DialogShell>
  );
}

function AddressDialog({
  record,
  prefix,
  seed,
  onClose,
}: {
  record: IpAddressRecord | null;
  /** The prefix the record belongs to; drives the "next free address" offer. */
  prefix: IpamPrefixNode | null;
  seed?: ClaimCandidate;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createAddress = useItOpsStore((state) => state.createAddress);
  const updateAddress = useItOpsStore((state) => state.updateAddress);
  const suggestFreeAddresses = useItOpsStore((state) => state.suggestFreeAddresses);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [address, setAddress] = useState(record?.address ?? seed?.address ?? "");
  const [vrf, setVrf] = useState(record?.vrf ?? prefix?.vrf ?? "");
  const [status, setStatus] = useState<AddressStatus>(record?.status ?? "active");
  const [dnsName, setDnsName] = useState(record?.dnsName ?? seed?.label ?? "");
  const [description, setDescription] = useState(record?.description ?? "");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Only offered for a new record inside a known prefix: editing an existing
  // one should not nudge the operator toward renumbering it.
  useEffect(() => {
    if (record || !prefix) return;
    let live = true;
    void suggestFreeAddresses(prefix.cidr, prefix.vrf, 5)
      .then((free) => {
        if (live) setSuggestions(free);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [prefix, record, suggestFreeAddresses]);

  async function save() {
    if (!address.trim() || busy) return;
    setBusy(true);
    const input: AddressInput = {
      address: address.trim(),
      vrf: vrf.trim(),
      status,
      dnsName: dnsName.trim(),
      description,
      hostId: record?.hostId ?? seed?.hostId ?? null,
      connectionId: record?.connectionId ?? seed?.connectionId ?? null,
      rackItemId: record?.rackItemId ?? null,
    };
    try {
      if (record) await updateAddress(record.id, input);
      else await createAddress(input);
      showStatusBarNotice(t("itops.ipam.addressSavedNotice", { address: input.address }), {
        tone: "success",
      });
      onClose();
    } catch (error) {
      showStatusBarNotice(t("itops.errorNotice", { message: errorMessage(error) }), {
        tone: "error",
      });
      setBusy(false);
    }
  }

  return (
    <DialogShell onBackdrop={onClose}>
      <Sheet
        width={480}
        title={record ? t("itops.ipam.editAddressTitle") : t("itops.ipam.newAddressTitle")}
        sub={prefix ? prefix.cidr : t("itops.ipam.addressDialogSub")}
        footer={
          <Actions
            cancel={<Btn onClick={onClose}>{t("itops.actions.cancel")}</Btn>}
            primary={
              <Btn
                kind="primary"
                icon="check"
                onClick={() => void save()}
                disabled={!address.trim() || busy}
              >
                {t("itops.actions.save")}
              </Btn>
            }
          />
        }
      >
        <Field label={t("itops.ipam.addressLabel")} req>
          <TextInput
            mono
            value={address}
            placeholder={t("itops.ipam.addressPlaceholder")}
            onChange={(event) => setAddress(event.currentTarget.value)}
          />
        </Field>
        {suggestions.length > 0 ? (
          <div className="it-ipam-suggestions">
            <span>{t("itops.ipam.freeAddresses")}</span>
            {suggestions.map((free) => (
              <button key={free} type="button" onClick={() => setAddress(free)}>
                {free}
              </button>
            ))}
          </div>
        ) : null}
        <Field label={t("itops.ipam.dnsLabel")} hint={t("itops.ipam.dnsHint")}>
          <TextInput
            value={dnsName}
            placeholder={t("itops.ipam.dnsPlaceholder")}
            onChange={(event) => setDnsName(event.currentTarget.value)}
          />
        </Field>
        <Field label={t("itops.ipam.statusLabel")}>
          <Select
            value={status}
            onChange={(event) => setStatus(event.currentTarget.value as AddressStatus)}
            options={ADDRESS_STATUSES.map((value) => ({
              value,
              label: t(`itops.ipam.addressStatus.${value}`),
            }))}
          />
        </Field>
        <Field label={t("itops.ipam.vrfLabel")} hint={t("itops.ipam.vrfHint")}>
          <TextInput
            value={vrf}
            placeholder={t("itops.ipam.vrfPlaceholder")}
            onChange={(event) => setVrf(event.currentTarget.value)}
          />
        </Field>
        <Field label={t("itops.ipam.descriptionLabel")}>
          <TextArea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
        </Field>
      </Sheet>
    </DialogShell>
  );
}

/** Bulk-claim sheet: turn addresses KKTerm already knows into Address Records. */
function ClaimDialog({
  candidates,
  onClose,
}: {
  candidates: ClaimCandidate[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createAddress = useItOpsStore((state) => state.createAddress);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(candidates.map((entry) => entry.address)),
  );
  const [busy, setBusy] = useState(false);

  async function claim() {
    if (busy) return;
    setBusy(true);
    const picked = candidates.filter((entry) => chosen.has(entry.address));
    let imported = 0;
    try {
      for (const entry of picked) {
        await createAddress({
          address: entry.address,
          vrf: "",
          status: "active",
          dnsName: entry.label,
          description: "",
          hostId: entry.hostId,
          connectionId: entry.connectionId,
          rackItemId: null,
        });
        imported += 1;
      }
      showStatusBarNotice(t("itops.ipam.claimedNotice", { count: imported }), { tone: "success" });
      onClose();
    } catch (error) {
      // A partial import is still progress: report what landed, then stop.
      showStatusBarNotice(t("itops.errorNotice", { message: errorMessage(error) }), {
        tone: "error",
      });
      setBusy(false);
    }
  }

  return (
    <DialogShell onBackdrop={onClose}>
      <Sheet
        width={520}
        title={t("itops.ipam.claimTitle")}
        sub={t("itops.ipam.claimSub")}
        footer={
          <Actions
            cancel={<Btn onClick={onClose}>{t("itops.actions.cancel")}</Btn>}
            primary={
              <Btn
                kind="primary"
                icon="download"
                onClick={() => void claim()}
                disabled={chosen.size === 0 || busy}
              >
                {t("itops.ipam.claimAction", { count: chosen.size })}
              </Btn>
            }
          />
        }
      >
        <div className="it-ipam-claim-list">
          {candidates.map((entry) => (
            <label key={entry.address} className="it-ipam-claim-row">
              <input
                type="checkbox"
                checked={chosen.has(entry.address)}
                onChange={(event) => {
                  const next = new Set(chosen);
                  if (event.currentTarget.checked) next.add(entry.address);
                  else next.delete(entry.address);
                  setChosen(next);
                }}
              />
              <strong>{entry.address}</strong>
              <span>{entry.label}</span>
              <small>{t(`itops.ipam.claimOrigin.${entry.origin}`)}</small>
            </label>
          ))}
        </div>
      </Sheet>
    </DialogShell>
  );
}

export function IpamPanel() {
  const { t } = useTranslation();
  const ipam = useItOpsStore((state) => state.ipam);
  const loaded = useItOpsStore((state) => state.ipamLoaded);
  const loadIpam = useItOpsStore((state) => state.loadIpam);
  const removePrefix = useItOpsStore((state) => state.removePrefix);
  const removeAddress = useItOpsStore((state) => state.removeAddress);
  const sites = useItOpsStore((state) => state.sites);
  const hostsBySite = useItOpsStore((state) => state.hostsBySite);
  const loadHosts = useItOpsStore((state) => state.loadHosts);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);

  const [connections, setConnections] = useState<Connection[]>([]);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [prefixDialog, setPrefixDialog] = useState<IpamPrefixNode | null | undefined>(undefined);
  const [addressDialog, setAddressDialog] = useState<
    { record: IpAddressRecord | null; prefix: IpamPrefixNode | null } | undefined
  >(undefined);
  const [claiming, setClaiming] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "prefix"; prefix: IpamPrefixNode } | { kind: "address"; record: IpAddressRecord } | null
  >(null);

  useEffect(() => {
    if (!loaded) void loadIpam().catch(() => undefined);
  }, [loaded, loadIpam]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invokeCommand("list_connection_tree")
      .then((tree) => setConnections(flattenConnections(tree)))
      .catch(() => setConnections([]));
  }, []);

  // Hosts are loaded per Site; the claim harvest wants all of them at once.
  useEffect(() => {
    for (const site of sites) {
      if (!hostsBySite[site.id]) void loadHosts(site.id).catch(() => undefined);
    }
  }, [hostsBySite, loadHosts, sites]);

  const allHosts = useMemo<SiteHost[]>(() => Object.values(hostsBySite).flat(), [hostsBySite]);
  const candidates = useMemo(
    () => collectClaimCandidates(connections, allHosts, ipam.addresses),
    [allHosts, connections, ipam.addresses],
  );
  const visible = useMemo(() => filterPrefixTree(ipam.prefixes, query), [ipam.prefixes, query]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      if (target.kind === "prefix") {
        await removePrefix(target.prefix.id);
        showStatusBarNotice(t("itops.ipam.prefixDeletedNotice", { cidr: target.prefix.cidr }), {
          tone: "success",
        });
      } else {
        await removeAddress(target.record.id);
        showStatusBarNotice(
          t("itops.ipam.addressDeletedNotice", { address: target.record.address }),
          { tone: "success" },
        );
      }
    } catch (error) {
      showStatusBarNotice(t("itops.errorNotice", { message: errorMessage(error) }), {
        tone: "error",
      });
    }
  }

  function toggleExpanded(id: string) {
    const next = new Set(expanded);
    if (!next.delete(id)) next.add(id);
    setExpanded(next);
  }

  return (
    <div className="it-ipam-page it-destination-surface" data-tutorial-id="itops.ipam">
      <div className="it-destination-page-head">
        <div>
          <h2>{t("itops.ipam.heading")}</h2>
          <p>{t("itops.ipam.pageDescription")}</p>
        </div>
        <button
          type="button"
          className="it-btn primary"
          data-tutorial-id="itops.ipamNew"
          onClick={() => setPrefixDialog(null)}
        >
          <ItIcon name="plus" size={14} />
          {t("itops.ipam.newPrefixTitle")}
        </button>
      </div>

      <div className="it-task-table-shell">
        <div className="it-task-toolbar">
          <label className="it-task-search">
            <ItIcon name="search" size={13} />
            <input
              value={query}
              placeholder={t("itops.ipam.searchPlaceholder")}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          {candidates.length > 0 ? (
            <button type="button" className="it-ipam-claim-btn" onClick={() => setClaiming(true)}>
              <ItIcon name="download" size={13} />
              {t("itops.ipam.claimPrompt", { count: candidates.length })}
            </button>
          ) : null}
        </div>

        {visible.length > 0 ? (
          <div className="it-ipam-table" role="table">
            <div className="it-ipam-head" role="row">
              <span>{t("itops.ipam.columnPrefix")}</span>
              <span>{t("itops.ipam.columnRole")}</span>
              <span>{t("itops.ipam.columnStatus")}</span>
              <span>{t("itops.ipam.columnUtilization")}</span>
              <span>{t("itops.ipam.columnAddresses")}</span>
              <span>{t("itops.ipam.columnActions")}</span>
            </div>
            {visible.map((prefix) => {
              const records = addressesInPrefix(ipam.addresses, prefix);
              const open = expanded.has(prefix.id);
              return (
                <div key={prefix.id} className="it-ipam-group">
                  <div className="it-ipam-row" role="row">
                    <span
                      className="it-ipam-cidr"
                      // Depth is derived server-side, so indentation always
                      // matches the real containment even after a re-parent.
                      style={{ paddingInlineStart: `${prefix.depth * 18}px` }}
                    >
                      <button
                        type="button"
                        className="it-ipam-twisty"
                        aria-expanded={open}
                        aria-label={t("itops.ipam.toggleAddresses")}
                        onClick={() => toggleExpanded(prefix.id)}
                      >
                        <ItIcon name={open ? "chevD" : "chevR"} size={13} />
                      </button>
                      <span>
                        <strong>{prefix.cidr}</strong>
                        <small>
                          {prefix.description ||
                            vrfLabel(prefix.vrf, t("itops.ipam.defaultVrf"))}
                        </small>
                      </span>
                    </span>
                    <span>{prefix.role || "—"}</span>
                    <span>
                      <em className="it-ipam-pill" data-status={prefix.status}>
                        {t(`itops.ipam.prefixStatus.${prefix.status}`)}
                      </em>
                    </span>
                    <span>
                      <UtilizationMeter
                        value={prefix.utilization}
                        label={t("itops.ipam.utilizationDetail", {
                          used: prefix.used.toLocaleString(),
                          usable: prefix.usable.toLocaleString(),
                        })}
                      />
                    </span>
                    <span className="it-ipam-number">{prefix.addressCount}</span>
                    <span className="it-task-row-actions">
                      <button
                        type="button"
                        className="it-icon-btn"
                        aria-label={t("itops.ipam.newAddressTitle")}
                        onClick={() => setAddressDialog({ record: null, prefix })}
                      >
                        <ItIcon name="plus" size={14} />
                      </button>
                      <button
                        type="button"
                        className="it-icon-btn"
                        aria-label={t("itops.actions.edit")}
                        onClick={() => setPrefixDialog(prefix)}
                      >
                        <ItIcon name="edit" size={14} />
                      </button>
                      <button
                        type="button"
                        className="it-icon-btn"
                        aria-label={t("itops.actions.delete")}
                        onClick={() => setPendingDelete({ kind: "prefix", prefix })}
                      >
                        <ItIcon name="trash" size={14} />
                      </button>
                    </span>
                  </div>
                  {open ? (
                    <div className="it-ipam-addresses">
                      {records.length > 0 ? (
                        records.map((record) => (
                          <div key={record.id} className="it-ipam-address-row">
                            <strong>{record.address}</strong>
                            <span>{record.dnsName || record.description || "—"}</span>
                            <em className="it-ipam-pill" data-status={record.status}>
                              {t(`itops.ipam.addressStatus.${record.status}`)}
                            </em>
                            <span className="it-task-row-actions">
                              <button
                                type="button"
                                className="it-icon-btn"
                                aria-label={t("itops.actions.edit")}
                                onClick={() => setAddressDialog({ record, prefix })}
                              >
                                <ItIcon name="edit" size={14} />
                              </button>
                              <button
                                type="button"
                                className="it-icon-btn"
                                aria-label={t("itops.actions.delete")}
                                onClick={() => setPendingDelete({ kind: "address", record })}
                              >
                                <ItIcon name="trash" size={14} />
                              </button>
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="it-ipam-address-empty">{t("itops.ipam.noAddresses")}</p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : loaded ? (
          <ItOpsEmptyHint>
            {query.trim() ? t("itops.ipam.noMatches") : t("itops.ipam.emptyBody")}
          </ItOpsEmptyHint>
        ) : null}
      </div>

      {prefixDialog !== undefined ? (
        <PrefixDialog prefix={prefixDialog} onClose={() => setPrefixDialog(undefined)} />
      ) : null}
      {addressDialog !== undefined ? (
        <AddressDialog
          record={addressDialog.record}
          prefix={addressDialog.prefix}
          onClose={() => setAddressDialog(undefined)}
        />
      ) : null}
      {claiming ? (
        <ClaimDialog candidates={candidates} onClose={() => setClaiming(false)} />
      ) : null}
      {pendingDelete ? (
        <ConfirmSheet
          tone="danger"
          title={
            pendingDelete.kind === "prefix"
              ? t("itops.ipam.deletePrefixTitle")
              : t("itops.ipam.deleteAddressTitle")
          }
          message={
            pendingDelete.kind === "prefix"
              ? t("itops.ipam.deletePrefixBody", { cidr: pendingDelete.prefix.cidr })
              : t("itops.ipam.deleteAddressBody", { address: pendingDelete.record.address })
          }
          confirmLabel={t("itops.actions.delete")}
          confirmIcon="trash"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
