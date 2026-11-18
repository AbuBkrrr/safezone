"use client";
import { useEffect, useState } from "react";
import { loadState, saveState } from "@/lib/store";
import { narrationSupported, speak } from "@/lib/voice";

/** Settings-aware narration hook. Reads the per-device narration setting once mounted. */
export function useNarration() {
  const [cfg, setCfg] = useState({ enabled: false, rate: 1 });
  useEffect(() => setCfg(loadState().narration), []);
  return {
    cfg,
    say: (text: string) => speak(text, cfg.enabled, cfg.rate),
    supported: narrationSupported(),
  };
}

/** Read-aloud button for any text on screen. */
export function ReadAloud({ text }: { text: string }) {
  const { cfg, say, supported } = useNarration();
  if (!supported || !cfg.enabled) return null;
  return (
    <button className="btn ghost" type="button" onClick={() => say(text)} aria-label="Read this aloud">
      Read aloud
    </button>
  );
}

export function persistNarration(enabled: boolean, rate: number) {
  const s = loadState();
  s.narration = { enabled, rate };
  saveState(s);
}
