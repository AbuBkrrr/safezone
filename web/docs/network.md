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
