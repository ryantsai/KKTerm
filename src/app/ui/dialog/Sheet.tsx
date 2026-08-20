// Apple/Finder dialog primitives for KKTerm, ported from the design-language
// reference kit and wired to the app token system. Class names are kk- prefixed
// and styled by dialogs.css. All user-visible text is passed in by callers
// (already translated) — these primitives contain no hard-coded copy.
import {
  createContext,
  useContext,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { technicalInputProps } from "../../../lib/inputBehavior";
import { isMacPlatform } from "../../../lib/platform";
import { DIcon, type DialogIconName } from "./icons";

/* --------------------- UI convention (mac / windows) ------------------- */
// macOS:        [ auxiliary … ]   spacer   Cancel   Primary
// Windows/Linux:[ auxiliary … ]   spacer   Primary  Cancel
// The default follows the host platform; a provider can override for previews.
export type DialogConvention = "mac" | "windows";
const ConvCtx = createContext<DialogConvention>(isMacPlatform() ? "mac" : "windows");
export function useDialogConvention() {
  return useContext(ConvCtx);
}
export function DialogConventionProvider({
  value,
  children,
}: {
  value: DialogConvention;
  children: ReactNode;
}) {
  return <ConvCtx.Provider value={value}>{children}</ConvCtx.Provider>;
}

export function Actions({
  cancel,
  primary,
  extraLeft,
}: {
  cancel?: ReactNode;
  primary?: ReactNode;
  extraLeft?: ReactNode;
}) {
  const conv = useDialogConvention();
  // Windows/Linux: [ Auxiliary … ] spacer [ Primary  Cancel ].
  // macOS:         [ Auxiliary … ] spacer [ Cancel  Primary ].
  if (conv === "windows") {
    return (
      <>
        {extraLeft ?? null}
        <span className="kk-spacer" />
        {primary}
        {cancel}
      </>
    );
  }
  return (
    <>
      {extraLeft ?? null}
      <span className="kk-spacer" />
      {cancel}
      {primary}
    </>
  );
}

/* ------------------------------ backdrop ------------------------------- */
export function DialogShell({
  children,
  onBackdrop,
  zClassName,
}: {
  children: ReactNode;
  onBackdrop?: () => void;
  zClassName?: string;
}) {
  if (typeof document === "undefined") {
    return <>{children}</>;
  }
  return createPortal(
    <div
      className={`kk-dlg-backdrop${zClassName ? ` ${zClassName}` : ""}`}
      role="presentation"
      onMouseDown={(event) => {
        if (onBackdrop && event.target === event.currentTarget) {
          onBackdrop();
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ------------------------------ sheet ---------------------------------- */
export function Sheet({
  width = 540,
  height,
  eyebrow,
  title,
  sub,
  onClose,
  rule,
  children,
  footer,
  className = "",
  ariaLabel,
  closeAriaLabel,
}: {
  width?: number;
  height?: number;
  eyebrow?: ReactNode;
  title?: ReactNode;
  sub?: ReactNode;
  /** Pass only when there is NO footer dismiss action (AGENTS.md close-X rule). */
  onClose?: () => void;
  rule?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  ariaLabel?: string;
  closeAriaLabel?: string;
}) {
  const hasHead = Boolean(eyebrow || title || sub || onClose);
  return (
    <div
      className={`kk-dlg ${className}`.trim()}
      style={{ width, height, maxHeight: "100%" }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
    >
      {hasHead && (
        <div className={`kk-dlg-head${rule ? " with-rule" : ""}`}>
          {eyebrow && <p className="kk-dlg-eyebrow">{eyebrow}</p>}
          {title && <h2 className="kk-dlg-title">{title}</h2>}
          {sub && <p className="kk-dlg-sub">{sub}</p>}
          {onClose && (
            <button className="kk-dlg-close" onClick={onClose} type="button" aria-label={closeAriaLabel ?? ariaLabel}>
              <DIcon name="close" size={14} />
            </button>
          )}
        </div>
      )}
      <div className="kk-dlg-body">{children}</div>
      {footer && <div className="kk-dlg-foot">{footer}</div>}
    </div>
  );
}

/* ------------------------------ field ---------------------------------- */
export function Field({
  label,
  req,
  hint,
  children,
  className = "",
  style,
}: {
  label?: ReactNode;
  req?: boolean;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <label className={`kk-field ${className}`.trim()} style={style}>
      {label && (
        <span className="kk-lbl">
          {label}
          {req && <span className="kk-req">*</span>}
        </span>
      )}
      {children}
      {hint && <span className="kk-hint">{hint}</span>}
    </label>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean };
export function TextInput({ mono, className = "", ...rest }: InputProps) {
  return <input className={`kk-inp${mono ? " mono" : ""} ${className}`.trim()} {...technicalInputProps} {...rest} />;
}

type AreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: Ref<HTMLTextAreaElement>;
};
export function TextArea({ rows = 4, className = "", ...rest }: AreaProps) {
  return <textarea className={`kk-inp ${className}`.trim()} rows={rows} {...technicalInputProps} {...rest} />;
}

type SelectOption = string | { value: string; label: string };
export function Select({
  options,
  className = "",
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { options: SelectOption[] }) {
  return (
    <div className={`kk-sel ${className}`.trim()}>
      <select {...rest}>
        {options.map((option) => {
          const value = typeof option === "string" ? option : option.value;
          const label = typeof option === "string" ? option : option.label;
          return (
            <option key={value} value={value}>
              {label}
            </option>
          );
        })}
      </select>
      <span className="kk-chev">
        <DIcon name="updown" size={13} />
      </span>
    </div>
  );
}

export function Switch({
  on,
  onChange,
  disabled,
  ariaLabel,
}: {
  on?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [internal, setInternal] = useState(Boolean(on));
  const current = on === undefined ? internal : on;
  return (
    <button
      type="button"
      className={`kk-switch${current ? " on" : ""}`}
      aria-pressed={current}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => (onChange ? onChange(!current) : setInternal(!current))}
    >
      <span className="kk-knob" />
    </button>
  );
}

type SegOption = { value: string; label: ReactNode; icon?: DialogIconName };
export function Segmented({
  value,
  options,
  onChange,
}: {
  value?: string;
  options: SegOption[];
  onChange?: (value: string) => void;
}) {
  const [internal, setInternal] = useState(value ?? options[0]?.value);
  const current = value === undefined ? internal : value;
  return (
    <div className="kk-seg" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={current === option.value}
          className={current === option.value ? "active" : ""}
          onClick={() => (onChange ? onChange(option.value) : setInternal(option.value))}
        >
          {option.icon && <DIcon name={option.icon} size={14} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export type ButtonKind = "" | "primary" | "danger" | "ghost";
export function Btn({
  kind = "",
  icon,
  children,
  sm,
  wide,
  onClick,
  type = "button",
  disabled,
  className = "",
}: {
  kind?: ButtonKind;
  icon?: DialogIconName;
  children?: ReactNode;
  sm?: boolean;
  wide?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`kk-btn${kind ? ` ${kind}` : ""}${sm ? " sm" : ""}${wide ? " wide" : ""} ${className}`.trim()}
    >
      {icon && <DIcon name={icon} size={sm ? 13 : 15} />}
      {children}
    </button>
  );
}

export function Group({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="kk-group-wrap">
      <div className="kk-group">{children}</div>
      {title && <div className="kk-group-title">{title}</div>}
    </div>
  );
}

export function GRow({
  icon,
  iconBg,
  label,
  desc,
  val,
  control,
}: {
  icon?: DialogIconName;
  iconBg?: string;
  label: ReactNode;
  desc?: ReactNode;
  val?: ReactNode;
  control?: ReactNode;
}) {
  return (
    <div className="kk-grow">
      {icon &&
        (iconBg ? (
          <span className="kk-ni-ico" style={{ background: iconBg, width: 24, height: 24 }}>
            <DIcon name={icon} size={14} />
          </span>
        ) : (
          <span className="kk-gl-ico">
            <DIcon name={icon} size={17} />
          </span>
        ))}
      <div className="kk-gl-main">
        <span className="kk-gl-label">{label}</span>
        {desc && <span className="kk-gl-desc">{desc}</span>}
      </div>
      <div className="kk-gl-ctl">
        {val && <span className="kk-gl-val">{val}</span>}
        {control}
      </div>
    </div>
  );
}

export function Stepper({
  value,
  min = 1,
  onChange,
  ariaDecrease,
  ariaIncrease,
}: {
  value: number;
  min?: number;
  onChange?: (next: number) => void;
  ariaDecrease?: string;
  ariaIncrease?: string;
}) {
  const [internal, setInternal] = useState(value);
  const current = onChange ? value : internal;
  const set = (next: number) => (onChange ? onChange(next) : setInternal(next));
  return (
    <div className="kk-stepper">
      <button type="button" aria-label={ariaDecrease} onClick={() => set(Math.max(min, current - 1))}>
        <DIcon name="minus" size={13} />
      </button>
      <input
        value={current}
        inputMode="numeric"
        onChange={(event) => set(Number(event.currentTarget.value) || current)}
      />
      <button type="button" aria-label={ariaIncrease} onClick={() => set(current + 1)}>
        <DIcon name="plus" size={13} />
      </button>
    </div>
  );
}

export const DIALOG_ACCENTS = [
  "#0a84ff",
  "#5e5ce6",
  "#bf5af2",
  "#ff375f",
  "#ff9f0a",
  "#34c759",
  "#30b0c7",
  "#8e8e93",
  "#ffffff",
] as const;

export function Swatches({
  accents = DIALOG_ACCENTS as readonly string[],
  value,
  onChange,
  allowNone,
  noneLabel,
}: {
  accents?: readonly string[];
  value?: string;
  onChange?: (value: string) => void;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const [internal, setInternal] = useState(value ?? accents[0]);
  const current = value === undefined ? internal : value;
  const set = (next: string) => (onChange ? onChange(next) : setInternal(next));
  return (
    <div className="kk-conn-swatches">
      {allowNone && (
        <button
          type="button"
          className={`kk-swatch none${current === "none" ? " sel" : ""}`}
          aria-label={noneLabel}
          onClick={() => set("none")}
        />
      )}
      {accents.map((color) => (
        <button
          key={color}
          type="button"
          className={`kk-swatch${current === color ? " sel" : ""}`}
          style={{ background: color }}
          aria-label={color}
          onClick={() => set(color)}
        />
      ))}
    </div>
  );
}

/* ----------------------- connection identity tile ---------------------- */
export type ConnTileType =
  | "local"
  | "localFiles"
  | "ssh"
  | "telnet"
  | "rdp"
  | "vnc"
  | "ftp"
  | "url"
  | "serial";

const TILE_BG: Record<string, string> = {
  local: "linear-gradient(160deg,#3a3a3c,#1c1c1e)",
  localFiles: "linear-gradient(160deg,#3a3a3c,#1c1c1e)",
  ssh: "linear-gradient(160deg,#0a84ff,#0060df)",
  telnet: "linear-gradient(160deg,#5e5ce6,#3634a3)",
  rdp: "linear-gradient(160deg,#30b0c7,#1d7d8f)",
  vnc: "linear-gradient(160deg,#5856d6,#3a38a8)",
  ftp: "linear-gradient(160deg,#ff9f0a,#e07b00)",
  url: "linear-gradient(160deg,#34c759,#1e9e44)",
  serial: "linear-gradient(160deg,#ff375f,#c70036)",
};

function TileGlyph({ type }: { type: ConnTileType }) {
  if (type === "local" || type === "localFiles") {
    return (
      <svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
        <rect x="6" y="9" width="36" height="30" rx="5" fill="#1c1c1e" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        <rect x="6" y="9" width="36" height="7" rx="5" fill="#2c2c2e" />
        <path
          d="M14 24l5 4-5 4M26 30h7"
          fill="none"
          stroke="#32d74b"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  const map: Record<string, DialogIconName> = {
    ssh: "server",
    telnet: "terminal",
    rdp: "monitor",
    vnc: "network",
    ftp: "folder",
    url: "globe",
    serial: "bolt",
  };
  return <DIcon name={map[type] ?? "server"} size={28} style={{ color: "#fff" }} />;
}

export function ConnTile({
  type,
  editable,
  onClick,
  editLabel,
}: {
  type: ConnTileType;
  editable?: boolean;
  onClick?: () => void;
  editLabel?: string;
}) {
  return (
    <div
      className={`kk-conn-tile${editable ? " editable" : ""}`}
      style={{ background: TILE_BG[type] ?? TILE_BG.ssh }}
      onClick={onClick}
      role={editable ? "button" : undefined}
      aria-label={editable ? editLabel : undefined}
    >
      <TileGlyph type={type} />
      {editable && (
        <span className="kk-edit-badge">
          <DIcon name="pencil" size={12} />
        </span>
      )}
    </div>
  );
}
