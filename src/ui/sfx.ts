import type { Rarity } from '../game/types';

// Petits sons synthétisés (aucun fichier audio) pour donner du relief aux tirages
const MUTE_KEY = 'krazy-troopers-mute';

let ctx: AudioContext | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function toggleMute(): boolean {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // simple préférence : on s'en passe
  }
  return muted;
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, at: number, dur: number, opts: { type?: OscillatorType; gain?: number; slide?: number } = {}): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(opts.slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.12, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(at: number, dur: number, gain = 0.2): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  const src = a.createBufferSource();
  const g = a.createGain();
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(g).connect(a.destination);
  src.start(t);
}

// Notes d'arpège par rareté : plus la rareté est haute, plus l'accord monte et s'allonge
const CHIMES: Record<Rarity, number[]> = {
  common: [392],
  rare: [440, 659],
  epic: [523, 659, 784],
  legendary: [523, 659, 784, 1047, 1319],
};

export const sfx = {
  rattle(): void {
    tone(90 + Math.random() * 40, 0, 0.08, { type: 'square', gain: 0.05 });
  },
  burst(): void {
    noise(0, 0.5, 0.25);
    tone(160, 0, 0.4, { type: 'sawtooth', gain: 0.08, slide: 40 });
  },
  flip(): void {
    tone(900, 0, 0.06, { type: 'triangle', gain: 0.05, slide: 1400 });
  },
  charge(): void {
    tone(220, 0, 0.7, { type: 'sawtooth', gain: 0.04, slide: 880 });
  },
  reveal(rarity: Rarity): void {
    CHIMES[rarity].forEach((f, i) => tone(f, i * 0.07, rarity === 'legendary' ? 0.9 : 0.45, { type: 'triangle', gain: 0.09 }));
    if (rarity === 'legendary') noise(0, 0.8, 0.12);
  },
};
