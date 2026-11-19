// Screens: content blocks a pack can add. The app draws them with fixed components. No code, no HTML.
const ID = /^[a-z0-9-]{1,40}$/;

export type Block =
  | { type: "text"; text: string }
  | { type: "list"; items: string[] }
  | { type: "quest"; questId: string }
  | { type: "link"; label: string; screenId: string };

export interface ScreenDef {
  id: string;
  title: string;
  blocks: Block[];
}

export function validateScreen(s: unknown): { ok: true; def: ScreenDef } | { ok: false; reason: string } {
  const d = s as Partial<ScreenDef> | null;
  if (!d || typeof d !== "object" || typeof d.id !== "string" || !ID.test(d.id)) return { ok: false, reason: "bad screen id" };
  if (typeof d.title !== "string" || !d.title || d.title.length > 80) return { ok: false, reason: `bad screen title in ${d.id}` };
  if (!Array.isArray(d.blocks) || d.blocks.length < 1 || d.blocks.length > 20) return { ok: false, reason: `need 1-20 blocks in ${d.id}` };
  for (const b of d.blocks as Partial<Block>[]) {
    switch (b.type) {
      case "text":
        if (typeof (b as { text?: unknown }).text !== "string" || !(b as { text: string }).text || (b as { text: string }).text.length > 500) return { ok: false, reason: `bad text block in ${d.id}` };
        break;
      case "list": {
        const items = (b as { items?: unknown }).items;
        if (!Array.isArray(items) || items.length > 20 || items.some((i) => typeof i !== "string" || !i || i.length > 200)) return { ok: false, reason: `bad list block in ${d.id}` };
        break;
      }
      case "quest":
        if (typeof (b as { questId?: unknown }).questId !== "string" || !ID.test((b as { questId: string }).questId)) return { ok: false, reason: `bad quest link in ${d.id}` };
        break;
      case "link": {
        const l = b as { screenId?: unknown; label?: unknown };
        if (typeof l.screenId !== "string" || !ID.test(l.screenId)) return { ok: false, reason: `bad screen link in ${d.id}` };
        if (typeof l.label !== "string" || !l.label || l.label.length > 60) return { ok: false, reason: `bad link label in ${d.id}` };
        break;
      }
      default:
        return { ok: false, reason: `unknown block type in ${d.id}` };
    }
  }
  return { ok: true, def: d as ScreenDef };
}
