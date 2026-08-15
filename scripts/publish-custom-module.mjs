import { spawn } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const repositoryRoot = resolve(import.meta.dirname, "..");
const wranglerCli = resolve(repositoryRoot, "node_modules/wrangler/bin/wrangler.js");
const defaultBaselinePath = resolve(repositoryRoot, "custom-modules/catalog.v2.json");
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const moduleIdPattern = /^[a-z][a-z0-9.-]{0,127}$/;
const allowedPermissions = new Set([
  "storage", "documentStorage", "blobStorage", "browserStorage", "openExternal",
  "clipboard", "files", "networkFetch", "secretReferences", "hostUi", "hostAi",
]);
const maxArchiveBytes = 1024 * 1024 * 1024;
const maxCuratedIconBytes = 64 * 1024;

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const options = { catalogPath: "catalog/v2/catalog.json", expiresDays: 30, dryRun: false, renewOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--dry-run", "--renew-only", "--skip-package-upload"].includes(argument)) {
      options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = true;
      continue;
    }
    const name = argument.startsWith("--") ? argument.slice(2) : "";
    if (!name || index + 1 >= argv.length) fail(`Invalid argument: ${argument}`);
    options[name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[index + 1];
    index += 1;
  }
  for (const required of ["bucket", "baseUrl", "privateKey"]) {
    if (!options[required]) fail(`Missing required --${required.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  if (!options.renewOnly && !options.package) fail("Missing required --package");
  options.expiresDays = Number(options.expiresDays);
  if (!Number.isInteger(options.expiresDays) || options.expiresDays < 1 || options.expiresDays > 45) {
    fail("--expires-days must be an integer from 1 through 45");
  }
  options.baseUrl = options.baseUrl.replace(/\/+$/, "");
  const baseUrl = new URL(options.baseUrl);
  if (baseUrl.protocol !== "https:") fail("--base-url must use HTTPS");
  if (options.catalogPath.startsWith("/") || options.catalogPath.includes("..")) {
    fail("--catalog-path must be a safe relative object key");
  }
  return options;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseVersion(value) {
  const match = semverPattern.exec(value);
  if (!match) fail(`Invalid semantic version: ${value}`);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? null,
  };
}

function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] < right.core[index] ? -1 : 1;
  }
  if (left.prerelease === null && right.prerelease === null) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) < Number(rightPart) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function readManifest(packageBytes) {
  if (packageBytes.length === 0 || packageBytes.length > maxArchiveBytes) {
    fail("The .kkmod archive must be between 1 byte and 1 GiB");
  }
  const files = unzipSync(new Uint8Array(packageBytes), { filter: (file) => file.name === "kkterm-extension.json" });
  const manifestBytes = files["kkterm-extension.json"];
  if (!manifestBytes) fail("The .kkmod archive is missing kkterm-extension.json");
  const manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  if (!moduleIdPattern.test(manifest.id)) fail("The package manifest id is invalid");
  parseVersion(manifest.version);
  if (!manifest.name?.trim() || !manifest.publisher?.trim() || !manifest.summary?.trim()) {
    fail("The package manifest must provide name, publisher, and summary");
  }
  if (manifest.apiVersion !== 2) fail("Only KKMod host API v2 packages can be published");
  if (!manifest.license?.name?.trim()) fail("The package manifest license name is required");
  const permissions = manifest.permissions ?? {};
  if (!permissions || Array.isArray(permissions) || typeof permissions !== "object") {
    fail("The package manifest permissions must be an object");
  }
  for (const permission of Object.keys(permissions)) {
    if (!allowedPermissions.has(permission)) fail(`Unsupported package permission: ${permission}`);
  }
  validateCuratedModuleIcons(packageBytes, manifest);
  return manifest;
}

function validateCuratedModuleIcons(packageBytes, manifest) {
  if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) {
    fail("The package manifest must declare at least one Module contribution");
  }
  const iconPaths = manifest.modules
    .filter((module) => module.railVisible !== false)
    .map((module) => {
      if (typeof module.icon !== "string" || !/^dist\/[A-Za-z0-9/._@-]+\.svg$/i.test(module.icon)) {
        fail(`Curated Activity Rail contribution ${module.id ?? "(unknown)"} must declare a packaged SVG icon`);
      }
      return module.icon;
    });
  const requested = new Set(iconPaths);
  const files = unzipSync(new Uint8Array(packageBytes), { filter: (file) => requested.has(file.name) });
  for (const iconPath of iconPaths) {
    const iconBytes = files[iconPath];
    if (!iconBytes || iconBytes.length === 0 || iconBytes.length > maxCuratedIconBytes) {
      fail(`Curated Activity Rail icon ${iconPath} must be between 1 byte and 64 KiB`);
    }
    const svg = Buffer.from(iconBytes).toString("utf8");
    if (!/<svg\b/i.test(svg)) fail(`Curated Activity Rail icon ${iconPath} is not SVG markup`);
    if (/<(?:script|foreignObject|iframe|object|embed|image|use|style)\b|\bon[a-z]+\s*=|\b(?:href|xlink:href)\s*=|url\s*\(|<!DOCTYPE|<\?xml-stylesheet/i.test(svg)) {
      fail(`Curated Activity Rail icon ${iconPath} contains active or external SVG content`);
    }
  }
}

function loadSigningKey(pemBytes, passphrase) {
  const privateKey = createPrivateKey({
    key: pemBytes,
    format: "pem",
    passphrase: passphrase || undefined,
  });
  if (privateKey.asymmetricKeyType !== "ed25519") fail("The signing key must be Ed25519");
  const publicKey = createPublicKey(privateKey);
  const jwk = publicKey.export({ format: "jwk" });
  const rawPublicKey = Buffer.from(jwk.x, "base64url");
  if (rawPublicKey.length !== 32) fail("The Ed25519 public key has an unexpected length");
  return {
    privateKey,
    publicKey,
    publicKeyHex: rawPublicKey.toString("hex"),
    keyId: sha256(rawPublicKey),
  };
}

function createEnvelope(payload, key) {
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  return {
    schemaVersion: 2,
    keyId: key.keyId,
    payload: payloadBytes.toString("base64"),
    signature: sign(null, payloadBytes, key.privateKey).toString("base64"),
  };
}

function verifyEnvelope(envelope, key) {
  if (envelope?.schemaVersion !== 2 || envelope.keyId !== key.keyId) {
    fail("The remote catalog envelope uses an unexpected schema or signing key");
  }
  const payloadBytes = Buffer.from(envelope.payload, "base64");
  const signatureBytes = Buffer.from(envelope.signature, "base64");
  if (!verify(null, payloadBytes, key.publicKey, signatureBytes)) {
    fail("The remote catalog signature is invalid");
  }
  const payload = JSON.parse(payloadBytes.toString("utf8"));
  if (payload.schemaVersion !== 2 || !Number.isSafeInteger(payload.sequence) || payload.sequence < 1) {
    fail("The remote catalog payload is invalid");
  }
  return payload;
}

function validateCatalogEntries(modules, key) {
  if (!Array.isArray(modules)) fail("The catalog modules field must be an array");
  const ids = new Set();
  for (const entry of modules) {
    if (!moduleIdPattern.test(entry.id) || ids.has(entry.id)) fail(`Invalid or duplicate catalog id: ${entry.id}`);
    ids.add(entry.id);
    parseVersion(entry.version);
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) fail(`Invalid package SHA-256 for ${entry.id}`);
    const packageSignature = Buffer.from(entry.signature, "base64");
    if (!verify(null, Buffer.from(entry.sha256), key.publicKey, packageSignature)) {
      fail(`Invalid package signature for ${entry.id}@${entry.version}`);
    }
    const downloadUrl = new URL(entry.downloadUrl);
    if (downloadUrl.protocol !== "https:") fail(`Package URL must use HTTPS for ${entry.id}`);
  }
  return modules;
}

async function loadCurrentCatalog(catalogUrl, key) {
  const response = await fetch(catalogUrl, { headers: { "cache-control": "no-cache" } });
  if (response.status === 404) {
    const baseline = JSON.parse(await readFile(defaultBaselinePath, "utf8"));
    if (baseline.schemaVersion !== 2 || !Array.isArray(baseline.modules)) {
      fail("The bundled baseline catalog is invalid");
    }
    return { schemaVersion: 2, sequence: 0, modules: validateCatalogEntries(baseline.modules, key) };
  }
  if (!response.ok) fail(`Failed to download the current catalog: HTTP ${response.status}`);
  const payload = verifyEnvelope(await response.json(), key);
  validateCatalogEntries(payload.modules, key);
  return payload;
}

function buildRelease(current, manifest, packageBytes, baseUrl, key, expiresDays, now = new Date()) {
  const digest = sha256(packageBytes);
  const existing = current.modules.find((entry) => entry.id === manifest.id);
  if (existing) {
    const comparison = compareVersions(manifest.version, existing.version);
    if (comparison < 0) fail(`Refusing to downgrade ${manifest.id} from ${existing.version} to ${manifest.version}`);
    if (comparison === 0 && existing.sha256 !== digest) {
      fail(`Version ${manifest.version} of ${manifest.id} is immutable and already has different bytes`);
    }
    if (existing.publisher !== manifest.publisher || existing.name !== manifest.name) {
      fail(`The package changes the established identity of ${manifest.id}`);
    }
  }
  const objectKey = `packages/sha256/${digest}.kkmod`;
  const entry = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    publisher: manifest.publisher,
    summary: manifest.summary,
    apiVersion: manifest.apiVersion,
    downloadUrl: `${baseUrl}/${objectKey}`,
    sha256: digest,
    signature: sign(null, Buffer.from(digest), key.privateKey).toString("base64"),
    license: manifest.license.name,
    permissions: manifest.permissions ?? {},
    downloadSize: packageBytes.length,
  };
  const modules = current.modules.filter((item) => item.id !== manifest.id).concat(entry);
  modules.sort((left, right) => left.id.localeCompare(right.id));
  const generatedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + expiresDays * 86_400_000).toISOString();
  const payload = {
    schemaVersion: 2,
    sequence: current.sequence + 1,
    generatedAt,
    expiresAt,
    modules,
  };
  return { digest, objectKey, entry, payload, envelope: createEnvelope(payload, key) };
}

function buildRenewal(current, key, expiresDays, now = new Date()) {
  if (current.sequence < 1) fail("Cannot renew a catalog that has not been published yet");
  const payload = {
    schemaVersion: 2,
    sequence: current.sequence + 1,
    generatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + expiresDays * 86_400_000).toISOString(),
    modules: current.modules,
  };
  return { payload, envelope: createEnvelope(payload, key) };
}

async function runWrangler(args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [wranglerCli, ...args], {
      cwd: repositoryRoot,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", rejectPromise);
    child.once("exit", (code) => code === 0
      ? resolvePromise()
      : rejectPromise(new Error(`Wrangler exited with code ${code}`)));
  });
}

async function verifyPublicObject(url, expectedSize) {
  const response = await fetch(url, { method: "HEAD", headers: { "cache-control": "no-cache" } });
  if (!response.ok) fail(`Published package is not available at ${url}: HTTP ${response.status}`);
  const contentLength = response.headers.get("content-length");
  const length = contentLength === null ? null : Number(contentLength);
  if (length !== null && Number.isFinite(length) && length !== expectedSize) {
    fail(`Published package size is ${length}, expected ${expectedSize}`);
  }
}

async function main(argv) {
  const options = parseArguments(argv);
  const pemBytes = await readFile(resolve(options.privateKey));
  const key = loadSigningKey(pemBytes, process.env.KKTERM_CUSTOM_MODULE_SIGNING_KEY_PASSPHRASE);
  const catalogUrl = `${options.baseUrl}/${options.catalogPath}`;
  const current = await loadCurrentCatalog(catalogUrl, key);
  let packagePath;
  let packageBytes;
  let manifest;
  let release;
  if (options.renewOnly) {
    release = buildRenewal(current, key, options.expiresDays);
  } else {
    packagePath = resolve(options.package);
    if (!packagePath.toLowerCase().endsWith(".kkmod")) fail("--package must point to a .kkmod file");
    packageBytes = await readFile(packagePath);
    manifest = readManifest(packageBytes);
    release = buildRelease(current, manifest, packageBytes, options.baseUrl, key, options.expiresDays);
  }

  console.log(JSON.stringify({
    mode: options.renewOnly ? "renew" : "publish",
    package: packagePath ? basename(packagePath) : undefined,
    id: manifest?.id,
    version: manifest?.version,
    bytes: packageBytes?.length,
    sha256: release.digest,
    keyId: key.keyId,
    publicKeyHex: key.publicKeyHex,
    packageUrl: release.entry?.downloadUrl,
    catalogUrl,
    catalogSequence: release.payload.sequence,
    dryRun: options.dryRun,
  }, null, 2));
  if (options.dryRun) return;

  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "kkmod-publish-"));
  const catalogFile = resolve(temporaryDirectory, "catalog.json");
  try {
    await writeFile(catalogFile, `${JSON.stringify(release.envelope, null, 2)}\n`, "utf8");
    if (!options.renewOnly) {
      if (!options.skipPackageUpload) {
        await runWrangler([
          "r2", "object", "put", `${options.bucket}/${release.objectKey}`,
          `--file=${packagePath}`,
          "--remote",
          "--content-type=application/vnd.kkterm.kkmod+zip",
          "--cache-control=public, max-age=31536000, immutable",
        ]);
      }
      await verifyPublicObject(release.entry.downloadUrl, packageBytes.length);
    }
    await runWrangler([
      "r2", "object", "put", `${options.bucket}/${options.catalogPath}`,
      `--file=${catalogFile}`,
      "--remote",
      "--content-type=application/json; charset=utf-8",
      "--cache-control=no-cache, max-age=0, must-revalidate",
    ]);
    const publishedResponse = await fetch(`${catalogUrl}?sequence=${release.payload.sequence}`, {
      headers: { "cache-control": "no-cache" },
    });
    if (!publishedResponse.ok) fail(`Published catalog returned HTTP ${publishedResponse.status}`);
    const published = verifyEnvelope(await publishedResponse.json(), key);
    if (sha256(Buffer.from(JSON.stringify(published))) !== sha256(Buffer.from(JSON.stringify(release.payload)))) {
      fail("Published catalog payload does not match the release payload");
    }
    if (options.writeBaseline) {
      const baselinePath = resolve(options.writeBaseline);
      await writeFile(baselinePath, `${JSON.stringify({ schemaVersion: 2, modules: release.payload.modules }, null, 2)}\n`, "utf8");
      console.log(`Updated baseline catalog: ${baselinePath}`);
    }
    console.log(options.renewOnly
      ? `Renewed catalog at sequence ${release.payload.sequence}.`
      : `Published ${manifest.id}@${manifest.version} and catalog sequence ${release.payload.sequence}.`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export {
  buildRelease,
  buildRenewal,
  compareVersions,
  createEnvelope,
  loadSigningKey,
  parseArguments,
  readManifest,
  validateCuratedModuleIcons,
  validateCatalogEntries,
  verifyEnvelope,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
