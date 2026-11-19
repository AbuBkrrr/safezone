// Maintainer tool: turns a pack file into a signed broadcast bundle (JSON) ready to inject into the DTN.
// Usage: npx vite-node scripts/make-pack.ts -- <secret-key-file> <pack.json> > bundle.json
// The secret key never leaves the maintainer's machine. Keep it offline.
import { readFileSync } from "node:fs";
import nacl from "tweetnacl";
import { signPack, packBundle, type Pack } from "../lib/dtn/packs";
import { MAINTAINER_PUB } from "../lib/dtn/maintainer";
import { toHex } from "../lib/trade";

const [keyFile, packFile] = process.argv.slice(-2);
const secretHex = readFileSync(keyFile, "utf8").split("\n").find((l) => /^[0-9a-f]{128}$/.test(l.trim()))?.trim();
if (!secretHex) throw new Error("no secret key found in key file");
const sec = Uint8Array.from(Buffer.from(secretHex, "hex"));
const pub = toHex(nacl.sign.keyPair.fromSecretKey(sec).publicKey);
if (pub !== MAINTAINER_PUB) throw new Error("secret key does not match the pinned maintainer public key");
const pack = JSON.parse(readFileSync(packFile, "utf8")) as Pack;
const now = Math.floor(Date.now() / 1000);
const maintainer = { signPub: pub, signSec: secretHex, boxPub: "00".repeat(32), boxSec: "00".repeat(32) };
const bundle = packBundle(maintainer, signPack(secretHex, { ...pack, issued: now }), now, 7 * 24 * 3600);
process.stdout.write(JSON.stringify(bundle) + "\n");
