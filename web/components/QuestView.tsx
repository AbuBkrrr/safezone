"use client";
import { useEffect, useRef, useState } from "react";
import { activeQuests } from "@/lib/content";
import { applyEvent, currentStage, isComplete, type QuestDef } from "@/lib/quests";
import { loadState, saveState } from "@/lib/store";
import { QUEST_TYPE_LABEL } from "@/lib/seed";
import { QuestRecorder } from "@/app/quests/[id]/recorder";

/** Stage-by-stage quest screen. Visit stages advance from GPS; record stages advance from evidence. */
export function QuestView({ id }: { id: string }) {
  const [def, setDef] = useState<QuestDef | null | undefined>(undefined);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const progressRef = useRef(0);

  useEffect(() => {
    const q = activeQuests().find((x) => x.id === id) ?? null;
    const p = loadState().progress[id] ?? 0;
    progressRef.current = p;
    setDef(q);
    setProgress(p);
  }, [id]);

  function commit(next: number) {
    if (!def || next === progressRef.current) return;
    progressRef.current = next;
    const s = loadState();
    s.progress = { ...s.progress, [id]: next };
    saveState(s);
    setProgress(next);
  }

  // While the current stage is a visit, watch GPS and advance on arrival.
  useEffect(() => {
    if (!def || !navigator.geolocation) return;
    const cur = currentStage(def, progressRef.current);
    if (!cur || cur.kind !== "visit") return;
    const wid = navigator.geolocation.watchPosition(
      (p) => {
        const next = applyEvent(def, progressRef.current, { kind: "visit", lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy });
        if (next !== progressRef.current) {
          commit(next);
          setStatus("Arrived. Next stage unlocked.");
        }
      },
      () => setStatus("Location is blocked. Use 'Mark arrived' to continue."),
      { enableHighAccuracy: true },
    );
    return () => navigator.geolocation.clearWatch(wid);
    // commit is stable for a given def and id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, progress]);

  if (def === undefined) return <p className="muted">Loading…</p>;
  if (def === null) return <div className="card">Quest not found. <a href="/quests/">Back to quests</a></div>;

  const cur = currentStage(def, progress);
  const done = isComplete(def, progress);

  return (
    <>
      <div className="muted">{QUEST_TYPE_LABEL[def.type]}</div>
      <h1>{def.title}</h1>
      <div className="card">
        <p style={{ marginTop: 0 }}>{def.description}</p>
        <div className="row"><span className="muted">Reward</span><span className="num">{def.rewardPoints} pts · {def.rewardCoins} coins</span></div>
      </div>
      <h2>Stages</h2>
      <div className="card">
        {def.stages.map((s, i) => {
          const state = i < progress ? "Done" : i === progress && !done ? "Current" : "Locked";
          return (
            <div className="row" key={s.id} style={{ borderTop: i === 0 ? 0 : undefined, alignItems: "flex-start" }}>
              <span>{i + 1}. {s.text}</span>
              <span className={`tag ${state === "Done" ? "" : ""}`}>{state}</span>
            </div>
          );
        })}
      </div>
      {done && <p className="msg good" role="status">All stages done. Rewards count after review.</p>}
      {!done && cur?.kind === "visit" && (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>Walk to the stage location. This unlocks automatically on arrival.</p>
          <button className="btn ghost" type="button" onClick={() => { commit(applyEvent(def, progressRef.current, { kind: "visit", lat: cur.lat!, lng: cur.lng!, accuracyM: 5 })); setStatus("Marked arrived (test)."); }}>
            Mark arrived (test position)
          </button>
        </div>
      )}
      {!done && cur?.kind === "record" && <QuestRecorder questId={def.id} title={def.title} description={cur.text} onRecorded={() => commit(applyEvent(def, progressRef.current, { kind: "record" }))} />}
      {status && <p className="muted" role="status">{status}</p>}
    </>
  );
}
