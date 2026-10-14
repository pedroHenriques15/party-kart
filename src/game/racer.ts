// One car this browser drives, ours or (on the host) a bot: the handling, laps, item boxes, using
// items, getting hit, bumping into others, slipstreams and catch-up.
import { autopilot } from '../car/autopilot.ts';
import { newCar, NO_INPUT, speedOf, stepCar, stopInput, trackGround, type Car, type Ground, type Input, type Mods } from '../car/car.ts';
import { clamp } from '../math.ts';
import { advance, newRun, noteSpeed, respawn, restart, type Run, type RunEvent } from '../race.ts';
import { surfacePoint, type Track } from '../track/track.ts';
import { FLAG, type Arena, type CarInfo } from './arena.ts';
import {
  BALL_BACK,
  BALL_SPEED,
  BOOM_RADIUS,
  GOLD_TIME,
  ITEMS,
  loopDelta,
  PIGEON_SPEED,
  placeFraction,
  projProgress,
  rollItem,
  ROCKET_SPEED,
  SHRINK_TIME,
  SPIN_TIME,
  type ItemEv,
  type ItemKind,
} from './items.ts';

export interface Controls extends Input {
  use: boolean; // pressed this step
  back: boolean; // throw backwards
}

export const NO_CONTROLS: Controls = { ...NO_INPUT, use: false, back: false };

// What happened to this car this step, for the screen and the sounds.
export type Note =
  | RunEvent
  | { k: 'finish'; ms: number }
  | { k: 'respawn' }
  | { k: 'box' }
  | { k: 'item'; kind: ItemKind }
  | { k: 'use'; kind: ItemKind }
  | { k: 'hit'; by: string; how: string }
  | { k: 'blocked' }
  | { k: 'shrunk'; by: string }
  | { k: 'bump'; strength: number }
  | { k: 'slip' }
  | { k: 'turbo'; level: number }
  | { k: 'wall'; strength: number }
  | { k: 'land'; strength: number };

const BOX_RESPAWN = 2500;
const ROLL_TIME = 1.1;
const CAR_RADIUS = 1.1;
// The slipstream, GTA-style: behind a car the pull builds up over a second or so, more the closer
// you are, and when you pull out to pass it wears off over a few seconds, so the speed bleeds away
// instead of stopping dead.
const SLIP_FAR = 30; // m behind a car where it starts
const SLIP_VMAX = 0.15; // extra top speed at full strength
const SLIP_ACC = 0.9; // extra pull at full strength
const SLIP_CHARGE = 0.7; // strength gained a second in it
const SLIP_FADE = 0.3; // strength lost a second out of it

export class Racer {
  readonly id: string;
  readonly name: string;
  readonly bot: boolean;
  readonly track: Track;
  // What its car drives on: the track's road and walls (the world's with the race's walls, task 037).
  readonly ground: Ground;
  car: Car;
  run: Run;
  item: { kind: ItemKind; uses: number } | null = null;
  roll = 0; // s of roulette left
  rollKind: ItemKind | null = null;
  spin = 0;
  shrink = 0;
  gold = 0;
  shield = false;
  slip = 0; // how strong the slipstream is now, 0 to 1
  fin: number | null = null;
  taken = new Map<string, number>(); // box key → race ms it's back
  notes: Note[] = [];
  private seq = 0;

  constructor(track: Track, id: string, name: string, bot: boolean, grid: number) {
    this.track = track;
    this.ground = trackGround(track);
    this.id = id;
    this.name = name;
    this.bot = bot;
    this.car = gridCar(track, grid);
    this.run = newRun(0);
  }

  // Metres along the track since the start, counting laps (negative behind the line at first).
  get P(): number {
    const N = this.track.samples.length;
    const i = this.car.idx;
    const before = this.run.nextCp === 0 && i > N * 0.75;
    return this.run.laps * N + (before ? i - N : i);
  }

  info(): CarInfo {
    const c = this.car;
    let flags = 0;
    if (this.gold > 0) flags |= FLAG.gold;
    if (this.shield) flags |= FLAG.shield;
    if (this.spin > 0) flags |= FLAG.spin;
    if (this.shrink > 0) flags |= FLAG.shrink;
    if (c.boost > 0) flags |= FLAG.boost;
    if (c.drifting) flags |= FLAG.drift;
    if (c.drift >= 1.7) flags |= FLAG.turbo2;
    else if (c.drift >= 0.8) flags |= FLAG.turbo1;
    if (this.slip > 0.2) flags |= FLAG.slip;
    return { id: this.id, name: this.name, P: this.P, x: c.p.x, y: c.p.y, z: c.p.z, vx: c.v.x, vz: c.v.z, flags, fin: this.fin };
  }

  private nextId(): string {
    return `${this.id}:${++this.seq}`;
  }

  step(a: Arena, ctl: Controls, dt: number): void {
    const t = a.t;
    const racing = a.started && this.fin === null;
    this.spin = Math.max(0, this.spin - dt);
    this.shrink = Math.max(0, this.shrink - dt);
    this.gold = Math.max(0, this.gold - dt);

    let inp: Input = ctl;
    if (!a.started) inp = stopInput(this.car);
    else if (this.fin !== null) inp = autopilot(this.car, this.track, 1.2);
    if (this.spin > 0) inp = stopInput(this.car, 0.3);

    const mods: Mods = { vmax: 1, acc: 1 };
    if (this.gold > 0) {
      mods.vmax *= 1.12;
      mods.acc *= 1.3;
    }
    if (this.shrink > 0) mods.vmax *= 0.72;
    if (this.slip > 0) {
      mods.vmax *= 1 + SLIP_VMAX * this.slip;
      mods.acc *= 1 + SLIP_ACC * this.slip;
    }
    if (racing && a.rules.mode === 'race' && a.rules.catchUp) {
      // Catch-up: the further behind the leader, the more top speed and pull.
      const gap = Math.max(0, (a.leader()?.P ?? this.P) - this.P);
      mods.vmax *= 1 + clamp(gap / 3000, 0, 0.07);
      mods.acc *= 1 + clamp(gap / 1500, 0, 0.15);
    }

    const from = this.car.idx;
    if (stepCar(this.car, inp, this.ground, dt, mods)) {
      this.car = respawn(this.run, this.track, t);
      this.notes.push({ k: 'respawn' });
      return;
    }
    const c = this.car;
    if (c.turbo) this.notes.push({ k: 'turbo', level: c.turbo });
    if (c.wallHit > 3) this.notes.push({ k: 'wall', strength: c.wallHit });
    if (c.landed > 4) this.notes.push({ k: 'land', strength: c.landed });

    if (racing) {
      const e = advance(this.run, this.track, from, c.idx, t);
      if (e) {
        noteSpeed(this.run, c);
        this.notes.push(e);
        if (e.k === 'lap' && a.rules.mode === 'race' && this.run.laps >= a.rules.laps) {
          this.fin = t;
          this.notes.push({ k: 'finish', ms: t });
        }
      }
    }

    if (racing && a.rules.items) {
      this.boxes(a);
      if (this.roll > 0) {
        this.roll -= dt;
        if (this.roll <= 0 && this.rollKind === 'guarda') {
          // The umbrella opens at once, so the slot is free for the next box.
          this.shield = true;
          this.notes.push({ k: 'use', kind: 'guarda' });
        } else if (this.roll <= 0 && this.rollKind) {
          this.item = { kind: this.rollKind, uses: ITEMS[this.rollKind].uses };
          this.notes.push({ k: 'item', kind: this.rollKind });
        }
      } else if (ctl.use && this.item && this.spin <= 0) {
        this.use(a, ctl.back);
      }
    }
    if (a.started) {
      this.hits(a);
      this.contact(a, dt);
    }
  }

  private boxes(a: Arena): void {
    const N = this.track.samples.length;
    const c = this.car;
    for (const b of a.boxes) {
      if (Math.abs(loopDelta(b.i, c.idx, N)) > 5) continue;
      if ((this.taken.get(b.key) ?? -Infinity) > a.t) continue;
      const p = surfacePoint(this.track.samples[b.i], b.lat, 0);
      if (Math.hypot(p.x - c.p.x, p.z - c.p.z) > 2.1 || c.h > 2.5) continue;
      this.taken.set(b.key, a.t + BOX_RESPAWN);
      this.notes.push({ k: 'box' });
      if (!this.item && this.roll <= 0) {
        const place = placeFraction(a.rankOf(this.id), a.cars.size);
        let kind = rollItem(place);
        while (kind === 'guarda' && this.shield) kind = rollItem(place);
        this.roll = ROLL_TIME;
        this.rollKind = kind;
      }
    }
  }

  private use(a: Arena, back: boolean): void {
    const item = this.item!;
    const kind = item.kind;
    const c = this.car;
    const t = a.t;
    const P = this.P;
    const kickBall = (backwards: boolean) =>
      a.emit({ k: 'proj', id: this.nextId(), kind: 'bola', owner: this.id, t0: t, p0: P + (backwards ? -3 : 3), lat: clamp(c.lat, -5, 5), v: backwards ? BALL_BACK : Math.max(50, speedOf(c) + BALL_SPEED) });
    switch (kind) {
      case 'cafe':
      case 'cafe3':
        c.boost = Math.max(c.boost, 1.6);
        break;
      case 'pudim':
        a.emit({ k: 'haz', id: this.nextId(), kind: 'pudim', owner: this.id, t0: t, idx: (c.idx - 4 + this.track.samples.length) % this.track.samples.length, lat: c.lat });
        break;
      case 'bola':
        kickBall(back);
        break;
      case 'pombo': {
        const target = a.ahead(this.id);
        if (target && target.fin === null) a.emit({ k: 'proj', id: this.nextId(), kind: 'pombo', owner: this.id, t0: t, p0: P + 2, lat: 0, v: PIGEON_SPEED, target: target.id });
        else kickBall(false);
        break;
      }
      case 'foguete':
        a.emit({ k: 'proj', id: this.nextId(), kind: 'foguete', owner: this.id, t0: t, p0: P + 2, lat: 0, v: ROCKET_SPEED });
        break;
      case 'filigrana':
        this.gold = GOLD_TIME;
        c.boost = Math.max(c.boost, 0.8);
        break;
      case 'martelinho':
        a.emit({ k: 'martelinho', id: this.nextId(), owner: this.id, t0: t, p0: P });
        break;
      case 'guarda':
        this.shield = true;
        break;
    }
    this.notes.push({ k: 'use', kind });
    item.uses--;
    if (item.uses <= 0) this.item = null;
  }

  // Taking a hit: a gold car smashes the item, an umbrella keeps it off, otherwise you spin.
  private hit(a: Arena, item: string, by: string, how: string, launch = false): void {
    const c = this.car;
    const base = { k: 'hit' as const, id: this.nextId(), item, x: c.p.x, y: c.p.y, z: c.p.z, how };
    if (this.gold > 0) {
      a.emit({ ...base, victim: null, blocked: true });
      return;
    }
    if (this.shield) {
      this.shield = false;
      a.emit({ ...base, victim: this.id, blocked: true });
      this.notes.push({ k: 'blocked' });
      return;
    }
    this.spin = launch ? SPIN_TIME * 1.3 : SPIN_TIME;
    c.v.x *= 0.25;
    c.v.z *= 0.25;
    c.boost = 0;
    if (launch) {
      c.v.y = 7;
      c.grounded = false;
    }
    a.emit({ ...base, victim: this.id, blocked: false });
    this.notes.push({ k: 'hit', by, how });
  }

  private hits(a: Arena): void {
    if (this.fin !== null || this.spin > 0) return;
    const N = this.track.samples.length;
    const c = this.car;
    const t = a.t;
    const P = this.P;
    for (const p of [...a.projs.values()]) {
      const age = t - p.t0;
      if (p.owner === this.id && age < (p.v < 0 ? 1500 : 700)) continue;
      const at = projProgress(p, t);
      if (p.kind === 'bola') {
        if (Math.abs(loopDelta(at, P, N)) < 2.2 && Math.abs(p.lat - c.lat) < 1.9 && c.h < 1.6) this.hit(a, p.id, a.nameOf(p.owner), 'bola');
      } else if (p.kind === 'pombo') {
        if (p.target === this.id && at >= P - 1) this.hit(a, p.id, a.nameOf(p.owner), 'pombo');
      } else if (p.kind === 'foguete') {
        if (p.owner !== this.id && a.leader()?.id === this.id && at >= P - 1) {
          a.emit({ k: 'boom', id: this.nextId(), owner: p.owner, victim: this.id, x: c.p.x, y: c.p.y, z: c.p.z });
          this.hit(a, p.id, a.nameOf(p.owner), 'foguete', true);
        }
      }
      if (this.spin > 0) return;
    }
    for (const h of [...a.hazards.values()]) {
      if (h.owner === this.id && t - h.t0 < 1000) continue;
      if (Math.abs(loopDelta(h.idx, c.idx, N)) > 4) continue;
      const p = surfacePoint(this.track.samples[h.idx], h.lat, 0);
      if (Math.hypot(p.x - c.p.x, p.z - c.p.z) < 1.9 && c.h < 1) {
        this.hit(a, h.id, a.nameOf(h.owner), 'pudim');
        if (this.spin > 0) return;
      }
    }
  }

  onBoom(a: Arena, ev: Extract<ItemEv, { k: 'boom' }>): void {
    if (ev.victim === this.id || ev.owner === this.id || this.spin > 0) return;
    const c = this.car;
    if (Math.hypot(ev.x - c.p.x, ev.z - c.p.z) < BOOM_RADIUS) this.hit(a, '', a.nameOf(ev.owner), 'foguete', true);
  }

  onHammer(a: Arena, ev: Extract<ItemEv, { k: 'martelinho' }>): void {
    if (ev.owner === this.id || this.fin !== null || this.P <= ev.p0 || this.gold > 0) return;
    if (this.shield) {
      this.shield = false;
      this.notes.push({ k: 'blocked' });
      return;
    }
    this.shrink = SHRINK_TIME;
    this.notes.push({ k: 'shrunk', by: a.nameOf(ev.owner) });
  }

  // Bumping into the others (each car pushes only itself away, so it's fair on both sides), a
  // gold car spinning you, and the slipstream behind a car ahead.
  private contact(a: Arena, dt: number): void {
    const c = this.car;
    const fx = Math.cos(c.yaw);
    const fz = Math.sin(c.yaw);
    const speed = speedOf(c);
    let pull = 0;
    for (const o of a.cars.values()) {
      if (o.id === this.id) continue;
      const dx = c.p.x - o.x;
      const dz = c.p.z - o.z;
      const d = Math.hypot(dx, dz);
      if (d < CAR_RADIUS * 2 && Math.abs(c.p.y - o.y) < 1.6 && d > 0.01) {
        const nx = dx / d;
        const nz = dz / d;
        const push = (CAR_RADIUS * 2 - d) / 2;
        c.p.x += nx * push;
        c.p.z += nz * push;
        const vn = (c.v.x - o.vx) * nx + (c.v.z - o.vz) * nz;
        if (vn < 0) {
          c.v.x -= nx * vn * 0.8;
          c.v.z -= nz * vn * 0.8;
          this.notes.push({ k: 'bump', strength: -vn });
        }
        if (o.flags & FLAG.gold && this.gold <= 0 && this.spin <= 0) this.hit(a, '', o.name, 'filigrana');
      }
      // In the slipstream: up to 30 m behind someone going the same way, close to their line. It's
      // strongest within 8 m.
      const along = -(dx * fx + dz * fz);
      const side = Math.abs(-dx * fz + dz * fx);
      const theirs = o.vx * fx + o.vz * fz;
      if (along > 2.5 && along < SLIP_FAR && side < 2.2 + along * 0.03 && theirs > 12 && Math.abs(c.p.y - o.y) < 3) {
        pull = Math.max(pull, 1 - 0.6 * clamp((along - 8) / (SLIP_FAR - 8), 0, 1));
      }
    }
    if (pull > 0 && speed > 15 && this.spin <= 0) {
      if (this.slip === 0) this.notes.push({ k: 'slip' });
      // Up towards how strong it is here, or slowly down to it when you drop back.
      this.slip = this.slip < pull ? Math.min(pull, this.slip + dt * SLIP_CHARGE) : Math.max(pull, this.slip - dt * SLIP_FADE);
    } else {
      this.slip = Math.max(0, this.slip - dt * SLIP_FADE);
    }
  }

  // Time attack's restart: back to the line, the lap's clock reset.
  restart(a: Arena): void {
    this.car = restart(this.run, this.track, a.t);
  }

  respawn(a: Arena): void {
    this.car = respawn(this.run, this.track, a.t);
  }
}

// The starting grid: two columns, a row every 7 m behind the line.
export function gridCar(track: Track, slot: number): Car {
  const N = track.samples.length;
  const i = (N - 6 - Math.floor(slot / 2) * 7) % N;
  const c = newCar(track, i);
  const s = track.samples[i];
  const lat = (slot % 2 === 0 ? -1 : 1) * Math.min(3.5, s.w / 4);
  c.p = surfacePoint(s, lat, 0.01);
  c.lat = lat;
  return c;
}
