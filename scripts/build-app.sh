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

APP_BUNDLE="$APP/dist/app/mac-arm64/Mimir.app"

# 7. Verify the BUNDLE, not the source. The source can be perfect while the
#    packaged application cannot think.
if [ -d "$APP_BUNDLE" ]; then
  echo "  verifying the bundle…"
  fail=0
  for rel in \
    "Contents/Resources/siyuan/Contents/Resources/kernel/SiYuan-Kernel" \
    "Contents/Resources/app/profile/skills/mimir-teaching/SKILL.md" \
    "Contents/Resources/app/profile/node_modules/@deepseek-ai/dsh-sdk-client" \
    "Contents/Resources/app/packages/bridge/bin.mjs" \
    "Contents/Resources/app/siyuan-plugin/index.js"; do
    if [ ! -e "$APP_BUNDLE/$rel" ]; then
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
