# Risks and release evidence

| Condition | Cause and user impact | Engineering response |
| --- | --- | --- |
| Unknown Beam regressions and TLS complaint | Original files and deployed URL unavailable. Guessing would misdirect a repair | Record as unverified and audit independently if supplied |
| Host sleep, exit, firewall or isolated Wi-Fi | Peers lose access to a desktop-hosted room | Persist server state, reconnect with backoff, identify host dependency and offer standalone service |
| Oversubscribed storage or network | Partial writes and stalled jobs | Use bounded streaming, verify offsets, reserve free space where supported, expire stale data and isolate jobs |
| Invitation disclosure | Anyone holding a valid invitation can join | High-entropy secrets, private sharing, expiry, scoped member credentials and throttling |
| Interrupted finalization or name collision | An incorrect success indicator or overwritten user file | Verify content, publish exclusively, test interruption and duplicate names |
| Trusted relay operator | Server can access chat and files | Communicate the trust model, use encrypted volumes for sensitive deployments and expire room data |
| Public service costs | Disk, egress, domain and operation increase with usage | First release supports user-operated servers. For an S-byte file and N full downloads, plan for S bytes stored and about N × S bytes outgoing, before overhead and retries |
| OS distribution trust | Unsigned builds can trigger OS prompts. A checksum alone does not establish publisher identity | Sign Windows artifacts, sign and notarize macOS artifacts, record separate native install and launch results |

## Recovery fixes exercised in this implementation

- A creator could leave a room and restart the app, leaving peers waiting because the desktop used the creator's own membership to decide whether to launch the service. Startup now detects the saved host database. The packaged Windows test observed the guest reconnect and exchange a message after this sequence.
- A process exit after linking a verified download could leave a partial file with two hard links. The queue now checkpoints the candidate destination and reconciles its identity and hash before retrying publication. An integration test recreated that boundary and recovered the same file.
- A disk reserve failure now produces HTTP 507 before accepting a chunk. The test verified the committed offset stayed at zero, restored available capacity, and retried the transfer.
