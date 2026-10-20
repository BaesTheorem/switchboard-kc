#!/usr/bin/env bash
# Build a signed device copy of Switchboard KC and install it on the paired iPhone
# over the network. Not for apps on TestFlight: ship those with testflight.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
scripts/build.sh --device
APP=build/dd/Build/Products/Debug-iphoneos/KC311.app
# First paired iPhone that is reachable. The JSON output is used because the
# text table's columns shift with the device name and model.
if [[ -z "${1:-}" ]]; then
  J=$(mktemp)
  xcrun devicectl list devices --json-output "$J" >/dev/null 2>&1 || true
  UDID=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1]))['result']['devices']; print(next((x['identifier'] for x in d if x.get('hardwareProperties',{}).get('platform')=='iOS' and x.get('connectionProperties',{}).get('pairingState')=='paired' and x.get('connectionProperties',{}).get('tunnelState')!='unavailable'),''))" "$J")
  rm -f "$J"
else
  UDID=$1
fi
[[ -n "$UDID" ]] || { echo "no paired iPhone found"; exit 1; }
xcrun devicectl device install app --device "$UDID" "$APP"
BUNDLE=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP/Info.plist")
xcrun devicectl device process launch --device "$UDID" "$BUNDLE" || true
