// Signed content packs: the only way game content and rule updates reach devices.
// A pack is signed by the maintainer key, travels as a broadcast DTN bundle, and is installed
// only if the signature checks and its version is newer than the installed one (no rollback).
import nacl from "tweetnacl";
import { canonical } from "../canonical";
import { fromHex, toHex } from "../trade";
import { BROADCAST, makeBundle, type Bundle, type DtnIdentity } from "./core";
import { MAINTAINER_PUB } from "./maintainer";
import { validateQuestDef, type QuestDef } from "../quests";

export const PACK_KIND = "pack";
export const PACK_NAME = "collapse-content";

export interface Pack {
  name: typeof PACK_NAME;
  version: number;
  issued: number;
  quests: QuestDef[];
}
export interface SignedPack {
  pack: Pack;
  sig: string;
}

const bytes = (p: Pack) => new TextEncoder().encode("collapse-pack-v1|" + canonical(p));

export function signPack(secretHex: string, pack: Pack): SignedPack {
  return { pack, sig: toHex(nacl.sign.detached(bytes(pack), fromHex(secretHex))) };
}

/**
 * Verifies a pack against the pinned key, the installed version, and the base quest ids.
 * Packs may change existing quests only, because the static app build has pages for those ids.
 */
export function verifyPack(
  sp: SignedPack,
  installedVersion: number,
  baseIds: string[],
  pubHex: string = MAINTAINER_PUB,
): { ok: true } | { ok: false; reason: string } {
  try {
    const p = sp.pack;
    if (!p || p.name !== PACK_NAME) return { ok: false, reason: "wrong pack name" };
    if (!Number.isInteger(p.version) || p.version < 1) return { ok: false, reason: "bad version" };
    if (!nacl.sign.detached.verify(bytes(p), fromHex(sp.sig), fromHex(pubHex))) return { ok: false, reason: "bad signature" };
    if (p.version <= installedVersion) return { ok: false, reason: "not newer than installed version (rollback refused)" };
    if (!Array.isArray(p.quests) || p.quests.length === 0 || p.quests.length > 100) return { ok: false, reason: "bad quest list" };
    const seen = new Set<string>();
    for (const q of p.quests) {
      const v = validateQuestDef(q);
      if (!v.ok) return v;
      if (seen.has(q.id)) return { ok: false, reason: `duplicate quest ${q.id}` };
      seen.add(q.id);
      if (!baseIds.includes(q.id)) return { ok: false, reason: `unknown quest id ${q.id} (needs an app update)` };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "malformed pack" };
  }
}

/** Builds a broadcast bundle from the maintainer identity. The DTN source signature uses the same key. */
export function packBundle(maintainer: DtnIdentity, signed: SignedPack, now: number, ttl: number): Bundle {
  return makeBundle(maintainer, BROADCAST, PACK_KIND, signed, now, ttl);
}

/** True when a delivered DTN item is a pack whose source is the maintainer key. */
export function isMaintainerPack(from: string, kind: string): boolean {
  return kind === PACK_KIND && from.slice(0, 64) === MAINTAINER_PUB;
}
