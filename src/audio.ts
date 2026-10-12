// Sounds, synthesized: the engine, each driver's horn, checkpoints, laps, the countdown. M mutes.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;

export function unlockAudio(): void {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function toggleMute(): boolean {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

function tone(freq: number, at: number, dur: number, type: OscillatorType, gain: number): void {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(master);
  o.start(at);
  o.stop(at + dur + 0.02);
}

export function horn(notes: number[], volume = 1): void {
  if (!ctx) return;
  const t = ctx.currentTime;
  notes.forEach((f, i) => {
    tone(f, t + i * 0.13, 0.16, 'square', 0.12 * volume);
    tone(f * 1.26, t + i * 0.13, 0.16, 'square', 0.06 * volume);
  });
}

export function beep(high: boolean): void {
  if (ctx) tone(high ? 1046 : 523, ctx.currentTime, high ? 0.5 : 0.25, 'triangle', 0.25);
}

export function checkpointSound(faster: boolean | null): void {
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(faster === false ? 440 : 880, t, 0.12, 'triangle', 0.22);
  tone(faster === false ? 370 : 1320, t + 0.08, 0.2, 'triangle', 0.2);
}

export function lapSound(best: boolean): void {
  if (!ctx) return;
  const t = ctx.currentTime;
  const notes = best ? [523, 659, 784, 1047, 1319] : [523, 659, 784];
  notes.forEach((f, i) => tone(f, t + i * 0.09, 0.3, 'triangle', 0.22));
}

export function thud(strength: number): void {
  if (ctx) tone(70 + Math.random() * 20, ctx.currentTime, 0.15, 'sine', Math.min(0.4, strength * 0.05));
}

// The engine: a low buzz whose pitch follows speed.
export function engineSound(speed: number, throttle: number, on: boolean): void {
  if (!ctx || !master) return;
  if (!engine) {
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc2.type = 'square';
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    gain.gain.value = 0;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(master);
    osc.start();
    osc2.start();
    engine = { osc, osc2, gain, filter };
  }
  const t = ctx.currentTime;
  const gear = speed % 14;
  const f = 45 + speed * 2.2 + gear * 3;
  engine.osc.frequency.setTargetAtTime(f, t, 0.05);
  engine.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
  engine.gain.gain.setTargetAtTime(on ? 0.05 + throttle * 0.05 : 0, t, 0.1);
}

// A burst of noise through a filter: explosions, whooshes, crashes.
function noise(at: number, dur: number, gain: number, from: number, to: number, type: BiquadFilterType = 'lowpass'): void {
  if (!ctx || !master) return;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(from, at);
  f.frequency.exponentialRampToValueAtTime(to, at + dur);
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(at);
}

const now = () => ctx?.currentTime ?? 0;

export const sfx = {
  box: () => {
    tone(1318, now(), 0.08, 'triangle', 0.15);
    tone(1760, now() + 0.06, 0.12, 'triangle', 0.12);
  },
  tick: () => tone(1500 + Math.random() * 600, now(), 0.03, 'square', 0.04),
  got: () => [784, 988, 1175].forEach((f, i) => tone(f, now() + i * 0.05, 0.12, 'triangle', 0.16)),
  pop: () => {
    noise(now(), 0.12, 0.4, 3000, 400, 'bandpass');
    tone(220, now(), 0.15, 'sine', 0.2);
  },
  throw: () => noise(now(), 0.3, 0.25, 600, 3000, 'bandpass'),
  bass: () => {
    if (!ctx || !master) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, now());
    o.frequency.exponentialRampToValueAtTime(32, now() + 1.2);
    g.gain.setValueAtTime(0.6, now());
    g.gain.exponentialRampToValueAtTime(0.001, now() + 1.3);
    o.connect(g).connect(master);
    o.start();
    o.stop(now() + 1.4);
  },
  boom: (volume = 1) => {
    noise(now(), 1.2, 0.9 * volume, 1800, 60);
    tone(55, now(), 0.6, 'sine', 0.4 * volume);
  },
  hit: (volume = 1) => {
    noise(now(), 0.35, 0.5 * volume, 2500, 200);
    tone(300, now(), 0.25, 'sawtooth', 0.08 * volume);
  },
  shield: () => [1568, 2093].forEach((f, i) => tone(f, now() + i * 0.07, 0.25, 'sine', 0.14)),
  slip: () => noise(now(), 0.5, 0.3, 300, 2500, 'bandpass'),
  turbo: (level: number) => {
    noise(now(), 0.4, 0.3, 800, 4000, 'highpass');
    tone(level === 2 ? 660 : 520, now(), 0.2, 'sawtooth', 0.06);
  },
  bump: (s: number) => tone(90 + Math.random() * 30, now(), 0.12, 'square', Math.min(0.2, s * 0.02)),
  finish: (place: number) => (place <= 3 ? [523, 659, 784, 1047, 1319, 1568] : [392, 523, 659]).forEach((f, i) => tone(f, now() + i * 0.11, 0.35, 'triangle', 0.22)),
};
