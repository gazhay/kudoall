#!/bin/bash
# build.sh - Produces dist/chrome/ and dist/firefox/ from the single source tree.
# Also creates zip packages ready for store submission.
#
# Usage:
#   ./build.sh          # build both
#   ./build.sh chrome   # build Chrome only
#   ./build.sh firefox  # build Firefox only

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"

# All shared source files/directories to include in both builds
SHARED=(
  feed-interceptor.js
  kudoall.js
  virtualmap.js
  location.js
  virtualmap.css
  lib
  images
  maps
)

# Extension version (read from manifest for zip naming)
VERSION=$(jq -r '.version' "$SCRIPT_DIR/manifest.json")

build_chrome() {
  echo "==> Building Chrome extension..."
  local out="$DIST_DIR/chrome"
  rm -rf "$out"
  mkdir -p "$out"

  # Copy manifest as-is (already Chrome MV3 compatible)
  cp "$SCRIPT_DIR/manifest.json" "$out/manifest.json"

  # Copy shared files
  for item in "${SHARED[@]}"; do
    cp -r "$SCRIPT_DIR/$item" "$out/"
  done

  # Create zip for Chrome Web Store
  (cd "$out" && zip -r "$DIST_DIR/ladder-tools-chrome-v${VERSION}.zip" . -x ".*") > /dev/null
  echo "    Output: dist/chrome/"
  echo "    Package: dist/ladder-tools-chrome-v${VERSION}.zip"
}

build_firefox() {
  echo "==> Building Firefox extension..."
  local out="$DIST_DIR/firefox"
  rm -rf "$out"
  mkdir -p "$out"

  # Produce Firefox manifest: add browser_specific_settings.gecko
  jq '. + {
    "browser_specific_settings": {
      "gecko": {
        "id": "ladder-tools@strava-extension",
        "strict_min_version": "140.0",
        "data_collection_permissions": {
          "required": ["none"]
        }
      }
    }
  }' "$SCRIPT_DIR/manifest.json" > "$out/manifest.json"

  # Copy shared files
  for item in "${SHARED[@]}"; do
    cp -r "$SCRIPT_DIR/$item" "$out/"
  done

  # Create zip for Firefox Add-ons (AMO)
  (cd "$out" && zip -r "$DIST_DIR/ladder-tools-firefox-v${VERSION}.zip" . -x ".*") > /dev/null
  echo "    Output: dist/firefox/"
  echo "    Package: dist/ladder-tools-firefox-v${VERSION}.zip"
}

# Main
echo "Ladder Tools for Strava - Extension Builder (v${VERSION})"
echo "========================================================="

case "${1:-all}" in
  chrome)
    build_chrome
    ;;
  firefox)
    build_firefox
    ;;
  all|"")
    build_chrome
    build_firefox
    ;;
  *)
    echo "Usage: $0 [chrome|firefox|all]"
    exit 1
    ;;
esac

echo ""
echo "Done!"
