# Desktop release candidate verification

Executed on **23 November 2026** in the supplied Windows 11 x64 workspace. The tested client uses Electron 45.4.1. The build used Go 1.27.4 and Node.js 24.22.3. All networking tests used separate sessions over TCP/TLS on this computer. No original Beam code or deployed endpoint was available.

## Executed checks

| Check | Observed result |
| --- | --- |
| `go test -v ./...` in server | Both Go unit tests passed. Covered free-space admission and release, expiry metadata and spool cleanup, and configurable rate throttling |
| `npm test` | Passed. Node reported seven passing tests including the parent integration test. Six subtests ran against a spawned room server |
| Authorization and input handling | Rejected an invalid invite, missing operator key, missing session on WebSocket upgrade, cross-room member credential, duplicate display name, invalid ID, unsafe filename, negative size, malformed fields and oversized metadata |
| TLS trust | An invitation-scoped CA succeeded. A new client using only its default trust roots rejected the private certificate. The same host CA and reachable origin worked after server restart |
| Rooms and chat | Three distinct memberships coexisted. Independent clients observed presence, offline changes, ordered concurrent messages, idempotent sends, event-cursor replay and credential revocation |
| File protocol | Idempotent offer, rejecting a bad chunk digest, incomplete and incorrect final hashes, conflicting offsets, an invisible unpublished file, repeated completion and protected downloads behaved as expected |
| Interruption and storage | Restarted the server between upload chunks and continued at the committed offset. Raising the reserve above available disk produced HTTP 507 without advancing the offset. Two writers racing at one offset produced one accepted write and one conflict. Cancelling a delayed upload removed its unpublished record |
| Concurrent binary transfers | Six source files, three active queue slots, a text file, generated ZIP, PNG, one-frame YUV4MPEG video, empty unknown extension and **256 MiB** binary. Independent digests matched after download |
| Download recovery | Injected a failure after the first 1 MiB, verified the actual partial length, retried, and independently hashed the final file. Pre-existing destination bytes survived. Replayed the linked-file crash boundary and recovered the same destination |
| Windows desktop integration | Two isolated Electron profiles created and joined a room, displayed presence, delivered chat, shared and downloaded a file, compared the saved bytes and left. No renderer exceptions were observed. Native chooser and clipboard methods were supplied deterministic fixtures for this automated test |
| Windows packaged restart | Extracted the final Windows ZIP into a fresh directory and launched its executable with the sandbox enabled. The host explicitly left the room, then its process exited and restarted. The remaining guest reconnected automatically and delivered another chat message. The final run used headless display. A prior extracted build also passed the visible two-window interaction flow |
| Interactive Windows inspection | Opened the extracted app normally and inspected the room directory and Create room form. User input took over that instance during the form check. The native file-picker round trip remains unverified manually |
| Static and dependency checks | `go vet ./...` succeeded. `govulncheck ./...` reported no known reachable vulnerabilities for this build. `npm audit` reported zero known dependency vulnerabilities at check time |

## Release archives

Each package build checked the upstream Electron ZIP against the checksum supplied with the locked Electron dependency. The final `node scripts/verify-archive.mjs` run recomputed all four distribution checksums, compared packaged desktop assets with the working sources, checked required paths and binary architectures, and checked Unix executable bits and the macOS framework symlink. The resulting manifest is `dist/SHA256SUMS.txt`.

| Artifact | Bytes | Execution evidence |
| --- | ---: | --- |
| Windows x64 ZIP | 165,817,614 | Extracted executable and bundled server exercised together on Windows |
| Linux x64 ZIP | 129,498,773 | ELF architecture and archive verified on Windows. Native Linux desktop run pending |
| macOS Apple Silicon ZIP | 128,293,630 | ARM64 Mach-O launcher and server, framework links and app layout verified. Native run pending |
| macOS Intel ZIP | 131,388,200 | x64 Mach-O launcher and server, framework links and app layout verified. Native run pending |

## Outstanding public-release checks

- Run the native release matrix in `.github/workflows/desktop.yml` on Linux and both Mac architectures. The workspace has no Git remote, macOS runner or installed WSL distribution.
- Exercise two physical computers across a LAN and a separately hosted internet room. Check firewall prompts, sleep/wake, adapter changes, sustained slow links and transfer sizes above the tested 256 MiB. Measured results here establish neither a throughput guarantee nor a maximum room size.
- Validate the production hostname, certificate chain, renewal, WSS, browser trust and reverse proxy in the intended deployment. A domain, live endpoint and hosting configuration were not supplied.
- Complete native file-picker, OS keyring and clean-machine installation checks across supported desktops. Confirm publisher signatures, macOS notarization and OS acceptance using distribution credentials.

The downloadable files are portable release candidates. Public hosting and publisher signing remain pending.

