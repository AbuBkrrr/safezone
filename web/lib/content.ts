// What the app shows: the built-in seed, with the newest verified pack applied on top.
// A pack can change seed quests, add new quests, and add screens. Trust comes from the keyring.
import { QUESTS as SEED } from "./seed";
import type { QuestDef } from "./quests";
import type { ScreenDef } from "./screens";
import { BUILTIN_TRUSTED } from "./dtn/maintainer";
import { verifyKeyring, verifyPack, type SignedKeyring, type SignedPack } from "./dtn/packs";

const PACK_KEY = "collapse.content.v1";
const KEYRING_KEY = "collapse.keyring.v1";

export interface ActivePack { version: number; quests: QuestDef[]; screens: ScreenDef[] }
interface Keyring { version: number; keys: string[] }

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* best effort */ }
}

export function loadPack(): ActivePack | null {
  const p = read<ActivePack>(PACK_KEY);
  return p ? { version: p.version, quests: p.quests ?? [], screens: p.screens ?? [] } : null;
}
export function savePack(p: ActivePack) { write(PACK_KEY, p); }

export const installedVersion = (): number => loadPack()?.version ?? 0;
export const keyringVersion = (): number => read<Keyring>(KEYRING_KEY)?.version ?? 0;
export const trustedKeys = (): string[] => read<Keyring>(KEYRING_KEY)?.keys ?? BUILTIN_TRUSTED;

export function activeQuests(): QuestDef[] {
  const pack = loadPack();
  if (!pack) return SEED;
  const byId = new Map(pack.quests.map((q) => [q.id, q]));
  const replaced = SEED.map((q) => byId.get(q.id) ?? q);
  const added = pack.quests.filter((q) => !SEED.some((s) => s.id === q.id));
  return [...replaced, ...added];
}

export function activeScreens(): ScreenDef[] {
  return loadPack()?.screens ?? [];
}

export function installPack(sp: SignedPack): { ok: true; version: number } | { ok: false; reason: string } {
  const v = verifyPack(sp, installedVersion(), trustedKeys());
  if (!v.ok) return v;
  savePack({ version: sp.pack.version, quests: sp.pack.quests, screens: sp.pack.screens });
  return { ok: true, version: sp.pack.version };
}

export function installKeyring(sk: SignedKeyring): { ok: true; version: number } | { ok: false; reason: string } {
  const v = verifyKeyring(sk, keyringVersion(), trustedKeys());
  if (!v.ok) return v;
  write(KEYRING_KEY, { version: sk.keyring.version, keys: sk.keyring.keys });
  return { ok: true, version: sk.keyring.version };
}
