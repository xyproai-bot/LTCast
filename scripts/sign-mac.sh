#!/usr/bin/env bash
# Ad-hoc codesign for Electron app — avoids "damaged" error on macOS 15
# Signs innermost components first, then works outward.
# Usage: sign-mac.sh <path/to/App.app>
set -euo pipefail

APP="$1"
ENTITLEMENTS="$(cd "$(dirname "$0")/.." && pwd)/resources/entitlements.mac.plist"

sign_target() {
  codesign --force --sign - --timestamp=none --options runtime --entitlements "$ENTITLEMENTS" "$1" 2>/dev/null || true
}

echo "[sign-mac] Signing: $APP"

# 1. Sign all .dylib files
while IFS= read -r f; do
  sign_target "$f"
done < <(find "$APP" -name "*.dylib")

# 2. Sign framework internal binaries (Versions/A/<Binary>)
while IFS= read -r fw; do
  bin_dir="$fw/Versions/A"
  if [ -d "$bin_dir" ]; then
    while IFS= read -r b; do
      sign_target "$b"
    done < <(find "$bin_dir" -maxdepth 1 -type f -perm +111)
  fi
done < <(find "$APP/Contents/Frameworks" -maxdepth 1 -name "*.framework")

# 3. Sign each framework bundle
while IFS= read -r fw; do
  sign_target "$fw"
done < <(find "$APP/Contents/Frameworks" -maxdepth 1 -name "*.framework")

# 4. Sign Helper apps (GPU, Plugin, Renderer, default)
while IFS= read -r helper; do
  sign_target "$helper"
done < <(find "$APP/Contents/Frameworks" -maxdepth 1 -name "*.app")

# 5. Sign main app bundle last
codesign --force --sign - --timestamp=none --options runtime --entitlements "$ENTITLEMENTS" "$APP"

echo "[sign-mac] Done. Verifying..."
codesign --verify --deep --strict "$APP" && echo "[sign-mac] Signature OK" || echo "[sign-mac] WARNING: verify failed (expected without Developer ID)"
