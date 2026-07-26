import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { withoutTrailingAssistantStatusEllipsis } from "../src/ai/assistantStatusText.ts";

test("pending assistant statuses keep one animated ellipsis", async () => {
  const cases = new Map([
    ["Searching...", "Searching"],
    ["Searching……", "Searching"],
    ["Searching…", "Searching"],
    ["Searching⋯⋯", "Searching"],
    ["Searching。。。", "Searching"],
    ["Searching ...  ", "Searching"],
    ["Searching.", "Searching."],
    ["Searching?", "Searching?"],
  ]);

  for (const [input, expected] of cases) {
    assert.equal(withoutTrailingAssistantStatusEllipsis(input), expected);
  }

  const localeDirectory = join(process.cwd(), "src", "i18n", "locales");
  const localeFiles = (await readdir(localeDirectory)).filter((file) => file.endsWith(".json"));
  for (const localeFile of localeFiles) {
    const locale = JSON.parse(await readFile(join(localeDirectory, localeFile), "utf8"));
    for (const key of ["preparingResponse", "toolCallUsing"]) {
      const normalized = withoutTrailingAssistantStatusEllipsis(locale.ai[key]);
      assert.doesNotMatch(
        normalized,
        /(?:\.{2,}|…+|⋯+|。{2,})\s*$/u,
        `${localeFile} ai.${key} should not duplicate the animated ellipsis`,
      );
    }
  }
});
