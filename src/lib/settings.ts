import { useEffect } from "react";
import { useState } from "react";

import { AI_PROVIDER_DEFINITIONS } from "../ai/providers";
import { useWorkspaceStore } from "../store";
import type { AiProviderKind } from "../types";
import {
  listCustomFontOptions,
  normalizeAvailableAppearance,
  normalizeAvailableTerminal,
} from "./customFonts";
import { invokeCommand, isTauriRuntime } from "./tauri";

// Legacy shared keychain owner used before AI provider keys became per-provider.
export const AI_PROVIDER_SECRET_OWNER_ID = "openai-compatible-provider";
export const EXA_SEARCH_SECRET_OWNER_ID = "exa-search";
export const BRAVE_SEARCH_SECRET_OWNER_ID = "brave-search";
export const TAVILY_SEARCH_SECRET_OWNER_ID = "tavily-search";
export const EMAIL_API_SECRET_OWNER_ID = "email-tool-api-key";
export const EMAIL_SMTP_SECRET_OWNER_ID = "email-tool-smtp-password";

export function aiProviderSecretOwnerId(providerKind: AiProviderKind | string) {
  return `ai-provider:${providerKind.trim().toLowerCase()}`;
}

export function allAiProviderSecretOwnerIds() {
  return AI_PROVIDER_DEFINITIONS.map((definition) =>
    aiProviderSecretOwnerId(definition.kind),
  );
}

// Loads persisted settings from the Tauri backend into the workspace store.
// Combines the previously separate per-key effects into one parallel load so
// new settings can be added in one place instead of cloning a useEffect each
// time. Bootstrap is best-effort: any single load failure is ignored so the
// app still renders with the in-memory defaults from `app-defaults`.
export function useBootstrapSettings() {
  const [appModeReady, setAppModeReady] = useState(!isTauriRuntime());
  const [generalSettingsReady, setGeneralSettingsReady] = useState(!isTauriRuntime());
  const [credentialSettingsReady, setCredentialSettingsReady] = useState(!isTauriRuntime());
  const setGeneralSettings = useWorkspaceStore(
    (state) => state.setGeneralSettings,
  );
  const setAppModeInfo = useWorkspaceStore((state) => state.setAppModeInfo);
  const setCredentialSettings = useWorkspaceStore(
    (state) => state.setCredentialSettings,
  );
  const setTerminalSettings = useWorkspaceStore(
    (state) => state.setTerminalSettings,
  );
  const setDashboardSettings = useWorkspaceStore(
    (state) => state.setDashboardSettings,
  );
  const setAppearanceSettings = useWorkspaceStore(
    (state) => state.setAppearanceSettings,
  );
  const setSshSettings = useWorkspaceStore((state) => state.setSshSettings);
  const setSftpSettings = useWorkspaceStore((state) => state.setSftpSettings);
  const setUrlSettings = useWorkspaceStore((state) => state.setUrlSettings);
  const setRdpSettings = useWorkspaceStore((state) => state.setRdpSettings);
  const setVncSettings = useWorkspaceStore((state) => state.setVncSettings);
  const setAiProviderSettings = useWorkspaceStore(
    (state) => state.setAiProviderSettings,
  );
  const setAiProviderHasApiKey = useWorkspaceStore(
    (state) => state.setAiProviderHasApiKey,
  );

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;

    const swallow = (_error: unknown) => undefined;
    const customFontsPromise = listCustomFontOptions();

    void invokeCommand("get_app_mode")
      .then((info) => {
        if (!disposed) setAppModeInfo(info);
      })
      .finally(() => {
        if (!disposed) setAppModeReady(true);
      })
      .catch(swallow);

    void invokeCommand("get_general_settings")
      .then((settings) => {
        if (!disposed) setGeneralSettings(settings);
      })
      .finally(() => {
        if (!disposed) setGeneralSettingsReady(true);
      })
      .catch(swallow);

    void Promise.all([invokeCommand("get_terminal_settings"), customFontsPromise])
      .then(([settings, customFonts]) => {
        const normalized = normalizeAvailableTerminal(settings, customFonts);
        if (!disposed) setTerminalSettings(normalized);
        if (normalized !== settings) {
          void invokeCommand("update_terminal_settings", { request: normalized }).catch(swallow);
        }
      })
      .catch(swallow);

    void invokeCommand("get_credential_settings")
      .then((settings) => {
        if (!disposed) setCredentialSettings(settings);
      })
      .finally(() => {
        if (!disposed) setCredentialSettingsReady(true);
      })
      .catch(swallow);

    void invokeCommand("get_dashboard_settings")
      .then((settings) => {
        if (!disposed) setDashboardSettings(settings);
      })
      .catch(swallow);

    void Promise.all([invokeCommand("get_appearance_settings"), customFontsPromise])
      .then(([settings, customFonts]) => {
        const normalized = normalizeAvailableAppearance(settings, customFonts);
        if (!disposed) setAppearanceSettings(normalized);
        if (JSON.stringify(normalized) !== JSON.stringify(settings)) {
          void invokeCommand("update_appearance_settings", { request: normalized }).catch(swallow);
        }
      })
      .catch(swallow);

    void invokeCommand("get_ssh_settings")
      .then((settings) => {
        if (!disposed) setSshSettings(settings);
      })
      .catch(swallow);

    void invokeCommand("get_sftp_settings")
      .then((settings) => {
        if (!disposed) setSftpSettings(settings);
      })
      .catch(swallow);

    void invokeCommand("get_url_settings")
      .then((settings) => {
        if (!disposed) setUrlSettings(settings);
      })
      .catch(swallow);

    void invokeCommand("get_rdp_settings")
      .then((settings) => {
        if (!disposed) setRdpSettings(settings);
      })
      .catch(swallow);

    void invokeCommand("get_vnc_settings")
      .then((settings) => {
        if (!disposed) setVncSettings(settings);
      })
      .catch(swallow);

    void invokeCommand("get_ai_provider_settings")
      .then((settings) => {
        if (!disposed) setAiProviderSettings(settings);
        return Promise.all([
          invokeCommand("secret_exists", {
            request: {
              kind: "aiApiKey",
              ownerId: aiProviderSecretOwnerId(settings.providerKind),
            },
          }),
          invokeCommand("secret_exists", {
            request: {
              kind: "aiApiKey",
              ownerId: AI_PROVIDER_SECRET_OWNER_ID,
            },
          }),
        ]);
      })
      .then(([providerPresence, legacyPresence]) => {
        if (!disposed) {
          setAiProviderHasApiKey(providerPresence.exists || legacyPresence.exists);
        }
      })
      .catch(swallow);

    return () => {
      disposed = true;
    };
  }, [
    setAiProviderHasApiKey,
    setAppModeInfo,
    setAiProviderSettings,
    setDashboardSettings,
    setCredentialSettings,
    setGeneralSettings,
    setAppearanceSettings,
    setSftpSettings,
    setSshSettings,
    setUrlSettings,
    setRdpSettings,
    setVncSettings,
    setTerminalSettings,
  ]);

  return { appModeReady, credentialSettingsReady, generalSettingsReady };
}
