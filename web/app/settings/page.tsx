"use client";
import { useEffect, useState } from "react";
import { emptyState, loadState, saveState, type State } from "@/lib/store";
import { narrationSupported, speak } from "@/lib/voice";

export default function SettingsPage() {
  const [s, setS] = useState<State>(emptyState());
  const [confirm, setConfirm] = useState(false);
  const [voice, setVoice] = useState(false); // checked after mount so server and client render match
  useEffect(() => { setS(loadState()); setVoice(narrationSupported()); }, []);

  function update(next: State) {
    saveState(next);
    setS(next);
  }

  return (
    <>
      <h1>Settings</h1>
      <h2>Narration</h2>
      <div className="card">
        {!voice && <p className="muted">This browser has no built-in voice. Text still shows on screen.</p>}
        <label className="row" style={{ borderTop: 0 }}>
          <span>Read results aloud</span>
          <input type="checkbox" checked={s.narration.enabled} disabled={!voice} onChange={(e) => update({ ...s, narration: { ...s.narration, enabled: e.target.checked } })} />
        </label>
        <label className="row">
          <span>Speed {s.narration.rate.toFixed(1)}×</span>
          <input type="range" min={0.6} max={1.6} step={0.1} value={s.narration.rate} onChange={(e) => update({ ...s, narration: { ...s.narration, rate: Number(e.target.value) } })} style={{ width: 160 }} aria-label="Narration speed" />
        </label>
        <button className="btn ghost" type="button" disabled={!voice} onClick={() => speak("The Collapse. Scavenge, quest, trade.", true, s.narration.rate)}>Test voice</button>
        <p className="muted">Uses the voice built into your device. Nothing is downloaded, so it costs no data or storage.</p>
      </div>
      <h2>Data</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>Everything is stored on this device only. Clearing it resets inventory, trades, identity and evidence.</p>
        {!confirm ? (
          <button className="btn ghost" type="button" onClick={() => setConfirm(true)}>Clear this device's data</button>
        ) : (
          <div className="grid2">
            <button className="btn" type="button" onClick={() => { update(emptyState()); setConfirm(false); }}>Yes, clear it</button>
            <button className="btn ghost" type="button" onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        )}
      </div>
      <h2>About</h2>
      <div className="card muted">Prototype build. Native Android, Bluetooth and mesh relay, and the server backend are not part of this build.</div>
    </>
  );
}
