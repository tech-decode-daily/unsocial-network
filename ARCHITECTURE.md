# Desktop architecture

## Delivery

Use Electron with bundled local HTML, CSS and JavaScript. The native process handles dialogs, disk streams and room credentials. The sandboxed renderer receives display data and a narrow command API. A browser-only build would make durable destination handles and restart recovery depend on browser-specific behavior. Electron adds download size and a recurring runtime update obligation. [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)

## Room server

Use a Go service with an embedded transactional database, a private file spool and an authenticated WebSocket event feed. Each desktop can launch a server for a LAN room. An always-on operator can run the same executable separately. LAN hosting requires inbound reachability and a running host. A separately hosted room survives the creator leaving. A direct WebRTC mesh would require signaling, NAT traversal and often a TURN relay, and would complicate resuming when the sender goes offline. [WebRTC connectivity](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity)

## Trust

An invitation contains a server address, room ID and high-entropy join secret. A LAN invitation also supplies the host's private CA **public certificate** for that connection. The client explicitly trusts the invitation supplied by its user, checks the hostname and verifies the chain. Users must exchange invitations privately with known peers. No system trust-store change is needed. A public deployment uses its real DNS name and a public CA. Clients keep bearer sessions in the native process. Room membership scopes all room, event and file operations. The relay reads the data. Operators need encrypted storage and a retention policy.

## Data and recovery

Persist room identity, members, ordered events and transfer offsets. A committed offset is an acknowledgement of durable bytes. File objects use server-generated identifiers. A serial writer owns each upload, and the server publishes a file only after full SHA-256 verification. A receiver writes bounded chunks to a private partial file, verifies the complete hash and publishes to a collision-free destination. Clients can reconnect and replay missed events. Content lives on one host per room for the first release. Capacity is limited by disk, bandwidth, connections and memory.

## Distribution

Build the client and matching server binary for each OS and CPU. Exercise networking on real clients and install the artifacts on clean native systems. Public Windows distribution needs a signing identity. Public macOS distribution needs Developer ID signing and notarization. Preserve platform permissions, executable bits and macOS framework symlinks during packaging. [Electron distribution](https://www.electronjs.org/docs/latest/tutorial/code-signing)
