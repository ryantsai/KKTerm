import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReleaseManifest,
  buildTauriReleaseManifest,
  missingRequiredPlatforms,
  recognizedReleaseAssets,
  versionFromTag,
} from "../scripts/release-mirror-model.mjs";

const release = {
  tag_name: "v0.1.93",
  name: "KKTerm v0.1.93",
  body: "Release notes",
  html_url: "https://github.com/ryantsai/KKTerm/releases/tag/v0.1.93",
  published_at: "2026-06-19T00:00:00Z",
  draft: false,
  prerelease: false,
  assets: [
    { name: "kkterm-0.1.93-windows-x64-setup.exe" },
    { name: "kkterm-0.1.93-windows-x64-setup.exe.sha256" },
    { name: "kkterm-0.1.93-windows-x64-portable.zip" },
    { name: "kkterm-0.1.93-windows-x64-portable.zip.sha256" },
    { name: "notes.txt" },
  ],
};

test("recognizes only version-matching KKTerm release assets", () => {
  assert.deepEqual(
    recognizedReleaseAssets({
      ...release,
      assets: [
        ...release.assets,
        { name: "kkterm-0.1.92-windows-arm64-setup.exe" },
        { name: "kkterm-0.1.93-macos-universal.dmg" },
        { name: "kkterm-0.1.93-macos-universal.dmg.sha256" },
        { name: "kkterm-0.1.93-macos-universal.app.tar.gz" },
        { name: "kkterm-0.1.93-macos-universal.app.tar.gz.sig" },
        { name: "kkterm-0.1.93-linux-x86_64.AppImage" },
        { name: "kkterm-0.1.93-linux-x86_64.AppImage.sha256" },
        { name: "kkterm-0.1.93-linux-x86_64.AppImage.sig" },
      ],
    }).map((asset) => asset.name),
    [
      "kkterm-0.1.93-windows-x64-setup.exe",
      "kkterm-0.1.93-windows-x64-setup.exe.sha256",
      "kkterm-0.1.93-windows-x64-portable.zip",
      "kkterm-0.1.93-windows-x64-portable.zip.sha256",
      "kkterm-0.1.93-macos-universal.dmg",
      "kkterm-0.1.93-macos-universal.dmg.sha256",
      "kkterm-0.1.93-macos-universal.app.tar.gz",
      "kkterm-0.1.93-macos-universal.app.tar.gz.sig",
      "kkterm-0.1.93-linux-x86_64.AppImage",
      "kkterm-0.1.93-linux-x86_64.AppImage.sha256",
      "kkterm-0.1.93-linux-x86_64.AppImage.sig",
    ],
  );
});

test("builds a Windows-only manifest without incomplete staggered platforms", () => {
  assert.deepEqual(buildReleaseManifest(release, "https://kkterm.ryantsai.com"), {
    version: "0.1.93",
    notes: "Release notes",
    pub_date: "2026-06-19T00:00:00Z",
    release_url: "https://github.com/ryantsai/KKTerm/releases/tag/v0.1.93",
    platforms: {
      "windows-x64": {
        url: "https://kkterm.ryantsai.com/releases/v0.1.93/kkterm-0.1.93-windows-x64-setup.exe",
        checksum_url:
          "https://kkterm.ryantsai.com/releases/v0.1.93/kkterm-0.1.93-windows-x64-setup.exe.sha256",
        signature: "",
      },
      "windows-x64-portable": {
        url: "https://kkterm.ryantsai.com/releases/v0.1.93/kkterm-0.1.93-windows-x64-portable.zip",
        checksum_url:
          "https://kkterm.ryantsai.com/releases/v0.1.93/kkterm-0.1.93-windows-x64-portable.zip.sha256",
        signature: "",
      },
    },
  });
});

test("keeps the combined manifest parseable by legacy Tauri updater builds", () => {
  const manifest = buildReleaseManifest(release, "https://kkterm.ryantsai.com");
  for (const platform of Object.values(manifest.platforms)) {
    assert.equal(typeof platform.signature, "string");
  }
});

test("adds signed staggered macOS and Linux updater entries", () => {
  const manifest = buildReleaseManifest(
    {
      ...release,
      assets: [
        ...release.assets,
        { name: "kkterm-0.1.93-macos-universal.app.tar.gz" },
        { name: "kkterm-0.1.93-macos-universal.app.tar.gz.sig" },
        { name: "kkterm-0.1.93-linux-x86_64.AppImage" },
        { name: "kkterm-0.1.93-linux-x86_64.AppImage.sig" },
      ],
    },
    "https://kkterm.ryantsai.com/",
  );

  assert.equal(manifest.platforms["darwin-aarch64"].signature_asset, "kkterm-0.1.93-macos-universal.app.tar.gz.sig");
  assert.equal(manifest.platforms["darwin-x86_64"].signature_asset, "kkterm-0.1.93-macos-universal.app.tar.gz.sig");
  assert.equal(
    manifest.platforms["darwin-x86_64"].url,
    "https://kkterm.ryantsai.com/releases/v0.1.93/kkterm-0.1.93-macos-universal.app.tar.gz",
  );
  assert.equal(manifest.platforms["linux-x86_64"].signature_asset, "kkterm-0.1.93-linux-x86_64.AppImage.sig");
});

test("flags a Windows-only manifest as missing macOS and Linux platforms", () => {
  const manifest = buildReleaseManifest(release, "https://kkterm.ryantsai.com");
  assert.deepEqual(missingRequiredPlatforms(manifest), [
    "windows-arm64",
    "windows-arm64-portable",
    "darwin-aarch64",
    "darwin-x86_64",
    "linux-x86_64",
  ]);
});

test("reports no missing platforms once macOS and Linux stagger in", () => {
  const manifest = buildReleaseManifest(
    {
      ...release,
      assets: [
        ...release.assets,
        { name: "kkterm-0.1.93-windows-arm64-setup.exe" },
        { name: "kkterm-0.1.93-windows-arm64-setup.exe.sha256" },
        { name: "kkterm-0.1.93-windows-arm64-portable.zip" },
        { name: "kkterm-0.1.93-windows-arm64-portable.zip.sha256" },
        { name: "kkterm-0.1.93-macos-universal.app.tar.gz" },
        { name: "kkterm-0.1.93-macos-universal.app.tar.gz.sig" },
        { name: "kkterm-0.1.93-linux-x86_64.AppImage" },
        { name: "kkterm-0.1.93-linux-x86_64.AppImage.sig" },
      ],
    },
    "https://kkterm.ryantsai.com",
  );
  assert.deepEqual(missingRequiredPlatforms(manifest), []);
});

test("builds a Tauri manifest containing only signed macOS and Linux platforms", () => {
  const manifest = {
    version: "0.1.93",
    notes: "Release notes",
    pub_date: "2026-06-19T00:00:00Z",
    release_url: "https://github.com/ryantsai/KKTerm/releases/tag/v0.1.93",
    platforms: {
      "windows-x64": { url: "https://example.com/app.exe", checksum_url: "https://example.com/app.exe.sha256" },
      "darwin-aarch64": { url: "https://example.com/app.tar.gz", signature: "mac-signature" },
      "darwin-x86_64": { url: "https://example.com/app.tar.gz", signature: "mac-signature" },
      "linux-x86_64": { url: "https://example.com/app.AppImage", signature: "linux-signature" },
    },
  };

  assert.deepEqual(buildTauriReleaseManifest(manifest), {
    version: "0.1.93",
    notes: "Release notes",
    pub_date: "2026-06-19T00:00:00Z",
    platforms: {
      "darwin-aarch64": { url: "https://example.com/app.tar.gz", signature: "mac-signature" },
      "darwin-x86_64": { url: "https://example.com/app.tar.gz", signature: "mac-signature" },
      "linux-x86_64": { url: "https://example.com/app.AppImage", signature: "linux-signature" },
    },
  });
  assert.throws(
    () => buildTauriReleaseManifest({ ...manifest, platforms: { ...manifest.platforms, "linux-x86_64": { url: "https://example.com/app.AppImage" } } }),
    /signature.*linux-x86_64/i,
  );
});

test("rejects draft, prerelease, and malformed release tags", () => {
  assert.throws(() => buildReleaseManifest({ ...release, draft: true }, "https://kkterm.ryantsai.com"), /draft/i);
  assert.throws(() => buildReleaseManifest({ ...release, prerelease: true }, "https://kkterm.ryantsai.com"), /prerelease/i);
  assert.throws(() => versionFromTag("latest"), /tag/i);
});
