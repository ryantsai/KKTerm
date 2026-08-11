import type {
  TerminalSyntaxHighlightProfile,
  TerminalSyntaxHighlightRule,
  TerminalSyntaxHighlightStyle,
} from "../../../../types";

export const BUILTIN_SYNTAX_HIGHLIGHT_PREFIX = "builtin:";

const style = (
  foreground: string | null,
  options: Partial<TerminalSyntaxHighlightStyle> = {},
): TerminalSyntaxHighlightStyle => ({
  fontFamily: null,
  foreground,
  background: null,
  bold: false,
  italic: false,
  ...options,
});

const rule = (
  id: string,
  name: string,
  pattern: string,
  ruleStyle: TerminalSyntaxHighlightStyle,
): TerminalSyntaxHighlightRule => ({ id, name, pattern, enabled: true, style: ruleStyle });

/**
 * Small, maintained-in-repo defaults. The Cisco shape was researched against
 * the community SecureCRT list and ChromaTerm's networking rules, but these
 * expressions are intentionally compact originals rather than a vendored list.
 */
export const BUILTIN_SYNTAX_HIGHLIGHT_PROFILES: readonly TerminalSyntaxHighlightProfile[] = [
  {
    id: "builtin:cisco-ios",
    name: "Cisco IOS",
    caseSensitive: false,
    rules: [
      rule("cisco-prompt", "CLI prompt", "(?:^|\\s)[A-Za-z0-9._-]+(?:\\([^)]*\\))?[>#](?=\\s|$)", style("#F6C85F")),
      rule("cisco-interface", "Interfaces", "\\b(?:Gi|GigabitEthernet|Fa|FastEthernet|Te|TenGigabitEthernet|Eth|Ethernet|Po|Port-channel|Vl|Vlan|Lo|Loopback|Tu|Tunnel|Se|Serial)\\d+(?:[/:.]\\d+)*\\b", style("#5CC8FF")),
      rule("cisco-ipv4", "IPv4 and CIDR", "\\b(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}(?:/\\d{1,2}|:\\d{1,5})?\\b", style("#7BD88F")),
      rule("cisco-mac", "MAC addresses", "\\b(?:[0-9a-f]{4}\\.){2}[0-9a-f]{4}\\b|\\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\\b", style("#A8E6CF")),
      rule("cisco-good", "Healthy states", "\\b(?:up|connected|enabled|active|success|passed|complete|permit)\\b", style("#7BD88F")),
      rule("cisco-warn", "Attention states", "\\b(?:warning|initializing|standby|degraded|flapping|trunk)\\b|\\[(?:confirm|yes/no)\\]", style("#F6C85F")),
      rule("cisco-bad", "Failure states", "\\b(?:down|administratively down|err-disabled|disabled|failed?|invalid|den(?:y|ied)|timeout|unreachable)\\b|%[A-Z0-9_-]+-[0-2]-", style("#FF6B6B")),
      rule("cisco-routing", "Routing protocols", "\\b(?:BGP|OSPFv3?|EIGRP|RIP|HSRP|VRRP|MPLS|LDP)\\b", style("#C792EA")),
    ],
  },
  {
    id: "builtin:juniper-junos",
    name: "Juniper Junos",
    caseSensitive: false,
    rules: [
      rule("junos-prompt", "CLI prompt", "(?:^|\\s)[A-Za-z0-9._-]+@[A-Za-z0-9._-]+[>%#](?=\\s|$)", style("#F6C85F")),
      rule("junos-interface", "Interfaces", "\\b(?:ae|at|em|et|fe|fxp|ge|gr|irb|lo0|lt|reth|st0|xe)-?\\d+(?:/\\d+){0,2}(?:\\.\\d+)?\\b", style("#5CC8FF")),
      rule("junos-ipv4", "IPv4 and CIDR", "\\b(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}(?:/\\d{1,2})?\\b", style("#7BD88F")),
      rule("junos-good", "Healthy states", "\\b(?:up|established|master|enabled|active|complete|success)\\b", style("#7BD88F")),
      rule("junos-warn", "Attention states", "\\b(?:warning|backup|standby|probing|degraded|pending)\\b", style("#F6C85F")),
      rule("junos-bad", "Failure states", "\\b(?:down|disabled|failed?|inactive|reject|timeout|unreachable|alarm)\\b", style("#FF6B6B")),
      rule("junos-routing", "Routing protocols", "\\b(?:BGP|OSPFv3?|IS-IS|LDP|MPLS|VRRP)\\b", style("#C792EA")),
    ],
  },
  {
    id: "builtin:operational-logs",
    name: "Operational Logs",
    caseSensitive: false,
    rules: [
      rule("logs-fatal", "Fatal and errors", "\\b(?:FATAL|ERROR|ERR|CRITICAL|PANIC|EXCEPTION|FAILED?)\\b", style("#FF6B6B")),
      rule("logs-warning", "Warnings", "\\b(?:WARN|WARNING|DEPRECATED|RETRY|TIMEOUT)\\b", style("#F6C85F")),
      rule("logs-success", "Success", "\\b(?:OK|PASS(?:ED)?|SUCCESS|HEALTHY|READY|STARTED)\\b", style("#7BD88F")),
      rule("logs-debug", "Debug and trace", "\\b(?:DEBUG|TRACE|VERBOSE)\\b", style("#8796A5")),
      rule("logs-timestamp", "Timestamps", "\\b\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?\\b", style("#8EA1B5")),
      rule("logs-http-bad", "HTTP failures", "\\b(?:4\\d{2}|5\\d{2})\\b", style("#FF8F70")),
      rule("logs-ipv4", "IPv4 addresses", "\\b(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}\\b", style("#5CC8FF")),
    ],
  },
];

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
