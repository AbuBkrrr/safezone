// The quest list the app shows: the built-in seed, with the newest verified pack applied on top.
import { QUESTS as SEED } from "./seed";
import type { QuestDef } from "./quests";
import { loadPack, savePack, type ActivePack } from "./dtn/state";
import { verifyPack, type SignedPack } from "./dtn/packs";

export const installedVersion = (): number => loadPack()?.version ?? 0;

export function activeQuests(): QuestDef[] {
  const pack = loadPack();
  if (!pack) return SEED;
  const byId = new Map(pack.quests.map((q) => [q.id, q]));
  return SEED.map((q) => byId.get(q.id) ?? q);
}

export function installPack(sp: SignedPack): { ok: true; version: number } | { ok: false; reason: string } {
  const v = verifyPack(sp, installedVersion(), SEED.map((q) => q.id));
  if (!v.ok) return v;
  const next: ActivePack = { version: sp.pack.version, quests: sp.pack.quests };
  savePack(next);
  return { ok: true, version: next.version };
}
