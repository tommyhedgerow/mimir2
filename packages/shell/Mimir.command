#!/bin/bash
# Mimir.
#
# WHY THIS EXISTS. The application is ad-hoc signed: it has no Apple Developer
# ID, because that is a paid certificate belonging to whoever ships it. macOS 26
# refuses to launch an ad-hoc signed GUI application from Finder or the Dock —
# the process starts and is terminated before it can draw anything, with no
# error and no crash report. Launched from a terminal, the same application runs
# perfectly, because the terminal bypasses the check Finder applies.
#
# So this is the door. Double-click it. Once the application is signed with a
# real Developer ID it can be dragged to the Dock, and this file deleted.

APP="/Applications/Mimir.app"
BIN="$APP/Contents/MacOS/Mimir"
LOG="$HOME/Library/Logs/Mimir.log"

if [ ! -x "$BIN" ]; then
  echo "Mimir is not installed at $APP"
  echo "Open the disk image and drag Mimir to Applications first."
  echo
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

# Already running? Bring it forward rather than starting a second copy, which
# would want the same ports and the same workspace.
if pgrep -f "$BIN" >/dev/null 2>&1; then
  osascript -e 'tell application "System Events" to set frontmost of (first process whose name is "Mimir") to true' 2>/dev/null
  exit 0
fi

# Best effort: clear any quarantine and re-stamp the signature so macOS has
# nothing to complain about at launch.
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
codesign --force --deep --sign - "$APP" >/dev/null 2>&1

# ELECTRON_RUN_AS_NODE makes an Electron binary behave as plain Node — no
# window — so it must not be inherited from anything.
unset ELECTRON_RUN_AS_NODE

mkdir -p "$(dirname "$LOG")"

# Detached, with its output kept: launched in the foreground it would die with
# the Terminal window that the .command file opens.
nohup "$BIN" >> "$LOG" 2>&1 &
disown

exit 0
