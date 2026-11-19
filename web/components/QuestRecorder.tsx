"use client";
import { useEffect, useRef, useState } from "react";
import type { Evidence } from "@/lib/store";
import { loadState, saveState } from "@/lib/store";
import { useNarration, ReadAloud } from "@/components/Narrator";

const MAX_S = 15; // spec 1.3: 15 s max
const TRAIL_MS = 2000; // spec 1.3: GPS trail every 2 s

/**
 * In-app camera only (spec constraint 6). No file import: the page never reads gallery files.
 * Browsers cannot set FLAG_SECURE, so screen capture is blocked only by the OS, not by this page.
 */
export function QuestRecorder({ questId, title, description, onRecorded }: { questId: string; title: string; description: string; onRecorded?: () => void }) {
  const [phase, setPhase] = useState<"idle" | "recording" | "done" | "error">("idle");
  const [secs, setSecs] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const trailRef = useRef<number>(0);
  const watchRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const narr = useNarration();

  useEffect(() => () => stopAll(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function stopAll() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (watchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function start() {
    setMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: true });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
      const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : undefined });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || "video/webm" });
        setPreview(URL.createObjectURL(blob));
        const s = loadState();
        s.evidence = [{ id: `ev-${Date.now()}`, questId, durationS: Math.min(MAX_S, secs + 1), gpsPoints: trailRef.current, at: Date.now(), status: "pending_review" as const }, ...s.evidence].slice(0, 100);
        saveState(s);
        setPhase("done");
        setMsg("Recorded. Evidence waits for review before rewards count.");
        onRecorded?.();
        narr.say("Recording saved. It waits for review.");
        stopAll();
      };
      recRef.current = rec;
      trailRef.current = 0;
      if (navigator.geolocation) {
        let last = 0;
        watchRef.current = navigator.geolocation.watchPosition(() => {
          if (Date.now() - last >= TRAIL_MS) { last = Date.now(); trailRef.current += 1; }
        }, () => {}, { enableHighAccuracy: true });
      }
      rec.start();
      setPhase("recording");
      setSecs(0);
      narr.say(`Recording. ${description}`);
      let n = 0;
      timerRef.current = window.setInterval(() => {
        n += 1;
        setSecs(n);
        if (n >= MAX_S && rec.state !== "inactive") rec.stop();
      }, 1000);
    } catch {
      setPhase("error");
      setMsg("Camera or microphone is blocked. Allow access in the browser and try again.");
      narr.say("The camera is blocked.");
      stopAll();
    }
  }

  function stop() {
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
  }

  const [done, setDone] = useState<Evidence[]>([]);
  useEffect(() => setDone(loadState().evidence.filter((e) => e.questId === questId)), [questId, phase]);

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Evidence</h2>
      {phase !== "recording" && phase !== "done" && (
        <button className="btn" onClick={start} type="button">Record evidence ({MAX_S} s max)</button>
      )}
      {phase === "recording" && (
        <>
          <video ref={videoRef} muted playsInline aria-label="Camera preview" />
          <p className="msg bad" role="status">Recording {secs}/{MAX_S} s</p>
          <button className="btn" onClick={stop} type="button">Stop recording</button>
        </>
      )}
      {phase === "done" && preview && (
        <>
          <video src={preview} controls playsInline aria-label="Recorded evidence" />
          <p className="msg good" role="status">{msg}</p>
        </>
      )}
      {phase === "error" && <p className="msg bad" role="alert">{msg}</p>}
      <ReadAloud text={`${title}. ${description}`} />
      {done.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="muted">Submissions on this device</div>
          {done.map((e) => (
            <div className="row" key={e.id}><span>{new Date(e.at).toLocaleString()}</span><span className="tag">{e.status.replace("_", " ")}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}
