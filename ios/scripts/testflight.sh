#!/usr/bin/env bash
# Archive a Release build of Switchboard KC and upload it to App Store Connect for
# TestFlight. The bundled config carries only the key, city id, and app
# version: never a device id, so each tester's install makes its own and
# sees only its own reports. Needs the app record to exist in App Store
# Connect (bundle id $(BUNDLE_ID_PREFIX).kc311) and Xcode signed in to the team.
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
CIVIC=${MYCIVIC_CONFIG:-Config/civic-config.json}
if [[ -f "$CIVIC" ]]; then
  python3 - "$CIVIC" KC311/Resources/CivicConfig.json <<'PY'
import json, sys
src = json.load(open(sys.argv[1]))
json.dump({k: src[k] for k in ("key", "city_id", "app_version") if k in src}, open(sys.argv[2], "w"))
PY
else
  rm -f KC311/Resources/CivicConfig.json
fi
[[ -f Config/Signing.xcconfig ]] || cp Config/Signing.xcconfig.example Config/Signing.xcconfig
TEAM=$(sed -n 's/^DEVELOPMENT_TEAM *= *//p' Config/Signing.xcconfig)
# Fresh bundled data (HRSA health centers); keep the old copy if the download fails.
python3 scripts/refresh-data.py || echo "refresh-data failed; using the bundled copy"
BUILD=$(date +%Y%m%d%H%M)
xcodegen generate --quiet
rm -rf build/archive
xcodebuild -project KC311.xcodeproj -scheme KC311 -configuration Release -quiet \
  -destination 'generic/platform=iOS' -archivePath build/archive/KC311.xcarchive \
  -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$BUILD" archive
cat > build/archive/ExportOptions.plist <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PL
xcodebuild -exportArchive -archivePath build/archive/KC311.xcarchive \
  -exportOptionsPlist build/archive/ExportOptions.plist -exportPath build/archive/export \
  -allowProvisioningUpdates
echo "Uploaded build $BUILD. It shows in App Store Connect > TestFlight after processing."
