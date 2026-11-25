import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildSettingsSearchResults,
  SETTINGS_SEARCH_KEYS,
  settingsSearchDisplayLabel,
  settingsSearchTextMatchScore,
  type SettingsSearchSection,
} from "../src/modules/settings/settingsSearch";

const sections: readonly SettingsSearchSection[] = [
  {
    id: "general-settings",
    labelKey: "settings.sectionGeneral",
    searchKeys: ["settings.language"],
  },
  {
    id: "terminal-settings",
    labelKey: "settings.sectionTerminal",
    searchKeys: ["settings.fontFamily", "settings.fontSize"],
  },
];

const translations: Record<string, Record<string, string>> = {
  en: {
    "settings.sectionGeneral": "General",
    "settings.language": "Language",
    "settings.sectionTerminal": "Terminal",
    "settings.fontFamily": "Font family",
    "settings.fontFamilyHint": "Choose the typeface.",
    "settings.fontSize": "Font size",
  },
  "zh-TW": {
    "settings.sectionGeneral": "一般",
    "settings.language": "語言",
    "settings.sectionTerminal": "終端機",
    "settings.fontFamily": "字型系列",
    "settings.fontFamilyHint": "選擇顯示字型。",
    "settings.fontSize": "字型大小",
  },
};

function search(query: string) {
  return buildSettingsSearchResults({
    activeLanguage: "zh-TW",
    query,
    sections,
    translate: (key, language) => translations[language]?.[key] ?? key,
  });
}

test("Settings search matches English navigation labels in another UI language", () => {
  assert.deepEqual(search("terminal"), [{
    id: "terminal-settings",
    label: "終端機",
    matches: [],
  }]);
});

test("Settings search shows localized control hits under their owning section", () => {
  assert.deepEqual(search("font"), [{
    id: "terminal-settings",
    label: "終端機",
    matches: [
      { key: "settings.fontFamily", label: "字型系列" },
      { key: "settings.fontSize", label: "字型大小" },
    ],
  }]);
  assert.equal(search("語言")[0]?.id, "general-settings");
});

test("Settings search includes visible hint text in both languages", () => {
  assert.deepEqual(search("typeface")[0]?.matches, [{
    key: "settings.fontFamilyHint",
    label: "選擇顯示字型。",
  }]);
});

test("Settings search is case-insensitive and ignores diacritics", () => {
  const results = buildSettingsSearchResults({
    activeLanguage: "fr",
    query: "PARAMETRES",
    sections: [{
      id: "general-settings",
      labelKey: "settings.sectionGeneral",
      searchKeys: [],
    }],
    translate: (_key, language) => language === "en" ? "General" : "Paramètres",
  });

  assert.equal(results[0]?.label, "Paramètres");
});

test("every indexed Settings search key resolves to a string", () => {
  const locale = JSON.parse(readFileSync(
    new URL("../src/i18n/locales/en.json", import.meta.url),
    "utf8",
  ));
  const indexedKeys = Object.values(SETTINGS_SEARCH_KEYS).flat();

  for (const key of indexedKeys) {
    const value = key.split(".").reduce<unknown>((current, part) =>
      typeof current === "object" && current !== null
        ? (current as Record<string, unknown>)[part]
        : undefined,
    locale);
    assert.equal(typeof value, "string", `${key} must resolve to a string`);
  }
});

test("Settings sidebar shows a conditional clear action and routes result clicks", () => {
  const source = readFileSync(
    new URL("../src/modules/settings/SettingsPage.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /\{searchQuery \? \(\s*<button[\s\S]*?aria-label=\{t\("common\.clear"\)\}/);
  assert.match(source, /function clearSearch\(\)[\s\S]*?setSearchQuery\(""\)/);
  assert.match(source, /onClick=\{\(\) => handleSearchResultClick\(result\.id, match\)\}/);
  assert.match(source, /onActiveSectionChange\(sectionId\)/);
});

test("Settings search target matching handles exact and interpolated localized text", () => {
  assert.equal(settingsSearchTextMatchScore("自動備份", "自動備份"), 3);
  assert.equal(
    settingsSearchTextMatchScore("上次備份：{{value}}", "上次備份：2026/7/17"),
    1,
  );
  assert.equal(settingsSearchTextMatchScore("自動備份", "應用程式更新"), 0);
});

test("Settings search result labels omit interpolation placeholders", () => {
  assert.equal(settingsSearchDisplayLabel("上次備份：{{value}}"), "上次備份");
  assert.equal(settingsSearchDisplayLabel("Last checked {{time}}"), "Last checked");
  assert.equal(settingsSearchDisplayLabel("Version"), "Version");
});

test("Settings result clicks resolve, scroll, and highlight the detail target", () => {
  const pageSource = readFileSync(
    new URL("../src/modules/settings/SettingsPage.tsx", import.meta.url),
    "utf8",
  );
  const styleSource = readFileSync(
    new URL("../src/modules/settings/settings.css", import.meta.url),
    "utf8",
  );

  assert.match(pageSource, /data-settings-section-id=\{sectionId\}/);
  assert.match(pageSource, /findSettingsSearchTextTarget\(panel, pendingSearchTarget\.label\)/);
  assert.match(pageSource, /querySelectorAll<HTMLElement>\(\s*"[^"]*\.shortcut-row-label/);
  assert.match(pageSource, /highlightTarget\.scrollIntoView\(/);
  assert.match(pageSource, /classList\.add\("settings-search-target-highlight"\)/);
  assert.match(styleSource, /\.settings-search-target-highlight\s*\{[^}]*outline:[^}]*var\(--accent\)/s);
});

test("Settings search renders results in the selected UI language, not the fallback", () => {
  const source = readFileSync(
    new URL("../src/modules/settings/SettingsPage.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const activeLanguage = i18n\.language \|\| "en"/);
  assert.doesNotMatch(source, /activeLanguage = i18n\.resolvedLanguage/);
});

test("English backup search finds localized automatic-backup settings", () => {
  const en = JSON.parse(readFileSync(
    new URL("../src/i18n/locales/en.json", import.meta.url),
    "utf8",
  ));
  const zhTw = JSON.parse(readFileSync(
    new URL("../src/i18n/locales/zh-TW.json", import.meta.url),
    "utf8",
  ));
  const localeValue = (locale: Record<string, unknown>, key: string) =>
    key.split(".").reduce<unknown>((current, part) =>
      typeof current === "object" && current !== null
        ? (current as Record<string, unknown>)[part]
        : undefined,
    locale);
  const results = buildSettingsSearchResults({
    activeLanguage: "zh-TW",
    query: "backup",
    sections: [{
      id: "general-settings",
      labelKey: "settings.sectionGeneral",
      searchKeys: SETTINGS_SEARCH_KEYS["general-settings"],
    }],
    translate: (key, language) => String(localeValue(language === "en" ? en : zhTw, key) ?? key),
  });
  const autoBackup = results[0]?.matches.find(({ key }) => key === "settings.autoBackup");

  assert.equal(autoBackup?.label, zhTw.settings.autoBackup);
});
