// The world as a ground for the cars (braga-map's decision 019): the land, every street at its level
// (braga-map's world.streets, its task 033), and what stands on them, so a kart drives anywhere in
// the area. stepCar's handling is the same as on the track; only the ground and the walls differ.
//
// - The floor. At a point the candidates are the land (land.ts, the land as it's drawn), a
//   pavement a kerb over it, a footway, path or cycleway on it (braga-map's task 050; a kerb over
//   it where it runs in a pavement, flush with it), a tread of a flight of steps at its own height
//   in its place, and every street or path piece off the ground over the point at its height: a
//   bridge's deck, a footbridge's, a tunnel's road. A car stands on the highest no more than a step
//   over its wheels, so on a deck it's on the deck, under it on the street below, and in a tunnel the
//   land over it is its roof. Its normal is the surface's over about a car's length, so the 2 m
//   ground doesn't shake it, and a flight of steps is a slope it climbs a riser at a time.
// - The walls, in 2D, each standing from a foot to a top: the buildings' outlines, a deck's
//   parapets and a tunnel's sides (wherever a piece off the ground has neither more street nor the
//   land at its own level beside it), the tunnels' mouths, the trees' trunks, the steps'
//   handrails, the walls, fences, railings, hedges and gates the map has (braga-map's task 013; a
//   gate shut), and the area's edge with the barriers across its streets and paths. The land is a wall
//   where it rises more than a step in front of the car, or steeper than a car can climb off the
//   carriageway or a path (a retaining wall, a cutting's side). A kerb is a step: it bumps the car and
//   takes a little of its speed; so is a riser, and one more than a step high is a wall.
// - A car that has fallen into the land or the river, is wedged between walls, or has left the
//   world is lost, and is put back on the nearest carriageway at its level (spawn).
//
// Everything is looked up in a grid of 10 m cells, so a step costs the same anywhere.
import type { World as Braga, Path, Wall as Barrier } from 'braga-map';
import { bounce, carAt, fly, settle, STICK, WALL_H, type Car, type Ground } from '../car/car.ts';
import { norm, v3, type V } from '../math.ts';
import { locate, type Track } from '../track/track.ts';
import { makeLand, mouthShape, THROAT, type Land } from './land.ts';

const CELL = 10;
export const STEP = 0.3; // the highest a car steps up onto: a kerb, not a wall
const KERB = 0.15; // a kerb's height over its carriageway, as braga-map's streets.mjs has it
const DROP = 1.2; // how far a pavement slopes up from a kerb dropped at a crossing
const GRADE = 0.7; // a piece off the ground meets the land "at grade" within this, and is eased to it
const EASE = 10; // over this many metres from where it meets it
export const CAR_R = 0.8; // the car's two circles: their radius, and how far ahead and behind its middle
export const CAR_L = 0.95;
const CLIMB = 0.7; // the steepest land a car climbs off the carriageway (35°)
const SMOOTH = 1.5; // a surface's normal is taken over this either side
const TRUNK = 0.3;
const PARAPET = 1.0; // over a deck, as levels.ts draws it
const BORE = 3; // how high a tunnel's sides stand over its road, at most
const DEEP = 1.2; // a deck's depth, under its road
const BUMP = 0.12; // the share of its speed across a kerb a car loses going up it
const RAIL = 0.9; // a handrail's height over the steps, as braga-map has it
const HOLD = 0.6; // how far a retaining wall stands over its top, for the karts

// A wall: from (ax, az) to (bx, bz), standing from y0 to y1.
export interface Wall {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  y0: number;
  y1: number;
}

// A flight of steps' tread (braga-map's task 050): its outline, its height, and its box.
export interface Tread {
  rings: [number, number][][];
  y: number;
  box: { x0: number; z0: number; x1: number; z1: number };
}

// A tree's trunk, or anything round: at (x, z), r wide, from y0 to y1.
interface Post {
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
}

const key = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);
const cellOf = (v: number) => Math.floor(v / CELL);

// Each cell a set of things whose box overlaps it.
class Cells<T> {
  m = new Map<number, T[]>();
  add(x0: number, z0: number, x1: number, z1: number, t: T): void {
    for (let i = cellOf(x0); i <= cellOf(x1); i++) {
      for (let j = cellOf(z0); j <= cellOf(z1); j++) {
        const k = key(i, j);
        const l = this.m.get(k);
        if (l) l.push(t);
        else this.m.set(k, [t]);
      }
    }
  }
  at(x: number, z: number): T[] | undefined {
    return this.m.get(key(cellOf(x), cellOf(z)));
  }
  // Takes t out of the cells its box overlaps, as it was added.
  remove(x0: number, z0: number, x1: number, z1: number, t: T): void {
    for (let i = cellOf(x0); i <= cellOf(x1); i++) {
      for (let j = cellOf(z0); j <= cellOf(z1); j++) {
        const l = this.m.get(key(i, j));
        const k = l ? l.indexOf(t) : -1;
        if (k >= 0) l!.splice(k, 1);
      }
    }
  }
  // Everything in the cells round a box, once each time it turns up in one: callers don't mind
  // seeing a thing twice.
  near(x0: number, z0: number, x1: number, z1: number, out: T[]): T[] {
    out.length = 0;
    for (let i = cellOf(x0); i <= cellOf(x1); i++) for (let j = cellOf(z0); j <= cellOf(z1); j++) for (const t of this.m.get(key(i, j)) ?? []) out.push(t);
    return out;
  }
}

// Polygons, for telling whether a point is in one quickly. Each cell keeps the edges that cross it
// and whether its reference point (near its middle, off any 10 cm grid) is inside; a point is
// inside when that, and the number of edges between it and the reference point, say so. The rings
// are read even-odd, so pieces that don't overlap can share one.
export class Rings {
  cells = new Map<number, { inside: boolean; e: number[] }>();
  constructor(rings: [number, number][][]) {
    const rows = new Map<number, number[]>();
    for (const r of rings) {
      for (let k = 0; k < r.length; k++) {
        const [ax, az] = r[k];
        const [bx, bz] = r[(k + 1) % r.length];
        for (let i = cellOf(Math.min(ax, bx) - 0.01); i <= cellOf(Math.max(ax, bx) + 0.01); i++) {
          for (let j = cellOf(Math.min(az, bz) - 0.01); j <= cellOf(Math.max(az, bz) + 0.01); j++) this.cell(i, j).e.push(ax, az, bx, bz);
        }
        // Where the edge crosses each row of reference points, for whether they're inside.
        for (let j = cellOf(Math.min(az, bz)) - 1; j <= cellOf(Math.max(az, bz)) + 1; j++) {
          const zr = refZ(j);
          if (az > zr !== bz > zr) {
            const x = ax + ((zr - az) / (bz - az)) * (bx - ax);
            const row = rows.get(j);
            if (row) row.push(x);
            else rows.set(j, [x]);
          }
        }
      }
    }
    for (const [j, xs] of rows) {
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let i = Math.ceil(xs[k] / CELL - 0.50123); refX(i) < xs[k + 1]; i++) this.cell(i, j).inside = true;
      }
    }
  }
  private cell(i: number, j: number) {
    const k = key(i, j);
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = { inside: false, e: [] }));
    return c;
  }
  has(x: number, z: number): boolean {
    const i = cellOf(x);
    const j = cellOf(z);
    const c = this.cells.get(key(i, j));
    if (!c) return false;
    return c.inside !== crossesOdd(c.e, x, z, refX(i), refZ(j));
  }
}
const refX = (i: number) => (i + 0.50123) * CELL;
const refZ = (j: number) => (j + 0.50371) * CELL;

// Whether the segment from (px, pz) to (rx, rz) crosses an odd number of the edges (flat, four
// numbers each). An edge's end on the segment's line counts as on its left, so a corner the
// segment passes through is counted once or twice, as the boundary crosses it or turns back.
function crossesOdd(e: number[], px: number, pz: number, rx: number, rz: number): boolean {
  const dx = rx - px;
  const dz = rz - pz;
  let odd = false;
  for (let k = 0; k < e.length; k += 4) {
    const ax = e[k];
    const az = e[k + 1];
    const bx = e[k + 2];
    const bz = e[k + 3];
    const oa = dx * (az - pz) - dz * (ax - px) >= 0;
    const ob = dx * (bz - pz) - dz * (bx - px) >= 0;
    if (oa === ob) continue;
    const ex = bx - ax;
    const ez = bz - az;
    const op = ex * (pz - az) - ez * (px - ax);
    const or = ex * (rz - az) - ez * (rx - ax);
    if (op > 0 !== or > 0) odd = !odd;
  }
  return odd;
}

// The distance from (x, z) to the segment from (ax, az) to (bx, bz), and how far along it the
// nearest point is (0 to 1).
function toSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const ex = bx - ax;
  const ez = bz - az;
  const L = ex * ex + ez * ez;
  const t = L ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L)) : 0;
  return { d: Math.hypot(ax + ex * t - x, az + ez * t - z), t };
}

// A street piece off the ground: a bridge's deck or a tunnel's road, a carriageway or a pavement on
// it (a kerb over the carriageway), with each point of its outline at its height. Its height inside
// is its outline's nearest edges', weighted by how near; and where it meets the land at grade, it's
// eased to the land's height there, as the map's ends can be a few decimetres off the ground's.
export class Piece {
  level: 'bridge' | 'tunnel';
  raise: number;
  // Its outline and holes as the map has them, for drawing it, and what it's paved with if it's a
  // carriageway (a pavement is calçada), or if it's a path (braga-map's task 050), the path.
  outline: [number, number][][];
  surface: 'asphalt' | 'setts' | 'paving' | 'dirt' | null;
  path: Path | null = null;
  rings: Rings;
  e: number[] = []; // its edges, six numbers each: ax, az, ay, bx, bz, by
  cells = new Cells<number>();
  joins: { x: number; z: number; d: number }[] = [];
  box: { x0: number; z0: number; x1: number; z1: number };
  // For raw(): which edges it has looked at this time, so an edge in two cells counts once.
  private stamp: Int32Array = new Int32Array(0);
  private looks = 0;
  constructor(level: 'bridge' | 'tunnel', raise: number, rings: [number, number][][], ys: number[][], surface: Piece['surface'] = null) {
    this.level = level;
    this.raise = raise;
    this.outline = rings;
    this.surface = surface;
    this.rings = new Rings(rings);
    this.box = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
    rings.forEach((r, ri) => {
      for (let k = 0; k < r.length; k++) {
        const [ax, az] = r[k];
        const [bx, bz] = r[(k + 1) % r.length];
        const at = this.e.length / 6;
        this.e.push(ax, az, ys[ri][k], bx, bz, ys[ri][(k + 1) % r.length]);
        this.cells.add(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), at);
        this.box = { x0: Math.min(this.box.x0, ax), z0: Math.min(this.box.z0, az), x1: Math.max(this.box.x1, ax), z1: Math.max(this.box.z1, az) };
      }
    });
    this.stamp = new Int32Array(this.e.length / 6);
  }
  // Its height at (x, z) as the map gives it: its outline's edges' within 4 m of the nearest one,
  // in the cells round the point (or all of them, far inside a big piece), weighted by how near.
  raw(x: number, z: number): number {
    const e = this.e;
    const near: number[] = [];
    this.looks++;
    for (let i = cellOf(x) - 1; i <= cellOf(x) + 1; i++) {
      for (let j = cellOf(z) - 1; j <= cellOf(z) + 1; j++) {
        for (const k of this.cells.m.get(key(i, j)) ?? []) {
          if (this.stamp[k] === this.looks) continue;
          this.stamp[k] = this.looks;
          near.push(k);
        }
      }
    }
    const list = near.length ? near : Array.from({ length: e.length / 6 }, (_, k) => k);
    const ds = list.map((k) => toSegment(x, z, e[k * 6], e[k * 6 + 1], e[k * 6 + 3], e[k * 6 + 4]));
    const d0 = Math.min(...ds.map((q) => q.d));
    let sw = 0;
    let sy = 0;
    list.forEach((k, n) => {
      const { d, t } = ds[n];
      if (d > d0 + 4) return;
      const w = 1 / (d + 0.1) ** 2;
      sw += w;
      sy += w * (e[k * 6 + 2] + (e[k * 6 + 5] - e[k * 6 + 2]) * t);
    });
    return sy / sw;
  }
  // Its height at (x, z), eased to the land where it meets it, and its kerb if it's a pavement.
  height(x: number, z: number): number {
    let y = this.raw(x, z);
    let best = EASE;
    let d = 0;
    for (const j of this.joins) {
      const r = Math.hypot(j.x - x, j.z - z);
      if (r < best) {
        best = r;
        d = j.d;
      }
    }
    if (best < EASE) y += d * (1 - best / EASE);
    return y + this.raise;
  }
}

// A flat block a car can stand on, as high as it's drawn: the granite plinth at the start (city.ts),
// where free roam begins. Its sides are walls up to its top.
interface Block {
  pts: [number, number][];
  y: number;
}

// A ramp a race stands on a street (race.ts, braga-map's task 039): a slope from its foot at (fx, fz),
// up the way (ux, uz) to its lip L metres on, w wide, rising from y0 to y1. A car stands on it as on a
// block, and from beside it meets its sides.
export interface Slope {
  fx: number;
  fz: number;
  ux: number;
  uz: number;
  L: number;
  w: number;
  y0: number;
  y1: number;
}

// What a car at a point stands on.
export interface Floor {
  y: number;
  kind: 'land' | 'road' | 'pavement' | 'path' | 'steps' | 'deck' | 'tunnel' | 'block' | 'ramp';
  // How far it's over the land (or its piece's level): a kerb's height on a pavement, ramped down
  // to a dropped kerb; on a tread, its height over the land under it, which a riser lifts.
  raise: number;
  piece: Piece | null;
  // The car is under the land (and not standing on a piece in a tunnel): it has driven into it.
  buried: boolean;
}

// What the world's ground knows about each car between steps.
interface State {
  n: V;
  raise: number;
  hop: boolean; // bumped up a kerb, and still rising
}

// A deck's parapet or a tunnel's side, as a car meets it and as it's drawn: (nx, nz) is the way out
// of the piece it stands on.
export interface Side extends Wall {
  kind: 'parapet' | 'bore';
  nx: number;
  nz: number;
}

// The parts of the world's ground that don't change, shared by every ground made from them.
interface Data {
  world: Braga;
  land: Land;
  roads: Rings;
  paves: Rings;
  setts: Rings; // the carriageways on the ground paved with granite setts
  // The paths on the ground (braga-map's task 050): those on it, those flush with a pavement, a kerb
  // over it, those paved with setts, and the steps' treads.
  paths: Rings;
  raised: Rings;
  pathSetts: Rings;
  treads: Cells<Tread>;
  // What a building that stands on it is cut back at: the carriageways on the ground, and the paths
  // through passages under a building (the owner's answer to braga-map's task 050).
  cuts: Rings;
  pieces: Piece[];
  pieceCells: Cells<Piece>;
  walls: Cells<Wall>;
  posts: Cells<Post>;
  dropped: Cells<Wall>; // kerbs dropped at crossings
  kerbs: Cells<Wall>; // raised kerbs, for which way a bump goes
  lines: Cells<{ ax: number; az: number; bx: number; bz: number; ya: number; yb: number; ground: boolean }>;
  sides: Side[];
  inside: Rings; // the open world's area
  blocks: Cells<Block>;
  counts: Record<string, number>;
}

// The world as a ground: built once from braga-map's world, then given to stepCar. race() makes
// another sharing it, for a race (race.ts, braga-map's task 037): one that keeps each car's place on
// the track (idx and lat), has the race's walls and its ramp, gives a boost on its pads, and counts a
// car that has come down short of a ramp's landing as fallen.
export class WorldGround implements Ground {
  d: Data;
  track: Track | null;
  extra: Cells<Wall>;
  slopes: Slope[];
  // A race's road (braga-map's `road`): a car that comes down off it has left the race, and is lost.
  road: Rings | null;
  private state = new WeakMap<Car, State>();
  private seen: Wall[] = [];
  private seenPosts: Post[] = [];

  constructor(d: Data, track: Track | null = null, extra: Wall[] = [], slopes: Slope[] = [], road: Rings | null = null) {
    this.d = d;
    this.track = track;
    this.slopes = slopes;
    this.road = road;
    this.extra = new Cells<Wall>();
    for (const w of extra) this.extra.add(Math.min(w.ax, w.bx), Math.min(w.az, w.bz), Math.max(w.ax, w.bx), Math.max(w.az, w.bz), w);
  }

  // The same world for a race on a track, with walls and ramps only it has, and its road.
  race(track: Track, walls: Wall[] = [], slopes: Slope[] = [], road: Rings | null = null): WorldGround {
    return new WorldGround(this.d, track, walls, slopes, road);
  }

  // A car moved from `from` by something besides its own driving (bumped by another): out of any
  // wall that took it through.
  nudge(c: Car, from: V): void {
    this.walls(c, from);
  }

  land(x: number, z: number): number {
    return this.d.land.land(x, z);
  }

  // How far a pavement on the ground is over the land at (x, z): a kerb's height, sloping down to a
  // kerb dropped at a crossing.
  raise(x: number, z: number): number {
    let r = KERB;
    for (const k of this.d.dropped.at(x, z) ?? []) r = Math.min(r, KERB * Math.min(1, toSegment(x, z, k.ax, k.az, k.bx, k.bz).d / DROP));
    return r;
  }

  // The tread of a flight of steps at (x, z), if there's one.
  tread(x: number, z: number): Tread | null {
    for (const t of this.d.treads.at(x, z) ?? []) if (x >= t.box.x0 && x <= t.box.x1 && z >= t.box.z0 && z <= t.box.z1 && inRings(t.rings, x, z)) return t;
    return null;
  }

  // The ground's height at (x, z) as a car finds it: a tread's, or the land's (firm under a street
  // or a path), with a pavement's kerb.
  groundAt = (x: number, z: number): number => {
    const t = this.tread(x, z);
    if (t) return t.y;
    const d = this.d;
    if (d.roads.has(x, z) || d.paths.has(x, z)) return d.land.firm(x, z);
    if (d.paves.has(x, z) || d.raised.has(x, z)) return d.land.firm(x, z) + this.raise(x, z);
    return d.land.land(x, z);
  };

  // What a car at height y stands on at (x, z): the highest surface no more than a step over it.
  floor(x: number, z: number, y: number): Floor {
    const d = this.d;
    let kind: Floor['kind'] = 'land';
    let raise = 0;
    const t = this.tread(x, z);
    if (t) kind = 'steps';
    else if (d.roads.has(x, z)) kind = 'road';
    else if (d.paves.has(x, z)) {
      kind = 'pavement';
      raise = this.raise(x, z);
    } else if (d.raised.has(x, z)) {
      kind = 'path';
      raise = this.raise(x, z);
    } else if (d.paths.has(x, z)) kind = 'path';
    if (t) raise = t.y - d.land.firm(x, z);
    const ground = t ? t.y : (kind === 'land' ? d.land.land(x, z) : d.land.firm(x, z)) + raise;
    let best: Floor | null = ground <= y + STEP ? { y: ground, kind, raise, piece: null, buried: false } : null;
    for (const p of d.pieceCells.at(x, z) ?? []) {
      if (!p.rings.has(x, z)) continue;
      const yp = p.height(x, z);
      // A pavement on the ground that runs onto a deck's or a tunnel's road at its end (the map
      // cuts the ground's carriageways back there, not its pavements) gives way to the road.
      const under = best && !best.piece && best.kind === 'pavement' && best.y - yp <= STEP;
      if (yp > y + STEP || (best && yp <= best.y && !under)) continue;
      best = { y: yp, kind: p.level === 'bridge' ? 'deck' : 'tunnel', raise: p.raise, piece: p, buried: false };
    }
    for (const b of d.blocks.at(x, z) ?? []) {
      if (b.y > y + STEP || (best && b.y <= best.y) || !inRing(b.pts, x, z)) continue;
      best = { y: b.y, kind: 'block', raise: 0, piece: null, buried: false };
    }
    for (const s of this.slopes) {
      const along = (x - s.fx) * s.ux + (z - s.fz) * s.uz;
      if (along < 0 || along > s.L || Math.abs((z - s.fz) * s.ux - (x - s.fx) * s.uz) > s.w / 2) continue;
      const ys = s.y0 + ((s.y1 - s.y0) * along) / s.L;
      if (ys > y + STEP || (best && ys <= best.y)) continue;
      best = { y: ys, kind: 'ramp', raise: 0, piece: null, buried: false };
    }
    // Under the land, and not on a piece just under the car (in a tunnel, or a deck in a cutting).
    if (ground > y + STEP && (!best || best.y < y - 2)) return { y: ground, kind, raise, piece: null, buried: true };
    return best!;
  }

  // The floor's normal at (x, z), over about a car's length.
  normal(f: Floor, x: number, z: number): V {
    if (f.kind === 'block') return v3(0, 1, 0);
    if (f.kind === 'ramp') {
      const s = this.slopes.find((q) => Math.abs((x - q.fx) * q.ux + (z - q.fz) * q.uz - q.L / 2) <= q.L / 2 + 0.01)!;
      const k = (s.y1 - s.y0) / s.L;
      return norm(v3(-s.ux * k, 1, -s.uz * k));
    }
    const h = f.piece ? (a: number, b: number) => f.piece!.height(a, b) : f.kind === 'steps' ? this.groundAt : f.kind === 'land' ? this.d.land.land : this.d.land.firm;
    const gx = (h(x + SMOOTH, z) - h(x - SMOOTH, z)) / (2 * SMOOTH);
    const gz = (h(x, z + SMOOTH) - h(x, z - SMOOTH)) / (2 * SMOOTH);
    return norm(v3(-gx, 1, -gz));
  }

  under(c: Car): { n: V; boost: boolean } {
    let s = this.state.get(c);
    if (!s) {
      const f = this.floor(c.p.x, c.p.z, c.p.y);
      s = { n: this.normal(f, c.p.x, c.p.z), raise: f.raise, hop: false };
      this.state.set(c, s);
    }
    // In a race, its boost pads, as wide as they're drawn (road.ts).
    const q = this.track?.samples[c.idx];
    return { n: s.n, boost: !!q?.boost && Math.abs(c.lat) < q.w * 0.3 + 0.4 && c.h < 0.5 };
  }

  contact(c: Car, from: V, dt: number): boolean {
    const d = this.d;
    const was = c.grounded;
    const s = this.state.get(c) ?? { n: c.up, raise: 0, hop: false };
    this.state.set(c, s);

    const wedged = this.walls(c, from);

    // What it's on, looked for from where it was if that was higher: a car coming down lands on
    // what it has sunk into this step, however hard it came down.
    const top = Math.max(c.p.y, from.y);
    // The land in front: one the car would be in, or too steep to climb off the carriageway or a path.
    let f = this.floor(c.p.x, c.p.z, top);
    if (!f.piece && f.kind !== 'block' && f.kind !== 'ramp' && (f.buried || (f.kind !== 'road' && f.kind !== 'path' && f.kind !== 'steps'))) {
      const g = this.slope(c.p.x, c.p.z, f.kind === 'land' ? this.d.land.land : this.d.land.firm);
      const mx = c.p.x - from.x;
      const mz = c.p.z - from.z;
      const up = (mx * g.x + mz * g.z) / (Math.hypot(g.x, g.z) || 1);
      if (f.buried || (Math.hypot(g.x, g.z) > CLIMB && up > 0)) {
        const gl = Math.hypot(g.x, g.z) || 1;
        bounce(c, v3(-g.x / gl, 0, -g.z / gl), Math.max(0, up));
        f = this.floor(c.p.x, c.p.z, top);
        if (f.buried) {
          c.p = v3(from.x, c.p.y, from.z);
          f = this.floor(c.p.x, c.p.z, top);
        }
      }
    }

    if (!f.buried) {
      const n = this.normal(f, c.p.x, c.p.z);
      const h = (c.p.y - f.y) * n.y;
      // A car that hops off a kerb flies until it comes down (it would be held to the ground
      // within STICK, as everywhere else, and never leave it).
      if (s.hop && c.v.y > 0) fly(c, dt);
      else if (h <= STICK) {
        settle(c, n, h);
        s.hop = false;
        // Up a kerb: a bump, and a little of its speed across the kerb lost.
        if (was && f.raise - s.raise > 0.04) {
          this.bump(c, f.raise - s.raise);
          s.hop = true;
        }
      } else fly(c, dt);
      s.n = n;
      s.raise = f.raise;
      c.h = c.p.y - f.y;
    } else {
      fly(c, dt);
      c.h = 0;
    }

    // In a race, where it is on the track; and in a ramp's flight, a car that has come down on what's
    // under it, or dropped 3 m under the flight's line (straight from the lip to the landing), has
    // fallen short, as on the track's own ground. One that has come down off the race's road
    // (flown past a ramp's landing street, launched over a wall) has left it.
    let short = false;
    if (this.track) {
      const loc = locate(this.track, c.p, c.idx);
      c.idx = loc.i;
      c.lat = loc.lateral;
      short = (this.track.samples[loc.i].air && (loc.h < -3 || (c.grounded && loc.h < -1))) || (!!this.road && c.grounded && !this.road.has(c.p.x, c.p.z));
    }

    const b = d.world.box;
    const r = d.land.riverAt(c.p.x, c.p.z);
    const drowned = r.d < d.land.HW && c.p.y < r.y - 0.3;
    const out = c.p.x < b.x0 || c.p.x > b.x1 || c.p.z < b.z0 || c.p.z > b.z1 || c.p.y < -40;
    return f.buried || wedged || drowned || out || short;
  }

  // Which way the land h climbs at (x, z), and how steeply, over about a car's length.
  private slope(x: number, z: number, h: (x: number, z: number) => number): { x: number; z: number } {
    return { x: (h(x + SMOOTH, z) - h(x - SMOOTH, z)) / (2 * SMOOTH), z: (h(x, z + SMOOTH) - h(x, z - SMOOTH)) / (2 * SMOOTH) };
  }

  // Up a kerb dh high: the car hops, and loses a share of its speed across the kerb.
  private bump(c: Car, dh: number): void {
    let kx = Math.cos(c.yaw);
    let kz = Math.sin(c.yaw);
    let best = 2;
    for (const k of this.d.kerbs.near(c.p.x - 2, c.p.z - 2, c.p.x + 2, c.p.z + 2, this.seen)) {
      const { d } = toSegment(c.p.x, c.p.z, k.ax, k.az, k.bx, k.bz);
      if (d >= best) continue;
      best = d;
      const L = Math.hypot(k.bx - k.ax, k.bz - k.az) || 1;
      kx = -(k.bz - k.az) / L;
      kz = (k.bx - k.ax) / L;
    }
    const across = c.v.x * kx + c.v.z * kz;
    c.v.x -= kx * across * BUMP;
    c.v.z -= kz * across * BUMP;
    c.v.y += Math.min(2, Math.abs(across) * 0.25) * Math.min(1, dh / KERB);
  }

  // Pushes the car's two circles out of the walls and trunks round them, a few times over for
  // corners. Returns whether it's still in one: wedged.
  private walls(c: Car, from: V): boolean {
    const fx = Math.cos(c.yaw) * CAR_L;
    const fz = Math.sin(c.yaw) * CAR_L;
    let deep = 0;
    for (let pass = 0; pass < 4; pass++) {
      deep = 0;
      for (const side of [1, -1]) {
        const qx = c.p.x + fx * side;
        const qz = c.p.z + fz * side;
        const q0x = from.x + fx * side;
        const q0z = from.z + fz * side;
        const hit = this.deepest(qx, qz, q0x, q0z, c.p.y);
        if (!hit) continue;
        deep = Math.max(deep, hit.d);
        bounce(c, v3(hit.nx, 0, hit.nz), hit.d);
      }
      if (!deep) break;
    }
    return deep > 0.3;
  }

  // The wall or trunk the circle at (qx, qz), at (q0x, q0z) before the move, is deepest into: which
  // way out, and how far.
  private deepest(qx: number, qz: number, q0x: number, q0z: number, y: number): { nx: number; nz: number; d: number } | null {
    const x0 = Math.min(qx, q0x) - CAR_R - 0.1;
    const z0 = Math.min(qz, q0z) - CAR_R - 0.1;
    const x1 = Math.max(qx, q0x) + CAR_R + 0.1;
    const z1 = Math.max(qz, q0z) + CAR_R + 0.1;
    let best: { nx: number; nz: number; d: number } | null = null;
    for (const cells of [this.d.walls, this.extra]) {
      for (const w of cells.near(x0, z0, x1, z1, this.seen)) {
        if (y >= w.y1 || y + WALL_H <= w.y0) continue;
        const t = touch(w, qx, qz, q0x, q0z);
        if (t && (!best || t.d > best.d)) best = t;
      }
    }
    for (const p of this.d.posts.near(x0, z0, x1, z1, this.seenPosts)) {
      if (y >= p.y1 || y + WALL_H <= p.y0) continue;
      const dx = qx - p.x;
      const dz = qz - p.z;
      const r = Math.hypot(dx, dz);
      const d = CAR_R + p.r - r;
      if (d > 0 && (!best || d > best.d)) best = r > 1e-6 ? { nx: dx / r, nz: dz / r, d } : { nx: 1, nz: 0, d };
    }
    return best;
  }

  // A car put back on the nearest carriageway to (x, z) at its level (a street's middle, nearest
  // to height y), facing along the street the way nearest yaw; inside the area when there is one.
  spawn(x: number, z: number, y: number, yaw = 0): Car {
    const d = this.d;
    let best: { x: number; z: number; y: number; dir: number; score: number } | null = null;
    for (let r = 40; !best && r <= 640; r *= 2) {
      for (const l of d.lines.near(x - r, z - r, x + r, z + r, [])) {
        const { d: dist, t } = toSegment(x, z, l.ax, l.az, l.bx, l.bz);
        if (dist > r) continue;
        const px = l.ax + (l.bx - l.ax) * t;
        const pz = l.az + (l.bz - l.az) * t;
        if (!d.inside.has(px, pz)) continue;
        const py = l.ground ? this.land(px, pz) : l.ya + (l.yb - l.ya) * t;
        const score = dist + 4 * Math.abs(py - y);
        if (best && score >= best.score) continue;
        best = { x: px, z: pz, y: py, dir: Math.atan2(l.bz - l.az, l.bx - l.ax), score };
      }
    }
    if (!best) throw new Error(`no street near (${x.toFixed(0)}, ${z.toFixed(0)})`);
    const dir = Math.cos(best.dir - yaw) >= 0 ? best.dir : best.dir + Math.PI;
    return this.place(carAt(v3(best.x, best.y, best.z), dir, v3(0, 1, 0)), best.y + STEP);
  }

  // Puts a car on the floor under it, as found from height y (by default a metre over the car):
  // for a car made on the track, whose road isn't quite the world's.
  place(c: Car, y = c.p.y + 1): Car {
    const f = this.floor(c.p.x, c.p.z, y);
    c.p = v3(c.p.x, f.y + 0.01, c.p.z);
    c.up = this.normal(f, c.p.x, c.p.z);
    c.grounded = true;
    c.air = 0;
    this.state.set(c, { n: c.up, raise: f.raise, hop: false });
    return c;
  }

  // A flat block standing on the land, its top at y, outlined by pts: a car stands on its top and
  // drives off its edges, and from below its sides are walls. For whatever the game builds that the
  // map hasn't (the plinth at the start), and shared with every ground made from this one.
  stand(pts: [number, number][], y: number): void {
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    this.d.blocks.add(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), { pts, y });
    // The sides stand a step short of the top, so a car on it never meets them.
    const foot = Math.min(...pts.map(([x, z]) => this.d.land.land(x, z))) - 1;
    for (let k = 0; k < pts.length; k++) {
      const [ax, az] = pts[k];
      const [bx, bz] = pts[(k + 1) % pts.length];
      this.wall({ ax, az, bx, bz, y0: foot, y1: y - STEP });
    }
  }

  // A wall the game adds, shared as the block is.
  wall(w: Wall): void {
    this.d.walls.add(Math.min(w.ax, w.bx), Math.min(w.az, w.bz), Math.max(w.ax, w.bx), Math.max(w.az, w.bz), w);
  }

  // Takes away the walls of a building the game leaves out, to keep the ground clear round what it
  // stands there instead (the plinth, an egg, the Tourigalo): its outline as trimmed() left it, one
  // wall an edge, so a neighbour's wall on an edge they share stays. Returns how many went.
  unwall(ring: [number, number][]): number {
    const same = (x: number, z: number, u: number, v: number) => Math.abs(x - u) < 0.02 && Math.abs(z - v) < 0.02;
    let n = 0;
    for (let k = 0; k < ring.length; k++) {
      const [ax, az] = ring[k];
      const [bx, bz] = ring[(k + 1) % ring.length];
      const box = [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)] as const;
      const w = this.d.walls.near(...box, []).find((w) => (same(w.ax, w.az, ax, az) && same(w.bx, w.bz, bx, bz)) || (same(w.ax, w.az, bx, bz) && same(w.bx, w.bz, ax, az)));
      if (!w) continue;
      this.d.walls.remove(Math.min(w.ax, w.bx), Math.min(w.az, w.bz), Math.max(w.ax, w.bx), Math.max(w.az, w.bz), w);
      n++;
    }
    return n;
  }

  // What the street a car at height y is on at (x, z) is paved with: granite setts or not, for the
  // tyres' rumble. Off a carriageway or a path, null.
  surface(x: number, z: number, y: number): 'asphalt' | 'setts' | 'paving' | 'dirt' | null {
    const f = this.floor(x, z, y + 0.5);
    if (f.piece) return f.piece.surface;
    if (f.kind === 'path' || f.kind === 'steps') return this.d.pathSetts.has(x, z) ? 'setts' : 'paving';
    if (f.kind !== 'road') return null;
    return this.d.setts.has(x, z) ? 'setts' : 'asphalt';
  }

  // How much there is in it, for the tests and for the docs.
  get counts(): Record<string, number> {
    return this.d.counts;
  }
}

// Where the segment from a to b crosses the one from c to d, as how far along the first (0 to 1), or
// null where they don't cross.
function cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number | null {
  const ex = bx - ax;
  const ez = bz - az;
  const fx = dx - cx;
  const fz = dz - cz;
  const den = ex * fz - ez * fx;
  if (!den) return null;
  const t = ((cx - ax) * fz - (cz - az) * fx) / den;
  const u = ((cx - ax) * ez - (cz - az) * ex) / den;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
}

// Whether (x, z) is in the ring.
function inRing(r: [number, number][], x: number, z: number): boolean {
  let odd = false;
  for (let k = 0, j = r.length - 1; k < r.length; j = k++) {
    const [ax, az] = r[k];
    const [bx, bz] = r[j];
    if (az > z !== bz > z && x < ax + ((z - az) / (bz - az)) * (bx - ax)) odd = !odd;
  }
  return odd;
}

// Whether (x, z) is in an outline less its holes.
function inRings(rings: [number, number][][], x: number, z: number): boolean {
  let odd = false;
  for (const r of rings) if (inRing(r, x, z)) odd = !odd;
  return odd;
}

// A wall, a fence, a railing, a hedge or a gate of the map's (braga-map's task 013) on the ground a car
// drives on, every `step` metres along it at most: each point, the way along it and across it there, and its
// foot and top. A free-standing one is as high as the map says over that ground (the tiles' ground
// is a 2 m grid's, the map's top the LiDAR's over its own terrain), its foot a little under it; but
// where the map's own ground under it is more than 1.5 m off that (a planter on the edge of a
// cutting, over the road down in it), at the map's own level. A retaining wall's top is the map's,
// its foot its face's height under that, or under the ground.
export interface SpanPoint {
  x: number;
  z: number;
  ux: number;
  uz: number;
  nx: number;
  nz: number;
  y0: number;
  y1: number;
}
export function wallSpan(g: WorldGround, w: Barrier, step = 2): SpanPoint[] {
  const out: SpanPoint[] = [];
  for (let i = 1; i < w.pts.length; i++) {
    const [ax, az] = w.pts[i - 1];
    const [bx, bz] = w.pts[i];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.01) continue;
    const ux = (bx - ax) / L;
    const uz = (bz - az) / L;
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = out.length ? 1 : 0; k <= n; k++) {
      const f = k / n;
      const x = ax + (bx - ax) * f;
      const z = az + (bz - az) * f;
      const ground = g.groundAt(x, z);
      const top = w.ys[i - 1] + (w.ys[i] - w.ys[i - 1]) * f;
      const own = Math.abs(top - w.h - ground) > 1.5;
      const [y0, y1] = w.kind === 'retaining' ? [Math.min(top - w.h, ground) - 0.3, top] : own ? [top - w.h - 0.3, top] : [ground - 0.3, ground + w.h];
      out.push({ x, z, ux, uz, nx: -uz, nz: ux, y0, y1 });
    }
  }
  return out;
}
// The point s metres along a span, between its points.
export function alongSpan(span: SpanPoint[], s: number): SpanPoint {
  for (let k = 1; k < span.length; k++) {
    const a = span[k - 1];
    const b = span[k];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (s <= L || k === span.length - 1) {
      const f = L ? Math.max(0, Math.min(1, s / L)) : 0;
      return { ...b, x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, y0: a.y0 + (b.y0 - a.y0) * f, y1: a.y1 + (b.y1 - a.y1) * f };
    }
    s -= L;
  }
  return span[0];
}

// What a path off the ground is paved with, as a carriageway's surface, for the tyres' rumble.
export const pathSurface = (s: Path['surface']): 'asphalt' | 'setts' | 'paving' | 'dirt' => (s === 'setts' ? 'setts' : s === 'asphalt' ? 'asphalt' : s === 'gravel' || s === 'dirt' ? 'dirt' : 'paving');

// A footprint's outline less the carriageways it stands on, as segments [ax, az, bx, bz]: its own
// edges off them, and their edges in it (a passage's sides); and whether it stood on any.
export function trimmed(pts: [number, number][], roads: Rings): { segs: [number, number, number, number][]; cut: boolean } {
  const n = pts.length;
  const x0 = Math.min(...pts.map((p) => p[0]));
  const x1 = Math.max(...pts.map((p) => p[0]));
  const z0 = Math.min(...pts.map((p) => p[1]));
  const z1 = Math.max(...pts.map((p) => p[1]));
  // The carriageways' edges round it, each once.
  const edges: number[][] = [];
  const seen = new Set<string>();
  let any = false;
  for (let i = cellOf(x0); i <= cellOf(x1); i++) {
    for (let j = cellOf(z0); j <= cellOf(z1); j++) {
      const c = roads.cells.get(key(i, j));
      if (!c) continue;
      any ||= c.inside;
      for (let k = 0; k < c.e.length; k += 4) {
        const e = c.e.slice(k, k + 4);
        const id = e.join();
        if (seen.has(id)) continue;
        seen.add(id);
        edges.push(e);
      }
    }
  }
  const whole = pts.map(([ax, az], k) => [ax, az, pts[(k + 1) % n][0], pts[(k + 1) % n][1]] as [number, number, number, number]).filter(([ax, az, bx, bz]) => ax !== bx || az !== bz);
  if (!edges.length && !any) return { segs: whole, cut: false };
  const out: [number, number, number, number][] = [];
  // Each piece of a segment between where it crosses the others, kept where its middle says so.
  const cut = (ax: number, az: number, bx: number, bz: number, others: number[][], keep: (x: number, z: number) => boolean) => {
    const ts = [0, 1];
    for (const [cx, cz, dx, dz] of others) {
      const t = cross(ax, az, bx, bz, cx, cz, dx, dz);
      if (t !== null) ts.push(t);
    }
    ts.sort((a, b) => a - b);
    for (let k = 1; k < ts.length; k++) {
      if (ts[k] - ts[k - 1] < 1e-6) continue;
      const m = (ts[k - 1] + ts[k]) / 2;
      if (keep(ax + (bx - ax) * m, az + (bz - az) * m)) out.push([ax + (bx - ax) * ts[k - 1], az + (bz - az) * ts[k - 1], ax + (bx - ax) * ts[k], az + (bz - az) * ts[k]]);
    }
  };
  for (const [ax, az, bx, bz] of whole) cut(ax, az, bx, bz, edges, (x, z) => !roads.has(x, z));
  const onRoad = out.length;
  for (const [ax, az, bx, bz] of edges) cut(ax, az, bx, bz, whole, (x, z) => inRing(pts, x, z));
  const kept = out.slice(0, onRoad).reduce((a, [ax, az, bx, bz]) => a + Math.hypot(bx - ax, bz - az), 0);
  const all = whole.reduce((a, [ax, az, bx, bz]) => a + Math.hypot(bx - ax, bz - az), 0);
  return { segs: out, cut: out.length > onRoad || all - kept > 1e-6 };
}

// How deep the circle at (qx, qz), at (q0x, q0z) before the move, is into a wall, and which way is
// out: back the way it came if it went through it in one step.
function touch(w: Wall, qx: number, qz: number, q0x: number, q0z: number): { nx: number; nz: number; d: number } | null {
  const ex = w.bx - w.ax;
  const ez = w.bz - w.az;
  const L = Math.hypot(ex, ez);
  if (!L) return null;
  const s0 = ex * (q0z - w.az) - ez * (q0x - w.ax);
  const s1 = ex * (qz - w.az) - ez * (qx - w.ax);
  if (s0 * s1 < 0) {
    const u = s0 / (s0 - s1);
    const px = q0x + (qx - q0x) * u;
    const pz = q0z + (qz - q0z) * u;
    const t = ((px - w.ax) * ex + (pz - w.az) * ez) / (L * L);
    if (t >= 0 && t <= 1) {
      const side = Math.sign(s0);
      return { nx: (-ez / L) * side, nz: (ex / L) * side, d: CAR_R + Math.abs(s1) / L };
    }
  }
  const { d, t } = toSegment(qx, qz, w.ax, w.az, w.bx, w.bz);
  if (d >= CAR_R) return null;
  if (d < 1e-6) {
    const side = Math.sign(s0) || 1;
    return { nx: (-ez / L) * side, nz: (ex / L) * side, d: CAR_R };
  }
  return { nx: (qx - (w.ax + ex * t)) / d, nz: (qz - (w.az + ez * t)) / d, d: CAR_R - d };
}

// The world's ground, from braga-map's world (loadWorld({ open: true }) loads all it needs): its
// land, its streets and paths as surfaces, its buildings and trees, and the open world's area
// (world.open, braga-map's task 032), its edge a wall at every level and a barrier across each street
// and path leaving it.
export function worldGround(world: Braga): WorldGround {
  const land = makeLand(world, world.box);
  const H = land.land;
  const S = world.streets;
  const counts: Record<string, number> = {};
  // What stands past the area's edge can't be reached: only what's within 50 m of its box counts.
  const open = world.open;
  const ex = open.pts.map((p) => p[0]);
  const ez = open.pts.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...ex) - 50, Math.max(...ex) + 50, Math.min(...ez) - 50, Math.max(...ez) + 50];
  const near = (pts: [number, number][]) => pts.some(([x, z]) => x > x0 && x < x1 && z > z0 && z < z1);

  const roads = new Rings(S.carriageways.filter((p) => p.level === 'ground').flatMap((p) => p.rings));
  const paves = new Rings(S.pavements.filter((p) => p.level === 'ground').flatMap((p) => p.rings));
  const setts = new Rings(S.carriageways.filter((p) => p.level === 'ground' && p.surface === 'setts').flatMap((p) => p.rings));
  // The paths (braga-map's task 050): on the ground or under something at its level, and those flush
  // with a pavement; the steps' treads, each at its height; and the footbridges and the paths'
  // tunnels as the decks and the tunnels' roads are.
  const flat = S.paths.filter((p) => (p.level === 'ground' || p.level === 'under') && p.kind !== 'steps');
  const paths = new Rings(flat.filter((p) => !p.raised).flatMap((p) => p.rings));
  const raised = new Rings(flat.filter((p) => p.raised).flatMap((p) => p.rings));
  const pathSetts = new Rings(S.paths.filter((p) => (p.level === 'ground' || p.level === 'under') && p.surface === 'setts').flatMap((p) => p.rings));
  const cuts = new Rings([...S.carriageways.filter((p) => p.level === 'ground'), ...S.paths.filter((p) => p.level === 'under')].flatMap((p) => p.rings));
  const treads = new Cells<Tread>();
  const treadList: Tread[] = [];
  for (const p of S.paths) {
    if (p.kind !== 'steps' || !p.ys || p.level === 'bridge' || p.level === 'tunnel') continue;
    const xs = p.rings[0].map((q) => q[0]);
    const zs = p.rings[0].map((q) => q[1]);
    const t: Tread = { rings: p.rings, y: p.ys[0][0], box: { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) } };
    treads.add(t.box.x0, t.box.z0, t.box.x1, t.box.z1, t);
    treadList.push(t);
  }
  const pieces: Piece[] = [];
  for (const p of [...S.carriageways, ...S.pavements]) {
    if (p.level === 'ground' || !p.ys) continue;
    pieces.push(new Piece(p.level, 'surface' in p ? 0 : KERB, p.rings, p.ys, 'surface' in p ? p.surface : null));
  }
  for (const p of S.paths) {
    if ((p.level !== 'bridge' && p.level !== 'tunnel') || !p.ys) continue;
    const piece = new Piece(p.level, 0, p.rings, p.ys, pathSurface(p.surface));
    piece.path = p;
    pieces.push(piece);
  }
  const pieceCells = new Cells<Piece>();
  for (const p of pieces) pieceCells.add(p.box.x0, p.box.z0, p.box.x1, p.box.z1, p);

  const walls = new Cells<Wall>();
  const sides: Side[] = [];
  const addWall = (w: Wall, what: string) => {
    walls.add(Math.min(w.ax, w.bx), Math.min(w.az, w.bz), Math.max(w.ax, w.bx), Math.max(w.az, w.bz), w);
    counts[what] = (counts[what] ?? 0) + 1;
  };

  // The buildings, from below their lowest corner (a tunnel can pass under) to their top, each
  // trimmed at the kerb where it stands on a carriageway, and at a passage's edge where a path runs
  // under it.
  for (const b of world.buildings) {
    if (!near(b.pts)) continue;
    const top = b.y + Math.max(b.h, b.ridge);
    const { segs, cut } = trimmed(b.pts, cuts);
    if (cut) counts['buildings trimmed at the kerb'] = (counts['buildings trimmed at the kerb'] ?? 0) + 1;
    for (const [ax, az, bx, bz] of segs) addWall({ ax, az, bx, bz, y0: b.y - 2, y1: top }, 'building walls');
  }

  // The edges of the pieces off the ground: open where more street or the land at its level is
  // beside it (a kerb, the next tile's piece, a junction, a bridge's end), else a deck's parapet or
  // a tunnel's side. Looked at every 2 m along, a probe 0.4 m out.
  for (const p of pieces) {
    const e = p.e;
    for (let k = 0; k < e.length; k += 6) {
      const [ax, az, bx, bz] = [e[k], e[k + 1], e[k + 3], e[k + 4]];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const n = Math.ceil(L / 2);
      let px = -(bz - az) / L;
      let pz = (bx - ax) / L;
      const mx0 = (ax + bx) / 2;
      const mz0 = (az + bz) / 2;
      if (p.rings.has(mx0 + px * 0.05, mz0 + pz * 0.05)) {
        px = -px;
        pz = -pz;
      }
      for (let f = 0; f < n; f++) {
        const x0 = ax + ((bx - ax) * f) / n;
        const z0 = az + ((bz - az) * f) / n;
        const x1 = ax + ((bx - ax) * (f + 1)) / n;
        const z1 = az + ((bz - az) * (f + 1)) / n;
        const mx = (x0 + x1) / 2;
        const mz = (z0 + z1) / 2;
        const ye = p.raw(mx, mz) + p.raise;
        const ox = mx + px * 0.4;
        const oz = mz + pz * 0.4;
        const beside = (pieceCells.at(ox, oz) ?? []).some((q) => q !== p && q.rings.has(ox, oz) && Math.abs(q.raw(ox, oz) + q.raise - ye) <= STEP + 0.05);
        if (beside) continue;
        const street = roads.has(ox, oz) || paves.has(ox, oz) || paths.has(ox, oz) || raised.has(ox, oz);
        const yg = (street ? land.firm(ox, oz) : H(ox, oz)) + (paves.has(ox, oz) || raised.has(ox, oz) ? KERB : 0);
        if (Math.abs(yg - ye) <= GRADE) {
          p.joins.push({ x: mx, z: mz, d: yg - ye });
          counts['joins at grade'] = (counts['joins at grade'] ?? 0) + 1;
          continue;
        }
        // A tunnel's side as high as a tunnel, or as the land beside it if that's lower: never so
        // high it stands in the street over the tunnel.
        const side: Side = yg > ye ? { ax: x0, az: z0, bx: x1, bz: z1, y0: ye - 0.5, y1: Math.min(yg - STEP, ye + BORE), kind: 'bore', nx: px, nz: pz } : { ax: x0, az: z0, bx: x1, bz: z1, y0: ye - DEEP, y1: ye + PARAPET, kind: 'parapet', nx: px, nz: pz };
        addWall(side, side.kind === 'bore' ? 'tunnel sides' : 'parapets');
        sides.push(side);
      }
    }
  }

  // The tunnels' mouths: the concrete either side of the opening, THROAT deep (levels.ts draws it),
  // as high as a tunnel: a street over the tunnel can pass over its top.
  for (const m of land.openings) {
    const { open: o, half } = mouthShape(m, H);
    const top = m.y + BORE;
    const at = (b: number, a: number): [number, number] => [m.x - m.uz * b + m.ux * a, m.z + m.ux * b + m.uz * a];
    for (const [b0, b1] of [[-half, -o / 2], [o / 2, half]]) {
      const ring = [at(b0, -THROAT), at(b1, -THROAT), at(b1, 0), at(b0, 0)];
      for (let k = 0; k < 4; k++) addWall({ ax: ring[k][0], az: ring[k][1], bx: ring[(k + 1) % 4][0], bz: ring[(k + 1) % 4][1], y0: m.y - 0.4, y1: top }, 'mouth walls');
    }
  }

  // The area's edge, at every level, and the barriers across each street leaving it, kerb to kerb
  // and a metre past.
  const inside = new Rings([open.pts]);
  for (let k = 0; k < open.pts.length; k++) {
    const [ax, az] = open.pts[k];
    const [bx, bz] = open.pts[(k + 1) % open.pts.length];
    addWall({ ax, az, bx, bz, y0: -1e4, y1: 1e4 }, 'edge');
  }
  for (const g of open.gates) {
    const hw = g.w / 2 + 1;
    const cx = -Math.sin(g.heading);
    const cz = Math.cos(g.heading);
    addWall({ ax: g.x - cx * hw, az: g.z - cz * hw, bx: g.x + cx * hw, bz: g.z + cz * hw, y0: g.y - 1, y1: g.y + 1.2 }, 'barriers');
  }

  // The steps' handrails, from the treads to their top.
  for (const h of S.handrails) {
    for (let i = 1; i < h.pts.length; i++) {
      const [ax, az] = h.pts[i - 1];
      const [bx, bz] = h.pts[i];
      addWall({ ax, az, bx, bz, y0: Math.min(h.ys[i - 1], h.ys[i]) - RAIL - 0.1, y1: Math.max(h.ys[i - 1], h.ys[i]) }, 'handrails');
    }
  }

  // The trees' trunks, but those on a carriageway (the map's line for a street is often off its
  // middle, and the street wider than it is: braga-map's task 026).
  const posts = new Cells<Post>();
  for (const t of world.trees) {
    if (!near([[t.x, t.z]])) continue;
    if (roads.has(t.x, t.z)) {
      counts['trees on the road'] = (counts['trees on the road'] ?? 0) + 1;
      continue;
    }
    const y = H(t.x, t.z);
    posts.add(t.x - TRUNK, t.z - TRUNK, t.x + TRUNK, t.z + TRUNK, { x: t.x, z: t.z, r: TRUNK, y0: y - 1, y1: y + 4 });
    counts.trees = (counts.trees ?? 0) + 1;
  }

  // The kerbs: those dropped at crossings, which the pavement slopes down to, and the others, for
  // which way a bump goes; and so for a riser up a flight of steps. A riser more than a step over
  // what's in front of it is a wall a car can't climb.
  const dropped = new Cells<Wall>();
  const kerbs = new Cells<Wall>();
  for (const k of S.kerbs) {
    for (let i = 1; i < k.pts.length; i++) {
      const [ax, az] = k.pts[i - 1];
      const [bx, bz] = k.pts[i];
      const w = { ax, az, bx, bz, y0: 0, y1: 0 };
      if (k.h === 0 && k.level === 'ground') dropped.add(Math.min(ax, bx) - DROP, Math.min(az, bz) - DROP, Math.max(ax, bx) + DROP, Math.max(az, bz) + DROP, w);
      else if (k.h > 0) kerbs.add(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), w);
    }
  }
  const treadAt = (x: number, z: number) => {
    for (const t of treads.at(x, z) ?? []) if (inRings(t.rings, x, z)) return t;
    return null;
  };
  for (const t of treadList) {
    for (const r of t.rings) {
      for (let k = 0; k < r.length; k++) {
        const [ax, az] = r[k];
        const [bx, bz] = r[(k + 1) % r.length];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.05) continue;
        // Out of the tread, 5 cm from the middle of its edge.
        let nx = (bz - az) / L;
        let nz = -(bx - ax) / L;
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        if (inRings(t.rings, mx + nx * 0.05, mz + nz * 0.05)) [nx, nz] = [-nx, -nz];
        const o = treadAt(mx + nx * 0.05, mz + nz * 0.05);
        const below = o ? o.y : roads.has(mx + nx * 0.05, mz + nz * 0.05) || paths.has(mx + nx * 0.05, mz + nz * 0.05) ? land.firm(mx + nx * 0.05, mz + nz * 0.05) : null;
        if (below === null || t.y - below < 0.04) continue;
        kerbs.add(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), { ax, az, bx, bz, y0: below, y1: t.y });
        // Higher than a step: its face a wall, a step short of the tread's top, as the plinth's sides;
        // counted between two treads, and where a tread stands over a street or a path.
        const what = o ? 'risers' : 'tread edges over a street';
        counts[what] = (counts[what] ?? 0) + 1;
        if (t.y - below > STEP) addWall({ ax, az, bx, bz, y0: below - 1, y1: t.y - STEP }, `${what} over a step`);
      }
    }
  }

  // The streets' middles, for putting a car back on one: in cells of 10 m, as everything else.
  const lines = new Cells<{ ax: number; az: number; bx: number; bz: number; ya: number; yb: number; ground: boolean }>();
  for (const l of world.lines) {
    if (l.kind > 8) continue;
    const ground = l.level === 'ground' || l.level === 'under' || !l.heights;
    for (let i = 1; i < l.pts.length; i++) {
      const [ax, az] = l.pts[i - 1];
      const [bx, bz] = l.pts[i];
      lines.add(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), { ax, az, bx, bz, ya: ground ? 0 : l.heights![i - 1], yb: ground ? 0 : l.heights![i], ground });
    }
  }

  counts.pieces = pieces.length;
  counts.paths = flat.length;
  counts.treads = treadList.length;
  const g = new WorldGround({ world, land, roads, paves, setts, paths, raised, pathSetts, treads, cuts, pieces, pieceCells, walls, posts, dropped, kerbs, lines, sides, inside, blocks: new Cells<Block>(), counts });

  // The walls, fences, railings, hedges and gates (braga-map's task 013), each from under the ground
  // to its top, a gate shut whatever the map says (it's for someone on foot); one thicker than a car
  // is narrow (a hedge) along both its sides. A retaining wall stands HOLD over its top: the land under
  // it is a 2 m grid's, which ramps up to it where the wall stands straight, and would launch a kart
  // over it; and from above, it's its parapet.
  for (const w of world.walls) {
    if (!near(w.pts)) continue;
    const span = wallSpan(g, w);
    const lines = w.w >= 0.5 ? [w.w / 2, -w.w / 2] : [0];
    for (let k = 1; k < span.length; k++) {
      const a = span[k - 1];
      const b = span[k];
      for (const o of lines) addWall({ ax: a.x + a.nx * o, az: a.z + a.nz * o, bx: b.x + b.nx * o, bz: b.z + b.nz * o, y0: Math.min(a.y0, b.y0) - 0.7, y1: Math.max(a.y1, b.y1) + (w.kind === 'retaining' ? HOLD : 0) }, w.kind === 'gate' || w.kind === 'bar' ? 'gates' : w.kind === 'hedge' ? 'hedges' : w.kind === 'retaining' ? 'retaining walls' : w.kind === 'wall' ? 'walls' : 'fences and railings');
    }
  }
  return g;
}
