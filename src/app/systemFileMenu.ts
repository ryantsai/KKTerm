import { currentPlatform } from "../lib/platform";
import { invokeCommand, isTauriRuntime } from "../lib/tauri";

export async function pushSystemFileMenu(labels: {
  fileMenu: string;
  open: string;
}) {
  const platform = currentPlatform();
  if (!isTauriRuntime() || (platform !== "macos" && platform !== "linux")) {
    return;
  }

  try {
    await invokeCommand("update_system_file_menu", { labels });
  } catch {
    // The native menu is a platform convenience and must not block app startup.
  }
}
