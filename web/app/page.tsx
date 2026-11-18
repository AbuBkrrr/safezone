"use client";
import { useEffect, useState } from "react";
import { distanceM, type GpsFix } from "@/lib/game";
import { SCAVENGE_POINTS } from "@/lib/seed";
import { ScavengePanel } from "./scavenge-panel";

export default function Home() {
  const [pos, setPos] = useState<GpsFix | null>(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
      () => {},
      { enableHighAccuracy: true },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return (
    <>
      <h1>Scavenge</h1>
      <p className="muted">Stand within 100 m of a point, with GPS accuracy under 50 m. Each point has a 4-hour cooldown.</p>
      <h2>Points</h2>
      {SCAVENGE_POINTS.map((p) => {
        const d = pos ? Math.round(distanceM(pos, p)) : null;
        return (
          <div className="card" key={p.id}>
            <div className="row" style={{ borderTop: 0, padding: 0 }}>
              <strong>{p.name}</strong>
              {d !== null && d <= 100 && <span className="tag">in range</span>}
            </div>
            <div className="muted">{d === null ? "Waiting for position" : d >= 1000 ? `${(d / 1000).toFixed(1)} km away` : `${d} m away`}</div>
          </div>
        );
      })}
      <h2>Scavenge</h2>
      <ScavengePanel />
    </>
  );
}
