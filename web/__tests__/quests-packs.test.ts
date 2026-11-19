import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { QUESTS } from "../lib/seed";
import { applyEvent, currentStage, isComplete, validateQuestDef, type QuestDef } from "../lib/quests";
import { PACK_NAME, packBundle, signPack, verifyPack, type Pack } from "../lib/dtn/packs";
import { BROADCAST, addressOf, emptyDtn, newDtnIdentity, receive, makeBundle, plan, summary, type DtnIdentity, isExpired, type Bundle } from "../lib/dtn/core";
import { fromHex, toHex } from "../lib/trade";

const BASE_IDS = QUESTS.map((q) => q.id);
const q47 = QUESTS[0];

describe("multi-stage quests", () => {
  it("advances in order: visit inside the radius, then record", () => {
    let p = 0;
    // Outside the radius: no progress.
    p = applyEvent(q47, p, { kind: "visit", lat: 12.01, lng: 8.6, accuracyM: 5 });
    expect(p).toBe(0);
    // Record before arrival is ignored.
    expect(applyEvent(q47, p, { kind: "record" })).toBe(0);
    // Inside radius with good accuracy: advances to stage 2.
    p = applyEvent(q47, p, { kind: "visit", lat: 12.0022, lng: 8.592, accuracyM: 8 });
    expect(p).toBe(1);
    expect(currentStage(q47, p)?.kind).toBe("record");
    // A visit with poor accuracy does not count (and is not needed now).
    expect(applyEvent(q47, p, { kind: "visit", lat: 12.0022, lng: 8.592, accuracyM: 80 })).toBe(1);
    p = applyEvent(q47, p, { kind: "record" });
    expect(isComplete(q47, p)).toBe(true);
    // Completed quests stay completed.
    expect(applyEvent(q47, p, { kind: "record" })).toBe(p);
  });

  it("validates quest definitions strictly", () => {
    expect(validateQuestDef(q47).ok).toBe(true);
    expect(validateQuestDef({ ...q47, id: "Bad Id" }).ok).toBe(false);
    expect(validateQuestDef({ ...q47, stages: [] }).ok).toBe(false);
    expect(validateQuestDef({ ...q47, stages: [{ id: "x", kind: "visit", text: "t", lat: 999, lng: 0, radiusM: 50 }] }).ok).toBe(false);
    expect(validateQuestDef({ ...q47, type: "hack" as QuestDef["type"] }).ok).toBe(false);
  });
});

describe("signed packs", () => {
  const kp = nacl.sign.keyPair();
  const pub = toHex(kp.publicKey), sec = toHex(kp.secretKey);
  const pack = (version: number, quests: QuestDef[] = [{ ...q47, title: "The Wall Remembers (v2)" }]): Pack => ({ name: PACK_NAME, version, issued: 1, quests });

  it("installs a validly signed newer pack", () => {
    const r = verifyPack(signPack(sec, pack(2)), 1, BASE_IDS, pub);
    expect(r).toEqual({ ok: true });
  });
  it("refuses a tampered pack", () => {
    const sp = signPack(sec, pack(2));
    expect(verifyPack({ ...sp, pack: { ...sp.pack, quests: [{ ...q47, rewardPoints: 99999 }] } }, 1, BASE_IDS, pub).ok).toBe(false);
  });
  it("refuses a pack signed by another key", () => {
    const other = nacl.sign.keyPair();
    expect(verifyPack(signPack(toHex(other.secretKey), pack(2)), 1, BASE_IDS, pub).ok).toBe(false);
  });
  it("refuses rollback to an older or equal version", () => {
    expect(verifyPack(signPack(sec, pack(3)), 3, BASE_IDS, pub).ok).toBe(false);
    expect(verifyPack(signPack(sec, pack(2)), 3, BASE_IDS, pub).ok).toBe(false);
  });
  it("refuses quest ids that need an app update", () => {
    const r = verifyPack(signPack(sec, pack(2, [{ ...q47, id: "brand-new" }])), 1, BASE_IDS, pub);
    expect(r.ok).toBe(false);
  });
  it("travels as a broadcast bundle that a relay cannot forge", () => {
    const maint = { signPub: pub, signSec: sec, boxPub: toHex(nacl.box.keyPair().publicKey), boxSec: toHex(nacl.box.keyPair().secretKey) } as DtnIdentity;
    const now = 1_800_000_000;
    const b = packBundle(maint, signPack(sec, pack(2)), now, 7 * 24 * 3600);
    expect(b.dst).toBe(BROADCAST);
    const bad = { ...b, body: b.body.replace(/.$/, "0") };
    const s = emptyDtn();
    const relay = newDtnIdentity();
    const rr = receive(s, { bundles: [bad as Bundle], acks: [] }, relay, now);
    expect(rr.delivered.length).toBe(0);
    expect(s.bundles[b.id]).toBeUndefined();
  });
});

describe("pack delivery across devices", () => {
  it("reaches a device that never met the maintainer, via a relay", () => {
    const seed = nacl.sign.keyPair();
    const pub = toHex(seed.publicKey), sec = toHex(seed.secretKey);
    const maint = { signPub: pub, signSec: sec, boxPub: toHex(nacl.box.keyPair().publicKey), boxSec: toHex(nacl.box.keyPair().secretKey) } as DtnIdentity;
    const R = newDtnIdentity(), Z = newDtnIdentity();
    const now = 1_800_000_000;
    const pk: Pack = { name: PACK_NAME, version: 5, issued: now, quests: [{ ...q47, title: "Updated" }] };
    const b = packBundle(maint, signPack(sec, pk), now, 7 * 24 * 3600);
    const sm = emptyDtn(), sr = emptyDtn(), sz = emptyDtn();
    sm.bundles[b.id] = b;
    const syncPair = (a: typeof sm, ai: DtnIdentity, c: typeof sm, ci: DtnIdentity, t: number) => {
      const sa = summary(a, t), sc = summary(c, t);
      const toC = plan(a, sc, addressOf(ci), t), toA = plan(c, sa, addressOf(ai), t);
      const allow = (x: Bundle) => x.src.slice(0, 64) === pub;
      return [receive(c, toC, ci, t, { allowBroadcast: allow }).delivered, receive(a, toA, ai, t, { allowBroadcast: allow }).delivered];
    };
    syncPair(sm, maint, sr, R, now + 60);
    const [, fromZ] = syncPair(sr, R, sz, Z, now + 120);
    void fromZ;
    expect(sz.inbox.map((d) => d.kind)).toEqual(["pack"]);
    expect(isExpired(b, now + 1)).toBe(false);
    // A non-maintainer broadcast is not relayed.
    const junkId = newDtnIdentity();
    const junk = makeBundle(junkId, BROADCAST, "pack", { x: 1 }, now, 3600);
    sm.bundles[junk.id] = junk;
    syncPair(sm, maint, sr, R, now + 180);
    expect(sr.bundles[junk.id]).toBeUndefined();
    void fromHex;
  });
});
