#!/usr/bin/env bash
# Builds the Mimir application.
#
#   node app/scripts/build-app.mjs            # stage resources and package
#   node app/scripts/build-app.mjs --stage-only
#
# Vendors the SiYuan application into app/packages/shell/vendor/siyuan, which is
# ~260 MB and is not committed — `.gitignore` excludes it. Then runs
# electron-builder against app/packages/shell/electron-builder.config.cjs.
#
# SiYuan is copied, never modified. See CREDITS.md for what that means.
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
SHELL_DIR="$APP/packages/shell"
VENDOR="$SHELL_DIR/vendor/siyuan"
# Where SiYuan is already installed, for building on this machine.
SOURCE_APP="/Applications/SiYuan.app"

# ---------------------------------------------------------------------------
# Which platform this build is for.
#
# The vendored kernel is a native binary, so a build carries the one for its own
# platform and no other. The distributions differ in shape, which is why this
# matters beyond the file name:
#
#   macOS    SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel
#   Windows  resources/kernel/SiYuan-Kernel.exe
#   Linux    resources/kernel/SiYuan-Kernel
#
# The host decides by default; MIMIR_TARGET overrides it, so a Windows or Linux
# build can be *staged* from a Mac and then packaged where it can be tested.
# ---------------------------------------------------------------------------
HOST="$(uname -s)"
case "$HOST" in
  Darwin) HOST_TARGET="mac" ;;
  Linux)  HOST_TARGET="linux" ;;
  MINGW*|MSYS*|CYGWIN*) HOST_TARGET="win" ;;
  *)      HOST_TARGET="unknown" ;;
esac
TARGET="${MIMIR_TARGET:-$HOST_TARGET}"

case "$TARGET" in
  mac)   KERNEL_REL="Contents/Resources/kernel/SiYuan-Kernel" ;;
  win)   KERNEL_REL="resources/kernel/SiYuan-Kernel.exe" ;;
  linux) KERNEL_REL="resources/kernel/SiYuan-Kernel" ;;
  *)     echo "ERROR: cannot tell which platform to build for ($HOST). Set MIMIR_TARGET=mac|win|linux." >&2; exit 1 ;;
esac

echo "Mimir build"
echo "  app:    $APP"
echo "  target: $TARGET (host: $HOST)"
echo "  vendor: $VENDOR"

# 1. The harness profile must be installed and self-contained.
if [ ! -d "$APP/profile/node_modules" ]; then
  echo "  installing the harness profile…"
  (cd "$APP/profile" && pnpm install --ignore-workspace)
fi
if [ ! -d "$APP/profile/skills/mimir-teaching" ]; then
  echo "ERROR: the profile carries no skills — the teacher would have no method." >&2
  exit 1
fi

# 2. Vendor SiYuan if it is not already there.
#
# A cross-platform build cannot copy a local installation, because the local one
# is the wrong platform — so for anything but the host, the published distribution
# is fetched and unpacked. The archives are large (a quarter of a gigabyte) and
# are cached under app/.cache so a second build does not fetch them again.
SIYUAN_VERSION="${SIYUAN_VERSION:-3.8.6}"
CACHE="$APP/.cache"

vendor_from_download() {
  local name="$1" url archive tmp
  case "$TARGET" in
    linux) name="siyuan-${SIYUAN_VERSION}-linux" ;;
    win)   name="siyuan-${SIYUAN_VERSION}-win" ;;
    mac)   name="siyuan-${SIYUAN_VERSION}-mac" ;;
  esac
  case "$TARGET" in
    linux) archive="siyuan-${SIYUAN_VERSION}-linux.tar.gz" ;;
    win)   archive="siyuan-${SIYUAN_VERSION}-win.zip" ;;
    mac)   archive="siyuan-${SIYUAN_VERSION}-mac.zip" ;;
  esac
  url="https://github.com/siyuan-note/siyuan/releases/download/v${SIYUAN_VERSION}/${archive}"

  mkdir -p "$CACHE"
  if [ ! -f "$CACHE/$archive" ]; then
    echo "  fetching $archive (this is a large download, once)…"
    curl -sL --fail --max-time 1800 -o "$CACHE/$archive" "$url"
  else
    echo "  using the cached $archive"
  fi

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  case "$archive" in
    *.tar.gz) tar xzf "$CACHE/$archive" -C "$tmp" ;;
    *.zip)    (cd "$tmp" && unzip -q "$CACHE/$archive") ;;
  esac

  local root
  root="$(find "$tmp" -maxdepth 1 -mindepth 1 -type d | head -1)"
  if [ -z "$root" ]; then
    echo "ERROR: $archive did not unpack to a directory" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$VENDOR")"
  mv "$root" "$VENDOR"
}

if [ -d "$VENDOR" ]; then
  if [ ! -e "$VENDOR/$KERNEL_REL" ]; then
    echo "ERROR: $VENDOR is vendored but carries no kernel at $KERNEL_REL." >&2
    echo "That is a vendor directory for a different platform. Remove it and build again." >&2
    exit 1
  fi
  echo "  SiYuan already vendored"
elif [ "$TARGET" = "$HOST_TARGET" ] && [ "$TARGET" = "mac" ] && [ -d "$SOURCE_APP" ]; then
  echo "  vendoring SiYuan from $SOURCE_APP…"
  mkdir -p "$(dirname "$VENDOR")"
  # -R preserves the bundle; --no-traverse keeps it to one pass.
  cp -R "$SOURCE_APP" "$VENDOR"
else
  vendor_from_download
fi

# 2b. The diagram engine, from the vendored SiYuan into the reader.
#     Without this, every mermaid diagram in every note is shown as its own source.
echo "  diagram engine…"
"${NODE_BIN:-node}" "$APP/scripts/sync-mermaid.mjs"

# 3. Record which SiYuan this build carries, so the source offered by CREDITS.md
#    and the binary shipped here can be checked against each other.
# From the bundle's plist on macOS, and from the release being built otherwise —
# `/usr/libexec/PlistBuddy` is a macOS tool and would report "unknown" elsewhere.
VERSION=""
if [ -f "$VENDOR/Contents/Info.plist" ]; then
  VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$VENDOR/Contents/Info.plist" 2>/dev/null || true)
fi
[ -n "$VERSION" ] || VERSION="$SIYUAN_VERSION"
echo "$VERSION" > "$SHELL_DIR/siyuan-version.txt"
echo "  SiYuan version: $VERSION"

if [ "${1:-}" = "--stage-only" ]; then
  echo "staged. Run electron-builder to package."
  exit 0
fi

# 4. Every resource the configuration names must exist, or electron-builder
#    logs a line and ships an application with holes in it. It did exactly that
#    once: three `file source doesn't exist` lines scrolled past inside a long
#    build, and the result launched to "no SiYuan kernel found".
echo "  checking the resources the configuration names…"
missing=0
for rel in "../../packages/bridge" "../../profile" "../../siyuan-plugin" "vendor/siyuan"; do
  if [ ! -e "$SHELL_DIR/$rel" ]; then
    echo "    MISSING $rel" >&2
    missing=1
  fi
done
if [ "$missing" = "1" ]; then
  echo "ERROR: electron-builder would ship an application with those missing." >&2
  exit 1
fi
echo "    all present"

# The bridge deliberately carries no dependency tree: it resolves the harness SDK
# from the profile, which ships anyway. If that resolution fails inside the
# staged profile, the application builds cleanly and then cannot start its
# runtime -- which is exactly what happened the first time this was packaged.
echo "  checking the bridge can resolve its harness dependency (in the source)…"
if ! "/usr/bin/env" node -e "
const { createRequire } = require('node:module')
const req = createRequire('$APP/profile/package.json')
req.resolve('@deepseek-ai/dsh-sdk-client')
" 2>/dev/null; then
  echo "    the bridge cannot resolve @deepseek-ai/dsh-sdk-client from the profile" >&2
  echo "    run: cd app/profile && pnpm install --ignore-workspace" >&2
  exit 1
fi
echo "    resolves"

# 5. Package. Signing and notarization are configured in build/README.md.
cd "$SHELL_DIR"
echo "  packaging…"
NODE_BIN="${NODE_BIN:-node}"
ELECTRON_BUILDER="$SHELL_DIR/node_modules/electron-builder/cli.js"
if [ ! -f "$ELECTRON_BUILDER" ]; then
  echo "ERROR: electron-builder is not installed. Run: pnpm add -D --filter @mimir/shell electron-builder" >&2
  exit 1
fi
# `npx` and the pnpm shim both mis-forward arguments here (the CLI path arrives
# as an argument and the run prints help instead), so the CLI is called directly.
env -u ELECTRON_RUN_AS_NODE "$NODE_BIN" "$ELECTRON_BUILDER" --config electron-builder.config.cjs "$@"

# 7. Verify the BUNDLE, not the source. The source can be perfect while the
#    packaged application cannot think.
#
# Where the resources sit differs by platform, so the check is written per target
# rather than assuming a bundle. A Mac check run against a Windows build would
# report every resource missing, which is worse than not checking.
case "$TARGET" in
  mac)
    APP_BUNDLE="$APP/dist/app/mac-arm64/Mimir.app"
    RES="$APP_BUNDLE/Contents/Resources"
    ;;
  win)
    APP_BUNDLE="$APP/dist/app/win-unpacked/Mimir.exe"
    RES="$APP/dist/app/win-unpacked/resources"
    ;;
  linux)
    APP_BUNDLE="$APP/dist/app/linux-unpacked/mimir"
    RES="$APP/dist/app/linux-unpacked/resources"
    ;;
esac

if [ -e "$APP_BUNDLE" ]; then
  echo "  verifying the bundle…"
  fail=0
  for rel in \
    "siyuan/$KERNEL_REL" \
    "app/profile/skills/mimir-teaching/SKILL.md" \
    "app/profile/node_modules/@deepseek-ai/dsh-sdk-client" \
    "app/packages/bridge/bin.mjs" \
    "app/siyuan-plugin/index.js"; do
    if [ ! -e "$RES/$rel" ]; then
      echo "    MISSING $rel" >&2
      fail=1
    fi
  done
  if [ "$fail" = "1" ]; then
    echo "ERROR: the bundle is incomplete — it would launch and be unable to think." >&2
    exit 1
  fi
  echo "    bundle complete"
fi
echo "done."
