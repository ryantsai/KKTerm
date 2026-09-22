import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(
  new URL("../scripts/release-github-macos.sh", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const packageMacosScript = await readFile(
  new URL("../scripts/package-macos.sh", import.meta.url),
  "utf8",
);
const homebrewScript = await readFile(
  new URL("../scripts/update-homebrew-cask.sh", import.meta.url),
  "utf8",
);
const buildScript = await readFile(
  new URL("../src-tauri/build.rs", import.meta.url),
  "utf8",
);

test("macOS release script is a native zsh GitHub release asset uploader", () => {
  assert.match(script, /^#!\/usr\/bin\/env zsh/);
  assert.match(
    script,
    /gh release upload "\$TAG_NAME" "\$DMG_PATH" "\$SHA_PATH" "\$UPDATER_PATH" "\$UPDATER_SIG_PATH" "\$LATEST_JSON_PATH" --clobber/,
  );
  assert.doesNotMatch(script, /powershell|pwsh|release-github\.ps1/);
  assert.equal(packageJson.scripts["release:github:macos"], "zsh scripts/release-github-macos.sh");
});

test("macOS release script does not create tags or increment versions", () => {
  assert.match(script, /assert_tag_matches_version "\$TAG_NAME" "\$VERSION"/);
  assert.match(script, /gh release view "\$TAG_NAME"/);
  assert.doesNotMatch(script, /pnpm version/);
  assert.doesNotMatch(script, /git tag -a/);
  assert.doesNotMatch(script, /gh release create/);
});

test("macOS release script avoids zsh readonly parameter names", () => {
  assert.doesNotMatch(script, /local\s+status\b/);
  assert.doesNotMatch(script, /local\s+path\b/);
});

test("macOS release script expands home references loaded from env files", () => {
  assert.match(script, /expand_env_file_value\(\) \{/);
  assert.match(script, /'\$HOME'\/\*/);
  assert.match(script, /\$HOME\/\$\{value#\\\$HOME\/\}/);
  assert.match(script, /'\$\{HOME\}'\/\*/);
  assert.match(script, /'~'\/\*/);
});

test("macOS release script builds deterministic DMG and checksum asset names", () => {
  assert.match(script, /TARGET_TRIPLE="universal-apple-darwin"/);
  assert.match(script, /DMG_NAME="kkterm-\$VERSION-macos-universal\.dmg"/);
  assert.match(script, /SHA_NAME="\$DMG_NAME\.sha256"/);
  assert.match(script, /pnpm run package:macos/);
  assert.match(script, /shasum -a 256 "\$DMG_PATH"/);
});

test("macOS package script loads the updater private key for Tauri signing", () => {
  assert.equal(
    packageJson.scripts["package:macos"],
    "pnpm install && zsh scripts/package-macos.sh",
  );
  assert.match(packageMacosScript, /TAURI_SIGNING_PRIVATE_KEY_PATH:-\$HOME\/\.tauri\/kkterm-updater\.key/);
  assert.match(packageMacosScript, /normalize_tauri_signing_key\(\) \{/);
  assert.match(packageMacosScript, /extract_tauri_signing_key\(\) \{/);
  assert.match(
    packageMacosScript,
    /normalized="\$\(printf '%s' "\$key_content" \| base64\)"/,
  );
  assert.match(
    packageMacosScript,
    /printf '%s' "\$normalized" \| tr -d '\[:space:\]' \| tr -- '-_' '\+\/'/,
  );
  assert.match(packageMacosScript, /export TAURI_SIGNING_PRIVATE_KEY="\$\(extract_tauri_signing_key "\$KEY_PATH"\)"/);
  assert.match(packageMacosScript, /export TAURI_SIGNING_PRIVATE_KEY="\$\(normalize_tauri_signing_key "\$TAURI_SIGNING_PRIVATE_KEY"\)"/);
  assert.match(packageMacosScript, /pnpm exec tauri build --target universal-apple-darwin --bundles app,dmg "\$@"/);
});

test("macOS native build resolves SDK Swift overlay dependencies through an rpath", () => {
  assert.match(buildScript, /CARGO_CFG_TARGET_OS"\)\.as_deref\(\) == Ok\("macos"\)/);
  assert.match(
    buildScript,
    /cargo:rustc-link-arg-bins=-Wl,-rpath,\/usr\/lib\/swift/,
  );
});

test("macOS package script rejects app binaries with unresolvable rpath dependencies", () => {
  assert.match(packageMacosScript, /assert_resolvable_rpath_dependencies\(\) \{/);
  assert.match(packageMacosScript, /otool -arch "\$arch" -L "\$binary"/);
  assert.match(packageMacosScript, /grep '\^@rpath\/'/);
  assert.match(packageMacosScript, /LC_RPATH/);
  assert.match(
    packageMacosScript,
    /pnpm exec tauri build --target universal-apple-darwin --bundles app,dmg "\$@"\n\nassert_resolvable_rpath_dependencies/,
  );
});

test("macOS package script guards the universal build on the x86_64 Rust target", () => {
  assert.match(packageMacosScript, /require_universal_targets\(\) \{/);
  assert.match(packageMacosScript, /rustup target list --installed/);
  assert.match(packageMacosScript, /rustup target add x86_64-apple-darwin/);

  const guardIndex = packageMacosScript.indexOf("require_universal_targets\n");
  const buildIndex = packageMacosScript.indexOf("pnpm exec tauri build");
  assert.ok(guardIndex !== -1, "guard must be invoked before the build");
  assert.ok(guardIndex < buildIndex, "guard must run before tauri build");
});

test("macOS release script uploads signed Tauri updater metadata", () => {
  assert.match(script, /find_latest_updater_bundle\(\) \{/);
  assert.match(script, /UPDATER_NAME="kkterm-\$VERSION-macos-universal\.app\.tar\.gz"/);
  assert.match(script, /UPDATER_SIG_NAME="\$UPDATER_NAME\.sig"/);
  assert.match(script, /LATEST_JSON_NAME="latest\.json"/);
  assert.match(script, /write_latest_json "\$LATEST_JSON_PATH"/);
  assert.match(script, /"darwin-aarch64"/);
  assert.match(script, /"darwin-x86_64"/);
});

test("macOS release script infers the release tag from the DMG when tag is omitted", () => {
  assert.match(script, /detect_dmg_version\(\) \{/);
  assert.match(script, /VERSION=\$\(detect_dmg_version "\$SOURCE_DMG"\)/);
  assert.match(script, /TAG_NAME="v\$VERSION"/);
  assert.doesNotMatch(script, /\[\[ -n "\$TAG_NAME" \]\] \|\| TAG_NAME="v\$PACKAGE_VERSION"/);
});

test("macOS release script patches GitHub release notes with macOS direct downloads", () => {
  assert.match(script, /patch_release_notes\(\) \{/);
  assert.match(script, /Download for macOS \(Universal\)/);
  assert.doesNotMatch(script, /macOS SHA-256 checksum/);
  assert.match(script, /gh release edit "\$tag" --notes-file "\$temp_file"/);
  assert.match(script, /--skip-notes-patch/);
});

test("macOS release script notarizes and staples the final DMG before checksumming", () => {
  assert.match(script, /notarize_and_staple_dmg\(\) \{/);
  assert.match(script, /xcrun notarytool submit "\$dmg_path"/);
  assert.match(script, /xcrun stapler staple "\$dmg_path"/);
  assert.match(script, /xcrun stapler validate "\$dmg_path"/);

  const notarizeIndex = script.indexOf('notarize_and_staple_dmg "$DMG_PATH"');
  const checksumIndex = script.indexOf('shasum -a 256 "$DMG_PATH"');
  const uploadIndex = script.indexOf('gh release upload "$TAG_NAME"');

  assert.ok(notarizeIndex !== -1, "release flow should notarize the copied DMG");
  assert.ok(checksumIndex !== -1, "release flow should checksum the copied DMG");
  assert.ok(uploadIndex !== -1, "release flow should upload the copied DMG");
  assert.ok(notarizeIndex < checksumIndex, "notarization must happen before checksum generation");
  assert.ok(checksumIndex < uploadIndex, "checksum must happen before upload");
});

test("macOS release publishes the checksummed DMG through the Homebrew tap", () => {
  assert.match(script, /Publish Homebrew cask/);
  assert.match(script, /scripts\/update-homebrew-cask\.sh/);
  assert.match(script, /--version "\$VERSION"/);
  assert.match(script, /--sha256 "\$DMG_SHA256"/);
  assert.match(script, /--skip-homebrew/);

  const uploadIndex = script.indexOf('gh release upload "$TAG_NAME"');
  const homebrewIndex = script.indexOf('zsh "$REPO_ROOT/scripts/update-homebrew-cask.sh"');
  assert.ok(uploadIndex < homebrewIndex, "the DMG must be published before the cask references it");
});

test("Homebrew publisher writes, validates, commits, and pushes the KKTerm cask", () => {
  assert.match(homebrewScript, /^#!\/usr\/bin\/env zsh/);
  assert.match(homebrewScript, /Casks\/kkterm\.rb/);
  assert.match(homebrewScript, /depends_on :macos/);
  assert.doesNotMatch(homebrewScript, /depends_on macos: :big_sur/);
  assert.match(homebrewScript, /brew style --cask "\$cask_path"/);
  assert.match(homebrewScript, /brew audit --cask "\$temporary_tap\/kkterm"/);
  assert.match(homebrewScript, /git -C "\$tap_dir" commit -m "kkterm \$VERSION"/);
  assert.match(homebrewScript, /git -C "\$tap_dir" push origin HEAD:main/);
  assert.match(homebrewScript, /HOMEBREW_TAP_SSH_KEY_PATH/);
});
