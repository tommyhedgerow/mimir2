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
SOURCE_APP="/Applications/SiYuan.app"

echo "Mimir build"
echo "  app:    $APP"
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
if [ -d "$VENDOR" ]; then
  echo "  SiYuan already vendored"
else
  if [ ! -d "$SOURCE_APP" ]; then
    echo "ERROR: no SiYuan at $SOURCE_APP." >&2
    echo "Install it (brew install --cask siyuan) or put a copy there." >&2
    exit 1
  fi
  echo "  vendoring SiYuan…"
  mkdir -p "$(dirname "$VENDOR")"
  # -R preserves the bundle; --no-traverse keeps it to one pass.
  cp -R "$SOURCE_APP" "$VENDOR"
fi

# 3. Record which SiYuan this build carries, so the source offered by CREDITS.md
#    and the binary shipped here can be checked against each other.
VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$VENDOR/Contents/Info.plist" 2>/dev/null || echo "unknown")
echo "$VERSION" > "$SHELL_DIR/siyuan-version.txt"
echo "  SiYuan version: $VERSION"

if [ "${1:-}" = "--stage-only" ]; then
  echo "staged. Run electron-builder to package."
  exit 0
fi

# 4. Package. Signing and notarization are configured in build/README.md.
cd "$SHELL_DIR"
echo "  packaging…"
npx --yes electron-builder@26.15.3 --config electron-builder.config.cjs "$@"
echo "done."
