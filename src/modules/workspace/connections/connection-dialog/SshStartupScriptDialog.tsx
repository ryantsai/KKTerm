import { useId, useState } from "react";
import { WandSparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Actions, Btn, DialogShell, GRow, Group, Sheet, Switch, TextArea } from "../../../../app/ui/dialog";
import { technicalInputProps } from "../../../../lib/inputBehavior";
import { invokeCommand, isTauriRuntime } from "../../../../lib/tauri";
import { useWorkspaceStore } from "../../../../store";
import type { Connection } from "../../../../types";

export type SshStartupScriptDraft = {
  script: string;
  applyToExistingTmux: boolean;
};

function sanitizeGeneratedScript(value: string) {
  return value
    .trim()
    .replace(/^```(?:[A-Za-z0-9_-]+)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function connectionAiContext(connection: Connection | undefined, connectionName: string) {
  return [
    `Connection name: ${connection?.name || connectionName || "SSH connection"}`,
    "Connection type: ssh",
    connection?.host ? `Host: ${connection.host}` : undefined,
    connection?.user ? `User: ${connection.user}` : undefined,
    connection?.port ? `Port: ${connection.port}` : undefined,
    connection?.useTmuxSessions !== false ? "tmux session management: enabled" : "tmux session management: disabled",
  ]
    .filter(Boolean)
    .join("\n");
}

export function SshStartupScriptDialog({
  connection,
  connectionName,
  initialScript,
  initialApplyToExistingTmux,
  onApply,
  onCancel,
}: {
  connection?: Connection;
  connectionName: string;
  initialScript: string;
  initialApplyToExistingTmux: boolean;
  onApply: (draft: SshStartupScriptDraft) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const scriptInputId = useId();
  const aiProviderSettings = useWorkspaceStore((state) => state.aiProviderSettings);
  const aiProviderHasApiKey = useWorkspaceStore((state) => state.aiProviderHasApiKey);
  const canGenerateWithAi = aiProviderHasApiKey && isTauriRuntime();

  const [script, setScript] = useState(initialScript);
  const [applyToExistingTmux, setApplyToExistingTmux] = useState(initialApplyToExistingTmux);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState("");

  async function generateScriptFromAi() {
    const normalizedPrompt = aiPrompt.trim();
    if (!normalizedPrompt || aiGenerating) {
      return;
    }
    setAiGenerating(true);
    setAiError("");
    try {
      const response = await invokeCommand("run_ai_agent", {
        request: {
          prompt: [
            "Generate a shell startup script for a KKTerm SSH session.",
            "The script is typed into the remote shell after the session opens, one line per newline.",
            "Return only the script text. No markdown, no code fence, no explanation.",
            "Keep it POSIX-shell compatible unless the connection clearly targets another shell.",
            "",
            "Connection context:",
            connectionAiContext(connection, connectionName),
            "",
            `User request: ${normalizedPrompt}`,
          ].join("\n"),
          contextLabel: connectionName ? `${connectionName} startup script` : "SSH startup script",
          messages: [],
          outputLanguage: aiProviderSettings.outputLanguage,
          allowTools: false,
        },
      });
      const generated = sanitizeGeneratedScript(response.content);
      if (generated) {
        setScript(generated);
        setAiPromptOpen(false);
        setAiPrompt("");
      }
    } catch (error) {
      setAiError(
        t("connections.sshStartupScriptAiFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setAiGenerating(false);
    }
  }

  return (
    <DialogShell onBackdrop={onCancel} zClassName="kk-qc-subdialog">
      <Sheet
        width={540}
        title={t("connections.sshStartupScriptEditorTitle")}
        ariaLabel={t("connections.sshStartupScriptEditorTitle")}
        footer={
          <Actions
            cancel={<Btn onClick={onCancel}>{t("common.cancel")}</Btn>}
            primary={
              <Btn kind="primary" onClick={() => onApply({ script: script.trim(), applyToExistingTmux })}>
                {t("common.save")}
              </Btn>
            }
          />
        }
      >
        <p className="kk-dlg-sub connection-environment-guidance">{t("connections.sshStartupScriptEditorHint")}</p>
        <div className="kk-field">
          <div className="kk-qc-cmd-head">
            <span className="kk-lbl">{t("connections.sshStartupScript")}</span>
            {canGenerateWithAi ? (
              <button
                className="kk-qc-ai-btn"
                onClick={() => {
                  setAiPromptOpen((open) => !open);
                  setAiError("");
                }}
                title={t("connections.sshStartupScriptGenerateWithAi")}
                type="button"
                aria-label={t("connections.sshStartupScriptGenerateWithAi")}
              >
                <WandSparkles size={13} aria-hidden />
              </button>
            ) : null}
          </div>
          <div className="kk-qc-cmd-wrap">
            <TextArea
              id={scriptInputId}
              {...technicalInputProps}
              value={script}
              onChange={(event) => setScript(event.currentTarget.value)}
              placeholder={t("connections.sshStartupScriptPlaceholder")}
              rows={6}
            />
            {aiPromptOpen ? (
              <div className="kk-qc-ai-popover" role="dialog" aria-label={t("connections.sshStartupScriptGenerateWithAi")}>
                <label className="kk-lbl" htmlFor={`${scriptInputId}-ai`}>
                  {t("connections.sshStartupScriptAiPromptLabel")}
                </label>
                <input
                  id={`${scriptInputId}-ai`}
                  className="kk-inp"
                  {...technicalInputProps}
                  onChange={(event) => setAiPrompt(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void generateScriptFromAi();
                    }
                  }}
                  placeholder={t("connections.sshStartupScriptAiPromptPlaceholder")}
                  value={aiPrompt}
                />
                {aiError ? <p className="kk-qc-ai-error">{aiError}</p> : null}
                <div className="kk-qc-ai-actions">
                  <Btn onClick={() => setAiPromptOpen(false)} disabled={aiGenerating} sm>
                    {t("common.cancel")}
                  </Btn>
                  <Btn
                    kind="primary"
                    onClick={() => void generateScriptFromAi()}
                    disabled={!aiPrompt.trim() || aiGenerating}
                    sm
                  >
                    {aiGenerating
                      ? t("connections.sshStartupScriptAiGenerating")
                      : t("connections.sshStartupScriptAiGenerate")}
                  </Btn>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <Group>
          <GRow
            icon="stack"
            label={t("connections.sshStartupScriptApplyExistingTmux")}
            desc={t("connections.sshStartupScriptApplyExistingTmuxDesc")}
            control={
              <Switch
                on={applyToExistingTmux}
                onChange={setApplyToExistingTmux}
                ariaLabel={t("connections.sshStartupScriptApplyExistingTmux")}
              />
            }
          />
        </Group>
      </Sheet>
    </DialogShell>
  );
}
