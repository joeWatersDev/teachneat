/**
 * Synthesized sound effects for the picker animations (Web Audio, no assets). All
 * functions no-op when Web Audio is unavailable (e.g. jsdom in tests), so callers
 * need no guards. The AudioContext is created lazily on first use — which happens
 * inside a click handler / animation — so autoplay policies are satisfied.
 */

type MaybeCtor = typeof AudioContext | undefined;

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor: MaybeCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Resume/create the context during a user gesture so later scheduled sounds play. */
export function primeAudio(): void {
  getCtx();
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (!noise || noise.sampleRate !== c.sampleRate) {
    const len = Math.floor(c.sampleRate * 0.4);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noise = buf;
  }
  return noise;
}

function blip(
  c: AudioContext,
  at: number,
  freq: number,
  dur: number,
  gain: number,
  type: OscillatorType = 'square',
): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function noiseBurst(c: AudioContext, at: number, dur: number, gain: number, freq: number): void {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 0.9;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(filter).connect(g).connect(c.destination);
  src.start(at);
  src.stop(at + dur + 0.02);
}

/** A two-tone bell that resolves the spin / reveal. */
export function playDing(): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  blip(c, now, 660, 0.55, 0.2, 'sine');
  blip(c, now, 990, 0.55, 0.12, 'sine');
}

/** Decelerating wheel-of-fortune ticks over the spin, then a landing ding. */
export function playWheelSpin(durationMs: number): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const D = durationMs / 1000;
  const N = 40;
  for (let i = 1; i <= N; i++) {
    // Equal-angle ticks under an ease-out spin: dense early, sparse late.
    const t = D * (1 - Math.sqrt(1 - i / N));
    blip(c, now + t, 1050, 0.025, 0.1, 'square');
  }
  blip(c, now + D + 0.02, 660, 0.55, 0.2, 'sine');
  blip(c, now + D + 0.02, 990, 0.55, 0.12, 'sine');
}

/** A run of card-riffle clicks across the shuffle window. */
export function playCardShuffle(durationMs: number): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const D = durationMs / 1000;
  const N = 16;
  for (let i = 0; i < N; i++) {
    const t = now + (i / N) * D + Math.random() * 0.012;
    noiseBurst(c, t, 0.05, 0.11, 2600 + Math.random() * 1600);
  }
}

/** A short whoosh for a card flip. */
export function playCardFlip(): void {
  const c = getCtx();
  if (!c) return;
  noiseBurst(c, c.currentTime, 0.13, 0.13, 1700);
}
