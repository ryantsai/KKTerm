import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type SetStateAction } from "react";
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
import { Actions, Btn, ConfirmSheet, DialogShell, Field, Sheet, TextInput } from "../../../../../app/ui/dialog";
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

interface SavedNetworkProfile {
  id: string;
  name: string;
  createdAt: number;
  ipv4: NetworkFamilySnapshot;
  ipv6: NetworkFamilySnapshot;
  dnsServers: string[];
}

interface NetworkProfilesConfig {
  profiles: SavedNetworkProfile[];
  adapterNicknames: Record<string, string>;
  selectedAdapterId: string | null;
  selectedProfileId: string | null;
}

const DEFAULT_CONFIG: NetworkProfilesConfig = {
  profiles: [],
  adapterNicknames: {},
  selectedAdapterId: null,
  selectedProfileId: null,
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
    selectedProfileId: typeof candidate.selectedProfileId === "string" ? candidate.selectedProfileId : null,
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

function profileFromAdapter(name: string, adapter: NetworkAdapterSnapshot): SavedNetworkProfile {
  return {
    id: newId(),
    name,
    createdAt: Date.now(),
    ipv4: structuredClone(adapter.ipv4),
    ipv6: structuredClone(adapter.ipv6),
    dnsServers: [...adapter.dnsServers],
  };
}

type NameDialogState =
  | { kind: "saveProfile"; initialValue: string }
  | { kind: "renameProfile"; profileId: string; initialValue: string }
  | { kind: "nickname"; initialValue: string }
  | null;

export function NetworkProfilesBody(_props: BuiltInWidgetBodyProps) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [config, setConfig] = useNetworkProfilesConfig();
  const [snapshot, setSnapshot] = useState<NetworkProfilesSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [applyingProfile, setApplyingProfile] = useState<SavedNetworkProfile | null>(null);
  const [deleteProfile, setDeleteProfile] = useState<SavedNetworkProfile | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState>(null);
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
  const selectedProfile = config.profiles.find((profile) => profile.id === config.selectedProfileId)
    ?? config.profiles[0]
    ?? null;
  const canApply = snapshot?.capability === "supported"
    && (snapshot.platform !== "linux" || Boolean(selectedAdapter?.serviceId));
  const adapterLabel = (adapter: NetworkAdapterSnapshot) => config.adapterNicknames[adapter.id] || adapter.name;

  function selectProfile(profileId: string) {
    setConfig((current) => ({ ...current, selectedProfileId: profileId }));
  }

  function saveName(value: string) {
    const name = value.trim();
    if (!name || !selectedAdapter || !nameDialog) return;
    if (nameDialog.kind === "saveProfile") {
      const profile = profileFromAdapter(name, selectedAdapter);
      setConfig((current) => ({
        ...current,
        profiles: [...current.profiles, profile].slice(-100),
        selectedProfileId: profile.id,
      }));
      showStatusBarNotice(t("dashboard.networkProfilesSaved", { name }), { tone: "success" });
    } else if (nameDialog.kind === "renameProfile") {
      setConfig((current) => ({
        ...current,
        profiles: current.profiles.map((profile) => profile.id === nameDialog.profileId ? { ...profile, name } : profile),
      }));
    } else {
      setConfig((current) => ({
        ...current,
        adapterNicknames: { ...current.adapterNicknames, [selectedAdapter.id]: name },
      }));
      showStatusBarNotice(t("dashboard.networkProfilesNicknameSaved", { name }), { tone: "success" });
    }
    setNameDialog(null);
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
      selectedProfileId: current.selectedProfileId === id ? null : current.selectedProfileId,
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
            onClick={() => setNameDialog({ kind: "nickname", initialValue: adapterLabel(selectedAdapter) })}
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
          <span>{config.profiles.length}</span>
        </div>
        {config.profiles.length > 0 ? (
          <div className="dw-network-profiles-carousel-shell">
            <button type="button" data-preserve-content-focus="true" className="dw-network-profiles-scroll" onClick={() => scrollCarousel(-1)} aria-label={t("dashboard.networkProfilesPrevious")}><ChevronLeft size={16} /></button>
            <div ref={carouselRef} className="dw-network-profiles-carousel">
              {config.profiles.map((profile) => (
                <article
                  key={profile.id}
                  className={`dw-network-profile-card${profile.id === selectedProfile?.id ? " is-selected" : ""}`}
                  onClick={() => selectProfile(profile.id)}
                >
                  <div className="dw-network-profile-card-head">
                    <strong>{profile.name}</strong>
                    <div className="dw-network-profile-card-actions">
                      <button type="button" data-preserve-content-focus="true" aria-label={t("dashboard.networkProfilesRenameProfile")} title={t("dashboard.networkProfilesRenameProfile")} onClick={(event) => { event.stopPropagation(); setNameDialog({ kind: "renameProfile", profileId: profile.id, initialValue: profile.name }); }}><Edit3 size={13} /></button>
                      <button type="button" data-preserve-content-focus="true" aria-label={t("dashboard.networkProfilesDeleteProfile")} title={t("dashboard.networkProfilesDeleteProfile")} onClick={(event) => { event.stopPropagation(); setDeleteProfile(profile); }}><Trash2 size={13} /></button>
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
                    <button
                      type="button"
                      data-preserve-content-focus="true"
                      className="dw-network-profile-apply"
                      disabled={!selectedAdapter || !canApply}
                      onClick={(event) => { event.stopPropagation(); setApplyingProfile(profile); }}
                    >
                      <Check size={13} />{t("dashboard.networkProfilesApply")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <button type="button" data-preserve-content-focus="true" className="dw-network-profiles-scroll" onClick={() => scrollCarousel(1)} aria-label={t("dashboard.networkProfilesNext")}><ChevronRight size={16} /></button>
          </div>
        ) : (
          <button
            type="button"
            data-preserve-content-focus="true"
            className="dw-network-profiles-empty-action"
            disabled={!selectedAdapter}
            onClick={() => setNameDialog({ kind: "saveProfile", initialValue: "" })}
          >
            <Plus size={18} />
            <span><strong>{t("dashboard.networkProfilesEmptyTitle")}</strong><small>{t("dashboard.networkProfilesEmptyHint")}</small></span>
          </button>
        )}
      </section>

      <footer className="dw-network-profiles-footer">
        <button
          type="button"
          data-preserve-content-focus="true"
          className="dw-network-profiles-save"
          disabled={!selectedAdapter}
          onClick={() => setNameDialog({ kind: "saveProfile", initialValue: "" })}
        ><Plus size={15} />{t("dashboard.networkProfilesSaveCurrent")}</button>
        {selectedProfile ? <span>{t("dashboard.networkProfilesSelected", { name: selectedProfile.name })}</span> : null}
      </footer>

      {nameDialog ? (
        <NameDialog
          title={nameDialog.kind === "nickname" ? t("dashboard.networkProfilesNicknameTitle") : nameDialog.kind === "renameProfile" ? t("dashboard.networkProfilesRenameTitle") : t("dashboard.networkProfilesSaveTitle")}
          label={nameDialog.kind === "nickname" ? t("dashboard.networkProfilesNicknameLabel") : t("dashboard.networkProfilesProfileName")}
          initialValue={nameDialog.initialValue}
          onCancel={() => setNameDialog(null)}
          onSave={saveName}
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
