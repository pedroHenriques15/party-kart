// The bots: the autopilot at the wheel, a little careful or a little bold, and a feel for when
// to use what they've got.
import { autopilot } from '../car/autopilot.ts';
import { speedOf } from '../car/car.ts';
import type { Arena } from './arena.ts';
import { loopDelta } from './items.ts';
import type { Controls, Racer } from './racer.ts';

export interface Brain {
  caution: number; // 1 drives flat out; more brakes earlier
  held: number; // s holding the current item
  patience: number; // s it waits before using a speed item
  home: number; // the line across the road it likes, -1 (left) to 1 (right)
  line: number; // the line it's on now, moved out to pass
}

export const newBrain = (rand: () => number = Math.random): Brain => {
  const home = (rand() * 2 - 1) * 0.5;
  return { caution: 1.05 + rand() * 0.22, held: 0, patience: 0.5 + rand() * 2, home, line: home };
};

// Stuck behind someone on its line, it moves across to pass; otherwise it eases back to its own.
function steerLine(r: Racer, b: Brain, a: Arena, dt: number): void {
  const N = a.track.samples.length;
  const s = a.track.samples[r.car.idx];
  const half = Math.max(1, s.w / 2 - 1.6);
  const lat = (x: number, z: number) => (x - s.p.x) * s.r.x + (z - s.p.z) * s.r.z;
  const mine = lat(r.car.p.x, r.car.p.z);
  let want = b.home;
  for (const o of a.cars.values()) {
    if (o.id === r.id) continue;
    const d = loopDelta(o.P, r.P, N);
    const theirs = lat(o.x, o.z);
    if (d > 2 && d < 22 && Math.abs(theirs - mine) < 2.4) want = theirs > mine ? -0.8 : 0.8;
    if (Math.abs(theirs / half - want) < 0.3 && d > 2 && d < 22) want = -want || 0.8;
  }
  b.line += Math.max(-dt * 0.8, Math.min(dt * 0.8, want - b.line));
}

export function botControls(r: Racer, b: Brain, a: Arena, dt: number): Controls {
  steerLine(r, b, a, dt);
  const inp = autopilot(r.car, a.track, b.caution, b.line);
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
        use = b.held > b.patience && speedOf(r.car) > 15 && inp.brake === 0;
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
