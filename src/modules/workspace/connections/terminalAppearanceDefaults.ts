import { DYNAMIC_BACKGROUNDS } from "../../dashboard/registry/dynamicBackgrounds";
import type { DashboardBackground } from "../../dashboard/types";
import type { ConnectionType, SshSettings, TerminalSettings } from "../../../types";

export type DefaultTerminalAppearance = {
  terminalOpacity: number;
  terminalBackground: DashboardBackground | null;
};

export function resolveVisibleTerminalBackground({
  connectionBackground,
  paneBackground,
  sharedBackground,
  usePaneBackground,
}: {
  connectionBackground: DashboardBackground | null | undefined;
  paneBackground: DashboardBackground | null | undefined;
  sharedBackground: DashboardBackground | null | undefined;
  usePaneBackground: boolean;
}): DashboardBackground | null {
  const selectedBackground = usePaneBackground ? paneBackground : sharedBackground;
  return selectedBackground !== undefined
    ? selectedBackground
    : (connectionBackground ?? null);
}

function terminalSettingsForConnection(
  type: ConnectionType,
  sshSettings: SshSettings,
  terminalSettings: TerminalSettings,
) {
  return type === "ssh" ? sshSettings : terminalSettings;
}

export function supportsTerminalAppearanceDefaults(type: ConnectionType) {
  return type === "local" || type === "ssh" || type === "telnet" || type === "serial";
}

export function resolveDefaultTerminalAppearance(
  type: ConnectionType,
  sshSettings: SshSettings,
  terminalSettings: TerminalSettings,
  random: () => number = Math.random,
): DefaultTerminalAppearance {
  const settings = terminalSettingsForConnection(type, sshSettings, terminalSettings);
  const transparency = Math.min(100, Math.max(0, Math.round(settings.defaultTransparency)));
  const terminalBackground =
    settings.useRandomDynamicBackground && DYNAMIC_BACKGROUNDS.length > 0
      ? {
          kind: "dynamic" as const,
          dynamic: DYNAMIC_BACKGROUNDS[
            Math.min(
              DYNAMIC_BACKGROUNDS.length - 1,
              Math.max(0, Math.floor(random() * DYNAMIC_BACKGROUNDS.length)),
            )
          ].id,
        }
      : null;

  return {
    terminalOpacity: 100 - transparency,
    terminalBackground,
  };
}
