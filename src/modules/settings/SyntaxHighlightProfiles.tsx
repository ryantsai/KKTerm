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
  X,
} from "../../lib/reicon";
import { Actions, Btn, ConfirmSheet, DialogShell, Sheet } from "../../app/ui/dialog";
import { ColorPalettePicker, isHexColor } from "../../app/ui/ColorPalettePicker";
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

const FONT_SUGGESTIONS = [
  "Cascadia Mono",
  "JetBrains Mono",
  "SF Mono",
  "Consolas",
  "Fira Code",
  "IBM Plex Mono",
];

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
            "Create one terminal syntax-highlighting profile as strict JSON.",
            "Return only JSON with: name, caseSensitive, and rules.",
            "Each rule needs name, pattern (JavaScript regex source without slashes), enabled, and style.",
            "Style fields: fontFamily (string or null), foreground/background (#RRGGBB or null), bold, italic.",
            "Prefer concise, non-overlapping regexes and no nested quantifiers. Limit the result to 30 useful rules.",
            "A rule's configured style takes precedence over terminal and ANSI styling for matching text.",
            "Use a readable palette on dark terminal backgrounds.",
            "",
            `User request: ${prompt}`,
          ].join("\n"),
          contextLabel: "Terminal syntax highlighting profile",
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
          <button className="toolbar-button" onClick={() => void importSecureCrt()} type="button">
            <FileUp size={14} /> {t("settings.syntaxHighlightImport")}
          </button>
          {canGenerateWithAi ? (
            <button
              aria-label={t("settings.syntaxHighlightGenerateWithAi")}
              className="toolbar-button syntax-profile-ai-button"
              onClick={() => setAiPromptOpen(true)}
              title={t("settings.syntaxHighlightGenerateWithAi")}
              type="button"
            >
              <WandSparkles size={14} />
            </button>
          ) : null}
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
                      fontFamily: entry.style.fontFamily ?? undefined,
                      fontStyle: entry.style.italic ? "italic" : undefined,
                      fontWeight: entry.style.bold ? 700 : undefined,
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
          onClose={() => setEditorDraft(null)}
          onSave={upsertProfile}
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
                primary={<Btn kind="primary" disabled={!aiPrompt.trim() || aiGenerating} onClick={() => void generateWithAi()}>{aiGenerating ? t("settings.syntaxHighlightGenerating") : t("settings.syntaxHighlightGenerate")}</Btn>}
              />
            }
          >
            <label className="syntax-profile-ai-prompt">
              <span>{t("settings.syntaxHighlightAiPrompt")}</span>
              <textarea
                autoFocus
                onChange={(event) => setAiPrompt(event.currentTarget.value)}
                placeholder={t("settings.syntaxHighlightAiPlaceholder")}
                rows={5}
                value={aiPrompt}
              />
            </label>
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
  draft: initialDraft,
  onClose,
  onSave,
}: {
  draft: TerminalSyntaxHighlightProfile;
  onClose: () => void;
  onSave: (profile: TerminalSyntaxHighlightProfile) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => cloneProfile(initialDraft));
  const [invalid, setInvalid] = useState<string | null>(null);

  function updateRule(ruleId: string, update: (rule: TerminalSyntaxHighlightRule) => TerminalSyntaxHighlightRule) {
    setDraft((current) => ({
      ...current,
      rules: current.rules.map((entry) => (entry.id === ruleId ? update(entry) : entry)),
    }));
  }

  function save() {
    const validation = validateSyntaxHighlightProfile(draft);
    if (validation) {
      setInvalid(validation);
      return;
    }
    onSave({ ...draft, name: draft.name.trim() });
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
          <div className="syntax-profile-editor-meta">
            <label>
              <span>{t("settings.syntaxHighlightProfileName")}</span>
              <input autoFocus onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })} value={draft.name} />
            </label>
            <label className="syntax-profile-check">
              <input checked={draft.caseSensitive} onChange={(event) => setDraft({ ...draft, caseSensitive: event.currentTarget.checked })} type="checkbox" />
              <span>{t("settings.syntaxHighlightCaseSensitive")}</span>
            </label>
          </div>
          {invalid ? <p className="syntax-profile-validation">{t("settings.syntaxHighlightInvalidPattern", { pattern: invalid })}</p> : null}
          <div className="syntax-profile-rules-head">
            <strong>{t("settings.syntaxHighlightRules")}</strong>
            <button className="toolbar-button" onClick={() => setDraft({ ...draft, rules: [...draft.rules, newRule()] })} type="button">
              <Plus size={14} /> {t("settings.syntaxHighlightAddRule")}
            </button>
          </div>
          <datalist id="syntax-highlight-fonts">
            {FONT_SUGGESTIONS.map((font) => <option key={font} value={font} />)}
          </datalist>
          <div className="syntax-profile-rules">
            {draft.rules.map((entry, index) => (
              <div className="syntax-profile-rule-card" key={entry.id}>
                <div className="syntax-profile-rule-topline">
                  <label className="syntax-profile-enabled">
                    <input checked={entry.enabled} onChange={(event) => updateRule(entry.id, (rule) => ({ ...rule, enabled: event.currentTarget.checked }))} type="checkbox" />
                    <span>{t("settings.syntaxHighlightEnabled")}</span>
                  </label>
                  <span className="syntax-profile-rule-number">{index + 1}</span>
                  <button aria-label={t("common.delete")} className="toolbar-button" onClick={() => setDraft({ ...draft, rules: draft.rules.filter((rule) => rule.id !== entry.id) })} title={t("common.delete")} type="button">
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="syntax-profile-rule-fields">
                  <label>
                    <span>{t("settings.syntaxHighlightRuleName")}</span>
                    <input onChange={(event) => updateRule(entry.id, (rule) => ({ ...rule, name: event.currentTarget.value }))} value={entry.name} />
                  </label>
                  <label className="syntax-profile-pattern-field">
                    <span>{t("settings.syntaxHighlightPattern")}</span>
                    <input onChange={(event) => updateRule(entry.id, (rule) => ({ ...rule, pattern: event.currentTarget.value }))} spellCheck={false} value={entry.pattern} />
                  </label>
                  <label>
                    <span>{t("settings.syntaxHighlightFont")}</span>
                    <input list="syntax-highlight-fonts" onChange={(event) => updateRule(entry.id, (rule) => ({ ...rule, style: { ...rule.style, fontFamily: event.currentTarget.value || null } }))} placeholder={t("settings.syntaxHighlightInheritFont")} value={entry.style.fontFamily ?? ""} />
                  </label>
                </div>
                <div className="syntax-profile-style-row">
                  <ColorField label={t("settings.syntaxHighlightForeground")} value={entry.style.foreground} onChange={(foreground) => updateRule(entry.id, (rule) => ({ ...rule, style: { ...rule.style, foreground } }))} />
                  <ColorField label={t("settings.syntaxHighlightBackground")} value={entry.style.background} onChange={(background) => updateRule(entry.id, (rule) => ({ ...rule, style: { ...rule.style, background } }))} />
                  <label className="syntax-profile-check"><input checked={entry.style.bold} onChange={(event) => updateRule(entry.id, (rule) => ({ ...rule, style: { ...rule.style, bold: event.currentTarget.checked } }))} type="checkbox" /><span>{t("settings.syntaxHighlightBold")}</span></label>
                  <label className="syntax-profile-check"><input checked={entry.style.italic} onChange={(event) => updateRule(entry.id, (rule) => ({ ...rule, style: { ...rule.style, italic: event.currentTarget.checked } }))} type="checkbox" /><span>{t("settings.syntaxHighlightItalic")}</span></label>
                  <span className="syntax-profile-live-preview" style={{ background: entry.style.background ?? undefined, color: entry.style.foreground ?? undefined, fontFamily: entry.style.fontFamily ?? undefined, fontStyle: entry.style.italic ? "italic" : undefined, fontWeight: entry.style.bold ? 700 : undefined }}>
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
      <i style={{ background: isHexColor(value) ? value : "transparent" }} />
      <ColorPalettePicker value={value} onChange={onChange} />
      {value ? (
        <button aria-label={label} className="toolbar-button" onClick={() => onChange(null)} type="button">
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
}
