import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("store-managed About content replaces repository and license with public support links", async () => {
  const [aboutSource, dataSource, manualSource] = await Promise.all([
    readFile(new URL("../src/modules/settings/AboutSettings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/settings/aboutData.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/manual/15-settings.md", import.meta.url), "utf8"),
  ]);

  assert.match(aboutSource, /storeManaged = appModeInfo\.updatesManagedByPlatformStore/);
  assert.match(aboutSource, /storeManaged \? null : \(/);
  assert.match(aboutSource, /storeManaged \? \([\s\S]*?storeLinks\.map/);
  assert.match(aboutSource, /\) : \([\s\S]*?settings\.license[\s\S]*?settings\.repository/);
  assert.match(dataSource, /homepageUrl: "https:\/\/kkterm\.ryantsai\.com\/"/);
  assert.match(dataSource, /privacyUrl: "https:\/\/kkterm\.ryantsai\.com\/privacy"/);
  assert.match(dataSource, /legalNoticesUrl: "https:\/\/kkterm\.ryantsai\.com\/legal"/);
  assert.match(dataSource, /supportEmail: "publish@ryantsai\.com"/);
  assert.match(manualSource, /Microsoft Store and Mac App Store builds omit those two items/);
});
