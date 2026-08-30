import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { invokeCommand, isTauriRuntime, openExternalUrl } from "./tauri";
import { currentPlatform } from "./platform";
import {
  appUpdateInstallStrategy,
  appUpdateProgressPercent,
  fetchUpdateJson,
  parseCloudflareReleaseManifest,
  selectManifestWindowsInstaller,
  selectManifestWindowsPortableZip,
  selectWindowsInstallerAssets,
  selectWindowsPortableAssets,
  type AppUpdateAsset,
  type AppUpdateInstallerAssets,
  type AppUpdateInstallStrategy,
} from "./appUpdatesModel";

let debugBuildPromise: Promise<boolean> | null = null;

export function isDebugBuild(): Promise<boolean> {
  if (!isTauriRuntime()) {
    return Promise.resolve(false);
  }
  if (!debugBuildPromise) {
    debugBuildPromise = invokeCommand("is_debug_build").catch(() => false);
  }
  return debugBuildPromise;
}

const RELEASES_API_URL = "https://api.github.com/repos/ryantsai/KKTerm/releases/latest";
const RELEASES_PAGE_URL = "https://github.com/ryantsai/KKTerm/releases/latest";
const CLOUDFLARE_RELEASE_URL = "https://kkterm.ryantsai.com/releases/latest.json";

export type AppUpdate = {
  currentVersion: string;
  version: string;
  body: string;
  htmlUrl: string;
  installer: AppUpdateInstallerAssets | null;
  installStrategy: AppUpdateInstallStrategy;
};

export type AppUpdateDownloadTask = {
  canCancel: boolean;
  completion: Promise<void>;
  cancel: () => Promise<void>;
  install: () => Promise<void>;
};

type AppUpdateDownloadProgress = {
  jobId: string;
  transferredBytes: number;
  totalBytes: number;
  progress: number;
};

function normalizeTag(tag: string) {
  return tag.replace(/^v/i, "").trim();
}

// Compare two dot-separated version strings. Returns >0 if a>b, <0 if a<b, 0 equal.
// Build metadata (+suffix) is stripped per semver — it does not affect precedence.
// Pre-release suffixes (e.g. "1.2.3-beta.1") are treated as lower than the same
// version without a suffix, which is enough for "is there a newer release" checks.
export function compareVersions(a: string, b: string): number {
  const cleanA = a.split("+")[0].trim();
  const cleanB = b.split("+")[0].trim();
  const [coreA, preA = ""] = cleanA.split("-");
  const [coreB, preB = ""] = cleanB.split("-");

  const partsA = coreA.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const partsB = coreB.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }

  if (preA === preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  return preA < preB ? -1 : 1;
}

type GitHubRelease = {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: AppUpdateAsset[];
};

export async function checkForAppUpdate(): Promise<AppUpdate | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const appMode = await invokeCommand("get_app_mode");
  if (appMode.updatesManagedByPlatformStore) {
    return null;
  }
  const strategy = appUpdateInstallStrategy(
    currentPlatform(),
    appMode.mode === "portable",
  );
  if (strategy === "tauri-updater") {
    return checkForTauriAppUpdate();
  }

  const currentVersion = await getVersion();

  const targetTriple = (await invokeCommand("get_app_update_target_triple")) as string;
  try {
    const manifest = parseCloudflareReleaseManifest(
      await fetchUpdateJson(CLOUDFLARE_RELEASE_URL, "Cloudflare", 10_000),
    );
    if (compareVersions(manifest.version, currentVersion) <= 0) return null;
    return {
      currentVersion,
      version: manifest.version,
      body: manifest.notes.trim(),
      htmlUrl: manifest.release_url,
      installer:
        strategy === "windows-installer"
          ? selectManifestWindowsInstaller(manifest, targetTriple)
          : strategy === "portable-self-update"
            ? selectManifestWindowsPortableZip(manifest, targetTriple)
          : null,
      installStrategy: strategy,
    };
  } catch {
    // GitHub remains a fallback when the app-owned release mirror is unavailable
    // or returns malformed metadata.
  }

  const release = (await fetchUpdateJson(RELEASES_API_URL, "GitHub", 10_000)) as GitHubRelease;

  if (release.draft || release.prerelease || !release.tag_name) {
    return null;
  }

  const latestVersion = normalizeTag(release.tag_name);
  if (compareVersions(latestVersion, currentVersion) <= 0) {
    return null;
  }

  return {
    currentVersion,
    version: latestVersion,
    body: (release.body ?? "").trim(),
    htmlUrl: release.html_url ?? RELEASES_PAGE_URL,
    installer:
      strategy === "windows-installer"
        ? selectWindowsInstallerAssets(release.assets, targetTriple)
        : strategy === "portable-self-update"
          ? selectWindowsPortableAssets(release.assets, targetTriple)
        : null,
    installStrategy: strategy,
  };
}

export async function openReleaseDownloadPage(update: AppUpdate) {
  await openExternalUrl(update.htmlUrl);
}

export async function startAppUpdateDownload(
  update: AppUpdate,
  onProgress: (progress: number) => void,
): Promise<AppUpdateDownloadTask> {
  if (update.installStrategy === "tauri-updater") {
    return startTauriAppUpdateDownload(onProgress);
  }
  if (!update.installer) {
    throw new Error("No update asset is available for this device.");
  }
  const request = {
    assetKind:
      update.installStrategy === "portable-self-update"
        ? ("windowsPortable" as const)
        : ("windowsInstaller" as const),
    version: update.version,
    assetName: update.installer.assetName,
    downloadUrl: update.installer.downloadUrl,
    checksumUrl: update.installer.checksumUrl,
  };
  const jobId = crypto.randomUUID();
  const unlisten = await listen<AppUpdateDownloadProgress>(
    "app-update-download-progress",
    (event) => {
      if (event.payload.jobId === jobId) {
        onProgress(event.payload.progress);
      }
    },
  );
  const completion = invokeCommand("download_app_update", { jobId, request }).finally(unlisten);
  return {
    canCancel: true,
    completion,
    cancel: () => invokeCommand("cancel_app_update_download", { jobId }),
    install: () => invokeCommand("install_downloaded_app_update", { request }),
  };
}

export function isAppUpdateDownloadCancelled(error: unknown) {
  return String(error).includes("app update download cancelled");
}

async function checkForTauriAppUpdate(): Promise<AppUpdate | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const tauriUpdate = await check({ timeout: 10_000 });
  if (!tauriUpdate) {
    return null;
  }

  return {
    currentVersion: tauriUpdate.currentVersion,
    version: tauriUpdate.version,
    body: (tauriUpdate.body ?? "").trim(),
    htmlUrl: RELEASES_PAGE_URL,
    installer: null,
    installStrategy: "tauri-updater",
  };
}

async function startTauriAppUpdateDownload(
  onProgress: (progress: number) => void,
): Promise<AppUpdateDownloadTask> {
  const [{ check }, { relaunch }] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-process"),
  ]);
  const tauriUpdate = await check({ timeout: 10_000 });
  if (!tauriUpdate) {
    throw new Error("No signed update is available for this device.");
  }
  let downloadedBytes = 0;
  let totalBytes = 0;
  const completion = tauriUpdate.download((event) => {
    if (event.event === "Started") {
      totalBytes = event.data.contentLength ?? 0;
      onProgress(0);
      return;
    }
    if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
      const progress = appUpdateProgressPercent(downloadedBytes, totalBytes);
      if (progress !== null) {
        onProgress(progress);
      }
      return;
    }
    onProgress(100);
  }, { timeout: 120_000 });

  return {
    canCancel: false,
    completion,
    cancel: async () => undefined,
    install: async () => {
      await tauriUpdate.install();
      await relaunch();
    },
  };
}
