"use client";
import { useState } from "react";
import { canScavenge, rollLoot, SCAVENGE_XP, type GpsFix, type ScavengeCheck } from "@/lib/game";
import { SCAVENGE_POINTS } from "@/lib/seed";
import { readInventory, writeInventory } from "@/lib/inventory";

const REASON: Record<Exclude<ScavengeCheck, { ok: true }>["reason"], string> = {
  no_fix: "No GPS fix. Allow location and try again.",
  low_accuracy: "GPS accuracy is worse than 50 m. Move outside and retry.",
  too_far: "You are more than 100 m from a scavenge point.",
  cooldown: "This point is on cooldown (4 h).",
};

export function ScavengePanel() {
  const [msg, setMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);

  function scavengeHere() {
    setBusy(true);
    setMsg("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const fix: GpsFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy };
        const nowS = Math.floor(Date.now() / 1000);
        const inv = readInventory();
        const nearest = [...SCAVENGE_POINTS].sort(
          (a, b) => Math.hypot(a.lat - fix.lat, a.lng - fix.lng) - Math.hypot(b.lat - fix.lat, b.lng - fix.lng),
        )[0];
        const last = inv[`last:${nearest.id}` as keyof typeof inv] as number | undefined;
        const check = canScavenge(fix, nearest, last ?? null, nowS);
        if (!check.ok) {
          setMsg(REASON[check.reason]);
        } else {
          const day = new Date().toISOString().slice(0, 10);
          const loot = rollLoot("local-player", nearest.id, day);
          const next = { ...inv };
          next[loot.commodity] = (next[loot.commodity] ?? 0) + loot.qty;
          next.xp = (next.xp ?? 0) + SCAVENGE_XP;
          (next as Record<string, number>)[`last:${nearest.id}`] = nowS;
          writeInventory(next);
          setMsg(`You found ${loot.qty}× ${loot.commodity}! +${SCAVENGE_XP} XP`);
        }
        setBusy(false);
      },
      () => {
        setMsg(REASON.no_fix);
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  return (
    <div className="card">
      <button onClick={scavengeHere} disabled={busy}>{busy ? "Checking GPS…" : "Scavenge here"}</button>
      {msg && <p className="result" role="status">{msg}</p>}
    </div>
  );
}
