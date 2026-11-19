// WebRTC data channel with copy-paste / QR signalling. No server: both sides exchange one code.
// Non-trickle ICE: we wait for gathering to finish so the code carries every candidate.
export type Code = string;

function waitForIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", done);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", done);
    setTimeout(resolve, 8000); // give up waiting after 8 s; use whatever candidates exist
  });
}

const encode = (d: RTCSessionDescriptionInit): Code => btoa(JSON.stringify(d));
const decode = (c: Code): RTCSessionDescriptionInit => JSON.parse(atob(c.trim()));

const RTC_CONFIG: RTCConfiguration = { iceServers: [] }; // LAN / same-device: no STUN or TURN needed

/** Host side: creates an offer code. Call acceptAnswer(code) with the joiner's answer. */
export async function createHost(onMessage: (msg: string) => void, onOpen: () => void) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const dc = pc.createDataChannel("collapse");
  const ready = new Promise<void>((res) => (dc.onopen = () => { onOpen(); res(); }));
  dc.onmessage = (e) => onMessage(String(e.data));
  await pc.setLocalDescription(await pc.createOffer());
  await waitForIce(pc);
  const offerCode = encode(pc.localDescription!);
  return {
    offerCode,
    acceptAnswer: async (answerCode: Code) => {
      await pc.setRemoteDescription(decode(answerCode));
      await ready;
    },
    send: (msg: string) => dc.send(msg),
    close: () => { dc.close(); pc.close(); },
  };
}

/** Joiner side: takes the host's offer code, returns an answer code to send back. */
export async function joinWithOffer(
  offerCode: Code,
  onMessage: (msg: string) => void,
  onOpen: () => void,
) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  let dc: RTCDataChannel | null = null;
  pc.ondatachannel = (e) => {
    dc = e.channel;
    dc.onopen = () => onOpen();
    dc.onmessage = (m) => onMessage(String(m.data));
  };
  await pc.setRemoteDescription(decode(offerCode));
  await pc.setLocalDescription(await pc.createAnswer());
  await waitForIce(pc);
  return {
    answerCode: encode(pc.localDescription!),
    send: (msg: string) => dc?.send(msg),
    close: () => pc.close(),
  };
}
