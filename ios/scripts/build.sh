#!/usr/bin/env bash
# Build KC 311 for iPhone. Default is an unsigned compile check; --device
# signs for a real iPhone. Regenerates the project from project.yml first.
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
# Optional: a saved API config (key, city id, app version, device id) to
# bundle, so the first launch skips the key download. Without one, the app
# gets the key itself (KeyRefresher.swift).
CIVIC=${MYCIVIC_CONFIG:-Config/civic-config.json}
if [[ -f "$CIVIC" ]]; then
  python3 - "$CIVIC" KC311/Resources/CivicConfig.json <<'PY'
import json, sys
src = json.load(open(sys.argv[1]))
json.dump({k: src[k] for k in ("key", "city_id", "app_version", "device_uid") if k in src}, open(sys.argv[2], "w"))
PY
else
  rm -f KC311/Resources/CivicConfig.json
fi
[[ -f Config/Signing.xcconfig ]] || cp Config/Signing.xcconfig.example Config/Signing.xcconfig
xcodegen generate --quiet
if [[ "${1:-}" == "--device" ]]; then
  # Delete the built app so codesign re-runs with a fresh profile.
  rm -rf build/dd/Build/Products/Debug-iphoneos/KC311.app
  exec xcodebuild -project KC311.xcodeproj -scheme KC311 -quiet \
    -destination 'generic/platform=iOS' -derivedDataPath build/dd \
    -allowProvisioningUpdates CODE_SIGN_STYLE=Automatic build
fi
exec xcodebuild -project KC311.xcodeproj -scheme KC311 -quiet \
  -destination 'generic/platform=iOS' -derivedDataPath build/dd \
  CODE_SIGNING_ALLOWED=NO build
