"use client";
import { useEffect, useState } from "react";
import { readInventory, type Inventory } from "@/lib/inventory";

const ORDER = ["grain", "water", "fuel", "tools", "medicine"] as const;

export default function WalletPage() {
  const [inv, setInv] = useState<Inventory>({});
  useEffect(() => setInv(readInventory()), []);
  return (
    <>
      <h1>Wallet</h1>
      <div className="card">
        <strong>XP:</strong> {inv.xp ?? 0}
      </div>
      <div className="card">
        <strong>Commodities</strong>
        <ul>
          {ORDER.map((c) => (
            <li key={c}>{c}: {inv[c] ?? 0}</li>
          ))}
        </ul>
        <p className="muted">Read-only. Coins arrive in Phase 2.</p>
      </div>
    </>
  );
}
