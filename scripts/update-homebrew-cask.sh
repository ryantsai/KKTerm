#!/usr/bin/env zsh
set -euo pipefail

VERSION=""
SHA256=""
RELEASE_REPO="ryantsai/KKTerm"
TAP_REPO="${HOMEBREW_TAP_REPO:-ryantsai/homebrew-tap}"
DRY_RUN=0
CHECK_ACCESS=0

usage() {
  cat <<'USAGE'
Usage: scripts/update-homebrew-cask.sh --version <X.Y.Z> --sha256 <digest> [options]
       scripts/update-homebrew-cask.sh --check-access [--tap-repo <owner/repo>]

Update and publish the KKTerm cask in the Homebrew tap.

Options:
      --version <X.Y.Z>       Released KKTerm version.
      --sha256 <digest>       SHA-256 of the published universal macOS DMG.
      --release-repo <owner/repo>
                              GitHub repository containing the release.
      --tap-repo <owner/repo> Homebrew tap repository. Default: ryantsai/homebrew-tap.
      --dry-run               Print the generated cask without cloning or pushing.
      --check-access          Verify tap read access without cloning or pushing.
  -h, --help                  Show this help.

Set HOMEBREW_TAP_SSH_KEY_PATH to use a write-enabled SSH deploy key. Without
it, the script uses the current git credentials.
USAGE
}

die() {
  print -u2 -- "error: $*"
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found on PATH: $1"
}

write_cask() {
  local cask_path="$1"

  mkdir -p "${cask_path:h}"
  cat > "$cask_path" <<CASK
cask "kkterm" do
  version "$VERSION"
  sha256 "$SHA256"

  url "https://github.com/$RELEASE_REPO/releases/download/v#{version}/kkterm-#{version}-macos-universal.dmg"
  name "KKTerm"
  desc "Local-first administration workspace for terminals, SSH, and SFTP"
  homepage "https://github.com/$RELEASE_REPO"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on :macos

  app "KKTerm.app"

  zap trash: [
    "~/Library/Application Support/com.kkterm.app",
    "~/Library/Caches/com.kkterm.app",
    "~/Library/Preferences/com.kkterm.app.plist",
    "~/Library/Saved Application State/com.kkterm.app.savedState",
  ]
end
CASK
}

while (( $# > 0 )); do
  case "$1" in
    --version)
      (( $# >= 2 )) || die "$1 requires a value."
      VERSION="$2"
      shift 2
      ;;
    --sha256)
      (( $# >= 2 )) || die "$1 requires a value."
      SHA256="$2"
      shift 2
      ;;
    --release-repo)
      (( $# >= 2 )) || die "$1 requires a value."
      RELEASE_REPO="$2"
      shift 2
      ;;
    --tap-repo)
      (( $# >= 2 )) || die "$1 requires a value."
      TAP_REPO="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --check-access)
      CHECK_ACCESS=1
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

if (( CHECK_ACCESS )); then
  (( ! DRY_RUN )) || die "--check-access cannot be combined with --dry-run."
else
  [[ "$VERSION" =~ '^[0-9]+\.[0-9]+\.[0-9]+$' ]] || die "Expected --version <major>.<minor>.<build>."
  [[ "$SHA256" =~ '^[0-9a-f]{64}$' ]] || die "Expected --sha256 to be a lowercase 64-character digest."
fi
[[ "$RELEASE_REPO" =~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' ]] || die "Invalid --release-repo value: $RELEASE_REPO"
[[ "$TAP_REPO" =~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' ]] || die "Invalid --tap-repo value: $TAP_REPO"

if (( DRY_RUN )); then
  dry_run_dir=$(mktemp -d)
  trap 'rm -rf -- "$dry_run_dir"' EXIT
  write_cask "$dry_run_dir/kkterm.rb"
  cat "$dry_run_dir/kkterm.rb"
  exit 0
fi

require_command brew
require_command git

temporary_tap="kktermrelease${$}/tap"
tap_attempted=0
ssh_config_dir=""

cleanup_temporary_tap() {
  if (( tap_attempted )); then
    brew untap --force "$temporary_tap" >/dev/null 2>&1 || true
  fi
  if [[ -n "$ssh_config_dir" ]]; then
    rm -rf -- "$ssh_config_dir"
  fi
}

trap cleanup_temporary_tap EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ -n "${HOMEBREW_TAP_SSH_KEY_PATH:-}" ]]; then
  [[ -f "$HOMEBREW_TAP_SSH_KEY_PATH" ]] || die "HOMEBREW_TAP_SSH_KEY_PATH does not point to a file."
  require_command ssh
  chmod 600 "$HOMEBREW_TAP_SSH_KEY_PATH"
  # Homebrew filters GIT_SSH_COMMAND but preserves HOMEBREW_SSH_CONFIG_PATH.
  # Keep the config path free of spaces for Homebrew's ssh -F invocation; a
  # symlink lets IdentityFile safely reference any deploy-key filename.
  ssh_config_dir=$(mktemp -d /tmp/kkterm-homebrew-ssh.XXXXXX)
  ln -s "${HOMEBREW_TAP_SSH_KEY_PATH:A}" "$ssh_config_dir/identity"
  cat > "$ssh_config_dir/config" <<SSH_CONFIG
Host github.com
  IdentityFile "$ssh_config_dir/identity"
  IdentitiesOnly yes
  BatchMode yes
  StrictHostKeyChecking accept-new
SSH_CONFIG
  chmod 600 "$ssh_config_dir/config"
  export HOMEBREW_SSH_CONFIG_PATH="$ssh_config_dir/config"
  # Direct git commands (including push) do not go through Homebrew.
  export GIT_SSH_COMMAND="ssh -F $HOMEBREW_SSH_CONFIG_PATH"
  tap_url="git@github.com:$TAP_REPO.git"
else
  tap_url="https://github.com/$TAP_REPO.git"
fi

if (( CHECK_ACCESS )); then
  GIT_TERMINAL_PROMPT=0 git ls-remote "$tap_url" HEAD >/dev/null || die "Cannot read Homebrew tap $TAP_REPO with the selected git credentials."
  print -- "==> Homebrew tap read access verified for $TAP_REPO."
  exit 0
fi

tap_attempted=1
brew tap "$temporary_tap" "$tap_url"
tap_dir=$(brew --repository "$temporary_tap")

cask_path="$tap_dir/Casks/kkterm.rb"
write_cask "$cask_path"

brew style --cask "$cask_path"
brew audit --cask "$temporary_tap/kkterm"

git -C "$tap_dir" add Casks/kkterm.rb
if git -C "$tap_dir" diff --cached --quiet; then
  print -- "==> Homebrew cask already matches KKTerm $VERSION."
  exit 0
fi

git -C "$tap_dir" config user.name "github-actions[bot]"
git -C "$tap_dir" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git -C "$tap_dir" commit -m "kkterm $VERSION"
git -C "$tap_dir" push origin HEAD:main
print -- "==> Published KKTerm $VERSION to $TAP_REPO."
