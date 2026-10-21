// Sounds, through one mix: a bus for the engines, one for the effects, one for the jingles and one
// for the city round the track, into a limiter, so nothing stacked on anything clips. Every sound is
// synthesized, the engines a race car's V8 through six gears, but the city's, which are recordings
// (src/sounds/). A sound with a place in the world (others' engines, items, hits, explosions, the
// eggs, the river, the bells) is heard from there, left or right, near or far, by a listener on
// the camera; your own are heard in your head. M mutes.
import { surroundAt, type Ambience, type Spot } from './ambience.ts';
import { GUNS, isGun, type WeaponId } from './game/arsenal.ts';

let ctx: AudioContext | null = null;
// The mute, after the limiter; what the speakers get, and what's measured and recorded.
let master: GainNode | null = null;
let muted = false;
type Bus = 'engine' | 'fx' | 'jingle' | 'ambience';
let bus: Record<Bus, GainNode> | null = null;
// Each bus's level. The engines sit under everything, an effect over the engine, and the city (task
// 025) under the engines. A jingle ducks the effects while it plays, so it's heard over them.
const BASE: Record<Bus, number> = { engine: 0.5, fx: 0.6, jingle: 0.55, ambience: 0.3 };
// And as the settings turn them up or down (setVolumes), with all of it.
const LEVEL: Record<Bus, number> = { ...BASE };
let volume = 1;
// Two seconds of white noise, made once, for every sound that needs some: each reads from a random
// place in it.
let hiss: AudioBuffer | null = null;

export function unlockAudio(): void {
  try {
    if (!ctx) {
      const c = new AudioContext();
      // A limiter: a compressor with no knee and a high ratio, catching anything over −6 dB within a
      // few milliseconds. The browser adds a fixed make-up gain after it (about +3.4 dB for these
      // settings), which the trim takes back off so its loudest stays under −1 dBFS.
      const limiter = c.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      const trim = c.createGain();
      trim.gain.value = 0.75;
      master = c.createGain();
      limiter.connect(trim).connect(master).connect(c.destination);
      bus = { engine: c.createGain(), fx: c.createGain(), jingle: c.createGain(), ambience: c.createGain() };
      for (const [k, g] of Object.entries(bus) as [Bus, GainNode][]) {
        g.gain.value = LEVEL[k];
        g.connect(limiter);
      }
      hiss = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = hiss.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      ctx = c;
      void loadCity(c);
      master.gain.value = muted ? 0 : volume;
      if (metering) meter = newMeter(c, master);
    }
    // Safari also has 'interrupted', after a phone call or the page going to the background.
    if (ctx.state !== 'running') void ctx.resume();
  } catch {
    ctx = null;
  }
}

export const isMuted = () => muted;

export function toggleMute(): boolean {
  muted = !muted;
  if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.01);
  return muted;
}

// The settings' levels, 0 to 1: all of it, the engines, the effects (the items, the guns, the hits),
// the city round you, and the jingles.
export function setVolumes(v: { volume: number; engines: number; effects: number; city: number; music: number }): void {
  volume = v.volume;
  const part: Record<Bus, number> = { engine: v.engines, fx: v.effects, jingle: v.music, ambience: v.city };
  for (const k of Object.keys(BASE) as Bus[]) LEVEL[k] = BASE[k] * part[k];
  if (!ctx || !master || !bus) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(muted ? 0 : volume, t, 0.02);
  for (const k of Object.keys(BASE) as Bus[]) {
    bus[k].gain.cancelScheduledValues(t);
    bus[k].gain.setTargetAtTime(LEVEL[k], t, 0.02);
  }
}

// ---- Where sounds are heard from ----

export interface Place {
  x: number;
  y: number;
  z: number;
}
// The listener, where the camera is: its position, the way it looks and its up; and how fast it
// moves, from how far it went since the last frame, for the engines' Doppler shift.
const ear = { x: 0, y: 0, z: 0 };
const earV = { x: 0, y: 0, z: 0 };
let earAt = 0;
export function listen(p: Place, f: Place, u: Place): void {
  if (!ctx) return;
  const l = ctx.listener;
  const s = performance.now() / 1000;
  const dt = s - earAt;
  earAt = s;
  if (dt > 0 && dt < 0.25) {
    const k = Math.min(1, dt / 0.1);
    earV.x += ((p.x - ear.x) / dt - earV.x) * k;
    earV.y += ((p.y - ear.y) / dt - earV.y) * k;
    earV.z += ((p.z - ear.z) / dt - earV.z) * k;
  }
  Object.assign(ear, { x: p.x, y: p.y, z: p.z });
  if (l.positionX) {
    l.positionX.value = p.x;
    l.positionY.value = p.y;
    l.positionZ.value = p.z;
    l.forwardX.value = f.x;
    l.forwardY.value = f.y;
    l.forwardZ.value = f.z;
    l.upX.value = u.x;
    l.upY.value = u.y;
    l.upZ.value = u.z;
  } else {
    // Older Safari has only the methods.
    l.setPosition(p.x, p.y, p.z);
    l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
  }
}

// A sound at its own place is as loud as in your head within REF metres, and falls off with
// distance from there: at 120 m it's a twelfth as loud (−22 dB), faint but heard. Past HEARD it
// isn't played at all.
const REF = 10;
const HEARD = 400;
// How many sounds may play at once: past it, an effect is dropped (a jingle never is).
const MAX_PLAYING = 24;
let playing = 0;

// A panner: as loud as in your head within REF metres, and fainter with distance from there.
function panner(c: AudioContext): PannerNode {
  const p = c.createPanner();
  p.panningModel = 'equalpower';
  p.distanceModel = 'inverse';
  p.refDistance = REF;
  p.rolloffFactor = 1;
  return p;
}

// Puts a panner at a place: at once, or, following something that moves, smoothly over a frame.
function place(p: PannerNode, at: Place, t: number, jump: boolean): void {
  if (!p.positionX) return p.setPosition(at.x, at.y, at.z);
  for (const [param, v] of [
    [p.positionX, at.x],
    [p.positionY, at.y],
    [p.positionZ, at.z],
  ] as const) {
    if (jump) {
      param.cancelScheduledValues(t);
      param.setValueAtTime(v, t);
    } else param.setTargetAtTime(v, t, 0.02);
  }
}

// How many of each sound have played since the race began, for scripts/listen.mjs to say what a
// take had in it.
export const played: Record<string, number> = {};

// Where a sound plays into: its bus, through a panner at its place if it has one. Null when it
// isn't to be played: no sound yet, too many at once, or too far away to hear. A loud one (a gunshot)
// is as loud as in your head within `ref` metres, and heard as far as `heard`.
function out(b: Bus, what: string, dur: number, at?: Place, ref = REF, heard = HEARD): AudioNode | null {
  if (!ctx || !bus) return null;
  if (b !== 'jingle' && playing >= MAX_PLAYING) return null;
  let node: AudioNode = bus[b];
  if (at) {
    if (Math.hypot(at.x - ear.x, at.y - ear.y, at.z - ear.z) > heard) return null;
    const p = panner(ctx);
    p.refDistance = ref;
    place(p, at, ctx.currentTime, true);
    p.connect(node);
    node = p;
    setTimeout(() => p.disconnect(), (dur + 0.5) * 1000);
  }
  playing++;
  setTimeout(() => playing--, dur * 1000);
  played[what] = (played[what] ?? 0) + 1;
  return node;
}

// A jingle ducks the effects for as long as it plays, and lets them back up gently.
let duckEnd = 0;
function duck(dur: number): void {
  if (!ctx || !bus) return;
  const t = ctx.currentTime;
  const g = bus.fx.gain;
  duckEnd = Math.max(duckEnd, t + dur);
  g.cancelScheduledValues(t);
  g.setTargetAtTime(LEVEL.fx * 0.4, t, 0.03);
  g.setTargetAtTime(LEVEL.fx, duckEnd, 0.15);
}

// ---- What sounds are made of ----

interface NoteOpts {
  type?: OscillatorType;
  // Two voices this many cents apart rather than one, for warmth.
  detune?: number;
  // A low-pass's cutoff, taking the edge off a triangle or a sawtooth.
  cutoff?: number;
  // A pitch to slide to over the note.
  to?: number;
  attack?: number;
  // Holds at full volume until this long before the end, then lets go quickly, as a horn or a
  // whistle does, where a struck note dies away from the start.
  hold?: boolean;
}

// A note that fades in over a few milliseconds and out to nothing, so it neither clicks in nor out.
function note(o: AudioNode, f: number, at: number, dur: number, gain: number, opt: NoteOpts = {}): void {
  if (!ctx) return;
  const g = ctx.createGain();
  const attack = opt.attack ?? 0.008;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + attack);
  if (opt.hold) {
    g.gain.setValueAtTime(gain, Math.max(at + attack, at + dur - 0.05));
    g.gain.linearRampToValueAtTime(0, at + dur);
  } else g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  let into: AudioNode = g;
  if (opt.cutoff) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = opt.cutoff;
    lp.connect(g);
    into = lp;
  }
  g.connect(o);
  for (const cents of opt.detune ? [-opt.detune / 2, opt.detune / 2] : [0]) {
    const osc = ctx.createOscillator();
    osc.type = opt.type ?? 'sine';
    osc.frequency.setValueAtTime(f, at);
    if (opt.to) osc.frequency.exponentialRampToValueAtTime(opt.to, at + dur);
    osc.detune.value = cents;
    if (opt.detune) {
      const half = ctx.createGain();
      half.gain.value = 0.5;
      osc.connect(half).connect(into);
    } else osc.connect(into);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }
}

// A struck bar, as a vibraphone's: a sine and a quiet, quickly gone partial two octaves up for the
// mallet's tap. Every jingle is made of these, so the countdown, the checkpoints, the laps and the
// finish sound like one family.
function bell(o: AudioNode, f: number, at: number, dur: number, gain: number): void {
  note(o, f, at, dur, gain, { attack: 0.004, detune: 4 });
  note(o, f * 4, at, dur * 0.18, gain * 0.12, { attack: 0.002 });
}

// Noise through a filter that sweeps from one frequency to another: whooshes, crashes, explosions.
function noise(o: AudioNode, at: number, dur: number, gain: number, from: number, to: number, type: BiquadFilterType = 'lowpass', q = 1, attack = 0.004): void {
  if (!ctx || !hiss) return;
  const src = ctx.createBufferSource();
  src.buffer = hiss;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, at);
  f.frequency.exponentialRampToValueAtTime(to, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(o);
  src.start(at, Math.random() * 2);
  src.stop(at + dur + 0.02);
}

const now = () => ctx?.currentTime ?? 0;
let lastBump = 0;

// ---- The jingles: the countdown, checkpoints, laps and the finish, notes of C major ----

const C5 = 523.25;
const E5 = 659.26;
const G5 = 783.99;
const C6 = 1046.5;
const E6 = 1318.51;
const G6 = 1567.98;

function jingle(what: string, notes: number[], step: number, dur: number, gain: number, last = dur): void {
  const length = (notes.length - 1) * step + last;
  const o = out('jingle', what, length);
  if (!o) return;
  duck(length);
  const t = now();
  notes.forEach((f, i) => bell(o, f, t + i * step, i === notes.length - 1 ? last : dur, gain));
}

// The countdown: three low strokes, and on "go" the same note an octave up as a full chord.
export function beep(high: boolean): void {
  if (!high) return jingle('countdown', [C5], 0, 0.4, 0.3);
  const o = out('jingle', 'countdown', 1.2);
  if (!o) return;
  duck(1.2);
  const t = now();
  [C5, E5, G5, C6].forEach((f, i) => bell(o, f, t, 1.2, [0.085, 0.085, 0.1, 0.18][i]));
}

// A checkpoint: up a fifth when you're faster than your best (or have none yet), down a third and
// lower when slower.
export function checkpointSound(faster: boolean | null): void {
  if (faster === false) jingle('checkpoint', [440, 349.23], 0.1, 0.35, 0.24);
  else jingle('checkpoint', [C6, G6], 0.08, 0.35, 0.22);
}

export function lapSound(best: boolean): void {
  jingle('lap', best ? [C5, E5, G5, C6, E6] : [C5, E5, G5], 0.09, 0.45, 0.24, 0.9);
}

function finish(place: number): void {
  if (place <= 3) jingle('finish', [C5, E5, G5, C6, E6, G6], 0.11, 0.5, 0.24, 1.6);
  else jingle('finish', [392, C5, E5], 0.13, 0.5, 0.24, 1.2);
}

// ---- The horns ----

// A driver's horn plays its notes, each as a car's twin horn does: two buzzing reeds a major third
// apart, their brightness held down by a low-pass so it honks rather than rasps. Others' honks are
// heard from their kart.
export function horn(notes: number[], volume = 1, at?: Place): void {
  const o = out('fx', 'horn', notes.length * 0.13 + 0.1, at);
  if (!o) return;
  const t = now();
  notes.forEach((f, i) => {
    const cut = Math.min(3200, f * 5);
    note(o, f, t + i * 0.13, 0.17, 0.11 * volume, { type: 'sawtooth', detune: 10, cutoff: cut, attack: 0.012, hold: true });
    note(o, f * 1.26, t + i * 0.13, 0.17, 0.06 * volume, { type: 'sawtooth', cutoff: cut, attack: 0.012, hold: true });
  });
}

// ---- The engines: a race car's V8 through six gears, synthesized, for every kart ----

// A kart as the engines hear it.
export interface Kart {
  id: string;
  p: Place;
  v: Place;
  speed: number;
  throttle: number;
  grounded: boolean;
}
// Yours, with what your tyres are doing.
export interface MyKart extends Kart {
  drifting: boolean;
  // How fast it slides sideways, m/s.
  slip: number;
  cobble: boolean;
}

// The gearbox, in rpm: idling at 1,200, pulling away on the clutch at 5,000, shifting up at 9,000
// and down below 5,200, the limiter at 9,300. Each of the six gears reaches the shift point at its
// own speed, a third more than the gear before's, sixth at 46 m/s: flat out (VMAX, 44 m/s) is just
// under it, and a boost runs into the limiter.
const IDLE = 1200;
const LAUNCH = 5000;
const SHIFT_UP = 9000;
const SHIFT_DOWN = 5200;
const LIMIT = 9300;
const GEARS = [10.9, 14.6, 19.4, 25.9, 34.5, 46];
// The karts' top speed, m/s, for the wind.
const VMAX = 44;

// The revs a kart's engine wants now, shifting its gear when it's time: up past the shift point,
// down when the revs fall too low, one gear at a time and not while a shift is going through.
function revsFor(v: Voice, k: Kart, t: number): number {
  const at = (g: number) => (SHIFT_UP * k.speed) / GEARS[g];
  if (t > v.shifting) {
    if (v.gear < GEARS.length - 1 && at(v.gear) > SHIFT_UP) shift(v, t, 1);
    else if (v.gear > 0 && at(v.gear) < SHIFT_DOWN) shift(v, t, -1);
  }
  const on = k.throttle > 0.1;
  let r = at(v.gear);
  // Pulling away, the clutch slips and the revs hold up while the wheels catch up; off the throttle
  // and slow, it lets go and the engine idles.
  if (v.gear === 0 && on) r = Math.max(r, IDLE + (LAUNCH - IDLE) * k.throttle);
  if (!on && k.speed < 6) r = IDLE;
  // Off the ground, the wheels spin up.
  if (!k.grounded && on) r *= 1.1;
  return clamp(r, IDLE, LIMIT);
}

// A shift: up, the power cut for a moment and the revs dropping to the next gear's, now and then
// with a pop from the exhaust; down, the revs blipped up to the lower gear's.
function shift(v: Voice, t: number, by: number): void {
  v.gear += by;
  v.shifting = t + (by > 0 ? 0.14 : 0.1);
  if (by > 0) {
    v.cut = t + 0.08;
    if (Math.random() < 0.4) v.pop = 0.5;
  }
}

// The engine's sound, once every two revolutions (a four-stroke's cycle): its harmonics fall away
// slowly, the eighth and its multiples strongest, as a V8 fires four times a revolution, the fourth's
// next, and the ones between weaker but there, which is what makes it an engine and not a buzz.
// Their phases spread, so the wave has no sharp peak to rasp.
let pulse: PeriodicWave | null = null;
function pulseWave(c: AudioContext): PeriodicWave {
  const n = 96;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let h = 1; h < n; h++) {
    const a = (h % 8 === 0 ? 4 : h % 4 === 0 ? 1.8 : h % 2 === 0 ? 1 : 0.55) / Math.pow(h, 0.75);
    re[h] = a * Math.cos(h * 2.4);
    im[h] = a * Math.sin(h * 2.4);
  }
  return c.createPeriodicWave(re, im);
}

// An engine playing. The cycle's wave, through the exhaust's body, the intake's howl (rising with
// the revs, and loud on the throttle) and a low-pass; under it, noise pulsing at the firing rate, the
// intake's rasp; the firing never quite steady; and its gear. For someone else's kart, a panner
// where it is.
interface Voice {
  id: string;
  // What makes the sound, stopped when nobody's voice it is, and started again when it's needed.
  osc: OscillatorNode | null;
  beat: OscillatorNode | null;
  rasp: AudioBufferSourceNode | null;
  wobble: AudioBufferSourceNode | null;
  body: BiquadFilterNode;
  howl: BiquadFilterNode;
  tone: BiquadFilterNode;
  intake: BiquadFilterNode;
  am: GainNode;
  shake: GainNode;
  level: GainNode;
  pan: PannerNode | null;
  rpm: number;
  gear: number;
  // Until when a shift is going through, the power is cut, and how loud a pop is still to come.
  shifting: number;
  cut: number;
  pop: number;
  // A voice let go fades out until then, and is silent, and anyone's, after.
  free: number;
}

function newVoice(c: AudioContext, b: GainNode, placed: boolean): Voice {
  const filter = (type: BiquadFilterType, f: number, q: number, gain = 0) => {
    const x = c.createBiquadFilter();
    x.type = type;
    x.frequency.value = f;
    x.Q.value = q;
    x.gain.value = gain;
    return x;
  };
  const body = filter('peaking', 350, 0.9, 5);
  const howl = filter('peaking', 1200, 3, 6);
  const tone = filter('lowpass', 5000, 0.6);
  const intake = filter('bandpass', 2000, 0.9);
  const am = c.createGain();
  am.gain.value = 0.5;
  const air = c.createGain();
  air.gain.value = 0.25;
  const shake = c.createGain();
  shake.gain.value = 10;
  const level = c.createGain();
  level.gain.value = 0;
  body.connect(howl).connect(tone).connect(level);
  intake.connect(am).connect(air).connect(tone);
  const pan = placed ? panner(c) : null;
  if (pan) level.connect(pan).connect(b);
  else level.connect(b);
  return { id: '', osc: null, beat: null, rasp: null, wobble: null, body, howl, tone, intake, am, shake, level, pan, rpm: IDLE, gear: 0, shifting: 0, cut: 0, pop: 0, free: 0 };
}

function start(v: Voice, c: AudioContext, n: AudioBuffer): void {
  pulse ??= pulseWave(c);
  const osc = c.createOscillator();
  osc.setPeriodicWave(pulse);
  osc.frequency.value = v.rpm / 120;
  osc.connect(v.body);
  // The rasp's level follows each firing.
  const beat = c.createOscillator();
  beat.frequency.value = v.rpm / 15;
  const depth = c.createGain();
  depth.gain.value = 0.5;
  beat.connect(depth).connect(v.am.gain);
  const rasp = c.createBufferSource();
  rasp.buffer = n;
  rasp.loop = true;
  rasp.connect(v.intake);
  // The unsteadiness: noise played very slowly, a few cents either way, as no two firings are alike.
  const wobble = c.createBufferSource();
  wobble.buffer = n;
  wobble.loop = true;
  wobble.playbackRate.value = 0.004;
  wobble.connect(v.shake);
  v.shake.connect(osc.detune);
  v.shake.connect(beat.detune);
  const t = c.currentTime;
  for (const x of [osc, beat]) x.start(t);
  rasp.start(t, Math.random() * n.duration);
  wobble.start(t, Math.random() * n.duration);
  Object.assign(v, { osc, beat, rasp, wobble });
}

// Stops a voice: one nobody's costs nothing.
function hush(v: Voice): void {
  for (const x of [v.osc, v.beat, v.rasp, v.wobble]) x?.stop();
  v.shake.disconnect();
  Object.assign(v, { osc: null, beat: null, rasp: null, wobble: null });
}

// A crack from the exhaust: a few milliseconds of noise, straight out past the low-pass.
function crack(v: Voice, c: AudioContext, n: AudioBuffer, gain: number): void {
  const t = c.currentTime;
  const s = c.createBufferSource();
  s.buffer = n;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 900 + Math.random() * 900;
  f.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  s.connect(f).connect(g).connect(v.level);
  s.start(t, Math.random() * n.duration);
  s.stop(t + 0.06);
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
// How loud an engine is, at its loudest, before its bus.
const VOICE = 0.4;

function play(v: Voice, k: Kart, dt: number, doppler: number): void {
  if (!ctx || !hiss) return;
  const c = ctx;
  const t = c.currentTime;
  const want = revsFor(v, k, t);
  // The revs follow quickly through a shift, rise quicker than they fall otherwise.
  const tau = t < v.shifting ? 0.035 : want > v.rpm ? 0.08 : 0.2;
  v.rpm += (want - v.rpm) * (1 - Math.exp(-dt / tau));
  if (!v.osc) start(v, c, hiss);
  v.osc?.frequency.setTargetAtTime((v.rpm / 120) * doppler, t, 0.02);
  v.beat?.frequency.setTargetAtTime((v.rpm / 15) * doppler, t, 0.02);
  const on = k.throttle > 0.1;
  const load = clamp((v.rpm - IDLE) / (SHIFT_UP - IDLE), 0, 1);
  // On the throttle the intake howls and the tone opens; off it, the engine burbles, darker and
  // less steady; in the air, it's softer.
  v.howl.frequency.setTargetAtTime((2 * v.rpm) / 15, t, 0.03);
  v.howl.gain.setTargetAtTime(on ? 8 : 2, t, 0.08);
  v.tone.frequency.setTargetAtTime(on ? (k.grounded ? 6500 : 3500) : 2200, t, 0.06);
  v.intake.frequency.setTargetAtTime(2000 + v.rpm / 10, t, 0.05);
  v.shake.gain.setTargetAtTime(on ? 8 : 25, t, 0.1);
  const cut = t < v.cut ? 0.35 : 1;
  v.level.gain.setTargetAtTime(VOICE * cut * (0.4 + 0.4 * load + (on ? 0.2 : 0)), t, t < v.cut ? 0.01 : 0.04);
  // Pops: on an upshift now and then, and off the throttle at high revs, the overrun's crackle.
  if (v.pop) {
    crack(v, c, hiss, VOICE * v.pop);
    v.pop = 0;
  }
  if (!on && v.rpm > 5500 && Math.random() < dt * 4) crack(v, c, hiss, VOICE * 0.3 * Math.random());
}

// The nearest others within earshot have an engine each: more would cost a phone and add nothing.
const HEARD_KARTS = 3;
const EARSHOT = 150;
// The speed of sound, for the Doppler shift.
const SOUND = 343;
let mine: Voice | null = null;
const theirs: Voice[] = [];

// Once a race is over nothing calls engines(), so this silences the voices when they've faded.
function settle(): void {
  if (!ctx) return;
  const t = ctx.currentTime;
  if (mine?.free && t > mine.free) hush(mine);
  for (const v of theirs) if (!v.id && t > v.free) hush(v);
}

// Every frame of a race: your engine, in your head, the nearest others' from where they are, and
// your tyres and the wind. Without your kart yours fades out (flying, it's one of the others), and
// without others theirs do; and once yours has, everything's silenced, in case no frame comes again.
export function engines(me: MyKart | null, others: Kart[], dt: number): void {
  if (!ctx || !bus) return;
  const c = ctx;
  const t = c.currentTime;
  tyres(me);
  mine ??= newVoice(c, bus.engine, false);
  if (me) {
    mine.free = 0;
    play(mine, me, dt, 1);
  } else if (!mine.free) {
    mine.level.gain.setTargetAtTime(0, t, 0.1);
    mine.free = t + 0.5;
    mine.gear = 0;
    setTimeout(settle, 700);
  } else if (t > mine.free) hush(mine);
  const near = others
    .map((k) => ({ k, d: Math.hypot(k.p.x - ear.x, k.p.y - ear.y, k.p.z - ear.z) }))
    .filter((x) => x.d < EARSHOT)
    .sort((a, b) => a.d - b.d)
    .slice(0, HEARD_KARTS);
  for (const v of theirs) {
    if (v.id && !near.some((x) => x.k.id === v.id)) {
      v.level.gain.setTargetAtTime(0, t, 0.1);
      v.id = '';
      v.free = t + 0.5;
    }
    if (!v.id && t > v.free) hush(v);
  }
  for (const { k, d } of near) {
    let v = theirs.find((x) => x.id === k.id);
    if (!v) {
      v = theirs.find((x) => !x.id && t > x.free);
      if (!v && theirs.length < HEARD_KARTS) theirs.push((v = newVoice(c, bus.engine, true)));
      if (!v) continue;
      v.id = k.id;
      // A kart heard for the first time is in the gear for its speed.
      const g = GEARS.findIndex((top) => k.speed < top * 0.95);
      v.gear = g < 0 ? GEARS.length - 1 : g;
      v.rpm = clamp((SHIFT_UP * k.speed) / GEARS[v.gear], IDLE, LIMIT);
      if (v.pan) place(v.pan, k.p, t, true);
    } else if (v.pan) place(v.pan, k.p, t, false);
    // Doppler: higher coming, lower going, from how fast the kart and the camera close on each other.
    const u = { x: (k.p.x - ear.x) / (d || 1), y: (k.p.y - ear.y) / (d || 1), z: (k.p.z - ear.z) / (d || 1) };
    const away = k.v.x * u.x + k.v.y * u.y + k.v.z * u.z;
    const toward = earV.x * u.x + earV.y * u.y + earV.z * u.z;
    play(v, k, dt, clamp((SOUND + toward) / (SOUND + away), 0.7, 1.4));
  }
}

// ---- Your tyres and the wind, synthesized ----

// Noise, filtered three ways: a scrub when the tyres slide, a rumble on the cobbles shaken at the
// rate the stones go by, and wind rising with speed.
let tyre: { scrub: GainNode; rumble: GainNode; stones: OscillatorNode; wind: GainNode; gust: BiquadFilterNode } | null = null;

function newTyres(c: AudioContext, b: GainNode, n: AudioBuffer): NonNullable<typeof tyre> {
  const chain = (type: BiquadFilterType, f: number, q: number) => {
    const s = c.createBufferSource();
    s.buffer = n;
    s.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = f;
    filter.Q.value = q;
    const g = c.createGain();
    g.gain.value = 0;
    s.connect(filter);
    s.start(c.currentTime, Math.random() * n.duration);
    return { filter, g };
  };
  const scrub = chain('bandpass', 2400, 1.2);
  scrub.filter.connect(scrub.g).connect(b);
  // The cobbles: the rumble's level swings with a triangle at the rate the stones pass.
  const rumble = chain('lowpass', 260, 0.7);
  const shake = c.createGain();
  shake.gain.value = 0.6;
  const stones = c.createOscillator();
  stones.type = 'triangle';
  stones.frequency.value = 50;
  const depth = c.createGain();
  depth.gain.value = 0.4;
  stones.connect(depth).connect(shake.gain);
  stones.start();
  rumble.filter.connect(shake).connect(rumble.g).connect(b);
  const wind = chain('bandpass', 600, 0.6);
  wind.filter.connect(wind.g).connect(b);
  return { scrub: scrub.g, rumble: rumble.g, stones, wind: wind.g, gust: wind.filter };
}

function tyres(me: MyKart | null): void {
  if (!ctx || !bus || !hiss) return;
  const t = ctx.currentTime;
  tyre ??= newTyres(ctx, bus.engine, hiss);
  const s = me?.speed ?? 0;
  const on = me?.grounded ?? false;
  // A drift scrubs all through it; cornering hard only once the tyres slide.
  const slide = !me || !on ? 0 : me.drifting ? 0.6 + 0.4 * clamp(me.slip / 10, 0, 1) : clamp((me.slip - 4) / 8, 0, 1);
  tyre.scrub.gain.setTargetAtTime(0.35 * slide * clamp(s / 15, 0, 1), t, 0.08);
  // Granite setts are about 12 cm long.
  tyre.rumble.gain.setTargetAtTime(me?.cobble && on ? clamp(s / 20, 0, 1) : 0, t, 0.08);
  tyre.stones.frequency.setTargetAtTime(clamp(s / 0.12, 5, 220), t, 0.08);
  tyre.wind.gain.setTargetAtTime(0.2 * (s / VMAX) ** 2 * (on ? 1 : 1.3), t, 0.15);
  tyre.gust.frequency.setTargetAtTime(500 + 35 * s, t, 0.15);
}

// ---- Braga round the track: recorded, CC0 (braga-map's docs/SOURCES.md says from where) ----

// Beds that loop, each with its own wrap-around PAD seconds either side (so a decoder's delay at the
// start doesn't matter), and sounds played once. `trim` evens out how loud each was cut.
const CITY = {
  traffic: { url: new URL('./sounds/traffic.mp3', import.meta.url).href, seconds: 12, trim: 0.55 },
  town: { url: new URL('./sounds/town.mp3', import.meta.url).href, seconds: 12, trim: 0.45 },
  park: { url: new URL('./sounds/park.mp3', import.meta.url).href, seconds: 20, trim: 0.5 },
  woods: { url: new URL('./sounds/woods.mp3', import.meta.url).href, seconds: 16, trim: 0.55 },
  water: { url: new URL('./sounds/water.mp3', import.meta.url).href, seconds: 10, trim: 1.2 },
  crowd: { url: new URL('./sounds/crowd.mp3', import.meta.url).href, seconds: 12, trim: 0.6 },
  bells: { url: new URL('./sounds/bells.mp3', import.meta.url).href, seconds: 0, trim: 0.8 },
  bus: { url: new URL('./sounds/bus.mp3', import.meta.url).href, seconds: 0, trim: 0.7 },
};
type CitySound = keyof typeof CITY;
const PAD = 0.1;
let recorded: Record<CitySound, AudioBuffer> | null = null;

// Fetched once the sound is unlocked, after the city, so they never hold a race up: until they're
// in, the city is silent.
async function loadCity(c: AudioContext): Promise<void> {
  try {
    const got = await Promise.all(
      Object.entries(CITY).map(async ([k, s]) => {
        const b = await c.decodeAudioData(await (await fetch(s.url)).arrayBuffer());
        if (!s.seconds) return [k, b] as const;
        // A bed: one loop from PAD, its head crossfaded over 10 ms with what follows its end, as MP3
        // never codes the same sound the same way twice and the seam would show it.
        const n = Math.round(s.seconds * c.sampleRate);
        const p = Math.round(PAD * c.sampleRate);
        const x = Math.round(0.01 * c.sampleRate);
        const d = b.getChannelData(0);
        const loop = c.createBuffer(1, n, c.sampleRate);
        const o = loop.getChannelData(0);
        for (let i = 0; i < n; i++) o[i] = d[p + i];
        for (let i = 0; i < x; i++) o[i] = d[p + i] * (i / x) + d[p + n + i] * (1 - i / x);
        return [k, loop] as const;
      }),
    );
    recorded = Object.fromEntries(got) as Record<CitySound, AudioBuffer>;
  } catch {
    recorded = null;
  }
}

// What's round the city, worked out from the map once it's built (src/ambience.ts).
let around: Ambience | null = null;
export function cityIs(a: Ambience): void {
  around = a;
}

// A bed playing: a loop through its level, and for the river and the crowd, a panner where they are.
interface Bed {
  src: AudioBufferSourceNode;
  level: GainNode;
  pan: PannerNode | null;
}
const beds: Partial<Record<CitySound, Bed>> = {};
// Each bed's loudest level since the race began, for scripts/listen.mjs to say what a take had in it.
export const cityHeard: Partial<Record<CitySound, number>> = {};
const heard = (k: CitySound, v: number) => (cityHeard[k] = +Math.max(cityHeard[k] ?? 0, v).toFixed(2));

function bed(k: CitySound, placed: boolean): Bed | null {
  if (!ctx || !bus || !recorded) return null;
  const have = beds[k];
  if (have) return have;
  const c = ctx;
  const src = c.createBufferSource();
  src.buffer = recorded[k];
  src.loop = true;
  const level = c.createGain();
  level.gain.value = 0;
  const pan = placed ? panner(c) : null;
  src.connect(level);
  if (pan) level.connect(pan).connect(bus.ambience);
  else level.connect(bus.ambience);
  src.start(c.currentTime, Math.random() * recorded[k].duration);
  return (beds[k] = { src, level, pan });
}

// Silences the city once it has faded: nothing plays it with no kart driving.
function quietCity(): void {
  for (const [k, b] of Object.entries(beds) as [CitySound, Bed][]) {
    b.src.stop();
    delete beds[k];
  }
}

// How far the river and the crowd carry, and how near a church or a bus stop has to be to be heard
// now and then as you pass.
const RIVER_HEARD = 120;
const CROWD_HEARD = 400;
const BELLS_HEARD = 400;
const PASSING = 100;
let cityClock = 0;
let quieting = 0;
let lastBells = -1e9;
let lastBus = -1e9;
let lastStrike = '';
const rung = new Set<Spot>();
const stopped = new Set<Spot>();
const nearest = (spots: Spot[]) => {
  let best: Spot | null = null;
  let d = Infinity;
  for (const s of spots) {
    const e = Math.hypot(s.x - ear.x, s.z - ear.z);
    if (e < d) {
      d = e;
      best = s;
    }
  }
  return { at: best, d };
};

// The time in Braga, as "hh:mm".
const braga = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', hour12: false });

// Every frame while you drive, in a race or round the city, with where your kart is; null when no
// kart is. The beds follow the place every half second, slowly enough not to pump; the river, the
// crowd, the bells and the buses are heard from where they are.
export function citySound(at: { x: number; z: number } | null, dt: number): void {
  if (!ctx || !bus || !recorded || !around) return;
  const t = ctx.currentTime;
  if (at === null) {
    for (const b of Object.values(beds)) b.level.gain.setTargetAtTime(0, t, 0.5);
    if (!quieting && Object.keys(beds).length) quieting = window.setTimeout(() => ((quieting = 0), quietCity()), 3000);
    return;
  }
  if (quieting) {
    clearTimeout(quieting);
    quieting = 0;
  }
  cityClock += dt;
  if (cityClock < 0.5) return;
  cityClock = 0;
  const s = surroundAt(around, at.x, at.z);
  // Traffic where the streets are busy; the town's hum under it where there are houses; birds in
  // the parks and gardens; insects and birds where it's wooded.
  const want: [CitySound, number][] = [
    ['traffic', s.traffic],
    ['town', s.town * (1 - 0.5 * s.traffic)],
    ['park', s.park],
    ['woods', s.woods],
  ];
  for (const [k, w] of want) {
    const b = w > 0.02 || beds[k] ? bed(k, false) : null;
    b?.level.gain.setTargetAtTime(CITY[k].trim * w, t, 1.5);
    if (b) heard(k, CITY[k].trim * w);
  }
  // The river, from its nearest water.
  const r = nearest(around.water);
  const river = r.d < RIVER_HEARD || beds.water ? bed('water', true) : null;
  if (river && r.at) {
    if (river.pan) place(river.pan, r.at, t, false);
    river.level.gain.setTargetAtTime(r.d < RIVER_HEARD ? CITY.water.trim : 0, t, 1);
    if (r.d < RIVER_HEARD) heard('water', CITY.water.trim * Math.min(1, REF / Math.max(REF, r.d)));
  }
  // The crowd, from the stadium.
  const st = around.stadium;
  const sd = st ? Math.hypot(st.x - ear.x, st.z - ear.z) : Infinity;
  const crowd = st && (sd < CROWD_HEARD || beds.crowd) ? bed('crowd', true) : null;
  if (crowd && st) {
    if (crowd.pan) place(crowd.pan, st, t, true);
    crowd.level.gain.setTargetAtTime(sd < CROWD_HEARD ? CITY.crowd.trim : 0, t, 1.5);
    if (sd < CROWD_HEARD) heard('crowd', CITY.crowd.trim * Math.min(1, REF / Math.max(REF, sd)));
  }
  // The bells: from the nearest church at the hour and the half hour, Braga's time; and now and
  // then from one you pass, at most once a minute.
  const now = braga.format(new Date());
  const ch = nearest(around.churches);
  if (ch.at && (now.endsWith(':00') || now.endsWith(':30')) && now !== lastStrike && ch.d < BELLS_HEARD) {
    lastStrike = now;
    once('bells', ch.at);
  } else if (ch.at && ch.d < PASSING && !rung.has(ch.at)) {
    rung.add(ch.at);
    if (t - lastBells > 60 && Math.random() < 0.25) {
      lastBells = t;
      once('bells', ch.at);
    }
  }
  // A bus pulling away from a stop you pass, now and then.
  const bs = nearest(around.stops);
  if (bs.at && bs.d < 30 && !stopped.has(bs.at)) {
    stopped.add(bs.at);
    if (t - lastBus > 30 && Math.random() < 0.35) {
      lastBus = t;
      once('bus', bs.at);
    }
  }
  // Passed is forgotten once it's far behind, so the next lap can ring again.
  for (const set of [rung, stopped]) for (const x of set) if (Math.hypot(x.x - ear.x, x.z - ear.z) > 300) set.delete(x);
}

// A recording played once, from where it happens.
function once(k: CitySound, at: Spot): void {
  if (!ctx || !recorded) return;
  const o = out('ambience', k, recorded[k].duration, at);
  if (!o) return;
  const s = ctx.createBufferSource();
  s.buffer = recorded[k];
  const g = ctx.createGain();
  g.gain.value = CITY[k].trim;
  s.connect(g).connect(o);
  s.start();
}

// A landing or a wall: a low thump that drops in pitch, its weight from how hard it was.
export function thud(strength: number): void {
  const o = out('fx', 'thud', 0.2);
  if (o) note(o, 75 + Math.random() * 20, now(), 0.2, Math.min(0.45, strength * 0.05), { to: 42, attack: 0.004 });
}

// ---- The effects: items, hits, the eggs ----

// Each takes its place in the world when it has one; without, it's yours, in your head.
export const sfx = {
  // An item box: two glassy notes going up.
  box: () => {
    const o = out('fx', 'box', 0.3);
    if (!o) return;
    note(o, E6, now(), 0.16, 0.12, { detune: 8, attack: 0.004 });
    note(o, 1760, now() + 0.06, 0.24, 0.1, { detune: 8, attack: 0.004 });
  },
  // The roulette: a soft tap of wood, at a different pitch each time.
  tick: () => {
    const o = out('fx', 'tick', 0.03);
    if (o) note(o, 1700 + Math.random() * 500, now(), 0.025, 0.025, { attack: 0.002 });
  },
  // An item won: a little rising arpeggio, G major.
  got: () => {
    const o = out('fx', 'got', 0.4);
    if (!o) return;
    [783.99, 987.77, 1174.66].forEach((f, i) => bell(o, f, now() + i * 0.05, 0.28, 0.12));
  },
  // A cork, out of the café's bottle: a quick drop in pitch and a click.
  pop: (at?: Place) => {
    const o = out('fx', 'pop', 0.12, at);
    if (!o) return;
    note(o, 700, now(), 0.09, 0.28, { to: 170, attack: 0.002 });
    noise(o, now(), 0.04, 0.15, 3000, 1500, 'bandpass', 1.5, 0.002);
  },
  // Something thrown: a whoosh that swells and goes.
  throw: (at?: Place) => {
    const o = out('fx', 'throw', 0.35, at);
    if (o) noise(o, now(), 0.35, 0.4, 500, 2600, 'bandpass', 1.2, 0.1);
  },
  // The martelinho: a squeaky plastic hammer, bonk-squeak twice.
  hammer: (at?: Place) => {
    const o = out('fx', 'hammer', 0.4, at);
    if (!o) return;
    for (const at of [now(), now() + 0.22]) {
      noise(o, at, 0.06, 0.35, 900, 300, 'bandpass', 1, 0.002);
      note(o, 1400, at + 0.02, 0.14, 0.16, { type: 'triangle', to: 2600, cutoff: 5000, attack: 0.02 });
    }
  },
  // The foguete going off: a deep thump falling away under a rumble of noise.
  boom: (at?: Place) => {
    const o = out('fx', 'boom', 1.3, at);
    if (!o) return;
    note(o, 95, now(), 0.7, 0.55, { to: 32, attack: 0.004 });
    noise(o, now(), 1.3, 0.6, 2200, 70, 'lowpass', 0.7, 0.004);
  },
  // Hit: a bonk that drops, and a crunch.
  hit: (at?: Place) => {
    const o = out('fx', 'hit', 0.3, at);
    if (!o) return;
    note(o, 420, now(), 0.2, 0.2, { type: 'triangle', to: 150, cutoff: 2000, attack: 0.003 });
    noise(o, now(), 0.28, 0.32, 3000, 250, 'lowpass', 0.8, 0.003);
  },
  // The guarda-chuva: a shimmer, two high notes.
  shield: () => {
    const o = out('fx', 'shield', 0.4);
    if (!o) return;
    [G6, 2093].forEach((f, i) => note(o, f, now() + i * 0.07, 0.3, 0.09, { detune: 10, attack: 0.01 }));
  },
  // Slipping on the pudim: a slide whistle going down, wobbling.
  slip: () => {
    const o = out('fx', 'slip', 0.5);
    if (!o || !ctx) return;
    const t = now();
    const wob = ctx.createOscillator();
    const depth = ctx.createGain();
    wob.frequency.value = 9;
    depth.gain.value = 40;
    const g = ctx.createGain();
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(1100, t);
    osc.frequency.exponentialRampToValueAtTime(330, t + 0.45);
    wob.connect(depth).connect(osc.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.13, t + 0.02);
    g.gain.setValueAtTime(0.13, t + 0.35);
    g.gain.linearRampToValueAtTime(0, t + 0.48);
    osc.connect(g).connect(o);
    for (const x of [osc, wob]) {
      x.start(t);
      x.stop(t + 0.5);
    }
    noise(o, t, 0.4, 0.08, 400, 2000, 'bandpass', 1, 0.05);
  },
  // A turbo: a rush of air and a tone rising, higher for the second level.
  turbo: (level: number) => {
    const o = out('fx', 'turbo', 0.4);
    if (!o) return;
    noise(o, now(), 0.4, 0.28, 800, 4000, 'bandpass', 0.8, 0.03);
    const f = level === 2 ? 440 : 330;
    note(o, f, now(), 0.3, 0.07, { type: 'triangle', to: f * 2, cutoff: 3000, attack: 0.02 });
  },
  // Karts bumping: a dull knock. Karts rubbing in a pack touch on every step of the simulation, 120
  // times a second, so a gentle touch makes no sound, and a knock waits 0.12 s after the last.
  bump: (s: number) => {
    if (s < 1 || now() - lastBump < 0.12) return;
    lastBump = now();
    const o = out('fx', 'bump', 0.14);
    if (!o) return;
    note(o, 130 + Math.random() * 30, now(), 0.13, Math.min(0.3, s * 0.03), { to: 65, attack: 0.003 });
    noise(o, now(), 0.06, Math.min(0.12, s * 0.012), 1200, 300, 'lowpass', 1, 0.002);
  },
  finish,
  // Faísca's bark: a short rough yelp that drops.
  bark: (at?: Place) => {
    const o = out('fx', 'bark', 0.2, at);
    if (!o || !ctx) return;
    const t = now();
    const osc = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(560 + Math.random() * 120, t);
    osc.frequency.exponentialRampToValueAtTime(240, t + 0.13);
    f.type = 'bandpass';
    f.frequency.value = 950;
    f.Q.value = 1.4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    osc.connect(f).connect(g).connect(o);
    osc.start(t);
    osc.stop(t + 0.2);
    noise(o, t, 0.07, 0.18, 1800, 500, 'bandpass', 1, 0.002);
  },
  // The dentist's drill: a thin whine, wobbling up.
  drill: (at?: Place) => {
    const o = out('fx', 'drill', 0.85, at);
    if (!o || !ctx) return;
    const t = now();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1900, t);
    osc.frequency.linearRampToValueAtTime(3100, t + 0.7);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035, t + 0.05);
    g.gain.setValueAtTime(0.035, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    osc.connect(g).connect(o);
    osc.start(t);
    osc.stop(t + 0.85);
  },
  // An alarm clock's bells, hammered fast between two of them, for a second and a half.
  alarm: (at?: Place) => {
    const o = out('fx', 'alarm', 1.6, at);
    if (!o) return;
    for (let k = 0; k < 30; k++) {
      const f = k % 2 ? 2350 : 2650;
      note(o, f, now() + k * 0.05, 0.09, 0.035, { type: 'square', cutoff: 6000, attack: 0.003 });
      note(o, f * 2.76, now() + k * 0.05, 0.05, 0.02, { attack: 0.002 });
    }
  },
  // The supermarket's announcement chime: ding-dong.
  chime: (at?: Place) => {
    const o = out('fx', 'chime', 1.1, at);
    if (!o) return;
    [880, 698.46].forEach((f, i) => bell(o, f, now() + i * 0.34, 0.75, 0.22));
  },
};

// ---- The deathmatch (braga-map's task 074) ----

// The streets' echo: a gunshot comes back off the buildings, a few slaps in the first fifth of a
// second and a tail that dies away over a second and a half, darker as it goes. One convolver every
// shot sends a share of itself to, made the first time it's needed.
let echo: GainNode | null = null;
function echoes(): GainNode | null {
  if (!ctx || !bus) return null;
  if (echo) return echo;
  const c = ctx;
  const n = Math.round(c.sampleRate * 1.8);
  const ir = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / c.sampleRate;
      // Darker as it goes: a low-pass whose cutoff falls with the time.
      const k = Math.max(0.04, 0.6 * Math.exp(-t / 0.5));
      lp += (Math.random() * 2 - 1 - lp) * k;
      d[i] = lp * Math.exp(-t / 0.42) * Math.min(1, t / 0.03) * 0.5;
    }
    // The slaps off the facades across the street and down it.
    for (const at of [0.045, 0.07, 0.11, 0.16, 0.23, 0.31]) {
      const i = Math.round((at + (Math.random() - 0.5) * 0.02 + ch * 0.006) * c.sampleRate);
      const g = 0.9 * Math.exp(-at / 0.25);
      for (let j = 0; j < 200 && i + j < n; j++) d[i + j] += (Math.random() * 2 - 1) * g * Math.exp(-j / 40);
    }
  }
  const conv = c.createConvolver();
  conv.buffer = ir;
  const send = c.createGain();
  send.gain.value = 0.55;
  send.connect(conv).connect(bus.fx);
  return (echo = send);
}

// A gunshot's report by the weapon's family, and how a suppressor muffles it: a crack, a burst of
// noise falling away and a thump. Synthesized, for until the recordings are in, or if one isn't.
const REPORT: Record<string, { crack: number; snap: number; body: number; len: number; thump: number; gain: number }> = {
  rifle: { crack: 3200, snap: 0.05, body: 2600, len: 0.22, thump: 95, gain: 0.55 },
  smg: { crack: 3800, snap: 0.035, body: 3000, len: 0.15, thump: 120, gain: 0.42 },
  heavy: { crack: 2900, snap: 0.05, body: 2300, len: 0.24, thump: 85, gain: 0.55 },
  shotgun: { crack: 1900, snap: 0.07, body: 1500, len: 0.4, thump: 70, gain: 0.7 },
  sniper: { crack: 2600, snap: 0.08, body: 2000, len: 0.5, thump: 60, gain: 0.8 },
  pistol: { crack: 3600, snap: 0.04, body: 3000, len: 0.16, thump: 120, gain: 0.45 },
  silenced: { crack: 2200, snap: 0.02, body: 1200, len: 0.09, thump: 140, gain: 0.22 },
};
// A gunshot is as loud as in your head within 40 m, and heard across the whole area and further.
const SHOT_REF = 40;
const SHOT_HEARD = 1500;
const reportOf = (w: WeaponId) => (!isGun(w) ? REPORT.pistol : GUNS[w].silenced ? REPORT.silenced : REPORT[GUNS[w].family]);

// ---- The fight's recordings: CC0, from Freesound (src/fight/ASSETS.md says from where) ----

const FIGHT = {
  'body-fall': new URL('./fight/sounds/body-fall.mp3', import.meta.url).href,
  'dry-fire': new URL('./fight/sounds/dry-fire.mp3', import.meta.url).href,
  'explosion-he': new URL('./fight/sounds/explosion-he.mp3', import.meta.url).href,
  'fire-loop': new URL('./fight/sounds/fire-loop.mp3', import.meta.url).href,
  'flashbang-bang': new URL('./fight/sounds/flashbang-bang.mp3', import.meta.url).href,
  'footstep-concrete-1': new URL('./fight/sounds/footstep-concrete-1.mp3', import.meta.url).href,
  'footstep-concrete-2': new URL('./fight/sounds/footstep-concrete-2.mp3', import.meta.url).href,
  'footstep-concrete-3': new URL('./fight/sounds/footstep-concrete-3.mp3', import.meta.url).href,
  'footstep-concrete-4': new URL('./fight/sounds/footstep-concrete-4.mp3', import.meta.url).href,
  'grenade-bounce': new URL('./fight/sounds/grenade-bounce.mp3', import.meta.url).href,
  'grenade-pin': new URL('./fight/sounds/grenade-pin.mp3', import.meta.url).href,
  'grenade-throw': new URL('./fight/sounds/grenade-throw.mp3', import.meta.url).href,
  'headshot-dink': new URL('./fight/sounds/headshot-dink.mp3', import.meta.url).href,
  'impact-concrete': new URL('./fight/sounds/impact-concrete.mp3', import.meta.url).href,
  'impact-flesh': new URL('./fight/sounds/impact-flesh.mp3', import.meta.url).href,
  'impact-metal': new URL('./fight/sounds/impact-metal.mp3', import.meta.url).href,
  'impact-wood': new URL('./fight/sounds/impact-wood.mp3', import.meta.url).href,
  'jump-land': new URL('./fight/sounds/jump-land.mp3', import.meta.url).href,
  'knife-hit-flesh': new URL('./fight/sounds/knife-hit-flesh.mp3', import.meta.url).href,
  'knife-hit-wall': new URL('./fight/sounds/knife-hit-wall.mp3', import.meta.url).href,
  'knife-swing': new URL('./fight/sounds/knife-swing.mp3', import.meta.url).href,
  'molotov-break': new URL('./fight/sounds/molotov-break.mp3', import.meta.url).href,
  'reload-bolt': new URL('./fight/sounds/reload-bolt.mp3', import.meta.url).href,
  'reload-mag-in': new URL('./fight/sounds/reload-mag-in.mp3', import.meta.url).href,
  'reload-mag-out': new URL('./fight/sounds/reload-mag-out.mp3', import.meta.url).href,
  'reload-pistol-slide': new URL('./fight/sounds/reload-pistol-slide.mp3', import.meta.url).href,
  'reload-pump': new URL('./fight/sounds/reload-pump.mp3', import.meta.url).href,
  'reload-shell-insert': new URL('./fight/sounds/reload-shell-insert.mp3', import.meta.url).href,
  'reload-sniper-bolt': new URL('./fight/sounds/reload-sniper-bolt.mp3', import.meta.url).href,
  'shot-awp': new URL('./fight/sounds/shot-awp.mp3', import.meta.url).href,
  'shot-deagle': new URL('./fight/sounds/shot-deagle.mp3', import.meta.url).href,
  'shot-distant': new URL('./fight/sounds/shot-distant.mp3', import.meta.url).href,
  'shot-lmg': new URL('./fight/sounds/shot-lmg.mp3', import.meta.url).href,
  'shot-pistol': new URL('./fight/sounds/shot-pistol.mp3', import.meta.url).href,
  'shot-pistol-suppressed': new URL('./fight/sounds/shot-pistol-suppressed.mp3', import.meta.url).href,
  'shot-rifle-ak': new URL('./fight/sounds/shot-rifle-ak.mp3', import.meta.url).href,
  'shot-rifle-m4': new URL('./fight/sounds/shot-rifle-m4.mp3', import.meta.url).href,
  'shot-rifle-suppressed': new URL('./fight/sounds/shot-rifle-suppressed.mp3', import.meta.url).href,
  'shot-shotgun': new URL('./fight/sounds/shot-shotgun.mp3', import.meta.url).href,
  'shot-smg': new URL('./fight/sounds/shot-smg.mp3', import.meta.url).href,
  'shot-ssg': new URL('./fight/sounds/shot-ssg.mp3', import.meta.url).href,
  'smoke-hiss': new URL('./fight/sounds/smoke-hiss.mp3', import.meta.url).href,
  'ui-buy': new URL('./fight/sounds/ui-buy.mp3', import.meta.url).href,
  'weapon-draw': new URL('./fight/sounds/weapon-draw.mp3', import.meta.url).href,
};
type FightSound = keyof typeof FIGHT;
// Each as it's decoded; until then (or if it fails), what it's for is synthesized.
const fightRec: Partial<Record<FightSound, AudioBuffer>> = {};
let fightAsked = false;

// Fetched the first time the fight makes a sound, long after the city's, each on its own, so a
// round never waits for them and one that fails costs only itself.
function fightSounds(): void {
  if (fightAsked || !ctx) return;
  fightAsked = true;
  const c = ctx;
  for (const [k, url] of Object.entries(FIGHT) as [FightSound, string][]) {
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((b) => c.decodeAudioData(b))
      .then((b) => (fightRec[k] = b))
      .catch((e: unknown) => console.warn(`The fight's sound ${k} didn't load:`, e));
  }
}

// The fight's way into the effects' bus: through a low-pass and a level a flashbang closes down,
// leaving its ringing in your ears over everything else.
let fightMix: { in: GainNode; lp: BiquadFilterNode } | null = null;
function fightBus(): GainNode | null {
  if (!ctx || !bus) return null;
  if (fightMix) return fightMix.in;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 20000;
  lp.Q.value = 0.5;
  const g = ctx.createGain();
  g.connect(lp).connect(bus.fx);
  fightMix = { in: g, lp };
  return g;
}

// Where a fight's sound plays into, as out() does it for the others: through a panner at its place
// if it has one, or null when it isn't to be played. It counts as playing for `busy` seconds, less
// than it lasts when the next shot cuts it short.
function fightOut(what: string, dur: number, at?: Place, ref = REF, heard = HEARD, busy = dur): AudioNode | null {
  const into = fightBus();
  if (!ctx || !into || playing >= MAX_PLAYING) return null;
  let node: AudioNode = into;
  if (at) {
    if (Math.hypot(at.x - ear.x, at.y - ear.y, at.z - ear.z) > heard) return null;
    const p = panner(ctx);
    p.refDistance = ref;
    place(p, at, ctx.currentTime, true);
    p.connect(node);
    node = p;
    setTimeout(() => p.disconnect(), (dur + 0.5) * 1000);
  }
  playing++;
  setTimeout(() => playing--, busy * 1000);
  played[what] = (played[what] ?? 0) + 1;
  return node;
}

interface RecOpts {
  // When it starts, in the context's time; now if not given.
  t?: number;
  rate?: number;
  gain?: number;
  // Where in the recording to start, and how much of it to play (to its end if not given), in its
  // own seconds; cut short, it fades out over the last `fade`.
  from?: number;
  len?: number;
  fade?: number;
  // Fading in over this long rather than starting at full level.
  attack?: number;
  // A low-pass's cutoff, for something heard through something or far away.
  cutoff?: number;
}
// A recording playing, to be cut short.
interface Rec {
  src: AudioBufferSourceNode;
  g: GainNode;
  end: number;
}

// Plays a recording into o; null if it isn't decoded yet.
function rec(o: AudioNode, k: FightSound, opt: RecOpts = {}): Rec | null {
  const b = fightRec[k];
  if (!ctx || !b) return null;
  const c = ctx;
  const t = opt.t ?? c.currentTime;
  const rate = opt.rate ?? 1;
  const from = opt.from ?? 0;
  const len = Math.min(opt.len ?? b.duration, b.duration - from) / rate;
  const gain = opt.gain ?? 1;
  const src = c.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = rate;
  const g = c.createGain();
  if (opt.attack) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + opt.attack);
  } else g.gain.setValueAtTime(gain, t);
  if (opt.len !== undefined) {
    const fade = Math.min(len / 2, opt.fade ?? 0.05);
    g.gain.setValueAtTime(gain, t + len - fade);
    g.gain.linearRampToValueAtTime(0, t + len);
  }
  if (opt.cutoff && opt.cutoff < 18000) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = opt.cutoff;
    src.connect(lp).connect(g);
  } else src.connect(g);
  g.connect(o);
  src.start(t, from);
  src.stop(t + len + 0.01);
  return { src, g, end: t + len };
}

// How long a recording lasts at a rate, or `or` if it isn't in yet.
const lengthOf = (k: FightSound, rate = 1, or = 0.3) => (fightRec[k] ? fightRec[k].duration / rate : or);
// A little either way, so no two of a sound are quite alike.
const vary = (x: number, by: number) => x * (1 + (Math.random() * 2 - 1) * by);
const fightClamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const distanceTo = (at?: Place) => (at ? Math.hypot(at.x - ear.x, at.y - ear.y, at.z - ear.z) : 0);
// A low-pass into o, for a sound duller the further off it is; a node of its own even when it
// isn't, for the sound's share of the echo to be taken from.
function dulled(o: AudioNode, cutoff: number): AudioNode {
  if (!ctx) return o;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = Math.min(20000, cutoff);
  f.connect(o);
  return f;
}
// A share of a sound sent to the streets' echo, coming back later the further off it was fired.
function echoed(from: AudioNode, share: number, far: number): void {
  const send = echoes();
  if (!send || !ctx || share <= 0) return;
  const g = ctx.createGain();
  g.gain.value = share;
  const late = ctx.createDelay(0.5);
  late.delayTime.value = Math.min(0.3, far / 500);
  from.connect(g).connect(late).connect(send);
  setTimeout(() => from.disconnect(g), 3000);
}

// Each gun's recording, the pitch it's played at (guns that share one a little apart) and how loud,
// evened out between the recordings.
const SHOT: Partial<Record<WeaponId, { k: FightSound; rate: number; gain: number }>> = {
  glock: { k: 'shot-pistol', rate: 1.08, gain: 0.7 },
  usp: { k: 'shot-pistol-suppressed', rate: 1, gain: 0.55 },
  p250: { k: 'shot-pistol', rate: 0.96, gain: 0.75 },
  deagle: { k: 'shot-deagle', rate: 1, gain: 1 },
  mac10: { k: 'shot-smg', rate: 1.06, gain: 0.7 },
  mp9: { k: 'shot-smg', rate: 1.12, gain: 0.65 },
  ump: { k: 'shot-smg', rate: 0.9, gain: 0.75 },
  p90: { k: 'shot-smg', rate: 1, gain: 0.7 },
  galil: { k: 'shot-rifle-ak', rate: 1.06, gain: 0.8 },
  famas: { k: 'shot-rifle-m4', rate: 1.07, gain: 0.85 },
  ak47: { k: 'shot-rifle-ak', rate: 1, gain: 0.85 },
  m4a4: { k: 'shot-rifle-m4', rate: 1, gain: 0.9 },
  m4a1s: { k: 'shot-rifle-suppressed', rate: 0.92, gain: 0.6 },
  sg553: { k: 'shot-rifle-m4', rate: 0.93, gain: 0.9 },
  aug: { k: 'shot-rifle-m4', rate: 0.97, gain: 0.85 },
  ssg08: { k: 'shot-ssg', rate: 1, gain: 0.85 },
  awp: { k: 'shot-awp', rate: 1, gain: 1 },
  nova: { k: 'shot-shotgun', rate: 1, gain: 0.95 },
  xm1014: { k: 'shot-shotgun', rate: 1.08, gain: 0.85 },
  negev: { k: 'shot-lmg', rate: 1, gain: 0.75 },
};
// The working of the action after a shot: the recording, how long after the shot it starts, and its
// rate, fitted inside the time before the next shot.
const CYCLE: Partial<Record<WeaponId, { k: FightSound; after: number; rate: number }>> = {
  awp: { k: 'reload-sniper-bolt', after: 0.28, rate: 1.15 },
  ssg08: { k: 'reload-sniper-bolt', after: 0.22, rate: 1.3 },
  nova: { k: 'reload-pump', after: 0.3, rate: 1.1 },
};
// Shots still ringing, so a gun's next cuts its last short: an automatic at ten a second would
// otherwise pile a dozen tails up. Others' shots from about the same place are the same gun's.
const ringing: { w: WeaponId; at: Place | null; rec: Rec }[] = [];
const MAX_SHOTS = 10;
function cutShots(w: WeaponId, at: Place | null, t: number): void {
  const same = (x: Place | null) => (!x || !at ? x === at : Math.hypot(x.x - at.x, x.y - at.y, x.z - at.z) < 4);
  for (let i = ringing.length - 1; i >= 0; i--) {
    const r = ringing[i];
    const over = r.rec.end <= t;
    if (!over && !(r.w === w && same(r.at))) continue;
    if (!over) cut(r.rec, t);
    ringing.splice(i, 1);
  }
  // Too many guns at once, the oldest give way.
  while (ringing.length >= MAX_SHOTS) cut(ringing.shift()!.rec, t);
}
// Stops a recording quickly but without a click.
function cut(r: Rec, t: number): void {
  r.g.gain.cancelScheduledValues(t);
  r.g.gain.setTargetAtTime(0, t, 0.025);
  try {
    r.src.stop(t + 0.15);
  } catch {
    // Already stopped.
  }
}

// Your own reload's and bolt's sounds still to come, stopped when you take something else out.
let pending: Rec[] = [];
function later(r: Rec | null): void {
  if (!r) return;
  pending = pending.filter((x) => x.end > now());
  pending.push(r);
}
function stopPending(): void {
  const t = now();
  for (const r of pending) if (r.end > t) cut(r, t);
  pending = [];
}

// The fires burning, each a crackle near it.
let fireLoop: { src: AudioBufferSourceNode; gain: GainNode; pan: PannerNode; real: boolean } | null = null;
let lastStep = -1;
let impacts: number[] = [];

// The synthesized shot, for until its recording is in.
function synthShot(w: WeaponId, at?: Place): void {
  const r = reportOf(w);
  const quiet = isGun(w) && GUNS[w].silenced;
  const o = fightOut('shot', r.len + 0.1, at, quiet ? 12 : SHOT_REF, quiet ? 120 : SHOT_HEARD);
  if (!o || !ctx) return;
  const t = now();
  const far = distanceTo(at);
  const dull = dulled(o, 16000 / (1 + far / 60));
  if (!quiet) echoed(dull, Math.min(1, 0.4 + far / 200), far);
  noise(dull, t, r.snap, r.gain * 0.9, r.crack * 1.6, r.crack, 'bandpass', 0.9, 0.001);
  noise(dull, t, r.len, r.gain, r.body, 180, 'lowpass', 0.7, 0.002);
  note(dull, r.thump, t, r.len * 0.8, r.gain * 0.7, { to: r.thump * 0.45, attack: 0.002 });
  if (isGun(w) && (GUNS[w].family === 'sniper' || w === 'nova')) clack(o, t + 0.45, GUNS[w].family === 'sniper' ? [1700, 2400] : [900, 1300]);
}

// A reload's stages by the gun's family: each a recording, where its main sound is in it (s), and
// when in the reload that's heard (a share of its time).
const STAGES: Record<string, [FightSound, number, number][]> = {
  pistol: [
    ['reload-mag-out', 0.21, 0.15],
    ['reload-mag-in', 0.31, 0.55],
    ['reload-pistol-slide', 0.25, 0.86],
  ],
  rifle: [
    ['reload-mag-out', 0.21, 0.18],
    ['reload-mag-in', 0.31, 0.6],
    ['reload-bolt', 0.6, 0.9],
  ],
  heavy: [
    ['reload-bolt', 0.2, 0.08],
    ['reload-mag-out', 0.21, 0.3],
    ['reload-mag-in', 0.31, 0.65],
    ['reload-bolt', 0.6, 0.92],
  ],
  sniper: [
    ['reload-mag-out', 0.21, 0.15],
    ['reload-mag-in', 0.31, 0.45],
    ['reload-sniper-bolt', 0.55, 0.8],
  ],
};

export const fightSfx = {
  // A shot: its gun's recording from where it's fired (yours in your head), a little different each
  // time; further off duller, its echo later, and far away the distant crack over it. A sniper's
  // rifle's bolt and a pump gun's slide are worked after it.
  shot: (w: WeaponId, at?: Place) => {
    fightSounds();
    const s = SHOT[w];
    if (!s || !isGun(w) || !fightRec[s.k] || !ctx) return synthShot(w, at);
    const g = GUNS[w];
    const quiet = g.silenced;
    const rate = vary(s.rate, 0.025);
    const len = lengthOf(s.k, rate);
    const o = fightOut('shot', len, at, quiet ? 12 : SHOT_REF, quiet ? 150 : SHOT_HEARD, Math.min(len, g.every / 1000 + 0.1));
    if (!o) return;
    const t = now();
    const far = distanceTo(at);
    cutShots(w, at ?? null, t);
    const dull = dulled(o, at ? 20000 / (1 + far / 45) : 20000);
    // Yours with a little of the street's echo, others' more the further off they are.
    echoed(dull, (quiet ? 0.4 : 1) * (at ? Math.min(0.9, 0.3 + far / 150) : 0.25), far);
    // Past 50 m the distant shot takes over, fully by 200 m.
    const away = quiet ? 0 : fightClamp((far - 50) / 150, 0, 1);
    const gain = vary(s.gain, 0.1);
    const near = rec(dull, s.k, { t, rate, gain: gain * (1 - 0.7 * away) });
    if (near) ringing.push({ w, at: at ?? null, rec: near });
    if (away > 0 && fightRec['shot-distant']) {
      const d = rec(dulled(o, 9000 / (1 + far / 300)), 'shot-distant', { t, rate: vary(g.family === 'pistol' || g.family === 'smg' ? 1.1 : 0.95, 0.03), gain: 0.9 * away });
      if (d) ringing.push({ w, at: at ?? null, rec: d });
    }
    const cy = CYCLE[w];
    if (cy && fightRec[cy.k]) {
      const by = fightOut('bolt', cy.after + lengthOf(cy.k, cy.rate), at, 6, 50);
      const r = by && rec(by, cy.k, { t: t + cy.after, rate: cy.rate, gain: at ? 0.6 : 0.45 });
      if (!at) later(r);
    }
  },
  // An empty magazine: a dry click.
  dry: () => {
    fightSounds();
    const o = fightOut('dry', lengthOf('dry-fire', 1, 0.05));
    if (o && !rec(o, 'dry-fire', { gain: 0.45 })) noise(o, now(), 0.03, 0.12, 4000, 2500, 'bandpass', 3, 0.001);
  },
  // A weapon taken out: drawn from its holster, a knife with a ring of its blade; whatever was
  // still to come of the last one's reload is stopped.
  draw: (w: WeaponId) => {
    fightSounds();
    stopPending();
    const gun = isGun(w);
    const rate = w === 'knife' ? 1.35 : !gun ? 1.25 : GUNS[w].family === 'pistol' ? 1.1 : 0.95;
    const o = fightOut('draw', Math.max(0.3, lengthOf('weapon-draw', rate)));
    if (!o) return;
    const drawn = rec(o, 'weapon-draw', { rate: vary(rate, 0.03), gain: w === 'knife' ? 0.18 : gun ? 0.35 : 0.22 });
    if (!drawn) noise(o, now(), 0.12, 0.05, 1800, 600, 'bandpass', 0.8, 0.01);
    if (w === 'knife') noise(o, now() + 0.05, 0.18, 0.06, 7000, 3000, 'highpass', 1, 0.02);
    else if (gun && !drawn) clack(o, now() + 0.12, [2200]);
  },
  // A reload over its ms: the magazine out, in, and the bolt or slide, by the gun's family; a
  // shotgun's shells go in one at a time, each a reload of ms 0.
  reload: (w: WeaponId, ms: number, at?: Place) => {
    fightSounds();
    const fam = isGun(w) ? GUNS[w].family : 'pistol';
    const t = now();
    if (!ms) {
      const o = fightOut('reload', 0.25, at, 6, 40);
      if (o && !rec(o, 'reload-shell-insert', { rate: vary(1, 0.04), gain: 0.6 })) clack(o, t, [1300, 2000]);
      return;
    }
    if (fam === 'shotgun') return;
    const o = fightOut('reload', ms / 1000 + 0.5, at, 6, 40);
    if (!o) return;
    const s = ms / 1000;
    for (const [k, hit, f] of STAGES[fam] ?? STAGES.rifle) {
      // The sniper's bolt is a long one, sped up to finish before the reload does.
      const rate = k === 'reload-sniper-bolt' ? fightClamp((lengthOf(k) - hit) / (s * (1 - f)), 1, 1.4) : vary(1, 0.03);
      const when = t + Math.max(0, s * f - hit / rate);
      const r = rec(o, k, { t: when, rate, gain: at ? 0.7 : 0.5 });
      if (!at) later(r);
      if (!r) clack(o, t + s * f, [k === 'reload-mag-out' ? 1800 : k === 'reload-mag-in' ? 1300 : 2600]);
    }
  },
  // The scope up or down.
  zoom: (up: boolean) => {
    const o = fightOut('zoom', 0.08);
    if (o) noise(o, now(), 0.04, 0.05, up ? 5000 : 3500, 2500, 'bandpass', 4, 0.001);
  },
  // Coming down hard on your feet.
  land: (k: number) => {
    fightSounds();
    const o = fightOut('land', lengthOf('jump-land', 1, 0.2));
    if (!o || rec(o, 'jump-land', { rate: vary(1, 0.04), gain: 0.2 + 0.4 * k })) return;
    noise(o, now(), 0.1, 0.12 * k, 900, 150, 'lowpass', 1, 0.002);
    note(o, 60, now(), 0.12, 0.2 * k, { to: 35, attack: 0.002 });
  },
  // The knife: its swish through the air, and into someone; against a wall (called besides the
  // swish), the blade's knock alone.
  knife: (what: 'air' | 'hit' | 'wall', at?: Place) => {
    fightSounds();
    const o = fightOut('knife', 0.6, at, 6, 40);
    if (!o) return;
    const t = now();
    if (what === 'wall') {
      if (!rec(o, 'knife-hit-wall', { rate: vary(1, 0.05), gain: 0.55 })) clack(o, t, [3200, 4100]);
      return;
    }
    if (!rec(o, 'knife-swing', { rate: vary(1, 0.06), gain: 0.45 })) noise(o, t, 0.16, 0.09, 6000, 1800, 'bandpass', 1.4, 0.03);
    if (what === 'hit' && !rec(o, 'knife-hit-flesh', { t: t + 0.05, rate: vary(1, 0.05), gain: 0.65 })) noise(o, t + 0.06, 0.12, 0.22, 700, 200, 'lowpass', 1, 0.002);
  },
  // A grenade: its pin pulled, thrown, bouncing (as hard as k), going off: the HE grenade's blast
  // and the flash's bang, echoing down the streets; the smoke's hiss; the molotov's glass breaking
  // and its fire catching.
  nade: (what: 'pin' | 'throw' | 'bounce' | 'he' | 'flash' | 'smoke' | 'fire', at?: Place, k = 1) => {
    fightSounds();
    const big = what === 'he' || what === 'flash';
    const dur = what === 'smoke' ? 3.9 : what === 'he' ? 2.1 : what === 'fire' ? 1.7 : big ? 1.1 : 0.3;
    const o = fightOut(`nade-${what}`, dur, at, big ? SHOT_REF : 10, big ? SHOT_HEARD : 80);
    if (!o) return;
    const t = now();
    if (what === 'pin') {
      if (!rec(o, 'grenade-pin', { gain: 0.45 })) clack(o, t, [2600, 3400]);
      return;
    }
    if (what === 'throw') {
      if (!rec(o, 'grenade-throw', { rate: vary(1, 0.05), gain: 0.4 })) noise(o, t, 0.2, 0.06, 2500, 800, 'bandpass', 0.8, 0.03);
      return;
    }
    if (what === 'bounce') {
      if (!rec(o, 'grenade-bounce', { rate: vary(1.02, 0.12), gain: 0.1 + 0.55 * k })) clack(o, t, [1500 + 600 * k]);
      return;
    }
    const far = distanceTo(at);
    if (big) {
      const dull = dulled(o, 20000 / (1 + far / 60));
      echoed(dull, Math.min(1, 0.5 + far / 150), far);
      if (what === 'he') {
        if (!rec(dull, 'explosion-he', { rate: vary(1, 0.03), gain: 0.85 })) noise(dull, t, 1.2, 0.9, 1200, 60, 'lowpass', 0.7, 0.002);
        // The weight under it, which the recording's small microphone lost.
        note(dull, 55, t, 0.8, 0.45, { to: 28, attack: 0.002 });
      } else if (!rec(dull, 'flashbang-bang', { rate: vary(1, 0.03), gain: 0.85 })) noise(dull, t, 0.3, 0.8, 5000, 1200, 'bandpass', 0.6, 0.001);
      return;
    }
    if (what === 'smoke') {
      if (!rec(o, 'smoke-hiss', { attack: 0.08, gain: 0.4, len: 3.75, fade: 1.2 })) noise(o, t, 2.8, 0.12, 4000, 2000, 'highpass', 0.5, 0.2);
      return;
    }
    // The molotov: glass, and the fire catching with a whoosh before it settles to its crackle.
    if (!rec(o, 'molotov-break', { rate: vary(1, 0.04), gain: 0.65 })) noise(o, t, 0.15, 0.3, 4500, 3000, 'bandpass', 1.5, 0.001);
    rec(o, 'fire-loop', { t: t + 0.08, from: 0.5, attack: 0.3, gain: 0.5, len: 1.5, fade: 0.8 });
    noise(o, t + 0.05, 0.8, 0.25, 900, 300, 'lowpass', 0.6, 0.05);
  },
  // The fires burning now, a crackle from the nearest; none, quiet.
  burning: (fires: Place[]) => {
    fightSounds();
    const into = fightBus();
    if (!ctx || !into) return;
    const c = ctx;
    if (!fires.length) {
      if (fireLoop) {
        const f = fireLoop;
        f.gain.gain.setTargetAtTime(0, now(), 0.2);
        setTimeout(() => {
          f.src.stop();
          f.pan.disconnect();
        }, 800);
        fireLoop = null;
      }
      return;
    }
    let near = fires[0];
    for (const f of fires) if (distanceTo(f) < distanceTo(near)) near = f;
    const real = fightRec['fire-loop'];
    // The synthesized crackle gives way to the recording once it's in.
    if (fireLoop && !fireLoop.real && real) {
      fireLoop.src.stop();
      fireLoop.pan.disconnect();
      fireLoop = null;
    }
    if (!fireLoop) {
      const src = c.createBufferSource();
      if (real) {
        src.buffer = real;
        // The loop is seamless in what it holds; MP3 pads its ends with a few milliseconds.
        src.loopStart = 0.025;
        src.loopEnd = real.duration - 0.025;
      } else {
        const len = c.sampleRate * 2;
        const buf = c.createBuffer(1, len, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.003 ? 1 : 0.25);
        src.buffer = buf;
      }
      src.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = real ? 12000 : 2200;
      const gain = c.createGain();
      gain.gain.value = 0;
      const pan = panner(c);
      pan.refDistance = 4;
      place(pan, near, c.currentTime, true);
      src.connect(lp).connect(gain).connect(pan).connect(into);
      src.start(c.currentTime, real ? 0.025 + Math.random() * (real.duration - 0.1) : 0);
      fireLoop = { src, gain, pan, real: !!real };
      played.fire = (played.fire ?? 0) + 1;
    }
    place(fireLoop.pan, near, c.currentTime, false);
    fireLoop.gain.gain.setTargetAtTime(fireLoop.real ? 0.55 : 0.3, now(), 0.1);
  },
  // A flash's ringing in your ears: a high whine over everything else, which goes dull and quiet,
  // both coming back as it fades.
  ring: (ms: number) => {
    fightSounds();
    const s = Math.max(0.3, ms / 1000);
    const o = out('fx', 'ring', s);
    if (!o || !ctx || !bus) return;
    const t = now();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.02);
    g.gain.setValueAtTime(0.09, t + s * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0005, t + s);
    g.connect(o);
    for (const f of [3520, 3527]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      osc.connect(g);
      osc.start(t);
      osc.stop(t + s + 0.05);
    }
    fightBus();
    if (!fightMix) return;
    const hold = t + s * 0.3;
    const lp = fightMix.lp.frequency;
    lp.cancelScheduledValues(t);
    lp.setTargetAtTime(400, t, 0.015);
    lp.setValueAtTime(400, hold);
    lp.exponentialRampToValueAtTime(20000, t + s);
    const lv = fightMix.in.gain;
    lv.cancelScheduledValues(t);
    lv.setTargetAtTime(0.3, t, 0.015);
    lv.setValueAtTime(0.3, hold);
    lv.linearRampToValueAtTime(1, t + s);
    const city = bus.ambience.gain;
    city.cancelScheduledValues(t);
    city.setTargetAtTime(LEVEL.ambience * 0.3, t, 0.015);
    city.setValueAtTime(LEVEL.ambience * 0.3, hold);
    city.linearRampToValueAtTime(LEVEL.ambience, t + s);
  },
  // A bullet striking something, by what it is: stone, metal, wood; plastic a lighter knock, a hedge
  // and sand duller. A shotgun's pellets or a spray land many at once, so a few at most are heard.
  impact: (at: Place & { what?: string | null }) => {
    fightSounds();
    const t = now();
    impacts = impacts.filter((x) => t - x < 0.15);
    if (impacts.length >= 5) return;
    const o = fightOut('impact', 0.45, at, 8, 150);
    if (!o) return;
    impacts.push(t);
    const what = at.what ?? 'wall';
    const metal = what === 'metal' || what === 'car' || what === 'kart';
    const soft = what === 'hedge' || what === 'tree' || what === 'wood' || what === 'plastic';
    const k: FightSound = metal ? 'impact-metal' : soft ? 'impact-wood' : 'impact-concrete';
    const opt: RecOpts = { rate: vary(what === 'plastic' ? 1.25 : what === 'sand' ? 0.75 : 1, 0.07), gain: metal ? 0.5 : 0.45 };
    if (what === 'hedge' || what === 'sand') opt.cutoff = 1500;
    if (rec(o, k, opt)) return;
    if (metal) return clack(o, t, [2800, 3900]);
    noise(o, t, 0.08, 0.16, 2500, 600, 'bandpass', 1.5, 0.002);
  },
  // Hit: a thud in your head; in the head, the helmet's ring too.
  hurt: (head = false) => {
    fightSounds();
    const o = fightOut('hurt', 0.3);
    if (!o) return;
    const t = now();
    note(o, 70, t, 0.22, 0.3, { to: 40, attack: 0.003 });
    if (!rec(o, 'impact-flesh', { rate: vary(0.95, 0.05), gain: 0.55 })) noise(o, t, 0.15, 0.2, 900, 200, 'lowpass', 1, 0.002);
    if (head && !rec(o, 'headshot-dink', { rate: vary(0.85, 0.03), gain: 0.45 })) note(o, 2900, t, 0.25, 0.06, { type: 'triangle', attack: 0.001 });
  },
  // Your shot hit someone: a soft smack; in the head, the dink; a kill, a ding.
  marker: (head: boolean, kill = false) => {
    fightSounds();
    const o = fightOut('marker', 0.3);
    if (!o) return;
    const hit = head ? rec(o, 'headshot-dink', { rate: vary(1, 0.02), gain: 0.5 }) : rec(o, 'impact-flesh', { rate: vary(1.15, 0.04), gain: 0.3 });
    if (!hit) note(o, head ? 2600 : 1900, now(), 0.06, 0.12, { type: 'triangle', cutoff: 6000, attack: 0.001 });
    if (kill) bell(o, C6, now() + 0.05, 0.2, 0.1);
  },
  // The competitive mode's bomb (game/comp.ts): its beep from where it ticks, louder the nearer the
  // end; the keypad's taps while it's planted or defused; and its blast, from far off too.
  bomb: (at: Place, urgent: number) => {
    fightSounds();
    const o = fightOut('bomb', 0.2, at, 8, 90);
    if (o) note(o, 2900, now(), 0.09, 0.1 + 0.08 * urgent, { type: 'square', cutoff: 7000, attack: 0.001 });
  },
  keypad: (at?: Place) => {
    fightSounds();
    const o = fightOut('keypad', 0.15, at, 4, 30);
    if (o) note(o, 1500 + Math.random() * 900, now(), 0.05, 0.06, { type: 'square', cutoff: 5000, attack: 0.001 });
  },
  blast: (at: Place) => {
    fightSounds();
    const o = fightOut('blast', 3, at, 60, 2000);
    if (!o) return;
    const t = now();
    if (!rec(o, 'explosion-he', { t, rate: 0.72, gain: 1 })) noise(o, t, 1.8, 0.6, 1200, 60, 'lowpass', 0.7, 0.002);
    noise(o, t + 0.05, 2.4, 0.35, 400, 40, 'lowpass', 0.6, 0.01);
  },
  // You put someone down: two notes going up, and their fall under them.
  down: () => {
    fightSounds();
    const o = fightOut('down', 0.8);
    if (!o) return;
    bell(o, E5, now(), 0.3, 0.14);
    bell(o, C6, now() + 0.08, 0.36, 0.14);
    rec(o, 'body-fall', { t: now() + 0.1, gain: 0.22, cutoff: 2500 });
  },
  // A footstep on the paving, from wherever it is, one of four takes and never the same twice
  // running; running, harder. Yours quieter, in your head.
  step: (run: boolean, at?: Place) => {
    fightSounds();
    const o = fightOut('step', 0.45, at, 6, 60, 0.15);
    if (!o) return;
    let n = Math.floor(Math.random() * 3);
    if (n >= lastStep) n++;
    lastStep = n;
    const k = `footstep-concrete-${n + 1}` as FightSound;
    const g = (run ? 0.5 : 0.3) * (at ? 1 : 0.55);
    if (rec(o, k, { rate: vary(1, 0.05), gain: vary(g, 0.1) })) return;
    const sg = (run ? 0.16 : 0.09) * (at ? 1 : 0.6);
    noise(o, now(), 0.07, sg, run ? 1400 : 1000, 250, 'lowpass', 1.2, 0.003);
    noise(o, now() + 0.015, 0.05, sg * 0.5, 3500, 1800, 'bandpass', 2, 0.002);
  },
  // A buy in the menu.
  buy: () => {
    fightSounds();
    const o = fightOut('buy', 0.2);
    if (o && !rec(o, 'ui-buy', { gain: 0.4 })) clack(o, now(), [1800, 2600]);
  },
  // The round over: anything still going quiet, and the ears clear.
  calm: () => {
    fightSfx.burning([]);
    stopPending();
    if (!ctx || !bus || !fightMix) return;
    const t = now();
    for (const [p, v] of [
      [fightMix.lp.frequency, 20000],
      [fightMix.in.gain, 1],
      [bus.ambience.gain, LEVEL.ambience],
    ] as const) {
      p.cancelScheduledValues(t);
      p.setTargetAtTime(v, t, 0.05);
    }
  },
};

// Metal on metal: a click or two, at these pitches.
function clack(o: AudioNode, t: number, pitches: number[]): void {
  pitches.forEach((k, i) => {
    noise(o, t + i * 0.06, 0.04, 0.14, k, k * 0.6, 'bandpass', 4, 0.001);
    note(o, k / 4, t + i * 0.06, 0.03, 0.04, { type: 'triangle', attack: 0.001 });
  });
}

// ---- Listening to it: what the speakers get, measured and recorded, to judge the sound by ----

// The loudest sample since the race began, on each side, and how many went over full scale and
// clipped, from an analyser on each channel (one on both would hear their average). Each read takes
// only the samples played since the last, so a slow frame misses none, up to the analyser's 0.68 s.
let metering = false;
let meter: { an: AnalyserNode[]; buf: Float32Array<ArrayBuffer>; last: number; peak: number[]; clipped: number } | null = null;

function newMeter(c: AudioContext, from: AudioNode): NonNullable<typeof meter> {
  const split = c.createChannelSplitter(2);
  from.connect(split);
  const an = [0, 1].map((k) => {
    const a = c.createAnalyser();
    a.fftSize = 32768;
    split.connect(a, k);
    return a;
  });
  return { an, buf: new Float32Array(32768), last: c.currentTime, peak: [0, 0], clipped: 0 };
}

export function measureAudio(): void {
  metering = true;
  if (ctx && master && !meter) meter = newMeter(ctx, master);
}

export function resetMeter(): void {
  for (const k in played) delete played[k];
  for (const k in cityHeard) delete cityHeard[k as keyof typeof cityHeard];
  if (!ctx || !meter) return;
  meter.last = ctx.currentTime;
  meter.peak = [0, 0];
  meter.clipped = 0;
}

// The peak in dBFS (0 is full scale), louder side and each side, and the samples clipped, both
// channels counted.
export function readMeter(): { peakDb: number; leftDb: number; rightDb: number; clipped: number } | null {
  if (!ctx || !meter) return null;
  const m = meter;
  const fresh = Math.min(m.buf.length, Math.round((ctx.currentTime - m.last) * ctx.sampleRate));
  m.last = ctx.currentTime;
  m.an.forEach((a, k) => {
    a.getFloatTimeDomainData(m.buf);
    for (let i = m.buf.length - fresh; i < m.buf.length; i++) {
      const v = Math.abs(m.buf[i]);
      if (v > m.peak[k]) m.peak[k] = v;
      if (v > 1) m.clipped++;
    }
  });
  const db = (v: number) => (v > 0 ? +(20 * Math.log10(v)).toFixed(2) : -Infinity);
  return { peakDb: db(Math.max(...m.peak)), leftDb: db(m.peak[0]), rightDb: db(m.peak[1]), clipped: m.clipped };
}

// Records the next few seconds of what the game plays, then offers them as a file to save. 'on'
// while it records, 'saved' once the file is offered.
let recording: 'on' | 'saved' | null = null;
export const recordState = () => recording;

export function recordAudio(seconds: number): void {
  if (!ctx || !master || recording === 'on') return;
  const dest = ctx.createMediaStreamDestination();
  master.connect(dest);
  const type = ['audio/webm;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const rec = new MediaRecorder(dest.stream, { mimeType: type, audioBitsPerSecond: 160_000 });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => parts.push(e.data);
  rec.onstop = () => {
    master?.disconnect(dest);
    const blob = new Blob(parts, { type: rec.mimeType });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `party-kart-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.${rec.mimeType.includes('mp4') ? 'm4a' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    recording = 'saved';
  };
  rec.start();
  recording = 'on';
  setTimeout(() => rec.stop(), seconds * 1000);
}
