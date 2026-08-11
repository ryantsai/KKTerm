#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
set -euo pipefail

# Build the Linux AppImage bundle.
#
# Distribution on Linux is AppImage-only (see docs/RELEASE.md). This script
# only builds; it does not bump the version, create a tag, or upload anything.
# The shared src-tauri/tauri.conf.json bundle targets (nsis/app/dmg) are left
# untouched: the AppImage target is selected here via the CLI so Windows/macOS
# bundling is unaffected.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

TARGET_TRIPLE="${LINUX_TARGET_TRIPLE:-x86_64-unknown-linux-gnu}"
KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/kkterm-updater.key}"

normalize_tauri_signing_key() {
  local key_content first_line normalized

  key_content="$1"
  first_line="${key_content%%$'\n'*}"

  # Tauri expects base64 of the full minisign key box (untrusted comment +
  # payload). Wrap a raw box if given one; otherwise treat the value as the
  # already-base64 box.
  if [[ "$first_line" == "untrusted comment:"* ]]; then
    normalized="$(printf '%s' "$key_content" | base64 -w 0)"
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

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  if [[ ! -f "$KEY_PATH" ]]; then
    printf 'Missing Tauri updater signing key: %s\n' "$KEY_PATH" >&2
    printf 'Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH before running npm run package:linux.\n' >&2
    exit 1
  fi

  export TAURI_SIGNING_PRIVATE_KEY="$(extract_tauri_signing_key "$KEY_PATH")"
else
  export TAURI_SIGNING_PRIVATE_KEY="$(normalize_tauri_signing_key "$TAURI_SIGNING_PRIVATE_KEY")"
fi

export TAURI_SIGNING_PRIVATE_KEY_PATH="$KEY_PATH"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

# Building the AppImage runs appimagetool/linuxdeploy, which use FUSE at
# runtime. CI containers usually lack FUSE, so extract-and-run instead.
export APPIMAGE_EXTRACT_AND_RUN="${APPIMAGE_EXTRACT_AND_RUN:-1}"

# linuxdeploy bundles the build host's libwayland-*.so into the AppImage.
# Wayland's protocol marshalling must match the *running* machine's Mesa/EGL
# stack, so a build-host copy causes `EGL_BAD_PARAMETER` on eglGetDisplay/
# eglInitialize on a different host -- the app aborts before any window
# renders. Confirmed by launching an Ubuntu-24.04-built AppImage on a Fedora
# VM. See docs/RELEASE.md -> "AppImage-only distribution and its runtime workarounds".
prepare_appimagetool() {
  local cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/tauri"
  local tool_path="$cache_dir/appimagetool-x86_64.AppImage"
  mkdir -p "$cache_dir"
  if [[ ! -f "$tool_path" ]]; then
    curl -fsSL -o "$tool_path" \
      "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage"
    chmod +x "$tool_path"
  fi
  printf '%s' "$tool_path"
}

strip_bundled_wayland_libs() {
  local bundle_dir="$REPO_ROOT/src-tauri/target/$TARGET_TRIPLE/release/bundle/appimage"
  local appimage
  appimage="$(find "$bundle_dir" -maxdepth 1 -name '*.AppImage' -print -quit)"
  if [[ -z "$appimage" ]]; then
    printf 'No AppImage found in %s to patch.\n' "$bundle_dir" >&2
    exit 1
  fi

  local work_dir
  work_dir="$(mktemp -d)"
  trap 'rm -rf "$work_dir"' RETURN

  ( cd "$work_dir" && "$appimage" --appimage-extract >/dev/null )

  local removed=0 lib
  for lib in libwayland-client.so.0 libwayland-egl.so.1 libwayland-cursor.so.0 libwayland-server.so.0; do
    if [[ -f "$work_dir/squashfs-root/usr/lib/$lib" ]]; then
      rm -f "$work_dir/squashfs-root/usr/lib/$lib"
      removed=1
    fi
  done

  if [[ "$removed" -eq 0 ]]; then
    printf 'No bundled libwayland-*.so found; nothing to patch.\n'
    return
  fi

  rm -f "$appimage"
  ARCH="${TARGET_TRIPLE%%-*}" "$(prepare_appimagetool)" "$work_dir/squashfs-root" "$appimage" >/dev/null

  # tauri build already produced an updater signature over the pre-patch
  # bytes; regenerate it now that the AppImage contents changed. The signer
  # subcommand rejects --private-key and --private-key-path being set
  # together, so drop the path env var here since the key content is
  # already loaded into TAURI_SIGNING_PRIVATE_KEY.
  env -u TAURI_SIGNING_PRIVATE_KEY_PATH "./node_modules/.bin/tauri" signer sign "$appimage"
}

"./node_modules/.bin/tauri" build --target "$TARGET_TRIPLE" --bundles appimage "$@"
strip_bundled_wayland_libs
