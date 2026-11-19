import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { QUESTS } from "../lib/seed";
import { applyEvent, currentStage, isComplete, validateQuestDef, type QuestDef } from "../lib/quests";
import { validateScreen } from "../lib/screens";
import {
  KEYRING_NAME, PACK_NAME, isTrustedSource, keyringBundle, packBundle, signKeyring, signPack,
  verifyKeyring, verifyPack, type Keyring, type Pack,
} from "../lib/dtn/packs";
import { BROADCAST, addressOf, emptyDtn, makeBundle, newDtnIdentity, receive, plan, summary, type DtnIdentity, type DtnState } from "../lib/dtn/core";
import { toHex } from "../lib/trade";

const NOW = 1_800_000_000;
const q47 = QUESTS[0];
const keypair = () => { const k = nacl.sign.keyPair(); return { pub: toHex(k.publicKey), sec: toHex(k.secretKey) }; };
const screen = (id: string) => ({ id, title: `News ${id}`, blocks: [{ type: "text" as const, text: "Hello" }] });
const pack = (version: number, quests: QuestDef[] = [q47], screens: ReturnType<typeof screen>[] = []): Pack =>
  ({ name: PACK_NAME, version, issued: NOW, quests, screens });

describe("multi-stage quests", () => {
  it("advances in order: visit inside the radius, then record", () => {
    let p = applyEvent(q47, 0, { kind: "visit", lat: 12.01, lng: 8.6, accuracyM: 5 });
    expect(p).toBe(0);
    expect(applyEvent(q47, p, { kind: "record" })).toBe(0);
    p = applyEvent(q47, p, { kind: "visit", lat: 12.0022, lng: 8.592, accuracyM: 8 });
    expect(p).toBe(1);
    expect(currentStage(q47, p)?.kind).toBe("record");
    expect(applyEvent(q47, p, { kind: "visit", lat: 12.0022, lng: 8.592, accuracyM: 80 })).toBe(1);
    p = applyEvent(q47, p, { kind: "record" });
    expect(isComplete(q47, p)).toBe(true);
    expect(applyEvent(q47, p, { kind: "record" })).toBe(p);
  });

  it("validates quest definitions strictly", () => {
    expect(validateQuestDef(q47).ok).toBe(true);
    expect(validateQuestDef({ ...q47, id: "Bad Id" }).ok).toBe(false);
    expect(validateQuestDef({ ...q47, stages: [] }).ok).toBe(false);
    expect(validateQuestDef({ ...q47, type: "hack" as QuestDef["type"] }).ok).toBe(false);
  });
});

describe("screens", () => {
  it("accepts known blocks and refuses anything else", () => {
    expect(validateScreen(screen("news-1")).ok).toBe(true);
    expect(validateScreen({ id: "x", title: "t", blocks: [{ type: "script", code: "alert(1)" }] }).ok).toBe(false);
    expect(validateScreen({ id: "x", title: "t", blocks: [{ type: "link", label: "go", screenId: "BAD ID" }] }).ok).toBe(false);
  });
});

describe("signed packs and key rotation", () => {
  const maint = keypair();

  it("accepts a newer pack that adds a new quest and a screen", () => {
    const sp = signPack(maint.sec, pack(1, [{ ...q47, id: "brand-new" }], [screen("news-1")]));
    expect(verifyPack(sp, 0, [maint.pub])).toEqual({ ok: true });
  });
  it("refuses tampering, untrusted signers, rollback, and bad screens", () => {
    const sp = signPack(maint.sec, pack(2));
    expect(verifyPack({ ...sp, pack: { ...sp.pack, quests: [{ ...q47, rewardPoints: 99999 }] } }, 1, [maint.pub]).ok).toBe(false);
    expect(verifyPack(signPack(keypair().sec, pack(2)), 1, [maint.pub]).ok).toBe(false);
    expect(verifyPack(sp, 2, [maint.pub]).ok).toBe(false);
    expect(verifyPack(signPack(maint.sec, pack(2, [q47], [{ id: "s", title: "t", blocks: [{ type: "script" } as never] }])), 1, [maint.pub]).ok).toBe(false);
  });

  it("rotates keys: the old key signs a keyring adding the new key, then retires itself", () => {
    const oldK = keypair(), newK = keypair();
    const k1: Keyring = { name: KEYRING_NAME, version: 1, keys: [oldK.pub, newK.pub] };
    expect(verifyKeyring(signKeyring(oldK.sec, k1), 0, [oldK.pub])).toEqual({ ok: true });
    const k2: Keyring = { name: KEYRING_NAME, version: 2, keys: [newK.pub] };
    expect(verifyKeyring(signKeyring(oldK.sec, k2), 1, [oldK.pub, newK.pub])).toEqual({ ok: true });
    // After rotation only the new key is trusted.
    expect(verifyPack(signPack(oldK.sec, pack(5)), 0, [newK.pub]).ok).toBe(false);
    expect(verifyPack(signPack(newK.sec, pack(5)), 0, [newK.pub]).ok).toBe(true);
  });

  it("refuses a forged or replayed keyring", () => {
    const evil = keypair();
    const forged: Keyring = { name: KEYRING_NAME, version: 9, keys: [evil.pub] };
    expect(verifyKeyring(signKeyring(evil.sec, forged), 0, [maint.pub]).ok).toBe(false);
    const old: Keyring = { name: KEYRING_NAME, version: 2, keys: [maint.pub] };
    expect(verifyKeyring(signKeyring(maint.sec, old), 2, [maint.pub]).ok).toBe(false);
  });
});

describe("pack delivery over the DTN", () => {
  it("reaches a device that never met the maintainer, via a relay, and only trusted sources are relayed", () => {
    const maint = keypair();
    const mId: DtnIdentity = { signPub: maint.pub, signSec: maint.sec, boxPub: toHex(nacl.box.keyPair().publicKey), boxSec: toHex(nacl.box.keyPair().secretKey) };
    const R = newDtnIdentity(), Z = newDtnIdentity();
    const trusted = [maint.pub];
    const sm = emptyDtn(), sr = emptyDtn(), sz = emptyDtn();
    const b = packBundle(mId, signPack(maint.sec, pack(5)), NOW, 7 * 24 * 3600);
    sm.bundles[b.id] = b;
    const sync = (a: DtnState, ai: DtnIdentity, c: DtnState, ci: DtnIdentity, t: number) => {
      const sa = summary(a, t), sc = summary(c, t);
      const toC = plan(a, sc, addressOf(ci), t), toA = plan(c, sa, addressOf(ai), t);
      const allow = (x: { src: string }) => isTrustedSource(x.src, trusted);
      receive(c, toC, ci, t, { allowBroadcast: allow });
      receive(a, toA, ai, t, { allowBroadcast: allow });
    };
    sync(sm, mId, sr, R, NOW + 60);
    sync(sr, R, sz, Z, NOW + 120);
    expect(sz.inbox.map((d) => d.kind)).toEqual(["pack"]);

    const junkSender = newDtnIdentity();
    const junk = makeBundle(junkSender, BROADCAST, "pack", { x: 1 }, NOW, 3600);
    sm.bundles[junk.id] = junk;
    sync(sm, mId, sr, R, NOW + 180);
    expect(sr.bundles[junk.id]).toBeUndefined();
    void keyringBundle;
  });
});

describe("video packs", () => {
  const maint = keypair();
  const data = new Uint8Array(40000).map((_, i) => (i * 31) & 255);
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  const cs = 16384;
  const hashes = [0, 1, 2].map((i) => sha(data.subarray(i * cs, (i + 1) * cs)));
  const video = { id: "clip-1", title: "Clip", size: data.length, sha256: sha(data), chunkSize: cs, chunkHashes: hashes };

  it("accepts a video-only pack and a video screen block", () => {
    const sp = signPack(maint.sec, { name: PACK_NAME, version: 1, issued: NOW, quests: [], screens: [{ id: "s1", title: "Clip", blocks: [{ type: "video", videoId: "clip-1" }] }], videos: [video] });
    expect(verifyPack(sp, 0, [maint.pub])).toEqual({ ok: true });
  });
  it("refuses a video whose piece hashes do not match its size", () => {
    const bad = { ...video, chunkHashes: hashes.slice(1) };
    const sp = signPack(maint.sec, { name: PACK_NAME, version: 1, issued: NOW, quests: [], screens: [], videos: [bad] });
    expect(verifyPack(sp, 0, [maint.pub]).ok).toBe(false);
  });
  it("refuses an unsigned change to a video", () => {
    const sp = signPack(maint.sec, { name: PACK_NAME, version: 1, issued: NOW, quests: [], screens: [], videos: [video] });
    expect(verifyPack({ ...sp, pack: { ...sp.pack, videos: [{ ...video, sha256: "00".repeat(32) }] } }, 0, [maint.pub]).ok).toBe(false);
  });
});
