import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Braces,
  Copy,
  FileUp,
  Pencil,
  Plus,
  Trash2,
  WandSparkles,
} from "../../lib/reicon";
import {
  Actions,
  Btn,
  ConfirmSheet,
  DialogShell,
  Field,
  Sheet,
  Switch,
  TextArea,
  TextInput,
} from "../../app/ui/dialog";
import { ColorPalettePicker } from "../../app/ui/ColorPalettePicker";
import {
  invokeCommand,
  isTauriRuntime,
  selectAndReadSyntaxHighlightIni,
} from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type {
  TerminalSyntaxHighlightProfile,
  TerminalSyntaxHighlightRule,
  TerminalSyntaxHighlightStyle,
} from "../../types";
import {
  allSyntaxHighlightProfiles,
  copySyntaxHighlightProfile,
  emptySyntaxHighlightProfile,
  isBuiltinSyntaxHighlightProfile,
  parseAiSyntaxHighlightProfile,
  parseSecureCrtKeywordIni,
  syntaxHighlightRuleId,
  validateSyntaxHighlightProfile,
} from "../workspace/connections/terminal/syntaxHighlighting";

const EMPTY_STYLE: TerminalSyntaxHighlightStyle = {
  fontFamily: null,
  foreground: "#7BD88F",
  background: null,
  bold: false,
  italic: false,
};

function newRule(): TerminalSyntaxHighlightRule {
  return {
    id: syntaxHighlightRuleId(),
    name: "",
    pattern: "",
    enabled: true,
    style: { ...EMPTY_STYLE },
  };
}

function cloneProfile(profile: TerminalSyntaxHighlightProfile) {
  return {
    ...profile,
    rules: profile.rules.map((entry) => ({ ...entry, style: { ...entry.style } })),
  };
}

export function SyntaxHighlightProfileManager({
  profiles,
  onChange,
}: {
  profiles: TerminalSyntaxHighlightProfile[];
  onChange: (profiles: TerminalSyntaxHighlightProfile[]) => void;
}) {
  const { t } = useTranslation();
  const aiProviderSettings = useWorkspaceStore((state) => state.aiProviderSettings);
  const aiProviderHasApiKey = useWorkspaceStore((state) => state.aiProviderHasApiKey);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const catalog = useMemo(() => allSyntaxHighlightProfiles(profiles), [profiles]);
  const [selectedId, setSelectedId] = useState(catalog[0]?.id ?? "");
  const [editorDraft, setEditorDraft] = useState<TerminalSyntaxHighlightProfile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TerminalSyntaxHighlightProfile | null>(null);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const selected = catalog.find((profile) => profile.id === selectedId) ?? catalog[0];
  const canGenerateWithAi = aiProviderHasApiKey && isTauriRuntime();
  const editorIsCreating = editorDraft ? !profiles.some((profile) => profile.id === editorDraft.id) : false;

  function upsertProfile(profile: TerminalSyntaxHighlightProfile) {
    const index = profiles.findIndex((candidate) => candidate.id === profile.id);
    const next = [...profiles];
    if (index >= 0) next[index] = profile;
    else next.push(profile);
    onChange(next);
    setSelectedId(profile.id);
    setEditorDraft(null);
  }

  async function importSecureCrt() {
    try {
      const file = await selectAndReadSyntaxHighlightIni({
        title: t("settings.syntaxHighlightImportTitle"),
        filterName: t("settings.syntaxHighlightIniFiles"),
      });
      if (!file) return;
      setEditorDraft(parseSecureCrtKeywordIni(file.text, file.name));
    } catch (error) {
      showStatusBarNotice(
        t("settings.syntaxHighlightImportFailed", { message: error instanceof Error ? error.message : String(error) }),
        { tone: "error" },
      );
    }
  }

  async function generateWithAi() {
    const prompt = aiPrompt.trim();
    if (!prompt || aiGenerating) return;
    setAiGenerating(true);
    try {
      const response = await invokeCommand("run_ai_agent", {
        request: {
          prompt: [
            "Create one terminal keyword-highlighting profile as strict JSON.",
            "Return only JSON with: name and rules.",
            "Each rule needs name, pattern (JavaScript regex source without slashes), enabled, and style.",
            "Style fields: foreground and background (#RRGGBB or null).",
            "Matching is always case-insensitive.",
            "Prefer concise, non-overlapping regexes and no nested quantifiers. Limit the result to 30 useful rules.",
            "A rule's configured colors take precedence over terminal and ANSI colors for matching text.",
            "Use a readable palette on dark terminal backgrounds.",
            "",
            `User request: ${prompt}`,
          ].join("\n"),
          contextLabel: "Terminal keyword highlighting profile",
          messages: [],
          outputLanguage: aiProviderSettings.outputLanguage,
          allowTools: false,
        },
      });
      setEditorDraft(parseAiSyntaxHighlightProfile(response.content));
      setAiPromptOpen(false);
      setAiPrompt("");
    } catch (error) {
      showStatusBarNotice(
        t("settings.syntaxHighlightAiFailed", { message: error instanceof Error ? error.message : String(error) }),
        { tone: "error" },
      );
    } finally {
      setAiGenerating(false);
    }
  }

  return (
    <>
      <div className="syntax-profile-manager">
        <div className="syntax-profile-toolbar">
          <button className="toolbar-button" onClick={() => setEditorDraft(emptySyntaxHighlightProfile())} type="button">
            <Plus size={14} /> {t("settings.syntaxHighlightNewProfile")}
          </button>
        </div>
        <div className="syntax-profile-layout">
          <div className="syntax-profile-list" role="listbox" aria-label={t("settings.syntaxHighlighting") }>
            {catalog.map((profile) => {
              const builtin = isBuiltinSyntaxHighlightProfile(profile.id);
              const active = profile.id === selected?.id;
              return (
                <button
                  aria-selected={active}
                  className={`syntax-profile-row${active ? " active" : ""}`}
                  key={profile.id}
                  onClick={() => setSelectedId(profile.id)}
                  role="option"
                  type="button"
                >
                  <Braces size={15} />
                  <span>
                    <strong>{profile.name}</strong>
                    <small>{t("settings.syntaxHighlightRulesCount", { count: profile.rules.length })}</small>
                  </span>
                  <em>{t(builtin ? "settings.syntaxHighlightBuiltIn" : "settings.syntaxHighlightCustom")}</em>
                </button>
              );
            })}
          </div>
          {selected ? (
            <div className="syntax-profile-summary">
              <div className="syntax-profile-summary-head">
                <div>
                  <strong>{selected.name}</strong>
                  <small>{t("settings.syntaxHighlightOverridesStyles")}</small>
                </div>
                <div className="syntax-profile-summary-actions">
                  <button
                    aria-label={t("settings.syntaxHighlightCopy")}
                    className="toolbar-button"
                    onClick={() => setEditorDraft(copySyntaxHighlightProfile(selected))}
                    title={t("settings.syntaxHighlightCopy")}
                    type="button"
                  >
                    <Copy size={14} />
                  </button>
                  {!isBuiltinSyntaxHighlightProfile(selected.id) ? (
                    <>
                      <button
                        aria-label={t("settings.syntaxHighlightEdit")}
                        className="toolbar-button"
                        onClick={() => setEditorDraft(cloneProfile(selected))}
                        title={t("settings.syntaxHighlightEdit")}
                        type="button"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        aria-label={t("settings.syntaxHighlightDelete")}
                        className="toolbar-button"
                        onClick={() => setDeleteTarget(selected)}
                        title={t("settings.syntaxHighlightDelete")}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="syntax-profile-rule-preview">
                {selected.rules.slice(0, 12).map((entry) => (
                  <span
                    key={entry.id}
                    style={{
                      background: entry.style.background ?? undefined,
                      color: entry.style.foreground ?? undefined,
                    }}
                  >
                    {entry.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {editorDraft ? (
        <SyntaxProfileEditor
          draft={editorDraft}
          canGenerateWithAi={canGenerateWithAi}
          onChange={setEditorDraft}
          onClose={() => setEditorDraft(null)}
          onGenerateWithAi={() => setAiPromptOpen(true)}
          onImport={() => void importSecureCrt()}
          onSave={upsertProfile}
          showCreationActions={editorIsCreating}
        />
      ) : null}

      {aiPromptOpen ? (
        <DialogShell onBackdrop={() => !aiGenerating && setAiPromptOpen(false)}>
          <Sheet
            ariaLabel={t("settings.syntaxHighlightGenerateWithAi")}
            title={t("settings.syntaxHighlightGenerateWithAi")}
            width={480}
            footer={
              <Actions
                cancel={<Btn disabled={aiGenerating} onClick={() => setAiPromptOpen(false)}>{t("common.cancel")}</Btn>}
                primary={<Btn kind="primary" icon="wand" disabled={!aiPrompt.trim() || aiGenerating} onClick={() => void generateWithAi()}>{aiGenerating ? t("settings.syntaxHighlightGenerating") : t("settings.syntaxHighlightGenerate")}</Btn>}
              />
            }
          >
            <Field className="syntax-profile-ai-prompt" label={t("settings.syntaxHighlightAiPrompt")}>
              <TextArea
                autoFocus
                onChange={(event) => setAiPrompt(event.currentTarget.value)}
                placeholder={t("settings.syntaxHighlightAiPlaceholder")}
                rows={5}
                value={aiPrompt}
              />
            </Field>
          </Sheet>
        </DialogShell>
      ) : null}

      {deleteTarget ? (
        <ConfirmSheet
          title={t("settings.syntaxHighlightDeleteTitle")}
          message={t("settings.syntaxHighlightDeleteBody", { name: deleteTarget.name })}
          confirmLabel={t("common.delete")}
          cancelLabel={t("common.cancel")}
          tone="danger"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            onChange(profiles.filter((profile) => profile.id !== deleteTarget.id));
            setSelectedId(catalog[0]?.id ?? "");
            setDeleteTarget(null);
          }}
        />
      ) : null}
    </>
  );
}

function SyntaxProfileEditor({
  draft,
  canGenerateWithAi,
  onChange,
  onClose,
  onGenerateWithAi,
  onImport,
  onSave,
  showCreationActions,
}: {
  draft: TerminalSyntaxHighlightProfile;
  canGenerateWithAi: boolean;
  onChange: (profile: TerminalSyntaxHighlightProfile) => void;
  onClose: () => void;
  onGenerateWithAi: () => void;
  onImport: () => void;
  onSave: (profile: TerminalSyntaxHighlightProfile) => void;
  showCreationActions: boolean;
}) {
  const { t } = useTranslation();
  const [invalid, setInvalid] = useState<string | null>(null);

  function updateRule(ruleId: string, update: (rule: TerminalSyntaxHighlightRule) => TerminalSyntaxHighlightRule) {
    onChange({
      ...draft,
      rules: draft.rules.map((entry) => (entry.id === ruleId ? update(entry) : entry)),
    });
  }

  function save() {
    const validation = validateSyntaxHighlightProfile(draft);
    if (validation) {
      setInvalid(validation);
      return;
    }
    onSave({ ...draft, name: draft.name.trim(), caseSensitive: false });
  }

  return (
    <DialogShell onBackdrop={onClose} zClassName="syntax-profile-editor-dialog">
      <Sheet
        ariaLabel={t("settings.syntaxHighlightEdit")}
        title={t("settings.syntaxHighlightEdit")}
        width={780}
        footer={
          <Actions
            cancel={<Btn onClick={onClose}>{t("common.cancel")}</Btn>}
            primary={<Btn kind="primary" icon="check" onClick={save}>{t("settings.syntaxHighlightSaveProfile")}</Btn>}
          />
        }
      >
        <div className="syntax-profile-editor">
          <div className={`syntax-profile-editor-meta${showCreationActions ? " has-actions" : ""}`}>
            <Field label={t("settings.syntaxHighlightProfileName")}>
              <TextInput autoFocus onChange={(event) => onChange({ ...draft, name: event.currentTarget.value })} value={draft.name} />
            </Field>
            {showCreationActions ? (
              <div className="syntax-profile-editor-meta-actions">
                <button
                  className="toolbar-button"
                  onClick={onImport}
                  title={t("settings.syntaxHighlightImportTitle")}
                  type="button"
                >
                  <FileUp size={14} /> {t("settings.syntaxHighlightImport")}
                </button>
                {canGenerateWithAi ? (
                  <button
                    aria-label={t("settings.syntaxHighlightGenerateWithAi")}
                    className="toolbar-button syntax-profile-ai-button"
                    onClick={onGenerateWithAi}
                    title={t("settings.syntaxHighlightGenerateWithAi")}
                    type="button"
                  >
                    <WandSparkles size={14} />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {invalid ? <p className="syntax-profile-validation">{t("settings.syntaxHighlightInvalidPattern", { pattern: invalid })}</p> : null}
          <div className="syntax-profile-rules-head">
            <strong>{t("settings.syntaxHighlightRules")}</strong>
            <button className="toolbar-button" onClick={() => onChange({ ...draft, rules: [...draft.rules, newRule()] })} type="button">
              <Plus size={14} /> {t("settings.syntaxHighlightAddRule")}
            </button>
          </div>
          <div className="syntax-profile-rules">
            {draft.rules.map((entry, index) => (
              <div className="syntax-profile-rule-card" key={entry.id}>
                <div className="syntax-profile-rule-topline">
                  <div className="syntax-profile-enabled">
                    <Switch ariaLabel={t("settings.syntaxHighlightEnabled")} on={entry.enabled} onChange={(enabled) => updateRule(entry.id, (rule) => ({ ...rule, enabled }))} />
                    <span>{t("settings.syntaxHighlightEnabled")}</span>
                  </div>
                  <span className="syntax-profile-rule-number">{index + 1}</span>
                  <button aria-label={t("common.delete")} className="toolbar-button" onClick={() => onChange({ ...draft, rules: draft.rules.filter((rule) => rule.id !== entry.id) })} title={t("common.delete")} type="button">
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="syntax-profile-rule-fields">
                  <Field label={t("settings.syntaxHighlightRuleName")}>
                    <TextInput onChange={(event) => updateRule(entry.id, (rule) => ({ ...rule, name: event.currentTarget.value }))} value={entry.name} />
                  </Field>
                  <Field className="syntax-profile-pattern-field" label={t("settings.syntaxHighlightPattern")}>
                    <TextInput mono onChange={(event) => updateRule(entry.id, (rule) => ({ ...rule, pattern: event.currentTarget.value }))} value={entry.pattern} />
                  </Field>
                </div>
                <div className="syntax-profile-style-row">
                  <ColorField label={t("settings.syntaxHighlightForeground")} value={entry.style.foreground} onChange={(foreground) => updateRule(entry.id, (rule) => ({ ...rule, style: { ...rule.style, foreground } }))} />
                  <ColorField label={t("settings.syntaxHighlightBackground")} value={entry.style.background} onChange={(background) => updateRule(entry.id, (rule) => ({ ...rule, style: { ...rule.style, background } }))} />
                  <span className="syntax-profile-live-preview" style={{ background: entry.style.background ?? undefined, color: entry.style.foreground ?? undefined }}>
                    {entry.name || "Aa"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Sheet>
    </DialogShell>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="syntax-profile-color-field">
      <span>{label}</span>
      <ColorPalettePicker ariaLabel={label} onClear={() => onChange(null)} trigger="swatch" value={value} onChange={onChange} />
    </div>
  );
}
