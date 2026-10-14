// A race as this browser knows it: the race clock, every car (ours, the host's bots, and the
// others as last heard of), the projectiles and hazards on the track, and positions.
import type { Track } from '../track/track.ts';
import { boxRows, projAlive, type Box, type Hazard, type ItemEv, type Proj } from './items.ts';
import type { Racer } from './racer.ts';

export interface Rules {
  mode: 'race' | 'time';
  laps: number;
  items: boolean;
  catchUp: boolean;
}

// Status flags, as sent with a car's position.
export const FLAG = { gold: 1, shield: 2, spin: 4, shrink: 8, boost: 16, drift: 32, turbo1: 64, turbo2: 128, slip: 256 } as const;

export interface CarInfo {
  id: string;
  name: string;
  P: number; // progress: metres along the track, counting laps
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  flags: number;
  fin: number | null; // race ms at the finish
}

// Something worth showing or hearing.
export type ArenaFx =
  | { k: 'hit'; ev: Extract<ItemEv, { k: 'hit' }> }
  | { k: 'boom'; ev: Extract<ItemEv, { k: 'boom' }> }
  | { k: 'martelinho'; ev: Extract<ItemEv, { k: 'martelinho' }> }
  | { k: 'thrown'; ev: ItemEv };

export class Arena {
  readonly track: Track;
  readonly rules: Rules;
  t = -1e9; // race ms since the green light
  started = false;
  projs = new Map<string, Proj>();
  hazards = new Map<string, Hazard>();
  cars = new Map<string, CarInfo>();
  locals: Racer[] = []; // the cars this browser drives: ours, and the bots if we host
  readonly boxes: Box[];
  // Sends an event this browser made to the others; set by the game.
  send: (ev: ItemEv) => void = () => {};
  fx: (f: ArenaFx) => void = () => {};

  constructor(track: Track, rules: Rules) {
    this.track = track;
    this.rules = rules;
    this.boxes = boxRows(track);
  }

  // An event made here: apply it, and tell the others.
  emit(ev: ItemEv): void {
    this.apply(ev);
    this.send(ev);
  }

  apply(ev: ItemEv): void {
    switch (ev.k) {
      case 'proj': {
        const { k: _k, ...p } = ev;
        this.projs.set(p.id, p);
        this.fx({ k: 'thrown', ev });
        break;
      }
      case 'haz': {
        const { k: _k, ...h } = ev;
        this.hazards.set(h.id, h);
        this.fx({ k: 'thrown', ev });
        break;
      }
      case 'hit':
        this.projs.delete(ev.item);
        this.hazards.delete(ev.item);
        this.fx({ k: 'hit', ev });
        break;
      case 'boom':
        for (const r of this.locals) r.onBoom(this, ev);
        this.fx({ k: 'boom', ev });
        break;
      case 'martelinho':
        for (const r of this.locals) r.onHammer(this, ev);
        this.fx({ k: 'martelinho', ev });
        break;
    }
  }

  prune(): void {
    for (const [id, p] of this.projs) if (!projAlive(p, this.t)) this.projs.delete(id);
  }

  // Everyone in order: the finished by finish time, then the rest by how far they've got.
  order(): CarInfo[] {
    return [...this.cars.values()].sort((a, b) => {
      if (a.fin !== null || b.fin !== null) return (a.fin ?? Infinity) - (b.fin ?? Infinity);
      return b.P - a.P;
    });
  }

  rankOf(id: string): number {
    return this.order().findIndex((c) => c.id === id) + 1;
  }

  leader(): CarInfo | undefined {
    return this.order()[0];
  }

  // The car just ahead of id, if any.
  ahead(id: string): CarInfo | undefined {
    const o = this.order();
    const i = o.findIndex((c) => c.id === id);
    return i > 0 ? o[i - 1] : undefined;
  }

  nameOf(id: string): string {
    return this.cars.get(id)?.name ?? 'Alguém';
  }
}
