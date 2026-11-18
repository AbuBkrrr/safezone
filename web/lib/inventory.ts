// Per-device inventory. Demo only: stored in localStorage, not server-verified.
import type { CommodityId } from "./game";

const KEY = "collapse.inventory.v1";
export type Inventory = Partial<Record<CommodityId, number>> & { xp?: number };

export function readInventory(): Inventory {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Inventory) : {};
  } catch {
    return {};
  }
}

export function writeInventory(inv: Inventory): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(inv));
  } catch {
    /* storage unavailable (private window): game still renders */
  }
}
