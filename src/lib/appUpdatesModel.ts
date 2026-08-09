export function shouldRunStartupUpdateCheck({
  autoUpdateChecksEnabled,
  hasCheckedThisLaunch,
  isTauriRuntime,
  lastCheckedAt = null,
  now = Date.now(),
}: {
  autoUpdateChecksEnabled: boolean;
  hasCheckedThisLaunch: boolean;
  isTauriRuntime: boolean;
  lastCheckedAt?: number | null;
  now?: number;
}) {
  const intervalElapsed =
    lastCheckedAt === null || now - lastCheckedAt >= STARTUP_UPDATE_CHECK_INTERVAL_MS;
  return isTauriRuntime && autoUpdateChecksEnabled && !hasCheckedThisLaunch && intervalElapsed;
}

export const STARTUP_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export async function fetchUpdateJson(
  url: string,
  serviceName: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${serviceName} returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export type AppUpdateAsset = {
  name?: string;
  browser_download_url?: string;
};

export type AppUpdateInstallerAssets = {
  assetName: string;
  downloadUrl: string;
  checksumUrl: string;
};

export type CloudflareReleaseManifest = {
  version: string;
  notes: string;
  pub_date: string;
  release_url: string;
  platforms: Record<string, { url: string; checksum_url?: string; signature?: string }>;
};

function isTrustedManifestUrl(value: unknown, version: string) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "kkterm.ryantsai.com" &&
      url.pathname.startsWith(`/releases/v${version}/`)
    );
  } catch {
    return false;
  }
}

export function parseCloudflareReleaseManifest(value: unknown): CloudflareReleaseManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid Cloudflare update manifest");
  const record = value as Record<string, unknown>;
  if (
    typeof record.version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(record.version) ||
    typeof record.notes !== "string" ||
    typeof record.pub_date !== "string" ||
    typeof record.release_url !== "string" ||
    !record.platforms ||
    typeof record.platforms !== "object"
  ) {
    throw new Error("Invalid Cloudflare update manifest");
  }
  const platforms: CloudflareReleaseManifest["platforms"] = {};
  for (const [target, rawPlatform] of Object.entries(record.platforms)) {
    if (!rawPlatform || typeof rawPlatform !== "object") {
      throw new Error("Invalid Cloudflare update manifest platform");
    }
    const platform = rawPlatform as Record<string, unknown>;
    if (!isTrustedManifestUrl(platform.url, record.version)) {
      throw new Error("Invalid Cloudflare update manifest URL");
    }
    if (platform.checksum_url !== undefined && !isTrustedManifestUrl(platform.checksum_url, record.version)) {
      throw new Error("Invalid Cloudflare update manifest checksum URL");
    }
    platforms[target] = {
      url: platform.url as string,
      ...(typeof platform.checksum_url === "string" ? { checksum_url: platform.checksum_url } : {}),
      ...(typeof platform.signature === "string" ? { signature: platform.signature } : {}),
    };
  }
  return {
    version: record.version,
    notes: record.notes,
    pub_date: record.pub_date,
    release_url: record.release_url,
    platforms,
  };
}

export function selectManifestWindowsInstaller(
  manifest: CloudflareReleaseManifest,
  targetTriple: string,
): AppUpdateInstallerAssets | null {
  const platform = manifest.platforms[targetTriple];
  if (!platform?.checksum_url) return null;
  const pathParts = new URL(platform.url).pathname.split("/");
  const assetName = pathParts[pathParts.length - 1];
  if (!assetName) return null;
  return { assetName, downloadUrl: platform.url, checksumUrl: platform.checksum_url };
}

export function selectManifestWindowsPortableZip(
  manifest: CloudflareReleaseManifest,
  targetTriple: string,
): AppUpdateInstallerAssets | null {
  const platform = manifest.platforms[`${targetTriple}-portable`];
  if (!platform?.checksum_url) return null;
  const pathParts = new URL(platform.url).pathname.split("/");
  const assetName = pathParts[pathParts.length - 1];
  if (!assetName?.endsWith(`-${targetTriple}-portable.zip`)) return null;
  return { assetName, downloadUrl: platform.url, checksumUrl: platform.checksum_url };
}

export type AppUpdateInstallStrategy =
  | "windows-installer"
  | "portable-self-update"
  | "tauri-updater"
  | "download-page";

export function appUpdateProgressPercent(downloadedBytes: number, totalBytes: number) {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    return null;
  }
  const percent = Math.round((downloadedBytes / totalBytes) * 100);
  return Math.max(0, Math.min(100, percent));
}

export function appUpdateInstallStrategy(
  platform: "windows" | "macos" | "linux" | "unknown",
  portable = false,
): AppUpdateInstallStrategy {
  if (platform === "windows" && portable) {
    return "portable-self-update";
  }
  if (platform === "windows") {
    return "windows-installer";
  }
  if (platform === "macos" || platform === "linux") {
    return "tauri-updater";
  }
  return "download-page";
}

export function selectWindowsInstallerAssets(
  assets: AppUpdateAsset[] | undefined,
  targetTriple: string,
): AppUpdateInstallerAssets | null {
  const installer = assets?.find((asset) => {
    const name = asset.name ?? "";
    return name.endsWith(`-${targetTriple}-setup.exe`) && Boolean(asset.browser_download_url);
  });
  if (!installer?.name || !installer.browser_download_url) {
    return null;
  }

  const checksumName = `${installer.name}.sha256`;
  const checksum = assets?.find(
    (asset) => asset.name === checksumName && Boolean(asset.browser_download_url),
  );
  if (!checksum?.browser_download_url) {
    return null;
  }

  return {
    assetName: installer.name,
    downloadUrl: installer.browser_download_url,
    checksumUrl: checksum.browser_download_url,
  };
}

export function selectWindowsPortableAssets(
  assets: AppUpdateAsset[] | undefined,
  targetTriple: string,
): AppUpdateInstallerAssets | null {
  const portableZip = assets?.find((asset) => {
    const name = asset.name ?? "";
    return name.endsWith(`-${targetTriple}-portable.zip`) && Boolean(asset.browser_download_url);
  });
  if (!portableZip?.name || !portableZip.browser_download_url) {
    return null;
  }
  const checksum = assets?.find(
    (asset) =>
      asset.name === `${portableZip.name}.sha256` && Boolean(asset.browser_download_url),
  );
  if (!checksum?.browser_download_url) {
    return null;
  }
  return {
    assetName: portableZip.name,
    downloadUrl: portableZip.browser_download_url,
    checksumUrl: checksum.browser_download_url,
  };
}
