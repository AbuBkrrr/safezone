// Per-device state. Browser localStorage, wrapped so the app still renders without it.
// This is a prototype store: it is not encrypted and not server-verified (see docs/).
import type { CommodityId } from "./game";
import { newIdentity } from "./trade";

export type Inventory = Record<CommodityId, number>;

export interface Receipt {
  tradeId: string;
  with: string; // counterparty public key (hex)
  give: Partial<Record<CommodityId | "coins", number>>;
  get: Partial<Record<CommodityId | "coins", number>>;
  at: number;
  sigMine: string;
  sigTheirs: string;
}

export interface Evidence {
  id: string;
  questId: string;
  durationS: number;
  gpsPoints: number;
  at: number;
  status: "pending_review";
}

export interface State {
  inv: Inventory;
  xp: number;
  coins: number;
  last: Record<string, number>; // scavenge point id -> unix seconds
  receipts: Receipt[];
  evidence: Evidence[];
  narration: { enabled: boolean; rate: number };
  identity: { pub: string; sec: string } | null;
}

export const COMMODITIES: CommodityId[] = ["grain", "water", "fuel", "tools", "medicine"];
const KEY = "collapse.state.v2";

export function emptyState(): State {
  return {
    inv: { grain: 0, water: 0, fuel: 0, tools: 0, medicine: 0 },
    xp: 0,
    coins: 0,
    last: {},
    receipts: [],
    evidence: [],
    narration: { enabled: false, rate: 1 },
    identity: null,
  };
}

export function loadState(): State {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyState();
    return { ...emptyState(), ...(JSON.parse(raw) as Partial<State>) };
  } catch {
    return emptyState();
  }
}

export function saveState(s: State): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: state stays in memory for this session */
  }
}

/** Creates the device identity on first use (Ed25519, prototype: stored in localStorage). */
export function ensureIdentity(s: State): State {
  return s.identity ? s : { ...s, identity: newIdentity() };
}
