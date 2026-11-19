# Offline network layer (DTN prototype)

## What it does
- Each device has an address (signing key + encryption key). Share it once.
- Messages are encrypted to the recipient. Devices that meet carry them forward (store-carry-forward).
- Routing: binary spray-and-wait, 8 copies per message. A holder hands half its copies to each new
  contact and waits for the destination. Delivery sends a signed ack that frees the copies in transit.
- Bundles expire after their TTL (messages 72 h). Stores are capped at 400 bundles (oldest dropped first).
- Game content and rule updates ride the same network as signed broadcast packs. Devices install a
  pack only if the maintainer signature checks, the version is newer, and quest ids already exist.

## How devices meet (what is built)
- Two devices connect over WebRTC after QR or pasted-code exchange. Once connected, they sync automatically.
- This needs an IP link between the phones, such as the same Wi-Fi or a phone hotspot. Internet is not needed.

## Verified
- Unit tests: bundle integrity and encryption, relay cannot read content, forged acks rejected, spray copy
  invariant, broadcast dedup, store cap, pack signature, rollback refusal, quest stages.
- Simulation (idealised, no radio loss): 60 phones moving at random, 20 messages over 6 h: 100% delivered
  (4 extra seeds: 20/20 each). A 50 km shuttle carry between two clusters delivers in about 71 minutes.
- Browser (three separate sessions A → B → C): message delivered to C through B, pack installed on C,
  B's copy removed after the ack.

## Not built / known gaps
- Bluetooth, Wi-Fi Direct and LoRa transports. Devices that only pass each other with no IP link do not sync.
- Background relay: sync happens only when the Transfer screen is open and two devices are connected.
- Keys and messages are stored in browser storage, not in Android Keystore, and are not encrypted at rest.
- Packs cannot add new quests or screens: the static build only has pages for the built-in quest ids.
  Code changes still need a new app install.
- No key rotation or revocation for the maintainer key. A leaked key lets its holder push packs to every device.
- The simulation does not model radio loss, latency, battery or device movement patterns of real people.

## Gaps closed (round 2)
- No accept prompt: bulk sync moved from Wi-Fi Direct to Bluetooth LE GATT. The connection needs only the Bluetooth permissions granted on first launch. Trade-off: tens of KB/s, enough for messages and packs, not video.
- Keys in Android Keystore: an AES-256-GCM master key, StrongBox-backed where available, wraps the identity seeds, message store, content, and keyring on disk. Ed25519 and X25519 private keys cannot live inside Keystore on API 26-32, so they are unwrapped in memory while in use. The web app still keeps keys in browser storage.
- Maintainer key rotation: the device trusts a keyring (1-3 keys). A new keyring must be signed by a currently trusted key, carry a newer version, and it replaces the trusted set. Packs signed by revoked keys are then refused. Tool: scripts/maintainer.ts keyring.
- Packs add quests and screens: new quest ids and new screens install without an app update. Screens use fixed block types (text, list, quest link, screen link). Packs cannot ship code.

## Still open
- Nothing in the Bluetooth or Keystore code has run on a phone yet; it is verified by compile and JVM tests only.
