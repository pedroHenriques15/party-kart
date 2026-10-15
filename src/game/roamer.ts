// A car this browser drives outside a race, in the open world (braga-map's decision 019): on the
// world's ground anywhere in the area, bumping the others and in their slipstreams as in a race, but
// with no laps, items or catch-up. Lost (in the land, the river, wedged), it's put back on the
// nearest street.
import { speedOf, stepCar, type Car, type Input } from '../car/car.ts';
import type { WorldGround } from '../world/ground.ts';
import { FLAG, type CarInfo } from './arena.ts';
import { bump, SLIP_ACC, SLIP_VMAX, slipstream, type Note } from './racer.ts';

export class Roamer {
  id: string; // the room's id for you, or "me" alone
  name: string;
  readonly ground: WorldGround;
  car: Car;
  slip = 0;
  notes: Note[] = [];

  constructor(ground: WorldGround, id: string, name: string, car: Car) {
    this.ground = ground;
    this.id = id;
    this.name = name;
    this.car = car;
  }

  step(cars: Iterable<CarInfo>, inp: Input, dt: number): void {
    const mods = this.slip > 0 ? { vmax: 1 + SLIP_VMAX * this.slip, acc: 1 + SLIP_ACC * this.slip } : undefined;
    if (stepCar(this.car, inp, this.ground, dt, mods)) {
      this.respawn();
      return;
    }
    const c = this.car;
    if (c.turbo) this.notes.push({ k: 'turbo', level: c.turbo });
    if (c.wallHit > 3) this.notes.push({ k: 'wall', strength: c.wallHit });
    if (c.landed > 4) this.notes.push({ k: 'land', strength: c.landed });
    const speed = speedOf(c);
    const { pull } = bump(c, this.id, cars, this.notes);
    this.slip = slipstream(this.slip, pull, speed, false, dt, this.notes);
  }

  // Back on the street nearest where it is, at its level, facing the way it was going.
  respawn(): void {
    const c = this.car;
    this.car = this.ground.spawn(c.p.x, c.p.z, c.p.y, c.yaw);
    this.slip = 0;
    this.notes.push({ k: 'respawn' });
  }

  info(): CarInfo {
    const c = this.car;
    let flags = 0;
    if (c.boost > 0) flags |= FLAG.boost;
    if (c.drifting) flags |= FLAG.drift;
    if (c.drift >= 1.7) flags |= FLAG.turbo2;
    else if (c.drift >= 0.8) flags |= FLAG.turbo1;
    if (this.slip > 0.2) flags |= FLAG.slip;
    return { id: this.id, name: this.name, P: 0, x: c.p.x, y: c.p.y, z: c.p.z, vx: c.v.x, vz: c.v.z, flags, fin: null };
  }
}
