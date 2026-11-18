"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { applyTrade, canPay, signTrade, verifyTrade, type Bundle, type TradeOffer } from "@/lib/trade";
import { COMMODITIES, ensureIdentity, emptyState, loadState, saveState, type State } from "@/lib/store";
import { joinWithOffer, createHost } from "@/lib/peer";
import { useNarration } from "@/components/Narrator";

type Msg =
  | { type: "offer"; offer: TradeOffer; sig: string }
  | { type: "accept"; id: string; sig: string }
  | { type: "decline"; id: string }
  | { type: "hello"; pub: string };

type Pending = { offer: TradeOffer; sig: string; from: "me" | "them" };

const ITEMS = [...COMMODITIES, "coins"] as const;

function describe(b: Bundle): string {
  const parts = Object.entries(b).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`);
  return parts.length ? parts.join(", ") : "nothing";
}

export default function TransferPage() {
  const [s, setS] = useState<State>(emptyState());
  const [role, setRole] = useState<"none" | "host" | "join">("none");
  const [offerCode, setOfferCode] = useState("");
  const [answerCode, setAnswerCode] = useState("");
  const [qrSrc, setQrSrc] = useState("");
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [connected, setConnected] = useState(false);
  const [peerPub, setPeerPub] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [give, setGive] = useState<Bundle>({});
  const [get, setGet] = useState<Bundle>({});
  const [scanning, setScanning] = useState(false);
  type Channel = { send: (m: string) => void; close: () => void; acceptAnswer?: (c: string) => Promise<void>; offerCode?: string; answerCode?: string };
  const channelRef = useRef<Channel | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sRef = useRef<State>(s);
  const pendingRef = useRef<Pending[]>([]);
  const narr = useNarration();

  useEffect(() => {
    const next = ensureIdentity(loadState());
    saveState(next);
    setS(next);
    sRef.current = next;
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
  function setPendingBoth(list: Pending[]) {
    pendingRef.current = list;
    setPending(list);
  }

  function send(m: Msg) {
    channelRef.current?.send(JSON.stringify(m));
  }

  function onMessage(raw: string) {
    let m: Msg;
    try { m = JSON.parse(raw) as Msg; } catch { return; }
    if (m.type === "hello") { setPeerPub(m.pub); return; }
    if (m.type === "offer") {
      const me = sRef.current.identity!.pub;
      if (!verifyTrade(m.offer.from, m.offer, m.sig)) { note("Received an offer with an invalid signature. Ignored.", false); return; }
      if (m.offer.from === me) return;
      setPendingBoth([...pendingRef.current, { offer: m.offer, sig: m.sig, from: "them" }]);
      note(`Trade offer: they give ${describe(m.offer.give)} for ${describe(m.offer.get)}.`, true);
      return;
    }
    if (m.type === "accept") {
      // They accepted my offer: I am the maker. Apply my side with both signatures.
      const p = pendingRef.current.find((x) => x.offer.id === m.id && x.from === "me");
      if (!p) return;
      if (!verifyTrade(peerKey(), p.offer, m.sig)) { note("Their acceptance has an invalid signature. Trade not applied.", false); return; }
      try {
        commit(applyTrade(sRef.current, p.offer, peerKey(), p.sig, m.sig, sRef.current.identity!.pub, true));
        setPendingBoth(pendingRef.current.filter((x) => x.offer.id !== m.id));
        note("Trade complete. Both signatures recorded.", true);
      } catch (e) { note((e as Error).message, false); }
      return;
    }
    if (m.type === "decline") {
      setPendingBoth(pendingRef.current.filter((x) => x.offer.id !== m.id));
      note("The other player declined your offer.", false);
    }
  }
  const peerRef = useRef<string>("");
  const peerKey = () => peerRef.current;

  async function startHost() {
    setStatus(null);
    setRole("host");
    const ch = await createHost(onMessage, () => { setConnected(true); send({ type: "hello", pub: sRef.current.identity!.pub }); note("Connected. Make an offer below.", true); });
    channelRef.current = ch;
    setOfferCode(ch.offerCode);
    setQrSrc(await QRCode.toDataURL(ch.offerCode, { margin: 1, width: 360, errorCorrectionLevel: "L" }));
  }

  async function connectAnswer() {
    try {
      await channelRef.current?.acceptAnswer?.(answerCode);
    } catch { note("That answer code did not work. Ask them to copy it again.", false); }
  }

  async function join(code: string) {
    setStatus(null);
    setRole("join");
    try {
      const ch = await joinWithOffer(code, onMessage, () => { setConnected(true); send({ type: "hello", pub: sRef.current.identity!.pub }); note("Connected.", true); });
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
    send({ type: "offer", offer, sig });
    setPendingBoth([...pendingRef.current, { offer, sig, from: "me" }]);
    note("Offer sent. Waiting for them to accept.", true);
  }

  function respond(p: Pending, accept: boolean) {
    if (!accept) {
      send({ type: "decline", id: p.offer.id });
      setPendingBoth(pendingRef.current.filter((x) => x.offer.id !== p.offer.id));
      return;
    }
    const st = sRef.current;
    const mySig = signTrade(st.identity!.sec, p.offer);
    try {
      // I am the taker: my side is the offer's `get`.
      commit(applyTrade(st, p.offer, p.offer.from, mySig, p.sig, st.identity!.pub, false));
      send({ type: "accept", id: p.offer.id, sig: mySig });
      setPendingBoth(pendingRef.current.filter((x) => x.offer.id !== p.offer.id));
      note("Trade complete. Both signatures recorded.", true);
    } catch (e) {
      send({ type: "decline", id: p.offer.id });
      setPendingBoth(pendingRef.current.filter((x) => x.offer.id !== p.offer.id));
      note(`Could not accept: ${(e as Error).message}.`, false);
    }
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

  function setAmount(setter: (fn: (b: Bundle) => Bundle) => void, key: keyof Bundle, value: string) {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    setter((b) => ({ ...b, [key]: n }));
  }

  // Make the peer's key known to the maker before accepts arrive: set when they say hello.
  useEffect(() => { if (peerPub) peerRef.current = peerPub; }, [peerPub]);

  const incoming = pending.filter((p) => p.from === "them");
  const outgoing = pending.filter((p) => p.from === "me");

  return (
    <>
      <h1>Transfer</h1>
      <p className="muted">Trade directly with a nearby player. No server: one code or QR goes from phone to phone, then both sign each trade.</p>

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
      {(role !== "none") && <button className="btn ghost" type="button" onClick={() => { channelRef.current?.close(); channelRef.current = null; setConnected(false); setRole("none"); setOfferCode(""); setAnswerCode(""); setQrSrc(""); setPeerPub(null); setPendingBoth([]); }}>End session</button>}
      <p className="muted code" style={{ marginTop: 16 }}>{s.identity ? `Your key ${s.identity.pub.slice(0, 16)}…` : ""}</p>
    </>
  );
}
