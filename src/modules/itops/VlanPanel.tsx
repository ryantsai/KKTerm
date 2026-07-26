// VLANs destination (docs/ITOPS.md VLAN) — a global Library page beside IPAM.
//
// A VLAN is a durable record rather than a drawing detail: VLAN 30 drawn on two
// Network Maps has to be the same VLAN, and an IP Prefix documents which VLAN
// its addressing lives on. Nothing here reads a switch — like the rest of the
// Module, this is what the operator wrote down.

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
import { useWorkspaceStore } from "../../store";
import type { Vlan } from "../../types";
import { ItIcon } from "./icons";
import { ItOpsEmptyHint } from "./ItOpsEmptyHint";
import { useItOpsStore, type VlanInput } from "./state";
import { VLAN_ACCENTS, vlanAccent } from "./vlanModel";

/** IEEE 802.1Q usable range; 0 and 4095 are reserved by the standard. */
const VID_MIN = 1;
const VID_MAX = 4094;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function VlanDialog({ vlan, onClose }: { vlan: Vlan | null; onClose: () => void }) {
  const { t } = useTranslation();
  const createVlan = useItOpsStore((state) => state.createVlan);
  const updateVlan = useItOpsStore((state) => state.updateVlan);
  const vlans = useItOpsStore((state) => state.vlans);
  const sites = useItOpsStore((state) => state.sites);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [vid, setVid] = useState(String(vlan?.vid ?? ""));
  const [name, setName] = useState(vlan?.name ?? "");
  const [description, setDescription] = useState(vlan?.description ?? "");
  const [siteId, setSiteId] = useState(vlan?.siteId ?? "");
  // New VLANs cycle through the accent list so a fresh set reads apart on the
  // Network Map overlay without the operator picking colours by hand.
  const [accent, setAccent] = useState(vlan?.accent ?? vlans.length % VLAN_ACCENTS.length);
  const [busy, setBusy] = useState(false);

  const parsed = Number.parseInt(vid, 10);
  const validVid = Number.isFinite(parsed) && parsed >= VID_MIN && parsed <= VID_MAX;
  const taken = vlans.some((entry) => entry.vid === parsed && entry.id !== vlan?.id);

  async function save() {
    if (!validVid || taken || busy) return;
    setBusy(true);
    const input: VlanInput = {
      vid: parsed,
      name: name.trim(),
      description,
      siteId: siteId || null,
      accent,
    };
    try {
      if (vlan) await updateVlan(vlan.id, input);
      else await createVlan(input);
      showStatusBarNotice(t("itops.vlan.savedNotice", { vid: parsed }), { tone: "success" });
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
        width={460}
        title={vlan ? t("itops.vlan.editTitle") : t("itops.vlan.newTitle")}
        footer={
          <Actions
            cancel={<Btn onClick={onClose}>{t("itops.actions.cancel")}</Btn>}
            primary={
              <Btn
                kind="primary"
                icon="check"
                onClick={() => void save()}
                disabled={!validVid || taken || busy}
              >
                {t("itops.actions.save")}
              </Btn>
            }
          />
        }
      >
        <Field
          label={t("itops.vlan.vidLabel")}
          req
          hint={taken ? t("itops.vlan.vidTaken") : t("itops.vlan.vidHint")}
        >
          <TextInput
            mono
            type="number"
            min={VID_MIN}
            max={VID_MAX}
            step={1}
            value={vid}
            placeholder={t("itops.vlan.vidPlaceholder")}
            onChange={(event) => setVid(event.currentTarget.value)}
          />
        </Field>
        <Field label={t("itops.vlan.nameLabel")}>
          <TextInput
            value={name}
            placeholder={t("itops.vlan.namePlaceholder")}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </Field>
        <Field label={t("itops.vlan.accentLabel")} hint={t("itops.vlan.accentHint")}>
          <div className="it-vlan-swatches" role="radiogroup" aria-label={t("itops.vlan.accentLabel")}>
            {VLAN_ACCENTS.map((color, index) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={accent === index}
                aria-label={t("itops.vlan.accentOption", { index: index + 1 })}
                className={`it-vlan-swatch${accent === index ? " sel" : ""}`}
                style={{ "--it-vlan-accent": color } as React.CSSProperties}
                onClick={() => setAccent(index)}
              />
            ))}
          </div>
        </Field>
        <Field label={t("itops.vlan.siteLabel")} hint={t("itops.vlan.siteHint")}>
          <Select
            value={siteId}
            onChange={(event) => setSiteId(event.currentTarget.value)}
            options={[
              { value: "", label: t("itops.vlan.siteUnscoped") },
              ...sites.map((site) => ({ value: site.id, label: site.name })),
            ]}
          />
        </Field>
        <Field label={t("itops.vlan.descriptionLabel")}>
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

export function VlanPanel() {
  const { t } = useTranslation();
  const vlans = useItOpsStore((state) => state.vlans);
  const loaded = useItOpsStore((state) => state.vlansLoaded);
  const loadVlans = useItOpsStore((state) => state.loadVlans);
  const removeVlan = useItOpsStore((state) => state.removeVlan);
  const ipam = useItOpsStore((state) => state.ipam);
  const ipamLoaded = useItOpsStore((state) => state.ipamLoaded);
  const loadIpam = useItOpsStore((state) => state.loadIpam);
  const sites = useItOpsStore((state) => state.sites);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);

  const [dialog, setDialog] = useState<Vlan | null | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<Vlan | null>(null);

  useEffect(() => {
    if (!loaded) void loadVlans().catch(() => undefined);
  }, [loaded, loadVlans]);

  // The prefix list is what makes a VLAN row worth reading, so this page pulls
  // IPAM in rather than waiting for the operator to visit that destination.
  useEffect(() => {
    if (!ipamLoaded) void loadIpam().catch(() => undefined);
  }, [ipamLoaded, loadIpam]);

  const siteNames = useMemo(() => new Map(sites.map((site) => [site.id, site.name])), [sites]);
  const prefixesByVlan = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const prefix of ipam.prefixes) {
      if (!prefix.vlanId) continue;
      map.set(prefix.vlanId, [...(map.get(prefix.vlanId) ?? []), prefix.cidr]);
    }
    return map;
  }, [ipam.prefixes]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    const vlan = pendingDelete;
    setPendingDelete(null);
    try {
      await removeVlan(vlan.id);
      showStatusBarNotice(t("itops.vlan.deletedNotice", { vid: vlan.vid }), { tone: "success" });
    } catch (error) {
      showStatusBarNotice(t("itops.errorNotice", { message: errorMessage(error) }), {
        tone: "error",
      });
    }
  }

  return (
    <div className="it-vlan-page it-destination-surface" data-tutorial-id="itops.vlans">
      <div className="it-destination-page-head">
        <div>
          <h2>{t("itops.vlan.heading")}</h2>
          <p>{t("itops.vlan.pageDescription")}</p>
        </div>
        <button
          type="button"
          className="it-btn primary"
          data-tutorial-id="itops.vlanNew"
          onClick={() => setDialog(null)}
        >
          <ItIcon name="plus" size={14} />
          {t("itops.vlan.newTitle")}
        </button>
      </div>

      {vlans.length > 0 ? (
        <div className="it-task-table-shell">
          <div className="it-vlan-table" role="table">
            <div className="it-vlan-head" role="row">
              <span>{t("itops.vlan.columnVid")}</span>
              <span>{t("itops.vlan.columnName")}</span>
              <span>{t("itops.vlan.columnPrefixes")}</span>
              <span>{t("itops.vlan.columnSite")}</span>
              <span>{t("itops.vlan.columnActions")}</span>
            </div>
            {vlans.map((vlan) => {
              const prefixes = prefixesByVlan.get(vlan.id) ?? [];
              return (
                <div key={vlan.id} className="it-vlan-row" role="row">
                  <span className="it-vlan-vid">
                    <em
                      className="it-vlan-dot"
                      style={{ "--it-vlan-accent": vlanAccent(vlan) } as React.CSSProperties}
                    />
                    <strong>{vlan.vid}</strong>
                  </span>
                  <span>
                    <strong>{vlan.name || t("itops.vlan.unnamed")}</strong>
                    {vlan.description ? <small>{vlan.description}</small> : null}
                  </span>
                  <span className="it-vlan-prefixes">
                    {prefixes.length > 0 ? prefixes.join(", ") : "—"}
                  </span>
                  <span>
                    {vlan.siteId
                      ? siteNames.get(vlan.siteId) ?? t("itops.vlan.siteUnscoped")
                      : t("itops.vlan.siteUnscoped")}
                  </span>
                  <span className="it-task-row-actions">
                    <button
                      type="button"
                      className="it-icon-btn"
                      aria-label={t("itops.actions.edit")}
                      onClick={() => setDialog(vlan)}
                    >
                      <ItIcon name="edit" size={14} />
                    </button>
                    <button
                      type="button"
                      className="it-icon-btn"
                      aria-label={t("itops.actions.delete")}
                      onClick={() => setPendingDelete(vlan)}
                    >
                      <ItIcon name="trash" size={14} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : loaded ? (
        <ItOpsEmptyHint>{t("itops.vlan.emptyBody")}</ItOpsEmptyHint>
      ) : null}

      {dialog !== undefined ? (
        <VlanDialog vlan={dialog} onClose={() => setDialog(undefined)} />
      ) : null}
      {pendingDelete ? (
        <ConfirmSheet
          tone="danger"
          title={t("itops.vlan.deleteTitle")}
          message={t("itops.vlan.deleteBody", { vid: pendingDelete.vid })}
          confirmLabel={t("itops.actions.delete")}
          confirmIcon="trash"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
