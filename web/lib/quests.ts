// Multi-stage quests: definitions, validation, and stage progression.
import { distanceM } from "./game";

export const QUEST_TYPES = ["locate_prove", "build_make", "decode_act", "interview", "relay"] as const;
export type QuestType = (typeof QUEST_TYPES)[number];
export type StageKind = "visit" | "record";

export interface StageDef {
  id: string;
  kind: StageKind;
  text: string;
  lat?: number; // visit stages only
  lng?: number;
  radiusM?: number;
}

export interface QuestDef {
  id: string;
  type: QuestType;
  title: string;
  description: string;
  stages: StageDef[];
  rewardPoints: number;
  rewardCoins: number;
}

export type QuestEvent = { kind: "visit"; lat: number; lng: number; accuracyM: number } | { kind: "record" };

const ID = /^[a-z0-9-]{1,40}$/;
const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** Strict validation for quest definitions from packs. Returns a reason on failure. */
export function validateQuestDef(q: unknown): { ok: true; def: QuestDef } | { ok: false; reason: string } {
  const d = q as Partial<QuestDef> | null;
  if (!d || typeof d !== "object") return { ok: false, reason: "quest is not an object" };
  if (typeof d.id !== "string" || !ID.test(d.id)) return { ok: false, reason: "bad quest id" };
  if (!QUEST_TYPES.includes(d.type as QuestType)) return { ok: false, reason: `bad type for ${d.id}` };
  if (!isStr(d.title, 80) || !isStr(d.description, 500)) return { ok: false, reason: `bad text for ${d.id}` };
  if (!isNum(d.rewardPoints, 0, 10000) || !isNum(d.rewardCoins, 0, 1000)) return { ok: false, reason: `bad reward for ${d.id}` };
  if (!Array.isArray(d.stages) || d.stages.length < 1 || d.stages.length > 8) return { ok: false, reason: `need 1-8 stages in ${d.id}` };
  const seen = new Set<string>();
  for (const s of d.stages as Partial<StageDef>[]) {
    if (typeof s.id !== "string" || !ID.test(s.id) || seen.has(s.id)) return { ok: false, reason: `bad stage id in ${d.id}` };
    seen.add(s.id);
    if (!isStr(s.text, 200)) return { ok: false, reason: `bad stage text in ${d.id}` };
    if (s.kind === "visit") {
      if (!isNum(s.lat, -90, 90) || !isNum(s.lng, -180, 180) || !isNum(s.radiusM, 10, 1000)) return { ok: false, reason: `bad visit location in ${d.id}` };
    } else if (s.kind !== "record") {
      return { ok: false, reason: `bad stage kind in ${d.id}` };
    }
  }
  return { ok: true, def: d as QuestDef };
}

/** Index of the stage the player is on. progress = number of completed stages. */
export function currentStage(q: QuestDef, progress: number): StageDef | null {
  return q.stages[progress] ?? null;
}

export function isComplete(q: QuestDef, progress: number): boolean {
  return progress >= q.stages.length;
}

/** Returns the new progress after an event. Only the current stage can be completed, and only in order. */
export function applyEvent(q: QuestDef, progress: number, ev: QuestEvent): number {
  const stage = currentStage(q, progress);
  if (!stage) return progress;
  if (ev.kind === "record" && stage.kind === "record") return progress + 1;
  if (ev.kind === "visit" && stage.kind === "visit" && ev.accuracyM <= 50) {
    const d = distanceM({ lat: ev.lat, lng: ev.lng }, { lat: stage.lat!, lng: stage.lng! });
    if (d <= stage.radiusM!) return progress + 1;
  }
  return progress;
}
