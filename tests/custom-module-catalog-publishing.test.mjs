import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { zipSync } from "fflate";
import {
  buildRelease,
  buildRenewal,
  createEnvelope,
  loadSigningKey,
  readManifest,
  validateCatalogEntries,
  verifyEnvelope,
} from "../scripts/publish-custom-module.mjs";

function signingKey() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return loadSigningKey(privateKey.export({ type: "pkcs8", format: "pem" }));
}

function packageBytes(version = "1.0.0", marker = "one") {
  const manifest = {
    id: "com.kkterm.fixture",
    name: "Fixture",
    version,
    publisher: "KKTerm",
    summary: "Fixture module",
    apiVersion: 2,
    license: { name: "MIT", file: "licenses/LICENSE" },
    permissions: { storage: true, documentStorage: true },
    modules: [{ id: "main", title: "Fixture", icon: "dist/icon.svg", entrypoint: "dist/index.html" }],
  };
  return Buffer.from(zipSync({
    "kkterm-extension.json": Buffer.from(JSON.stringify(manifest)),
    "dist/index.html": Buffer.from(`<title>${marker}</title>`),
    "dist/icon.svg": Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>'),
    "licenses/LICENSE": Buffer.from("MIT"),
  }));
}

test("signed catalog envelope authenticates exact payload bytes", () => {
  const key = signingKey();
  const payload = { schemaVersion: 2, sequence: 1, modules: [] };
  const envelope = createEnvelope(payload, key);
  assert.deepEqual(verifyEnvelope(envelope, key), payload);
  envelope.payload = Buffer.from("{}").toString("base64");
  assert.throws(() => verifyEnvelope(envelope, key), /signature is invalid/);
});

test("publisher creates immutable content-addressed package metadata", () => {
  const key = signingKey();
  const bytes = packageBytes();
  const manifest = readManifest(bytes);
  const release = buildRelease(
    { schemaVersion: 2, sequence: 0, modules: [] },
    manifest,
    bytes,
    "https://modules.example.test",
    key,
    30,
    new Date("2026-08-13T00:00:00.000Z"),
  );
  assert.equal(release.payload.sequence, 1);
  assert.match(release.objectKey, /^packages\/sha256\/[a-f0-9]{64}\.kkmod$/);
  assert.equal(release.entry.downloadUrl, `https://modules.example.test/${release.objectKey}`);
  assert.equal(release.entry.downloadSize, bytes.length);
  assert.deepEqual(release.entry.permissions, { storage: true, documentStorage: true });
});

test("publisher requires inert SVG icons for curated Activity Rail contributions", () => {
  const missingIconManifest = {
    id: "com.kkterm.fixture",
    name: "Fixture",
    version: "1.0.0",
    publisher: "KKTerm",
    summary: "Fixture module",
    apiVersion: 2,
    license: { name: "MIT", file: "licenses/LICENSE" },
    modules: [{ id: "main", title: "Fixture", entrypoint: "dist/index.html" }],
  };
  const missingIconBytes = Buffer.from(zipSync({
    "kkterm-extension.json": Buffer.from(JSON.stringify(missingIconManifest)),
    "dist/index.html": Buffer.from("<title>Fixture</title>"),
    "licenses/LICENSE": Buffer.from("MIT"),
  }));
  assert.throws(() => readManifest(missingIconBytes), /packaged SVG icon/);

  const unsafeManifest = {
    ...missingIconManifest,
    modules: [{ ...missingIconManifest.modules[0], icon: "dist/icon.svg" }],
  };
  const unsafeIconBytes = Buffer.from(zipSync({
    "kkterm-extension.json": Buffer.from(JSON.stringify(unsafeManifest)),
    "dist/index.html": Buffer.from("<title>Fixture</title>"),
    "dist/icon.svg": Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
    "licenses/LICENSE": Buffer.from("MIT"),
  }));
  assert.throws(() => readManifest(unsafeIconBytes), /active or external SVG content/);
});

test("publisher refuses downgrade and same-version byte replacement", () => {
  const key = signingKey();
  const firstBytes = packageBytes("2.0.0", "one");
  const first = buildRelease(
    { schemaVersion: 2, sequence: 0, modules: [] },
    readManifest(firstBytes),
    firstBytes,
    "https://modules.example.test",
    key,
    30,
  );
  const current = first.payload;
  const changedBytes = packageBytes("2.0.0", "changed");
  assert.throws(
    () => buildRelease(current, readManifest(changedBytes), changedBytes, "https://modules.example.test", key, 30),
    /immutable/,
  );
  const olderBytes = packageBytes("1.9.0");
  assert.throws(
    () => buildRelease(current, readManifest(olderBytes), olderBytes, "https://modules.example.test", key, 30),
    /downgrade/,
  );
});

test("catalog renewal advances sequence without changing package entries", () => {
  const key = signingKey();
  const current = {
    schemaVersion: 2,
    sequence: 8,
    modules: [{ id: "com.kkterm.fixture", version: "1.0.0" }],
  };
  const renewal = buildRenewal(current, key, 30, new Date("2026-08-13T00:00:00.000Z"));
  assert.equal(renewal.payload.sequence, 9);
  assert.deepEqual(renewal.payload.modules, current.modules);
  assert.equal(renewal.payload.expiresAt, "2026-09-12T00:00:00.000Z");
  assert.deepEqual(verifyEnvelope(renewal.envelope, key), renewal.payload);
});

test("publisher rejects catalog entries without a valid package signature", () => {
  const key = signingKey();
  assert.throws(() => validateCatalogEntries([{
    id: "com.kkterm.fixture",
    version: "1.0.0",
    sha256: "a".repeat(64),
    signature: Buffer.alloc(64).toString("base64"),
    downloadUrl: "https://modules.example.test/packages/bad.kkmod",
  }], key), /package signature/);
});
