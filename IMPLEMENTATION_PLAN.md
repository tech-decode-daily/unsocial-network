# Delivery plan

- [x] Inventory the supplied workspace and attachment, document missing baseline evidence and obtain a decision on a new implementation.
- [ ] Build the room service, persistence and native client transport. Exercise two independent client sessions, host departure, authorization and reconnect.
- [ ] Implement a resumable binary transfer engine. Prove integrity, crash recovery, cancellation, conflict handling, resource cleanup and concurrent jobs.
- [ ] Connect a desktop home, room, chat, participant list and transfer queue to the service. Test activity and connection feedback against real events.
- [ ] Exercise network interruptions and trust boundaries, inspect dependencies, document operational configuration and distinguish LAN trust from public HTTPS.
- [ ] Package for Windows, Linux and macOS, generate checksums and test native installation, launch and two-device delivery. Record every unverified release condition.

The service belongs in `server/`, native and renderer code in `desktop/`, and repeatable build tooling in `scripts/`. Each phase updates its protocol, operations or test documentation as applicable. A build artifact and a verified production release have separate acceptance checks.
