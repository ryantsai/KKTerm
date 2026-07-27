import type { CSSProperties, ReactNode } from "react";
import { Search, type IconComponent } from "../../../../../lib/reicon";

/** A line-icon component (all take a numeric `size`). */
export type ViewerIcon = IconComponent;

/** Square icon button matching the redesign's `.fv-ibtn`. */
export function IconButton({
  icon: Icon,
  title,
  on = false,
  disabled = false,
  onClick,
  size = 17,
  pressed,
}: {
  icon: ViewerIcon;
  title: string;
  on?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  size?: number;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      className={on ? "fv-ibtn on" : "fv-ibtn"}
      title={title}
      aria-label={title}
      aria-pressed={pressed ?? (on ? true : undefined)}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={size} />
    </button>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ViewerIcon;
}

/** Pill segmented control matching `.fv-seg`. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="fv-seg" role="tablist">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={value === option.value}
            className={value === option.value ? "active" : ""}
            onClick={() => onChange(option.value)}
          >
            {Icon ? <Icon size={14} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Inline search/filter field matching `.fv-search`. */
export function SearchField({
  value,
  onChange,
  placeholder,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  style?: CSSProperties;
}) {
  return (
    <div className="fv-search" style={style}>
      <Search size={14} />
      <input
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
    </div>
  );
}

/** Small read-only "select"-style chip matching `.fv-chip`. */
export function Chip({
  children,
  onClick,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <span
      className="fv-chip"
      role={onClick ? "button" : undefined}
      title={title}
      onClick={onClick}
    >
      {children}
    </span>
  );
}

/** A single status-footer segment. */
export function FootSeg({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return <span className={mono ? "seg mono" : "seg"}>{children}</span>;
}
