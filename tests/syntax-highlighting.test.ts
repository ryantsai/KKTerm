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

test("renderer gives configured keyword colors unconditional precedence", () => {
  const renderer = readFileSync(
    new URL("../src/modules/workspace/connections/terminal/renderer.ts", import.meta.url),
    "utf8",
  );
  assert.match(renderer, /const foreground = compiled\.style\.foreground \?\? undefined;/);
  assert.match(renderer, /const background = compiled\.style\.background \?\? undefined;/);
  assert.doesNotMatch(renderer, /isFgDefault\(\)|isBgDefault\(\)/);
});

test("built-in keyword profiles are valid and define overriding colors", () => {
  assert.deepEqual(
    BUILTIN_SYNTAX_HIGHLIGHT_PROFILES.map((profile) => profile.name),
    ["Cisco IOS", "Juniper Junos", "Operational Logs"],
  );
  for (const profile of BUILTIN_SYNTAX_HIGHLIGHT_PROFILES) {
    assert.equal(validateSyntaxHighlightProfile(profile), null);
    assert.ok(
      profile.rules.every((rule) => rule.style.foreground || rule.style.background),
      `${profile.name} rules must define a foreground or background override`,
    );
  }
});

test("SecureCRT V2 imports BGR colors, case handling, and enabled rules", () => {
  const profile = parseSecureCrtKeywordIni(`
D:"Match Case"=00000001
Z:"Keyword List V2"=00000003
 "error",000000ff,00000001
 "disabled",00ff0000,00000000
 "[*]Section",00808080,00000001
S:"List Name"=Router Checks
`);

  assert.equal(profile.name, "Router Checks");
  assert.equal(profile.caseSensitive, true);
  assert.equal(profile.rules.length, 2);
  assert.equal(profile.rules[0].style.foreground, "#FF0000");
  assert.equal(profile.rules[1].style.foreground, "#0000FF");
  assert.equal(profile.rules[1].enabled, false);
});

test("SecureCRT V3 maps bold and reverse-video attributes", () => {
  const profile = parseSecureCrtKeywordIni(`
D:"Match Case"=00000000
Z:"Keyword List V3"=00000002
 "ERROR",000000ff,00000005,00000005
 "CONFIRM",0000ffff,00000015,0000001f
`);

  assert.equal(profile.rules[0].style.bold, true);
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
  copied.rules[0].style.bold = false;
  assert.equal(source.rules[0].style.bold, true);
});

test("AI profiles are normalized and invalid regexes are rejected", () => {
  const profile = parseAiSyntaxHighlightProfile(`\`\`\`json
{"name":"Docker","rules":[{"name":"Error","pattern":"\\\\bERROR\\\\b","style":{"foreground":"#ff0000","bold":true}}]}
\`\`\``);
  assert.equal(profile.name, "Docker");
  assert.equal(profile.rules[0].style.foreground, "#FF0000");
  assert.throws(() =>
    parseAiSyntaxHighlightProfile(
      '{"name":"Broken","rules":[{"name":"Bad","pattern":"(","style":{}}]}',
    ),
  );
});
