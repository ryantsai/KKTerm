// Add / edit Rack Device type, appearance, placement, and metadata. Durable
// Connection associations are managed by RackItemBindingsDialog instead.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Actions,
  Btn,
  DialogShell,
  Field,
  Select,
  Sheet,
  Stepper,
  Swatches,
  TextArea,
  TextInput,
} from "../../app/ui/dialog";
import { useWorkspaceStore } from "../../store";
import type {
  Rack,
  RackDeviceInventory,
  RackItem,
  RackItemKind,
  RackItemMetadata,
  RackItemStatus,
  RackItemWidthFraction,
  RackMountFace,
  RackServerFormFactor,
  RackServerPanelStyle,
  RackShell,
  ResolvedHost,
} from "../../types";
import type { KuaiKuaiStyle } from "./KuaiKuaiBag";
import {
  normalizeRackItemMetadata,
  rackItemKindSupportsFractionalWidth,
  rackItemSlotCount,
} from "./rackInventory";
import { RackDevice } from "./RackDevice";
import { RackHostBindingDialog } from "./RackHostBindingDialog";
import { RackInventoryFields } from "./RackInventoryFields";
import { isDeviceInventoryValid, normalizeDeviceInventory } from "./rackDeviceInventory";
import { useItOpsStore } from "./state";

const SHELL_OPTIONS: RackShell[] = ["black", "white", "grey"];

export const RACK_ITEM_KINDS: RackItemKind[] = [
  "server",
  "storage",
  "switch",
  "router",
  "firewall",
  "pdu",
  "ups",
  "kvm",
  "patchPanel",
  "genericDevice",
  "kuaiguai",
];
const STATUS_OPTIONS: RackItemStatus[] = ["online", "warning", "offline"];

function showsPorts(kind: RackItemKind): boolean {
  return kind === "switch" || kind === "router" || kind === "patchPanel";
}

function showsDisks(kind: RackItemKind): boolean {
  return kind === "server" || kind === "storage" || kind === "connection";
}

function splitLines(value: string): string[] | null {
  const rows = value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
  return rows.length > 0 ? rows : null;
}

function joinValues(value: string[] | null | undefined): string {
  return (value ?? []).join("\n");
}

function clampStartUForHeight(startU: number, heightU: number, rackHeightU: number) {
  const maxStartU = Math.max(1, rackHeightU - heightU + 1);
  return Math.max(1, Math.min(maxStartU, startU));
}

const DISKS_PER_U = 24;

/** A configured-but-unplaced Rack Device: everything `placeRackItem` needs
 *  except the rack position, which the armed placement click supplies. */
export interface RackItemDraft {
  kind: RackItemKind;
  connectionId: string | null;
  label: string;
  heightU: number;
  mountFace: RackMountFace;
  metadata: RackItemMetadata;
}

export function RackItemDialog({
  siteId,
  rack,
  item,
  defaultKind,
  defaultMountFace = "front",
  members,
  onClose,
  onConfigured,
}: {
  siteId: string;
  rack: Rack;
  item?: RackItem | null;
  defaultKind?: RackItemKind;
  defaultMountFace?: RackMountFace;
  members: ResolvedHost[];
  onClose: () => void;
  /** Picker placement flow: instead of placing on save, hand the configured
   *  draft back so the caller can arm a cursor-tracked placement click. */
  onConfigured?: (draft: RackItemDraft) => void;
}) {
  const { t } = useTranslation();
  const isEdit = !!item;
  const initialMetadata = normalizeRackItemMetadata(item?.metadata ?? {});
  const initialKind = item?.kind ?? defaultKind ?? "server";
  const initialKuaiguaiStyle: KuaiKuaiStyle =
    initialMetadata.kuaiguaiStyle ?? (item?.kind === "kuaiguai" && item.heightU === 1 ? "laidDown" : "full");
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const placeRackItem = useItOpsStore((state) => state.placeRackItem);
  const updateRackItem = useItOpsStore((state) => state.updateRackItem);
  const removeRackItem = useItOpsStore((state) => state.removeRackItem);

  const [kind, setKind] = useState<RackItemKind>(initialKind);
  const [connectionId, setConnectionId] = useState<string>(
    item?.connectionId ?? members[0]?.connectionId ?? "",
  );
  const [label, setLabel] = useState(item?.label ?? "");
  const [startU, setStartU] = useState(item?.startU ?? 1);
  const [heightU, setHeightU] = useState(
    initialKind === "kuaiguai" ? (initialKuaiguaiStyle === "laidDown" ? 1 : 4) : item?.heightU ?? 1,
  );
  const [mountFace, setMountFace] = useState<RackMountFace>(
    item?.mountFace ?? defaultMountFace,
  );
  const [accent, setAccent] = useState(item?.metadata?.accent ?? "none");
  const [status, setStatus] = useState<RackItemStatus>(item?.metadata?.status ?? "online");
  const [ports, setPorts] = useState(item?.metadata?.ports ?? 24);
  const [disks, setDisks] = useState(item?.metadata?.disks ?? 4);
  const [battery, setBattery] = useState(item?.metadata?.battery ?? 90);
  const [load, setLoad] = useState(item?.metadata?.load ?? 60);
  const [shell, setShell] = useState<RackShell>(item?.metadata?.shell ?? "black");
  const [expiry, setExpiry] = useState(item?.metadata?.expiry ?? "");
  const [rotation, setRotation] = useState(item?.metadata?.rotation ?? -2);
  const kuaiguaiSize = "large" as const;
  const [kuaiguaiStyle, setKuaiguaiStyle] = useState<KuaiKuaiStyle>(initialKuaiguaiStyle);
  const [notes, setNotes] = useState(item?.metadata?.notes ?? "");
  const [tags, setTags] = useState(joinValues(item?.metadata?.tags));
  // The IT Ops Host this device is (docs/ITOPS.md Hosts); its child Hosts show
  // in the Rack View callout.
  const [hostId, setHostId] = useState(item?.metadata?.hostId ?? "");
  const [editingHostBinding, setEditingHostBinding] = useState(false);
  const [vendor, setVendor] = useState(item?.metadata?.vendor ?? "");
  const [inventory, setInventory] = useState<RackDeviceInventory>(initialMetadata.inventory ?? {});
  const [formFactor, setFormFactor] = useState<RackServerFormFactor>(
    initialMetadata.formFactor ?? "rack",
  );
  const [widthFraction, setWidthFraction] = useState<"full" | RackItemWidthFraction>(
    initialMetadata.widthFraction ?? "full",
  );
  const [slot, setSlot] = useState(initialMetadata.slot ?? 0);
  const [serverPanelStyle, setServerPanelStyle] = useState<RackServerPanelStyle>(
    initialMetadata.serverPanelStyle ?? "default",
  );
  // Kept as text so the field can be blank (= draw unknown).
  const [powerDraw, setPowerDraw] = useState(
    item?.metadata?.powerW ? String(item.metadata.powerW) : "",
  );
  const [busy, setBusy] = useState(false);
  const maxDisks = Math.max(1, heightU) * DISKS_PER_U;
  const placedStartU =
    kind === "kuaiguai" && startU === rack.heightU + 1
      ? startU
      : clampStartUForHeight(startU, heightU, rack.heightU);
  const previewLabel = label.trim() || t(`itops.racks.kind.${kind}`);
  const previewSlotCount = rackItemSlotCount(
    widthFraction === "full" ? null : widthFraction,
  );
  const parsedDraw = Number.parseInt(powerDraw, 10);
  const parsedPowerDraw = Number.isFinite(parsedDraw) && parsedDraw > 0 ? parsedDraw : null;
  // A 乖乖 package is decor: no status/shell/accent/power semantics.
  const isKuaiguai = kind === "kuaiguai";

  const metadata: RackItemMetadata = {
    inventory: normalizeDeviceInventory(inventory),
    accent: isKuaiguai || accent === "none" ? null : accent,
    status: isKuaiguai ? "online" : status,
    shell: isKuaiguai || shell === "black" ? null : shell,
    notes: notes.trim() || null,
    tags: splitLines(tags),
    connectionIds: initialMetadata.connectionIds,
    hostId: hostId || null,
    networkPorts: initialMetadata.networkPorts,
    snmp: initialMetadata.snmp,
    vendor: vendor.trim() || null,
    formFactor: kind === "server" ? formFactor : null,
    widthFraction:
      rackItemKindSupportsFractionalWidth(kind) && widthFraction !== "full" ? widthFraction : null,
    slot: rackItemKindSupportsFractionalWidth(kind) && widthFraction !== "full" ? slot : null,
    serverPanelStyle: kind === "server" ? serverPanelStyle : null,
    powerW: isKuaiguai ? null : parsedPowerDraw,
    ...(isKuaiguai
      ? {
          expiry: expiry.trim() || null,
          rotation,
          kuaiguaiSize,
          kuaiguaiStyle,
          rackTopCorner: initialMetadata.rackTopCorner,
          rackTopFacing: initialMetadata.rackTopFacing,
        }
      : {}),
    ...(showsPorts(kind) ? { ports } : {}),
    ...(showsDisks(kind) ? { disks } : {}),
    ...(kind === "ups" ? { battery } : {}),
    ...(kind === "pdu" ? { load } : {}),
  };

  const needsConnection = kind === "connection";
  const hasConnection = !needsConnection || connectionId.length > 0;
  const canSave = hasConnection && !busy && heightU >= 1 && startU >= 1 && isDeviceInventoryValid(inventory);
  // Picker flow: the dialog only configures the device; the rack position
  // comes from the armed placement click afterwards.
  const placementMode = !isEdit && !!onConfigured;

  function selectKind(next: RackItemKind) {
    setKind(next);
    if (next === "kuaiguai") {
      setHeightU(kuaiguaiStyle === "laidDown" ? 1 : 4);
    } else if (kind === "kuaiguai") {
      setHeightU(1);
      setStartU((current) => clampStartUForHeight(current, 1, rack.heightU));
    }
  }

  function selectKuaiguaiStyle(next: KuaiKuaiStyle) {
    const nextHeight = next === "laidDown" ? 1 : 4;
    setKuaiguaiStyle(next);
    setHeightU(nextHeight);
    if (startU <= rack.heightU) {
      setStartU((current) => clampStartUForHeight(current, nextHeight, rack.heightU));
    }
  }

  async function handleSave() {
    if (!canSave) return;
    const resolvedConnectionId = needsConnection ? connectionId : null;
    if (placementMode) {
      onConfigured!({
        kind,
        connectionId: resolvedConnectionId,
        label: label.trim(),
        heightU,
        mountFace,
        metadata,
      });
      onClose();
      return;
    }
    setBusy(true);
    try {
      if (isEdit) {
        await updateRackItem(siteId, {
          id: item!.id,
          kind,
          connectionId: resolvedConnectionId,
          label: label.trim(),
          mountFace,
          metadata,
          startU: placedStartU,
          heightU,
        });
      } else {
        await placeRackItem(siteId, {
          rackId: rack.id,
          connectionId: resolvedConnectionId,
          kind,
          label: label.trim(),
          startU: placedStartU,
          heightU,
          mountFace,
          metadata,
        });
      }
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!item) return;
    setBusy(true);
    try {
      await removeRackItem(siteId, item.id);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(t("itops.errorNotice", { message }), { tone: "error" });
      setBusy(false);
    }
  }

  return (
    <DialogShell onBackdrop={onClose} zClassName="itops-page">
      <Sheet
        width={760}
        className="rack-item-dialog"
        title={
          <>
            <span>{isEdit ? t("itops.racks.editItemTitle") : t("itops.racks.addItemTitle")}</span>
            <span className="rack-item-dialog-device-type">
              {t(`itops.racks.kind.${kind}`)}
            </span>
          </>
        }
        ariaLabel={isEdit ? t("itops.racks.editItemTitle") : t("itops.racks.addItemTitle")}
        footer={
          <Actions
            extraLeft={
              isEdit ? (
                <Btn kind="danger" onClick={() => void handleRemove()} disabled={busy}>
                  {t("itops.actions.delete")}
                </Btn>
              ) : undefined
            }
            cancel={<Btn onClick={onClose}>{t("itops.actions.cancel")}</Btn>}
            primary={
              <Btn kind="primary" onClick={() => void handleSave()} disabled={!canSave}>
                {isEdit ? t("itops.actions.save") : t("itops.racks.placeAction")}
              </Btn>
            }
          />
        }
      >
        <div className="rack-item-dialog-grid">
          <section className="rack-item-dialog-column type-column">
            <div className="rack-item-preview-block">
              <div className="rack-item-preview-stage">
                <div className="rack-item-preview-rack">
                  <span className="rack-item-preview-rail" />
                  <div className="rack-item-preview-bay">
                    <div
                      className={`rack-item-preview-device${
                        rackItemKindSupportsFractionalWidth(kind) && widthFraction === "quarter"
                          ? " quarter-width"
                          : ""
                      }`}
                      style={{
                        ["--rack-item-preview-height" as string]: `${Math.min(5, Math.max(1, heightU)) * 22}px`,
                        ...(rackItemKindSupportsFractionalWidth(kind) && widthFraction !== "full"
                          ? {
                              width: `${100 / previewSlotCount}%`,
                              marginLeft: `${(slot * 100) / previewSlotCount}%`,
                            }
                          : {}),
                      }}
                    >
                      <RackDevice
                        kind={kind}
                        label={previewLabel}
                        subLabel={vendor.trim() || null}
                        status={status}
                        ports={showsPorts(kind) ? ports : null}
                        disks={showsDisks(kind) ? disks : null}
                        battery={kind === "ups" ? battery : null}
                        load={kind === "pdu" ? load : null}
                        expiry={kind === "kuaiguai" ? expiry : null}
                        rotation={kind === "kuaiguai" ? rotation : null}
                        kuaiguaiSize={kind === "kuaiguai" ? kuaiguaiSize : null}
                        kuaiguaiStyle={kind === "kuaiguai" ? kuaiguaiStyle : null}
                        notes={kind === "kuaiguai" ? notes : null}
                        formFactor={kind === "server" ? formFactor : null}
                        serverPanelStyle={kind === "server" ? serverPanelStyle : null}
                        heightU={heightU}
                        accent={accent === "none" ? null : accent}
                        shell={shell}
                        seed={item?.id ?? `${kind}-${label}`}
                      />
                    </div>
                    <span className="rack-item-preview-empty-slot" />
                    <span className="rack-item-preview-empty-slot" />
                    <span className="rack-item-preview-empty-slot" />
                  </div>
                  <span className="rack-item-preview-rail" />
                </div>
              </div>
              <div className="rack-item-preview-caption">
                <strong>{previewLabel}</strong>
                <span>
                  {heightU}U · {t(`itops.racks.shell.${shell}`)}
                </span>
              </div>
            </div>

            {/* The picker placement flow already chose the type and an
                existing device keeps its type: the switcher grid only shows
                for the empty-slot add flow. */}
            {placementMode || isEdit ? null : (
              <div
                className="rack-kind-preview-grid"
                role="group"
                aria-label={t("itops.racks.kindPreviewLabel")}
              >
                {RACK_ITEM_KINDS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`rack-kind-preview${kind === value ? " selected" : ""}`}
                    aria-pressed={kind === value}
                    onClick={() => selectKind(value)}
                  >
                    <span className="rack-kind-preview-face">
                      <RackDevice
                        kind={value}
                        label={t(`itops.racks.kind.${value}`)}
                        subLabel={null}
                        status={status}
                        ports={showsPorts(value) ? ports : null}
                        disks={showsDisks(value) ? disks : null}
                        battery={value === "ups" ? battery : null}
                        load={value === "pdu" ? load : null}
                        expiry={value === "kuaiguai" ? expiry : null}
                        rotation={value === "kuaiguai" ? rotation : null}
                        kuaiguaiSize={value === "kuaiguai" ? kuaiguaiSize : null}
                        kuaiguaiStyle={value === "kuaiguai" ? kuaiguaiStyle : null}
                        formFactor={value === "server" ? formFactor : null}
                        serverPanelStyle={value === "server" ? serverPanelStyle : null}
                        heightU={1}
                        accent={accent === "none" ? null : accent}
                        shell={shell}
                        seed={`preview-${value}`}
                      />
                    </span>
                    <span className="rack-kind-preview-label">{t(`itops.racks.kind.${value}`)}</span>
                  </button>
                ))}
              </div>
            )}

            <Field label={t("itops.racks.labelLabel")}>
              <TextInput
                value={label}
                placeholder={t("itops.racks.labelPlaceholder")}
                onChange={(event) => setLabel(event.currentTarget.value)}
              />
            </Field>

            {kind === "server" || kind === "storage" || kind === "connection" ? (
              <Field label={t("itops.racks.vendorLabel")}>
                <TextInput value={vendor} onChange={(event) => setVendor(event.currentTarget.value)} />
              </Field>
            ) : null}

            <Field label={t("itops.racks.notesLabel")}>
              <TextArea className="rack-item-notes" rows={3} value={notes} onChange={(event) => setNotes(event.currentTarget.value)} />
            </Field>

            <Field label={t("itops.racks.tagsLabel")}>
              <TextArea className="rack-item-tags" rows={1} value={tags} onChange={(event) => setTags(event.currentTarget.value)} />
            </Field>

            {needsConnection ? (
              <Field label={t("itops.racks.connectionLabel")} req>
                {members.length === 0 ? (
                  <div className="hg-dlg-empty">{t("itops.racks.noMembers")}</div>
                ) : (
                  <Select
                    value={connectionId}
                    onChange={(event) => setConnectionId(event.currentTarget.value)}
                    options={members.map((member) => ({
                      value: member.connectionId,
                      label: `${member.name} (${member.host})`,
                    }))}
                  />
                )}
              </Field>
            ) : null}
          </section>

          <section className="rack-item-dialog-column form-column">
            {isKuaiguai ? null : (
              <Field label={t("itops.racks.mountingSideLabel")}>
                <div
                  className="rack-mount-face-segmented"
                  role="group"
                  aria-label={t("itops.racks.viewFaceLabel")}
                >
                  {(["front", "rear"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={mountFace === value}
                      data-active={mountFace === value || undefined}
                      onClick={() => setMountFace(value)}
                    >
                      {t(`itops.racks.face.${value}`)}
                    </button>
                  ))}
                </div>
              </Field>
            )}
            {kind === "server" ? (
              <div className="rack-form-grid two">
                <Field label={t("itops.racks.formFactorLabel")}>
                  <Select
                    value={formFactor}
                    onChange={(event) =>
                      setFormFactor(event.currentTarget.value as RackServerFormFactor)
                    }
                    options={(["rack", "tower"] as const).map((value) => ({
                      value,
                      label: t(`itops.racks.formFactor.${value}`),
                    }))}
                  />
                </Field>
                <Field label={t("itops.racks.serverPanelStyleLabel")}>
                  <Select
                    value={serverPanelStyle}
                    onChange={(event) =>
                      setServerPanelStyle(event.currentTarget.value as RackServerPanelStyle)
                    }
                    options={(["default", "style1", "style2"] as const).map((value) => ({
                      value,
                      label: t(`itops.racks.serverPanelStyle.${value}`),
                    }))}
                  />
                </Field>
              </div>
            ) : null}
            {isKuaiguai ? null : (
              <>
                <Field label={t("itops.racks.statusLabel")}>
                  <Select
                    value={status}
                    onChange={(event) => setStatus(event.currentTarget.value as RackItemStatus)}
                    options={STATUS_OPTIONS.map((value) => ({
                      value,
                      label: t(`itops.racks.status.${value}`),
                    }))}
                  />
                </Field>

                <Field label={t("itops.racks.shellLabel")}>
                  <div className="rack-item-shell-grid">
                    {SHELL_OPTIONS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`rack-item-shell-tile${shell === value ? " selected" : ""}`}
                        aria-pressed={shell === value}
                        onClick={() => setShell(value)}
                      >
                        <span className="rack-item-shell-face">
                          <RackDevice
                            kind={kind}
                            label=""
                            subLabel={null}
                            status={status}
                            ports={showsPorts(kind) ? ports : null}
                            disks={showsDisks(kind) ? disks : null}
                            battery={kind === "ups" ? battery : null}
                            load={kind === "pdu" ? load : null}
                            formFactor={kind === "server" ? formFactor : null}
                            serverPanelStyle={kind === "server" ? serverPanelStyle : null}
                            heightU={1}
                            accent={accent === "none" ? null : accent}
                            shell={value}
                            seed={`shell-${value}-${kind}`}
                          />
                        </span>
                        <span>{t(`itops.racks.shell.${value}`)}</span>
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label={t("itops.racks.accentLabel")}>
                  <Swatches value={accent} onChange={setAccent} allowNone noneLabel={t("itops.racks.accentNone")} />
                </Field>
              </>
            )}

            <div className="rack-form-grid two rack-device-dimensions">
              {showsPorts(kind) ? (
                <Field label={t("itops.racks.portsLabel")}>
                  <Stepper value={ports} min={0} onChange={(next) => setPorts(Math.max(0, Math.min(48, next)))} ariaDecrease={t("itops.racks.portsDecrease")} ariaIncrease={t("itops.racks.portsIncrease")} />
                </Field>
              ) : null}
              {showsDisks(kind) ? (
                <Field label={t("itops.racks.disksLabel")}>
                  <Stepper value={disks} min={0} onChange={(next) => setDisks(Math.max(0, Math.min(maxDisks, next)))} ariaDecrease={t("itops.racks.disksDecrease")} ariaIncrease={t("itops.racks.disksIncrease")} />
                </Field>
              ) : null}
              {kind === "ups" ? (
                <Field label={t("itops.racks.batteryLabel")}>
                  <Stepper value={battery} min={0} onChange={(next) => setBattery(Math.max(0, Math.min(100, next)))} ariaDecrease={t("itops.racks.batteryDecrease")} ariaIncrease={t("itops.racks.batteryIncrease")} />
                </Field>
              ) : null}
              {kind === "pdu" ? (
                <Field label={t("itops.racks.loadLabel")}>
                  <Stepper value={load} min={0} onChange={(next) => setLoad(Math.max(0, Math.min(100, next)))} ariaDecrease={t("itops.racks.loadDecrease")} ariaIncrease={t("itops.racks.loadIncrease")} />
                </Field>
              ) : null}
              {kind === "kuaiguai" ? null : (
                <Field label={t("itops.racks.itemHeightLabel")} req>
                  <Stepper value={heightU} min={1} onChange={(next) => { const clampedHeight = Math.max(1, Math.min(rack.heightU, next)); setHeightU(clampedHeight); setStartU((current) => clampStartUForHeight(current, clampedHeight, rack.heightU)); setDisks((current) => Math.min(current, clampedHeight * DISKS_PER_U)); }} ariaDecrease={t("itops.racks.itemHeightDecrease")} ariaIncrease={t("itops.racks.itemHeightIncrease")} />
                </Field>
              )}
              {rackItemKindSupportsFractionalWidth(kind) ? (
                <Field label={t("itops.racks.widthFractionLabel")}>
                  <Select
                    value={widthFraction}
                    onChange={(event) => {
                      const next = event.currentTarget.value as "full" | RackItemWidthFraction;
                      setWidthFraction(next);
                      setSlot((current) =>
                        Math.min(current, rackItemSlotCount(next === "full" ? null : next) - 1),
                      );
                    }}
                    options={(["full", "half", "quarter"] as const).map((value) => ({
                      value,
                      label: t(`itops.racks.widthFraction.${value}`),
                    }))}
                  />
                </Field>
              ) : null}
              {rackItemKindSupportsFractionalWidth(kind) && widthFraction !== "full" ? (
                <Field label={t("itops.racks.slotLabel")}>
                  <Select
                    value={String(slot)}
                    onChange={(event) => setSlot(Number(event.currentTarget.value))}
                    options={(widthFraction === "quarter"
                      ? (["left", "centerLeft", "centerRight", "right"] as const)
                      : (["left", "right"] as const)
                    ).map((position, index) => ({
                      value: String(index),
                      label: t(`itops.racks.slotPosition.${position}`),
                    }))}
                  />
                </Field>
              ) : null}
            </div>

            {isKuaiguai ? null : (
              <Field label={t("itops.racks.powerDrawLabel")} hint={t("itops.racks.powerDrawHint")}>
                <TextInput
                  type="number"
                  mono
                  min={0}
                  value={powerDraw}
                  onChange={(event) => setPowerDraw(event.currentTarget.value)}
                />
              </Field>
            )}

            {kind === "kuaiguai" ? (
              <div className="rack-form-grid rack-kuaiguai-fields">
                <Field label={t("itops.racks.kuaiguaiStyleLabel")}>
                  <Select
                    value={kuaiguaiStyle}
                    onChange={(event) => {
                      selectKuaiguaiStyle(event.currentTarget.value as KuaiKuaiStyle);
                    }}
                    options={(["full", "laidDown"] as const).map((styleValue) => ({
                      value: styleValue,
                      label: `${t(`itops.racks.kuaiguaiStyle.${styleValue}`)} · ${t("itops.racks.kuaiguaiSize.large")}`,
                    }))}
                  />
                </Field>
                <Field label={t("itops.racks.rotationLabel")}>
                  <div className="rack-kuaiguai-rotation">
                    <input type="range" min={-45} max={45} step={1} value={rotation} aria-label={t("itops.racks.rotationLabel")} onChange={(event) => setRotation(Number(event.currentTarget.value))} />
                    <output>{rotation}°</output>
                  </div>
                </Field>
                <Field label={t("itops.racks.expiryLabel")}>
                  <TextInput type="date" value={expiry} onChange={(event) => setExpiry(event.currentTarget.value)} />
                </Field>
              </div>
            ) : null}

            <button
              type="button"
              className="rack-host-bind-link"
              onClick={() => setEditingHostBinding(true)}
            >
              {t("itops.racks.boundHostCount", { count: hostId ? 1 : 0 })}
            </button>

          </section>
        </div>
        {kind === "server" || kind === "storage" || kind === "connection" || normalizeDeviceInventory(inventory) ? (
          <RackInventoryFields value={inventory} onChange={setInventory} disabled={busy} />
        ) : null}
      </Sheet>
      {editingHostBinding ? (
        <RackHostBindingDialog
          siteId={siteId}
          hostId={hostId}
          onApply={setHostId}
          onClose={() => setEditingHostBinding(false)}
        />
      ) : null}
    </DialogShell>
  );
}
