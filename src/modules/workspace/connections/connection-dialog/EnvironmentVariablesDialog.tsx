import { WandSparkles } from "../../../../lib/reicon";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import claudeCodeIcon from "../../../../assets/installer-icons/claude-code.svg?url";
import codexIcon from "../../../../assets/installer-icons/codex.svg?url";
import { Actions, Btn, DialogShell, Field, Sheet, TextInput } from "../../../../app/ui/dialog";
import { readDurableUiState, writeDurableUiState } from "../../../../lib/durableUiState";
import {
  applyEnvironmentBlock,
  createCliAccountVariable,
  parseEnvironmentBlock,
  renderEnvironmentBlock,
  slugCliAccountLabel,
  type CliAccountTool,
  type EnvironmentShellFamily,
} from "./environmentVariables";

export const KKTERM_CLI_ACCOUNT_LABELS_STORAGE_KEY = "kkterm.cliAccountLabels.v1";
const MAX_REMEMBERED_ACCOUNT_LABELS = 20;

const CLI_TOOLS: Array<{ icon: string; value: CliAccountTool; labelKey: string }> = [
  { icon: claudeCodeIcon, value: "claude-code", labelKey: "connections.cliAccountClaudeCode" },
  { icon: codexIcon, value: "codex", labelKey: "connections.cliAccountCodex" },
];

export function CliAccountDialog({
  connectionName,
  shellFamily,
  startupScript,
  onApply,
  onCancel,
}: {
  connectionName: string;
  shellFamily: EnvironmentShellFamily;
  startupScript: string;
  onApply: (script: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const accountLabelListId = useId();
  const parsed = useMemo(() => parseEnvironmentBlock(startupScript, shellFamily), [shellFamily, startupScript]);
  const [tool, setTool] = useState<CliAccountTool>("claude-code");
  const [label, setLabel] = useState(connectionName);
  const [rememberedLabels] = useState(readRememberedAccountLabels);
  const [error, setError] = useState(false);
  const slug = slugCliAccountLabel(label);
  const preview = slug ? createCliAccountVariable(tool, label, shellFamily).value : "—";
  const malformed = parsed.status === "malformed";

  function applyAccount() {
    if (!slug || malformed) {
      setError(true);
      return;
    }

    const variable = createCliAccountVariable(tool, label, shellFamily);
    const variables = parsed.status === "ok" ? [...parsed.variables] : [];
    const matchIndex = variables.findIndex((item) => item.name.toLowerCase() === variable.name.toLowerCase());
    if (matchIndex >= 0) variables[matchIndex] = variable;
    else variables.push(variable);

    rememberAccountLabel(label, rememberedLabels);
    onApply(applyEnvironmentBlock(startupScript, renderEnvironmentBlock(variables, shellFamily)));
  }

  return (
    <DialogShell onBackdrop={onCancel}>
      <Sheet
        footer={
          <Actions
            cancel={<Btn onClick={onCancel}>{t("common.cancel")}</Btn>}
            primary={
              <Btn disabled={malformed} kind="primary" onClick={applyAccount}>
                <WandSparkles size={14} aria-hidden />
                {t("connections.cliAccountApply")}
              </Btn>
            }
          />
        }
        title={t("connections.cliAccountHelper")}
        width={520}
      >
        <p className="kk-dlg-sub connection-environment-guidance">{t("connections.cliAccountHint")}</p>
        <div className="connection-cli-account-fields">
          <Field label={t("connections.cliAccountTool")}>
            <div className="connection-cli-tool-options" role="radiogroup" aria-label={t("connections.cliAccountTool")}>
              {CLI_TOOLS.map((option) => (
                <button
                  aria-checked={tool === option.value}
                  className="connection-cli-tool-option"
                  data-selected={tool === option.value ? "true" : undefined}
                  key={option.value}
                  onClick={() => setTool(option.value)}
                  role="radio"
                  type="button"
                >
                  <img alt="" aria-hidden src={option.icon} />
                  <span>{t(option.labelKey)}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label={t("connections.cliAccountLabel")}>
            <TextInput
              list={accountLabelListId}
              onChange={(event) => {
                setLabel(event.currentTarget.value);
                setError(false);
              }}
              placeholder={t("connections.cliAccountLabelPlaceholder")}
              value={label}
            />
            <datalist id={accountLabelListId}>
              {rememberedLabels.map((rememberedLabel) => (
                <option key={rememberedLabel} value={rememberedLabel} />
              ))}
            </datalist>
          </Field>
        </div>
        <div className="connection-cli-account-path">
          <span>{t("connections.cliAccountDirectory")}</span>
          <code>{preview}</code>
        </div>
        {malformed ? <p className="field-error">{t("connections.environmentVariablesMalformed")}</p> : null}
        {error && !malformed ? <p className="field-error">{t("connections.cliAccountInvalidLabel")}</p> : null}
      </Sheet>
    </DialogShell>
  );
}

function readRememberedAccountLabels() {
  try {
    const value: unknown = JSON.parse(readDurableUiState(KKTERM_CLI_ACCOUNT_LABELS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return uniqueLabels(value.filter((label: unknown): label is string => typeof label === "string"));
  } catch {
    return [];
  }
}

function rememberAccountLabel(label: string, currentLabels: string[]) {
  const nextLabels = uniqueLabels([label, ...currentLabels]);
  // Remembered CLI account labels are durable convenience data: SQLite source
  // of truth (backed up, portable), mirrored to the synchronous cache.
  writeDurableUiState(KKTERM_CLI_ACCOUNT_LABELS_STORAGE_KEY, JSON.stringify(nextLabels));
  return nextLabels;
}

function uniqueLabels(labels: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of labels) {
    const label = value.trim();
    const key = label.toLocaleLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
    if (result.length === MAX_REMEMBERED_ACCOUNT_LABELS) break;
  }
  return result;
}
