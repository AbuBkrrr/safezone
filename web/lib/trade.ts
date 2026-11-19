// Barter / coin trades with Ed25519 signatures from both parties (spec 1.6, 4.6).
import nacl from "tweetnacl";
import { canonical } from "./canonical";
import type { CommodityId } from "./game";
import type { Inventory, Receipt, State } from "./store";

export type Bundle = Partial<Record<CommodityId | "coins", number>>;

export interface TradeOffer {
  id: string;
  from: string; // maker public key (hex)
  give: Bundle; // what the maker gives
  get: Bundle; // what the maker wants back
  at: number;
}

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

export function newIdentity(): { pub: string; sec: string } {
  const kp = nacl.sign.keyPair();
  return { pub: toHex(kp.publicKey), sec: toHex(kp.secretKey) };
}

/** The bytes both parties sign: the trade id and its terms, canonicalised. */
export function tradeMessage(offer: TradeOffer): Uint8Array {
  return new TextEncoder().encode("collapse-trade-v1|" + canonical({ id: offer.id, give: offer.give, get: offer.get, from: offer.from }));
}

export function signTrade(sec: string, offer: TradeOffer): string {
  return toHex(nacl.sign.detached(tradeMessage(offer), fromHex(sec)));
}

export function verifyTrade(pub: string, offer: TradeOffer, sig: string): boolean {
  return nacl.sign.detached.verify(tradeMessage(offer), fromHex(sig), fromHex(pub));
}

/** Can `bundle` be paid from `inv` and `coins`? */
export function canPay(bundle: Bundle, inv: Inventory, coins: number): boolean {
  for (const [k, v] of Object.entries(bundle)) {
    if (!v || v < 0) return false;
    if (k === "coins") { if (coins < v) return false; }
    else if ((inv[k as CommodityId] ?? 0) < v) return false;
  }
  return true;
}

/**
 * Apply a fully signed trade to local state. The maker gives `offer.give` and gets `offer.get`.
 * Returns a new state, or throws if the trade cannot be paid or a signature fails.
 */
export function applyTrade(
  state: State,
  offer: TradeOffer,
  counterparty: string,
  sigMine: string,
  sigTheirs: string,
  myPub: string,
  iAmMaker: boolean,
): State {
  // Both signatures must verify against their own keys over the same trade body.
  if (!verifyTrade(counterparty, offer, sigTheirs)) throw new Error("counterparty signature invalid");
  if (!verifyTrade(myPub, offer, sigMine)) throw new Error("my signature invalid");
  // What I give and get, from my side.
  const give = iAmMaker ? offer.give : offer.get;
  const get = iAmMaker ? offer.get : offer.give;
  if (!canPay(give, state.inv, state.coins)) throw new Error("insufficient commodities or coins");

  const inv = { ...state.inv };
  let coins = state.coins;
  for (const [k, v] of Object.entries(give)) {
    if (!v) continue;
    if (k === "coins") coins -= v;
    else inv[k as CommodityId] -= v;
  }
  for (const [k, v] of Object.entries(get)) {
    if (!v) continue;
    if (k === "coins") coins += v;
    else inv[k as CommodityId] += v;
  }
  const receipt: Receipt = {
    tradeId: offer.id,
    with: counterparty,
    give,
    get,
    at: Date.now(),
    sigMine,
    sigTheirs,
  };
  return { ...state, inv, coins, receipts: [receipt, ...state.receipts].slice(0, 200) };
}
