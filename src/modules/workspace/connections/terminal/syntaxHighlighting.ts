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

const IPV4_PATTERN = "\\b(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}(?:/\\d{1,2}|:\\d{1,5})?\\b";
const IPV6_PATTERN = "(?<![0-9A-Fa-f:])(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,5}(?::[0-9A-Fa-f]{1,4}){1,2}|(?:[0-9A-Fa-f]{1,4}:){1,4}(?::[0-9A-Fa-f]{1,4}){1,3}|(?:[0-9A-Fa-f]{1,4}:){1,3}(?::[0-9A-Fa-f]{1,4}){1,4}|(?:[0-9A-Fa-f]{1,4}:){1,2}(?::[0-9A-Fa-f]{1,4}){1,5}|[0-9A-Fa-f]{1,4}:(?:(?::[0-9A-Fa-f]{1,4}){1,6})|:(?:(?::[0-9A-Fa-f]{1,4}){1,7}|:))(?:/\\d{1,3})?(?![0-9A-Fa-f:])";
const MAC_PATTERN = "\\b(?:[0-9A-Fa-f]{4}[.-]){2}[0-9A-Fa-f]{4}\\b|\\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\\b";

/**
 * Maintained-in-repo defaults. The expressions are JavaScript-compatible
 * originals informed by vendor CLI references and community SecureCRT lists;
 * they are not vendored copies of another terminal's engine-specific rules.
 */
export const BUILTIN_SYNTAX_HIGHLIGHT_PROFILES: readonly TerminalSyntaxHighlightProfile[] = [
  {
    id: "builtin:cisco-ios",
    name: "Cisco IOS",
    caseSensitive: false,
    rules: [
      rule("cisco-prompt", "CLI prompt", "(?:^|\\s)[A-Za-z0-9._-]+(?:\\([^)]*\\))?[>#](?=\\s|$)", style("#F6C85F")),
      rule("cisco-negative-connectivity", "Negative connectivity", "\\b(?:no(?:t)?(?:connect(?:ed)?)?|shut(?:down)?|down)\\b", style("#FF6B6B")),
      rule("cisco-failures", "Failures and denials", "\\b(?:disabled?|disconnected?|disallowed?|discarded?|errors?|fail(?:ure|ed)?|citywwm|den(?:y|ied))\\b", style("#FF6B6B")),
      rule("cisco-critical", "Critical states", "\\b(?:red|administratively|undo|unknown|fault|blocked?|refused|problems?|warnings?|alerts?|critical|delete|inactive|unassigned)\\b", style("#FF6B6B")),
      rule("cisco-percent-high", "Utilization 70–100%", "(?<!\\d)(?:7\\d|8\\d|9\\d|100)(?:\\.\\d{1,2})?%(?!\\d)", style("#FF6B6B")),
      rule("cisco-positive", "Positive states", "\\b(?:green|up|forward|full|active)\\b", style("#7BD88F")),
      rule("cisco-connectivity", "Connectivity states", "\\b(?:connect(?:ed)?|permit(?:ted)?|establish(?:ed)?|enable(?:d)?|allow(?:ed)?)\\b", style("#7BD88F")),
      rule("cisco-percent-low", "Utilization 0–39%", "(?<!\\d)(?:[0-9]|[12]\\d|3\\d)(?:\\.\\d{1,2})?%(?!\\d)", style("#7BD88F")),
      rule("cisco-routing", "Routing protocols", "\\b(?:BGP|OSPF(?:v3)?|RIPng|RIP|EIGRP|static|ODR|UNR|IS-?IS|PIM|direct)(?:-\\d+)?\\b", style("#5CC8FF")),
      rule("cisco-network-services", "Network services", "\\b(?:cyan|IPv6|TCP|UDP|ICMP|IGMP|GRE|ESP|AH|ISAKMP|ARP|ARPA|DHCP|HTTPS?|DNS|TFTP|FTP|Telnet|SSH|WWW|NTP|RADIUS|TACACS|POP\\d|SMTP|PPP|Frame-?Relay|FR|HDLC)\\b", style("#5CC8FF")),
      rule("cisco-layer2", "Layer 2 and redundancy", "\\b(?:standby|VRRP|GLBP|MSTP?|RSTP|STP|spanning-tree|dot1q|802\\.1q)\\b", style("#5CC8FF")),
      rule("cisco-control-services", "Control and services", "\\b(?:LDP|TDP|MPLS|AAA|account(?:ing)?|authentication|authorization|NAT|BFD|NQA|SLA|RTR|VRF|VPN(?:-instance)?)\\b", style("#5CC8FF")),
      rule("cisco-direction", "Interface direction", "\\b(?:(?:passive-|silent-)?interface|in(?:bound|put)?|out(?:bound|put)?)\\b", style("#C792EA")),
      rule("cisco-policy-core", "Routing and policy", "\\b(?:magenta|router|redistribute|import-route|import|export|network|neighbor|peer|area|ACL|classifier|class-map|behavior|policy-map|policy)\\b", style("#C792EA")),
      rule("cisco-policy-objects", "Policy objects", "\\b(?:access-(?:list|class|group)|ip-prefix|prefix-list|route(?:-[\\w.-]+)?|traffic[\\w.-]*)\\b", style("#C792EA")),
      rule("cisco-percent-mid", "Utilization 40–69%", "(?<!\\d)(?:4\\d|5\\d|6\\d)(?:\\.\\d{1,2})?%(?!\\d)", style("#C792EA")),
      rule("cisco-ethernet-interfaces", "Ethernet interfaces", "\\b(?:Fast|Gigabit)?Ethernet\\d+(?:/\\d{1,3}){0,4}(?:\\.\\d{1,4})?\\b", style("#F6C85F")),
      rule("cisco-ipv4", "IPv4 and CIDR", IPV4_PATTERN, style("#F6C85F")),
      rule("cisco-ipv6", "IPv6 and prefixes", IPV6_PATTERN, style("#F6C85F")),
      rule("cisco-mac", "MAC addresses", MAC_PATTERN, style("#F6C85F")),
      rule("cisco-clns", "CLNS and NSAP identifiers", "\\b\\d{1,2}(?:\\.[0-9A-Fa-f]{2,4}){1,11}\\.?\\d{1,2}\\b", style("#F6C85F")),
      rule("cisco-interfaces", "Interfaces", "\\b(?:orange|GE|FA|FE|Eth(?:-?trunk)?|Null|Loopback|Tunnel|Dialer|BRI|Serial|ATM|POS|Vlan(?:if)?)(?:\\d+(?:/\\d{1,3}){0,4}(?:\\.\\d{1,10})?)?\\b", style("#F6C85F")),
      rule("cisco-bundles", "Virtual and bundled interfaces", "\\b(?:Virtual-(?:Template|PPP|Access)|channel-group|Port-channel|Ether-?Channel)(?:\\d+(?:/\\d{1,3}){0,4})?\\b", style("#F6C85F")),
    ],
  },
  {
    id: "builtin:juniper-junos",
    name: "Juniper Junos",
    caseSensitive: false,
    rules: [
      rule("junos-prompt", "CLI prompt", "(?:^|\\s)[A-Za-z0-9._-]+@[A-Za-z0-9._-]+(?:\\[[^\\]]+\\])?[>%#](?=\\s|$)", style("#F6C85F")),
      rule("junos-failure", "Failure states", "\\b(?:down|disabled?|failed?|inactive|reject(?:ed)?|discard(?:ed)?|timeout|unreachable|fault|error|loss|not present|offline)\\b", style("#FF6B6B")),
      rule("junos-alarm", "Alarms", "\\b(?:major|minor|critical|red alarm|yellow alarm|alarm|chassis alarm|rescue configuration is not set)\\b", style("#FF6B6B")),
      rule("junos-healthy", "Healthy states", "\\b(?:up|established|master|primary|enabled|active|complete|success|online|ready|accept|permit|full)\\b", style("#7BD88F")),
      rule("junos-attention", "Attention states", "\\b(?:warning|backup|secondary|standby|probing|degraded|pending|init|starting|hold|unknown)\\b", style("#F6C85F")),
      rule("junos-interface", "Interfaces", "\\b(?:ae|as|at|bme|cbp|demux|dsc|em|esi|et|fe|fxp|ge|gr|gre|ip|irb|jsrv|lc|lo|lsi|lt|me|mt|pfe|pfh|pimd|pip|pp|reth|sp|st|tap|vcp|vlan|vme|vtep|xe)-?\\d+(?:/\\d{1,3}){0,2}(?:\\.\\d{1,10})?\\b", style("#5CC8FF")),
      rule("junos-ipv4", "IPv4 and CIDR", IPV4_PATTERN, style("#F6C85F")),
      rule("junos-ipv6", "IPv6 and prefixes", IPV6_PATTERN, style("#F6C85F")),
      rule("junos-mac", "MAC addresses", MAC_PATTERN, style("#F6C85F")),
      rule("junos-routing", "Routing protocols", "\\b(?:BGP|OSPF(?:v3)?|IS-IS|ISIS|LDP|MPLS|RSVP|BFD|EVPN|VRRP|PIM|RIP|static|direct|local|aggregate|generated)\\b", style("#C792EA")),
      rule("junos-policy", "Policy and firewall", "\\b(?:policy-statement|prefix-list|route-filter|firewall|term|from|then|next-hop|community|as-path|forwarding-class|loss-priority|code-points|classifier|scheduler-map)\\b", style("#C792EA")),
      rule("junos-hierarchy", "Configuration hierarchy", "\\b(?:interfaces|protocols|routing-options|policy-options|security|services|system|chassis|class-of-service|forwarding-options|snmp|groups|traceoptions)\\b", style("#A8E6CF")),
      rule("junos-family", "Address families", "\\b(?:family|inet6?|ethernet-switching|bridge|EVPN|CCC|MPLS|ISO)\\b", style("#5CC8FF")),
      rule("junos-actions", "Configuration actions", "\\b(?:set|delete|deactivate|activate|commit|confirmed|rollback|load|save|compare|edit|top|exit|quit)\\b", style("#F6C85F")),
    ],
  },
  {
    id: "builtin:fortigate",
    name: "FortiGate",
    caseSensitive: false,
    rules: [
      rule("fortigate-prompt", "CLI prompt", "(?:^|\\s)[A-Za-z0-9._-]+(?:\\s+\\([^)]+\\))?\\s*[#$](?=\\s|$)", style("#F6C85F")),
      rule("fortigate-failure", "Failure states", "\\b(?:down|dead|disconnected|disabled?|errors?|failed?|invalid|denied|blocked|dropped|timeout|unreachable|out-of-sync|inactive|expired|critical|fault|revoked|not installed)\\b", style("#FF6B6B")),
      rule("fortigate-healthy", "Healthy states", "\\b(?:up|alive|active|established|connected|enabled|success|running|reachable|synchronized|in-sync|installed|valid|primary|master|accept|allow)\\b", style("#7BD88F")),
      rule("fortigate-attention", "Attention states", "\\b(?:warning|standby|secondary|pending|negotiating|degraded|conserve|unknown|flapping|idle)\\b", style("#F6C85F")),
      rule("fortigate-ipv4", "IPv4 and CIDR", IPV4_PATTERN, style("#F6C85F")),
      rule("fortigate-ipv6", "IPv6 and prefixes", IPV6_PATTERN, style("#F6C85F")),
      rule("fortigate-mac", "MAC addresses", MAC_PATTERN, style("#F6C85F")),
      rule("fortigate-interface", "Interfaces", "\\b(?:port\\d+|wan\\d*|lan\\d*|dmz|internal|mgmt\\d*|ha\\d*|fortilink|ssl\\.root|virtual-wan-link|modem|wwan|vlan\\d*|aggregate\\d*)\\b", style("#5CC8FF")),
      rule("fortigate-routing", "Routing protocols", "\\b(?:BGP|OSPF(?:v3)?|RIPng|RIP|IS-IS|BFD|static|connected|kernel|blackhole|route-map|prefix-list|routing-table)\\b", style("#C792EA")),
      rule("fortigate-vpn", "VPN and IPsec", "\\b(?:VPN|IPsec|IKEv2?|phase1|phase2|SSL-VPN|ADVPN|dialup|tunnel|selector|security association|quick mode|encapsulation|decapsulation)\\b", style("#5CC8FF")),
      rule("fortigate-ha-sdwan", "HA and SD-WAN", "\\b(?:HA|FGCP|cluster|primary|secondary|master|slave|member|SD-WAN|SLA|health-check|link-monitor|virtual-wan-link|failover|heartbeat)\\b", style("#A8E6CF")),
      rule("fortigate-security", "Firewall and security", "\\b(?:firewall|policy|policy6|address6?|addrgrp6?|service|service group|VIP|IP pool|NAT|SNAT|DNAT|UTM|IPS|antivirus|webfilter|dnsfilter|application control|SSL inspection|DoS|FortiGuard)\\b", style("#C792EA")),
      rule("fortigate-auth", "Authentication", "\\b(?:LDAP|RADIUS|TACACS\\+?|FSSO|SAML|FortiToken|two-factor|authentication|authorization|admin|user group)\\b", style("#C792EA")),
      rule("fortigate-resources", "System resources", "\\b(?:CPU|memory|sessions?|uptime|load average|conserve mode|NPU|offload|NP6|NP7|CP8|CP9|FortiASIC)\\b", style("#A8E6CF")),
      rule("fortigate-actions", "CLI actions", "\\b(?:config|edit|set|unset|append|select|unselect|next|end|show|full-configuration|get|diagnose|execute|tree)\\b", style("#F6C85F")),
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
