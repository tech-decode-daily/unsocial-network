# Delivery plan

- [x] Inventory the supplied workspace and attachment, document missing baseline evidence and obtain a decision on a new implementation.
- [x] Build the room service, persistence and native client transport. Exercise independent sessions, departure, authorization and reconnect.
- [x] Implement resumable transfers. Verify hashes, explicit cancellation, restart offsets, storage pressure, collisions, concurrent jobs and recovery after publishing a downloaded file.
- [x] Connect the desktop home, room, chat, participants, terminal and transfer queue to real service events.
- [x] Exercise trust boundaries and interrupted transfers, inspect dependencies and document LAN and public HTTPS operation.
- [x] Produce portable archives and SHA-256 checksums for Windows x64, Linux x64 and both Mac architectures.
- [x] Exercise the extracted release on native Windows, Ubuntu, Apple Silicon macOS and Intel macOS runners.
- [ ] Qualify the app across a physical device pair and a production room-service hostname. Sign the public distribution artifacts. See TEST_REPORT.md.

The service belongs in `server/`, native and renderer code in `desktop/`, and repeatable build tooling in `scripts/`. Each phase updates its protocol, operations or test documentation as applicable. A build artifact and a verified production release have separate acceptance checks.
