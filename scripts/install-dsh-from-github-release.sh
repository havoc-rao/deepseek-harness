#!/usr/bin/env bash
# Install the dsh CLI on this machine from a GitHub Release of the harness.
#
# The dsh family publishes to a restricted @deepseek-ai scope on npmjs, which a
# fork cannot republish, so this repo ships the packed tarballs as GitHub
# Release assets (see .github/workflows/release-github-assets.yml). This script
# downloads every *.tgz from a release and installs them into an isolated
# consumer directory with plain npm -- exactly what
# scripts/release/verify-packed-install.ts does in CI. npm resolves the
# workspace-internal dependencies from the local tarballs, so no npm registry
# account is needed; only the few external dependencies (commander, js-yaml,
# yaml) come from the public registry.
#
# Usage:
#   curl -fsSL <raw install script URL> | bash -s -- [options]
#   bash scripts/install-dsh-from-github-release.sh [options]
#
# Options:
#   --repo <owner/repo>   GitHub repo hosting the release (default: the value
#                         of DSH_REPO, or this repo's origin when run from a
#                         checkout).
#   --tag <dsh-vX.Y.Z>    Release tag to install (default: latest release).
#   --prefix <dir>        Directory to install into (default: $HOME/.dsh,
#                         overridable with DSH_PREFIX).
#   --bin-dir <dir>       Where to symlink the `dsh` executable (default:
#                         $HOME/.local/bin, overridable with DSH_BIN_DIR).
#   --skip-verify         Do not run `dsh --version` after installing.
#
# Exit codes: 0 success; 1 any failure (downloaded tarballs are left in the
# prefix's .tarballs directory for inspection/retry).

set -euo pipefail

# ---- defaults ---------------------------------------------------------------

DSH_REPO="${DSH_REPO:-}"
PREFIX="${DSH_PREFIX:-$HOME/.dsh}"
BIN_DIR="${DSH_BIN_DIR:-$HOME/.local/bin}"
TAG=""
SKIP_VERIFY=0

# ---- arg parsing ------------------------------------------------------------

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) DSH_REPO="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --bin-dir) BIN_DIR="$2"; shift 2 ;;
    --skip-verify) SKIP_VERIFY=1; shift ;;
    -h|--help)
      sed -n '2,40p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "unknown option: $1" >&2; sed -n '2,40p' "$0" >&2; exit 1 ;;
  esac
done

# ---- prerequisites ----------------------------------------------------------

for cmd in curl jq tar npm node; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "missing required command: $cmd" >&2; exit 1; }
done

if ! node -e 'process.exit(process.versions.node >= "22.19.0" ? 0 : 1)' 2>/dev/null; then
  echo "node ^22.19 or newer is required" >&2
  exit 1
fi

# ---- resolve repo -----------------------------------------------------------

if [ -z "$DSH_REPO" ]; then
  if remote="$(git -C "$(dirname "$0")" config --get remote.origin.url 2>/dev/null || true)"; then
    case "$remote" in
      git@github.com:*) DSH_REPO="${remote#git@github.com:}" ;;
      https://github.com/*) DSH_REPO="${remote#https://github.com/}" ;;
    esac
    DSH_REPO="${DSH_REPO%.git}"
  fi
fi
if [ -z "$DSH_REPO" ]; then
  echo "--repo <owner/repo> is required (or run from a checkout with an origin)" >&2
  exit 1
fi

API="https://api.github.com/repos/$DSH_REPO/releases"
# Direct download base that does not route through the API or the raw domain:
# reachable even where api.github.com / raw.githubusercontent.com are blocked.
DOWNLOAD_BASE="https://github.com/$DSH_REPO/releases/download"

# ---- resolve tag ------------------------------------------------------------

if [ -z "$TAG" ]; then
  TAG="$(curl -fsSL "$API/latest" 2>/dev/null | jq -r '.tag_name // empty')"
fi
if [ -z "$TAG" ]; then
  echo "could not resolve a release tag; pass --tag dsh-v<version>" >&2
  exit 1
fi
echo "Installing dsh from $DSH_REPO @ $TAG"

# ---- resolve asset list -----------------------------------------------------

TARBALL_DIR="$PREFIX/.tarballs/$TAG"
mkdir -p "$TARBALL_DIR"

# Asset names come from the release's own tarballs.txt manifest (uploaded by the
# release workflow), fetched through the direct download base so the API is not
# required. The API path is a fallback for releases that predate the manifest.
declare -a assets=()
manifest="$TARBALL_DIR/tarballs.txt"
if [ ! -f "$manifest" ] \
  && ! curl -fsSL -o "$manifest" "$DOWNLOAD_BASE/$TAG/tarballs.txt" 2>/dev/null; then
  while IFS= read -r name; do
    [ -n "$name" ] && assets+=("$name")
  done < <(curl -fsSL "$API/tags/$TAG" 2>/dev/null | jq -r \
    '.assets[] | select(.name | endswith(".tgz")) | .name')
fi
if [ -f "$manifest" ]; then
  while IFS= read -r name; do
    [ -n "$name" ] && assets+=("$name")
  done < "$manifest"
fi

if [ "${#assets[@]}" -eq 0 ]; then
  echo "release $TAG has no .tgz assets" >&2
  exit 1
fi

declare -a downloaded=()
for name in "${assets[@]}"; do
  if [ ! -f "$TARBALL_DIR/$name" ]; then
    echo "  downloading $name"
    curl -fsSL -o "$TARBALL_DIR/$name" "$DOWNLOAD_BASE/$TAG/$name"
  fi
  downloaded+=("$TARBALL_DIR/$name")
done

# ---- build a consumer package.json listing every tarball --------------------

CONSUMER="$PREFIX/releases/$TAG"
mkdir -p "$CONSUMER"
{
  echo '{'
  echo '  "name": "dsh-github-release-consumer",'
  echo '  "private": true,'
  echo '  "dependencies": {'
  first=1
  for tarball in "${downloaded[@]}"; do
    # npm keys the dependency by the name the tarball declares; read it from the
    # packed manifest exactly like tarball.ts does.
    name="$(tar -xOzf "$tarball" package/package.json | jq -r '.name')"
    [ $first -eq 1 ] || echo '    ,'
    first=0
    printf '    "%s": "file:%s"' "$name" "$tarball"
  done
  echo
  echo '  }'
  echo '}'
} > "$CONSUMER/package.json"

# ---- install ----------------------------------------------------------------

echo "Installing ${#downloaded[@]} tarball(s) into $CONSUMER"
# Optional dependencies are omitted: the Landlock platform packages need a musl
# toolchain and one build per architecture (mirrors verify-packed-install.ts).
npm install --prefix "$CONSUMER" --no-audit --no-fund --package-lock=false --omit=optional

# ---- expose on PATH ---------------------------------------------------------

mkdir -p "$BIN_DIR"
ln -sf "$CONSUMER/node_modules/.bin/dsh" "$BIN_DIR/dsh"
echo "Linked dsh -> $BIN_DIR/dsh (add $BIN_DIR to your PATH if needed)"

# ---- verify ---------------------------------------------------------------

if [ "$SKIP_VERIFY" -eq 1 ]; then
  exit 0
fi
node "$CONSUMER/node_modules/@deepseek-ai/dsh/lib/bin.js" --version
