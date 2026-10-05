#!/bin/bash
# Mimir.
#
# WHY THIS EXISTS. The application is ad-hoc signed: it has no Apple Developer
# ID, because that is a paid certificate belonging to whoever ships it. macOS 26
# refuses to launch an ad-hoc signed GUI application from Finder or the Dock —
# the process starts and is terminated before it can draw anything, with no
# error and no crash report. Launched from a terminal, the same application runs
# perfectly, because the terminal bypasses the check that Finder applies.
#
# So this is the door. Double-click it. Once the app is signed with a real
# Developer ID, it can be dragged to the Dock and this file can be deleted.
#
# The flags are there to stop macOS from quarantining the bundle, which would
# stop it launching even from here.

APP="/Applications/Mimir.app"
BIN="$APP/Contents/MacOS/Mimir"

if [ ! -x "$BIN" ]; then
  echo "Mimir is not installed at $APP"
  echo "Install it by opening the disk image and dragging Mimir to Applications."
  echo
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

# Best effort: clear any quarantine and re-stamp the signature so macOS has
# nothing to complain about at launch.
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
codesign --force --deep --sign - "$APP" >/dev/null 2>&1

# ELECTRON_RUN_AS_NODE makes an Electron binary behave as plain Node — no
# window — so it must not be inherited from anything.
unset ELECTRON_RUN_AS_NODE

exec "$BIN"
