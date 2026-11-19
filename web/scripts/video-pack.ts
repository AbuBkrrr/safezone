// Builds the unsigned pack for a video: its size, overall hash, and one hash per piece.
// Usage: npx vite-node scripts/video-pack.ts -- <file.mp4> <id> <title> <version> > pack.json
// Then sign it with scripts/maintainer.ts. Distribution: the pack goes over the network; the pieces
// move phone to phone during sync, each checked against the hashes in the signed pack.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const args = process.argv.slice(2).filter((a) => a !== "--");
const [file, id, title, versionStr] = args;
if (!file || !id || !title || !versionStr) throw new Error("usage: video-pack.ts -- <file.mp4> <id> <title> <version>");
const CHUNK = 16384;
const data = readFileSync(file);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const chunkHashes: string[] = [];
for (let off = 0; off < data.length; off += CHUNK) chunkHashes.push(sha(data.subarray(off, off + CHUNK)));
const pack = {
  name: "collapse-content",
  version: Number(versionStr),
  issued: 0,
  quests: [],
  screens: [{ id: `${id}-screen`, title, blocks: [{ type: "video", videoId: id }] }],
  videos: [{ id, title, size: data.length, sha256: sha(data), chunkSize: CHUNK, chunkHashes }],
};
process.stdout.write(JSON.stringify(pack, null, 2) + "\n");
