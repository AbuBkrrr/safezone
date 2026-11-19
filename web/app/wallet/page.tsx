"use client";
import { useEffect, useState } from "react";
import { COMMODITIES, emptyState, loadState, type State } from "@/lib/store";

export default function WalletPage() {
  const [s, setS] = useState<State>(emptyState());
  useEffect(() => setS(loadState()), []);
  return (
    <>
      <h1>Wallet</h1>
      <div className="card">
        <div className="row" style={{ borderTop: 0 }}><span>XP</span><span className="num">{s.xp}</span></div>
        <div className="row"><span>Coins</span><span className="num">{s.coins}</span></div>
      </div>
      <h2>Commodities</h2>
      <div className="card">
        {COMMODITIES.map((c) => (
          <div className="row" key={c} style={{ borderTop: c === COMMODITIES[0] ? 0 : undefined }}>
            <span style={{ textTransform: "capitalize" }}>{c}</span>
            <span className="num">{s.inv[c]}</span>
          </div>
        ))}
      </div>
      <h2>Trades</h2>
      <div className="card">
        {s.receipts.length === 0 && <span className="muted">No trades yet. Trades are signed by both players.</span>}
        {s.receipts.map((r) => (
          <div className="row" key={r.tradeId + r.at} style={{ display: "block" }}>
            <div>Gave {JSON.stringify(r.give)} · got {JSON.stringify(r.get)}</div>
            <div className="code">with {r.with.slice(0, 12)}… · {new Date(r.at).toLocaleString()}</div>
          </div>
        ))}
      </div>
      <p className="muted">This wallet stays on this device. Quest coins need review before they count.</p>
      <p className="muted code">Identity {s.identity ? s.identity.pub.slice(0, 16) + "…" : "created on first transfer"}</p>
    </>
  );
}
