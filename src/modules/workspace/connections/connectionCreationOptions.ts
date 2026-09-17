import type { ConnectionType } from "../../../types";

export const CONNECTION_CREATION_OPTIONS = [
  { type: "local", labelKey: "connections.localTerminal" },
  { type: "ssh", labelKey: "connections.ssh" },
  { type: "telnet", labelKey: "connections.telnet" },
  { type: "serial", labelKey: "connections.serial" },
  { type: "url", labelKey: "connections.url" },
  { type: "rdp", labelKey: "connections.rdp" },
  { type: "vnc", labelKey: "connections.vnc" },
  { type: "ftp", labelKey: "connections.ftp" },
  { type: "localFiles", labelKey: "connections.localFiles" },
  { type: "fileView", labelKey: "connections.fileView" },
  { type: "cloudStorage", labelKey: "connections.cloudStorage" },
] as const satisfies ReadonlyArray<{
  type: ConnectionType;
  labelKey: string;
}>;

export function connectionCreationOptions(macAppStoreBuild: boolean) {
  return macAppStoreBuild
    ? CONNECTION_CREATION_OPTIONS.filter((option) => option.type !== "local")
    : CONNECTION_CREATION_OPTIONS;
}
