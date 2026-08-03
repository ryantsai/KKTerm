// Animated rack-device faceplate (docs/SITE.md Rack View). A presentation-only
// port of the "IT Ops Racks" design comp: each RackItemKind paints its own
// skeuomorphic 1U face — server fans + drive LEDs, switch/router port blink,
// firewall shield + throughput bars, storage disk grid, PDU outlets + load
// meter, UPS battery cells, KVM channels, patch panel, blanking plate. Status
// drives the LED column and dims an offline device. Port/disk "activity" is
// seeded from the item id so it stays stable across renders (no live polling).
//
// Hardware greys read the `--rkd-*` vars defined on `.rkd` in itops.css (a fixed
// physical-hardware palette, like the terminal surfaces); status/accent colour
// reads the shared theme tokens.

import { memo } from "react";
import type {
  RackItemKind,
  RackItemStatus,
  RackServerFormFactor,
  RackServerPanelStyle,
  RackShell,
  RackMountFace,
} from "../../types";
import { KuaiKuaiBag, type KuaiKuaiStyle } from "./KuaiKuaiBag";

export interface RackDeviceProps {
  kind: RackItemKind;
  label: string;
  /** Secondary line — a placed Connection's host/ip, when known. */
  subLabel?: string | null;
  status: RackItemStatus;
  ports?: number | null;
  disks?: number | null;
  battery?: number | null;
  load?: number | null;
  expiry?: string | null;
  rotation?: number | null;
  yaw?: number | null;
  kuaiguaiSize?: "small" | "regular" | "large" | null;
  kuaiguaiStyle?: KuaiKuaiStyle | null;
  /** Viewed cabinet face; only rack-top 乖乖 currently has distinct artwork. */
  face?: RackMountFace;
  /** Device notes, scribbled onto a large 乖乖 package's white note panel. */
  notes?: string | null;
  formFactor?: RackServerFormFactor | null;
  serverPanelStyle?: RackServerPanelStyle | null;
  /** Dense object-picker rendering that leaves more room for the faceplate name. */
  compact?: boolean;
  heightU: number;
  /** User accent override; falls back to the per-kind device colour. */
  accent?: string | null;
  /** Faceplate shell finish; defaults to metallic black (light text). */
  shell?: RackShell | null;
  /** Stable seed (the rack item id) for deterministic activity flicker. */
  seed: string;
}

// Per-kind device accent (used when the item has no explicit accent override).
const KIND_ACCENT: Record<RackItemKind, string> = {
  server: "#0a84ff",
  connection: "#0a84ff",
  storage: "#5e5ce6",
  switch: "#30d158",
  router: "#30b0c7",
  firewall: "#ff453a",
  pdu: "#ff9f0a",
  ups: "#bf5af2",
  kvm: "#64d2ff",
  patchPanel: "#8e8e93",
  blank: "#48484a",
  label: "#48484a",
  genericDevice: "#8e8e93",
  kuaiguai: "#30d158",
};

// FNV-1a hash → small-PRNG, mirrored from the comp so activity is deterministic.
function hash(str: string): number {
  let h = 2166136261;
  const s = String(str || "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUS_LED: Record<RackItemStatus, string> = {
  online: "var(--green)",
  warning: "var(--amber)",
  offline: "var(--red)",
};
const STATUS_GLOW: Record<RackItemStatus, string> = {
  online: "rgba(50,215,75,.6)",
  warning: "rgba(255,159,10,.6)",
  offline: "rgba(255,69,58,.55)",
};

export const RackDevice = memo(function RackDevice({
  kind,
  label,
  subLabel,
  status,
  ports,
  disks,
  battery,
  load,
  expiry,
  rotation,
  yaw,
  kuaiguaiStyle,
  face = "front",
  notes,
  formFactor,
  serverPanelStyle,
  compact = false,
  heightU,
  accent,
  shell,
  seed,
}: RackDeviceProps) {
  const rand = makeRng(hash(`${seed}|${kind}`));
  const offline = status === "offline";
  const devAccent = accent || KIND_ACCENT[kind] || "#8e8e93";

  const isPanel = kind === "patchPanel";
  const isBlankPlate = kind === "blank";
  const isLabel = kind === "label";
  const isBlank = isBlankPlate || isLabel;
  const isGenericDevice = kind === "genericDevice";
  const isKuaiguai = kind === "kuaiguai";
  const isServer = kind === "server" || kind === "connection";
  const isStorage = kind === "storage";
  const isSwitch = kind === "switch";
  const isRouter = kind === "router";
  const isFirewall = kind === "firewall";
  const isPdu = kind === "pdu";
  const isUps = kind === "ups";
  const isKvm = kind === "kvm";
  const panelStyle = kind === "server" ? serverPanelStyle ?? "default" : "default";
  const serverHeightBand = heightU >= 5 ? "chassis" : heightU >= 3 ? "dense" : "compact";
  const serverTopRatio = Math.min(40, 200 / Math.max(1, heightU));

  if (isKuaiguai) {
    return (
      <div
        className="rkd rkd-kuaiguai-only"
        data-kuaiguai-size="large"
        data-kuaiguai-style={kuaiguaiStyle ?? "full"}
        style={{
          ["--rkd-rotate" as string]: `${rotation ?? -2}deg`,
          ["--rkd-yaw" as string]: `${yaw ?? 0}deg`,
        }}
      >
        <KuaiKuaiBag
          style={kuaiguaiStyle ?? "full"}
          expiry={expiry}
          notes={notes}
          face={face}
        />
      </div>
    );
  }

  const statusLed = STATUS_LED[status];
  const statusGlow = STATUS_GLOW[status];
  const ledStatusClass = status === "warning" ? "led-warn" : offline ? "" : "led-ok";

  let portCap = isPanel || isSwitch ? 24 : 8;
  if (compact) portCap = isSwitch ? 6 : 4;
  const drawPorts = Math.min(ports || (isSwitch ? 12 : isRouter ? 5 : 0), portCap);
  const portList = Array.from({ length: drawPorts }, (_, i) => {
    const active = !offline && rand() > 0.34;
    return { active, color: active ? "var(--green)" : "var(--rkd-dim)", blk: active ? `blk-${(i % 5) + 1}` : "" };
  });

  // Storage bays are a fixed physical size (see itops.css): the 300px cabinet
  // gives every device the same face width and column count, and a taller
  // chassis simply stacks more rows. Cap the drive count to the rows that fit
  // the device height so a dense array (e.g. a 4U/64-drive box) fills the face
  // instead of overflowing past its clipped top and bottom edges. ~26px/U,
  // ~12px per bay row; ~8 bay columns across the fixed-width face.
  const maxStorageRows = Math.max(1, Math.floor((Math.max(1, heightU) * 26 - 4) / 12));
  const drawDisks = Math.min(
    disks || (isServer ? 4 : isStorage ? 8 : 0),
    compact ? 4 : isStorage ? 8 * maxStorageRows : Math.max(1, heightU) * 24,
  );
  const diskList = Array.from({ length: drawDisks }, (_, i) => {
    const busy = !offline && rand() > 0.42;
    return {
      busy,
      color: busy ? "var(--green)" : offline ? "var(--rkd-line)" : "var(--rkd-hi)",
      blk: busy ? `blk-${(i % 5) + 1}` : "",
    };
  });

  const panelPorts = isPanel
    ? Array.from({ length: Math.min(ports || 24, compact ? 4 : 24) }, (_, i) => i)
    : [];
  const outlets = isPdu ? (compact ? [0, 1, 2] : [0, 1, 2, 3, 4, 5]) : [];
  const fwBars = isFirewall
    ? (compact ? [0, 1, 2, 3] : [0, 1, 2, 3, 4, 5]).map((i) => `fwb-${(i % 3) + 1}`)
    : [];

  const batteryPct = Math.max(0, Math.min(100, battery ?? (offline ? 0 : 88)));
  const cells = isUps
    ? (compact ? [0, 1, 2] : [0, 1, 2, 3, 4]).map((i) => {
        const on = batteryPct > i * 20 + 4;
        const col = batteryPct < 30 ? "var(--amber)" : "var(--green)";
        return on ? col : "var(--rkd-cell-off)";
      })
    : [];
  const onBattery = status === "warning" || offline;
  const upsMode = onBattery ? "Battery" : "Online";
  const upsModeColor = onBattery ? "var(--amber)" : "var(--green)";
  const loadPct = Math.max(2, Math.min(100, load ?? 62));

  const channels = isKvm
    ? (compact ? [1, 2] : [1, 2, 3, 4]).map((n) => {
        const sel = n === 1;
        return {
          n,
          bg: sel ? "color-mix(in srgb,#64d2ff 22%,transparent)" : "var(--rkd-well)",
          fg: sel ? "#64d2ff" : "var(--text-faint)",
          border: sel ? "#64d2ff" : "var(--rkd-line)",
        };
      })
    : [];

  const hasName = !!label && !isBlankPlate;
  const showLeds = !isBlank && !isPanel && !isKuaiguai;

  return (
    <div
      className="rkd"
      data-shell={shell ?? undefined}
      data-compact={compact || undefined}
      data-form-factor={isServer ? formFactor ?? "rack" : undefined}
      data-server-panel-style={kind === "server" ? panelStyle : undefined}
      data-server-height-band={kind === "server" ? serverHeightBand : undefined}
      data-kuaiguai-size={isKuaiguai ? "large" : undefined}
      style={{
        ["--rkd-accent" as string]: devAccent,
        ["--rkd-rotate" as string]: `${rotation ?? -2}deg`,
        ["--rkd-yaw" as string]: `${yaw ?? 0}deg`,
        ["--rkd-server-top" as string]: `${serverTopRatio}%`,
        ["--rkd-server-top-mid" as string]: `${serverTopRatio / 2}%`,
      }}
    >
      {/* left rack ear */}
      <div className="rkd-ear">
        <span className="rkd-ear-bolt" />
        <span className="rkd-ear-bolt" />
      </div>

      <div className="rkd-body">
        {kind === "server" && panelStyle === "style1" ? (
          <div className="rkd-server-style1" data-height-band={serverHeightBand} aria-hidden="true">
            <span className="rkd-server-style1-control" />
            <div className="rkd-server-style1-center">
              <div className="rkd-server-style1-bays">
                {Array.from({ length: Math.max(8, Math.min(12, diskList.length)) }, (_, i) => (
                  <span className="rkd-server-style1-bay" key={i}>
                    <i className={i % 3 === 0 ? `blk-${(i % 5) + 1}` : undefined} />
                  </span>
                ))}
              </div>
              <svg
                className="rkd-server-style1-lattice"
                viewBox={serverHeightBand === "compact" ? "0 0 180 40" : "0 0 180 84"}
                preserveAspectRatio="none"
              >
                <g fill="none" stroke="currentColor" strokeWidth="4">
                  <path d="M-8 20 2 2h22l10 18-10 18H2Z" />
                  <path d="M32 20 42 2h22l10 18-10 18H42Z" />
                  <path d="M72 20 82 2h22l10 18-10 18H82Z" />
                  <path d="M112 20 122 2h22l10 18-10 18h-22Z" />
                  <path d="M152 20 162 2h22l10 18-10 18h-22Z" />
                  {serverHeightBand === "compact" ? null : (
                    <>
                      <path d="M12 62 22 44h22l10 18-10 18H22Z" />
                      <path d="M52 62 62 44h22l10 18-10 18H62Z" />
                      <path d="M92 62 102 44h22l10 18-10 18h-22Z" />
                      <path d="M132 62 142 44h22l10 18-10 18h-22Z" />
                      <path d="M172 62 182 44h22l10 18-10 18h-22Z" />
                    </>
                  )}
                </g>
                <path
                  className="rkd-server-style1-mark"
                  d={serverHeightBand === "compact" ? "m81 20 6-6h6l6 6-6 6h-6Z" : "m81 42 6-6h6l6 6-6 6h-6Z"}
                />
              </svg>
              {serverHeightBand === "chassis" ? (
                <div className="rkd-server-style1-lower">
                  {Array.from({ length: 6 }, (_, i) => (
                    <span className={i % 3 === 1 ? "short" : "tall"} key={i}><i /></span>
                  ))}
                </div>
              ) : null}
            </div>
            <span className="rkd-server-style1-io"><i /><i /><i /></span>
          </div>
        ) : kind === "server" && panelStyle === "style2" ? (
          <div className="rkd-server-style2" aria-hidden="true">
            <span className="rkd-server-style2-bezel left" />
            <div className="rkd-server-style2-core">
              <div className="rkd-server-style2-bays top">
                {Array.from({ length: 12 }, (_, i) => <i key={i} />)}
              </div>
              <span className="rkd-server-style2-rail upper" />
              <span className="rkd-server-style2-badge" />
              <span className="rkd-server-style2-rail lower" />
              <div className="rkd-server-style2-bays bottom">
                {Array.from({ length: Math.max(8, Math.min(12, diskList.length)) }, (_, i) => (
                  <i key={i} />
                ))}
              </div>
            </div>
            <span className="rkd-server-style2-bezel right" />
          </div>
        ) : null}

        {showLeds ? (
          <div className="rkd-leds">
            <span
              className={ledStatusClass}
              title="status"
              style={{ background: statusLed, boxShadow: `0 0 6px ${statusGlow}` }}
            />
          </div>
        ) : null}

        {hasName ? (
          <div className="rkd-id">
            <span className="rkd-name">{label}</span>
            {subLabel ? <span className="rkd-sub">{subLabel}</span> : null}
          </div>
        ) : null}

        <div className="rkd-visual">

          {/* SWITCH */}
          {isSwitch ? (
            <div className="rkd-switch">
              <div className="rkd-ports">
                {portList.map((port, i) => (
                  <span className="rkd-port" key={i}>
                    <span className={`rkd-port-led ${port.blk}`} style={{ background: port.color }} />
                  </span>
                ))}
              </div>
              <div className="shimmer rkd-shimmer" />
            </div>
          ) : null}

          {/* ROUTER */}
          {isRouter ? (
            <div className="rkd-router">
              <span className="rkd-wan-label">WAN</span>
              <span className="rkd-port wan">
                <span className="rkd-port-led blk-3" style={{ background: "var(--rkd-accent)" }} />
              </span>
              <div className="rkd-divider" />
              <div className="rkd-ports">
                {portList.map((port, i) => (
                  <span className="rkd-port" key={i}>
                    <span className={`rkd-port-led ${port.blk}`} style={{ background: port.color }} />
                  </span>
                ))}
              </div>
              <div className="shimmer rkd-shimmer" />
            </div>
          ) : null}

          {/* FIREWALL */}
          {isFirewall ? (
            <div className="rkd-firewall">
              <svg width="18" height="20" viewBox="0 0 24 26" fill="none">
                <path
                  d="M12 1.5 21 5v7c0 6.2-4.2 10.4-9 12.5C7.2 22.4 3 18.2 3 12V5l9-3.5Z"
                  fill="color-mix(in srgb,var(--rkd-accent) 18%,transparent)"
                  stroke="var(--rkd-accent)"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
                <path
                  d="M8.5 12.5 11 15l4.5-5"
                  stroke="var(--rkd-accent)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="rkd-fwbars">
                {fwBars.map((cls, i) => (
                  <span className={`rkd-fwbar ${cls}`} key={i} />
                ))}
              </div>
              <span className="rkd-fw-label">Secure</span>
            </div>
          ) : null}

          {/* SERVER / CONNECTION */}
          {isServer && panelStyle === "default" ? (
            <div className="rkd-server" data-panel-style={panelStyle}>
              <div className="rkd-disks-row">
                {diskList.map((disk, i) => (
                  <span className="rkd-disk-bay" key={i}>
                    <span className={`rkd-disk-led ${disk.blk}`} style={{ background: disk.color }} />
                  </span>
                ))}
              </div>
              <div className="rkd-vent" />
              <div className="rkd-fans">
                <span className="fan rkd-fan" />
                <span className="fan rkd-fan alt" />
              </div>
            </div>
          ) : null}

          {/* STORAGE */}
          {isStorage ? (
            <div className="rkd-storage">
              {diskList.map((disk, i) => (
                <span className="rkd-storage-bay" key={i}>
                  <span className={`rkd-disk-led ${disk.blk}`} style={{ background: disk.color }} />
                  <span className="rkd-storage-bar" />
                </span>
              ))}
            </div>
          ) : null}

          {/* PDU */}
          {isPdu ? (
            <div className="rkd-pdu" data-height-u={heightU}>
              <div className="rkd-outlets">
                {outlets.map((o) => (
                  <span className="rkd-outlet" key={o}>
                    <span className="rkd-outlet-pin" />
                    <span className="rkd-outlet-pin" />
                  </span>
                ))}
              </div>
              <div className="rkd-load">
                <div className="rkd-load-track">
                  <div className="rkd-load-fill" style={{ width: `${loadPct}%` }} />
                </div>
                <span className="rkd-load-pct">{loadPct}%</span>
              </div>
            </div>
          ) : null}

          {/* UPS */}
          {isUps ? (
            <div className="rkd-ups">
              <span className="charge rkd-bolt">⚡</span>
              <div className="rkd-cells">
                {cells.map((color, i) => (
                  <span className="rkd-cell" key={i} style={{ background: color }} />
                ))}
                <span className="rkd-cell-cap" />
              </div>
              <span className="rkd-ups-pct">{batteryPct}%</span>
              <span className="rkd-ups-mode" style={{ color: upsModeColor }}>
                {upsMode}
              </span>
            </div>
          ) : null}

          {/* KVM */}
          {isKvm ? (
            <div className="rkd-kvm">
              <div className="rkd-kvm-screens">
                <span className="rkd-kvm-screen">
                  <span className="rkd-kvm-screen-in" />
                </span>
                <span className="rkd-kvm-screen">
                  <span className="rkd-kvm-screen-in" />
                </span>
              </div>
              <div className="rkd-kvm-channels">
                {channels.map((ch) => (
                  <span
                    className="rkd-kvm-ch"
                    key={ch.n}
                    style={{ background: ch.bg, color: ch.fg, borderColor: ch.border }}
                  >
                    {ch.n}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* PATCH PANEL */}
          {isPanel ? (
            <div className="rkd-panel">
              {panelPorts.map((p) => (
                <span className="rkd-panel-port" key={p} />
              ))}
            </div>
          ) : null}

          {/* GENERIC DEVICE */}
          {isGenericDevice ? (
            <div className="rkd-equip">
              <div className="rkd-vent flex" />
              <span className="rkd-equip-label">{label}</span>
            </div>
          ) : null}

          {/* BLANK / LABEL */}
          {isBlank ? (
            <div className="rkd-blank">
              <div className="rkd-blank-plate" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});
