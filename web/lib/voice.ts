// Narration with the browser's built-in speech synthesis. No audio files: zero bandwidth and storage.
export function narrationSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function speak(text: string, enabled: boolean, rate = 1): void {
  if (!enabled || !narrationSupported()) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    window.speechSynthesis.speak(u);
  } catch {
    /* speech unavailable: the text is still shown on screen */
  }
}
