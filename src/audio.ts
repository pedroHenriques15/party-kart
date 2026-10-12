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
