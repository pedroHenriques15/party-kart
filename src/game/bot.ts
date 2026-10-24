// The bots: the autopilot at the wheel, a little careful or a little bold, and a feel for when
// to use what they've got.
import { autopilot } from '../car/autopilot.ts';
import { speedAfter, speedOf } from '../car/car.ts';
import { jumpAt, RUN_UP } from '../race.ts';
import { rampSpeed, type Ramp, type Track } from '../track/track.ts';
import { KART } from '../world/ground.ts';
import type { Arena, CarInfo } from './arena.ts';
import { loopDelta } from './items.ts';
import type { Controls, Racer } from './racer.ts';

export interface Brain {
  caution: number; // 1 drives flat out; more brakes earlier
  held: number; // s holding the current item
  patience: number; // s it waits before using a speed item
  home: number; // the line across the road it likes, -1 (left) to 1 (right)
  line: number; // the line it's on now, moved out to pass
  stuck: number; // s it has been all but still, racing
}

export const newBrain = (rand: () => number = Math.random): Brain => {
  const home = (rand() * 2 - 1) * 0.5;
  return { caution: 1.05 + rand() * 0.22, held: 0, patience: 0.5 + rand() * 2, home, line: home, stuck: 0 };
};

// How far before a jump's run-up a bot starts watching for a kart stopped on it (m), how far under the
// ramp's speed at its foot a kart can't fly the jump (m/s), how far past the lip it keeps the line it
// took the ramp on (the autopilot steers onto the ramp to 6 m past it), and how long it takes to cross
// the road in front of a kart (s).
const LOOK = 70;
const SLOWER = 6;
const HOLD = 10;
const CROSS = 1;

// The ramp a bot is on the run-up of, from LOOK m before it to HOLD m past its lip, and how far it is
// to the ramp's foot (negative past it).
function runUp(track: Track, i: number): { ramp: Ramp; foot: number } | null {
  const N = track.samples.length;
  const ramp = track.ramps.find((r) => (i - (r.lip - RUN_UP - LOOK) + 2 * N) % N <= RUN_UP + LOOK + HOLD);
  return ramp ? { ramp, foot: ramp.foot - ramp.lip + ((ramp.lip - i + N + HOLD) % N) - HOLD } : null;
}

// How far right of a ramp's axis a bot on `line` takes it, as far across as it drives a road as wide.
const onRamp = (r: Ramp, line: number) => Math.max(-1, Math.min(1, line)) * Math.max(0, r.w / 2 - 1.6);

// Stuck behind someone on its line, it moves across to pass; otherwise it eases back to its own.
// At a jump, from its run-up to 30 m past its landing, it drives the middle and passes nobody: the
// autopilot takes it onto the ramp's axis, and the landing street is narrow. But on the run-up
// (braga-map's task 114) it goes round a kart stopped or slowed ahead of it, and up the ramp beside
// it, and moves aside itself when it can't make the ramp's speed by its foot any more, for those
// behind: in single file on the axis, a pile-up there sent them all short of the landing.
function steerLine(r: Racer, b: Brain, a: Arena, dt: number): void {
  const N = a.track.samples.length;
  const s = a.track.samples[r.car.idx];
  const half = Math.max(1, s.w / 2 - 1.6);
  const lat = (x: number, z: number) => (x - s.p.x) * s.r.x + (z - s.p.z) * s.r.z;
  const mine = lat(r.car.p.x, r.car.p.z);
  let want = b.home;
  if (jumpAt(a.track, r.car.idx)) want = 0;
  else for (const o of a.cars.values()) {
    if (o.id === r.id) continue;
    const d = loopDelta(o.P, r.P, N);
    const theirs = lat(o.x, o.z);
    if (d > 2 && d < 22 && Math.abs(theirs - mine) < 2.4) want = theirs > mine ? -0.8 : 0.8;
    if (Math.abs(theirs / half - want) < 0.3 && d > 2 && d < 22) want = -want || 0.8;
  }
  const on = runUp(a.track, r.car.idx);
  if (on && on.foot <= 0) return; // up the ramp and off its lip: the line it took it on
  if (on) {
    const { ramp, foot } = on;
    const speed = speedOf(r.car);
    // As far across as the road lets a kart go, kerb to kerb, as a line.
    const edge = Math.max(1, (s.w / 2 - KART.wide / 2 - 0.15) / half);
    // Across the road where another kart is, from that kart's own sample (the run-up bends a little),
    // and which way across it's going.
    const across = (o: CarInfo) => {
      const t = a.track.samples[(((Math.round(o.P) % N) + N) % N)];
      return { at: (o.x - t.p.x) * t.r.x + (o.z - t.p.z) * t.r.z, v: o.vx * t.r.x + o.vz * t.r.z };
    };
    // Too slow to fly (a hit, a bump): out of the way, as far over as it goes, to the side away from the
    // nearest kart coming up behind it, else the side it's on.
    if (foot < RUN_UP && speedAfter(speed, foot) < rampSpeed(ramp) - SLOWER) {
      let behind: CarInfo | null = null;
      for (const o of a.cars.values()) {
        const d = loopDelta(r.P, o.P, N);
        if (o.id !== r.id && d > 0 && d < LOOK && (!behind || d < loopDelta(r.P, behind.P, N))) behind = o;
      }
      want = (behind ? (across(behind).at < mine ? 1 : -1) : mine < 0 ? -1 : 1) * edge;
    } else {
      // In its way: a kart ahead it would catch before that kart is well off the lip (or alongside it,
      // till it's a length past), across the road where that kart will be when this bot gets there;
      // the nearest of them in time.
      const ahead: { t: number; at: number }[] = [];
      for (const o of a.cars.values()) {
        if (o.id === r.id) continue;
        const d = loopDelta(o.P, r.P, N);
        const v = Math.hypot(o.vx, o.vz);
        if (d <= -KART.long || d >= LOOK || speed - v <= 1) continue;
        const at = d / (speed - v);
        if (at >= (foot - d + ramp.lip - ramp.foot + HOLD + KART.long) / Math.max(v, 1)) continue;
        const x = across(o);
        ahead.push({ t: Math.max(-edge * half, Math.min(edge * half, x.at + x.v * Math.max(0, Math.min(at, 1.5)))), at });
      }
      // Round the nearest on the side this bot is on, a little more than a kart's width off it (as far
      // as the road goes), if that clears them all; else on the other, if there's time to cross before
      // it; else as far over on its side as it goes.
      const clear = (w: number) => Math.min(...ahead.map((o) => Math.abs(o.t - w * half)));
      if (ahead.length && clear(want) < KART.wide + 0.5) {
        const near = ahead.reduce((p, q) => (q.at < p.at ? q : p));
        const side = mine < near.t ? -1 : 1;
        const pass = (w: number) => Math.max(-edge, Math.min(edge, (near.t + w * (KART.wide + 0.2)) / half));
        if (clear(pass(side)) >= KART.wide + 0.05) want = pass(side);
        else if (clear(pass(-side)) >= KART.wide + 0.05 && near.at > CROSS) want = pass(-side);
        else want = side * edge;
      }
    }
  }
  const rate = on ? 3 : 0.8;
  b.line += Math.max(-dt * rate, Math.min(dt * rate, want - b.line));
}

export function botControls(r: Racer, b: Brain, a: Arena, dt: number): Controls {
  // Stuck against a wall it keeps steering into (a corner's pocket, a barrier's end), it gets back on
  // the track where it is after a few seconds, as a player would press Enter.
  b.stuck = a.started && r.fin === null && r.spin <= 0 && speedOf(r.car) < 1 ? b.stuck + dt : 0;
  if (b.stuck > 3) {
    b.stuck = 0;
    r.unstick();
  }
  steerLine(r, b, a, dt);
  const on = runUp(a.track, r.car.idx);
  const inp = autopilot(r.car, a.track, b.caution, b.line, on ? onRamp(on.ramp, b.line) : 0);
  let use = false;
  let back = false;
  if (r.item && r.roll <= 0) {
    b.held += dt;
    const N = a.track.samples.length;
    const P = r.P;
    const others = [...a.cars.values()].filter((c) => c.id !== r.id);
    const behind = others.some((c) => {
      const d = loopDelta(P, c.P, N);
      return d > 0 && d < 40;
    });
    const ahead = others.some((c) => {
      const d = loopDelta(c.P, P, N);
      return d > 4 && d < 70;
    });
    switch (r.item.kind) {
      case 'cafe':
      case 'cafe3':
        // Not at a jump: a kart faster than its ramp wants overshoots the landing.
        use = b.held > b.patience && speedOf(r.car) > 15 && inp.brake === 0 && !jumpAt(a.track, r.car.idx);
        break;
      case 'pudim':
        use = behind || b.held > 6;
        break;
      case 'bola':
        if (ahead) use = true;
        else if (behind) use = back = true;
        else use = b.held > 8;
        break;
      default:
        use = b.held > 0.8;
    }
    if (use) {
      b.held = 0;
      b.patience = 0.5 + Math.random() * 2;
    }
  }
  return { ...inp, use, back };
}
