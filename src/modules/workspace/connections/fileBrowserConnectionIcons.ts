import folderMacosIcon from "../../../assets/file-icons/material-icon-theme/icons/folder-macos.svg";
import folderServerIcon from "../../../assets/file-icons/material-icon-theme/icons/folder-server.svg";
import folderWindowsIcon from "../../../assets/file-icons/material-icon-theme/icons/folder-windows.svg";
import { currentPlatform } from "../../../lib/platform";

export type FileBrowserConnectionIconKind = "ftp" | "sftp" | "localFiles";

export function fileBrowserConnectionIconSrc(kind: FileBrowserConnectionIconKind) {
  if (kind === "localFiles") {
    return currentPlatform() === "macos" ? folderMacosIcon : folderWindowsIcon;
  }
  return folderServerIcon;
}
