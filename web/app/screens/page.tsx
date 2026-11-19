"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { activeScreens } from "@/lib/content";
import type { Block, ScreenDef } from "@/lib/screens";
import { VideoBlock } from "@/components/VideoBlock";

// Screens from packs. ?id= shows one screen. Blocks are drawn with fixed components only.
function BlockView({ b }: { b: Block }) {
  if (b.type === "text") return <p>{b.text}</p>;
  if (b.type === "list") return <ul>{b.items.map((i, n) => <li key={n}>{i}</li>)}</ul>;
  if (b.type === "video") return <VideoBlock videoId={b.videoId} />;
  if (b.type === "quest") return <p><Link href={`/quests/detail/?id=${b.questId}`}>Open quest</Link></p>;
  return <p><Link href={`/screens/?id=${b.screenId}`}>{b.label}</Link></p>;
}

export default function ScreensPage() {
  const [screens, setScreens] = useState<ScreenDef[] | null>(null);
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    setScreens(activeScreens());
    setId(new URLSearchParams(window.location.search).get("id"));
  }, []);
  if (screens === null) return <p className="muted">Loading…</p>;
  if (id) {
    const s = screens.find((x) => x.id === id);
    if (!s) return <div className="card">Screen not found. <Link href="/screens/">All screens</Link></div>;
    return (
      <>
        <h1>{s.title}</h1>
        <div className="card">{s.blocks.map((b, i) => <BlockView key={i} b={b} />)}</div>
        <p><Link href="/screens/">← All screens</Link></p>
      </>
    );
  }
  return (
    <>
      <h1>News</h1>
      {screens.length === 0 && <p className="muted">Nothing here yet. New screens arrive with updates.</p>}
      {screens.map((s) => (
        <Link key={s.id} href={`/screens/?id=${s.id}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
          <div className="card"><strong>{s.title}</strong></div>
        </Link>
      ))}
    </>
  );
}
