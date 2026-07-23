#!/usr/bin/env zsh
set -euo pipefail

KEY_PATH=${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/kkterm-updater.key}

normalize_tauri_signing_key() {
  local key_content first_line normalized

  key_content="$1"
  first_line="${key_content%%$'\n'*}"

  # Tauri expects base64 of the full minisign key box (untrusted comment +
  # payload). Wrap a raw box if given one; otherwise treat the value as the
  # already-base64 box.
  if [[ "$first_line" == "untrusted comment:"* ]]; then
    normalized="$(printf '%s' "$key_content" | base64)"
  else
    normalized="$key_content"
  fi

  # Tauri's minisign decoder only accepts single-line standard base64. Strip any
  # whitespace a secret store or base64 line-wrapping introduced, and map the
  # URL-safe alphabet (-/_) back to standard (+//) so a URL-safe-encoded secret
  # still decodes. Valid standard base64 contains none of these, so this is a
  # no-op on correct keys and only repairs a malformed one.
  printf '%s' "$normalized" | tr -d '[:space:]' | tr -- '-_' '+/'
}

extract_tauri_signing_key() {
  normalize_tauri_signing_key "$(<"$1")"
}

require_universal_targets() {
  # A universal2 build compiles the x86_64 and aarch64 slices separately and
  # lipos them together, so the x86_64 target must be installed alongside the
  # host's aarch64 target. Fail with a fixable hint instead of a cryptic Cargo
  # "can't find crate for `std`" error. Skip the check when rustup is absent.
  command -v rustup >/dev/null 2>&1 || return 0

  if ! rustup target list --installed 2>/dev/null | grep -qx "x86_64-apple-darwin"; then
    print -u2 "Missing Rust target for the universal macOS build: x86_64-apple-darwin"
    print -u2 "Install it once with: rustup target add x86_64-apple-darwin"
    exit 1
  fi
}

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  if [[ ! -f "$KEY_PATH" ]]; then
    print -u2 "Missing Tauri updater signing key: $KEY_PATH"
    print -u2 "Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH before running npm run package:macos."
    exit 1
  fi

  export TAURI_SIGNING_PRIVATE_KEY="$(extract_tauri_signing_key "$KEY_PATH")"
else
  export TAURI_SIGNING_PRIVATE_KEY="$(normalize_tauri_signing_key "$TAURI_SIGNING_PRIVATE_KEY")"
fi

export TAURI_SIGNING_PRIVATE_KEY_PATH="$KEY_PATH"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

require_universal_targets

npm exec tauri -- build --target universal-apple-darwin --bundles app,dmg "$@"
