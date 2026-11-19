// Delay-tolerant store-carry-forward core. Pure logic: no I/O, no clocks (time is passed in).
//
// Model
// - Address = signPub (64 hex) + boxPub (64 hex). Share it once (QR or paste).
// - Unicast bundles: payload encrypted to the recipient (nacl.box). Relays see only ciphertext.
// - Broadcast bundles (dst = "*"): signed by the source, readable by all. Used for signed updates.
// - Every bundle is signed by its source over its header, so relays cannot alter ids, dst, TTL.
// - Routing: binary spray-and-wait. A bundle starts with L copies; a holder with n>1 copies gives
//   floor(n/2) to a new contact and keeps the rest. With one copy it waits for the destination.
//   Broadcasts flood to every contact that lacks them, bounded by TTL and the store cap.
// - Delivery produces a signed ack that spreads by gossip and frees the copies still in transit.
import nacl from "tweetnacl";
import { canonical } from "../canonical";
import { fromHex, toHex } from "../trade";

export const BROADCAST = "*";
export const SPRAY_COPIES = 8;
export const MAX_BUNDLES = 400;
export const MAX_ACKS = 2000;
export const ACK_LIFETIME_S = 7 * 24 * 3600;
const MAX_CLOCK_SKEW_S = 300;

export interface DtnIdentity {
  signPub: string;
  signSec: string;
  boxPub: string;
  boxSec: string;
}

export interface Bundle {
  id: string;
  src: string; // sender address
  dst: string; // recipient address, or BROADCAST
  created: number; // unix seconds
  ttl: number; // seconds
  nonce: string; // 24-byte hex (unicast) or "" (broadcast)
  body: string; // hex ciphertext (unicast) or hex JSON (broadcast)
  sig: string; // source signature over the header
  copies: number; // routing metadata: spray copies held here (not signed)
}

export interface Ack {
  bundleId: string;
  dst: string; // acking recipient's address
  at: number;
  sig: string;
}

export interface Delivered {
  id: string;
  from: string;
  kind: string;
  body: unknown;
  at: number;
}

export interface DtnState {
  bundles: Record<string, Bundle>;
  acks: Record<string, Ack>;
  delivered: Record<string, number>; // id -> time first delivered (dedup)
  inbox: Delivered[];
}

export const emptyDtn = (): DtnState => ({ bundles: {}, acks: {}, delivered: {}, inbox: [] });

export const addressOf = (id: Pick<DtnIdentity, "signPub" | "boxPub">) => id.signPub + id.boxPub;
const signPubOf = (addr: string) => addr.slice(0, 64);
const boxPubOf = (addr: string) => addr.slice(64);
const utf8 = (s: string) => new TextEncoder().encode(s);

export function newDtnIdentity(): DtnIdentity {
  const sign = nacl.sign.keyPair();
  const box = nacl.box.keyPair();
  return { signPub: toHex(sign.publicKey), signSec: toHex(sign.secretKey), boxPub: toHex(box.publicKey), boxSec: toHex(box.secretKey) };
}

function headerBytes(h: { src: string; dst: string; created: number; ttl: number; nonce: string; body: string }): Uint8Array {
  return utf8("collapse-dtn-v1|" + canonical(h));
}
function idOf(bytes: Uint8Array): string {
  return toHex(nacl.hash(bytes)).slice(0, 32);
}

/** Create a unicast (encrypted) or broadcast (signed, readable) bundle. */
export function makeBundle(
  me: DtnIdentity,
  dst: string,
  kind: string,
  body: unknown,
  now: number,
  ttl: number,
  copies = SPRAY_COPIES,
): Bundle {
  const src = addressOf(me);
  const plain = utf8(canonical({ kind, body }));
  let nonce = "";
  let cipher: Uint8Array;
  if (dst === BROADCAST) {
    cipher = plain;
  } else {
    if (dst.length !== 128 || !/^[0-9a-f]+$/.test(dst)) throw new Error("bad address");
    const n = nacl.randomBytes(nacl.box.nonceLength);
    nonce = toHex(n);
    cipher = nacl.box(plain, n, fromHex(boxPubOf(dst)), fromHex(me.boxSec));
  }
  const h = { src, dst, created: now, ttl, nonce, body: toHex(cipher) };
  const bytes = headerBytes(h);
  return { id: idOf(bytes), ...h, sig: toHex(nacl.sign.detached(bytes, fromHex(me.signSec))), copies };
}

export function isExpired(b: { created: number; ttl: number }, now: number): boolean {
  return now >= b.created + b.ttl;
}

/** Checks id, source signature, and freshness. Does not decrypt. */
export function verifyBundle(b: Bundle, now: number): boolean {
  if (!b || typeof b.id !== "string" || b.src.length !== 128) return false;
  if (b.dst !== BROADCAST && b.dst.length !== 128) return false;
  if (b.ttl <= 0 || b.ttl > 30 * 24 * 3600) return false;
  if (b.created > now + MAX_CLOCK_SKEW_S) return false;
  if (isExpired(b, now)) return false;
  if (!Number.isInteger(b.copies) || b.copies < 0) return false;
  const h = { src: b.src, dst: b.dst, created: b.created, ttl: b.ttl, nonce: b.nonce, body: b.body };
  const bytes = headerBytes(h);
  if (idOf(bytes) !== b.id) return false;
  try {
    return nacl.sign.detached.verify(bytes, fromHex(b.sig), fromHex(signPubOf(b.src)));
  } catch {
    return false;
  }
}

/** Opens a bundle addressed to `me` (or a broadcast). Returns null for anything else. */
export function openBundle(b: Bundle, me: DtnIdentity): { kind: string; body: unknown; from: string } | null {
  try {
    if (b.dst === BROADCAST) {
      const { kind, body } = JSON.parse(new TextDecoder().decode(fromHex(b.body)));
      return { kind, body, from: b.src };
    }
    if (b.dst !== addressOf(me)) return null;
    const plain = nacl.box.open(fromHex(b.body), fromHex(b.nonce), fromHex(boxPubOf(b.src)), fromHex(me.boxSec));
    if (!plain) return null;
    const { kind, body } = JSON.parse(new TextDecoder().decode(plain));
    return { kind, body, from: b.src };
  } catch {
    return null;
  }
}

export function makeAck(me: DtnIdentity, bundleId: string, now: number): Ack {
  const dst = addressOf(me);
  const sig = toHex(nacl.sign.detached(utf8(`ack|${bundleId}|${dst}|${now}`), fromHex(me.signSec)));
  return { bundleId, dst, at: now, sig };
}

export function verifyAck(a: Ack): boolean {
  try {
    return nacl.sign.detached.verify(utf8(`ack|${a.bundleId}|${a.dst}|${a.at}`), fromHex(a.sig), fromHex(signPubOf(a.dst)));
  } catch {
    return false;
  }
}

export interface Summary {
  ids: string[]; // bundles held + bundles already delivered here
  acks: string[];
}

export function summary(s: DtnState, now: number): Summary {
  return {
    ids: [...Object.keys(s.bundles).filter((id) => !isExpired(s.bundles[id], now)), ...Object.keys(s.delivered)],
    acks: Object.keys(s.acks),
  };
}

export interface SyncMsg {
  bundles: Bundle[];
  acks: Ack[];
}

/**
 * What to send to a peer. Mutates our spray copy counts when a spray copy is handed over,
 * so the total number of copies of one bundle across the network never exceeds SPRAY_COPIES.
 */
export function plan(s: DtnState, peer: Summary, peerAddr: string, now: number): SyncMsg {
  const have = new Set(peer.ids);
  const bundles: Bundle[] = [];
  for (const b of Object.values(s.bundles)) {
    if (isExpired(b, now) || have.has(b.id) || s.acks[b.id]) continue;
    if (b.dst === BROADCAST) {
      bundles.push({ ...b });
    } else if (b.dst === peerAddr) {
      bundles.push({ ...b });
    } else if (b.copies > 1) {
      const give = Math.floor(b.copies / 2);
      s.bundles[b.id] = { ...b, copies: b.copies - give };
      bundles.push({ ...b, copies: give });
    }
  }
  const peerAcks = new Set(peer.acks);
  const acks = Object.values(s.acks).filter((a) => !peerAcks.has(a.bundleId));
  return { bundles, acks };
}

/** Applies a peer's message. Returns newly delivered messages for this node. */
export interface ReceiveOpts {
  /** Broadcasts are relayed only when this returns true (e.g. maintainer-signed packs). */
  allowBroadcast?: (b: Bundle) => boolean;
}

export function receive(s: DtnState, msg: SyncMsg, me: DtnIdentity, now: number, opts: ReceiveOpts = {}): { delivered: Delivered[] } {
  // 1) Acks first: a valid ack from the bundle's own destination frees its copies.
  for (const a of msg.acks) {
    if (!verifyAck(a) || now - a.at > ACK_LIFETIME_S || a.at > now + MAX_CLOCK_SKEW_S) continue;
    if (!s.acks[a.bundleId] && Object.keys(s.acks).length >= MAX_ACKS) continue;
    s.acks[a.bundleId] = a;
    const held = s.bundles[a.bundleId];
    if (held && held.dst === a.dst) delete s.bundles[a.bundleId];
  }
  // 2) Bundles.
  const delivered: Delivered[] = [];
  for (const b of msg.bundles) {
    if (s.delivered[b.id] || s.bundles[b.id] || s.acks[b.id]) continue;
    if (!verifyBundle(b, now)) continue;
    if (b.dst === BROADCAST) {
      if (opts.allowBroadcast && !opts.allowBroadcast(b)) continue;
      s.bundles[b.id] = { ...b };
      const opened = openBundle(b, me);
      if (opened) {
        const d = { id: b.id, from: opened.from, kind: opened.kind, body: opened.body, at: now };
        s.delivered[b.id] = now;
        s.inbox.push(d);
        delivered.push(d);
      }
    } else if (b.dst === addressOf(me)) {
      const opened = openBundle(b, me);
      if (!opened) continue;
      const d = { id: b.id, from: opened.from, kind: opened.kind, body: opened.body, at: now };
      s.delivered[b.id] = now;
      s.inbox.push(d);
      delivered.push(d);
      s.acks[b.id] = makeAck(me, b.id, now);
    } else {
      s.bundles[b.id] = { ...b };
    }
  }
  prune(s, now);
  return { delivered };
}

/** Drops expired bundles, enforces the store cap (oldest first), and ages out old acks and dedup records. */
export function prune(s: DtnState, now: number): void {
  for (const id of Object.keys(s.bundles)) if (isExpired(s.bundles[id], now)) delete s.bundles[id];
  for (const id of Object.keys(s.acks)) if (now - s.acks[id].at > ACK_LIFETIME_S) delete s.acks[id];
  for (const id of Object.keys(s.delivered)) if (now - s.delivered[id] > ACK_LIFETIME_S) delete s.delivered[id];
  let ids = Object.keys(s.bundles);
  if (ids.length > MAX_BUNDLES) {
    ids = ids.sort((a, b) => s.bundles[a].created - s.bundles[b].created);
    for (const id of ids.slice(0, ids.length - MAX_BUNDLES)) delete s.bundles[id];
  }
  if (s.inbox.length > 500) s.inbox = s.inbox.slice(-500);
}
