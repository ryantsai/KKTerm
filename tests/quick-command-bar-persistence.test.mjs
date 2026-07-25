import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Quick Command Bar visibility is durable across Tab presentation modes", async () => {
  const [storeSource, durableUiStateSource] = await Promise.all([
    readFile(new URL("../src/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/durableUiState.ts", import.meta.url), "utf8"),
  ]);

  assert.match(
    durableUiStateSource,
    /DURABLE_UI_STATE_PREFIXES = \[[\s\S]*?"kkterm\.quickCommandBar\."/,
    "Quick Command Bar visibility must be included in SQLite-backed durable UI state",
  );
  assert.match(
    storeSource,
    /function loadStoredQuickCommandBarVisible[\s\S]*?readDurableUiState\(`\$\{QUICK_COMMAND_BAR_STORAGE_PREFIX\}\$\{connectionId\}`\) === "true"/,
    "Connection reopen must read Quick Command Bar visibility through the durable cache",
  );
  assert.match(
    storeSource,
    /function persistQuickCommandBarVisible[\s\S]*?writeDurableUiState\([\s\S]*?QUICK_COMMAND_BAR_STORAGE_PREFIX/,
    "the visibility toggle must write through to durable UI state",
  );
  assert.match(
    storeSource,
    /childConnectionGroupParentId: connection\.id,[\s\S]*?quickCommandBarVisible:\s*existingGroupTab\?\.quickCommandBarVisible \?\?\s*loadStoredQuickCommandBarVisible\(connection\.id\)/,
    "Child Connection panorama creation must preserve or restore the same per-Connection visibility",
  );
  assert.doesNotMatch(
    storeSource,
    /childConnectionGroupParentId: connection\.id,[\s\S]{0,700}?quickCommandBarVisible: false/,
    "Child Connection panoramas must not force the bar closed",
  );
});
