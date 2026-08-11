import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BUILTIN_SYNTAX_HIGHLIGHT_PROFILES,
  copySyntaxHighlightProfile,
  parseAiSyntaxHighlightProfile,
  parseSecureCrtKeywordIni,
  validateSyntaxHighlightProfile,
} from "../src/modules/workspace/connections/terminal/syntaxHighlighting.ts";

function builtInProfile(id: string) {
  const profile = BUILTIN_SYNTAX_HIGHLIGHT_PROFILES.find((candidate) => candidate.id === id);
  assert.ok(profile, `missing built-in profile ${id}`);
  return profile;
}

function assertRuleMatch(profileId: string, ruleId: string, sample: string) {
  const profile = builtInProfile(profileId);
  const rule = profile.rules.find((candidate) => candidate.id === ruleId);
  assert.ok(rule, `missing rule ${ruleId}`);
  assert.match(sample, new RegExp(rule.pattern, "i"), `${ruleId} should match ${sample}`);
}

test("renderer gives configured keyword colors unconditional precedence", () => {
  const renderer = readFileSync(
    new URL("../src/modules/workspace/connections/terminal/renderer.ts", import.meta.url),
    "utf8",
  );
  assert.match(renderer, /const foreground = compiled\.style\.foreground \?\? undefined;/);
  assert.match(renderer, /const background = compiled\.style\.background \?\? undefined;/);
  assert.doesNotMatch(renderer, /isFgDefault\(\)|isBgDefault\(\)/);
});

test("renderer never paints duplicate glyph text for keyword matches", () => {
  const renderer = readFileSync(
    new URL("../src/modules/workspace/connections/terminal/renderer.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(renderer, /decoration\.onRender\(/);
  assert.doesNotMatch(renderer, /element\.textContent\s*=\s*matchedText/);
});

test("built-in keyword profiles are valid and define overriding colors", () => {
  assert.deepEqual(
    BUILTIN_SYNTAX_HIGHLIGHT_PROFILES.map((profile) => profile.name),
    ["Cisco IOS", "Juniper Junos", "FortiGate", "Operational Logs"],
  );
  for (const profile of BUILTIN_SYNTAX_HIGHLIGHT_PROFILES) {
    assert.equal(validateSyntaxHighlightProfile(profile), null);
    assert.equal(new Set(profile.rules.map((rule) => rule.id)).size, profile.rules.length);
    assert.ok(
      profile.rules.every((rule) => rule.style.foreground || rule.style.background),
      `${profile.name} rules must define a foreground or background override`,
    );
    assert.ok(
      profile.rules.every((rule) =>
        rule.pattern.length <= 2_000 && !/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/.test(rule.pattern)
      ),
      `${profile.name} rules must pass the renderer's repeated-regex guard`,
    );
  }
});

test("Cisco IOS covers every supplied SecureCRT category with safe JavaScript regexes", () => {
  const profileId = "builtin:cisco-ios";
  assert.equal(builtInProfile(profileId).rules.length, 23);
  const samples: Record<string, string> = {
    "cisco-prompt": "edge-ios-01#",
    "cisco-negative-connectivity": "shutdown",
    "cisco-failures": "disconnected",
    "cisco-critical": "administratively",
    "cisco-percent-high": "87.5%",
    "cisco-positive": "forward",
    "cisco-connectivity": "permit",
    "cisco-percent-low": "19.2%",
    "cisco-routing": "OSPF",
    "cisco-network-services": "ISAKMP",
    "cisco-layer2": "spanning-tree",
    "cisco-control-services": "VPN",
    "cisco-direction": "silent-interface",
    "cisco-policy-core": "class-map",
    "cisco-policy-objects": "prefix-list",
    "cisco-percent-mid": "55.5%",
    "cisco-ethernet-interfaces": "GigabitEthernet1/0/1.120",
    "cisco-ipv4": "10.10.1.1/24",
    "cisco-ipv6": "2001:db8::1/64",
    "cisco-mac": "0011.2233.4455",
    "cisco-clns": "49.0001.1921.6800.1001.00",
    "cisco-interfaces": "Loopback0",
    "cisco-bundles": "Ether-channel12",
  };
  for (const [ruleId, sample] of Object.entries(samples)) {
    assertRuleMatch(profileId, ruleId, sample);
  }
});

test("Junos built-in covers operational, policy, addressing, and configuration output", () => {
  const profileId = "builtin:juniper-junos";
  const samples: Record<string, string> = {
    "junos-prompt": "netops@edge-mx01>",
    "junos-failure": "offline",
    "junos-alarm": "Major alarm",
    "junos-healthy": "established",
    "junos-attention": "probing",
    "junos-interface": "vtep-0/0/1.200",
    "junos-ipv4": "192.0.2.1/31",
    "junos-ipv6": "2001:db8:10::1/64",
    "junos-mac": "00:11:22:33:44:55",
    "junos-routing": "OSPF",
    "junos-policy": "policy-statement",
    "junos-hierarchy": "routing-options",
    "junos-family": "ethernet-switching",
    "junos-actions": "rollback",
  };
  for (const [ruleId, sample] of Object.entries(samples)) {
    assertRuleMatch(profileId, ruleId, sample);
  }
});

test("FortiGate built-in covers CLI, health, routing, VPN, HA, and security output", () => {
  const profileId = "builtin:fortigate";
  const samples: Record<string, string> = {
    "fortigate-prompt": "FGT-EDGE (root) #",
    "fortigate-failure": "out-of-sync",
    "fortigate-healthy": "synchronized",
    "fortigate-attention": "conserve",
    "fortigate-ipv4": "203.0.113.1/24",
    "fortigate-ipv6": "2001:db8:20::1/64",
    "fortigate-mac": "00:09:0f:aa:bb:cc",
    "fortigate-interface": "ssl.root",
    "fortigate-routing": "OSPF",
    "fortigate-vpn": "phase2",
    "fortigate-ha-sdwan": "SD-WAN",
    "fortigate-security": "FortiGuard",
    "fortigate-auth": "FortiToken",
    "fortigate-resources": "offload",
    "fortigate-actions": "diagnose",
  };
  for (const [ruleId, sample] of Object.entries(samples)) {
    assertRuleMatch(profileId, ruleId, sample);
  }
});

test("SecureCRT V2 imports BGR colors and enabled rules with insensitive matching", () => {
  const profile = parseSecureCrtKeywordIni(`
D:"Match Case"=00000001
Z:"Keyword List V2"=00000003
 "error",000000ff,00000001
 "disabled",00ff0000,00000000
 "[*]Section",00808080,00000001
S:"List Name"=Router Checks
`);

  assert.equal(profile.name, "Router Checks");
  assert.equal(profile.caseSensitive, false);
  assert.equal(profile.rules.length, 2);
  assert.equal(profile.rules[0].style.foreground, "#FF0000");
  assert.equal(profile.rules[1].style.foreground, "#0000FF");
  assert.equal(profile.rules[1].enabled, false);
});

test("SecureCRT V3 maps reverse-video colors without changing terminal typography", () => {
  const profile = parseSecureCrtKeywordIni(`
D:"Match Case"=00000000
Z:"Keyword List V3"=00000002
 "ERROR",000000ff,00000005,00000005
 "CONFIRM",0000ffff,00000015,0000001f
`);

  assert.equal(profile.rules[0].style.bold, false);
  assert.equal(profile.rules[0].style.foreground, "#FF0000");
  assert.equal(profile.rules[1].style.foreground, null);
  assert.equal(profile.rules[1].style.background, "#FFFF00");
});

test("copying a built-in produces independent user ids", () => {
  const source = BUILTIN_SYNTAX_HIGHLIGHT_PROFILES[0];
  const copied = copySyntaxHighlightProfile(source);
  assert.notEqual(copied.id, source.id);
  assert.ok(!copied.id.startsWith("builtin:"));
  assert.notEqual(copied.rules[0].id, source.rules[0].id);
  copied.rules[0].style.foreground = "#000000";
  assert.equal(source.rules[0].style.foreground, "#F6C85F");
});

test("AI profiles are normalized and invalid regexes are rejected", () => {
  const profile = parseAiSyntaxHighlightProfile(`\`\`\`json
{"name":"Docker","caseSensitive":true,"rules":[{"name":"Error","pattern":"\\\\bERROR\\\\b","style":{"foreground":"#ff0000","bold":true}}]}
\`\`\``);
  assert.equal(profile.name, "Docker");
  assert.equal(profile.caseSensitive, false);
  assert.equal(profile.rules[0].style.foreground, "#FF0000");
  assert.equal(profile.rules[0].style.bold, false);
  assert.throws(() =>
    parseAiSyntaxHighlightProfile(
      '{"name":"Broken","rules":[{"name":"Bad","pattern":"(","style":{}}]}',
    ),
  );
});

test("renderer compiles every keyword rule case-insensitively", () => {
  const renderer = readFileSync(
    new URL("../src/modules/workspace/connections/terminal/renderer.ts", import.meta.url),
    "utf8",
  );
  assert.match(renderer, /const flags = "gi";/);
  assert.doesNotMatch(renderer, /profile\.caseSensitive/);
});
