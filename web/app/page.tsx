import { SCAVENGE_POINTS } from "@/lib/seed";
import { ScavengePanel } from "./scavenge-panel";

export default function Home() {
  return (
    <>
      <h1>Scavenge</h1>
      <p className="muted">Stand within 100 m of a point with GPS accuracy under 50 m.</p>
      {SCAVENGE_POINTS.map((p) => (
        <div className="card" key={p.id}>
          <strong>{p.name}</strong>
          <div className="muted">{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</div>
        </div>
      ))}
      <ScavengePanel />
    </>
  );
}
