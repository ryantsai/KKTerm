import type { CSSProperties } from "react";
import type { ConnectionType } from "../../../types";
import rdpIcon from "../../../assets/connection-icons/rdp.png";
import serialIcon from "../../../assets/connection-icons/serial.png";
import sshIcon from "../../../assets/connection-icons/ssh.png";
import powershellIcon from "../../../assets/connection-icons/powershell.svg";
import powershell5Icon from "../../../assets/connection-icons/powershell5.svg";
import telnetIcon from "../../../assets/connection-icons/telnet.png";
import terminalIcon from "../../../assets/connection-icons/terminal.png";
import urlIcon from "../../../assets/connection-icons/url.png";
import vncIcon from "../../../assets/connection-icons/vnc.png";
import wslIcon from "../../../assets/connection-icons/wsl.png";
import { lucideIconNameFromRef, reiconIconNameFromRef } from "../../../lib/iconCatalog";
import { brandIconRefToUrl } from "../../../lib/brandIconUrls";
import { materialIconRefToUrl } from "../../../lib/iconCatalogUrls";
import { osIconRefToUrl } from "../../../lib/osIconUrls";
import { getReiconIconComponent } from "../../../lib/reiconCatalog";
import { fileBrowserConnectionIconSrc } from "./fileBrowserConnectionIcons";
import documentIcon from "../../../assets/file-icons/material-icon-theme/icons/document.svg";

export const CONNECTION_ICON_SRC: Record<ConnectionType, string> = {
  local: terminalIcon,
  ssh: sshIcon,
  telnet: telnetIcon,
  serial: serialIcon,
  url: urlIcon,
  rdp: rdpIcon,
  vnc: vncIcon,
  ftp: fileBrowserConnectionIconSrc("ftp"),
  localFiles: fileBrowserConnectionIconSrc("localFiles"),
  fileView: documentIcon,
  cloudStorage: fileBrowserConnectionIconSrc("cloudStorage"),
};

export const PREDEFINED_CONNECTION_ICON_TYPES: ConnectionType[] = [
  "local",
  "ssh",
  "telnet",
  "serial",
  "url",
  "rdp",
  "vnc",
  "ftp",
  "localFiles",
  "fileView",
];

export function connectionIconSrcForConnection({
  iconDataUrl,
  localShell,
  type,
}: {
  iconDataUrl?: string | null;
  localShell?: string;
  type: ConnectionType;
}) {
  if (iconDataUrl) {
    return iconDataUrl;
  }
  if (type === "local" && localShell === "wsl.exe") {
    return wslIcon;
  }
  if (type === "local" && localShell === "powershell.exe") {
    return powershell5Icon;
  }
  if (type === "local" && localShell === "pwsh.exe") {
    return powershellIcon;
  }
  if (type === "ftp") {
    return fileBrowserConnectionIconSrc("ftp");
  }
  if (type === "localFiles") {
    return fileBrowserConnectionIconSrc("localFiles");
  }
  return CONNECTION_ICON_SRC[type];
}

/**
 * Whether a Connection-style icon can have its foreground color recolored. Only
 * inline Reicon/Lucide fallback SVG glyphs honor `--connection-icon-fg`; every
 * other icon (the default protocol PNGs, brand/OS/Material artwork, and
 * saved/chosen raster or SVG images) renders as an `<img>` and ignores the
 * foreground color.
 */
export function iconSupportsForegroundColor({
  iconDataUrl,
  localShell,
  type,
}: {
  iconDataUrl?: string | null;
  localShell?: string;
  type: ConnectionType;
}) {
  const src = connectionIconSrcForConnection({ iconDataUrl, localShell, type });
  const iconName = reiconIconNameFromRef(src) ?? lucideIconNameFromRef(src);
  return getReiconIconComponent(iconName) !== null;
}

export function ConnectionIcon({
  className,
  iconBackgroundColor,
  iconColor,
  iconDataUrl,
  localShell,
  size = 16,
  type,
}: {
  className?: string;
  iconBackgroundColor?: string | null;
  iconColor?: string | null;
  iconDataUrl?: string | null;
  localShell?: string;
  size?: number;
  type: ConnectionType;
}) {
  const src = connectionIconSrcForConnection({ iconDataUrl, localShell, type });
  const MaterialOrImage = brandIconRefToUrl(src) ?? osIconRefToUrl(src) ?? materialIconRefToUrl(src) ?? src;
  const iconName = reiconIconNameFromRef(src) ?? lucideIconNameFromRef(src);
  const InlineIcon = getReiconIconComponent(iconName);
  const hasBackground = Boolean(iconBackgroundColor);
  const shellSize = hasBackground ? size + 6 : size;
  const style = {
    "--connection-icon-bg": iconBackgroundColor ?? "transparent",
    "--connection-icon-fg": iconColor ?? (hasBackground
      ? iconForegroundForBackground(iconBackgroundColor)
      : "currentColor"),
    "--connection-icon-size": `${size}px`,
    "--connection-icon-shell-size": `${shellSize}px`,
  } as CSSProperties;
  return (
    <span
      aria-hidden="true"
      className={["connection-icon-shell", hasBackground ? "has-background" : "", className]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      {InlineIcon ? (
        <InlineIcon size={size} />
      ) : (
        <img
          alt=""
          className="connection-icon-image"
          draggable={false}
          height={size}
          src={MaterialOrImage}
          width={size}
        />
      )}
    </span>
  );
}

function iconForegroundForBackground(color?: string | null) {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) {
    return "var(--surface)";
  }
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.72 ? "var(--text)" : "var(--surface)";
}
