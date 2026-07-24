import { useCallback, useEffect, useState } from "react";
import { Bot, Copy, RefreshCw, X } from "../../lib/reicon";
import { useTranslation } from "react-i18next";
import {
  AI_PROVIDER_DEFINITIONS,
  CUSTOM_AI_INSTRUCTIONS_MAX_LENGTH,
  getAiProviderDefinition,
  normalizeAiProviderDraft,
  providerDefaultsFor,
  type AiProviderDefinition,
  type AiProviderSettingsField,
} from "../../ai/providers";
import { SUPPORTED_LANGUAGES } from "../../i18n/config";
import {
  EMAIL_API_SECRET_OWNER_ID,
  EMAIL_SMTP_SECRET_OWNER_ID,
  aiProviderSecretOwnerId,
} from "../../lib/settings";
import {
  invokeCommand,
  isTauriRuntime,
  openExternalUrl,
  type AiCliBackendKind,
  type AiProviderModelOption,
  type GitHubCopilotCliStatus,
  type GitHubCopilotDeviceFlow,
} from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type {
  AiAssistantToolId,
  EmailProvider,
  AiOpenAiApiMode,
  AiProviderKind,
  AiProviderSettings as AiProviderSettingsType,
  AiReasoningEffort,
  SearchProvider,
  SmtpSecurity,
} from "../../types";
import {
  selectModelOptionsForProvider,
  sortModelOptionsForProvider,
} from "../../ai/providerModelOptions";
import { McpServersControl } from "./McpServers";
import { AssistantSkillsControl } from "./AssistantSkills";
import {
  SettingsCollapsibleFieldset,
  SettingsSectionHeader,
  useSettingsSaveRegistration,
} from "./shared";
import { ToggleSwitch } from "./ToggleSwitch";
import { ConfirmSheet } from "../../app/ui/dialog";
import { shouldShowStoredAiProviderKeyMask } from "./aiProviderKeyField";
import i18next from "../../i18n/config";
import { resolveInstallPlan } from "../installer/dag";
import { installRecipeAndWait } from "../installer/progress";
import { supportsBuiltInMcp } from "../../lib/platform";
import {
  readStoredAiCliBackendStatus,
  writeStoredAiCliBackendStatus,
  type StoredAiCliBackendStatus,
} from "./aiCliStatusPersistence";

const GITHUB_COPILOT_CLI_INSTALL_URL =
  "https://docs.github.com/en/copilot/how-tos/copilot-cli/install-copilot-cli";

type BuiltInMcpConfigFormat = "json" | "toml";

type BuiltInMcpSetupRow = {
  agent: string;
  methodKey: string;
  projectScope: string;
  globalScope: string;
};

const BUILT_IN_MCP_COMMAND_PATH_FALLBACK = "<path-to-kkterm-cli>";
const BUILT_IN_MCP_PROJECT_CONFIG_UNAVAILABLE = "-";

function builtInMcpJsonSnippet(commandPath: string) {
  return JSON.stringify(
    {
      mcpServers: {
        kkterm: {
          command: commandPath,
          args: [],
        },
      },
    },
    null,
    2,
  );
}

function builtInMcpTomlSnippet(commandPath: string) {
  return `[mcp_servers.kkterm]
command = "${escapeTomlBasicString(commandPath)}"
args = []
`;
}

function escapeTomlBasicString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function quoteCliArgument(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function builtInMcpSetupRows(commandPath: string): BuiltInMcpSetupRow[] {
  const command = quoteCliArgument(commandPath);
  return [
    {
      agent: "Codex",
      methodKey: "settings.builtInMcpConfigMethodRunCommandOrManualEdit",
      projectScope: ".codex/config.toml",
      globalScope: `codex mcp add KKTerm -- ${command}`,
    },
    {
      agent: "Claude Code",
      methodKey: "settings.builtInMcpConfigMethodRunCommand",
      projectScope: `claude mcp add --scope project KKTerm -- ${command}`,
      globalScope: `claude mcp add --scope user KKTerm -- ${command}`,
    },
    {
      agent: "Antigravity",
      methodKey: "settings.builtInMcpConfigMethodManualEdit",
      projectScope: BUILT_IN_MCP_PROJECT_CONFIG_UNAVAILABLE,
      globalScope: "~/.gemini/antigravity/mcp_config.json",
    },
    {
      agent: "GitHub Copilot",
      methodKey: "settings.builtInMcpConfigMethodManualEdit",
      projectScope: ".vscode/mcp.json",
      globalScope: "%APPDATA%\\Code\\User\\mcp.json",
    },
    {
      agent: "OpenCode",
      methodKey: "settings.builtInMcpConfigMethodManualEdit",
      projectScope: "opencode.json",
      globalScope: "~/.config/opencode/opencode.json",
    },
  ];
}

const BUILT_IN_MCP_CONFIG_SNIPPET_FALLBACK = {
  json: builtInMcpJsonSnippet(BUILT_IN_MCP_COMMAND_PATH_FALLBACK),
  toml: builtInMcpTomlSnippet(BUILT_IN_MCP_COMMAND_PATH_FALLBACK),
};

function createStoredApiKeyMask() {
  const maskLength = 12 + Math.floor(Math.random() * 5);
  return "*".repeat(maskLength);
}

function BuiltInMcpConfigDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [copied, setCopied] = useState(false);
  const [activeFormat, setActiveFormat] = useState<BuiltInMcpConfigFormat>("json");
  const [commandPath, setCommandPath] = useState(BUILT_IN_MCP_COMMAND_PATH_FALLBACK);
  const configSnippets = {
    json:
      commandPath === BUILT_IN_MCP_COMMAND_PATH_FALLBACK
        ? BUILT_IN_MCP_CONFIG_SNIPPET_FALLBACK.json
        : builtInMcpJsonSnippet(commandPath),
    toml:
      commandPath === BUILT_IN_MCP_COMMAND_PATH_FALLBACK
        ? BUILT_IN_MCP_CONFIG_SNIPPET_FALLBACK.toml
        : builtInMcpTomlSnippet(commandPath),
  };
  const configSnippet = configSnippets[activeFormat];
  const setupRows = builtInMcpSetupRows(commandPath);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let isMounted = true;
    invokeCommand("get_built_in_mcp_command_path", undefined)
      .then((commandPath) => {
        if (isMounted) {
          setCommandPath(commandPath);
        }
      })
      .catch((error: unknown) => {
        showStatusBarNotice(error instanceof Error ? error.message : String(error), {
          tone: "error",
        });
      });
    return () => {
      isMounted = false;
    };
  }, [showStatusBarNotice]);

  async function handleCopy() {
    await navigator.clipboard.writeText(configSnippet);
    setCopied(true);
  }

  return (
    <div className="dialog-backdrop connection-dialog-backdrop" role="presentation">
      <div
        aria-label={t("settings.builtInMcpConfigTitle")}
        aria-modal="true"
        className="connection-dialog settings-mcp-dialog built-in-mcp-config-dialog"
        role="dialog"
      >
        <header className="connection-dialog-header compact">
          <div>
            <h2>{t("settings.builtInMcpConfigTitle")}</h2>
          </div>
          <button
            aria-label={t("common.close")}
            className="mcp-dialog-close-button"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </header>
        <div className="mcp-dialog-body">
          <p className="field-hint">{t("settings.builtInMcpConfigIntro")}</p>
          <div className="built-in-mcp-config-tabs" role="tablist">
            {(["json", "toml"] as const).map((format) => (
              <button
                aria-selected={activeFormat === format}
                className="built-in-mcp-config-tab"
                key={format}
                onClick={() => {
                  setActiveFormat(format);
                  setCopied(false);
                }}
                role="tab"
                type="button"
              >
                {format === "json"
                  ? t("settings.builtInMcpConfigFormatJson")
                  : t("settings.builtInMcpConfigFormatToml")}
              </button>
            ))}
          </div>
          <pre className="built-in-mcp-config-snippet">
            <code>{configSnippet}</code>
          </pre>
          <button
            className="secondary-button built-in-mcp-copy-button"
            onClick={() => void handleCopy()}
            type="button"
          >
            <Copy size={14} />
            {copied ? t("settings.builtInMcpConfigCopied") : t("settings.builtInMcpConfigCopy")}
          </button>
          <div className="built-in-mcp-config-locations">
            <strong>{t("settings.builtInMcpConfigLocationsTitle")}</strong>
            <div className="built-in-mcp-config-table-wrap">
              <table className="built-in-mcp-config-table">
                <thead>
                  <tr>
                    <th scope="col">{t("settings.builtInMcpConfigAgentHeader")}</th>
                    <th scope="col">{t("settings.builtInMcpConfigMethodHeader")}</th>
                    <th scope="col">{t("settings.builtInMcpConfigProjectScopeHeader")}</th>
                    <th scope="col">{t("settings.builtInMcpConfigGlobalScopeHeader")}</th>
                  </tr>
                </thead>
                <tbody>
                  {setupRows.map((row) => (
                    <tr key={row.agent}>
                      <th scope="row">{row.agent}</th>
                      <td>{t(row.methodKey)}</td>
                      <td>
                        <code>{row.projectScope}</code>
                      </td>
                      <td>
                        <code>{row.globalScope}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function formatReasoningEffort(effort: AiReasoningEffort) {
  switch (effort) {
    case "default":
      return i18next.t("settings.providerDefault");
    case "low":
      return i18next.t("settings.low");
    case "medium":
      return i18next.t("settings.medium");
    case "high":
      return i18next.t("settings.high");
    case "max":
      return i18next.t("settings.max");
    default:
      return effort;
  }
}

function AiProviderSettingsFieldControl({
  apiKeyDraft,
  apiKeyStoredMask,
  definition,
  draft,
  field,
  hasApiKey,
  isRefreshingModels,
  modelOptions,
  useCliBackend,
  onApiKeyDraftChange,
  onDraftChange,
  onRefreshModels,
}: {
  apiKeyDraft: string;
  apiKeyStoredMask: string;
  definition: AiProviderDefinition;
  draft: AiProviderSettingsType;
  field: AiProviderSettingsField;
  hasApiKey: boolean;
  isRefreshingModels: boolean;
  modelOptions?: AiProviderModelOption[];
  useCliBackend: boolean;
  onApiKeyDraftChange: (value: string) => void;
  onDraftChange: (patch: Partial<AiProviderSettingsType>) => void;
  onRefreshModels: () => void;
}) {
  const { t } = useTranslation();
  const [isApiKeyInputFocused, setIsApiKeyInputFocused] = useState(false);
  const shouldShowStoredApiKeyMask =
    field === "apiKey" &&
    shouldShowStoredAiProviderKeyMask({
      apiKeyDraft,
      hasProviderApiKey: hasApiKey,
      isInputFocused: isApiKeyInputFocused,
    });

  switch (field) {
    case "baseUrl":
      return (
        <label>
          <span>{t("settings.endpoint")}</span>
          <input
            onChange={(event) => onDraftChange({ baseUrl: event.currentTarget.value })}
            readOnly={!definition.allowsCustomBaseUrl}
            value={draft.baseUrl}
          />
        </label>
      );
    case "model": {
      const options = selectModelOptionsForProvider({
        customModel: draft.model,
        provider: definition,
        refreshedModels: modelOptions ?? [],
        showAllModels: draft.showAllModels,
      });
      const modelOptionIds = new Set(options.map((model) => model.id));
      const hasCustomModel = draft.model.trim().length > 0 && !modelOptionIds.has(draft.model);
      return (
        <>
          <label>
            <span>
              {t("settings.model")}
              {definition.modelListStrategy ? (
                <button
                  className="settings-api-key-link"
                  disabled={
                    isRefreshingModels ||
                    !isTauriRuntime() ||
                    useCliBackend ||
                    (definition.requiresApiKey && !hasApiKey)
                  }
                  onClick={onRefreshModels}
                  type="button"
                >
                  <RefreshCw size={13} />
                  {isRefreshingModels
                    ? t("settings.refreshingModels")
                    : t("settings.refreshModels")}
                </button>
              ) : null}
            </span>
            <select
              onChange={(event) => onDraftChange({ model: event.currentTarget.value })}
              value={draft.model}
            >
              {hasCustomModel ? <option value={draft.model}>{draft.model}</option> : null}
              {options.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          {definition.allowsCustomModel ? (
            <label>
              <span>{t("settings.customModelId")}</span>
              <input
                onChange={(event) => onDraftChange({ model: event.currentTarget.value })}
                value={draft.model}
              />
            </label>
          ) : null}
        </>
      );
    }
    case "reasoningEffort":
      return (
        <label>
          <span>{t("settings.reasoningEffort")}</span>
          <select
            onChange={(event) =>
              onDraftChange({ reasoningEffort: event.currentTarget.value as AiReasoningEffort })
            }
            value={draft.reasoningEffort}
          >
            {definition.reasoningEfforts.map((effort) => (
              <option key={effort} value={effort}>
                {formatReasoningEffort(effort)}
              </option>
            ))}
          </select>
        </label>
      );
    case "apiKey":
      return (
        <label>
          <span>
            {definition.apiKeyLabel}
            {definition.apiKeyUrl ? (
              <button
                className="settings-api-key-link"
                onClick={() => void openExternalUrl(definition.apiKeyUrl!)}
                type="button"
              >
                {t("settings.howToGetApiKey")}
              </button>
            ) : null}
          </span>
          <input
            autoComplete="off"
            disabled={!definition.settingsFields.includes("apiKey") || useCliBackend}
            onBlur={() => setIsApiKeyInputFocused(false)}
            onChange={(event) => onApiKeyDraftChange(event.currentTarget.value)}
            onFocus={() => setIsApiKeyInputFocused(true)}
            placeholder={definition.apiKeyLabel}
            type="password"
            value={shouldShowStoredApiKeyMask ? apiKeyStoredMask : apiKeyDraft}
          />
        </label>
      );
    case "apiMode":
      return (
        <label>
          <span>{t("settings.apiMode")}</span>
          <select
            onChange={(event) =>
              onDraftChange({ apiMode: event.currentTarget.value as AiOpenAiApiMode })
            }
            value={draft.apiMode}
          >
            <option value="chatCompletions">{t("settings.apiModeChatCompletions")}</option>
            <option value="responses">{t("settings.apiModeResponses")}</option>
          </select>
        </label>
      );
    case "extraHeaders":
      return (
        <label>
          <span>{t("settings.extraHeaders")}</span>
          <input
            onChange={(event) => onDraftChange({ extraHeaders: event.currentTarget.value })}
            placeholder={t("settings.extraHeadersPlaceholder")}
            value={draft.extraHeaders}
          />
        </label>
      );
    default:
      return null;
  }
}

function providerCliBackend(providerKind: AiProviderKind): {
  backend: AiCliBackendKind;
  installToolId: string;
  labelKey: string;
  hintKey: string;
  enabled: (draft: AiProviderSettingsType) => boolean;
  patch: (checked: boolean) => Partial<AiProviderSettingsType>;
} | null {
  if (providerKind === "openai") {
    return {
      backend: "codex",
      installToolId: "codex-cli",
      labelKey: "settings.useCodexCli",
      hintKey: "settings.useCodexCliHint",
      enabled: (draft) => draft.useCodexCli,
      patch: (checked) => ({ useCodexCli: checked }),
    };
  }
  if (providerKind === "anthropic") {
    return {
      backend: "claudeCode",
      installToolId: "claude-code-cli",
      labelKey: "settings.useClaudeCli",
      hintKey: "settings.useClaudeCliHint",
      enabled: (draft) => draft.useClaudeCli,
      patch: (checked) => ({ useClaudeCli: checked }),
    };
  }
  if (providerKind === "cursor") {
    return {
      backend: "cursor",
      installToolId: "cursor-cli",
      labelKey: "settings.useCursorCli",
      hintKey: "settings.useCursorCliHint",
      enabled: (draft) => draft.useCursorCli,
      patch: (checked) => ({ useCursorCli: checked }),
    };
  }
  return null;
}

function AiCliBackendControl({
  draft,
  onDraftChange,
}: {
  draft: AiProviderSettingsType;
  onDraftChange: (patch: Partial<AiProviderSettingsType>) => void;
}) {
  const { t, i18n } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const cli = providerCliBackend(draft.providerKind);
  const [storedStatus, setStoredStatus] = useState<StoredAiCliBackendStatus | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshStatus() {
    if (!cli || !isTauriRuntime()) return;
    setBusy(true);
    try {
      const next = await invokeCommand("get_ai_cli_backend_status", {
        provider: cli.backend,
      });
      const checkedAt = new Date().toISOString();
      setStoredStatus(
        writeStoredAiCliBackendStatus(cli.backend, next, checkedAt) ?? {
          checkedAt,
          status: next,
        },
      );
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function installCli() {
    if (!cli || !isTauriRuntime()) return;
    setBusy(true);
    try {
      const catalog = await invokeCommand("installer_load_catalog", {});
      const detected = await invokeCommand("installer_detect_all");
      const plan = resolveInstallPlan(cli.installToolId, catalog, detected);
      for (const step of plan.actionable) {
        const event = await installRecipeAndWait(step.recipe.id);
        if (event.kind !== "completed") {
          throw new Error(
            event.kind === "failed" ? event.message : t("settings.aiCliInstallFailed"),
          );
        }
      }
      showStatusBarNotice(t("settings.aiCliInstallStarted"), { tone: "success" });
      await refreshStatus();
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function openAuth() {
    if (!cli || !isTauriRuntime()) return;
    try {
      await invokeCommand("open_ai_cli_backend_auth", { provider: cli.backend });
      showStatusBarNotice(t("settings.aiCliAuthStarted"), { tone: "info" });
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    }
  }

  useEffect(() => {
    setStoredStatus(cli ? readStoredAiCliBackendStatus(cli.backend) : null);
    // Only the backend identity matters here; depend on it rather than the whole cli object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cli?.backend]);

  if (!cli) return null;
  const enabled = cli.enabled(draft);
  const status = storedStatus?.status ?? null;
  const statusText = !status
    ? t("settings.aiCliStatusUnknown")
    : !status.installed
      ? t("settings.aiCliStatusMissing")
      : status.authenticated
        ? t("settings.aiCliStatusReady")
        : t("settings.aiCliStatusAuthRequired");
  const checkedAtLabel = storedStatus
    ? t("settings.lastCheckedAt", {
        time: new Date(storedStatus.checkedAt).toLocaleString(i18n.language),
      })
    : null;

  return (
    <div className="settings-toggle-list ai-cli-backend-control">
      <label className="settings-toggle-row">
        <ToggleSwitch
          checked={enabled}
          onChange={(checked) => onDraftChange(cli.patch(checked))}
        />
        <span>
          <strong>{t(cli.labelKey)}</strong>
          <small>{t(cli.hintKey)}</small>
        </span>
      </label>
      {enabled ? (
        <div className="settings-cli-backend-status">
          <span className="field-hint">
            {statusText}
            {status?.version ? ` (${status.version})` : ""}
            {checkedAtLabel ? ` · ${checkedAtLabel}` : ""}
          </span>
          <div className="settings-copilot-actions">
            <button className="toolbar-button" disabled={busy || !isTauriRuntime()} onClick={() => void refreshStatus()} type="button">
              {t("settings.aiCliRefreshStatus")}
            </button>
            <button className="toolbar-button" disabled={busy || !isTauriRuntime()} onClick={() => void installCli()} type="button">
              {t("settings.aiCliInstall")}
            </button>
            <button className="toolbar-button" disabled={busy || !status?.installed || !isTauriRuntime()} onClick={() => void openAuth()} type="button">
              {t("settings.aiCliAuthenticate")}
            </button>
          </div>
          {status?.error ? <small className="field-hint">{status.error}</small> : null}
        </div>
      ) : null}
    </div>
  );
}

function AiOutputLanguageControl({
  draft,
  onDraftChange,
}: {
  draft: AiProviderSettingsType;
  onDraftChange: (patch: Partial<AiProviderSettingsType>) => void;
}) {
  const { t } = useTranslation();
  const datalistId = "ai-output-language-options";
  const languageNames = SUPPORTED_LANGUAGES.map((code) => t(`languages.${code}` as never));

  return (
    <label>
      <span>{t("settings.outputLanguage")}</span>
      <input
        list={datalistId}
        onChange={(event) => onDraftChange({ outputLanguage: event.currentTarget.value })}
        placeholder={t("settings.outputLanguageUiLanguage")}
        value={draft.outputLanguage}
      />
      <datalist id={datalistId}>
        {languageNames.map((name, index) => (
          <option key={SUPPORTED_LANGUAGES[index]} value={name} />
        ))}
      </datalist>
    </label>
  );
}

function AiCustomInstructionsControl({
  draft,
  onDraftChange,
}: {
  draft: AiProviderSettingsType;
  onDraftChange: (patch: Partial<AiProviderSettingsType>) => void;
}) {
  const { t } = useTranslation();

  return (
    <label>
      <span>{t("settings.aiCustomInstructions")}</span>
      <small className="field-hint">
        {t("settings.aiCustomInstructionsHint", {
          count: CUSTOM_AI_INSTRUCTIONS_MAX_LENGTH,
        })}
      </small>
      <textarea
        className="ai-custom-instructions-textarea"
        maxLength={CUSTOM_AI_INSTRUCTIONS_MAX_LENGTH}
        onChange={(event) =>
          onDraftChange({ customInstructions: event.currentTarget.value })
        }
        value={draft.customInstructions ?? ""}
      />
    </label>
  );
}

function GitHubCopilotConnectionControl({
  deviceFlow,
  hasApiKey,
  isPolling,
  onConnect,
  onDisconnect,
}: {
  deviceFlow: GitHubCopilotDeviceFlow | null;
  hasApiKey: boolean;
  isPolling: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [cliStatus, setCliStatus] = useState<GitHubCopilotCliStatus | null>(null);
  const [checkingCli, setCheckingCli] = useState(false);

  const refreshCliStatus = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setCheckingCli(true);
    try {
      setCliStatus(await invokeCommand("get_github_copilot_cli_status", undefined));
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    } finally {
      setCheckingCli(false);
    }
  }, [showStatusBarNotice]);

  useEffect(() => {
    void refreshCliStatus();
  }, [refreshCliStatus]);

  const cliStatusText = !cliStatus
    ? t("settings.copilotCliStatusUnknown")
    : cliStatus.installed
      ? t("settings.copilotCliStatusReady")
      : t("settings.copilotCliStatusMissing");
  const cliVersionText = formatCopilotCliVersion(cliStatus?.version);

  return (
    <div className="settings-copilot-connection">
      <p className="field-hint">
        {t("settings.copilotConnectionHint")}
        {" "}
        <button
          className="settings-api-key-link"
          onClick={() => void openExternalUrl(GITHUB_COPILOT_CLI_INSTALL_URL)}
          type="button"
        >
          {t("settings.copilotCliInstallHelp")}
        </button>
      </p>
      <div className="settings-cli-backend-status settings-copilot-cli-status">
        <button
          className="toolbar-button"
          disabled={checkingCli || !isTauriRuntime()}
          onClick={() => void refreshCliStatus()}
          type="button"
        >
          {t("settings.aiCliRefreshStatus")}
        </button>
        <span className="field-hint">
          {cliStatusText}
          {cliVersionText ? ` (${cliVersionText})` : ""}
        </span>
        {cliStatus && !cliStatus.installed && cliStatus.error ? (
          <small className="field-hint">{cliStatus.error}</small>
        ) : null}
      </div>
      {deviceFlow ? (
        <div className="settings-copilot-code">
          <strong>{t("settings.copilotAuthCode", { code: deviceFlow.userCode })}</strong>
          <button
            className="settings-api-key-link"
            onClick={() => void openExternalUrl(deviceFlow.verificationUri)}
            type="button"
          >
            {t("settings.copilotOpenDevicePage")}
          </button>
          <small>{t("settings.copilotAuthPending")}</small>
        </div>
      ) : null}
      <div className="settings-copilot-actions">
        <button
          className="toolbar-button"
          disabled={isPolling || Boolean(deviceFlow) || hasApiKey || !isTauriRuntime()}
          onClick={onConnect}
          type="button"
        >
          {t("settings.copilotConnect")}
        </button>
        <button
          className="toolbar-button"
          disabled={isPolling || !hasApiKey || !isTauriRuntime()}
          onClick={onDisconnect}
          type="button"
        >
          {t("settings.copilotDisconnect")}
        </button>
      </div>
    </div>
  );
}

function formatCopilotCliVersion(version: string | null | undefined) {
  return (version ?? "")
    .replace(/\s*Run\s+['"`]?copilot update['"`]?[^)]*\.?\s*$/iu, "")
    .replace(/\.$/u, "")
    .trim();
}

const AI_ASSISTANT_TOOL_IDS: AiAssistantToolId[] = [
  "currentTime",
  "webSearch",
  "webFetch",
  "appDataFileSearch",
  "appDataFileRead",
  "performanceCounters",
  "email",
  "shellCommand",
  "dashboard",
  "itops",
  "installer",
  "screenshots",
  "connections",
  "sessions",
  "tutorial",
  "manual",
  "network",
  "watchdog",
  "memory",
];

const SEARCH_PROVIDER_OPTIONS: { value: SearchProvider; labelKey: string }[] = [
  { value: "scraper", labelKey: "settings.searchProviderScraper" },
  { value: "brave", labelKey: "settings.searchProviderBrave" },
  { value: "tavily", labelKey: "settings.searchProviderTavily" },
  { value: "searxng", labelKey: "settings.searchProviderSearxng" },
];

const BRAVE_SEARCH_OWNER_ID = "brave-search";
const TAVILY_SEARCH_OWNER_ID = "tavily-search";
const EMAIL_PROVIDER_OPTIONS: { value: EmailProvider; labelKey: string }[] = [
  { value: "resend", labelKey: "settings.emailProviderResend" },
  { value: "sendgrid", labelKey: "settings.emailProviderSendGrid" },
  { value: "mailgun", labelKey: "settings.emailProviderMailgun" },
  { value: "postmark", labelKey: "settings.emailProviderPostmark" },
  { value: "smtp", labelKey: "settings.emailProviderSmtp" },
];

const SMTP_SECURITY_OPTIONS: { value: SmtpSecurity; labelKey: string }[] = [
  { value: "starttls", labelKey: "settings.smtpSecurityStartTls" },
  { value: "none", labelKey: "settings.smtpSecurityNone" },
];

function SearchProviderControl({
  draft,
  searchApiKeyDraft,
  searchApiKeyStoredMask,
  hasSearchApiKey,
  onDraftChange,
  onSearchApiKeyDraftChange,
}: {
  draft: AiProviderSettingsType;
  searchApiKeyDraft: string;
  searchApiKeyStoredMask: string;
  hasSearchApiKey: boolean;
  onDraftChange: (patch: Partial<AiProviderSettingsType>) => void;
  onSearchApiKeyDraftChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [isSearchApiKeyFocused, setIsSearchApiKeyFocused] = useState(false);
  const shouldShowStoredApiKeyMask =
    hasSearchApiKey && !isSearchApiKeyFocused && searchApiKeyDraft.length === 0;

  return (
    <div className="search-provider-subsection">
      <label>
        <span>{t("settings.searchProvider")}</span>
        <select
          onChange={(event) =>
            onDraftChange({
              searchProvider: event.currentTarget.value as SearchProvider,
            })
          }
          value={draft.searchProvider}
        >
          {SEARCH_PROVIDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </label>
      {draft.searchProvider === "brave" ? (
        <label>
          <span>{t("settings.braveSearchApiKey")}</span>
          <input
            autoComplete="off"
            onBlur={() => setIsSearchApiKeyFocused(false)}
            onChange={(event) => onSearchApiKeyDraftChange(event.currentTarget.value)}
            onFocus={() => setIsSearchApiKeyFocused(true)}
            placeholder={t("settings.braveSearchApiKey")}
            type="password"
            value={shouldShowStoredApiKeyMask ? searchApiKeyStoredMask : searchApiKeyDraft}
          />
        </label>
      ) : draft.searchProvider === "tavily" ? (
        <label>
          <span>{t("settings.tavilySearchApiKey")}</span>
          <input
            autoComplete="off"
            onBlur={() => setIsSearchApiKeyFocused(false)}
            onChange={(event) => onSearchApiKeyDraftChange(event.currentTarget.value)}
            onFocus={() => setIsSearchApiKeyFocused(true)}
            placeholder={t("settings.tavilySearchApiKey")}
            type="password"
            value={shouldShowStoredApiKeyMask ? searchApiKeyStoredMask : searchApiKeyDraft}
          />
        </label>
      ) : draft.searchProvider === "searxng" ? (
        <label>
          <span>{t("settings.searxngUrl")}</span>
          <input
            onChange={(event) =>
              onDraftChange({ searxngUrl: event.currentTarget.value })
            }
            placeholder="https://searxng.example.com"
            value={draft.searxngUrl}
          />
        </label>
      ) : null}
    </div>
  );
}

function EmailDeliveryControl({
  draft,
  emailSecretDraft,
  emailSecretStoredMask,
  hasEmailSecret,
  onDraftChange,
  onEmailSecretDraftChange,
}: {
  draft: AiProviderSettingsType;
  emailSecretDraft: string;
  emailSecretStoredMask: string;
  hasEmailSecret: boolean;
  onDraftChange: (patch: Partial<AiProviderSettingsType>) => void;
  onEmailSecretDraftChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [isSecretFocused, setIsSecretFocused] = useState(false);
  const shouldShowStoredSecret =
    hasEmailSecret && !isSecretFocused && emailSecretDraft.length === 0;
  const secretLabel =
    draft.emailProvider === "smtp" ? t("settings.smtpPassword") : t("settings.emailApiKey");

  return (
    <div className="search-provider-subsection">
      <label>
        <span>{t("settings.emailProvider")}</span>
        <select
          onChange={(event) =>
            onDraftChange({
              emailProvider: event.currentTarget.value as EmailProvider,
            })
          }
          value={draft.emailProvider}
        >
          {EMAIL_PROVIDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t("settings.emailFrom")}</span>
        <input
          onChange={(event) => onDraftChange({ emailFrom: event.currentTarget.value })}
          placeholder="ops@example.com"
          value={draft.emailFrom}
        />
      </label>
      {draft.emailProvider === "mailgun" ? (
        <label>
          <span>{t("settings.mailgunDomain")}</span>
          <input
            onChange={(event) =>
              onDraftChange({ mailgunDomain: event.currentTarget.value })
            }
            placeholder="mg.example.com"
            value={draft.mailgunDomain}
          />
        </label>
      ) : null}
      {draft.emailProvider === "smtp" ? (
        <>
          <label>
            <span>{t("settings.smtpHost")}</span>
            <input
              onChange={(event) => onDraftChange({ smtpHost: event.currentTarget.value })}
              placeholder="smtp.example.com"
              value={draft.smtpHost}
            />
          </label>
          <label>
            <span>{t("settings.smtpPort")}</span>
            <input
              min={1}
              max={65535}
              onChange={(event) =>
                onDraftChange({ smtpPort: Number(event.currentTarget.value) })
              }
              type="number"
              value={draft.smtpPort}
            />
          </label>
          <label>
            <span>{t("settings.smtpSecurity")}</span>
            <select
              onChange={(event) =>
                onDraftChange({ smtpSecurity: event.currentTarget.value as SmtpSecurity })
              }
              value={draft.smtpSecurity}
            >
              {SMTP_SECURITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("settings.smtpUsername")}</span>
            <input
              onChange={(event) =>
                onDraftChange({ smtpUsername: event.currentTarget.value })
              }
              value={draft.smtpUsername}
            />
          </label>
        </>
      ) : null}
      <label>
        <span>{secretLabel}</span>
        <input
          autoComplete="off"
          onBlur={() => setIsSecretFocused(false)}
          onChange={(event) => onEmailSecretDraftChange(event.currentTarget.value)}
          onFocus={() => setIsSecretFocused(true)}
          placeholder={secretLabel}
          type="password"
          value={shouldShowStoredSecret ? emailSecretStoredMask : emailSecretDraft}
        />
      </label>
    </div>
  );
}

function AiAssistantToolsControl({
  draft,
  emailSecretDraft,
  emailSecretStoredMask,
  hasEmailSecret,
  searchApiKeyDraft,
  searchApiKeyStoredMask,
  hasSearchApiKey,
  onDraftChange,
  onEmailSecretDraftChange,
  onSearchApiKeyDraftChange,
}: {
  draft: AiProviderSettingsType;
  emailSecretDraft: string;
  emailSecretStoredMask: string;
  hasEmailSecret: boolean;
  searchApiKeyDraft: string;
  searchApiKeyStoredMask: string;
  hasSearchApiKey: boolean;
  onDraftChange: (patch: Partial<AiProviderSettingsType>) => void;
  onEmailSecretDraftChange: (value: string) => void;
  onSearchApiKeyDraftChange: (value: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <SettingsCollapsibleFieldset
      className="settings-fieldset ai-tool-settings"
      collapseLabel={t("common.collapse")}
      dataTutorialId="settings.aiToolsTitle"
      expandLabel={t("common.expand")}
      legend={t("settings.aiToolsTitle")}
    >
      <p className="settings-help-text">{t("settings.aiToolsDescription")}</p>
      <div className="settings-toggle-list">
        {AI_ASSISTANT_TOOL_IDS.map((toolId) => (
          <div key={toolId}>
            <label className="settings-toggle-row">
              <ToggleSwitch
                checked={Boolean(draft.tools?.[toolId])}
                onChange={(checked) =>
                  onDraftChange({
                    tools: {
                      ...draft.tools,
                      [toolId]: checked,
                    },
                  })
                }
              />
              <span>
                <strong>{t(`settings.aiTools.${toolId}.label`)}</strong>
                <small>{t(`settings.aiTools.${toolId}.description`)}</small>
              </span>
            </label>
            {toolId === "webSearch" && draft.tools?.webSearch ? (
              <SearchProviderControl
                draft={draft}
                hasSearchApiKey={hasSearchApiKey}
                onDraftChange={onDraftChange}
                onSearchApiKeyDraftChange={onSearchApiKeyDraftChange}
                searchApiKeyDraft={searchApiKeyDraft}
                searchApiKeyStoredMask={searchApiKeyStoredMask}
              />
            ) : toolId === "email" && draft.tools?.email ? (
              <EmailDeliveryControl
                draft={draft}
                emailSecretDraft={emailSecretDraft}
                emailSecretStoredMask={emailSecretStoredMask}
                hasEmailSecret={hasEmailSecret}
                onDraftChange={onDraftChange}
                onEmailSecretDraftChange={onEmailSecretDraftChange}
              />
            ) : null}
          </div>
        ))}
      </div>
      <p className="settings-help-text">{t("settings.aiToolsSafety")}</p>
    </SettingsCollapsibleFieldset>
  );
}

export function AiSettings() {
  const { t } = useTranslation();
  const aiProviderSettings = useWorkspaceStore((state) => state.aiProviderSettings);
  const setAiProviderSettings = useWorkspaceStore((state) => state.setAiProviderSettings);
  const setAiProviderHasApiKey = useWorkspaceStore((state) => state.setAiProviderHasApiKey);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [draft, setDraft] = useState(aiProviderSettings);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyStoredMask, setApiKeyStoredMask] = useState(createStoredApiKeyMask);
  const [selectedProviderHasApiKey, setSelectedProviderHasApiKey] = useState(false);
  const [searchApiKeyDraft, setSearchApiKeyDraft] = useState("");
  const [searchApiKeyStoredMask, setSearchApiKeyStoredMask] = useState(createStoredApiKeyMask);
  const [hasSearchApiKey, setHasSearchApiKey] = useState(false);
  const [emailSecretDraft, setEmailSecretDraft] = useState("");
  const [emailSecretStoredMask, setEmailSecretStoredMask] = useState(createStoredApiKeyMask);
  const [hasEmailSecret, setHasEmailSecret] = useState(false);
  const [copilotDeviceFlow, setCopilotDeviceFlow] =
    useState<GitHubCopilotDeviceFlow | null>(null);
  const [copilotPollIntervalSeconds, setCopilotPollIntervalSeconds] = useState(0);
  const [copilotPollTick, setCopilotPollTick] = useState(0);
  const [isCopilotPolling, setIsCopilotPolling] = useState(false);
  const [refreshedModelOptions, setRefreshedModelOptions] = useState<AiProviderModelOption[]>([]);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [showBuiltInMcpConfig, setShowBuiltInMcpConfig] = useState(false);
  const [keychainSaveError, setKeychainSaveError] = useState<string | null>(null);
  const hasChanges =
    JSON.stringify(draft) !== JSON.stringify(aiProviderSettings) ||
    apiKeyDraft.trim().length > 0 ||
    searchApiKeyDraft.trim().length > 0 ||
    emailSecretDraft.trim().length > 0;
  const aiProviderDefinition = getAiProviderDefinition(draft.providerKind);
  const useCliBackend = Boolean(
    (draft.providerKind === "openai" && draft.useCodexCli) ||
      (draft.providerKind === "anthropic" && draft.useClaudeCli) ||
      (draft.providerKind === "cursor" && draft.useCursorCli),
  );

  useEffect(() => {
    setDraft(aiProviderSettings);
  }, [aiProviderSettings]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    setApiKeyDraft("");
    void invokeCommand("secret_exists", {
      request: {
        kind: "aiApiKey",
        ownerId: aiProviderSecretOwnerId(draft.providerKind),
      },
    })
      .then((presence) => {
        if (!disposed) setSelectedProviderHasApiKey(presence.exists);
      })
      .catch(() => {
        if (!disposed) setSelectedProviderHasApiKey(false);
      });
    return () => {
      disposed = true;
    };
  }, [draft.providerKind]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    const ownerId =
      draft.searchProvider === "brave"
        ? BRAVE_SEARCH_OWNER_ID
        : draft.searchProvider === "tavily"
          ? TAVILY_SEARCH_OWNER_ID
          : null;
    if (!ownerId) {
      setHasSearchApiKey(false);
      return;
    }
    void invokeCommand("secret_exists", {
      request: {
        kind:
          draft.searchProvider === "brave"
            ? ("braveSearchApiKey" as const)
            : ("tavilySearchApiKey" as const),
        ownerId,
      },
    }).then((presence) => {
      if (!disposed) setHasSearchApiKey(presence.exists);
    });
    return () => {
      disposed = true;
    };
  }, [draft.searchProvider]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    setEmailSecretDraft("");
    const isSmtp = draft.emailProvider === "smtp";
    void invokeCommand("secret_exists", {
      request: {
        kind: isSmtp ? ("emailSmtpPassword" as const) : ("emailApiKey" as const),
        ownerId: isSmtp ? EMAIL_SMTP_SECRET_OWNER_ID : EMAIL_API_SECRET_OWNER_ID,
      },
    })
      .then((presence) => {
        if (!disposed) setHasEmailSecret(presence.exists);
      })
      .catch(() => {
        if (!disposed) setHasEmailSecret(false);
      });
    return () => {
      disposed = true;
    };
  }, [draft.emailProvider]);

  useEffect(() => {
    if (!copilotDeviceFlow || !isTauriRuntime()) return;
    let disposed = false;
    const delayMs = Math.max(1, copilotPollIntervalSeconds || copilotDeviceFlow.interval) * 1000;
    const timeoutId = window.setTimeout(() => {
      setIsCopilotPolling(true);
      void invokeCommand("poll_github_copilot_device_flow", {
        request: { deviceCode: copilotDeviceFlow.deviceCode },
      })
        .then((response) => {
          if (disposed) return;
          if (response.status === "authorized") {
            setCopilotDeviceFlow(null);
            setIsCopilotPolling(false);
            setSelectedProviderHasApiKey(true);
            if (draft.providerKind === "github-copilot") {
              setAiProviderHasApiKey(true);
            }
            showStatusBarNotice(t("settings.copilotConnected"), { tone: "success" });
            return;
          }
          const nextInterval =
            response.status === "slowDown"
              ? Math.max(1, copilotPollIntervalSeconds + (response.interval ?? 5))
              : Math.max(1, response.interval ?? copilotPollIntervalSeconds);
          setCopilotPollIntervalSeconds(nextInterval);
          setCopilotPollTick((tick) => tick + 1);
          setIsCopilotPolling(false);
        })
        .catch((error) => {
          if (disposed) return;
          setCopilotDeviceFlow(null);
          setIsCopilotPolling(false);
          showStatusBarNotice(error instanceof Error ? error.message : String(error), {
            tone: "error",
          });
        });
    }, delayMs);
    return () => {
      disposed = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    copilotDeviceFlow,
    copilotPollIntervalSeconds,
    copilotPollTick,
    draft.providerKind,
    setAiProviderHasApiKey,
    showStatusBarNotice,
    t,
  ]);

  useEffect(() => {
    if (
      !isTauriRuntime() ||
      useCliBackend ||
      !aiProviderDefinition.modelListStrategy ||
      (aiProviderDefinition.requiresApiKey && !selectedProviderHasApiKey)
    ) {
      setRefreshedModelOptions([]);
      setIsRefreshingModels(false);
      return;
    }

    let disposed = false;
    setIsRefreshingModels(true);
    void invokeCommand("list_ai_provider_models", {
      request: {
        providerKind: draft.providerKind,
        baseUrl: draft.baseUrl,
        extraHeaders: draft.extraHeaders,
        allowInsecureTls: draft.allowInsecureTls,
      },
    })
      .then((models) => {
        if (disposed) return;
        const sortedModels = sortModelOptionsForProvider(draft.providerKind, models);
        setRefreshedModelOptions(sortedModels);
        setDraft((settings) => {
          const nextModelOptions = selectModelOptionsForProvider({
            customModel: "",
            provider: aiProviderDefinition,
            refreshedModels: sortedModels,
            showAllModels: settings.showAllModels,
          });
          const nextModel = nextModelOptions[0]?.id ?? sortedModels[0]?.id;
          if (
            settings.providerKind !== draft.providerKind ||
            sortedModels.length === 0 ||
            !nextModel ||
            (settings.model.trim().length > 0 &&
              (!aiProviderDefinition.strictModelList ||
                sortedModels.some((model) => model.id === settings.model)))
          ) {
            return settings;
          }
          return { ...settings, model: nextModel };
        });
      })
      .catch(() => {
        if (!disposed) setRefreshedModelOptions([]);
      })
      .finally(() => {
        if (!disposed) setIsRefreshingModels(false);
      });

    return () => {
      disposed = true;
    };
  }, [
    aiProviderDefinition,
    draft.allowInsecureTls,
    draft.baseUrl,
    draft.extraHeaders,
    draft.providerKind,
    selectedProviderHasApiKey,
    useCliBackend,
  ]);

  async function handleRefreshModels() {
    if (
      !isTauriRuntime() ||
      useCliBackend ||
      !aiProviderDefinition.modelListStrategy ||
      (aiProviderDefinition.requiresApiKey && !selectedProviderHasApiKey)
    ) {
      return;
    }
    setIsRefreshingModels(true);
    try {
      const models = await invokeCommand("list_ai_provider_models", {
        request: {
          providerKind: draft.providerKind,
          baseUrl: draft.baseUrl,
          extraHeaders: draft.extraHeaders,
          allowInsecureTls: draft.allowInsecureTls,
        },
      });
      const sortedModels = sortModelOptionsForProvider(draft.providerKind, models);
      setRefreshedModelOptions(sortedModels);
      setDraft((settings) => {
        const nextModelOptions = selectModelOptionsForProvider({
          customModel: "",
          provider: aiProviderDefinition,
          refreshedModels: sortedModels,
          showAllModels: settings.showAllModels,
        });
        const nextModel = nextModelOptions[0]?.id ?? sortedModels[0]?.id;
        if (
          settings.providerKind !== draft.providerKind ||
          sortedModels.length === 0 ||
          !nextModel ||
          (settings.model.trim().length > 0 &&
            (!aiProviderDefinition.strictModelList ||
              sortedModels.some((model) => model.id === settings.model)))
        ) {
          return settings;
        }
        return { ...settings, model: nextModel };
      });
      showStatusBarNotice(t("settings.modelListRefreshed"), { tone: "success" });
    } catch (error) {
      setRefreshedModelOptions([]);
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    } finally {
      setIsRefreshingModels(false);
    }
  }

  async function handleSave() {
    // Attribute secret-store failures to the actual save action. Without this,
    // a failed keychain write (e.g. macOS Keychain access denied) surfaces only
    // a raw backend string and silently aborts the rest of the save, so the
    // provider switch never persists.
    const saveSecret = async (write: () => Promise<unknown>) => {
      try {
        await write();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw Object.assign(new Error(t("settings.secretSaveFailed", { error: detail })), {
          cause: error,
          secretStoreSaveFailure: true,
        });
      }
    };
    try {
      const nextSettings = normalizeAiProviderDraft(draft);

      if (apiKeyDraft.trim()) {
        if (isTauriRuntime()) {
          await saveSecret(() =>
            invokeCommand("store_secret", {
              request: {
                kind: "aiApiKey",
                ownerId: aiProviderSecretOwnerId(nextSettings.providerKind),
                secret: apiKeyDraft.trim(),
              },
            }),
          );
        }
        setAiProviderHasApiKey(true);
        setSelectedProviderHasApiKey(true);
        setApiKeyDraft("");
        setApiKeyStoredMask(createStoredApiKeyMask());
      }

      if (searchApiKeyDraft.trim()) {
        const isBrave = nextSettings.searchProvider === "brave";
        const isTavily = nextSettings.searchProvider === "tavily";
        if ((isBrave || isTavily) && isTauriRuntime()) {
          await saveSecret(() =>
            invokeCommand("store_secret", {
              request: {
                kind: isBrave ? ("braveSearchApiKey" as const) : ("tavilySearchApiKey" as const),
                ownerId: isBrave ? BRAVE_SEARCH_OWNER_ID : TAVILY_SEARCH_OWNER_ID,
                secret: searchApiKeyDraft.trim(),
              },
            }),
          );
          setHasSearchApiKey(true);
          setSearchApiKeyDraft("");
          setSearchApiKeyStoredMask(createStoredApiKeyMask());
        }
      }

      if (emailSecretDraft.trim() && isTauriRuntime()) {
        const isSmtp = nextSettings.emailProvider === "smtp";
        await saveSecret(() =>
          invokeCommand("store_secret", {
            request: {
              kind: isSmtp ? ("emailSmtpPassword" as const) : ("emailApiKey" as const),
              ownerId: isSmtp ? EMAIL_SMTP_SECRET_OWNER_ID : EMAIL_API_SECRET_OWNER_ID,
              secret: emailSecretDraft.trim(),
            },
          }),
        );
        setHasEmailSecret(true);
        setEmailSecretDraft("");
        setEmailSecretStoredMask(createStoredApiKeyMask());
      }

      const saved = isTauriRuntime()
        ? await invokeCommand("update_ai_provider_settings", { request: nextSettings })
        : nextSettings;
      setAiProviderSettings(saved);
      setDraft(saved);
      showStatusBarNotice(t("settings.aiProviderSaved"), { tone: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        err !== null &&
        typeof err === "object" &&
        (err as { secretStoreSaveFailure?: boolean }).secretStoreSaveFailure
      ) {
        // A keychain/secret-store write failed, so the rest of the save was
        // aborted. Offer an in-app reset-and-retry instead of a transient
        // notice the user is likely to miss.
        setKeychainSaveError(message);
      } else {
        showStatusBarNotice(message, { tone: "error" });
      }
    }
  }

  // Clears the stored secret-store entries the current draft is about to write,
  // then re-runs the save. Deleting first lets the re-write trigger a fresh OS
  // permission prompt when an earlier prompt was denied. Best-effort: deletions
  // are allowed to fail (the entry may not exist or may itself be locked).
  async function handleResetKeychainAndRetry() {
    setKeychainSaveError(null);
    if (isTauriRuntime()) {
      const nextSettings = normalizeAiProviderDraft(draft);
      const deletions: Promise<unknown>[] = [];
      if (apiKeyDraft.trim()) {
        deletions.push(
          invokeCommand("delete_secret", {
            request: {
              kind: "aiApiKey",
              ownerId: aiProviderSecretOwnerId(nextSettings.providerKind),
            },
          }),
        );
      }
      if (searchApiKeyDraft.trim()) {
        const isBrave = nextSettings.searchProvider === "brave";
        const isTavily = nextSettings.searchProvider === "tavily";
        if (isBrave || isTavily) {
          deletions.push(
            invokeCommand("delete_secret", {
              request: {
                kind: isBrave ? ("braveSearchApiKey" as const) : ("tavilySearchApiKey" as const),
                ownerId: isBrave ? BRAVE_SEARCH_OWNER_ID : TAVILY_SEARCH_OWNER_ID,
              },
            }),
          );
        }
      }
      if (emailSecretDraft.trim()) {
        const isSmtp = nextSettings.emailProvider === "smtp";
        deletions.push(
          invokeCommand("delete_secret", {
            request: {
              kind: isSmtp ? ("emailSmtpPassword" as const) : ("emailApiKey" as const),
              ownerId: isSmtp ? EMAIL_SMTP_SECRET_OWNER_ID : EMAIL_API_SECRET_OWNER_ID,
            },
          }),
        );
      }
      await Promise.allSettled(deletions);
    }
    await handleSave();
  }

  function handleAiProviderKindChange(providerKind: AiProviderKind) {
    const defaults = providerDefaultsFor(providerKind);
    setDraft((settings) => ({
      ...settings,
      providerKind,
      baseUrl: defaults.baseUrl,
      model: defaults.model,
      reasoningEffort: defaults.reasoningEffort,
      apiMode: defaults.apiMode,
      extraHeaders: defaults.extraHeaders,
      useCodexCli: defaults.useCodexCli,
      useClaudeCli: defaults.useClaudeCli,
      useCursorCli: defaults.useCursorCli,
    }));
    setApiKeyDraft("");
    setSelectedProviderHasApiKey(false);
    setCopilotDeviceFlow(null);
    setCopilotPollIntervalSeconds(0);
    setCopilotPollTick(0);
    setRefreshedModelOptions([]);
  }

  async function handleConnectGitHubCopilot() {
    if (!isTauriRuntime()) return;
    try {
      const flow = await invokeCommand("start_github_copilot_device_flow", undefined);
      setCopilotDeviceFlow(flow);
      setCopilotPollIntervalSeconds(flow.interval);
      setCopilotPollTick(0);
      await openExternalUrl(flow.verificationUri);
    } catch (error) {
      setCopilotDeviceFlow(null);
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    }
  }

  async function handleDisconnectGitHubCopilot() {
    if (!isTauriRuntime()) return;
    try {
      await invokeCommand("delete_secret", {
        request: {
          kind: "aiApiKey",
          ownerId: aiProviderSecretOwnerId("github-copilot"),
        },
      });
      setCopilotDeviceFlow(null);
      setCopilotPollIntervalSeconds(0);
      setCopilotPollTick(0);
      setRefreshedModelOptions([]);
      setSelectedProviderHasApiKey(false);
      if (aiProviderSettings.providerKind === "github-copilot") {
        setAiProviderHasApiKey(false);
      }
      showStatusBarNotice(t("settings.copilotDisconnected"), { tone: "success" });
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    }
  }

  useSettingsSaveRegistration({ hasChanges, onSave: handleSave });

  return (
    <section className="settings-card settings-section">
      {showBuiltInMcpConfig && (
        <BuiltInMcpConfigDialog onClose={() => setShowBuiltInMcpConfig(false)} />
      )}
      {keychainSaveError ? (
        <ConfirmSheet
          tone="warn"
          confirmIcon="refresh"
          title={t("settings.keychainSaveFailedTitle")}
          message={
            <>
              <p>{keychainSaveError}</p>
              <p>{t("settings.keychainResetHint")}</p>
            </>
          }
          confirmLabel={t("settings.keychainResetAndRetry")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => void handleResetKeychainAndRetry()}
          onCancel={() => setKeychainSaveError(null)}
        />
      ) : null}
      <SettingsSectionHeader
        icon={<Bot size={18} />}
        label={t("settings.sectionAiAssistant")}
        title={t("settings.aiProvider")}
      />

      <fieldset
        className="settings-subsection settings-fieldset"
        data-tutorial-id="settings.aiProvider"
      >
        <legend>{t("settings.aiProviderConnection")}</legend>
        <div>
          <p className="field-hint">{t("settings.aiProviderConnectionHint")}</p>
        </div>
        <div className="form-grid ai-provider-selector-grid">
          <label>
            <span>{t("settings.provider")}</span>
            <select
              onChange={(event) =>
                handleAiProviderKindChange(event.currentTarget.value as AiProviderKind)
              }
              value={draft.providerKind}
            >
              {AI_PROVIDER_DEFINITIONS.map((definition) => (
                <option key={definition.kind} value={definition.kind}>
                  {definition.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {draft.providerKind === "github-copilot" ? (
          <GitHubCopilotConnectionControl
            deviceFlow={copilotDeviceFlow}
            hasApiKey={selectedProviderHasApiKey}
            isPolling={isCopilotPolling}
            onConnect={() => void handleConnectGitHubCopilot()}
            onDisconnect={() => void handleDisconnectGitHubCopilot()}
          />
        ) : null}

        <div className="ai-provider-fields">
          {aiProviderDefinition.settingsFields.map((field) => (
            <AiProviderSettingsFieldControl
              apiKeyDraft={apiKeyDraft}
              apiKeyStoredMask={apiKeyStoredMask}
              definition={aiProviderDefinition}
              draft={draft}
              field={field}
              hasApiKey={selectedProviderHasApiKey}
              key={field}
              modelOptions={
                refreshedModelOptions.length > 0
                  ? refreshedModelOptions
                  : undefined
              }
              useCliBackend={useCliBackend}
              onApiKeyDraftChange={setApiKeyDraft}
              onDraftChange={(patch) =>
                setDraft((settings) => ({
                  ...settings,
                  ...patch,
                }))
              }
              isRefreshingModels={isRefreshingModels}
              onRefreshModels={() => void handleRefreshModels()}
            />
          ))}
        </div>
        <AiCliBackendControl
          draft={draft}
          onDraftChange={(patch) =>
            setDraft((settings) => ({
              ...settings,
              ...patch,
            }))
          }
        />
        <div className="settings-toggle-list">
          <label className="settings-toggle-row">
            <ToggleSwitch
              checked={draft.showAllModels}
              onChange={(checked) =>
                setDraft((settings) => ({
                  ...settings,
                  showAllModels: checked,
                }))
              }
            />
            <span>
              <strong>{t("settings.showAllModels")}</strong>
              <small>{t("settings.showAllModelsHint")}</small>
            </span>
          </label>
              {supportsBuiltInMcp() ? (
                <>
                  <div className="settings-toggle-row built-in-mcp-server-row">
                    <ToggleSwitch
                      checked={Boolean(draft.builtInMcpServerEnabled)}
                      onChange={(checked) =>
                        setDraft((settings) => ({
                          ...settings,
                          builtInMcpServerEnabled: checked,
                        }))
                      }
                    />
                    <span>
                      <strong>
                        {t("settings.builtInMcpServerEnabled")}
                        <button
                          className="settings-api-key-link"
                          onClick={() => setShowBuiltInMcpConfig(true)}
                          type="button"
                        >
                          {t("settings.builtInMcpShowConfig")}
                        </button>
                      </strong>
                      <small>{t("settings.builtInMcpServerEnabledHint")}</small>
                    </span>
                  </div>
                  <label className="settings-toggle-row">
                    <ToggleSwitch
                      checked={Boolean(draft.builtInMcpAllowAllDangerous)}
                      onChange={(checked) =>
                        setDraft((settings) => ({
                          ...settings,
                          builtInMcpAllowAllDangerous: checked,
                        }))
                      }
                    />
                    <span>
                      <strong className="built-in-mcp-dangerous-label">
                        {t("settings.builtInMcpAllowAllDangerous")}
                      </strong>
                      <small>{t("settings.builtInMcpAllowAllDangerousHint")}</small>
                    </span>
                  </label>
                </>
              ) : null}
          <label className="settings-toggle-row">
            <ToggleSwitch
              checked={Boolean(draft.allowInsecureMcpHttp)}
              onChange={(checked) =>
                setDraft((settings) => ({
                  ...settings,
                  allowInsecureMcpHttp: checked,
                }))
              }
            />
            <span>
              <strong>{t("settings.allowInsecureMcpHttp")}</strong>
              <small>{t("settings.allowInsecureMcpHttpHint")}</small>
            </span>
          </label>
          <label className="settings-toggle-row">
            <ToggleSwitch
              checked={draft.allowInsecureTls}
              onChange={(checked) =>
                setDraft((settings) => ({
                  ...settings,
                  allowInsecureTls: checked,
                }))
              }
            />
            <span>
              <strong>{t("settings.aiAllowInsecureTls")}</strong>
              <small>{t("settings.aiAllowInsecureTlsHint")}</small>
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.aiResponseDefaults")}</legend>
        <div>
          <p className="field-hint">{t("settings.aiResponseDefaultsHint")}</p>
        </div>
        <div className="ai-provider-fields">
          <AiOutputLanguageControl
            draft={draft}
            onDraftChange={(patch) =>
              setDraft((settings) => ({
                ...settings,
                ...patch,
              }))
            }
          />
          <div data-tutorial-id="settings.aiCustomInstructions">
          <AiCustomInstructionsControl
            draft={draft}
            onDraftChange={(patch) =>
              setDraft((settings) => ({
                ...settings,
                ...patch,
              }))
            }
          />
          </div>
        </div>
      </fieldset>

      <AiAssistantToolsControl
        draft={draft}
        emailSecretDraft={emailSecretDraft}
        emailSecretStoredMask={emailSecretStoredMask}
        hasEmailSecret={hasEmailSecret}
        hasSearchApiKey={hasSearchApiKey}
        onDraftChange={(patch) =>
          setDraft((settings) => ({
            ...settings,
            ...patch,
          }))
        }
        onEmailSecretDraftChange={setEmailSecretDraft}
        onSearchApiKeyDraftChange={setSearchApiKeyDraft}
        searchApiKeyDraft={searchApiKeyDraft}
        searchApiKeyStoredMask={searchApiKeyStoredMask}
      />

      <AssistantSkillsControl />

      <McpServersControl />

    </section>
  );
}
