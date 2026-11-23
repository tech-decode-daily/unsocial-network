# Future mobile work

Reuse the room-scoped HTTPS and WSS protocol, streaming digests, range downloads and idempotent upload offsets. First connect a native Android and iOS client to an existing desktop-hosted room, verify device storage permissions and test suspension, termination and restart against real files.

Use Bluetooth LE as a candidate for nearby discovery and exchanging a small, authenticated invitation. Transfer bulk data over a reachable Wi-Fi or internet connection. Measure actual discovery time, write throughput and battery use on the supported models before considering a Bluetooth data path.

Android needs platform-appropriate scan and connect permissions. Background discovery, long-lived connections, OS version and peripheral support determine whether companion-device or foreground-service APIs fit. Evaluate Bluetooth Classic sockets separately on compatible peers. [Android background Bluetooth](https://developer.android.com/develop/connectivity/bluetooth/ble/background)

On iOS prototype with Core Bluetooth on actual devices and verify peripheral/central roles, supported transports, permission prompts, background capabilities and scheduling restrictions for the target OS versions. Treat classic profiles as platform-specific. A cross-platform browser client would require a separate compatibility study for discovery, permissions and durable file handles. [Apple Core Bluetooth](https://developer.apple.com/documentation/corebluetooth)

