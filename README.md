# Unsocial Network

Unsocial Network is a desktop file exchange with invite-only rooms, presence and chat. Both participants install the client. One creates a room, copies its invitation and shares it privately. The other selects **Join room** and pastes it. Select or drop files, then choose **Download** on the receiving desktop. **Transfers** shows progress and verification. **Show in folder** opens the saved file's location.

## Desktop downloads

Choose Windows, macOS or Linux on the download page. Extract the entire archive before launching. The desktop client includes its runtime and room service. [Download Unsocial Network](https://tech-decode-daily.github.io/unsocial-network/)

For an offline copy of the page, `npm run build:site` uses the portable archives in `dist` and writes `build/download-site/index.html`.

| System | Archive suffix | Launch |
| --- | --- | --- |
| Windows x64 | `Windows-x64.zip` | Open `Unsocial Network.exe` from the extracted folder |
| Linux x64 | `Linux-x64.zip` | Extract into a path without spaces and run `./unsocial-network` in the extracted folder. Requires a graphical session, Chromium's system libraries and sandbox support. See the Ubuntu setup below |
| macOS Apple Silicon | `macOS-arm64.zip` | Extract the app bundle with Archive Utility and move it to Applications |
| macOS Intel | `macOS-x64.zip` | Use the Intel app bundle on an Intel Mac |

Compare the archive's SHA-256 with its adjacent checksum. The candidate archives have no Unsocial Network publisher signature. A public macOS release needs Developer ID signing and notarization. A public Windows release needs publisher signing. See TEST_REPORT.md in the source tree for the exact verification status.

### Ubuntu 24.04 and newer

Ubuntu restricts unprivileged user namespaces. The archive includes an AppArmor profile scoped to the executable installed at `/opt/unsocial-network/unsocial-network`. After verifying the ZIP checksum, run these commands from the download directory on a machine you administer. For an upgrade, close the running app first.

```sh
sudo unzip -o Unsocial-Network-0.1.1-Linux-x64.zip -d /opt
sudo chmod 0755 /opt/unsocial-network/chrome-sandbox
sudo install -m 0644 /opt/unsocial-network/unsocial-network.apparmor /etc/apparmor.d/unsocial-network
sudo apparmor_parser -r /etc/apparmor.d/unsocial-network
/opt/unsocial-network/unsocial-network
```

Launch the final command as your regular desktop user. The profile permits Chromium to create its sandbox. [Ubuntu release notes](https://documentation.ubuntu.com/release-notes/24.04/)

## Hosting and recovery

By default a room runs on its creator's desktop for 24 hours from creation. Participants need a network route to the address in the invitation. Allow the room host through the firewall on the intended private network. An invitation contains its access secret and, for a desktop host, the host's public CA certificate. Anyone who obtains it can join. The host can read shared content.

Keep the hosting app running. Its directory button closes the room view while the host service continues. A host restart on the same network address and saved port restores unexpired rooms and files. A standalone HTTPS server supports internet rooms and operates independently of the creator. See DEPLOYMENT.md in the source tree. No hosted service subscription is included.

Downloads go to the Unsocial Network subfolder of Downloads by default. Settings lets you choose a different folder and change transfer concurrency. The final publication step requires a filesystem supporting hard links. Retry uses the server's confirmed upload offset or the local partial download. A source file must remain available and unchanged. Credentials and queue metadata use the OS credential service when available. Memory-only sessions show their storage status in Settings.

## Development

Use Node.js 24 LTS and the Go version in `server/go.mod`. Run `npm ci`, `npm run build:server` and `npm start` from the project root. Run `npm test` for service and transfer checks and `npm run test:desktop` for desktop integration. Build a portable archive with `npm run package -- win32 x64`, `npm run package -- linux x64`, `npm run package -- darwin arm64` or `npm run package -- darwin x64`. Builds verify the Electron runtime archive against the checksums in the locked Electron package.

