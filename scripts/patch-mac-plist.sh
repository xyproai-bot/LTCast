#!/usr/bin/env bash
# Patch Info.plist and icon after electron-builder packages the app.
# Workaround for electron-builder 25.x not updating these values on macOS.
set -euo pipefail

APP="$1"
PLIST="$APP/Contents/Info.plist"
RESOURCES_DIR="$(cd "$(dirname "$0")/.." && pwd)/resources"

echo "[patch-plist] Patching: $PLIST"

# Fix app identity
plutil -replace CFBundleIdentifier   -string "com.ltcast.app"  "$PLIST"
plutil -replace CFBundleDisplayName  -string "LTCast"          "$PLIST"
plutil -replace CFBundleName         -string "LTCast"          "$PLIST"

# Fix icon
ICNS_SRC="$RESOURCES_DIR/icon.icns"
ICNS_DST="$APP/Contents/Resources/icon.icns"
if [ -f "$ICNS_SRC" ]; then
  cp "$ICNS_SRC" "$ICNS_DST"
  plutil -replace CFBundleIconFile -string "icon.icns" "$PLIST"
  # Remove old electron.icns if still present
  [ -f "$APP/Contents/Resources/electron.icns" ] && rm "$APP/Contents/Resources/electron.icns"
  echo "[patch-plist] Icon installed: icon.icns"
fi

echo "[patch-plist] Done."
