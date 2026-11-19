"use client";
import { useEffect, useState } from "react";
import { registerPlugin, Capacitor } from "@capacitor/core";

interface VideoStatus { id: string; title: string; installed: boolean; have: number; total: number; path: string }
interface DtnVideos { videos(): Promise<{ items: VideoStatus[] }> }
const Dtn = registerPlugin<DtnVideos>("Dtn");

/** Plays a pack video once this phone has received all its pieces. Browsers cannot receive video, so they show a note. */
export function VideoBlock({ videoId }: { videoId: string }) {
  const [v, setV] = useState<VideoStatus | null | undefined>(undefined);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) { setV(null); return; }
    let alive = true;
    const tick = async () => {
      try {
        const r = await Dtn.videos();
        if (alive) setV(r.items.find((x) => x.id === videoId) ?? null);
      } catch { if (alive) setV(null); }
    };
    tick();
    const id = window.setInterval(tick, 5000);
    return () => { alive = false; window.clearInterval(id); };
  }, [videoId]);

  if (v === undefined) return <p className="muted">Loading video…</p>;
  if (v === null) return <p className="muted">Video “{videoId}” is available in the app. Open the app on a phone to receive it.</p>;
  if (!v.installed) return <p className="muted">{v.title}: receiving {v.have} of {v.total} pieces. It completes when you meet devices that have the rest.</p>;
  return (
    <div>
      <p>{v.title}</p>
      <video controls playsInline preload="metadata" style={{ width: "100%", borderRadius: 8 }} src={Capacitor.convertFileSrc(v.path)} aria-label={v.title} />
    </div>
  );
}
