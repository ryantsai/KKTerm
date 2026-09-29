import builtinProfiles from "../../../../shared/builtinHighlightProfiles.json";
import type {
  TerminalSyntaxHighlightProfile,
  TerminalSyntaxHighlightRule,
  TerminalSyntaxHighlightStyle,
} from "../../../../types";

export const BUILTIN_SYNTAX_HIGHLIGHT_PREFIX = "builtin:";

// Shared immutable defaults keep tool-side validation and the UI in agreement.
export const BUILTIN_SYNTAX_HIGHLIGHT_PROFILES: readonly TerminalSyntaxHighlightProfile[] = builtinProfiles;

const style = (foreground: string | null, options: Partial<TerminalSyntaxHighlightStyle> = {}): TerminalSyntaxHighlightStyle => ({
  fontFamily: null, foreground, background: null, bold: false, italic: false, ...options,
});

export function syntaxHighlightProfileId(prefix = "syntax-profile") {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function syntaxHighlightRuleId() {
  return syntaxHighlightProfileId("syntax-rule");
}

export function isBuiltinSyntaxHighlightProfile(profileId: string) {
  return profileId.startsWith(BUILTIN_SYNTAX_HIGHLIGHT_PREFIX);
}

export function allSyntaxHighlightProfiles(
  userProfiles: TerminalSyntaxHighlightProfile[] | undefined,
): TerminalSyntaxHighlightProfile[] {
  return [...BUILTIN_SYNTAX_HIGHLIGHT_PROFILES, ...(userProfiles ?? [])];
}

export function findSyntaxHighlightProfile(
  profileId: string | null | undefined,
  userProfiles: TerminalSyntaxHighlightProfile[] | undefined,
) {
  if (!profileId) return null;
  return allSyntaxHighlightProfiles(userProfiles).find((profile) => profile.id === profileId) ?? null;
}

export function copySyntaxHighlightProfile(
  profile: TerminalSyntaxHighlightProfile,
  name = `${profile.name} Copy`,
): TerminalSyntaxHighlightProfile {
  return {
    ...profile,
    id: syntaxHighlightProfileId(),
    name,
    caseSensitive: false,
    rules: profile.rules.map((entry) => ({
      ...entry,
      id: syntaxHighlightRuleId(),
      style: { ...entry.style },
    })),
  };
}

export function emptySyntaxHighlightProfile(name = "New Profile"): TerminalSyntaxHighlightProfile {
  return {
    id: syntaxHighlightProfileId(),
    name,
    caseSensitive: false,
    rules: [],
  };
}

export function validateSyntaxHighlightProfile(profile: TerminalSyntaxHighlightProfile): string | null {
  if (!profile.name.trim()) return "name";
  for (const entry of profile.rules) {
    if (!entry.name.trim() || !entry.pattern.trim()) return "rule";
    try {
      new RegExp(entry.pattern, "gi");
    } catch {
      return entry.pattern;
    }
  }
  return null;
}

function secureCrtColorToHex(value: string) {
  const normalized = value.padStart(8, "0").slice(-8);
  const blue = normalized.slice(2, 4);
  const green = normalized.slice(4, 6);
  const red = normalized.slice(6, 8);
  return `#${red}${green}${blue}`.toUpperCase();
}

function unescapeSecureCrtQuoted(value: string) {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

export function parseSecureCrtKeywordIni(
  source: string,
  fallbackName = "Imported SecureCRT Profile",
): TerminalSyntaxHighlightProfile {
  const nameMatch = source.match(/^S:"List Name"=(.+)$/m);
  const version = /Z:"Keyword List V3"=/m.test(source) ? 3 : 2;
  const entries: TerminalSyntaxHighlightRule[] = [];
  const linePattern = /^\s*"((?:\\.|[^"])*)",([0-9a-f]{8}),([0-9a-f]{8})(?:,([0-9a-f]{8}))?\s*$/i;

  for (const line of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.match(linePattern);
    if (!match) continue;
    const pattern = unescapeSecureCrtQuoted(match[1]);
    const color = secureCrtColorToHex(match[2]);
    const attributes = Number.parseInt(match[3], 16);
    const enabled = version === 2 ? attributes !== 0 : (attributes & 0x1) !== 0;
    const reverse = version === 3 && (attributes & 0x10) !== 0;
    if (!pattern || pattern.startsWith("[*]")) continue;
    entries.push({
      id: syntaxHighlightRuleId(),
      name: pattern.length > 42 ? `${pattern.slice(0, 39)}…` : pattern,
      pattern,
      enabled,
      style: style(reverse ? null : color, {
        background: reverse ? color : null,
      }),
    });
  }

  if (entries.length === 0) {
    throw new Error("No SecureCRT keyword rules were found.");
  }

  return {
    id: syntaxHighlightProfileId(),
    name: nameMatch?.[1]?.trim() || fallbackName.replace(/\.ini$/i, "") || fallbackName,
    caseSensitive: false,
    rules: entries,
  };
}

export function parseAiSyntaxHighlightProfile(source: string): TerminalSyntaxHighlightProfile {
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? source;
  const parsed = JSON.parse(fenced.trim()) as Partial<TerminalSyntaxHighlightProfile>;
  if (!parsed || typeof parsed.name !== "string" || !Array.isArray(parsed.rules)) {
    throw new Error("The AI response did not contain a profile.");
  }
  const profile: TerminalSyntaxHighlightProfile = {
    id: syntaxHighlightProfileId(),
    name: parsed.name.trim().slice(0, 80) || "Generated Profile",
    caseSensitive: false,
    rules: parsed.rules.slice(0, 100).map((candidate, index) => {
      const raw = candidate as Partial<TerminalSyntaxHighlightRule>;
      const rawStyle = (raw.style ?? {}) as Partial<TerminalSyntaxHighlightStyle>;
      const color = (value: unknown) =>
        typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : null;
      return {
        id: syntaxHighlightRuleId(),
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 80) : `Rule ${index + 1}`,
        pattern: typeof raw.pattern === "string" ? raw.pattern.trim().slice(0, 2_000) : "",
        enabled: raw.enabled !== false,
        style: {
          fontFamily: null,
          foreground: color(rawStyle.foreground),
          background: color(rawStyle.background),
          bold: false,
          italic: false,
        },
      };
    }),
  };
  const invalid = validateSyntaxHighlightProfile(profile);
  if (invalid) throw new Error(`Invalid generated profile: ${invalid}`);
  return profile;
}
