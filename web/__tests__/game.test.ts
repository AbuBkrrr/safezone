import { describe, expect, it } from "vitest";
import { canScavenge, distanceM, hash32, rollLoot, seededRandom, SCAVENGE_XP } from "../lib/game";

const point = { id: "p1", name: "Wall", lat: 12.0022, lng: 8.5920 };

describe("distanceM", () => {
  it("is zero for the same point", () => {
    expect(distanceM(point, point)).toBeCloseTo(0, 6);
  });
  it("is about 111 km per degree of latitude", () => {
    const d = distanceM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_300);
  });
});

describe("canScavenge", () => {
  const now = 1_000_000;
  it("rejects a missing fix", () => {
    expect(canScavenge(null, point, null, now)).toEqual({ ok: false, reason: "no_fix" });
  });
  it("rejects GPS accuracy worse than 50 m", () => {
    expect(canScavenge({ ...point, accuracyM: 51 }, point, null, now)).toEqual({
      ok: false,
      reason: "low_accuracy",
    });
  });
  it("rejects a player more than 100 m away", () => {
    const far = { lat: point.lat + 0.001, lng: point.lng, accuracyM: 5 }; // ~111 m north
    expect(canScavenge(far, point, null, now)).toEqual({ ok: false, reason: "too_far" });
  });
  it("enforces a 4-hour cooldown per point", () => {
    const here = { ...point, accuracyM: 5 };
    expect(canScavenge(here, point, now - 3 * 3600, now)).toEqual({ ok: false, reason: "cooldown" });
    expect(canScavenge(here, point, now - 5 * 3600, now)).toEqual({ ok: true });
  });
  it("allows a scavenge within range, accurate, and off cooldown", () => {
    expect(canScavenge({ ...point, accuracyM: 10 }, point, null, now)).toEqual({ ok: true });
  });
});

describe("rollLoot", () => {
  it("is deterministic for the same player, point and day", () => {
    expect(rollLoot("pk", "p1", "2026-11-18")).toEqual(rollLoot("pk", "p1", "2026-11-18"));
  });
  it("changes with the day", () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 60; d++) {
      const r = rollLoot("pk", "p1", `2026-11-${String(d).padStart(2, "0")}`);
      seen.add(`${r.commodity}:${r.qty}`);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
  it("returns quantities within the spec ranges", () => {
    for (let i = 0; i < 2000; i++) {
      const r = rollLoot(`player${i}`, "p1", "day");
      if (r.commodity === "grain") expect(r.qty).toBeGreaterThanOrEqual(1);
      if (r.commodity === "grain") expect(r.qty).toBeLessThanOrEqual(4);
      if (r.commodity === "water") expect(r.qty).toBeLessThanOrEqual(3);
      if (["fuel", "tools", "medicine"].includes(r.commodity)) expect(r.qty).toBe(1);
    }
  });
  it("matches the spec loot distribution within tolerance", () => {
    const counts: Record<string, number> = {};
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const r = rollLoot(`player${i}`, "p1", "day");
      counts[r.commodity] = (counts[r.commodity] ?? 0) + 1;
    }
    expect(counts.grain / N).toBeCloseTo(0.6, 1);
    expect(counts.water / N).toBeCloseTo(0.25, 1);
    expect(counts.fuel / N).toBeCloseTo(0.1, 1);
    expect(counts.tools / N).toBeCloseTo(0.04, 1);
    expect(counts.medicine / N).toBeLessThan(0.03);
  });
});

describe("prng helpers", () => {
  it("seededRandom yields values in [0,1)", () => {
    const rng = seededRandom(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it("hash32 is stable", () => {
    expect(hash32("abc")).toBe(hash32("abc"));
    expect(hash32("abc")).not.toBe(hash32("abd"));
  });
  it("uses 25 XP per scavenge", () => {
    expect(SCAVENGE_XP).toBe(25);
  });
});
