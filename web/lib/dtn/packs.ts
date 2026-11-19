// Signed packs (quests and screens) and keyrings (trusted key rotation).
// Both must be signed by a currently trusted key and carry a version newer than the installed one.
import nacl from "tweetnacl";
import { canonical } from "../canonical";
import { fromHex, toHex } from "../trade";
import { BROADCAST, makeBundle, type Bundle, type DtnIdentity } from "./core";
import { validateQuestDef, type QuestDef } from "../quests";
import { validateScreen, type ScreenDef } from "../screens";

export const PACK_KIND = "pack";
export const KEYRING_KIND = "keyring";
export const PACK_NAME = "collapse-content";
export const KEYRING_NAME = "collapse-keyring";
export const MAX_KEYS = 3;

export interface Pack { name: typeof PACK_NAME; version: number; issued: number; quests: QuestDef[]; screens: ScreenDef[] }
export interface SignedPack { pack: Pack; sig: string }
export interface Keyring { name: typeof KEYRING_NAME; version: number; keys: string[] }
export interface SignedKeyring { keyring: Keyring; sig: string }

const packBytes = (p: unknown) => new TextEncoder().encode("collapse-pack-v1|" + canonical(p));
const keyringBytes = (k: unknown) => new TextEncoder().encode("collapse-keyring-v1|" + canonical(k));

function signedByTrusted(trusted: string[], msg: Uint8Array, sig: string): boolean {
  return trusted.some((pub) => {
    try { return nacl.sign.detached.verify(msg, fromHex(sig), fromHex(pub)); } catch { return false; }
  });
}

export function signPack(secretHex: string, pack: Pack): SignedPack {
  return { pack, sig: toHex(nacl.sign.detached(packBytes(pack), fromHex(secretHex))) };
}

export function signKeyring(secretHex: string, keyring: Keyring): SignedKeyring {
  return { keyring, sig: toHex(nacl.sign.detached(keyringBytes(keyring), fromHex(secretHex))) };
}

/** Verifies a content pack against the trusted keys, the installed version, and the quest and screen rules. */
export function verifyPack(sp: SignedPack, installedVersion: number, trusted: string[]): { ok: true } | { ok: false; reason: string } {
  try {
    const p = sp.pack;
    if (!p || p.name !== PACK_NAME) return { ok: false, reason: "wrong pack name" };
    if (!Number.isInteger(p.version) || p.version < 1) return { ok: false, reason: "bad version" };
    if (!signedByTrusted(trusted, packBytes(p), sp.sig)) return { ok: false, reason: "not signed by a trusted key" };
    if (p.version <= installedVersion) return { ok: false, reason: "not newer than installed version (rollback refused)" };
    const quests = p.quests ?? [];
    const screens = p.screens ?? [];
    if (quests.length > 100 || screens.length > 50) return { ok: false, reason: "pack too large" };
    if (quests.length + screens.length === 0) return { ok: false, reason: "empty pack" };
    const qids = new Set<string>();
    for (const q of quests) {
      const v = validateQuestDef(q);
      if (!v.ok) return v;
      if (qids.has(q.id)) return { ok: false, reason: `duplicate quest ${q.id}` };
      qids.add(q.id);
    }
    const sids = new Set<string>();
    for (const s of screens) {
      const v = validateScreen(s);
      if (!v.ok) return v;
      if (sids.has(s.id)) return { ok: false, reason: `duplicate screen ${s.id}` };
      sids.add(s.id);
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "malformed pack" };
  }
}

/** Verifies a keyring: a new trusted set, signed by a currently trusted key, with a newer version. */
export function verifyKeyring(sk: SignedKeyring, installedVersion: number, trusted: string[]): { ok: true } | { ok: false; reason: string } {
  try {
    const k = sk.keyring;
    if (!k || k.name !== KEYRING_NAME) return { ok: false, reason: "wrong keyring name" };
    if (!Number.isInteger(k.version) || k.version <= installedVersion) return { ok: false, reason: "not newer than installed keyring (rollback refused)" };
    if (!Array.isArray(k.keys) || k.keys.length < 1 || k.keys.length > MAX_KEYS) return { ok: false, reason: "keyring must hold 1 to 3 keys" };
    if (k.keys.some((x) => !/^[0-9a-f]{64}$/.test(x)) || new Set(k.keys).size !== k.keys.length) return { ok: false, reason: "bad key in keyring" };
    if (!signedByTrusted(trusted, keyringBytes(k), sk.sig)) return { ok: false, reason: "not signed by a trusted key" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "malformed keyring" };
  }
}

export function packBundle(maintainer: DtnIdentity, signed: SignedPack, now: number, ttl: number): Bundle {
  return makeBundle(maintainer, BROADCAST, PACK_KIND, signed, now, ttl);
}

export function keyringBundle(maintainer: DtnIdentity, signed: SignedKeyring, now: number, ttl: number): Bundle {
  return makeBundle(maintainer, BROADCAST, KEYRING_KIND, signed, now, ttl);
}

/** True when a broadcast's source key is one this device trusts. */
export function isTrustedSource(from: string, trusted: string[]): boolean {
  return trusted.includes(from.slice(0, 64));
}
