"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { applyTrade, canPay, signTrade, verifyTrade, type Bundle as TradeBundle, type TradeOffer } from "@/lib/trade";
import { COMMODITIES, emptyState, ensureIdentity, loadState, saveState, type State } from "@/lib/store";
import { joinWithOffer, createHost } from "@/lib/peer";
import { useNarration } from "@/components/Narrator";
import {
  BROADCAST, addressOf, emptyDtn, makeBundle, plan, receive, summary, type DtnIdentity, type DtnState, type Summary, type SyncMsg, type Delivered,
} from "@/lib/dtn/core";
import { loadDtn, saveDtn } from "@/lib/dtn/state";
import { installPack } from "@/lib/content";
import { isMaintainerPack, PACK_KIND, type SignedPack } from "@/lib/dtn/packs";
import { MAINTAINER_PUB } from "@/lib/dtn/maintainer";
import { NativeMessages, isNative } from "@/components/NativeMessages";

type Msg =
  | { t: "hello"; pub: string; addr: string }
  | { t: "sum"; sum: Summary }
  | { t: "push"; msg: SyncMsg }
  | { t: "offer"; offer: TradeOffer; sig: string }
  | { t: "accept"; id: string; sig: string }
  | { t: "decline"; id: string };

type Pending = { offer: TradeOffer; sig: string; from: "me" | "them" };
type Channel = { send: (m: string) => void; close: () => void; acceptAnswer?: (c: string) => Promise<void>; offerCode?: string; answerCode?: string };

const ITEMS = [...COMMODITIES, "coins"] as const;
const TTL_MSG = 72 * 3600;

function describe(b: TradeBundle): string {
  const parts = Object.entries(b).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`);
  return parts.length ? parts.join(", ") : "nothing";
}
function dtnIdentity(s: State): DtnIdentity | null {
  const i = s.identity;
  if (!i?.boxPub || !i.boxSec) return null;
  return { signPub: i.pub, signSec: i.sec, boxPub: i.boxPub, boxSec: i.boxSec };
}

export default function TransferPage() {
  const [s, setS] = useState<State>(emptyState());
  const [dtn, setDtn] = useState<DtnState>(emptyDtn());
  const [role, setRole] = useState<"none" | "host" | "join">("none");
  const [offerCode, setOfferCode] = useState("");
  const [answerCode, setAnswerCode] = useState("");
  const [qrSrc, setQrSrc] = useState("");
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [connected, setConnected] = useState(false);
  const [peerPub, setPeerPub] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [give, setGive] = useState<TradeBundle>({});
  const [get, setGet] = useState<TradeBundle>({});
  const [scanning, setScanning] = useState(false);
  const [msgTo, setMsgTo] = useState("");
  const [msgText, setMsgText] = useState("");
  const [msgStatus, setMsgStatus] = useState("");
  const channelRef = useRef<Channel | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sRef = useRef<State>(emptyState());
  const dtnRef = useRef<DtnState>(emptyDtn());
  const pendingRef = useRef<Pending[]>([]);
  const peerRef = useRef<{ pub: string; addr: string } | null>(null);
  const narr = useNarration();
  const [native, setNative] = useState(false);
  useEffect(() => setNative(isNative()), []);

  useEffect(() => {
    const next = ensureIdentity(loadState());
    saveState(next);
    sRef.current = next;
    setS(next);
    const d = loadDtn();
    dtnRef.current = d;
    setDtn(d);
  }, []);

  function note(text: string, ok: boolean) {
    setStatus({ text, ok });
    narr.say(text);
  }
  function commit(next: State) {
    sRef.current = next;
    saveState(next);
    setS(next);
  }
  function commitDtn(next: DtnState) {
    dtnRef.current = next;
    saveDtn(next);
    setDtn({ ...next });
  }
  function setPendingBoth(list: Pending[]) {
    pendingRef.current = list;
    setPending(list);
  }
  function send(m: Msg) {
    channelRef.current?.send(JSON.stringify(m));
  }
  const myId = () => dtnIdentity(sRef.current);

  /** Runs once a delivered item is in hand: installs maintainer packs, reports messages. */
  function handleDelivered(items: Delivered[]) {
    for (const d of items) {
      if (d.kind === "msg") {
        const t = (d.body as { text?: string })?.text ?? "";
        note(`New message: ${t}`, true);
      } else if (isMaintainerPack(d.from, d.kind)) {
        const r = installPack((d.body as SignedPack));
        note(r.ok ? `Update installed: content version ${r.version}.` : `Update refused: ${r.reason}.`, r.ok);
      }
    }
  }

  function onMessage(raw: string) {
    let m: Msg;
    try { m = JSON.parse(raw) as Msg; } catch { return; }
    const me = myId();
    if (m.t === "hello") {
      peerRef.current = { pub: m.pub, addr: m.addr };
      setPeerPub(m.pub);
      send({ t: "sum", sum: summary(dtnRef.current, Math.floor(Date.now() / 1000)) });
      return;
    }
    if (m.t === "sum") {
      const peer = peerRef.current;
      if (!peer) return;
      const now = Math.floor(Date.now() / 1000);
      const next = structuredClone(dtnRef.current);
      const msg = plan(next, m.sum, peer.addr, now);
      commitDtn(next);
      send({ t: "push", msg });
      return;
    }
    if (m.t === "push") {
      if (!me) return;
      const now = Math.floor(Date.now() / 1000);
      const next = structuredClone(dtnRef.current);
      const acksBefore = Object.keys(next.acks).length;
      const r = receive(next, m.msg, me, now, { allowBroadcast: (b: TradeBundle | { src: string; dst: string }) => (b as { src: string }).src.slice(0, 64) === MAINTAINER_PUB });
      commitDtn(next);
      handleDelivered(r.delivered);
      // Acks created here were not part of the push the peer planned, so send them now. They are small and signed.
      if (Object.keys(next.acks).length > acksBefore) {
        send({ t: "push", msg: { bundles: [], acks: Object.values(next.acks) } });
      }
      if (r.delivered.length === 0 && m.msg.bundles.length === 0 && m.msg.acks.length === 0) setMsgStatus("Synced. Nothing new to exchange.");
      else setMsgStatus(`Synced: received ${m.msg.bundles.length} item(s), ${r.delivered.length} for you.`);
      return;
    }
    if (m.t === "offer") {
      const st = sRef.current;
      if (!verifyTrade(m.offer.from, m.offer, m.sig)) { note("Received an offer with an invalid signature. Ignored.", false); return; }
      if (m.offer.from === st.identity!.pub) return;
      setPendingBoth([...pendingRef.current, { offer: m.offer, sig: m.sig, from: "them" }]);
      note(`Trade offer: they give ${describe(m.offer.give)} for ${describe(m.offer.get)}.`, true);
      return;
    }
    if (m.t === "accept") {
      const p = pendingRef.current.find((x) => x.offer.id === m.id && x.from === "me");
      if (!p || !peerRef.current) return;
      if (!verifyTrade(peerRef.current.pub, p.offer, m.sig)) { note("Their acceptance has an invalid signature. Trade not applied.", false); return; }
      try {
        commit(applyTrade(sRef.current, p.offer, peerRef.current.pub, p.sig, m.sig, sRef.current.identity!.pub, true));
        setPendingBoth(pendingRef.current.filter((x) => x.offer.id !== m.id));
        note("Trade complete. Both signatures recorded.", true);
      } catch (e) { note((e as Error).message, false); }
      return;
    }
    if (m.t === "decline") {
      setPendingBoth(pendingRef.current.filter((x) => x.offer.id !== m.id));
      note("The other player declined your offer.", false);
    }
  }

  function onOpen() {
    setConnected(true);
    const st = sRef.current;
    send({ t: "hello", pub: st.identity!.pub, addr: addressOf(dtnIdentity(st)!) });
    note("Connected. Syncing messages.", true);
  }

  async function startHost() {
    setStatus(null);
    setRole("host");
    const ch = await createHost(onMessage, onOpen);
    channelRef.current = ch;
    setOfferCode(ch.offerCode);
    setQrSrc(await QRCode.toDataURL(ch.offerCode, { margin: 1, width: 360, errorCorrectionLevel: "L" }));
  }
  async function connectAnswer() {
    try { await channelRef.current?.acceptAnswer?.(answerCode); } catch { note("That answer code did not work. Ask them to copy it again.", false); }
  }
  async function join(code: string) {
    setStatus(null);
    setRole("join");
    try {
      const ch = await joinWithOffer(code, onMessage, onOpen);
      channelRef.current = ch;
      setAnswerCode(ch.answerCode);
      setQrSrc(await QRCode.toDataURL(ch.answerCode, { margin: 1, width: 360, errorCorrectionLevel: "L" }));
    } catch { note("That host code did not work. Copy it again.", false); setRole("none"); }
  }

  function makeOffer() {
    const st = sRef.current;
    if (!canPay(give, st.inv, st.coins)) { note("You do not have that much to give.", false); return; }
    const offer: TradeOffer = { id: `t-${Date.now()}`, from: st.identity!.pub, give, get, at: Date.now() };
    const sig = signTrade(st.identity!.sec, offer);
    send({ t: "offer", offer, sig });
    setPendingBoth([...pendingRef.current, { offer, sig, from: "me" }]);
    note("Offer sent. Waiting for them to accept.", true);
  }
  function respond(p: Pending, accept: boolean) {
    if (!accept) {
      send({ t: "decline", id: p.offer.id });
      setPendingBoth(pendingRef.current.filter((x) => x.offer.id !== p.offer.id));
      return;
    }
    const st = sRef.current;
    const mySig = signTrade(st.identity!.sec, p.offer);
    try {
      commit(applyTrade(st, p.offer, p.offer.from, mySig, p.sig, st.identity!.pub, false));
      send({ t: "accept", id: p.offer.id, sig: mySig });
      setPendingBoth(pendingRef.current.filter((x) => x.offer.id !== p.offer.id));
      note("Trade complete. Both signatures recorded.", true);
    } catch (e) {
      send({ t: "decline", id: p.offer.id });
      setPendingBoth(pendingRef.current.filter((x) => x.offer.id !== p.offer.id));
      note(`Could not accept: ${(e as Error).message}.`, false);
    }
  }

  function sendMessage() {
    const me = myId();
    const to = msgTo.trim().toLowerCase();
    if (!me) return;
    if (!/^[0-9a-f]{128}$/.test(to)) { setMsgStatus("That address is not valid. It should be 128 hex characters."); return; }
    if (!msgText.trim()) { setMsgStatus("Write a message first."); return; }
    const now = Math.floor(Date.now() / 1000);
    const b = makeBundle(me, to, "msg", { text: msgText.trim() }, now, TTL_MSG);
    const next = structuredClone(dtnRef.current);
    next.bundles[b.id] = b;
    commitDtn(next);
    setMsgText("");
    setMsgStatus("Queued. It moves to the recipient when your device meets a device that can carry it.");
  }

  async function startScan() {
    setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      const canvas = document.createElement("canvas");
      const tick = () => {
        if (!streamRef.current || !videoRef.current) return;
        const v = videoRef.current;
        if (v.readyState >= 2) {
          canvas.width = v.videoWidth; canvas.height = v.videoHeight;
          const ctx = canvas.getContext("2d");
          if (ctx && canvas.width) {
            ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const hit = jsQR(img.data, img.width, img.height);
            if (hit?.data) { stopScan(); join(hit.data); return; }
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      setScanning(false);
      note("Camera is blocked. Paste the host code instead.", false);
    }
  }
  function stopScan() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }
  useEffect(() => () => { stopScan(); channelRef.current?.close(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function setAmount(setter: (fn: (b: TradeBundle) => TradeBundle) => void, key: keyof TradeBundle, value: string) {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    setter((b) => ({ ...b, [key]: n }));
  }

  const incoming = pending.filter((p) => p.from === "them");
  const outgoing = pending.filter((p) => p.from === "me");
  const myAddr = dtnIdentity(s) ? addressOf(dtnIdentity(s)!) : "";
  const inbox = dtn.inbox.filter((d) => d.kind === "msg").slice().reverse();
  const queued = Object.values(dtn.bundles).filter((b) => b.dst !== BROADCAST).length;
  void PACK_KIND;

  return (
    <>
      <h1>Transfer</h1>
      <p className="muted">Meet another player to trade and pass messages. No server: one code or QR goes from phone to phone. Messages you carry for others move when you meet them.</p>

      {role === "none" && (
        <div className="card">
          <div className="grid2">
            <button className="btn" type="button" onClick={startHost}>Host a session</button>
            <button className="btn ghost" type="button" onClick={() => setRole("join")}>Join a session</button>
          </div>
        </div>
      )}

      {role === "host" && !connected && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>1. Show this to the other player</h2>
          {qrSrc && <img className="qr" src={qrSrc} alt="Session QR code" />}
          <textarea readOnly value={offerCode} aria-label="Session code" onFocus={(e) => e.currentTarget.select()} />
          <h2>2. Paste their answer</h2>
          <textarea value={answerCode} onChange={(e) => setAnswerCode(e.target.value)} placeholder="Paste the answer code here" aria-label="Answer code" />
          <button className="btn" type="button" onClick={connectAnswer} disabled={!answerCode.trim()}>Connect</button>
        </div>
      )}

      {role === "join" && !connected && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Join</h2>
          {!scanning && !answerCode && (
            <>
              <button className="btn" type="button" onClick={startScan}>Scan host QR</button>
              <h2>Or paste the host code</h2>
              <textarea id="hostCode" aria-label="Host code" placeholder="Paste the host code" />
              <button className="btn ghost" type="button" onClick={() => join((document.getElementById("hostCode") as HTMLTextAreaElement).value)}>Join with pasted code</button>
            </>
          )}
          {scanning && (
            <>
              <video ref={videoRef} muted playsInline aria-label="QR scanner" />
              <button className="btn ghost" type="button" onClick={stopScan}>Cancel scan</button>
            </>
          )}
          {answerCode && (
            <>
              <h2>Show this answer to the host</h2>
              {qrSrc && <img className="qr" src={qrSrc} alt="Answer QR code" />}
              <textarea readOnly value={answerCode} aria-label="Answer code" onFocus={(e) => e.currentTarget.select()} />
              <p className="muted">Waiting for the host to connect…</p>
            </>
          )}
        </div>
      )}

      {connected && (
        <>
          <div className="card">
            <div className="muted">Connected to {peerPub ? peerPub.slice(0, 12) + "…" : "a player"}</div>
            <h2>Offer a trade</h2>
            <div className="grid2">
              <div>
                <div className="muted">You give</div>
                {ITEMS.map((k) => (
                  <label key={k} className="row" style={{ borderTop: 0, padding: "4px 0" }}>
                    <span style={{ textTransform: "capitalize" }}>{k}</span>
                    <input type="number" min={0} inputMode="numeric" style={{ width: 70 }} value={give[k] ?? 0} aria-label={`You give ${k}`} onChange={(e) => setAmount(setGive, k, e.target.value)} />
                  </label>
                ))}
              </div>
              <div>
                <div className="muted">You get</div>
                {ITEMS.map((k) => (
                  <label key={k} className="row" style={{ borderTop: 0, padding: "4px 0" }}>
                    <span style={{ textTransform: "capitalize" }}>{k}</span>
                    <input type="number" min={0} inputMode="numeric" style={{ width: 70 }} value={get[k] ?? 0} aria-label={`You get ${k}`} onChange={(e) => setAmount(setGet, k, e.target.value)} />
                  </label>
                ))}
              </div>
            </div>
            <button className="btn" type="button" onClick={makeOffer} disabled={!Object.values(give).some(Boolean) && !Object.values(get).some(Boolean)}>Send offer</button>
          </div>

          {incoming.length > 0 && (
            <>
              <h2>Incoming</h2>
              {incoming.map((p) => (
                <div className="card" key={p.offer.id}>
                  <div>They give <strong>{describe(p.offer.give)}</strong></div>
                  <div>for <strong>{describe(p.offer.get)}</strong></div>
                  <div className="grid2" style={{ marginTop: 8 }}>
                    <button className="btn" type="button" onClick={() => respond(p, true)}>Accept</button>
                    <button className="btn ghost" type="button" onClick={() => respond(p, false)}>Decline</button>
                  </div>
                </div>
              ))}
            </>
          )}
          {outgoing.length > 0 && (
            <>
              <h2>Waiting</h2>
              {outgoing.map((p) => <div className="card muted" key={p.offer.id}>Offer: {describe(p.offer.give)} for {describe(p.offer.get)}</div>)}
            </>
          )}
        </>
      )}

      {status && <p className={`msg ${status.ok ? "good" : "bad"}`} role="status" aria-live="polite">{status.text}</p>}

      {native ? <NativeMessages /> : (<>
      <h2>Messages</h2>
      <div className="card">
        <div className="muted">Your address (share it so others can message you)</div>
        <textarea readOnly value={myAddr} aria-label="My address" onFocus={(e) => e.currentTarget.select()} />
        <label className="muted" htmlFor="msgTo" style={{ display: "block", marginTop: 10 }}>To (their address)</label>
        <textarea id="msgTo" value={msgTo} onChange={(e) => setMsgTo(e.target.value)} placeholder="Paste their address" aria-label="Recipient address" />
        <label className="muted" htmlFor="msgText" style={{ display: "block", marginTop: 10 }}>Message</label>
        <input id="msgText" type="text" value={msgText} onChange={(e) => setMsgText(e.target.value)} maxLength={500} aria-label="Message text" />
        <button className="btn" type="button" onClick={sendMessage}>Send message</button>
        {msgStatus && <p className="msg" role="status">{msgStatus}</p>}
        <div className="muted" style={{ marginTop: 8 }}>{queued} item(s) stored on this device waiting to move.</div>
      </div>
      <h2>Inbox</h2>
      <div className="card">
        {inbox.length === 0 && <span className="muted">No messages yet.</span>}
        {inbox.map((d) => (
          <div className="row" key={d.id} style={{ display: "block" }}>
            <div>{(d.body as { text?: string })?.text}</div>
            <div className="code">from {d.from.slice(0, 12)}… · {new Date(d.at * 1000).toLocaleString()}</div>
          </div>
        ))}
      </div>

      </>)}

      {role !== "none" && <button className="btn ghost" type="button" onClick={() => { channelRef.current?.close(); channelRef.current = null; setConnected(false); setRole("none"); setOfferCode(""); setAnswerCode(""); setQrSrc(""); setPeerPub(null); peerRef.current = null; setPendingBoth([]); }}>End session</button>}
      <p className="muted code" style={{ marginTop: 16 }}>{s.identity ? `Your key ${s.identity.pub.slice(0, 16)}…` : ""}</p>
    </>
  );
}
