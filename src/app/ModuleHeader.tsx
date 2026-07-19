import type { HTMLAttributes, ReactNode } from "react";

export type ModuleKind = "workspace" | "dashboard" | "installer" | "screenshots" | "itops";

export function ModuleHeader({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <header className={`module-header ${className}`.trim()} {...props} />;
}

export function ModuleHeaderLead({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`module-header__lead ${className}`.trim()} {...props} />;
}

export function ModuleIconTile({
  children,
  className = "",
  compact = false,
  module,
}: {
  children: ReactNode;
  className?: string;
  compact?: boolean;
  module: ModuleKind;
}) {
  return (
    <span
      className={`module-header__tile module-header__tile--${module}${compact ? " module-header__tile--compact" : ""} ${className}`.trim()}
    >
      {children}
    </span>
  );
}

export function ModuleHeaderTitle({
  as: Tag = "h1",
  children,
  className = "",
}: {
  as?: "h1" | "span";
  children: ReactNode;
  className?: string;
}) {
  return <Tag className={`module-header__title ${className}`.trim()}>{children}</Tag>;
}

export function ModuleHeaderDivider() {
  return <span className="module-header__divider" aria-hidden="true" />;
}

export function ModuleHeaderSpacer() {
  return <span className="module-header__spacer" aria-hidden="true" />;
}
