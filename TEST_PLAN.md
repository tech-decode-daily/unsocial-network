# Release test plan

| Layer | Cases | Acceptance evidence |
| --- | --- | --- |
| Store and spool | Reserve pressure, concurrent reservations, expiry, cleanup and throttling | Consistent offsets and explicit errors, expired data reclaimed |
| Real service | Distinct sessions, concurrent messages, replay, presence, revoked and cross-room credentials, invalid inputs and TLS trust | Observed responses and independently received events |
| Transfer engine | Empty, opaque, media, archive and large payloads, multiple concurrent jobs, bad hashes, conflicting offsets, duplicate names, cancel, interruption and restart | Byte comparison, independent digest, unchanged existing destination and durable resumption |
| Desktop | Launch two isolated profiles, create, join, chat, share, save, navigate, leave and restart | UI-driven actions, received file on disk and renderer error capture |
| Packaging | Verify runtime checksums, archive paths, bundled binary architecture, permissions, macOS links, clean native launch and install | Inspection plus actual execution of each target archive on a matching OS |
| Real deployment | Two physical devices, sleep and wake, slow link, private LAN firewall and public CA hostname | Test from a second network, browser chain inspection, live WSS, resource monitoring |

Record the actual results and unexecuted cases in TEST_REPORT.md. Qualify capacity on representative deployment hardware with simultaneous rooms, increasing file sizes and representative chat and file metadata histories.

