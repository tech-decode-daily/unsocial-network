# Unsocial Network

Unsocial Network is a desktop file exchange with invite-only rooms, presence and chat. Both participants install the client. One creates a room, copies its invitation and shares it privately. The other selects **Join room** and pastes it. Select or drop files, then choose **Download** on the receiving desktop. **Transfers** shows progress and verification. **Show in folder** opens the saved file's location.

## Desktop downloads

Choose Windows, macOS or Linux on the download page. The desktop client includes its runtime and room service. [Download Unsocial Network](https://tech-decode-daily.github.io/unsocial-network/)

For an offline copy of the page, `npm run build:site` uses the release files and checksum manifest in `dist` and writes `build/download-site/index.html`.

| System | Download | How to open the app |
| --- | --- | --- |
| Windows x64 | Setup EXE | Run the installer, choose Install, then open Unsocial Network from Start. Setup installs for your Windows account. You can uninstall it from Installed apps. |
| macOS (Apple Silicon and Intel) | Mac PKG | Double-click the package and follow Installer. It selects your Mac’s chip automatically. Open Unsocial Network from Applications. |
| Ubuntu / Debian x64 | DEB | Open the package in Software Install and choose Install. Launch Unsocial Network from the app menu. Ubuntu's AppArmor profile is included. |
| Other Linux x64 | Portable TAR.GZ | Extract the folder to a path without spaces and run `./unsocial-network` inside it. Requires a graphical desktop, Chromium's system libraries and working sandbox support. |

These are unsigned release candidates. Windows may show a publisher warning and macOS may block the installer until Developer ID signing and notarization are in place. SHA-256 checksums accompany the downloads.

## Hosting and recovery

By default a room runs on its creator's desktop for 24 hours from creation. Participants need a network route to the address in the invitation. Allow the room host through the firewall on the intended private network. An invitation contains its access secret and, for a desktop host, the host's public CA certificate. Anyone who obtains it can join. The host can read shared content.

Keep the hosting app running. Its directory button closes the room view while the host service continues. A host restart on the same network address and saved port restores unexpired rooms and files. A standalone HTTPS server supports internet rooms and operates independently of the creator. See DEPLOYMENT.md in the source tree. No hosted service subscription is included.

Downloads go to the Unsocial Network subfolder of Downloads by default. Settings lets you choose a different folder and change transfer concurrency. The final publication step requires a filesystem supporting hard links. Retry uses the server's confirmed upload offset or the local partial download. A source file must remain available and unchanged. Credentials and queue metadata use the OS credential service when available. Memory-only sessions show their storage status in Settings.

## Development

Use Node.js 24 LTS and the Go version in `server/go.mod`. Run `npm ci`, `npm run build:server` and `npm start` from the project root. Run `npm test` for service and transfer checks and `npm run test:desktop` for desktop integration. Build a portable archive with `npm run package -- win32 x64`, `npm run package -- linux x64`, `npm run package -- darwin arm64` or `npm run package -- darwin x64`. Builds verify the Electron runtime archive against the checksums in the locked Electron package.

The native packaging scripts consume those intermediate builds. On Windows, run `packaging/windows/build.ps1` with Inno Setup 6.3 or newer available. On macOS, build both Mac architectures, then run `bash packaging/macos/build.sh` to create the single PKG. On a Debian-based build machine, run `bash packaging/linux/build.sh` after building Linux x64. Public installers are tested in the desktop release workflow.

