// The flying camera (braga-map's task 054): your kart waits where it is, and you look round Braga from
// anywhere, down a street, over the rooftops or from the hills as far as the horizon. It flies through
// buildings and trees, but never into the ground. Pure, like the karts' physics, so the tests fly it.
import type { Grid } from 'braga-map';
import type { Car } from '../car/car.ts';
import { angleDiff, clamp, v3, type V } from '../math.ts';
import type { WorldGround } from '../world/ground.ts';

// Its pace by its height over the ground, m/s: slow enough at a person's height to look at a street
// closely, quick enough from high up to cross the area in a few seconds.
const LOW = { h: 2, pace: 6 };
const HIGH = { h: 80, pace: 80 };
// Holding "faster" (Shift).
export const FASTER = 4;
// The lowest it goes over the ground and the highest it climbs, m.
export const FLOOR = 1;
export const CEILING = 500;
// Past the ceiling, where the ground fell away under it, it comes back down to it in about a second
// rather than following every hill.
const SETTLE = 0.4;
const PITCH = (85 * Math.PI) / 180;
// The velocity eases towards the one wanted with this time constant, s, and a steady part as well
// (EVEN × the pace, each second), so it starts at once and comes to a stop rather than creeping.
const EASE = 0.15;
const EVEN = 2;
// The arrows' turn, rad/s.
const TURN = 1.8;

export function paceAt(h: number): number {
  return LOW.pace + (HIGH.pace - LOW.pace) * clamp((h - LOW.h) / (HIGH.h - LOW.h), 0, 1);
}

export interface FlyInput {
  fwd: number; // -1 to 1: the way it faces, level
  side: number; // -1 to 1: to its right
  up: number; // -1 to 1
  turn: number; // -1 to 1: the arrows, to the right
  look: { x: number; y: number }; // the drags this step, in radians: to the right, and up
  fast: boolean;
}

export const STILL: FlyInput = { fwd: 0, side: 0, up: 0, turn: 0, look: { x: 0, y: 0 }, fast: false };

// Where it may go, seen from above.
export interface Bound {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export class Flyer {
  p: V;
  v: V = v3();
  yaw: number; // as a car's: it faces (cos yaw, 0, sin yaw)
  pitch: number; // up from level
  readonly ground: (x: number, z: number) => number;
  readonly bound: Bound;

  constructor(p: V, yaw: number, pitch: number, ground: (x: number, z: number) => number, bound: Bound) {
    this.ground = ground;
    this.bound = bound;
    const x = clamp(p.x, bound.x0, bound.x1);
    const z = clamp(p.z, bound.z0, bound.z1);
    this.p = v3(x, Math.max(p.y, ground(x, z) + FLOOR), z);
    this.yaw = yaw;
    this.pitch = clamp(pitch, -PITCH, PITCH);
  }

  // How high it is over the ground.
  height(): number {
    return this.p.y - this.ground(this.p.x, this.p.z);
  }

  // The way it looks.
  dir(): V {
    const c = Math.cos(this.pitch);
    return v3(Math.cos(this.yaw) * c, Math.sin(this.pitch), Math.sin(this.yaw) * c);
  }

  step(inp: FlyInput, dt: number): void {
    this.yaw = angleDiff(this.yaw + inp.turn * TURN * dt + inp.look.x, 0);
    this.pitch = clamp(this.pitch + inp.look.y, -PITCH, PITCH);
    const { p, v, bound: b } = this;
    const pace = paceAt(this.height()) * (inp.fast ? FASTER : 1);
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    let mx = inp.fwd * cy - inp.side * sy;
    let mz = inp.fwd * sy + inp.side * cy;
    const m = Math.hypot(mx, mz);
    if (m > 1) {
      mx /= m;
      mz /= m;
    }
    let top = this.ground(p.x, p.z) + CEILING;
    const want = v3(mx * pace, clamp(inp.up, -1, 1) * pace, mz * pace);
    if (p.y >= top) want.y = Math.min(want.y, 0);
    const dx = want.x - v.x;
    const dy = want.y - v.y;
    const dz = want.z - v.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > 0) {
      const k = Math.min(d, d * (1 - Math.exp(-dt / EASE)) + EVEN * pace * dt) / d;
      v.x += dx * k;
      v.y += dy * k;
      v.z += dz * k;
    }
    const was = p.y;
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;
    if (p.x < b.x0 || p.x > b.x1) {
      p.x = clamp(p.x, b.x0, b.x1);
      v.x = 0;
    }
    if (p.z < b.z0 || p.z > b.z1) {
      p.z = clamp(p.z, b.z0, b.z1);
      v.z = 0;
    }
    const g = this.ground(p.x, p.z);
    top = g + CEILING;
    if (p.y < g + FLOOR) {
      p.y = g + FLOOR;
      v.y = Math.max(0, v.y);
    } else if (p.y > top) {
      if (v.y > 0) {
        p.y = Math.max(top, Math.min(was, p.y));
        v.y = 0;
      }
      p.y = top + (p.y - top) * Math.exp(-dt / SETTLE);
    }
  }
}

// The height at (x, z) of a grid of heights drawn as two triangles a square, split from its (i + 1, j)
// corner to its (i, j + 1), as city.ts and sights.ts draw the hills: the height of corner (i, j) is
// y(i, j), and a square drawn(i, j) says isn't drawn, or off the grid, is null.
export function onGrid(g: Grid, x: number, z: number, y: (i: number, j: number) => number, drawn: (i: number, j: number) => boolean = () => true): number | null {
  const fx = (x - g.x0) / g.step;
  const fz = (z - g.z0) / g.step;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.nz - 1 || !drawn(i, j)) return null;
  const u = fx - i;
  const w = fz - j;
  if (u + w <= 1) {
    const a = y(i, j);
    return a + (y(i + 1, j) - a) * u + (y(i, j + 1) - a) * w;
  }
  const c = y(i + 1, j + 1);
  return c + (y(i, j + 1) - c) * (1 - u) + (y(i + 1, j) - c) * (1 - w);
}

// Where your kart is put when you stop flying (the owner's choice): on the street nearest the point under
// the camera at (x, y, z), at the level under it (under a deck, the street below), facing along it the
// way nearest yaw; from the area's nearest point when the camera is outside it, facing into the area.
export function landing(g: WorldGround, x: number, y: number, z: number, yaw: number): Car {
  if (!g.d.inside.has(x, z)) {
    const [ex, ez] = nearestOn(g.d.world.open.pts, x, z);
    yaw = Math.atan2(ez - z, ex - x);
    [x, z, y] = [ex, ez, 1e4];
  }
  return g.spawn(x, z, g.floor(x, z, y).y, yaw);
}

// The point of a closed outline nearest (x, z): where a kart lands from a camera outside the area.
export function nearestOn(ring: [number, number][], x: number, z: number): [number, number] {
  let best: [number, number] = ring[0];
  let bd = Infinity;
  for (let k = 0; k < ring.length; k++) {
    const [ax, az] = ring[k];
    const [bx, bz] = ring[(k + 1) % ring.length];
    const dx = bx - ax;
    const dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bd) {
      bd = d;
      best = [px, pz];
    }
  }
  return best;
}
