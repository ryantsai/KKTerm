// VLAN editor used by the integrated IPAM destination (docs/ITOPS.md VLAN).
//
// A VLAN is a durable record rather than a drawing detail: VLAN 30 drawn on two
// Network Maps has to be the same VLAN, and an IP Prefix documents which VLAN
// its addressing lives on. Nothing here reads a switch — like the rest of the
// Module, this is what the operator wrote down.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Actions,
  Btn,
  DialogShell,
  Field,
  Select,
  Sheet,
  TextArea,
  TextInput,
} from "../../app/ui/dialog";
import { useWorkspaceStore } from "../../store";
import type { Vlan } from "../../types";
import { useItOpsStore, type VlanInput } from "./state";
import { VLAN_ACCENTS } from "./vlanModel";

/** IEEE 802.1Q usable range; 0 and 4095 are reserved by the standard. */
const VID_MIN = 1;
const VID_MAX = 4094;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function VlanDialog({ vlan, onClose }: { vlan: Vlan | null; onClose: () => void }) {
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

  const parsed = Number(vid);
  const validVid =
    vid.trim() !== "" &&
    Number.isInteger(parsed) &&
    parsed >= VID_MIN &&
    parsed <= VID_MAX;
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
