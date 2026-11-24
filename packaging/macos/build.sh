#!/usr/bin/env bash
set -euo pipefail
version=$(node -p "require('./package.json').version")
stage=$(mktemp -d "${TMPDIR:-/tmp}/unsocial-mac-XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
for arch in arm64 x64; do
  mkdir -p "$stage/$arch/root"
  ditto -x -k "dist/Unsocial-Network-$version-macOS-$arch.zip" "$stage/$arch/extracted"
  mv "$stage/$arch/extracted/Unsocial Network.app" "$stage/$arch/root/"
  pkgbuild --root "$stage/$arch/root" --install-location /Applications \
    --component-plist packaging/macos/component.plist --ownership recommended \
    --identifier "network.unsocial.desktop.$arch" --version "$version" "$stage/$arch.pkg"
done
productbuild --distribution packaging/macos/distribution.xml --package-path "$stage" \
  "dist/Unsocial-Network-$version-macOS.pkg"
