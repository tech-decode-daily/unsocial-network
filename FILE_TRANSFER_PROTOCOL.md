# File transfer protocol v1

1. The sender computes the entire source's SHA-256 by streaming from disk. It sends an idempotency key, display filename, known MIME type, byte size and digest to the room. The server creates an opaque object ID. Repeating the offer with the same member and key retrieves the original object.
2. Read the server's current Offset. Upload the next contiguous block with Content-Length, Upload-Offset and Chunk-SHA256. The desktop normally sends 1 MiB at a time. The server accepts blocks up to 4 MiB. These values bound per-request work. They do not bound total file size.
3. The server checks ownership and offset, writes the block, verifies its digest, syncs the file and commits the new offset. Bytes after the last committed offset are truncated on the next attempt. An offset mismatch returns HTTP 409. After a disconnect, retrieve the record and continue from its confirmed offset.
4. The sender requests verification. The server streams the full object through SHA-256 and checks both size and digest, then commits publication with the room event in one transaction. Another verification request returns the published record. Empty files also take this path.
5. The recipient requests byte ranges from the published object. It checks Content-Range and response length before appending to a private partial file. On retry it starts at the existing partial length. It syncs the completed data and checks the full SHA-256. A mismatch discards the partial file for a fresh retry.
6. The recipient publishes the verified bytes under an available local filename. The transfer queue marks each completed operation separately. An explicit cancellation removes the local partial and attempts to cancel an unpublished server object. The host reclaims abandoned objects at room expiry.

The native client supports safe integer byte counts. Disk capacity, operating-system file sizes, hard-link support for final publication and remaining room lifetime constrain individual transfers. The queue defaults to two active jobs per client, configurable up to 64. Additional selections wait. Changing a source file or losing access to it requires selecting it again.

