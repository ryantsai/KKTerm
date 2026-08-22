import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildReleaseManifest,
  buildTauriReleaseManifest,
  missingRequiredPlatforms,
  recognizedReleaseAssets,
  versionFromTag,
} from "./release-mirror-model.mjs";

const REPOSITORY = "ryantsai/KKTerm";
const BUCKET = "kkterm-releases";
const PUBLIC_BASE_URL = "https://kkterm.ryantsai.com";

export function wranglerInvocation(root = process.cwd()) {
  return {
    command: process.execPath,
    args: [join(root, "node_modules", "wrangler", "bin", "wrangler.js")],
  };
}

export function parseChecksumFile(content) {
  const value = content.trim();
  const gnu = /^([a-f\d]{64})\s+\*?(.+)$/i.exec(value);
  if (gnu) return { hash: gnu[1].toLowerCase(), filename: gnu[2].trim() };
  const bsd = /^SHA256 \((.+)\) = ([a-f\d]{64})$/i.exec(value);
  if (bsd) return { hash: bsd[2].toLowerCase(), filename: bsd[1].trim() };
  throw new Error("Invalid SHA-256 checksum file");
}

export function verifyChecksum(bytes, expectedHash, filename) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedHash.toLowerCase()) {
    throw new Error(`${filename} checksum mismatch`);
  }
}

export function buildUploadPlan(release) {
  const version = versionFromTag(release.tag_name);
  const uploads = recognizedReleaseAssets(release).map(({ name }) => ({
    name,
    key: `releases/v${version}/${name}`,
  }));
  uploads.push(
    { name: "release-manifest.json", key: `releases/v${version}/latest.json` },
    { name: "tauri-release-manifest.json", key: `releases/v${version}/latest-tauri.json` },
    { name: "release-manifest.json", key: "releases/latest.json" },
    { name: "tauri-release-manifest.json", key: "releases/latest-tauri.json" },
  );
  return uploads;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });
}

function normalizeRelease(raw) {
  return {
    tag_name: raw.tagName,
    name: raw.name,
    body: raw.body,
    html_url: raw.url,
    published_at: raw.publishedAt,
    draft: raw.isDraft,
    prerelease: raw.isPrerelease,
    assets: raw.assets ?? [],
  };
}

function parseArgs(argv) {
  const options = { tag: "", dryRun: false, skipPublicVerify: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--tag") options.tag = argv[++index] ?? "";
    else if (argv[index] === "--dry-run") options.dryRun = true;
    else if (argv[index] === "--skip-public-verify") options.skipPublicVerify = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!options.tag) throw new Error("--tag v<version> is required");
  versionFromTag(options.tag);
  return options;
}

function contentType(name) {
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".sha256") || name.endsWith(".sig")) return "text/plain";
  return "application/octet-stream";
}

async function verifyDownloadedChecksums(directory, assetNames) {
  for (const checksumName of assetNames.filter((name) => name.endsWith(".sha256"))) {
    const parsed = parseChecksumFile(await readFile(join(directory, checksumName), "utf8"));
    const expectedAsset = checksumName.slice(0, -".sha256".length);
    if (basename(parsed.filename) !== expectedAsset || !assetNames.includes(expectedAsset)) {
      throw new Error(`${checksumName} does not reference its matching release asset`);
    }
    verifyChecksum(await readFile(join(directory, expectedAsset)), parsed.hash, expectedAsset);
  }
}

async function materializeSignatures(manifest, directory) {
  for (const platform of Object.values(manifest.platforms)) {
    if (!platform.signature_asset) continue;
    platform.signature = (await readFile(join(directory, platform.signature_asset), "utf8")).trim();
    delete platform.signature_asset;
  }
}

async function verifyPublicManifest(path, manifest) {
  const response = await fetch(`${PUBLIC_BASE_URL}/releases/${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Public manifest returned ${response.status}`);
  const publicManifest = await response.json();
  if (publicManifest.version !== manifest.version) throw new Error("Public manifest version mismatch");
  for (const platform of Object.values(manifest.platforms)) {
    const probe = await fetch(platform.url, { headers: { Range: "bytes=0-0" } });
    if (probe.status !== 206 && probe.status !== 200) {
      throw new Error(`Public asset probe returned ${probe.status}: ${platform.url}`);
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const raw = JSON.parse(
    run("gh", [
      "release", "view", options.tag, "--repo", REPOSITORY,
      "--json", "tagName,name,body,url,publishedAt,isDraft,isPrerelease,assets",
    ]),
  );
  const release = normalizeRelease(raw);
  if (release.draft || release.prerelease) {
    // Draft and prerelease tags must never touch the stable public manifest, so
    // there is nothing to mirror. Skip cleanly (exit 0) instead of letting
    // buildReleaseManifest throw — otherwise every prerelease publish leaves a
    // red X on the mirror workflow via the `release: published` event and the
    // dispatches the macOS/Linux release scripts fire.
    console.log(
      `${options.tag} is a ${release.draft ? "draft" : "prerelease"} release; ` +
        "leaving the stable Cloudflare manifest untouched.",
    );
    return;
  }
  const plan = buildUploadPlan(release);
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ tag: options.tag, uploads: plan }, null, 2)}\n`);
    return;
  }

  const directory = await mkdtemp(join(tmpdir(), "kkterm-release-mirror-"));
  try {
    const assets = recognizedReleaseAssets(release);
    for (const asset of assets) {
      run("gh", ["release", "download", options.tag, "--repo", REPOSITORY, "--pattern", asset.name, "--dir", directory]);
    }
    const assetNames = assets.map((asset) => asset.name);
    await verifyDownloadedChecksums(directory, assetNames);
    const manifest = buildReleaseManifest(release, PUBLIC_BASE_URL);
    const missing = missingRequiredPlatforms(manifest);
    if (missing.length > 0) {
      console.log(
        `${release.tag_name} is still missing platform assets (${missing.join(", ")}); ` +
          "leaving the current public manifest untouched until the release finishes staggering in.",
      );
      return;
    }
    await materializeSignatures(manifest, directory);
    const tauriManifest = buildTauriReleaseManifest(manifest);
    const manifestPath = join(directory, "release-manifest.json");
    const tauriManifestPath = join(directory, "tauri-release-manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(tauriManifestPath, `${JSON.stringify(tauriManifest, null, 2)}\n`, "utf8");

    for (const upload of plan) {
      const filePath = upload.name === "release-manifest.json"
        ? manifestPath
        : upload.name === "tauri-release-manifest.json"
          ? tauriManifestPath
          : join(directory, upload.name);
      const wrangler = wranglerInvocation();
      run(wrangler.command, [...wrangler.args,
        "r2", "object", "put", `${BUCKET}/${upload.key}`,
        "--remote", "--file", filePath, "--content-type", contentType(upload.name),
      ]);
    }
    if (!options.skipPublicVerify) {
      await verifyPublicManifest("latest.json", manifest);
      await verifyPublicManifest("latest-tauri.json", tauriManifest);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
