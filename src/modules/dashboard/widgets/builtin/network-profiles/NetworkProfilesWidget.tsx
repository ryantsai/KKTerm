import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Network,
  Plus,
  RefreshCw,
  Trash2,
} from "../../../../../lib/reicon";
import { invokeCommand, isTauriRuntime } from "../../../../../lib/tauri";
import { Actions, Btn, ConfirmSheet, DialogShell, Field, Select, Sheet, TextInput } from "../../../../../app/ui/dialog";
import { useWorkspaceStore } from "../../../../../store";
import { readDurableUiState, writeDurableUiState } from "../../../../../lib/durableUiState";
import type { BuiltInWidgetBodyProps } from "../../../registry/builtInRegistry";
import type {
  ApplyNetworkProfileRequest,
  NetworkAdapterSnapshot,
  NetworkFamilySnapshot,
  NetworkIpMode,
  NetworkProfilesSnapshot,
} from "./types";

interface NetworkProfileDraft {
  name: string;
  ipv4: NetworkFamilySnapshot;
  ipv6: NetworkFamilySnapshot;
  dnsServers: string[];
}

interface SavedNetworkProfile extends NetworkProfileDraft {
  id: string;
  createdAt: number;
}

interface NetworkProfilesConfig {
  profiles: SavedNetworkProfile[];
  adapterNicknames: Record<string, string>;
  selectedAdapterId: string | null;
}

const DEFAULT_CONFIG: NetworkProfilesConfig = {
  profiles: [],
  adapterNicknames: {},
  selectedAdapterId: null,
};

const STORAGE_KEY = "kkterm.dashboard.networkProfiles.v1";
const VALID_MODES = new Set<NetworkIpMode>(["automatic", "manual", "disabled"]);
let sharedConfig: NetworkProfilesConfig | null = null;
const configListeners = new Set<() => void>();

function normalizeFamily(value: unknown): NetworkFamilySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<NetworkFamilySnapshot>;
  if (!VALID_MODES.has(candidate.mode as NetworkIpMode) || !Array.isArray(candidate.addresses)) return null;
  const addresses = candidate.addresses
    .filter((entry): entry is { address: string; prefix: number } =>
      Boolean(entry) && typeof entry.address === "string" && Number.isInteger(entry.prefix),
    )
    .slice(0, 8)
    .map((entry) => ({ address: entry.address, prefix: entry.prefix }));
  return {
    mode: candidate.mode as NetworkIpMode,
    addresses,
    gateway: typeof candidate.gateway === "string" ? candidate.gateway : null,
  };
}

export function normalizeNetworkProfilesConfig(value: unknown): NetworkProfilesConfig {
  if (!value || typeof value !== "object") return DEFAULT_CONFIG;
  const candidate = value as Partial<NetworkProfilesConfig>;
  const profiles = Array.isArray(candidate.profiles)
    ? candidate.profiles.flatMap((profile) => {
        if (!profile || typeof profile !== "object") return [];
        const row = profile as Partial<SavedNetworkProfile>;
        const ipv4 = normalizeFamily(row.ipv4);
        const ipv6 = normalizeFamily(row.ipv6);
        if (typeof row.id !== "string" || typeof row.name !== "string" || !row.name.trim() || !ipv4 || !ipv6) return [];
        return [{
          id: row.id,
          name: row.name.trim().slice(0, 80),
          createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
          ipv4,
          ipv6,
          dnsServers: Array.isArray(row.dnsServers)
            ? row.dnsServers.filter((entry): entry is string => typeof entry === "string").slice(0, 8)
            : [],
        }];
      }).slice(0, 100)
    : [];
  const adapterNicknames = candidate.adapterNicknames && typeof candidate.adapterNicknames === "object"
    ? Object.fromEntries(Object.entries(candidate.adapterNicknames)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([id, nickname]) => [id, nickname.trim().slice(0, 80)]))
    : {};
  return {
    profiles,
    adapterNicknames,
    selectedAdapterId: typeof candidate.selectedAdapterId === "string" ? candidate.selectedAdapterId : null,
  };
}

function readSharedConfig() {
  if (sharedConfig) return sharedConfig;
  const raw = readDurableUiState(STORAGE_KEY);
  if (raw === null) {
    sharedConfig = DEFAULT_CONFIG;
    return sharedConfig;
  }
  try {
    sharedConfig = normalizeNetworkProfilesConfig(JSON.parse(raw));
  } catch {
    sharedConfig = DEFAULT_CONFIG;
  }
  return sharedConfig;
}

function subscribeToConfig(listener: () => void) {
  configListeners.add(listener);
  return () => {
    configListeners.delete(listener);
  };
}

function useNetworkProfilesConfig() {
  const config = useSyncExternalStore(subscribeToConfig, readSharedConfig, readSharedConfig);
  const setConfig = useCallback((update: SetStateAction<NetworkProfilesConfig>) => {
    const current = readSharedConfig();
    const proposed = typeof update === "function" ? update(current) : update;
    if (proposed === current) return;
    const next = normalizeNetworkProfilesConfig(proposed);
    sharedConfig = next;
    writeDurableUiState(STORAGE_KEY, JSON.stringify(next));
    configListeners.forEach((listener) => listener());
  }, []);
  return [config, setConfig] as const;
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `network-profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function firstAddress(family: NetworkFamilySnapshot) {
  const address = family.addresses[0];
  return address ? `${address.address}/${address.prefix}` : "—";
}

const IPV4_ADDRESS = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function isValidIpv4(value: string) {
  const candidate = value.trim();
  if (!IPV4_ADDRESS.test(candidate)) return false;
  return candidate.split(".").every((part) => {
    if (part.length > 1 && part.startsWith("0")) return false;
    return Number(part) <= 255;
  });
}

function addressFamily(value: string): "ipv4" | "ipv6" | null {
  const candidate = value.trim();
  if (isValidIpv4(candidate)) return "ipv4";
  if (!candidate.includes(":") || !/^[0-9a-fA-F:.]+$/.test(candidate)) return null;
  try {
    const parsed = new URL(`http://[${candidate}]/`);
    return parsed.hostname.startsWith("[") ? "ipv6" : null;
  } catch {
    return null;
  }
}

function ipv4MaskToPrefix(value: string): number | null {
  const candidate = value.trim().replace(/^\//, "");
  if (/^\d{1,2}$/.test(candidate)) {
    const prefix = Number(candidate);
    return prefix <= 32 ? prefix : null;
  }
  if (!isValidIpv4(candidate)) return null;
  let prefix = 0;
  let seenZero = false;
  for (const part of candidate.split(".")) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      if ((Number(part) >> bit) & 1) {
        if (seenZero) return null;
        prefix += 1;
      } else {
        seenZero = true;
      }
    }
  }
  return prefix;
}

function prefixToIpv4Mask(prefix: number) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return [24, 16, 8, 0].map((shift) => (mask >>> shift) & 0xff).join(".");
}

function parseDnsServers(value: string): string[] | null {
  const entries = value.split(/[\s,;]+/).filter(Boolean);
  if (entries.length > 8) return null;
  return entries.every((entry) => addressFamily(entry) !== null) ? entries : null;
}

type FamilyFieldError = "address" | "prefix" | "gateway";

function buildManualFamily(
  mode: NetworkIpMode,
  address: string,
  prefixValue: string,
  gateway: string,
  ipv6: boolean,
): { family: NetworkFamilySnapshot } | { error: FamilyFieldError } {
  if (mode !== "manual") return { family: { mode, addresses: [], gateway: null } };
  const addressValue = address.trim();
  if (addressFamily(addressValue) !== (ipv6 ? "ipv6" : "ipv4")) return { error: "address" };
  const rawPrefix = prefixValue.trim();
  const prefix = ipv6
    ? /^\d{1,3}$/.test(rawPrefix) && Number(rawPrefix) <= 128 ? Number(rawPrefix) : null
    : ipv4MaskToPrefix(rawPrefix);
  if (prefix === null) return { error: "prefix" };
  const gatewayValue = gateway.trim();
  if (gatewayValue && addressFamily(gatewayValue) !== (ipv6 ? "ipv6" : "ipv4")) return { error: "gateway" };
  return { family: { mode, addresses: [{ address: addressValue, prefix }], gateway: gatewayValue || null } };
}

interface NetworkProfileFormValues {
  name: string;
  ipv4Mode: NetworkIpMode;
  ipv4Address: string;
  ipv4Mask: string;
  ipv4Gateway: string;
  ipv6Mode: NetworkIpMode;
  ipv6Address: string;
  ipv6Prefix: string;
  ipv6Gateway: string;
  dnsServers: string;
}

const UNCONFIGURED_FORM_VALUES: NetworkProfileFormValues = {
  name: "",
  ipv4Mode: "automatic",
  ipv4Address: "",
  ipv4Mask: "",
  ipv4Gateway: "",
  ipv6Mode: "automatic",
  ipv6Address: "",
  ipv6Prefix: "64",
  ipv6Gateway: "",
  dnsServers: "",
};

function formValuesFromFamilies(
  name: string,
  ipv4: NetworkFamilySnapshot,
  ipv6: NetworkFamilySnapshot,
  dnsServers: string[],
): NetworkProfileFormValues {
  const v4 = ipv4.addresses[0];
  const v6 = ipv6.addresses[0];
  return {
    name,
    ipv4Mode: ipv4.mode,
    ipv4Address: v4?.address ?? "",
    ipv4Mask: v4 ? prefixToIpv4Mask(v4.prefix) : "",
    ipv4Gateway: ipv4.gateway ?? "",
    ipv6Mode: ipv6.mode,
    ipv6Address: v6?.address ?? "",
    ipv6Prefix: v6 ? String(v6.prefix) : "64",
    ipv6Gateway: ipv6.gateway ?? "",
    dnsServers: dnsServers.join(", "),
  };
}

function familyMatchesCurrent(profileFamily: NetworkFamilySnapshot, adapterFamily: NetworkFamilySnapshot) {
  if (profileFamily.mode !== adapterFamily.mode) return false;
  if (profileFamily.mode !== "manual") return true;
  const addresses = (family: NetworkFamilySnapshot) => family.addresses
    .map((entry) => `${entry.address.trim().toLowerCase()}/${entry.prefix}`)
    .sort()
    .join(",");
  return addresses(profileFamily) === addresses(adapterFamily)
    && (profileFamily.gateway ?? "").trim().toLowerCase() === (adapterFamily.gateway ?? "").trim().toLowerCase();
}

function dnsMatchesCurrent(profileDns: string[], adapterDns: string[]) {
  const servers = (values: string[]) => [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort().join(",");
  return servers(profileDns) === servers(adapterDns);
}

function profileMatchesAdapter(profile: SavedNetworkProfile, adapter: NetworkAdapterSnapshot) {
  return familyMatchesCurrent(profile.ipv4, adapter.ipv4)
    && familyMatchesCurrent(profile.ipv6, adapter.ipv6)
    && dnsMatchesCurrent(profile.dnsServers, adapter.dnsServers);
}

export function NetworkProfilesBody(_props: BuiltInWidgetBodyProps) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [config, setConfig] = useNetworkProfilesConfig();
  const [snapshot, setSnapshot] = useState<NetworkProfilesSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileForm, setProfileForm] = useState<{ profileId: string | null } | null>(null);
  const [applyingProfile, setApplyingProfile] = useState<SavedNetworkProfile | null>(null);
  const [deleteProfile, setDeleteProfile] = useState<SavedNetworkProfile | null>(null);
  const [nicknameDialog, setNicknameDialog] = useState<string | null>(null);
  const carouselRef = useRef<HTMLDivElement | null>(null);

  const refresh = async (quiet = false) => {
    if (!isTauriRuntime()) {
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const next = await invokeCommand("network_profiles_snapshot");
      setSnapshot(next);
      setConfig((current) => {
        const selectedExists = next.adapters.some((adapter) => adapter.id === current.selectedAdapterId);
        return selectedExists || next.adapters.length === 0
          ? current
          : { ...current, selectedAdapterId: next.adapters[0].id };
      });
    } catch (error) {
      showStatusBarNotice(t("dashboard.networkProfilesLoadError", { message: String(error) }), { tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // The durable setter is stable for the life of this widget instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedAdapter = useMemo(
    () => snapshot?.adapters.find((adapter) => adapter.id === config.selectedAdapterId) ?? snapshot?.adapters[0] ?? null,
    [config.selectedAdapterId, snapshot],
  );
  const canApply = snapshot?.capability === "supported"
    && (snapshot.platform !== "linux" || Boolean(selectedAdapter?.serviceId));
  const adapterLabel = (adapter: NetworkAdapterSnapshot) => config.adapterNicknames[adapter.id] || adapter.name;
  const editingProfile = profileForm?.profileId
    ? config.profiles.find((profile) => profile.id === profileForm.profileId) ?? null
    : null;

  function saveNickname(value: string) {
    const nickname = value.trim();
    if (!nickname || !selectedAdapter) return;
    setConfig((current) => ({
      ...current,
      adapterNicknames: { ...current.adapterNicknames, [selectedAdapter.id]: nickname },
    }));
    showStatusBarNotice(t("dashboard.networkProfilesNicknameSaved", { name: nickname }), { tone: "success" });
    setNicknameDialog(null);
  }

  function saveProfile(draft: NetworkProfileDraft) {
    const profileId = editingProfile?.id ?? null;
    setConfig((current) => profileId
      ? { ...current, profiles: current.profiles.map((profile) => (profile.id === profileId ? { ...profile, ...draft } : profile)) }
      : { ...current, profiles: [...current.profiles, { id: newId(), createdAt: Date.now(), ...draft }].slice(-100) });
    showStatusBarNotice(t("dashboard.networkProfilesSaved", { name: draft.name }), { tone: "success" });
    setProfileForm(null);
  }

  async function applyProfile(profile: SavedNetworkProfile) {
    if (!selectedAdapter || !canApply) return;
    setApplyingProfile(null);
    const request: ApplyNetworkProfileRequest = {
      adapterId: selectedAdapter.id,
      serviceId: selectedAdapter.serviceId,
      ipv4: profile.ipv4,
      ipv6: profile.ipv6,
      dnsServers: profile.dnsServers,
    };
    try {
      await invokeCommand("network_profiles_apply", { request });
      showStatusBarNotice(t("dashboard.networkProfilesApplied", {
        profile: profile.name,
        adapter: adapterLabel(selectedAdapter),
      }), { tone: "success" });
      await refresh(true);
    } catch (error) {
      showStatusBarNotice(t("dashboard.networkProfilesApplyError", { message: String(error) }), { tone: "error" });
    }
  }

  function confirmDelete() {
    if (!deleteProfile) return;
    const id = deleteProfile.id;
    setConfig((current) => ({
      ...current,
      profiles: current.profiles.filter((profile) => profile.id !== id),
    }));
    setDeleteProfile(null);
  }

  function scrollCarousel(direction: -1 | 1) {
    const node = carouselRef.current;
    if (!node) return;
    node.scrollBy({
      left: direction * Math.max(220, node.clientWidth * 0.72),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }

  if (!isTauriRuntime()) {
    return <div className="dw-network-profiles-empty">{t("dashboard.networkProfilesDesktopOnly")}</div>;
  }

  return (
    <div className="dw-network-profiles">
      <header className="dw-network-profiles-adapter">
        <span className="dw-network-profiles-adapter-icon" aria-hidden="true"><Network size={20} /></span>
        <div className="dw-network-profiles-adapter-main">
          <span className="dw-network-profiles-kicker">{t("dashboard.networkProfilesAdapter")}</span>
          {snapshot && snapshot.adapters.length > 0 ? (
            <select
              value={selectedAdapter?.id ?? ""}
              aria-label={t("dashboard.networkProfilesAdapter")}
              onChange={(event) => {
                const selectedAdapterId = event.currentTarget.value;
                setConfig((current) => ({ ...current, selectedAdapterId }));
              }}
            >
              {snapshot.adapters.map((adapter) => (
                <option key={adapter.id} value={adapter.id}>{adapterLabel(adapter)}</option>
              ))}
            </select>
          ) : (
            <strong>{loading ? t("common.loading") : t("dashboard.networkProfilesNoAdapters")}</strong>
          )}
          {selectedAdapter ? (
            <span className="dw-network-profiles-adapter-detail">
              <i className={selectedAdapter.connected ? "is-connected" : ""} />
              {selectedAdapter.connected ? t("dashboard.networkProfilesConnected") : t("dashboard.networkProfilesDisconnected")}
              {selectedAdapter.detail ? ` · ${selectedAdapter.detail}` : ""}
            </span>
          ) : null}
        </div>
        {selectedAdapter ? (
          <button
            type="button"
            className="dw-network-profiles-icon-button"
            data-preserve-content-focus="true"
            title={t("dashboard.networkProfilesEditNickname")}
            aria-label={t("dashboard.networkProfilesEditNickname")}
            onClick={() => setNicknameDialog(adapterLabel(selectedAdapter))}
          ><Edit3 size={15} /></button>
        ) : null}
        <button
          type="button"
          className="dw-network-profiles-icon-button"
          data-preserve-content-focus="true"
          disabled={loading}
          title={t("common.refresh")}
          aria-label={t("common.refresh")}
          onClick={() => void refresh()}
        ><RefreshCw className={loading ? "is-spinning" : ""} size={15} /></button>
      </header>

      {selectedAdapter ? (
        <div className="dw-network-profiles-live">
          <FamilySummary label="IPv4" family={selectedAdapter.ipv4} t={t} />
          <FamilySummary label="IPv6" family={selectedAdapter.ipv6} t={t} />
          <span className="dw-network-profiles-dns"><b>{t("dashboard.networkProfilesDns")}</b>{selectedAdapter.dnsServers.join(", ") || "—"}</span>
        </div>
      ) : null}

      {snapshot && snapshot.capability !== "supported" ? (
        <div className="dw-network-profiles-capability">
          {t(`dashboard.networkProfilesCapability.${snapshot.capability}`)}
        </div>
      ) : null}

      <section className="dw-network-profiles-section" aria-label={t("dashboard.networkProfilesSavedProfiles")}>
        <div className="dw-network-profiles-section-head">
          <strong>{t("dashboard.networkProfilesSavedProfiles")}</strong>
          <div className="dw-network-profiles-section-tools">
            <span>{config.profiles.length}</span>
            <button
              type="button"
              data-preserve-content-focus="true"
              className="dw-network-profiles-add"
              onClick={() => setProfileForm({ profileId: null })}
            ><Plus size={13} />{t("common.add")}</button>
          </div>
        </div>
        {config.profiles.length > 0 ? (
          <div className="dw-network-profiles-carousel-shell">
            <button type="button" data-preserve-content-focus="true" className="dw-network-profiles-scroll" onClick={() => scrollCarousel(-1)} aria-label={t("dashboard.networkProfilesPrevious")}><ChevronLeft size={16} /></button>
            <div ref={carouselRef} className="dw-network-profiles-carousel">
              {config.profiles.map((profile) => {
                const matchesCurrent = selectedAdapter ? profileMatchesAdapter(profile, selectedAdapter) : false;
                return (
                  <article key={profile.id} className="dw-network-profile-card">
                    <div className="dw-network-profile-card-head">
                      <strong>{profile.name}</strong>
                      <div className="dw-network-profile-card-actions">
                        <button type="button" data-preserve-content-focus="true" aria-label={t("dashboard.networkProfilesEditProfile")} title={t("dashboard.networkProfilesEditProfile")} onClick={() => setProfileForm({ profileId: profile.id })}><Edit3 size={13} /></button>
                        <button type="button" data-preserve-content-focus="true" aria-label={t("dashboard.networkProfilesDeleteProfile")} title={t("dashboard.networkProfilesDeleteProfile")} onClick={() => setDeleteProfile(profile)}><Trash2 size={13} /></button>
                      </div>
                    </div>
                    <div className="dw-network-profile-family-row">
                      <ModePill label="IPv4" mode={profile.ipv4.mode} t={t} />
                      <span>{firstAddress(profile.ipv4)}</span>
                    </div>
                    <div className="dw-network-profile-family-row">
                      <ModePill label="IPv6" mode={profile.ipv6.mode} t={t} />
                      <span>{firstAddress(profile.ipv6)}</span>
                    </div>
                    <div className="dw-network-profile-card-footer">
                      <span>{profile.dnsServers.join(", ") || t("dashboard.networkProfilesSystemDns")}</span>
                      {matchesCurrent ? (
                        <span className="dw-network-profile-current"><Check size={12} />{t("dashboard.networkProfilesCurrent")}</span>
                      ) : (
                        <button
                          type="button"
                          data-preserve-content-focus="true"
                          className="dw-network-profile-apply"
                          disabled={!selectedAdapter || !canApply}
                          onClick={() => setApplyingProfile(profile)}
                        >
                          <Check size={13} />{t("dashboard.networkProfilesApply")}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            <button type="button" data-preserve-content-focus="true" className="dw-network-profiles-scroll" onClick={() => scrollCarousel(1)} aria-label={t("dashboard.networkProfilesNext")}><ChevronRight size={16} /></button>
          </div>
        ) : (
          <button
            type="button"
            data-preserve-content-focus="true"
            className="dw-network-profiles-empty-action"
            onClick={() => setProfileForm({ profileId: null })}
          >
            <Plus size={18} />
            <span><strong>{t("dashboard.networkProfilesEmptyTitle")}</strong><small>{t("dashboard.networkProfilesEmptyHint")}</small></span>
          </button>
        )}
      </section>

      {profileForm ? (
        <ProfileDialog
          title={t(editingProfile ? "dashboard.networkProfilesEditTitle" : "dashboard.networkProfilesAddTitle")}
          initialValues={editingProfile
            ? formValuesFromFamilies(editingProfile.name, editingProfile.ipv4, editingProfile.ipv6, editingProfile.dnsServers)
            : selectedAdapter
              ? formValuesFromFamilies("", selectedAdapter.ipv4, selectedAdapter.ipv6, selectedAdapter.dnsServers)
              : UNCONFIGURED_FORM_VALUES}
          onCancel={() => setProfileForm(null)}
          onSave={saveProfile}
        />
      ) : null}
      {nicknameDialog !== null && selectedAdapter ? (
        <NameDialog
          title={t("dashboard.networkProfilesNicknameTitle")}
          label={t("dashboard.networkProfilesNicknameLabel")}
          initialValue={nicknameDialog}
          onCancel={() => setNicknameDialog(null)}
          onSave={saveNickname}
        />
      ) : null}
      {applyingProfile && selectedAdapter ? (
        <ConfirmSheet
          tone="info"
          icon="network"
          title={t("dashboard.networkProfilesApplyTitle")}
          message={t("dashboard.networkProfilesApplyBody", { profile: applyingProfile.name, adapter: adapterLabel(selectedAdapter) })}
          confirmLabel={t("dashboard.networkProfilesApply")}
          confirmIcon="bolt"
          onCancel={() => setApplyingProfile(null)}
          onConfirm={() => void applyProfile(applyingProfile)}
        />
      ) : null}
      {deleteProfile ? (
        <ConfirmSheet
          tone="danger"
          title={t("dashboard.networkProfilesDeleteTitle")}
          message={t("dashboard.networkProfilesDeleteBody", { name: deleteProfile.name })}
          confirmLabel={t("common.delete")}
          onCancel={() => setDeleteProfile(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}

function ProfileDialog({
  title,
  initialValues,
  onSave,
  onCancel,
}: {
  title: string;
  initialValues: NetworkProfileFormValues;
  onSave: (draft: NetworkProfileDraft) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<NetworkProfileFormValues>) => setValues((current) => ({ ...current, ...patch }));

  const familyErrorMessage = (field: FamilyFieldError, ipv6: boolean) => {
    const family = ipv6 ? "IPv6" : "IPv4";
    if (field === "address") return t("dashboard.networkProfilesInvalidAddress", { family });
    if (field === "gateway") return t("dashboard.networkProfilesInvalidGateway", { family });
    return t(ipv6 ? "dashboard.networkProfilesInvalidPrefix" : "dashboard.networkProfilesInvalidMask");
  };

  const submit = () => {
    const name = values.name.trim();
    if (!name) return;
    const ipv4 = buildManualFamily(values.ipv4Mode, values.ipv4Address, values.ipv4Mask, values.ipv4Gateway, false);
    if ("error" in ipv4) {
      setError(familyErrorMessage(ipv4.error, false));
      return;
    }
    const ipv6 = buildManualFamily(values.ipv6Mode, values.ipv6Address, values.ipv6Prefix, values.ipv6Gateway, true);
    if ("error" in ipv6) {
      setError(familyErrorMessage(ipv6.error, true));
      return;
    }
    const dnsServers = parseDnsServers(values.dnsServers);
    if (dnsServers === null) {
      setError(t("dashboard.networkProfilesInvalidDns"));
      return;
    }
    onSave({ name, ipv4: ipv4.family, ipv6: ipv6.family, dnsServers });
  };

  const modeOptions = [
    { value: "automatic", label: t("dashboard.networkProfilesMode.automatic") },
    { value: "manual", label: t("dashboard.networkProfilesMode.manual") },
    { value: "disabled", label: t("dashboard.networkProfilesMode.disabled") },
  ];

  return (
    <DialogShell onBackdrop={onCancel}>
      <Sheet
        width={520}
        title={title}
        footer={<Actions cancel={<Btn onClick={onCancel}>{t("common.cancel")}</Btn>} primary={<Btn kind="primary" icon="check" disabled={!values.name.trim()} onClick={submit}>{t("common.save")}</Btn>} />}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !(event.target instanceof HTMLSelectElement)) {
            event.preventDefault();
            submit();
          }
        }}
      >
        <div className="dw-network-profile-form" onChange={() => setError(null)}>
          <Field label={t("dashboard.networkProfilesProfileName")} req>
            <TextInput autoFocus maxLength={80} value={values.name} onChange={(event) => update({ name: event.currentTarget.value })} />
          </Field>
          <div className="dw-network-profile-form-family">
            <div className="dw-network-profile-form-family-head">
              <strong>IPv4</strong>
              <Select
                className="dw-network-profile-form-mode"
                aria-label={t("dashboard.networkProfilesFamilyMode", { family: "IPv4" })}
                options={modeOptions}
                value={values.ipv4Mode}
                onChange={(event) => update({ ipv4Mode: event.currentTarget.value as NetworkIpMode })}
              />
            </div>
            {values.ipv4Mode === "manual" ? (
              <div className="kk-field-grid" style={{ "--cols": 2 } as CSSProperties}>
                <Field label={t("dashboard.networkProfilesAddress")} req>
                  <TextInput mono value={values.ipv4Address} onChange={(event) => update({ ipv4Address: event.currentTarget.value })} />
                </Field>
                <Field label={t("dashboard.networkProfilesSubnetMask")} req>
                  <TextInput mono value={values.ipv4Mask} onChange={(event) => update({ ipv4Mask: event.currentTarget.value })} />
                </Field>
                <Field className="kk-col-span-2" label={t("dashboard.networkProfilesGateway")}>
                  <TextInput mono value={values.ipv4Gateway} onChange={(event) => update({ ipv4Gateway: event.currentTarget.value })} />
                </Field>
              </div>
            ) : null}
          </div>
          <div className="dw-network-profile-form-family">
            <div className="dw-network-profile-form-family-head">
              <strong>IPv6</strong>
              <Select
                className="dw-network-profile-form-mode"
                aria-label={t("dashboard.networkProfilesFamilyMode", { family: "IPv6" })}
                options={modeOptions}
                value={values.ipv6Mode}
                onChange={(event) => update({ ipv6Mode: event.currentTarget.value as NetworkIpMode })}
              />
            </div>
            {values.ipv6Mode === "manual" ? (
              <div className="kk-field-grid" style={{ "--cols": 2 } as CSSProperties}>
                <Field label={t("dashboard.networkProfilesAddress")} req>
                  <TextInput mono value={values.ipv6Address} onChange={(event) => update({ ipv6Address: event.currentTarget.value })} />
                </Field>
                <Field label={t("dashboard.networkProfilesPrefixLength")} req>
                  <TextInput mono inputMode="numeric" value={values.ipv6Prefix} onChange={(event) => update({ ipv6Prefix: event.currentTarget.value })} />
                </Field>
                <Field className="kk-col-span-2" label={t("dashboard.networkProfilesGateway")}>
                  <TextInput mono value={values.ipv6Gateway} onChange={(event) => update({ ipv6Gateway: event.currentTarget.value })} />
                </Field>
              </div>
            ) : null}
          </div>
          <Field label={t("dashboard.networkProfilesDns")} hint={t("dashboard.networkProfilesDnsHint")}>
            <TextInput mono value={values.dnsServers} onChange={(event) => update({ dnsServers: event.currentTarget.value })} />
          </Field>
          {error ? <p className="dw-network-profile-form-error" role="alert">{error}</p> : null}
        </div>
      </Sheet>
    </DialogShell>
  );
}

function FamilySummary({ label, family, t }: { label: string; family: NetworkFamilySnapshot; t: ReturnType<typeof useTranslation>["t"] }) {
  return <span><b>{label}</b><em>{t(`dashboard.networkProfilesMode.${family.mode}`)}</em><code>{firstAddress(family)}</code></span>;
}

function ModePill({ label, mode, t }: { label: string; mode: NetworkIpMode; t: ReturnType<typeof useTranslation>["t"] }) {
  return <b className={`dw-network-profile-mode is-${mode}`}>{label}<em>{t(`dashboard.networkProfilesMode.${mode}`)}</em></b>;
}

function NameDialog({ title, label, initialValue, onSave, onCancel }: { title: string; label: string; initialValue: string; onSave: (value: string) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const submit = () => value.trim() && onSave(value);
  return (
    <DialogShell onBackdrop={onCancel}>
      <Sheet
        width={420}
        title={title}
        footer={<Actions cancel={<Btn onClick={onCancel}>{t("common.cancel")}</Btn>} primary={<Btn kind="primary" icon="check" disabled={!value.trim()} onClick={submit}>{t("common.save")}</Btn>} />}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); submit(); }
          if (event.key === "Escape") { event.preventDefault(); onCancel(); }
        }}
      >
        <Field label={label} req><TextInput autoFocus maxLength={80} value={value} onChange={(event) => setValue(event.currentTarget.value)} /></Field>
      </Sheet>
    </DialogShell>
  );
}
