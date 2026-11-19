// Maintainer tool. Signs a content pack or a keyring and prints a broadcast bundle (JSON) for injection.
// Usage:  npx vite-node scripts/maintainer.ts -- pack    <secret-key-file> <pack.json>
//         npx vite-node scripts/maintainer.ts -- keyring <secret-key-file> <keyring.json> <signer-secret-file>
// The secret keys stay offline. Rotation: sign a keyring with the OLD key that lists the NEW key,
// then sign the next keyring with the NEW key that drops the old one.
import { readFileSync } from "node:fs";
import nacl from "tweetnacl";
import { keyringBundle, packBundle, signKeyring, signPack, type Keyring, type Pack } from "../lib/dtn/packs";
import { toHex } from "../lib/trade";
import type { DtnIdentity } from "../lib/dtn/core";

const args = process.argv.slice(2).filter((a) => a !== "--");
const [mode, ...rest] = args;

function secretFrom(file: string): { sec: string; pub: string } {
  const sec = readFileSync(file, "utf8").split("\n").find((l) => /^[0-9a-f]{128}$/.test(l.trim()))?.trim();
  if (!sec) throw new Error(`no secret key in ${file}`);
  const pub = toHex(nacl.sign.keyPair.fromSecretKey(Uint8Array.from(Buffer.from(sec, "hex"))).publicKey);
  return { sec, pub };
}

const now = Math.floor(Date.now() / 1000);
const ttl = 7 * 24 * 3600;

if (mode === "pack") {
  const [keyFile, packFile] = rest;
  const k = secretFrom(keyFile);
  const pack = JSON.parse(readFileSync(packFile, "utf8")) as Pack;
  const id: DtnIdentity = { signPub: k.pub, signSec: k.sec, boxPub: "00".repeat(32), boxSec: "00".repeat(32) };
  process.stdout.write(JSON.stringify(packBundle(id, signPack(k.sec, { ...pack, issued: now }), now, ttl)) + "\n");
} else if (mode === "keyring") {
  const [keyFile, krFile, signerFile] = rest;
  const next = JSON.parse(readFileSync(krFile, "utf8")) as Keyring;
  const signer = secretFrom(signerFile);
  const id: DtnIdentity = { signPub: signer.pub, signSec: signer.sec, boxPub: "00".repeat(32), boxSec: "00".repeat(32) };
  void keyFile;
  process.stdout.write(JSON.stringify(keyringBundle(id, signKeyring(signer.sec, next), now, ttl)) + "\n");
} else {
  throw new Error("usage: maintainer.ts -- pack|keyring ...");
}
