#!/usr/bin/env bash
set -euo pipefail
version=$(node -p "require('./package.json').version")
base="Unsocial-Network-$version-Linux-x64"
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
root="$stage/package"
mkdir -p "$root/opt" "$root/DEBIAN"
unzip -q "dist/$base.zip" -d "$root/opt"
chmod 0755 "$root/opt/unsocial-network/chrome-sandbox"
tar -C "$root/opt" -czf "dist/$base.tar.gz" unsocial-network
install -Dm0644 packaging/linux/unsocial-network.desktop "$root/usr/share/applications/unsocial-network.desktop"
install -Dm0644 website/assets/mark.svg "$root/usr/share/icons/hicolor/scalable/apps/unsocial-network.svg"
install -Dm0644 packaging/linux/unsocial-network.apparmor "$root/etc/apparmor.d/unsocial-network"
install -m0755 packaging/linux/postinst "$root/DEBIAN/postinst"
install -m0755 packaging/linux/prerm "$root/DEBIAN/prerm"
echo /etc/apparmor.d/unsocial-network > "$root/DEBIAN/conffiles"
cat > "$root/DEBIAN/control" <<EOF
Package: unsocial-network
Version: $version
Architecture: amd64
Maintainer: Unsocial Network <tech-decode-daily@users.noreply.github.com>
Section: net
Priority: optional
Depends: libgtk-3-0 | libgtk-3-0t64, libnss3, libasound2t64 | libasound2, libgbm1, libxss1, libx11-xcb1, libatk-bridge2.0-0 | libatk-bridge2.0-0t64, libcups2 | libcups2t64, libdrm2, libxkbcommon0, libsecret-1-0, libxdamage1, libxrandr2
Description: Invite-only desktop rooms for file sharing and chat
 Host a room on your computer, share invitations and exchange files.
EOF
dpkg-deb --build --root-owner-group -Zgzip -z4 "$root" "dist/$base.deb"
