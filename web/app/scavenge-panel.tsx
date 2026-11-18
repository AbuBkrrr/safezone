"use client";
import { useEffect, useState } from "react";
import { canScavenge, distanceM, rollLoot, SCAVENGE_XP, type GpsFix } from "@/lib/game";
import { SCAVENGE_POINTS } from "@/lib/seed";
import { loadState, saveState } from "@/lib/store";
import { useNarration } from "@/components/Narrator";

const REASON = {
  no_fix: "No GPS fix. Allow location and try again.",
  low_accuracy: "GPS accuracy is worse than 50 m. Move outside and retry.",
  too_far: "You are more than 100 m from a scavenge point.",
  cooldown: "This point is on cooldown (4 h).",
} as const;

export function ScavengePanel({ onFound }: { onFound?: () => void }) {
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sim, setSim] = useState<GpsFix | null>(null);
  const [useSim, setUseSim] = useState(false);
  const narr = useNarration();

  function report(text: string, ok: boolean) {
    setMsg({ text, ok });
    narr.say(text);
  }

  function attempt(fix: GpsFix | null) {
    const nearest = [...SCAVENGE_POINTS].sort((a, b) => (fix ? distanceM(fix, a) - distanceM(fix, b) : 0))[0];
    const state = loadState();
    const nowS = Math.floor(Date.now() / 1000);
    const check = canScavenge(fix, nearest, state.last[nearest.id] ?? null, nowS);
    if (!check.ok) return report(REASON[check.reason], false);
    const loot = rollLoot("local-player", nearest.id, new Date().toISOString().slice(0, 10));
    state.inv[loot.commodity] += loot.qty;
    state.xp += SCAVENGE_XP;
    state.last[nearest.id] = nowS;
    saveState(state);
    report(`You found ${loot.qty} ${loot.commodity}. +${SCAVENGE_XP} XP`, true);
    onFound?.();
  }

  function scavengeHere() {
    setBusy(true);
    setMsg(null);
    if (useSim && sim) { attempt(sim); setBusy(false); return; }
    if (!navigator.geolocation) { report(REASON.no_fix, false); setBusy(false); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { attempt({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }); setBusy(false); },
      () => { report(REASON.no_fix, false); setBusy(false); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  // Test position for devices or browsers that cannot give a GPS fix.
  useEffect(() => { setSim({ lat: SCAVENGE_POINTS[0].lat, lng: SCAVENGE_POINTS[0].lng, accuracyM: 8 }); }, []);

  return (
    <div className="card">
      <button className="btn" onClick={scavengeHere} disabled={busy}>{busy ? "Checking GPS…" : "Scavenge here"}</button>
      <p className={`msg ${msg?.ok ? "good" : "bad"}`} role="status" aria-live="polite">{msg?.text ?? ""}</p>
      <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <input type="checkbox" checked={useSim} onChange={(e) => setUseSim(e.target.checked)} />
        Use test position (stands at the Old City Wall)
      </label>
    </div>
  );
}
