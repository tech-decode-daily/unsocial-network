# Desktop and standalone deployment

## Local rooms

Install the desktop download for your operating system and follow README.md. No additional service is required for a reachable LAN. On a private network the bundled host uses its own CA, scoped to invitations. Opening its raw IP address in a browser normally produces an untrusted-issuer warning. The intended LAN entry point is the installed client.

## Public HTTPS service

The executable `unsocial-room` (Windows suffix `.exe`) is included under `resources/app/bin` in the Windows and Linux packages. On macOS it is under `Contents/Resources/app/bin`. It also builds directly with `go build` from the server directory.

1. Provision a host with persistent disk and a domain under your control. Give the room service its own OS account and an encrypted volume. Publish the A/AAAA records for the chosen hostname. Keep the data directory outside synced folders and network shares.
2. Generate a random administrator secret, for example with `openssl rand -hex 32`, and supply it through a private service environment file as `UNSOCIAL_ADMIN_TOKEN`. Retain it only for people authorized to create rooms.
3. Start the service with `unsocial-room -data /var/lib/unsocial -public-url https://rooms.example.org -listen 127.0.0.1:8484`, replacing the example hostname. Run it under a service manager with restart on failure. The first stdout line provides endpoint metadata. Stderr contains JSON service errors. The health route is `/health`.
4. Configure a reverse proxy for that hostname. The following Caddy configuration assumes public DNS and the usual ACME reachability. Persist Caddy's certificate state and allow the required inbound HTTP/HTTPS ports. The upstream accepts connections on loopback. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)

```caddyfile
rooms.example.org {
    reverse_proxy 127.0.0.1:8484
}
```

5. Visit the real HTTPS health URL in a browser with its normal trust settings. Validate the hostname and full certificate chain, then create a room through **Create room → Use a standalone server**. Enter the HTTPS origin and operator key. From another network, join with the invitation, exchange a message and download a verified file.

## Service settings and operations

| Option | Default | Purpose |
| --- | --- | --- |
| -data | room-data | Database, objects and local host identity |
| -ttl | 24h | Room lifetime measured from creation |
| -listen | Stable auto-selected LAN port, or 127.0.0.1:8484 behind a proxy | Bind address |
| -advertise | First available IPv4 interface | LAN address distributed to peers |
| -reserve-bytes | 67108864 | Free space reserved during upload writes |
| -auth-rate | 90 | Create and join attempts per peer IP per minute. Behind a local proxy the service sees a shared source, so apply per-client throttling at the proxy as well |

Monitor disk space, inode capacity, memory, open connections, expiry cleanup, certificate renewal and egress. For an offline backup, stop the process cleanly and back up the whole data directory together. Restoring the server while reusing old invites requires the original address, CA identity, database and unexpired room. Test restoration on an isolated host.

## Distribution and release verification

GitHub Releases stores the platform installers and portable Linux download. GitHub Pages serves only the download selector, images, fonts and quick start. Room invitations, chat and files go directly to the room host. A public repository can use GitHub Pages on GitHub Free. [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

Select **GitHub Actions** as the repository's Pages source and push the release commit to `main`. Tag that commit with the package version prefixed by `v` and push the tag. The desktop workflow installs Windows Setup and the Debian package, checks the portable Linux files, and installs the same Mac package on Apple Silicon and Intel runners. Its release job checks all four browser downloads, publishes them with their SHA-256 manifest and dispatches the Pages workflow on the default branch. Subsequent website changes on `main` rebuild the page against that published version. An incomplete release fails the page build. The Pages deployment job reports the public URL.

For a local preview, download the four public packages and their SHA256SUMS.txt into `dist`, then run `npm run build:site`. Open `build/download-site/index.html` in a browser. `npm run test:site` exercises all platform downloads in Edge on Windows or Chrome on Linux and macOS. Set `UNSOCIAL_TEST_BROWSER` to select an installed Chromium executable.

The candidate workflow distributes unsigned builds. A signed Windows release requires publisher credentials. A signed macOS release requires Apple Developer ID signing, notarization and stapling. Verify OS trust and clean-machine installation for the signed artifacts. [Electron signing guidance](https://www.electronjs.org/docs/latest/tutorial/code-signing)

