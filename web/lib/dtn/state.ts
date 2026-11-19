// Device persistence for the DTN store and the active content pack. Browser storage, best effort.
import { emptyDtn, type DtnState } from "./core";
import type { QuestDef } from "../quests";

const DTN_KEY = "collapse.dtn.v1";
const CONTENT_KEY = "collapse.content.v1";

export function loadDtn(): DtnState {
  try {
    const raw = window.localStorage.getItem(DTN_KEY);
    return raw ? { ...emptyDtn(), ...(JSON.parse(raw) as Partial<DtnState>) } : emptyDtn();
  } catch {
    return emptyDtn();
  }
}

export function saveDtn(s: DtnState): void {
  try {
    window.localStorage.setItem(DTN_KEY, JSON.stringify(s));
  } catch {
    /* storage full or unavailable: the store stays in memory for this session */
  }
}

export interface ActivePack {
  version: number;
  quests: QuestDef[];
}

export function loadPack(): ActivePack | null {
  try {
    const raw = window.localStorage.getItem(CONTENT_KEY);
    return raw ? (JSON.parse(raw) as ActivePack) : null;
  } catch {
    return null;
  }
}

export function savePack(p: ActivePack): void {
  try {
    window.localStorage.setItem(CONTENT_KEY, JSON.stringify(p));
  } catch {
    /* best effort */
  }
}
