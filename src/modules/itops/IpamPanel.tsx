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
  IpamDeviceType,
  IpamPrefixNode,
  IpamScanResult,
  PrefixStatus,
  SiteHost,
} from "../../types";
import { flattenConnections } from "../workspace/connections/treeUtils";
import { ItIcon } from "./icons";
import { ItOpsEmptyHint } from "./ItOpsEmptyHint";
import {
  addressCoveredByPrefixes,
  addressInCidr,
  addressesInPrefix,
  collectClaimCandidates,
  filterPrefixTree,
  groupPrefixesBySite,
  previewCidr,
  suggestMissingPrefixes,
  uncontainedAddresses,
  utilizationTone,
  type ClaimCandidate,
} from "./ipamModel";
import { useItOpsStore, type AddressInput, type PrefixInput } from "./state";
import { vlanAccent, vlanLabel } from "./vlanModel";

const PREFIX_STATUSES: PrefixStatus[] = ["container", "active", "reserved", "deprecated"];
const ADDRESS_STATUSES: AddressStatus[] = ["active", "reserved", "deprecated"];
const IPAM_DEVICE_TYPES: IpamDeviceType[] = [
  "router",
  "switch",
  "firewall",
  "server",
  "storage",
  "accessPoint",
  "desktop",
  "printer",
  "camera",
  "voip",
  "iot",
];

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

function AddressIdentity({ record }: { record: IpAddressRecord }) {
  const { t } = useTranslation();
  const device = [
    record.deviceType ? t(`itops.networkMap.nodeKind.${record.deviceType}`) : null,
    record.deviceModel || null,
  ].filter(Boolean);
  return (
    <span className="it-ipam-address-identity">
      <span>{record.dnsName || "—"}</span>
      {device.length > 0 || record.description ? (
        <small>{device.length > 0 ? device.join(" · ") : record.description}</small>
      ) : null}
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
  const vlans = useItOpsStore((state) => state.vlans);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [cidr, setCidr] = useState(prefix?.cidr ?? "");
  const [vrf, setVrf] = useState(prefix?.vrf ?? "");
  const [role, setRole] = useState(prefix?.role ?? "");
  const [status, setStatus] = useState<PrefixStatus>(prefix?.status ?? "active");
  const [description, setDescription] = useState(prefix?.description ?? "");
  const [siteId, setSiteId] = useState(prefix?.siteId ?? "");
  const [vlanId, setVlanId] = useState(prefix?.vlanId ?? "");
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
      vlanId: vlanId || null,
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
        <Field label={t("itops.ipam.vlanLabel")} hint={t("itops.ipam.vlanHint")}>
          <Select
            value={vlanId}
            onChange={(event) => setVlanId(event.currentTarget.value)}
            options={[
              { value: "", label: t("itops.ipam.vlanNone") },
              ...vlans.map((vlan) => ({
                value: vlan.id,
                label: t("itops.vlan.optionLabel", { label: vlanLabel(vlan) }),
              })),
            ]}
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
  const sites = useItOpsStore((state) => state.sites);
  const hostsBySite = useItOpsStore((state) => state.hostsBySite);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [address, setAddress] = useState(record?.address ?? seed?.address ?? "");
  const [vrf, setVrf] = useState(record?.vrf ?? prefix?.vrf ?? "");
  const [status, setStatus] = useState<AddressStatus>(record?.status ?? "active");
  const [dnsName, setDnsName] = useState(record?.dnsName ?? seed?.label ?? "");
  const [deviceType, setDeviceType] = useState<IpamDeviceType | null>(
    record?.deviceType ?? null,
  );
  const [deviceModel, setDeviceModel] = useState(record?.deviceModel ?? "");
  const [description, setDescription] = useState(record?.description ?? "");
  const [siteId, setSiteId] = useState(
    record?.siteId ?? seed?.siteId ?? prefix?.siteId ?? "",
  );
  const [siteInherited, setSiteInherited] = useState(
    record?.siteInherited ?? (!seed?.siteId && Boolean(prefix?.siteId)),
  );
  const [hostId, setHostId] = useState(record?.hostId ?? seed?.hostId ?? "");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const hosts = useMemo(() => Object.values(hostsBySite).flat(), [hostsBySite]);
  const visibleHosts = siteId ? hosts.filter((host) => host.siteId === siteId) : hosts;

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
      deviceType,
      deviceModel: deviceModel.trim(),
      description,
      siteId: siteInherited ? null : siteId || null,
      hostId: hostId || null,
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
        <Field label={t("itops.hosts.hostnameLabel")}>
          <TextInput
            value={dnsName}
            placeholder={t("itops.ipam.dnsPlaceholder")}
            onChange={(event) => setDnsName(event.currentTarget.value)}
          />
        </Field>
        <Field label={t("itops.ipam.deviceTypeLabel")}>
          <Select
            value={deviceType ?? ""}
            onChange={(event) =>
              setDeviceType((event.currentTarget.value || null) as IpamDeviceType | null)
            }
            options={[
              { value: "", label: "—" },
              ...IPAM_DEVICE_TYPES.map((value) => ({
                value,
                label: t(`itops.networkMap.nodeKind.${value}`),
              })),
            ]}
          />
        </Field>
        <Field label={t("itops.racks.vendorLabel")}>
          <TextInput
            value={deviceModel}
            onChange={(event) => setDeviceModel(event.currentTarget.value)}
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
        <Field label={t("itops.ipam.siteLabel")} hint={t("itops.ipam.addressSiteHint")}>
          <Select
            value={siteId}
            onChange={(event) => {
              const nextSiteId = event.currentTarget.value;
              setSiteId(nextSiteId);
              setSiteInherited(false);
              if (hostId && hosts.find((host) => host.id === hostId)?.siteId !== nextSiteId) {
                setHostId("");
              }
            }}
            options={[
              { value: "", label: t("itops.ipam.siteUnscoped") },
              ...sites.map((site) => ({ value: site.id, label: site.name })),
            ]}
          />
        </Field>
        <Field label={t("itops.ipam.hostLabel")} hint={t("itops.ipam.hostHint")}>
          <Select
            value={hostId}
            onChange={(event) => {
              const nextHostId = event.currentTarget.value;
              setHostId(nextHostId);
              const host = hosts.find((entry) => entry.id === nextHostId);
              if (host) {
                setSiteId(host.siteId);
                setSiteInherited(false);
              }
            }}
            options={[
              { value: "", label: t("itops.ipam.hostUnbound") },
              ...visibleHosts.map((host) => ({
                value: host.id,
                label: t("itops.ipam.hostOption", {
                  host: host.label.trim() || host.hostname,
                  site: sites.find((site) => site.id === host.siteId)?.name ?? host.siteId,
                }),
              })),
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

/** Bulk-claim sheet: turn addresses KKTerm already knows into Address Records. */
function ClaimDialog({
  candidates,
  prefixes,
  onClose,
  onImported,
}: {
  candidates: ClaimCandidate[];
  prefixes: IpamPrefixNode[];
  onClose: () => void;
  onImported: (createdCidrs: string[]) => void;
}) {
  const { t } = useTranslation();
  const createPrefix = useItOpsStore((state) => state.createPrefix);
  const createAddress = useItOpsStore((state) => state.createAddress);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const missingSuggestions = useMemo(
    () => suggestMissingPrefixes(candidates, prefixes),
    [candidates, prefixes],
  );
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(candidates.map((entry) => entry.address)),
  );
  const [prefixDrafts, setPrefixDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      suggestMissingPrefixes(candidates, prefixes).map((suggestion) => [
        suggestion.id,
        suggestion.cidr,
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const picked = candidates.filter((entry) => chosen.has(entry.address));
  const uncoveredPicked = picked.filter(
    (entry) => !addressCoveredByPrefixes(entry.address, prefixes),
  );
  const activeMissingSuggestions = missingSuggestions.filter((suggestion) =>
    suggestion.addresses.some((address) => chosen.has(address)),
  );
  const proposedPrefixes = activeMissingSuggestions
    .map((suggestion) => previewCidr(prefixDrafts[suggestion.id] ?? suggestion.cidr))
    .filter((preview): preview is NonNullable<typeof preview> => preview !== null);
  const prefixPlanValid =
    proposedPrefixes.length === activeMissingSuggestions.length &&
    uncoveredPicked.every((entry) =>
      proposedPrefixes.some((prefix) => addressInCidr(entry.address, prefix.cidr)),
    );

  async function claim() {
    if (busy || !prefixPlanValid) return;
    setBusy(true);
    let imported = 0;
    const createdCidrs: string[] = [];
    try {
      for (const cidr of new Set(proposedPrefixes.map((prefix) => prefix.cidr))) {
        await createPrefix({
          cidr,
          vrf: "",
          role: "",
          status: "active",
          description: "",
          siteId: null,
          vlanId: null,
        });
        createdCidrs.push(cidr);
      }
      for (const entry of picked) {
        await createAddress({
          address: entry.address,
          vrf: "",
          status: "active",
          dnsName: entry.label,
          deviceType: null,
          deviceModel: "",
          description: "",
          siteId: entry.siteId,
          hostId: entry.hostId,
          connectionId: entry.connectionId,
          rackItemId: null,
        });
        imported += 1;
      }
      showStatusBarNotice(t("itops.ipam.claimedNotice", { count: imported }), { tone: "success" });
      onImported(createdCidrs);
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
                disabled={chosen.size === 0 || !prefixPlanValid || busy}
              >
                {t("itops.ipam.claimAction", { count: chosen.size })}
              </Btn>
            }
          />
        }
      >
        {uncoveredPicked.length > 0 ? (
          <div className="it-ipam-claim-prefixes">
            <p>
              {t("itops.ipam.claimMissingPrefixes", { count: uncoveredPicked.length })}
            </p>
            {activeMissingSuggestions.map((suggestion) => (
              <Field
                key={suggestion.id}
                label={t("itops.ipam.cidrLabel")}
                hint={suggestion.addresses
                  .filter((address) => chosen.has(address))
                  .join(", ")}
              >
                <TextInput
                  mono
                  value={prefixDrafts[suggestion.id] ?? suggestion.cidr}
                  aria-invalid={
                    previewCidr(prefixDrafts[suggestion.id] ?? suggestion.cidr) === null
                  }
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setPrefixDrafts((current) => ({
                      ...current,
                      [suggestion.id]: value,
                    }));
                  }}
                />
              </Field>
            ))}
            {!prefixPlanValid ? (
              <p className="it-ipam-claim-prefix-error">
                {t("itops.ipam.claimPrefixCoverageInvalid")}
              </p>
            ) : null}
          </div>
        ) : null}
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

function ScanDialog({
  prefixes,
  onClose,
}: {
  prefixes: IpamPrefixNode[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const loadIpam = useItOpsStore((state) => state.loadIpam);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const showStatusBarProgress = useWorkspaceStore((state) => state.showStatusBarProgress);
  const clearStatusBarNotice = useWorkspaceStore((state) => state.clearStatusBarNotice);
  const [selectedPrefixes, setSelectedPrefixes] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<IpamScanResult[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const selectedAddressCount = prefixes
    .filter((prefix) => selectedPrefixes.has(prefix.id))
    .reduce((total, prefix) => total + prefix.usable, 0);
  const selectionTooLarge = selectedAddressCount > 4096;

  async function scan() {
    if (busy || selectedPrefixes.size === 0 || selectionTooLarge) return;
    setBusy(true);
    const progressId = showStatusBarProgress(
      t("itops.ipam.scanningNotice", { count: selectedAddressCount }),
      { progress: 10 },
    );
    try {
      const discovered = await invokeCommand("itops_scan_ip_prefixes", {
        prefixIds: [...selectedPrefixes],
      });
      setResults(discovered);
      setChosen(
        new Set(
          discovered
            .filter((entry) => !entry.documented)
            .map((entry) => `${entry.vrf}\u0000${entry.address}`),
        ),
      );
    } catch (error) {
      showStatusBarNotice(t("itops.errorNotice", { message: errorMessage(error) }), {
        tone: "error",
      });
    } finally {
      clearStatusBarNotice(progressId);
      setBusy(false);
    }
  }

  async function importResults() {
    if (busy || !results || chosen.size === 0) return;
    setBusy(true);
    let imported = 0;
    try {
      for (const entry of results) {
        if (!chosen.has(`${entry.vrf}\u0000${entry.address}`) || entry.documented) continue;
        await invokeCommand("itops_create_ip_address", {
          address: entry.address,
          vrf: entry.vrf,
          status: "active",
          dnsName: entry.hostname,
          deviceType: entry.deviceType,
          deviceModel: entry.deviceModel,
          description: "",
          siteId: entry.siteId ?? null,
          hostId: null,
          connectionId: null,
          rackItemId: null,
        });
        imported += 1;
      }
      await loadIpam();
      showStatusBarNotice(t("itops.ipam.scanImportedNotice", { count: imported }), {
        tone: "success",
      });
      onClose();
    } catch (error) {
      if (imported > 0) await loadIpam().catch(() => undefined);
      showStatusBarNotice(t("itops.errorNotice", { message: errorMessage(error) }), {
        tone: "error",
      });
      setBusy(false);
    }
  }

  return (
    <DialogShell onBackdrop={onClose}>
      <Sheet
        width={620}
        title={t("itops.ipam.scanTitle")}
        footer={
          <Actions
            cancel={<Btn onClick={onClose}>{t("itops.actions.cancel")}</Btn>}
            primary={
              results === null ? (
                <Btn
                  kind="primary"
                  icon="network"
                  onClick={() => void scan()}
                  disabled={
                    selectedPrefixes.size === 0 || selectionTooLarge || busy
                  }
                >
                  {t("itops.ipam.scanStartAction")}
                </Btn>
              ) : (
                <Btn
                  kind="primary"
                  icon="download"
                  onClick={() => void importResults()}
                  disabled={chosen.size === 0 || busy}
                >
                  {t("itops.ipam.scanImportAction", { count: chosen.size })}
                </Btn>
              )
            }
          />
        }
      >
        {results === null ? (
          <>
            <p className="it-ipam-scan-copy">{t("itops.ipam.scanIntro")}</p>
            <div className="it-ipam-scan-prefixes">
              {prefixes.map((prefix) => (
                <label key={prefix.id} className="it-ipam-scan-prefix">
                  <input
                    type="checkbox"
                    checked={selectedPrefixes.has(prefix.id)}
                    onChange={(event) => {
                      const next = new Set(selectedPrefixes);
                      if (event.currentTarget.checked) next.add(prefix.id);
                      else next.delete(prefix.id);
                      setSelectedPrefixes(next);
                    }}
                  />
                  <strong>{prefix.cidr}</strong>
                  <span>{prefix.role || vrfLabel(prefix.vrf, t("itops.ipam.defaultVrf"))}</span>
                  <small>{prefix.usable.toLocaleString()}</small>
                </label>
              ))}
            </div>
            <p className={selectionTooLarge ? "it-ipam-scan-limit error" : "it-ipam-scan-limit"}>
              {selectionTooLarge
                ? t("itops.ipam.scanTooLarge")
                : t("itops.ipam.scanAddressBudget", {
                    count: selectedAddressCount.toLocaleString(),
                  })}
            </p>
          </>
        ) : (
          <>
            <p className="it-ipam-scan-copy">
              {results.length > 0
                ? t("itops.ipam.scanResultsSummary", { count: results.length })
                : t("itops.ipam.scanNoResults")}
            </p>
            {results.length > 0 ? (
              <div className="it-ipam-scan-results">
                {results.map((entry) => {
                  const key = `${entry.vrf}\u0000${entry.address}`;
                  const evidence = [
                    entry.ping ? t("itops.ipam.scanEvidencePing") : null,
                    entry.snmp ? t("itops.ipam.scanEvidenceSnmp") : null,
                    entry.openPorts.length > 0
                      ? t("itops.ipam.scanEvidencePorts", {
                          ports: entry.openPorts.join(", "),
                        })
                      : null,
                  ].filter(Boolean);
                  const identity = [
                    entry.hostname || null,
                    entry.deviceType
                      ? t(`itops.networkMap.nodeKind.${entry.deviceType}`)
                      : null,
                    entry.deviceModel || null,
                  ].filter(Boolean);
                  return (
                    <label key={`${entry.prefixId}:${key}`} className="it-ipam-scan-result">
                      <input
                        type="checkbox"
                        checked={!entry.documented && chosen.has(key)}
                        disabled={entry.documented}
                        onChange={(event) => {
                          const next = new Set(chosen);
                          if (event.currentTarget.checked) next.add(key);
                          else next.delete(key);
                          setChosen(next);
                        }}
                      />
                      <strong>{entry.address}</strong>
                      <span>
                        {identity.length > 0
                          ? `${identity.join(" · ")} — ${evidence.join(" · ")}`
                          : evidence.join(" · ")}
                      </span>
                      <small>
                        {entry.documented ? t("itops.ipam.scanDocumented") : entry.cidr}
                      </small>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </>
        )}
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
  const vlans = useItOpsStore((state) => state.vlans);
  const vlansLoaded = useItOpsStore((state) => state.vlansLoaded);
  const loadVlans = useItOpsStore((state) => state.loadVlans);
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
  const [scanning, setScanning] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "prefix"; prefix: IpamPrefixNode } | { kind: "address"; record: IpAddressRecord } | null
  >(null);

  useEffect(() => {
    if (!loaded) void loadIpam().catch(() => undefined);
  }, [loaded, loadIpam]);

  // A prefix's VLAN is a soft reference, so the records have to be in hand
  // before a row can name the VLAN it points at.
  useEffect(() => {
    if (!vlansLoaded) void loadVlans().catch(() => undefined);
  }, [loadVlans, vlansLoaded]);

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
  const vlansById = useMemo(() => new Map(vlans.map((vlan) => [vlan.id, vlan])), [vlans]);
  const prefixGroups = useMemo(() => groupPrefixesBySite(visible, sites), [sites, visible]);
  const siteNames = useMemo(
    () => new Map(sites.map((site) => [site.id, site.name])),
    [sites],
  );
  const unassigned = useMemo(
    () => uncontainedAddresses(ipam.addresses, ipam.prefixes),
    [ipam.addresses, ipam.prefixes],
  );

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
          {ipam.prefixes.length > 0 ? (
            <button type="button" className="it-ipam-claim-btn" onClick={() => setScanning(true)}>
              <ItIcon name="pulse" size={13} />
              {t("itops.ipam.scanAction")}
            </button>
          ) : null}
        </div>

        {visible.length > 0 || (!query.trim() && unassigned.length > 0) ? (
          <div className="it-ipam-table" role="table">
            <div className="it-ipam-head" role="row">
              <span>{t("itops.ipam.columnPrefix")}</span>
              <span>{t("itops.ipam.columnRole")}</span>
              <span>{t("itops.ipam.columnStatus")}</span>
              <span>{t("itops.ipam.columnUtilization")}</span>
              <span>{t("itops.ipam.columnAddresses")}</span>
              <span>{t("itops.ipam.columnActions")}</span>
            </div>
            {prefixGroups.map((siteGroup) => (
              <div
                key={siteGroup.siteId ?? "unscoped"}
                className="it-ipam-site-group"
                role="rowgroup"
              >
                <div className="it-ipam-site-row" role="row">
                  <span role="cell">
                    {siteGroup.siteId
                      ? siteNames.get(siteGroup.siteId)
                      : t("itops.ipam.siteUnscoped")}
                  </span>
                </div>
                {siteGroup.prefixes.map((prefix) => {
                  const records = addressesInPrefix(ipam.addresses, prefix);
                  const open = expanded.has(prefix.id);
                  // A deleted VLAN clears the reference server-side, so a miss here
                  // only ever means the VLAN list has not loaded yet.
                  const vlan = prefix.vlanId ? vlansById.get(prefix.vlanId) : undefined;
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
                               {vlan ? (
                                 <em
                                   className="it-vlan-chip"
                                   style={
                                     {
                                       "--it-vlan-accent": vlanAccent(vlan),
                                     } as React.CSSProperties
                                   }
                                 >
                                   {t("itops.vlan.chip", { vid: vlan.vid })}
                                 </em>
                               ) : null}
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
                                <AddressIdentity record={record} />
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
            ))}
            {!query.trim() && unassigned.length > 0 ? (
              <div className="it-ipam-group it-ipam-unassigned-group">
                <div className="it-ipam-row it-ipam-unassigned-row" role="row">
                  <span className="it-ipam-unassigned-copy">
                    <strong>{t("itops.ipam.unassignedAddresses")}</strong>
                    <small>{t("itops.ipam.unassignedHint")}</small>
                  </span>
                  <span className="it-ipam-number">{unassigned.length}</span>
                  <span />
                </div>
                <div className="it-ipam-addresses">
                  {unassigned.map((record) => (
                    <div key={record.id} className="it-ipam-address-row">
                      <strong>{record.address}</strong>
                      <AddressIdentity record={record} />
                      <em className="it-ipam-pill" data-status={record.status}>
                        {t(`itops.ipam.addressStatus.${record.status}`)}
                      </em>
                      <span className="it-task-row-actions">
                        <button
                          type="button"
                          className="it-icon-btn"
                          aria-label={t("itops.actions.edit")}
                          onClick={() => setAddressDialog({ record, prefix: null })}
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
                  ))}
                </div>
              </div>
            ) : null}
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
        <ClaimDialog
          candidates={candidates}
          prefixes={ipam.prefixes}
          onClose={() => setClaiming(false)}
          onImported={(createdCidrs) => {
            const created = new Set(createdCidrs);
            const createdIds = useItOpsStore
              .getState()
              .ipam.prefixes.filter((prefix) => created.has(prefix.cidr))
              .map((prefix) => prefix.id);
            setExpanded((current) => new Set([...current, ...createdIds]));
            setClaiming(false);
          }}
        />
      ) : null}
      {scanning ? (
        <ScanDialog prefixes={ipam.prefixes} onClose={() => setScanning(false)} />
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
