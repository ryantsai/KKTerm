#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
REPO_ROOT=${SCRIPT_DIR:h}
OUTPUT_DIR="artifacts"
TAG_NAME=""
TARGET_TRIPLE="universal-apple-darwin"
SKIP_BUILD=0
SKIP_NOTES_PATCH=0
ALLOW_DIRTY=0
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: scripts/release-github-macos.sh [options]

Build and upload macOS release assets to an existing GitHub Release without
changing the project version or creating a new tag.

Options:
  -t, --tag <vX.Y.Z>       Existing release tag. Defaults to the DMG version.
  -o, --output-dir <dir>   Artifact output directory. Default: artifacts.
      --skip-build         Upload an already-built DMG from the Tauri bundle dir.
      --skip-notes-patch   Upload assets without updating the GitHub Release body.
      --allow-dirty        Do not require a clean working tree.
      --dry-run            Print actions without building or uploading.
  -h, --help               Show this help.
USAGE
}

die() {
  print -u2 -- "error: $*"
  exit 1
}

log() {
  print -- "==> $*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found on PATH: $1"
}

require_env() {
  local name="$1"
  [[ -n "${(P)name:-}" ]] || die "Required environment variable is missing: $name"
}

expand_env_file_value() {
  local value="$1"

  case "$value" in
    '$HOME'/*)
      print -r -- "$HOME/${value#\$HOME/}"
      ;;
    '${HOME}'/*)
      print -r -- "$HOME/${value#\$\{HOME\}/}"
      ;;
    '~'/*)
      print -r -- "$HOME/${value#~/}"
      ;;
    *)
      print -r -- "$value"
      ;;
  esac
}

import_local_env_files() {
  local env_file line name value

  for env_file in "$REPO_ROOT/.env.local" "$REPO_ROOT/.env"; do
    [[ -f "$env_file" ]] || continue

    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line#"${line%%[![:space:]]*}"}"
      line="${line%"${line##*[![:space:]]}"}"
      [[ -n "$line" && "$line" != \#* ]] || continue

      name="${line%%=*}"
      value="${line#*=}"
      if [[ "$line" == *"="* && "$name" =~ '^[A-Za-z_][A-Za-z0-9_]*$' ]]; then
        [[ -z "${(P)name-}" ]] || continue

        if [[ "$value" == \"*\" && "$value" == *\" ]]; then
          value="${value[2,-2]}"
        elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
          value="${value[2,-2]}"
        fi

        value=$(expand_env_file_value "$value")
        export "$name=$value"
      fi
    done < "$env_file"
  done
}

read_package_version() {
  node -p "require('./package.json').version"
}

assert_version() {
  [[ "$1" =~ '^[0-9]+\.[0-9]+\.[0-9]+$' ]] || die "Expected version <major>.<minor>.<build>, found '$1'."
}

assert_tag_matches_version() {
  local tag="$1"
  local version="$2"

  [[ "$tag" == "v$version" ]] || die "Tag $tag does not match DMG version $version."
}

detect_dmg_version() {
  local dmg_path="$1"
  local dmg_name="${dmg_path:t}"

  if [[ "$dmg_name" =~ '([0-9]+\.[0-9]+\.[0-9]+)' ]]; then
    print -r -- "${match[1]}"
    return 0
  fi

  die "Unable to detect version from DMG filename: $dmg_name"
}

assert_clean_worktree() {
  local git_status
  git_status=$(git status --porcelain)
  [[ -z "$git_status" ]] || die "Working tree has uncommitted changes. Commit/stash them first, or rerun with --allow-dirty."
}

find_latest_dmg() {
  local dmg_dir="$REPO_ROOT/src-tauri/target/$TARGET_TRIPLE/release/bundle/dmg"
  local -a matches

  [[ -d "$dmg_dir" ]] || die "DMG output directory not found: $dmg_dir"
  matches=("$dmg_dir"/*.dmg(Nom[1]))
  (( ${#matches[@]} > 0 )) || die "No DMG found in $dmg_dir"

  print -r -- "${matches[1]}"
}

find_latest_updater_bundle() {
  local updater_dir="$REPO_ROOT/src-tauri/target/$TARGET_TRIPLE/release/bundle/macos"
  local -a matches

  [[ -d "$updater_dir" ]] || die "Updater bundle directory not found: $updater_dir"
  matches=("$updater_dir"/*.app.tar.gz(Nom[1]))
  (( ${#matches[@]} > 0 )) || die "No macOS updater bundle found in $updater_dir"
  [[ -f "${matches[1]}.sig" ]] || die "Updater signature not found: ${matches[1]}.sig"

  print -r -- "${matches[1]}"
}

find_existing_latest_json() {
  local tag="$1"
  local temp_dir="$2"

  if gh release download "$tag" --pattern latest.json --dir "$temp_dir" >/dev/null 2>&1; then
    [[ -f "$temp_dir/latest.json" ]] && print -r -- "$temp_dir/latest.json"
  fi
}

notarize_and_staple_dmg() {
  local dmg_path="$1"

  require_env APPLE_API_ISSUER
  require_env APPLE_API_KEY
  require_env APPLE_API_KEY_PATH
  [[ -f "$APPLE_API_KEY_PATH" ]] || die "APPLE_API_KEY_PATH does not point to a file: $APPLE_API_KEY_PATH"

  log "Notarize DMG"
  xcrun notarytool submit "$dmg_path" \
    --key "$APPLE_API_KEY_PATH" \
    --key-id "$APPLE_API_KEY" \
    --issuer "$APPLE_API_ISSUER" \
    --wait

  log "Staple DMG notarization ticket"
  xcrun stapler staple "$dmg_path"
  xcrun stapler validate "$dmg_path"
}

patch_release_notes() {
  local tag="$1"
  local version="$2"
  local repo="$3"
  local dmg_name="$4"
  local current temp_file

  current=$(gh release view "$tag" --json body --jq .body)

  temp_file=$(mktemp)
  NOTES_BODY="$current" \
  RELEASE_TAG="$tag" \
  RELEASE_REPO="$repo" \
  DMG_NAME="$dmg_name" \
    node --input-type=module > "$temp_file" <<'NODE'
const body = process.env.NOTES_BODY ?? "";
const tag = process.env.RELEASE_TAG;
const repo = process.env.RELEASE_REPO;
const dmgName = process.env.DMG_NAME;

const macLines = [
  `* 🍎 [Download for macOS (Universal)](https://github.com/${repo}/releases/download/${tag}/${dmgName})`,
];

const withoutOldMac = body
  .split(/\r?\n/)
  .filter(
    (line) =>
      !line.includes("[Download for macOS (Apple Silicon)]") &&
      !line.includes("[Download for macOS (Universal)]") &&
      !line.includes("[SHA-256 checksum]"),
  );

if (withoutOldMac[0] === "## Direct Downloads") {
  let insertAt = 1;
  while (insertAt < withoutOldMac.length && withoutOldMac[insertAt].startsWith("* ")) {
    insertAt += 1;
  }
  withoutOldMac.splice(insertAt, 0, ...macLines);
  process.stdout.write(`${withoutOldMac.join("\n").replace(/\n*$/, "")}\n`);
} else {
  process.stdout.write(
    ["## Direct Downloads", ...macLines, "", withoutOldMac.join("\n").replace(/\n*$/, "")]
      .join("\n")
      .replace(/\n*$/, "") + "\n",
  );
}
NODE
  gh release edit "$tag" --notes-file "$temp_file"
  rm -f "$temp_file"
}

write_latest_json() {
  local output_path="$1"
  local version="$2"
  local repo="$3"
  local tag="$4"
  local updater_name="$5"
  local signature_path="$6"
  local existing_path="${7:-}"
  local release_notes="${8:-}"

  UPDATE_SIGNATURE=$(<"$signature_path") \
  UPDATE_VERSION="$version" \
  UPDATE_URL="https://github.com/$repo/releases/download/$tag/$updater_name" \
  EXISTING_LATEST_JSON_PATH="$existing_path" \
  UPDATE_NOTES="$release_notes" \
    node --input-type=module > "$output_path" <<'NODE'
import fs from "node:fs";

const signature = process.env.UPDATE_SIGNATURE?.trim();
const version = process.env.UPDATE_VERSION;
const url = process.env.UPDATE_URL;
const existingPath = process.env.EXISTING_LATEST_JSON_PATH;
const notes = process.env.UPDATE_NOTES?.trim();

if (!signature || !version || !url) {
  throw new Error("Missing updater metadata input.");
}

let metadata = {};
if (existingPath && fs.existsSync(existingPath)) {
  metadata = JSON.parse(fs.readFileSync(existingPath, "utf8"));
}

metadata.version = version;
metadata.notes = notes || "See the GitHub Release notes for this KKTerm version.";
// The universal bundle runs on both architectures, so both updater platform
// keys point at the same .app.tar.gz and signature.
metadata.platforms = {
  ...(metadata.platforms && typeof metadata.platforms === "object" ? metadata.platforms : {}),
  "darwin-aarch64": {
    signature,
    url,
  },
  "darwin-x86_64": {
    signature,
    url,
  },
};

process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
NODE
}

while (( $# > 0 )); do
  case "$1" in
    -t|--tag)
      (( $# >= 2 )) || die "$1 requires a value."
      TAG_NAME="$2"
      shift 2
      ;;
    -o|--output-dir)
      (( $# >= 2 )) || die "$1 requires a value."
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --skip-notes-patch)
      SKIP_NOTES_PATCH=1
      shift
      ;;
    --allow-dirty)
      ALLOW_DIRTY=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

cd "$REPO_ROOT"
import_local_env_files

require_command git
require_command gh
require_command pnpm
require_command node
require_command shasum
require_command xcrun

PACKAGE_VERSION=$(read_package_version)
assert_version "$PACKAGE_VERSION"

REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
[[ -n "$REPO" ]] || die "Unable to resolve GitHub repository with gh."

if (( DRY_RUN )); then
  log "Dry run only; no build, upload, or release-note changes will be made."
elif (( ! ALLOW_DIRTY )); then
  assert_clean_worktree
fi

if (( ! SKIP_BUILD && ! DRY_RUN )); then
  log "Build signed/notarized macOS DMG"
  pnpm run package:macos
fi

if (( DRY_RUN && ! SKIP_BUILD )); then
  VERSION="$PACKAGE_VERSION"
  SOURCE_DMG="<created by pnpm run package:macos>"
  SOURCE_UPDATER="<created by pnpm run package:macos>"
else
  SOURCE_DMG=$(find_latest_dmg)
  SOURCE_UPDATER=$(find_latest_updater_bundle)
  VERSION=$(detect_dmg_version "$SOURCE_DMG")
fi

assert_version "$VERSION"
if [[ -n "$TAG_NAME" ]]; then
  assert_tag_matches_version "$TAG_NAME" "$VERSION"
else
  TAG_NAME="v$VERSION"
fi

OUTPUT_PATH="$REPO_ROOT/$OUTPUT_DIR"
DMG_NAME="kkterm-$VERSION-macos-universal.dmg"
SHA_NAME="$DMG_NAME.sha256"
UPDATER_NAME="kkterm-$VERSION-macos-universal.app.tar.gz"
UPDATER_SIG_NAME="$UPDATER_NAME.sig"
LATEST_JSON_NAME="latest.json"
DMG_PATH="$OUTPUT_PATH/$DMG_NAME"
SHA_PATH="$OUTPUT_PATH/$SHA_NAME"
UPDATER_PATH="$OUTPUT_PATH/$UPDATER_NAME"
UPDATER_SIG_PATH="$OUTPUT_PATH/$UPDATER_SIG_NAME"
LATEST_JSON_PATH="$OUTPUT_PATH/$LATEST_JSON_NAME"

log "Version:       $VERSION"
log "Release tag:   $TAG_NAME"
log "Repository:    $REPO"
log "Target triple: $TARGET_TRIPLE"
log "Source DMG:    $SOURCE_DMG"
log "Source update: $SOURCE_UPDATER"
log "DMG asset:     $DMG_PATH"
log "Update asset:  $UPDATER_PATH"

if (( DRY_RUN )); then
  exit 0
fi

git fetch --tags
git rev-parse "$TAG_NAME" >/dev/null 2>&1 || die "Local tag not found: $TAG_NAME"
gh release view "$TAG_NAME" >/dev/null || die "GitHub release not found: $TAG_NAME"
mkdir -p "$OUTPUT_PATH"
cp "$SOURCE_DMG" "$DMG_PATH"
cp "$SOURCE_UPDATER" "$UPDATER_PATH"
cp "$SOURCE_UPDATER.sig" "$UPDATER_SIG_PATH"
notarize_and_staple_dmg "$DMG_PATH"
shasum -a 256 "$DMG_PATH" | awk -v name="$DMG_NAME" '{ print $1 "  " name }' > "$SHA_PATH"
existing_latest_dir=$(mktemp -d)
existing_latest_json=$(find_existing_latest_json "$TAG_NAME" "$existing_latest_dir")

if (( ! SKIP_NOTES_PATCH )); then
  log "Patch GitHub Release notes"
  patch_release_notes "$TAG_NAME" "$VERSION" "$REPO" "$DMG_NAME"
fi

release_notes=$(gh release view "$TAG_NAME" --json body --jq .body)
write_latest_json "$LATEST_JSON_PATH" "$VERSION" "$REPO" "$TAG_NAME" "$UPDATER_NAME" "$UPDATER_SIG_PATH" "$existing_latest_json" "$release_notes"

log "Upload macOS assets"
gh release upload "$TAG_NAME" "$DMG_PATH" "$SHA_PATH" "$UPDATER_PATH" "$UPDATER_SIG_PATH" "$LATEST_JSON_PATH" --clobber
rm -rf "$existing_latest_dir"

log "Dispatch Cloudflare release mirror"
if ! gh workflow run mirror-release.yml --ref main -f "tag=$TAG_NAME"; then
  print -u2 -- "Warning: Cloudflare mirror dispatch failed. Retry with: gh workflow run mirror-release.yml --ref main -f tag=$TAG_NAME"
fi

log "macOS release assets published."
