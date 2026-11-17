import { useEffect, useRef } from "react";

/** Bip curto com WebAudio, só depois de interacção do utilizador (política dos browsers). */
export function useBeep() {
  const ctxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    const unlock = () => {
      if (ctxRef.current) return;
      try {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (AC) ctxRef.current = new AC();
      } catch { /* sem áudio */ }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  return () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") void ctx.resume();
      const play = (start: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + 0.3);
      };
      play(0);
      play(0.35);
    } catch { /* ignore */ }
  };
}
