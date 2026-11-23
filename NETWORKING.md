# Networking

The service accepts HTTPS uploads and range downloads. A WSS connection carries ordered room events and presence. Both guest connections originate at the desktop. The host needs an inbound route. Presence changes after WebSocket attachment or closure. Heartbeats detect a half-open socket. Reconnect uses capped exponential backoff and jitter.

## On a LAN

Create room starts the bundled server and selects a non-loopback IPv4 address when available. Its listening port persists in the host data directory. A desktop invitation carries this endpoint, room credentials and the CA public certificate. On a multi-interface computer, start the host with `UNSOCIAL_ADVERTISE` set to its reachable LAN IPv4 address. A host that changes address may require a new room and invitation. Guest Wi-Fi isolation, VPN routing and firewalls can prevent connectivity. Guests on a different network need a route or a public relay.

Closing a room view detaches presence and keeps the application running. Leaving revokes membership. Closing the desktop that owns the bundled server interrupts access for everyone until that host returns. Unexpired rooms, memberships and acknowledged upload offsets survive server restart on its existing data directory. An always-on server can continue serving guests after the creator's desktop exits. An empty room remains available until expiry.

## On the internet

Put the standalone server behind a reverse proxy using its public DNS hostname and certificate chain. The desktop connects to HTTPS and WSS on that origin. See DEPLOYMENT.md. A valid public endpoint must be tested from outside the host network. This release includes no NAT traversal service. A managed deployment incurs compute, storage, domain and bandwidth charges. The operator selects the provider.

## Capacity

One server owns one spool and transactional database. Writes to each object serialize, and data planes for unrelated objects can run concurrently. Chat uses server sequence numbers. Initial state includes the most recent 150 events and the room's published files and current memberships. Replay pages contain up to 150 events, and the UI retains a recent event window. Full file and membership snapshots and the single-disk writer are scaling limits. Future deployments can shard by room and paginate listings. Load-test actual room sizes and egress before advertising capacity.

