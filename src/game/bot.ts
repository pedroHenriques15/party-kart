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
}

export const newBrain = (rand: () => number = Math.random): Brain => ({ caution: 1.05 + rand() * 0.22, held: 0, patience: 0.5 + rand() * 2 });

export function botControls(r: Racer, b: Brain, a: Arena, dt: number): Controls {
  const inp = autopilot(r.car, a.track, b.caution);
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
      case 'champagne':
      case 'champagne3':
        use = b.held > b.patience && speedOf(r.car) > 15 && inp.brake === 0;
        break;
      case 'pudim':
        use = behind || b.held > 6;
        break;
      case 'disco':
        if (ahead) use = true;
        else if (behind) use = back = true;
        else use = b.held > 8;
        break;
      case 'shield':
        use = true;
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
