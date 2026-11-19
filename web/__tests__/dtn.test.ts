import { describe, expect, it } from "vitest";
import { seededRandom } from "../lib/game";
import {
  BROADCAST, MAX_BUNDLES, SPRAY_COPIES, addressOf, emptyDtn, makeAck, makeBundle, newDtnIdentity,
  openBundle, plan, prune, receive, summary, verifyAck, verifyBundle, type Bundle, type DtnIdentity, type DtnState,
} from "../lib/dtn/core";

const NOW = 1_800_000_000;
const H = 3600;

function sync(a: DtnState, ai: DtnIdentity, b: DtnState, bi: DtnIdentity, now: number) {
  const sa = summary(a, now);
  const sb = summary(b, now);
  const toB = plan(a, sb, addressOf(bi), now);
  const toA = plan(b, sa, addressOf(ai), now);
  const rb = receive(b, toB, bi, now);
  const ra = receive(a, toA, ai, now);
  return { toB: rb.delivered, toA: ra.delivered };
}

describe("bundles", () => {
  it("round-trips an encrypted message to the recipient only", () => {
    const A = newDtnIdentity(), B = newDtnIdentity(), C = newDtnIdentity();
    const b = makeBundle(A, addressOf(B), "msg", { text: "meet at the wall" }, NOW, 6 * H);
    expect(verifyBundle(b, NOW)).toBe(true);
    expect(openBundle(b, B)?.body).toEqual({ text: "meet at the wall" });
    expect(openBundle(b, C)).toBeNull();
  });

  it("relays see only ciphertext", () => {
    const A = newDtnIdentity(), B = newDtnIdentity();
    const b = makeBundle(A, addressOf(B), "msg", { text: "secret-phrase-xyz" }, NOW, H);
    expect(JSON.stringify(b)).not.toContain("secret-phrase-xyz");
  });

  it("rejects any change to a signed header", () => {
    const A = newDtnIdentity(), B = newDtnIdentity();
    const b = makeBundle(A, addressOf(B), "msg", { text: "x" }, NOW, H);
    expect(verifyBundle({ ...b, ttl: b.ttl * 10 }, NOW)).toBe(false);
    expect(verifyBundle({ ...b, dst: addressOf(newDtnIdentity()) }, NOW)).toBe(false);
    expect(verifyBundle({ ...b, body: "00" + b.body.slice(2) }, NOW)).toBe(false);
  });

  it("expires after its TTL and rejects future-dated bundles", () => {
    const A = newDtnIdentity(), B = newDtnIdentity();
    const b = makeBundle(A, addressOf(B), "msg", { text: "x" }, NOW, H);
    expect(verifyBundle(b, NOW + H - 1)).toBe(true);
    expect(verifyBundle(b, NOW + H)).toBe(false);
    const future = makeBundle(A, addressOf(B), "msg", { text: "x" }, NOW + 3600, H);
    expect(verifyBundle(future, NOW)).toBe(false);
  });
});

describe("store-carry-forward", () => {
  it("delivers via a relay and purges the sender's copy after the ack", () => {
    const A = newDtnIdentity(), B = newDtnIdentity(), C = newDtnIdentity();
    const sa = emptyDtn(), sb = emptyDtn(), sc = emptyDtn();
    const m = makeBundle(A, addressOf(C), "msg", { text: "via B" }, NOW, 6 * H);
    sa.bundles[m.id] = m;
    sync(sa, A, sb, B, NOW + 60); // A hands a spray copy to B
    expect(sb.bundles[m.id]).toBeDefined();
    const r = sync(sb, B, sc, C, NOW + 120); // B meets destination C
    expect(r.toA).toEqual([]);
    expect(sc.inbox.map((d) => d.body)).toEqual([{ text: "via B" }]);
    sync(sc, C, sa, A, NOW + 180); // ack reaches A directly
    expect(sa.bundles[m.id]).toBeUndefined();
  });

  it("spray keeps the total copies at SPRAY_COPIES", () => {
    const A = newDtnIdentity(), B = newDtnIdentity(), X = newDtnIdentity();
    const sa = emptyDtn(), sb = emptyDtn(), sx = emptyDtn();
    const m = makeBundle(A, addressOf(newDtnIdentity()), "msg", { text: "s" }, NOW, 6 * H);
    sa.bundles[m.id] = m;
    sync(sa, A, sb, B, NOW + 1);
    sync(sa, A, sx, X, NOW + 2);
    const total = (sa.bundles[m.id]?.copies ?? 0) + (sb.bundles[m.id]?.copies ?? 0) + (sx.bundles[m.id]?.copies ?? 0);
    expect(total).toBe(SPRAY_COPIES);
  });

  it("rejects a forged ack that claims another recipient", () => {
    const A = newDtnIdentity(), B = newDtnIdentity(), C = newDtnIdentity();
    const forged = { bundleId: "abc", dst: addressOf(B), at: NOW, sig: "00".repeat(64) };
    expect(verifyAck(forged)).toBe(false);
    const real = makeAck(C, "abc", NOW);
    expect(verifyAck({ ...real, dst: addressOf(B) })).toBe(false);
    expect(verifyAck(real)).toBe(true);
    void A;
  });

  it("delivers a broadcast once to every node it reaches, multi-hop", () => {
    const P = newDtnIdentity(), X = newDtnIdentity(), Y = newDtnIdentity();
    const sp = emptyDtn(), sx = emptyDtn(), sy = emptyDtn();
    const b = makeBundle(P, BROADCAST, "pack", { version: 2 }, NOW, 24 * H);
    sp.bundles[b.id] = b;
    sync(sp, P, sx, X, NOW + 1);
    const r = sync(sx, X, sy, Y, NOW + 2);
    expect(r.toB.length).toBe(1);
    expect(sy.inbox.length).toBe(1);
    sync(sx, X, sy, Y, NOW + 3);
    expect(sy.inbox.length).toBe(1); // no duplicate delivery
  });

  it("evicts the oldest bundles when the store is full", () => {
    const A = newDtnIdentity(), B = newDtnIdentity();
    const s = emptyDtn();
    for (let i = 0; i < MAX_BUNDLES + 25; i++) {
      const b = makeBundle(A, addressOf(B), "msg", { text: String(i) }, NOW + i, 6 * H);
      s.bundles[b.id] = b;
    }
    prune(s, NOW + MAX_BUNDLES + 30);
    expect(Object.keys(s.bundles).length).toBe(MAX_BUNDLES);
  });
});

// ---- Simulation: many phones moving at random, meeting over short range ----

interface Node { id: DtnIdentity; s: DtnState; x: number; y: number; tx: number; ty: number; pause: number }

function runMobility(seed: number, opts: { n: number; w: number; h: number; range: number; speed: number; dt: number; steps: number; messages: number; ttl: number }) {
  const rnd = seededRandom(seed);
  const nodes: Node[] = Array.from({ length: opts.n }, () => ({
    id: newDtnIdentity(), s: emptyDtn(),
    x: rnd() * opts.w, y: rnd() * opts.h, tx: rnd() * opts.w, ty: rnd() * opts.h, pause: 0,
  }));
  const t0 = NOW;
  const expected = new Map<string, number>(); // text -> dst index
  for (let k = 0; k < opts.messages; k++) {
    const src = Math.floor(rnd() * opts.n);
    let dst = Math.floor(rnd() * opts.n);
    if (dst === src) dst = (dst + 1) % opts.n;
    const text = `m${k}`;
    const b = makeBundle(nodes[src].id, addressOf(nodes[dst].id), "msg", { text }, t0, opts.ttl);
    nodes[src].s.bundles[b.id] = b;
    expected.set(text, dst);
  }
  const deliveredAt = new Map<string, number>();
  for (let step = 1; step <= opts.steps; step++) {
    const now = t0 + step * opts.dt;
    for (const nd of nodes) {
      if (nd.pause > 0) { nd.pause -= opts.dt; continue; }
      const dx = nd.tx - nd.x, dy = nd.ty - nd.y, d = Math.hypot(dx, dy);
      const stepLen = opts.speed * opts.dt;
      if (d <= stepLen) {
        nd.x = nd.tx; nd.y = nd.ty;
        nd.tx = rnd() * opts.w; nd.ty = rnd() * opts.h;
        nd.pause = rnd() * 600;
      } else {
        nd.x += (dx / d) * stepLen; nd.y += (dy / d) * stepLen;
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) > opts.range) continue;
        const r = sync(nodes[i].s, nodes[i].id, nodes[j].s, nodes[j].id, now);
        for (const d of r.toB) if (!deliveredAt.has(String(d.body && (d.body as { text: string }).text))) deliveredAt.set((d.body as { text: string }).text, now - t0);
        for (const d of r.toA) if (!deliveredAt.has(String((d.body as { text: string }).text))) deliveredAt.set((d.body as { text: string }).text, now - t0);
      }
    }
  }
  return { nodes, expected, deliveredAt };
}

describe("simulation", () => {
  it("delivers messages across random movement, only to the right recipient, within copy limits", () => {
    const opts = { n: 60, w: 3000, h: 3000, range: 100, speed: 1.4, dt: 10, steps: 2160, messages: 20, ttl: 6 * H };
    const { nodes, expected, deliveredAt } = runMobility(7, opts);

    // Every message reaches only its own recipient.
    nodes.forEach((nd, idx) => {
      for (const d of nd.s.inbox) {
        const text = (d.body as { text: string }).text;
        expect(expected.get(text)).toBe(idx);
      }
    });
    // Spray invariant: copies held in stores never exceed SPRAY_COPIES per message.
    const copies = new Map<string, number>();
    for (const nd of nodes) for (const b of Object.values(nd.s.bundles) as Bundle[]) copies.set(b.id, (copies.get(b.id) ?? 0) + b.copies);
    for (const total of copies.values()) expect(total).toBeLessThanOrEqual(SPRAY_COPIES);

    const ratio = deliveredAt.size / expected.size;
    console.log(`random-movement delivery: ${deliveredAt.size}/${expected.size} within 6 h (${(ratio * 100).toFixed(0)}%)`);
    expect(ratio).toBeGreaterThanOrEqual(0.75);
  });

  it("carries a message 50 km between two clusters by shuttle carriers", () => {
    const rnd = seededRandom(3);
    const dt = 60;
    const speed = 50_000 / 3600 * 1.0; // 50 km/h
    const cluster = (cx: number, n: number) => Array.from({ length: n }, () => ({ x: cx + (rnd() - 0.5) * 60, y: (rnd() - 0.5) * 60 }));
    const A = cluster(0, 5), B = cluster(50_000, 5);
    const carriers = Array.from({ length: 3 }, () => ({ x: (rnd() - 0.5) * 60, y: (rnd() - 0.5) * 60, tx: 0, pause: 0, dir: 1 }));
    const nodes = [
      ...A.map((p) => ({ ...p, id: newDtnIdentity(), s: emptyDtn(), fixed: true })),
      ...B.map((p) => ({ ...p, id: newDtnIdentity(), s: emptyDtn(), fixed: true })),
      ...carriers.map((c) => ({ x: c.x, y: c.y, id: newDtnIdentity(), s: emptyDtn(), fixed: false })),
    ] as Array<{ x: number; y: number; id: DtnIdentity; s: DtnState; fixed: boolean }>;
    const cars = nodes.slice(10);
    cars.forEach((c, i) => ((carriers[i].tx = i % 2 ? 50_000 : 0), (carriers[i].dir = i % 2 ? 1 : -1)));
    const src = nodes[0], dst = nodes[5];
    const m = makeBundle(src.id, addressOf(dst.id), "msg", { text: "across 50 km" }, NOW, 12 * H);
    src.s.bundles[m.id] = m;
    let arrived = -1;
    for (let step = 1; step <= 300 && arrived < 0; step++) {
      const now = NOW + step * dt;
      carriers.forEach((c, i) => {
        if (c.pause > 0) { c.pause -= dt; return; }
        const dx = c.tx - c.x;
        const stepLen = speed * dt;
        if (Math.abs(dx) <= stepLen) {
          c.x = c.tx;
          c.tx = c.tx === 0 ? 50_000 : 0;
          c.pause = 600;
        } else {
          c.x += Math.sign(dx) * stepLen;
        }
        nodes[10 + i].x = c.x;
        nodes[10 + i].y = c.y;
      });
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        if (nodes[i].fixed && nodes[j].fixed) continue;
        if (Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) > 100) continue;
        const r = sync(nodes[i].s, nodes[i].id, nodes[j].s, nodes[j].id, now);
        if (r.toB.length || r.toA.length) {
          if (dst.s.inbox.length && arrived < 0) arrived = step * dt;
        }
      }
    }
    expect(dst.s.inbox.map((d) => d.body)).toEqual([{ text: "across 50 km" }]);
    console.log(`50 km shuttle delivery after ${(arrived / 60).toFixed(0)} min`);
    expect(arrived).toBeGreaterThan(0);
    expect(arrived).toBeLessThanOrEqual(90 * 60);
  });
});
