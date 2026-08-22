const VERSION_TAG = /^v(\d+\.\d+\.\d+)$/;

// Windows, macOS, and Linux assets are built and attached to the same GitHub
// Release by separate, staggered jobs/scripts. A manifest missing any of
// these must never replace the public "current" manifest, or updater clients
// on the platforms that haven't landed yet will find a version bump with no
// matching platform entry and hard-fail instead of just not updating yet.
export const REQUIRED_PLATFORMS = [
  "windows-x64",
  "windows-arm64",
  "windows-x64-portable",
  "windows-arm64-portable",
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-x86_64",
];

export const TAURI_UPDATER_PLATFORMS = [
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-x86_64",
];

export function missingRequiredPlatforms(manifest) {
  return REQUIRED_PLATFORMS.filter((platform) => !manifest.platforms[platform]);
}

export function versionFromTag(tag) {
  const match = VERSION_TAG.exec(tag ?? "");
  if (!match) throw new Error(`Invalid release tag: ${tag ?? ""}`);
  return match[1];
}

export function recognizedReleaseAssets(release) {
  const version = versionFromTag(release.tag_name);
  const escaped = version.replaceAll(".", "\\.");
  const pattern = new RegExp(
    `^kkterm-${escaped}-(?:windows-(?:x64|arm64)-(?:setup\\.exe|portable\\.zip)(?:\\.sha256)?|macos-universal\\.(?:dmg(?:\\.sha256)?|app\\.tar\\.gz(?:\\.sig)?)|linux-x86_64\\.AppImage(?:\\.(?:sha256|sig))?)$`,
  );
  return (release.assets ?? []).filter((asset) => pattern.test(asset.name ?? ""));
}

function completePair(names, asset, companion) {
  return names.has(asset) && names.has(companion);
}

export function buildReleaseManifest(release, baseUrl) {
  if (release.draft) throw new Error("Draft releases cannot update the stable manifest");
  if (release.prerelease) throw new Error("Prerelease releases cannot update the stable manifest");
  const version = versionFromTag(release.tag_name);
  const assets = recognizedReleaseAssets(release);
  const names = new Set(assets.map((asset) => asset.name));
  const root = baseUrl.replace(/\/$/, "");
  const assetUrl = (name) => `${root}/releases/v${version}/${name}`;
  const platforms = {};

  for (const arch of ["x64", "arm64"]) {
    const installer = `kkterm-${version}-windows-${arch}-setup.exe`;
    const checksum = `${installer}.sha256`;
    if (completePair(names, installer, checksum)) {
      platforms[`windows-${arch}`] = {
        url: assetUrl(installer),
        checksum_url: assetUrl(checksum),
        // Legacy macOS/Linux builds read this combined manifest. Tauri's
        // static schema requires a signature string on every platform entry,
        // even though it verifies only the selected Darwin/Linux target.
        signature: "",
      };
    }

    const portable = `kkterm-${version}-windows-${arch}-portable.zip`;
    const portableChecksum = `${portable}.sha256`;
    if (completePair(names, portable, portableChecksum)) {
      platforms[`windows-${arch}-portable`] = {
        url: assetUrl(portable),
        checksum_url: assetUrl(portableChecksum),
        signature: "",
      };
    }
  }

  const macUpdater = `kkterm-${version}-macos-universal.app.tar.gz`;
  const macSignature = `${macUpdater}.sig`;
  if (completePair(names, macUpdater, macSignature)) {
    // The universal bundle serves both architectures from the same asset.
    for (const arch of ["darwin-aarch64", "darwin-x86_64"]) {
      platforms[arch] = {
        url: assetUrl(macUpdater),
        signature_asset: macSignature,
      };
    }
  }

  const linuxUpdater = `kkterm-${version}-linux-x86_64.AppImage`;
  const linuxSignature = `${linuxUpdater}.sig`;
  if (completePair(names, linuxUpdater, linuxSignature)) {
    platforms["linux-x86_64"] = {
      url: assetUrl(linuxUpdater),
      signature_asset: linuxSignature,
    };
  }

  return {
    version,
    notes: (release.body ?? "").trim(),
    pub_date: release.published_at,
    release_url: release.html_url,
    platforms,
  };
}

export function buildTauriReleaseManifest(manifest) {
  const platforms = {};
  for (const target of TAURI_UPDATER_PLATFORMS) {
    const platform = manifest.platforms[target];
    if (!platform || typeof platform.signature !== "string" || !platform.signature.trim()) {
      throw new Error(`Missing Tauri updater signature for ${target}`);
    }
    platforms[target] = {
      url: platform.url,
      signature: platform.signature,
    };
  }
  return {
    version: manifest.version,
    notes: manifest.notes,
    pub_date: manifest.pub_date,
    platforms,
  };
}
