import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUploadPlan,
  parseChecksumFile,
  verifyChecksum,
  wranglerInvocation,
} from "../scripts/sync-cloudflare-release.mjs";

test("parses GNU and BSD SHA-256 checksum formats", () => {
  const hash = "a".repeat(64);
  assert.deepEqual(parseChecksumFile(`${hash}  app.exe\n`), { hash, filename: "app.exe" });
  assert.deepEqual(parseChecksumFile(`SHA256 (app.dmg) = ${hash}\n`), { hash, filename: "app.dmg" });
  assert.throws(() => parseChecksumFile("not a checksum"), /checksum/i);
});

test("invokes Wrangler through Node without platform command shims", () => {
  const invocation = wranglerInvocation("C:/repo");
  assert.equal(invocation.command, process.execPath);
  assert.match(invocation.args[0].replaceAll("\\", "/"), /\/node_modules\/wrangler\/bin\/wrangler\.js$/);
});

test("rejects bytes that do not match the published checksum", () => {
  const expected = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
  assert.doesNotThrow(() => verifyChecksum(Buffer.from("hello"), expected, "app.exe"));
  assert.throws(() => verifyChecksum(Buffer.from("goodbye"), expected, "app.exe"), /app\.exe.*mismatch/i);
});

test("uploads immutable assets before version and stable manifests", () => {
  const plan = buildUploadPlan({
    tag_name: "v0.1.93",
    assets: [
      { name: "kkterm-0.1.93-windows-x64-setup.exe" },
      { name: "kkterm-0.1.93-windows-x64-setup.exe.sha256" },
      { name: "kkterm-0.1.93-windows-x64-portable.zip" },
      { name: "kkterm-0.1.93-windows-x64-portable.zip.sha256" },
    ],
  });

  assert.deepEqual(plan, [
    {
      name: "kkterm-0.1.93-windows-x64-setup.exe",
      key: "releases/v0.1.93/kkterm-0.1.93-windows-x64-setup.exe",
    },
    {
      name: "kkterm-0.1.93-windows-x64-setup.exe.sha256",
      key: "releases/v0.1.93/kkterm-0.1.93-windows-x64-setup.exe.sha256",
    },
    {
      name: "kkterm-0.1.93-windows-x64-portable.zip",
      key: "releases/v0.1.93/kkterm-0.1.93-windows-x64-portable.zip",
    },
    {
      name: "kkterm-0.1.93-windows-x64-portable.zip.sha256",
      key: "releases/v0.1.93/kkterm-0.1.93-windows-x64-portable.zip.sha256",
    },
    { name: "release-manifest.json", key: "releases/v0.1.93/latest.json" },
    { name: "tauri-release-manifest.json", key: "releases/v0.1.93/latest-tauri.json" },
    { name: "release-manifest.json", key: "releases/latest.json" },
    { name: "tauri-release-manifest.json", key: "releases/latest-tauri.json" },
  ]);
});
