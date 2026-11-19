# The Collapse — web app (prototype build)

Offline-capable, installable web app: scavenge, quests with in-app camera evidence, peer-to-peer
trades signed by both players (WebRTC, no server), wallet, and voice narration.

## Run locally

```bash
npm ci
npm test          # unit tests (game rules, signed trades)
npm run typecheck
npm run dev       # http://localhost:3000
```

## Build and deploy (static)

```bash
npm run build     # writes ./out
```

`./out` is plain static files. Deploy it to any static host:

- **Vercel:** import the repo, set root directory to `web`, build command `npm run build`, output directory `out`.
- **Netlify / Cloudflare Pages / GitHub Pages:** same build command, publish directory `out`.
- **Any server:** copy `out/` to the web root. Serve over HTTPS (required for camera, location and the service worker).

Narration uses the device's built-in voice, so no audio is downloaded.

## What works in this build

| Area | Status |
|---|---|
| Scavenge (GPS 100 m, accuracy 50 m, 4 h cooldown, spec loot table) | Works. Uses GPS when allowed; "test position" otherwise. |
| Quests + evidence (in-app camera, 15 s max, GPS trail every 2 s) | Works. Evidence waits for review. |
| Peer transfer and trades (QR or pasted code, WebRTC data channel) | Works on the same network or same device. Signatures: Ed25519. |
| Wallet, receipts | Works. Stored on the device. |
| Voice narration (Web Speech API) | Works where the browser has a voice. |
| Offline use after first visit (service worker) | Works. |

## Not in this build

- Native Android app, Bluetooth / Wi-Fi Direct / LoRa mesh relay, store-carry-forward bundles.
- Server backend: accounts, moderation and review, leaderboard, coin genesis, scroll delivery.
- Hardware-backed keys (Keystore/StrongBox), encryption at rest, canonical CBOR signatures.
- Evidence review and quest rewards. Rewards count only after a backend reviews them.

Keys and inventory are stored in browser localStorage and are not server-verified. Treat this build as a
prototype for playtesting, not for real value.
