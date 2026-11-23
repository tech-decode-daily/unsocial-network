# Security model

## Membership and invitations

The server generates a 96-bit room ID and independent 256-bit invite and session secrets using the operating system CSPRNG. An ID identifies a room. Its invite secret authorizes enrollment. A new participant receives a separate bearer credential. The database holds secret digests. Display names are bound to the server-side membership and unique among current members of a room, ignoring case. Leaving revokes the session. Display names identify room participants and carry no proof of real-world identity.

The native client authenticates every room request, including the WebSocket upgrade, using the Authorization header. The server checks room membership, object ownership and publication state. An invitation remains shareable by members until room expiry. Exchange it over a private channel. The system clipboard may retain its contents.

## Desktop and transport

Packaged local renderer assets run with the Chromium sandbox, context isolation and a restrictive content security policy. The main process checks the sender frame, constrains IPC operations, manages credentials and mediates access to native files. Messages and filenames enter the DOM as text. Received bytes are saved as downloads. Showing a download opens its location.

LAN clients validate the TLS hostname and certificate chain using the private CA public certificate in that room's invitation. The invitation channel establishes authority over the intended host. A public server uses the client's trusted CA set and its HTTPS hostname. The relay terminates TLS and can read file and chat contents. The application provides transport encryption, and the relay operator is inside the trust boundary.

## Retention and local storage

The default room lifetime is 24 hours. Scheduled cleanup removes expired metadata and file objects, including incomplete uploads. Database pages may be reused, and backups may retain data longer. Use an encrypted host volume, restrict its OS account, and apply the same retention to snapshots and backups. Host CA private keys and data live under the server data directory. Local downloads remain under the recipient's control.

The desktop encrypts memberships, resume paths and queue metadata using Electron safeStorage when a supported OS key store is available. On a Linux desktop with the plaintext fallback, or if saved data cannot be decrypted, it uses memory for the session. Received files and the host spool use ordinary filesystem storage. A signed public release and native validation are tracked in the test report.

## Resource controls

Creation requires a separate operator key. Create and join attempts share a configurable per-source rate. Metadata and message bodies are bounded. Each upload chunk has a bounded length, an expected offset and its own digest. The spool keeps a configurable free-space reserve. Each download destination is chosen locally, and the final verified file is linked under a collision-free name. An operator should monitor host disk usage and limit access to room creation.

