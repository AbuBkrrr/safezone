import { describe, expect, it } from "vitest";
import { canonical } from "../lib/canonical";
import { applyTrade, canPay, newIdentity, signTrade, verifyTrade, type TradeOffer } from "../lib/trade";
import { emptyState } from "../lib/store";

describe("canonical", () => {
  it("sorts keys and has no whitespace", () => {
    expect(canonical({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
  });
});

describe("signed trades", () => {
  const maker = newIdentity();
  const taker = newIdentity();
  const offer: TradeOffer = { id: "t1", from: maker.pub, give: { medicine: 1 }, get: { grain: 5 }, at: 1 };

  it("verifies a signature made with the matching key", () => {
    const sig = signTrade(maker.sec, offer);
    expect(verifyTrade(maker.pub, offer, sig)).toBe(true);
  });
  it("rejects a tampered offer", () => {
    const sig = signTrade(maker.sec, offer);
    expect(verifyTrade(maker.pub, { ...offer, get: { grain: 50 } }, sig)).toBe(false);
  });
  it("rejects a signature from another key", () => {
    const sig = signTrade(taker.sec, offer);
    expect(verifyTrade(maker.pub, offer, sig)).toBe(false);
  });
});

describe("applyTrade", () => {
  const maker = newIdentity();
  const taker = newIdentity();
  const offer: TradeOffer = { id: "t2", from: maker.pub, give: { medicine: 1 }, get: { grain: 5, coins: 2 }, at: 1 };

  it("canPay checks commodities and coins", () => {
    const s = emptyState();
    s.inv.grain = 4;
    expect(canPay({ grain: 4 }, s.inv, 0)).toBe(true);
    expect(canPay({ grain: 5 }, s.inv, 0)).toBe(false);
    expect(canPay({ coins: 1 }, s.inv, 0)).toBe(false);
  });

  it("moves goods on both sides of a fully signed trade", () => {
    const makerState = { ...emptyState(), inv: { ...emptyState().inv, medicine: 1 } };
    const sigMaker = signTrade(maker.sec, offer);
    const sigTaker = signTrade(taker.sec, offer);
    // Maker side: gives medicine, receives grain + 2 coins.
    const afterMaker = applyTrade(makerState, offer, taker.pub, sigMaker, sigTaker, maker.pub, true);
    expect(afterMaker.inv.medicine).toBe(0);
    expect(afterMaker.inv.grain).toBe(5);
    expect(afterMaker.coins).toBe(2);
    // Taker side: receives medicine, pays grain + 2 coins.
    const takerState = { ...emptyState(), inv: { ...emptyState().inv, grain: 5 }, coins: 2 };
    const afterTaker = applyTrade(takerState, offer, maker.pub, sigTaker, sigMaker, taker.pub, false);
    expect(afterTaker.inv.medicine).toBe(1);
    expect(afterTaker.inv.grain).toBe(0);
    expect(afterTaker.coins).toBe(0);
    expect(afterTaker.receipts).toHaveLength(1);
  });

  it("refuses a trade the player cannot pay", () => {
    const s = emptyState();
    expect(() => applyTrade(s, offer, taker.pub, signTrade(maker.sec, offer), signTrade(taker.sec, offer), maker.pub, true)).toThrow(/insufficient/);
  });

  it("refuses a trade whose counterparty signature is invalid", () => {
    const makerState = { ...emptyState(), inv: { ...emptyState().inv, medicine: 1 } };
    expect(() => applyTrade(makerState, offer, taker.pub, "", signTrade(maker.sec, offer), maker.pub, true)).toThrow(/signature/);
  });
});
