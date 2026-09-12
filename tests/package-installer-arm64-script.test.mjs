import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(
  new URL("../scripts/package-installer-arm64.ps1", import.meta.url),
  "utf8",
);

const sidecar = await readFile(
  new URL("../scripts/prepare-tauri-sidecars.ps1", import.meta.url),
  "utf8",
);

const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("arm64 package script targets the aarch64-pc-windows-msvc triple", () => {
  assert.match(script, /\$CargoTarget\s*=\s*"aarch64-pc-windows-msvc"/);
  assert.match(script, /build --bundles nsis "--target=\$CargoTarget"/);
});

test("arm64 package script emits an arm64-named installer and checksum", () => {
  assert.match(script, /\$TargetTriple\s*=\s*"windows-arm64"/);
  assert.match(
    script,
    /\$OutputName\s*=\s*"kkterm-\$Version-\$TargetTriple-setup\.exe"/,
  );
  assert.match(script, /target\\\$CargoTarget\\release\\bundle\\nsis/);
  // Path-traversal guard is preserved from the x64 packaging script.
  assert.match(script, /Assert-ChildPath -Parent \$ResolvedOutputDir/);
});

test("arm64 package script detects the ARM64 build toolchain", () => {
  assert.match(script, /rustup target list --installed/);
  assert.match(script, /Microsoft\.VisualStudio\.Component\.VC\.Tools\.ARM64/);
  // aws-lc-sys (pulled in by rustls) needs CMake + NASM for the ARM64 build.
  assert.match(script, /cmake/);
  assert.match(script, /nasm/i);
});

test("arm64 package script can download missing toolchain pieces", () => {
  assert.match(script, /\[switch\]\$InstallMissing/);
  assert.match(script, /winget install --id \$Id --exact/);
  assert.match(script, /rustup target add \$CargoTarget/);
});

test("sidecar prep supports an explicit cargo cross target", () => {
  assert.match(sidecar, /\[string\]\$CargoTarget\s*=\s*""/);
  assert.match(sidecar, /cargo build --release --bin kkterm-cli --target \$CargoTarget/);
  assert.match(sidecar, /target\\\$CargoTarget\\release\\kkterm-cli\.exe/);
});

test("npm exposes the arm64 packaging script", () => {
  assert.equal(
    pkg.scripts["package:installer:arm64"],
    "npm install && powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-installer-arm64.ps1",
  );
});
