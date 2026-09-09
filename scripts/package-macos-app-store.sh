#!/usr/bin/env zsh
set -euo pipefail

# Intentionally separate from package-macos.sh and its updater signing keys.
cd "${0:A:h:h}"
if [[ "$(uname -s)" != Darwin ]]; then
  print -u2 "Mac App Store packaging requires macOS."
  exit 1
fi
if [[ -z "${APPLE_SIGNING_IDENTITY:-}" || -z "${KKTERM_APP_STORE_PROVISION_PROFILE:-}" ]]; then
  print -u2 "Set APPLE_SIGNING_IDENTITY and KKTERM_APP_STORE_PROVISION_PROFILE for the App Store build."
  exit 1
fi
if [[ ! -f "$KKTERM_APP_STORE_PROVISION_PROFILE" ]]; then
  print -u2 "The App Store provisioning profile does not exist."
  exit 1
fi

STORE_CONFIG_DIR=$(mktemp -d "$PWD/src-tauri/.appstore-signing.XXXXXX")
STORE_CONFIG="$STORE_CONFIG_DIR/signing.json"
trap 'rm -f "$STORE_CONFIG"; rmdir "$STORE_CONFIG_DIR"' EXIT
python3 - "$STORE_CONFIG" "$KKTERM_APP_STORE_PROVISION_PROFILE" <<'PY'
import json, pathlib, sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({"bundle": {"macOS": {"files": {
    "embedded.provisionprofile": str(pathlib.Path(sys.argv[2]).resolve())
}}}}))
PY

npm exec tauri -- build --target universal-apple-darwin --bundles app \
  --config src-tauri/tauri.appstore.conf.json --config "$STORE_CONFIG"

STORE_APP="$PWD/src-tauri/target/universal-apple-darwin/release/bundle/macos/KKTerm.app"
python3 scripts/verify-macos-app-store.py "$STORE_APP"
