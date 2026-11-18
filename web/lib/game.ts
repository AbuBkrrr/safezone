// Pure game rules from the spec (sections 2.4, 4.8, 4.10). No I/O here.

export type CommodityId = "grain" | "water" | "fuel" | "tools" | "medicine";

export interface ScavengePoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface GpsFix {
  lat: number;
  lng: number;
  accuracyM: number;
}

export interface Quest {
  id: string;
  type: "locate_prove" | "build_make" | "decode_act" | "interview" | "relay";
  title: string;
  description: string;
  lat: number;
  lng: number;
  radiusM: number;
  rewardPoints: number;
  rewardCoins: number;
}

const EARTH_RADIUS_M = 6_371_000;
const COOLDOWN_S = 4 * 3600;
const MAX_ACCURACY_M = 50;
const MAX_DISTANCE_M = 100;

/** Great-circle distance in metres (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type ScavengeCheck =
  | { ok: true }
  | { ok: false; reason: "no_fix" | "low_accuracy" | "too_far" | "cooldown" };

/** Spec 4.8 steps 1 and 3: GPS accuracy, distance, and per-point cooldown. */
export function canScavenge(
  fix: GpsFix | null,
  point: ScavengePoint,
  lastScavengeAt: number | null,
  nowS: number,
): ScavengeCheck {
  if (!fix) return { ok: false, reason: "no_fix" };
  if (fix.accuracyM > MAX_ACCURACY_M) return { ok: false, reason: "low_accuracy" };
  if (distanceM(fix, point) > MAX_DISTANCE_M) return { ok: false, reason: "too_far" };
  if (lastScavengeAt !== null && lastScavengeAt > nowS - COOLDOWN_S) {
    return { ok: false, reason: "cooldown" };
  }
  return { ok: true };
}

/** Deterministic PRNG (mulberry32) seeded from a 32-bit integer. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash of a string. Used to derive seeds; not a cryptographic hash. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface LootResult {
  commodity: CommodityId;
  qty: number;
}

/**
 * Spec 4.8 step 4: loot table. Seeded by player + point + day, so the result is
 * deterministic per player, point and day.
 */
export function rollLoot(playerKey: string, pointId: string, day: string): LootResult {
  const rng = seededRandom(hash32(`${playerKey}|${pointId}|${day}`));
  const roll = rng();
  const intIn = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  if (roll < 0.6) return { commodity: "grain", qty: intIn(1, 4) };
  if (roll < 0.85) return { commodity: "water", qty: intIn(1, 3) };
  if (roll < 0.95) return { commodity: "fuel", qty: 1 };
  if (roll < 0.99) return { commodity: "tools", qty: 1 };
  return { commodity: "medicine", qty: 1 };
}

export const SCAVENGE_XP = 25;
