#!/usr/bin/env bash
set -euo pipefail
mode=${1:---test-build}
case "$mode" in
  --release)
    : "${MAC_SIGNING_P12_BASE64:?Missing Apple Developer ID certificates}"
    : "${MAC_SIGNING_P12_PASSWORD:?Missing certificate export password}"
    : "${APPLE_TEAM_ID:?Missing Apple team ID}"
    : "${APPLE_ID:?Missing notarization Apple Account}"
    : "${APPLE_APP_PASSWORD:?Missing notarization app-specific password}"
    ;;
  --test-build) ;;
  *) echo "Expected --release or --test-build" >&2; exit 2 ;;
esac
version=$(node -p "require('./package.json').version")
stage=$(mktemp -d "${TMPDIR:-/tmp}/unsocial-mac-XXXXXX")
stage=$(cd "$stage" && pwd -P)
keychain="$stage/signing.keychain-db"
cleanup() {
  if [[ -f "$keychain" ]]; then security delete-keychain "$keychain" || true; fi
  rm -rf -- "$stage"
}
trap cleanup EXIT
identity=-
runtime_keychain=""
code_args=(--timestamp=none)
installer_args=()
if [[ "$mode" == --release ]]; then
  umask 077
  password=$(openssl rand -hex 32)
  security create-keychain -p "$password" "$keychain"
  security set-keychain-settings -lut 7200 "$keychain"
  security unlock-keychain -p "$password" "$keychain"
  printf '%s' "$MAC_SIGNING_P12_BASE64" | base64 -D > "$stage/identities.p12"
  security import "$stage/identities.p12" -k "$keychain" -P "$MAC_SIGNING_P12_PASSWORD" \
    -T /usr/bin/codesign -T /usr/bin/productbuild -T /usr/bin/productsign
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null
  rm -f -- "$stage/identities.p12"
  unset MAC_SIGNING_P12_BASE64 MAC_SIGNING_P12_PASSWORD password
  identities=$(security find-identity -v "$keychain")
  identity_for() {
    printf '%s\n' "$identities" | awk -F '"' -v prefix="Developer ID $1: " -v team=" ($APPLE_TEAM_ID)" \
      'index($2, prefix) == 1 && substr($2, length($2)-length(team)+1) == team { name=$2; n++ }
       END { if (n != 1) exit 1; print name }'
  }
  identity=$(identity_for Application) || { echo "Expected one Developer ID Application identity for this team" >&2; exit 1; }
  installer=$(identity_for Installer) || { echo "Expected one Developer ID Installer identity for this team" >&2; exit 1; }
  runtime_keychain="$keychain"
  code_args=(--keychain "$keychain" --timestamp --options runtime)
  installer_args=(--keychain "$keychain" --sign "$installer" --timestamp)
  xcrun notarytool store-credentials release --keychain "$keychain" --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD"
  unset APPLE_APP_PASSWORD
  # Packaging tools and installed app files must use normal readable permissions.
  umask 022
fi
for arch in arm64 x64; do
  mkdir -p "$stage/$arch/root"
  ditto -x -k "dist/Unsocial-Network-$version-macOS-$arch.zip" "$stage/$arch/extracted"
  mv "$stage/$arch/extracted/Unsocial Network.app" "$stage/$arch/root/"
  app="$stage/$arch/root/Unsocial Network.app"
  node packaging/macos/sign-runtime.mjs "$app/Contents/Frameworks/Electron.app" "$identity" "$runtime_keychain"
  codesign --force --sign "$identity" "${code_args[@]}" "$app/Contents/Resources/app/bin/unsocial-room"
  codesign --force --sign "$identity" "${code_args[@]}" "$app"
  codesign --verify --deep --strict "$app"
  pkgbuild --root "$stage/$arch/root" --install-location /Applications \
    --component-plist packaging/macos/component.plist --ownership recommended \
    --identifier "network.unsocial.desktop.$arch" --version "$version" "$stage/$arch.pkg"
done
pkg="$stage/Unsocial-Network-$version-macOS.pkg"
productbuild --distribution packaging/macos/distribution.xml --package-path "$stage" \
  ${installer_args[@]+"${installer_args[@]}"} "$pkg"
if [[ "$mode" == --release ]]; then
  pkgutil --check-signature "$pkg"
  xcrun notarytool submit "$pkg" --keychain-profile release --keychain "$keychain" \
    --wait --timeout 45m --output-format json > "$stage/notary.json"
  node -e 'const r = require(process.argv[1]); console.log("Apple notarization", r.id, r.status); if (r.status !== "Accepted") process.exit(1)' "$stage/notary.json"
  xcrun stapler staple "$pkg"
  xcrun stapler validate "$pkg"
  spctl --assess --type install --verbose=2 "$pkg"
fi
mv "$pkg" "dist/Unsocial-Network-$version-macOS.pkg"
