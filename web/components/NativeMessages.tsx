"use client";
import { useEffect, useState } from "react";
import { registerPlugin } from "@capacitor/core";
import { loadPack, savePack } from "@/lib/content";

interface DtnPlugin {
  address(): Promise<{ address: string }>;
  startRelay(): Promise<void>;
  send(o: { to: string; text: string }): Promise<{ id: string }>;
  inbox(): Promise<{ items: string[] }>;
  pack(): Promise<{ version: number; pack: string | null }>;
}
const Dtn = registerPlugin<DtnPlugin>("Dtn");

/** True when running inside the Android app. */
export function isNative(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
}

/** Messages and relay status served by the native DTN service. Also copies newer packs into the web content store. */
export function NativeMessages() {
  const [addr, setAddr] = useState("");
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [inbox, setInbox] = useState<{ id: string; from: string; body: { text?: string }; at: number }[]>([]);

  useEffect(() => {
    let alive = true;
    Dtn.startRelay().catch(() => {});
    Dtn.address().then((r) => alive && setAddr(r.address)).catch(() => {});
    const tick = async () => {
      try {
        const r = await Dtn.inbox();
        if (alive) setInbox(r.items.map((s) => JSON.parse(s)).reverse());
        const p = await Dtn.pack();
        const cur = loadPack()?.version ?? 0;
        if (p.pack && p.version > cur) {
          const pk = JSON.parse(p.pack) as { quests: never[]; screens?: never[] };
          savePack({ version: p.version, quests: pk.quests, screens: pk.screens ?? [] });
          if (alive) setStatus(`Content updated to version ${p.version}.`);
        }
      } catch {
        /* native service still starting */
      }
    };
    tick();
    const id = window.setInterval(tick, 5000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  async function send() {
    setStatus("");
    try {
      await Dtn.send({ to: to.trim().toLowerCase(), text: text.trim() });
      setText("");
      setStatus("Queued. It moves when this phone meets a device that can carry it.");
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  return (
    <>
      <h2>Messages</h2>
      <div className="card">
        <div className="muted">Your address (share it so others can message you)</div>
        <textarea readOnly value={addr} aria-label="My address" onFocus={(e) => e.currentTarget.select()} />
        <label className="muted" htmlFor="nTo" style={{ display: "block", marginTop: 10 }}>To (their address)</label>
        <textarea id="nTo" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Recipient address" />
        <label className="muted" htmlFor="nText" style={{ display: "block", marginTop: 10 }}>Message</label>
        <input id="nText" type="text" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} aria-label="Message text" />
        <button className="btn" type="button" onClick={send}>Send message</button>
        {status && <p className="msg" role="status">{status}</p>}
      </div>
      <h2>Inbox</h2>
      <div className="card">
        {inbox.length === 0 && <span className="muted">No messages yet.</span>}
        {inbox.map((d) => (
          <div className="row" key={d.id} style={{ display: "block" }}>
            <div>{d.body?.text}</div>
            <div className="code">from {d.from.slice(0, 12)}… · {new Date(d.at * 1000).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </>
  );
}
