#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
REPO_ROOT=${SCRIPT_DIR:h}
TARGET_TRIPLE="universal-apple-darwin"
APP_BINARY="$REPO_ROOT/src-tauri/target/$TARGET_TRIPLE/release/bundle/macos/KKTerm.app/Contents/MacOS/kkterm"

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
    print -u2 "Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH before running pnpm run package:macos."
    exit 1
  fi

  export TAURI_SIGNING_PRIVATE_KEY="$(extract_tauri_signing_key "$KEY_PATH")"
else
  export TAURI_SIGNING_PRIVATE_KEY="$(normalize_tauri_signing_key "$TAURI_SIGNING_PRIVATE_KEY")"
fi

export TAURI_SIGNING_PRIVATE_KEY_PATH="$KEY_PATH"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

require_universal_targets

# A `@rpath/...` dependency is only launchable when an LC_RPATH in the binary
# covers it. The macOS SDK has shipped framework stubs that re-export the
# framework's Swift overlay as `@rpath/libswift*.dylib` (see src-tauri/build.rs),
# which aborts dyld at launch when no rpath provides it - exactly the failure
# reported for the Intel slice of 3000.0.15. Fail the package step, which the
# release script runs before notarizing or uploading anything.
assert_resolvable_rpath_dependencies() {
  local binary="$APP_BINARY"
  local -a deps rpaths
  local arch candidate dep deps_output rpath rpaths_output satisfied

  [[ -f "$binary" ]] || {
    print -u2 "Missing built app binary: $binary"
    exit 1
  }
  command -v otool >/dev/null 2>&1 || {
    print -u2 "Required command not found on PATH: otool (install the Xcode command line tools)"
    exit 1
  }

  for arch in x86_64 arm64; do
    deps_output=$(otool -arch "$arch" -L "$binary" 2>/dev/null |
      awk '/^[[:space:]]/ { print $1 }' |
      grep '^@rpath/' || true)
    [[ -n "$deps_output" ]] || continue
    deps=("${(f)deps_output}")

    rpaths_output=$(otool -arch "$arch" -l "$binary" 2>/dev/null |
      awk '/LC_RPATH/{getline; getline; print $2}' || true)
    rpaths=("${(f)rpaths_output}")

    for dep in "${deps[@]}"; do
      satisfied=0
      for rpath in "${rpaths[@]}"; do
        case "$rpath" in
          @executable_path*) candidate="${binary:h}/${rpath#@executable_path/}" ;;
          @loader_path*) candidate="${binary:h}/${rpath#@loader_path/}" ;;
          *) candidate="$rpath" ;;
        esac
        # System directories resolve from the dyld shared cache, so the file is
        # usually absent from disk even when dyld can load it.
        if [[ -e "$candidate/${dep#@rpath/}" || "$candidate" == /usr/lib* || "$candidate" == /System/Library/* ]]; then
          satisfied=1
          break
        fi
      done
      (( satisfied )) || {
        print -u2 "Unresolvable macOS dependency for $arch: $dep"
        print -u2 "No LC_RPATH in $binary provides it, so dyld would abort the launch (Library not loaded)."
        print -u2 "Repoint the link at a resolvable path (see src-tauri/build.rs) or ship the library inside the app bundle."
        exit 1
      }
    done
  done

  print -- "==> Verified KKTerm.app dependencies resolve on x86_64 and arm64"
}

pnpm exec tauri build --target universal-apple-darwin --bundles app,dmg "$@"

assert_resolvable_rpath_dependencies
