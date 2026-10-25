// A round's cover (the owner, 2026-10-21: "100x better, both the maps and mechanics"): what stands in
// an arena for someone on foot to hide behind, climb and fight round, as a Counter-Strike map has it.
// The arenas' streets are closed for road works (their gates are road-works barriers), so it's a
// building site's: skips, pallets of bricks and of cement, sandbag walls, concrete barriers, crates,
// site fences, a scaffold tower, portable toilets, cable reels, drums, a works van and a site office;
// and the cars DGT's LiDAR saw parked there (braga-map's `groundCover`), where they were.
//
// Placed by rule, the same every time (seeded by the arena), on a plan of the arena every 50 cm: where
// a walker stands outdoors, and what stops a look at a crouching head's height (TALL). Between every
// two places 4 m apart further apart than LONG that see each other (a look from one to the other at
// TALL over each), something goes across, the longest first: of the tall things (a skip, a hoarding,
// the van, a stack of crates), the one that shuts the most of them, a look over a dip going over what's
// lower than it; never on a door's way, a flight of steps or a gate, never leaving a gap narrower than
// LANE beside it (it stands against what's there, or clear of it), and never cutting one part of the
// arena off another, for a walker or the bots. Each gets a little round it to make an angle of it
// (sandbags, a drum, a pallet) and a step to climb it by where it's for climbing; then the open places
// left most exposed get a cluster of their own. Then TUNE's hand-placed extras and places kept clear,
// from looking at each arena from above.
//
// Pure, so the tests play on it. The ground takes the boxes (ground.ts's `addSolids`); render/props.ts
// draws them.
import type { World as Braga } from 'braga-map';
import { corners, onSolid, type Rings, type Solid, type WorldGround } from './ground.ts';

export type PropKind = 'car' | 'van' | 'office' | 'skip' | 'bricks' | 'bags' | 'sandbags' | 'jersey' | 'crate' | 'box' | 'fence' | 'hoarding' | 'scaffold' | 'toilet' | 'reel' | 'drum';

// One thing standing in the round: its foot's middle at (x, y, z), L long the way yaw points (a car's
// and the van's front), W wide and H high; the boxes the ground takes for it; and a number from 0 to 1
// for its colour (a car's paint), so every browser draws it alike.
export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  L: number;
  W: number;
  H: number;
  solids: Solid[];
  tint: number;
  // The ground's height under it: its foot's, or under the one it stands on.
  base: number;
}

// A car DGT's LiDAR saw parked (braga-map's GroundCover.cars): its middle, the angle of its length
// (from x towards z, 0 to π: which way it faces isn't known), its length and width, and where it is (0
// a drive or a yard, 1 along a street, 2 in a car park).
export interface Parked {
  x: number;
  z: number;
  a: number;
  L: number;
  W: number;
  where: number;
}

// Each kind's size (length, width, height, m) and what it's made of, as one's commonly found on a
// Portuguese building site: a 6 m³ skip, a pallet of 1.2 × 1.0 m, a new-jersey barrier, the site's
// mesh fence panel on its feet and a hoarding's plywood one, a portable toilet, a cable drum on its rim,
// a 200 l drum.
export const SIZE: Record<PropKind, { L: number; W: number; H: number; mat: Solid['mat'] }> = {
  car: { L: 4.2, W: 1.8, H: 1.5, mat: 'car' },
  van: { L: 5.0, W: 2.0, H: 2.1, mat: 'car' },
  office: { L: 6.0, W: 2.4, H: 2.6, mat: 'metal' },
  skip: { L: 3.6, W: 1.8, H: 1.5, mat: 'metal' },
  bricks: { L: 1.2, W: 1.0, H: 1.0, mat: 'concrete' },
  bags: { L: 1.2, W: 1.0, H: 0.8, mat: 'sand' },
  sandbags: { L: 2.4, W: 0.7, H: 0.9, mat: 'sand' },
  jersey: { L: 2.0, W: 0.6, H: 0.8, mat: 'concrete' },
  crate: { L: 1.0, W: 1.0, H: 1.0, mat: 'wood' },
  box: { L: 0.5, W: 0.5, H: 0.5, mat: 'wood' },
  fence: { L: 3.5, W: 0.12, H: 2.0, mat: 'metal' },
  hoarding: { L: 2.4, W: 0.12, H: 2.0, mat: 'wood' },
  scaffold: { L: 2.5, W: 1.3, H: 1.9, mat: 'wood' },
  toilet: { L: 1.2, W: 1.2, H: 2.3, mat: 'plastic' },
  reel: { L: 1.0, W: 0.6, H: 1.0, mat: 'wood' },
  drum: { L: 0.6, W: 0.6, H: 0.9, mat: 'metal' },
};

// The plan's cell; the furthest a look may run unbroken; the height over the ground a look is taken
// at (a crouching head, a standing chest), and so how tall a thing has to be to break one; the
// narrowest gap left beside a thing; how far a thing keeps from a door's way, a gate and a flight.
const R = 0.5;
export const LONG = 32;
const TALL = 1.4;
export const LANE = 1.5;
const DOOR = 2.4;
const GATE = 2.5;
const STEPS = 1.2;
// Under a thing's foot, as far as its boxes go down: the ground under it may fall away a little.
const FOOT = 0.4;
// How much an arena takes at most besides its parked cars: the tall things across the looks, and
// everything, some kept for what goes round them.
const ANCHORS = 30;
const MOST = 46;

// The parked cars on the arenas' tiles (braga-map's GroundCover.cars), read once: a file a tile, in
// the browser fetched as the game's bundler serves it, under node read from the package.
export async function loadParked(world: Braga): Promise<Parked[]> {
  const tiles = new Set<string>();
  for (const a of world.arenas) {
    const xs = a.pts.map((p) => p[0]);
    const zs = a.pts.map((p) => p[1]);
    for (const x of [Math.min(...xs), Math.max(...xs)]) for (const z of [Math.min(...zs), Math.max(...zs)]) tiles.add(world.tileAt(x, z));
  }
  const out: Parked[] = [];
  for (const gc of world.groundCover) {
    if (!tiles.has(gc.tile) || !gc.cars.n) continue;
    const nums = (await readJson(gc.cars.url)) as number[];
    for (let k = 0; k + 5 < nums.length; k += 6) {
      const [x, z, a, L, W, where] = nums.slice(k, k + 6);
      if (world.arenas.some((q) => world.inArena(q.id, x, z))) out.push({ x, z, a, L, W, where });
    }
  }
  return out;
}

async function readJson(url: string): Promise<unknown> {
  if (url.startsWith('file:')) {
    // Under node (the tests): the bundler never sees this, as only node has file URLs.
    const fs = 'node:fs/promises';
    const { readFile } = (await import(/* @vite-ignore */ fs)) as { readFile: (u: URL, e: string) => Promise<string> };
    return JSON.parse(await readFile(new URL(url), 'utf8'));
  }
  return (await fetch(url)).json();
}

// A seeded generator (mulberry32), from a word: the same props every time in an arena.
export function seeded(word: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619);
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A thing of a kind standing at (x, z) on the floor at y, turned yaw: its boxes. A car is its body and
// its cabin over it, set back; the van its load space and its bonnet, lower; anything else one box.
// One standing on another (on the ground at `base`, under y) goes down no further than its top.
export function prop(kind: PropKind, x: number, z: number, y: number, yaw: number, tint = 0, L = SIZE[kind].L, W = SIZE[kind].W, base = y): Prop {
  const foot = base < y - 0.01 ? 0 : FOOT;
  const { H, mat } = SIZE[kind];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const box = (u: number, l: number, w: number, y0: number, y1: number, see = false): Solid => ({ x: x + c * u, z: z + s * u, yaw, L: l, W: w, y0, y1, mat, ...(see ? { see } : {}) });
  let solids: Solid[];
  if (kind === 'car') solids = [box(0, L, W, y - foot, y + 0.95), box(-0.06 * L, 0.5 * L, W - 0.16, y + 0.95, y + H)];
  else if (kind === 'van') solids = [box(-0.5, L - 1, W, y - foot, y + H), box((L - 1) / 2, 1, W, y - foot, y + 1.05)];
  else solids = [box(0, L, W, y - foot, y + H, kind === 'fence')];
  return { kind, x, y, z, yaw, L, W, H, solids, tint, base };
}

// The plan of an arena, every R: where a walker's middle stands outdoors (and the floor's height
// there), what a look at TALL over the ground stops at, which cells are outside it, a room's, or a
// flight's; and the cells the walkers reach from the middle of the arena, joined across its open
// ground.
class Plan {
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  ok: Uint8Array;
  y: Float32Array;
  see: Uint8Array;
  out: Uint8Array;
  room: Uint8Array;
  steps: Uint8Array;
  reach: Uint8Array;
  reached = 0;
  private stack: Int32Array;

  constructor(g: WorldGround, inside: (x: number, z: number) => boolean, box: { x0: number; z0: number; x1: number; z1: number }, built: Rings) {
    this.x0 = box.x0;
    this.z0 = box.z0;
    this.nx = Math.ceil((box.x1 - box.x0) / R);
    this.nz = Math.ceil((box.z1 - box.z0) / R);
    const n = this.nx * this.nz;
    this.ok = new Uint8Array(n);
    this.y = new Float32Array(n);
    this.see = new Uint8Array(n);
    this.out = new Uint8Array(n);
    this.room = new Uint8Array(n);
    this.steps = new Uint8Array(n);
    this.reach = new Uint8Array(n);
    this.stack = new Int32Array(n);
    const d = g.d;
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const c = j * this.nx + i;
        const x = this.x0 + (i + 0.5) * R;
        const z = this.z0 + (j + 0.5) * R;
        if (!inside(x, z)) {
          this.out[c] = 1;
          if (built.has(x, z) && !d.cuts.has(x, z)) this.see[c] = 1;
          continue;
        }
        // A room's walls stop a look (with its windows and doors open), not its floor.
        if (g.roomAt(x, z)) {
          this.room[c] = 1;
          continue;
        }
        if (built.has(x, z) && !d.cuts.has(x, z)) {
          this.see[c] = 1;
          continue;
        }
        const f = g.floor(x, z, g.groundAt(x, z) + 0.5);
        this.y[c] = f.y;
        if (f.kind === 'steps') this.steps[c] = 1;
        const r = d.land.riverAt(x, z);
        if (f.buried || (r.d < d.land.HW && f.y < r.y - 0.3) || g.circle(x, z, x, z, f.y, 0.3, 1.75, true)) continue;
        this.ok[c] = 1;
      }
    }
    // The walls a look at TALL stops at: any but a fence's mesh, a railing's bars and the area's edge,
    // standing over that and from under it (not a lintel over a window); not a retaining wall, which a
    // look from its top goes over.
    const seen = new Set<object>();
    for (const cells of [d.walls, g.extra]) {
      for (const w of cells.near(box.x0, box.z0, box.x1, box.z1, [])) {
        if (seen.has(w)) continue;
        seen.add(w);
        if (w.open || (w.kind && SEE_THROUGH.has(w.kind))) continue;
        const L = Math.hypot(w.bx - w.ax, w.bz - w.az);
        const k = Math.max(1, Math.ceil(L / (R / 2)));
        for (let q = 0; q <= k; q++) {
          const x = w.ax + ((w.bx - w.ax) * q) / k;
          const z = w.az + ((w.bz - w.az) * q) / k;
          const c = this.cell(x, z);
          if (c < 0) continue;
          const gy = this.ok[c] ? this.y[c] : g.groundAt(x, z);
          const top = w.y1 - (w.rail ?? 0);
          if (w.kind !== 'retaining' && top > gy + TALL && w.y0 < gy + TALL) this.see[c] = 1;
        }
      }
    }
  }

  cell(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / R);
    const j = Math.floor((z - this.z0) / R);
    return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i;
  }

  // The cells the walkers reach from c, outdoors, from each to the next of the four beside it at much
  // its height, without those in `not`; how many.
  flood(c: number, not: Set<number> | null = null, mark: Uint8Array = this.reach, ok: Uint8Array = this.ok): number {
    mark.fill(0);
    if (c < 0 || !ok[c] || not?.has(c)) return 0;
    const { y, nx, nz, stack } = this;
    let top = 0;
    let n = 1;
    stack[top++] = c;
    mark[c] = 1;
    while (top) {
      const p = stack[--top];
      const i = p % nx;
      const j = (p - i) / nx;
      for (let k = 0; k < 4; k++) {
        const ii = i + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const jj = j + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const q = jj * nx + ii;
        if (mark[q] || !ok[q] || Math.abs(y[q] - y[p]) > 0.5 || not?.has(q)) continue;
        mark[q] = 1;
        stack[top++] = q;
        n++;
      }
    }
    return n;
  }

  // The cells a thing's boxes stand on, grown by m, and those of them a look at TALL stops at.
  under(p: Prop, m: number): { foot: Set<number>; tall: Set<number> } {
    const foot = new Set<number>();
    const tall = new Set<number>();
    for (const s of p.solids) {
      const cs = corners(s, m);
      const xs = cs.map((q) => q[0]);
      const zs = cs.map((q) => q[1]);
      for (let x = Math.min(...xs); x <= Math.max(...xs) + R; x += R) {
        for (let z = Math.min(...zs); z <= Math.max(...zs) + R; z += R) {
          const c = this.cell(x, z);
          if (c < 0) continue;
          const cx = this.x0 + ((c % this.nx) + 0.5) * R;
          const cz = this.z0 + (Math.floor(c / this.nx) + 0.5) * R;
          if (onSolid(s, cx, cz, m)) foot.add(c);
          if (!s.see && s.y1 - p.base >= TALL + 0.05 && onSolid(s, cx, cz, 0.1)) tall.add(c);
        }
      }
    }
    return { foot, tall };
  }
}

const SEE_THROUGH = new Set(['fence', 'railing', 'gate', 'bar', 'guard_rail']);

// The 16 ways a look is taken.
const WAYS = Array.from({ length: 16 }, (_, k) => [Math.cos((k * Math.PI) / 8), Math.sin((k * Math.PI) / 8)] as const);

// The looks over the plan: between every two places 4 m apart where a walker stands outdoors that the
// middle reaches, further apart than LONG, those that see each other at TALL over the ground (the
// buildings, the walls and the tall cover between them, but not a retaining wall: a look from its top
// goes over it): from (x, z) the way (dx, dz), L long, and whether it's still open.
class Looks {
  x: number[] = [];
  z: number[] = [];
  dx: number[] = [];
  dz: number[] = [];
  L: number[] = [];
  // Its height (TALL over the floor) where it starts, and how much it climbs a metre.
  y: number[] = [];
  dy: number[] = [];
  open: Uint8Array;
  private cells = new Map<number, number[]>();
  private mark: Uint32Array;
  private stamp = 0;
  constructor(P: Plan, see: Uint8Array) {
    const xs: number[] = [];
    const zs: number[] = [];
    const ys: number[] = [];
    for (let j = 4; j < P.nz; j += 8) {
      for (let i = 4; i < P.nx; i += 8) {
        if (!P.reach[j * P.nx + i]) continue;
        xs.push(P.x0 + (i + 0.5) * R);
        zs.push(P.z0 + (j + 0.5) * R);
        ys.push(P.y[j * P.nx + i] + TALL);
      }
    }
    for (let a = 0; a < xs.length; a++) {
      for (let b = a + 1; b < xs.length; b++) {
        const L = Math.hypot(xs[b] - xs[a], zs[b] - zs[a]);
        if (L <= LONG) continue;
        const dx = (xs[b] - xs[a]) / L;
        const dz = (zs[b] - zs[a]) / L;
        if (!sees(P, see, xs[a], zs[a], dx, dz, L)) continue;
        this.x.push(xs[a]);
        this.z.push(zs[a]);
        this.dx.push(dx);
        this.dz.push(dz);
        this.L.push(L);
        this.y.push(ys[a]);
        this.dy.push((ys[b] - ys[a]) / L);
      }
    }
    this.open = new Uint8Array(this.L.length).fill(1);
    this.mark = new Uint32Array(this.L.length);
    // Each in cells of CELL m along it, to find those near a place quickly.
    for (let k = 0; k < this.L.length; k++) {
      let last = -1;
      for (let t = 0; t <= this.L[k]; t += CELL / 2) {
        const c = cellKey(this.x[k] + this.dx[k] * t, this.z[k] + this.dz[k] * t);
        if (c === last) continue;
        last = c;
        const l = this.cells.get(c);
        if (l) {
          if (l[l.length - 1] !== k) l.push(k);
        } else this.cells.set(c, [k]);
      }
    }
  }

  longest(): number {
    let m = 0;
    for (let k = 0; k < this.L.length; k++) if (this.open[k]) m = Math.max(m, this.L[k]);
    return m;
  }

  // The looks still open, the longest first.
  long(): number[] {
    const out: number[] = [];
    for (let k = 0; k < this.L.length; k++) if (this.open[k]) out.push(k);
    return out.sort((a, b) => this.L[b] - this.L[a]);
  }

  // The open looks that pass within about r of (x, z), each once.
  near(x: number, z: number, r: number): number[] {
    const out: number[] = [];
    const s = ++this.stamp;
    const i0 = Math.floor((x - r) / CELL) - 1;
    const i1 = Math.floor((x + r) / CELL) + 1;
    const j0 = Math.floor((z - r) / CELL) - 1;
    const j1 = Math.floor((z + r) / CELL) + 1;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        for (const k of this.cells.get(key(i, j)) ?? []) {
          if (this.mark[k] === s || !this.open[k]) continue;
          this.mark[k] = s;
          out.push(k);
        }
      }
    }
    return out;
  }

  // How much some things' tall boxes would shut of the looks given: each the more the longer it is.
  gain(ps: Prop[], list: readonly number[]): number {
    const boxes = ps.flatMap((p) => p.solids.filter((s) => !s.see && s.y1 - p.base >= 1));
    if (!boxes.length) return 0;
    let g = 0;
    for (const k of list) {
      for (const s of boxes) {
        if (this.across(k, s)) {
          g += this.L[k] - LONG;
          break;
        }
      }
    }
    return g;
  }

  // Each look a thing stands across, shut.
  cut(p: Prop): void {
    const boxes = p.solids.filter((s) => !s.see && s.y1 - p.base >= 1);
    for (const k of this.near(p.x, p.z, Math.hypot(p.L, p.W))) for (const s of boxes) if (this.across(k, s)) this.open[k] = 0;
  }

  // Whether a look goes into a box (seen from above), under its top: a look from high ground to high
  // ground across a dip goes over a car.
  across(k: number, s: Solid): boolean {
    const L = this.L[k];
    const t = entry(this.x[k], this.z[k], this.dx[k], this.dz[k], L, s);
    if (t >= L) return false;
    const y = this.y[k] + this.dy[k] * t;
    return y < s.y1 && y > s.y0;
  }
}

// Whether a look from (x, z) the way (dx, dz) runs L over the plan: across the arena's edge (but not a
// building past it), never into a room.
function sees(P: Plan, see: Uint8Array, x: number, z: number, dx: number, dz: number, L: number): boolean {
  const step = R * 0.7;
  for (let t = step; t < L; t += step) {
    const c = P.cell(x + dx * t, z + dz * t);
    if (c >= 0 && (see[c] || P.room[c])) return false;
  }
  return true;
}

// The cells the long looks are kept in.
const CELL = 4;
const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
const cellKey = (x: number, z: number) => key(Math.floor(x / CELL), Math.floor(z / CELL));

// How far a look from (x, z) the way (dx, dz) runs over the plan, up to max; outdoors, only as far as a
// room (a look through two windows across one is the rooms' to make, not the street's).
function run(P: Plan, x: number, z: number, dx: number, dz: number, max: number, outdoors = false): number {
  const step = R * 0.7;
  for (let t = step; t < max; t += step) {
    const c = P.cell(x + dx * t, z + dz * t);
    if (c < 0 || P.out[c] || P.see[c] || (outdoors && P.room[c])) return t;
  }
  return max;
}

// Where the line from (x, z) the way (dx, dz), L long, first goes into a box seen from above; L if it
// doesn't.
function entry(x: number, z: number, dx: number, dz: number, L: number, b: { x: number; z: number; yaw: number; L: number; W: number }): number {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const px = x - b.x;
  const pz = z - b.z;
  // A quick look at the circle round it first.
  const rr = (b.L * b.L + b.W * b.W) / 4;
  const along = -(px * dx + pz * dz);
  const near = px * px + pz * pz - along * along;
  if (near > rr || along < -Math.sqrt(rr) || along > L + Math.sqrt(rr)) return L;
  const ou = px * c + pz * s;
  const ov = pz * c - px * s;
  const du = dx * c + dz * s;
  const dv = dz * c - dx * s;
  let t0 = 0;
  let t1 = L;
  // Along its length, then across it.
  for (let k = 0; k < 2; k++) {
    const o = k ? ov : ou;
    const d = k ? dv : du;
    const h = k ? b.W / 2 : b.L / 2;
    if (Math.abs(d) < 1e-12) {
      if (o < -h || o > h) return L;
      continue;
    }
    const a = (-h - o) / d;
    const e = (h - o) / d;
    t0 = Math.max(t0, Math.min(a, e));
    t1 = Math.min(t1, Math.max(a, e));
    if (t0 > t1) return L;
  }
  return t0;
}

// Whether two boxes seen from above overlap, each grown by m (separating axes).
function overlap(a: { x: number; z: number; yaw: number; L: number; W: number }, b: { x: number; z: number; yaw: number; L: number; W: number }, m = 0): boolean {
  if (Math.hypot(a.x - b.x, a.z - b.z) > Math.hypot(a.L, a.W) / 2 + Math.hypot(b.L, b.W) / 2 + 2 * m) return false;
  const pa = corners(a, m);
  const pb = corners(b, m);
  for (const yaw of [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2]) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const ra = pa.map(([x, z]) => x * c + z * s);
    const rb = pb.map(([x, z]) => x * c + z * s);
    if (Math.max(...ra) < Math.min(...rb) || Math.max(...rb) < Math.min(...ra)) return false;
  }
  return true;
}

// What the arena keeps clear of things: a door's way (outside it), its gates, and its flights of steps.
interface Keep {
  doors: { x: number; z: number }[];
  gates: { x: number; z: number; r: number }[];
}

// The things standing in an arena, and the longest look before and after them (on the plan).
export interface Cover {
  props: Prop[];
  before: number;
  after: number;
  // The looks still longer than LONG, as segments, for looking at.
  long: [number, number, number, number][];
  // How sheltered a place is (for the spawns): a look from it at TALL 16 ways over the plan, as the
  // cover leaves it; how many are stopped within `far` m, and the way that runs furthest.
  shelter: (x: number, z: number, far: number) => Shelter;
}

// What one arena gets by hand, after looking at it from above (TUNE): things to add, as [kind, x, z,
// yaw in degrees], each standing on what's under it; and places to clear, [x, z, r], of any thing whose
// middle is within r.
interface Tune {
  add?: [PropKind, number, number, number][];
  drop?: [number, number, number][];
}
const TUNE: Record<string, Tune> = {
  // The Topo do Fujacal is a ring of street round a block of flats, much of it wide open: a site office
  // across its north side, hoardings and a portable toilet in the lanes the rule leaves, a scaffold
  // tower on its south pavement.
  topo: {
    add: [
      ['office', 147, 800, 90],
      ['hoarding', 162, 795.9, 90],
      ['toilet', 122, 841, 0],
      ['hoarding', 125.5, 856, 0],
      ['hoarding', 158, 861, 90],
      ['scaffold', 128, 874, 0],
      ['toilet', 168, 827.25, 0],
    ],
  },
};

// The anchors: tall things that break a look, each with its helpers (on top, beside); how many an
// arena takes at most of each.
type Anchor = 'skip' | 'van' | 'office' | 'scaffold' | 'toilets' | 'stack' | 'pallets' | 'hoarding';
const QUOTA: Record<Anchor, number> = { skip: 6, van: 2, office: 2, scaffold: 2, toilets: 2, stack: 5, pallets: 4, hoarding: 10 };

// The cover of the arena `id` on its round's ground g (its walls and edge, the cars put in as they're
// found): the cars parked in it, then the things placed, all added to g as they're placed, so each
// next one meets them. With `place` false, nothing but the cars given: the arena as the map has it.
export function cover(g: WorldGround, id: string, inside: (x: number, z: number) => boolean, box: { x0: number; z0: number; x1: number; z1: number }, built: Rings, gates: readonly { x: number; z: number; w: number }[], parked: readonly Parked[], place = true): Cover {
  const rand = seeded(`cover:${id}`);
  const P = new Plan(g, inside, box, built);
  const keep: Keep = { doors: [], gates: gates.map((q) => ({ x: q.x, z: q.z, r: q.w / 2 + GATE })) };
  for (const r of g.d.rooms) for (const [o] of r.doors) if (inside(o.x, o.z)) keep.doors.push({ x: o.x, z: o.z });
  // The walkers' part of the arena: the most of it joined to a cell near its middle.
  let seed = -1;
  let best = 0;
  const cx = (box.x0 + box.x1) / 2;
  const cz = (box.z0 + box.z1) / 2;
  const done = new Uint8Array(P.ok.length);
  const mark = new Uint8Array(P.ok.length);
  const order = [...P.ok.keys()].filter((c) => P.ok[c]).sort((a, b) => dist(P, a, cx, cz) - dist(P, b, cx, cz));
  for (const c of order.slice(0, 400)) {
    if (done[c]) continue;
    const n = P.flood(c, null, mark);
    for (let q = 0; q < mark.length; q++) done[q] |= mark[q];
    if (n > best) {
      best = n;
      seed = c;
    }
    if (n > order.length / 2) break;
  }
  P.reached = P.flood(seed);
  // Where the walkers reached before anything was put in, and where they stood: what a thing's foot
  // goes on (the cover itself is overlap()'s to keep apart).
  const reach0 = P.reach.slice();
  const ok0 = P.ok.slice();
  const see0 = P.see.slice();
  const props: Prop[] = [];

  // Whether a thing can stand where it is: on open ground the walkers reach (its every cell), flat
  // enough, clear of a door's way, a gate and a flight of steps, overlapping nothing; and (unless it's a
  // car, parked as it was) leaving no gap narrower than LANE beside it, and cutting nothing off.
  const tune = TUNE[id] ?? {};
  const fits = (p: Prop, real = false): boolean => {
    if ((tune.drop ?? []).some(([x, z, r]) => Math.hypot(p.x - x, p.z - z) < r)) return false;
    const { foot } = P.under(p, 0);
    let lo = Infinity;
    let hi = -Infinity;
    let reached = 0;
    for (const c of foot) {
      if (!ok0[c] && !nearOk(ok0, P, c)) return false;
      if (reach0[c]) reached++;
      if (P.out[c] || P.room[c] || see0[c] || P.steps[c]) return false;
      if (ok0[c]) {
        lo = Math.min(lo, P.y[c]);
        hi = Math.max(hi, P.y[c]);
      }
    }
    if (hi - lo > (real ? 0.6 : 0.4) || reached < foot.size / 3) return false;
    for (const s of p.solids) {
      // A thin thing (a panel) may have no cell's middle under it: its corners and middle, then.
      for (const [x, z] of [...corners(s), [s.x, s.z]]) {
        const c = P.cell(x, z);
        if (c < 0 || P.out[c] || P.room[c] || see0[c] || P.steps[c] || g.roomAt(x, z)) return false;
      }
      for (const d of keep.doors) if (onSolid(s, d.x, d.z, DOOR)) return false;
      for (const q of keep.gates) if (onSolid(s, q.x, q.z, q.r)) return false;
      for (const [x, z] of corners(s, STEPS)) if (g.tread(x, z)) return false;
      if (g.tread(s.x, s.z)) return false;
      // The walls, the trees and the edge: none through it.
      for (const [x, z] of corners(s, -0.05)) if (!inside(x, z)) return false;
      if (crossed(g, s)) return false;
    }
    for (const q of props) for (const s of q.solids) for (const t of p.solids) if (s.y0 < t.y1 && t.y0 < s.y1 && overlap(s, t, 0.02)) return false;
    if (!real && !lanes(g, P, p, inside)) return false;
    return joined([p]);
  };
  // Whether the walkers still reach as much as before, but where some things stand: counted where a
  // walker has room round it (the cell and the four beside it open, about LANE wide), as the bots'
  // ways need more room than a walker squeezing through.
  const wide = new Uint8Array(P.ok.length);
  const wideMark = new Uint8Array(P.ok.length);
  let wideSeed = -1;
  let wideReached = 0;
  const widen = () => {
    const { ok, nx } = P;
    for (let c = 0; c < ok.length; c++) wide[c] = ok[c] && ok[c - 1] && ok[c + 1] && ok[c - nx] && ok[c + nx] ? 1 : 0;
    if (!wide[wideSeed]) {
      wideSeed = -1;
      let best = Infinity;
      for (let c = 0; c < wide.length; c++) if (wide[c] && P.reach[c] && dist(P, c, cx, cz) < best) [best, wideSeed] = [dist(P, c, cx, cz), c];
    }
    wideReached = P.flood(wideSeed, null, wideMark, wide);
  };
  const joined = (ps: Prop[]): boolean => {
    const grown = new Set<number>();
    for (const p of ps) for (const c of P.under(p, 0.3).foot) grown.add(c);
    if (grown.has(seed) || grown.has(wideSeed)) return false;
    let gone = 0;
    for (const c of grown) if (P.reach[c]) gone++;
    const was = P.reach.slice();
    const n = P.flood(seed, grown);
    P.reach.set(was);
    if (P.reached - gone - n > 6) return false;
    gone = 0;
    for (const c of grown) if (wideMark[c]) gone++;
    const before = wideMark.slice();
    const w = P.flood(wideSeed, grown, wideMark, wide);
    wideMark.set(before);
    return wideReached - gone - w <= 6;
  };
  widen();
  // A thing put in: in g, the plan, the list, and the looks it shuts.
  let looks: Looks | null = null;
  const put = (p: Prop) => {
    props.push(p);
    looks?.cut(p);
    g.addSolids(p.solids);
    const { foot, tall } = P.under(p, 0.3);
    for (const c of foot) P.ok[c] = 0;
    for (const c of tall) P.see[c] = 1;
    // The cell the reach is counted from, if it's been covered: another the walkers reached.
    if (!P.ok[seed]) seed = P.reach.findIndex((v, c) => v > 0 && P.ok[c] > 0);
    P.reached = P.flood(seed);
    widen();
  };
  // A thing of a kind on the floor at (x, z), or null where there's none.
  const at = (kind: PropKind, x: number, z: number, yaw: number, tint = rand(), on = 0, L?: number, W?: number): Prop | null => {
    const c = P.cell(x, z);
    if (c < 0 || P.out[c]) return null;
    const y = ok0[c] ? P.y[c] : g.floor(x, z, g.groundAt(x, z) + 0.5).y;
    return prop(kind, x, z, on || y, yaw, tint, L, W, y);
  };

  // The parked cars, as DGT's LiDAR saw them: a car's size (the laser's are a part of one, or two
  // together), turned which way the dice say; none in a building, across a wall or a hedge (a low wall
  // along a building's front can come out as a row of cars), on a footway or a flight of steps, nor
  // over another.
  for (const c of parked) {
    if (!inside(c.x, c.z)) continue;
    if (c.W < 1.2 || c.L < 2.4 || c.L > 6.5) continue;
    const L = Math.min(4.6, Math.max(3.9, c.L));
    const W = Math.min(1.85, Math.max(1.72, c.W));
    const flip = rand() < 0.5 ? 0 : Math.PI;
    const p = at('car', c.x, c.z, c.a + flip, rand(), 0, L, W);
    if (!p) continue;
    const f = g.floor(c.x, c.z, g.groundAt(c.x, c.z) + 0.5);
    if (f.kind === 'path' || f.kind === 'steps') continue;
    if (fits(p, true)) put(p);
  }

  const cars = props.length;
  // The looks, and the tall things across the longest.
  // On the plan as the map has it, then each car's cabin shutting those it stands across, exactly:
  // the plan's cells would shut a look that goes past one.
  looks = new Looks(P, see0);
  for (const p of props) looks.cut(p);
  const before = looks.longest();
  const quota = { ...QUOTA };
  const deck: Anchor[] = shuffle(['skip', 'skip', 'skip', 'skip', 'stack', 'stack', 'stack', 'stack', 'pallets', 'pallets', 'pallets', 'toilets', 'toilets', 'van', 'office', 'scaffold', 'scaffold', 'hoarding', 'hoarding', 'hoarding', 'hoarding'], rand);
  const anchors: Prop[][] = [];
  // The looks nothing fitted across (a lawn behind a hedge, a yard): left as they are.
  const failed = new Set<number>();
  for (let round = 0; place && anchors.length < ANCHORS && round < ANCHORS * 3 && props.length - cars < MOST - 10; round++) {
    const long = looks.long();
    const open = long.filter((k) => !failed.has(k));
    if (!open.length) break;
    // Candidates along the longest looks, near their middles, square across them or along them, of
    // the next few kinds in the deck there's still room for.
    const kinds = deck.filter((k) => quota[k] > 0).slice(0, 3);
    if (!kinds.length) break;
    const cands: { ps: Prop[]; score: number }[] = [];
    const taken: number[] = [];
    for (const k of open) {
      if (taken.length >= 4) break;
      if (taken.some((q) => Math.hypot(looks.x[q] - looks.x[k], looks.z[q] - looks.z[k]) < 6 && looks.dx[q] * looks.dx[k] + looks.dz[q] * looks.dz[k] > 0.9)) continue;
      taken.push(k);
      const L = looks.L[k];
      const dx = looks.dx[k];
      const dz = looks.dz[k];
      for (const f of [0.25, 0.5, 0.75]) {
        for (const side of [0, -1.5, 1.5, -3, 3]) {
          const x = looks.x[k] + dx * L * f - dz * side;
          const z = looks.z[k] + dz * L * f + dx * side;
          // Spread out: not right by another anchor.
          const by = anchors.some((a) => Math.hypot(a[0].x - x, a[0].z - z) < 8);
          const here = looks.near(x, z, 4);
          for (const kind of kinds) {
            for (const turn of [Math.PI / 2, 0]) {
              const ps = anchor(kind, x, z, Math.atan2(dz, dx) + turn, at);
              if (!ps) continue;
              const gain = looks.gain(ps, here);
              if (gain <= 0) continue;
              // What shuts the longest look still open counts double: the longest are what the arena is
              // remembered by.
              const top = ps.some((p) => p.solids.some((s) => !s.see && looks.across(open[0], s)));
              cands.push({ ps, score: gain * (top ? 2 : 1) * (by ? 0.35 : 1) * (0.85 + 0.3 * rand()) });
            }
          }
        }
      }
    }
    cands.sort((a, b) => b.score - a.score);
    let placed: Prop[] | null = null;
    for (const c of cands.slice(0, 60)) {
      if (!c.ps.every((p, i) => (i === 0 ? fits(p) : fitsOn(p, fits))) || (c.ps.length > 1 && !joined(c.ps))) continue;
      placed = c.ps;
      break;
    }
    if (!placed) {
      for (const k of taken) failed.add(k);
      continue;
    }
    for (const p of placed) put(p);
    anchors.push(placed);
    const k = kindOf(placed);
    quota[k]--;
    deck.splice(deck.indexOf(k), 1);
    deck.push(k);
  }

  // Round each anchor, a thing or two making an angle of it, and a step up onto it where it's one to
  // climb: against it, square to it or along it.
  const helpers: PropKind[] = shuffle(['sandbags', 'drum', 'bags', 'jersey', 'crate', 'reel', 'sandbags', 'bricks', 'drum', 'fence', 'jersey', 'sandbags'], rand);
  // First each one's step up, before the things round the first anchors take up the room kept for
  // what goes round them all (they had, in two arenas of three, once braga-map's task 059 moved the
  // cover): a box beside it (by the van's bonnet), and for the scaffold a crate between them; none
  // down a kerb from it, nor one a walker comes to off a kerb, from its far side, which takes the
  // run-up the jump onto it needs (braga-map's task 111, which moved the arenas' cover, stood a skip
  // across a kerb); nor one more than 3 cm lower than it, whose top is out of the jump's reach of its
  // (braga-map's task 044, laying the pavements level, left one 5 cm lower).
  const stepped = new Set<Prop[]>();
  for (const a of anchors) {
    const base = a[0];
    if (base.kind !== 'skip' && base.kind !== 'scaffold' && base.kind !== 'van') continue;
    const step = (p: Prop) => {
      const [dx, dz] = [p.x - base.x, p.z - base.z];
      const d = Math.hypot(dx, dz) || 1;
      const [x, z] = [p.x + (dx / d) * 1.1, p.z + (dz / d) * 1.1];
      return p.base >= base.base - 0.03 && Math.abs(g.floor(x, z, p.base + 0.5).y - p.base) < 0.05;
    };
    for (const p of beside(base, base.kind === 'scaffold' ? 'crate' : 'box', at, rand)) {
      if (props.length - cars >= MOST) break;
      if (!step(p) || !fits(p)) continue;
      put(p);
      stepped.add(a);
      if (base.kind === 'scaffold') {
        for (const q of beside(p, 'box', at, rand)) {
          if (fits(q)) {
            put(q);
            break;
          }
        }
      }
      break;
    }
  }
  for (const a of anchors) {
    const base = a[0];
    const want = base.kind === 'skip' || base.kind === 'scaffold' || base.kind === 'van' ? 2 : 1 + Math.floor(rand() * 2);
    let got = stepped.has(a) ? 1 : 0;
    for (let tries = 0; tries < 4 && got < want && props.length - cars < MOST; tries++) {
      const kind = helpers[(anchors.indexOf(a) * 3 + tries) % helpers.length];
      for (const p of beside(base, kind, at, rand)) {
        if (!fits(p)) continue;
        put(p);
        got++;
        // Two drums, side by side.
        if (kind === 'drum') for (const q of beside(p, 'drum', at, rand)) if (fits(q)) {
          put(q);
          break;
        }
        break;
      }
    }
  }

  // The open places the looks leave most exposed: every 3 m, how many of the 16 ways run past 12 m;
  // the worst, at least 9 m from any thing, get a cluster: sandbags and a drum, a crate and a box on
  // it or beside it, two barriers at an angle, a pallet and a reel.
  const spots: { x: number; z: number; open: number }[] = [];
  for (let j = 3; j < P.nz; j += 6) {
    for (let i = 3; i < P.nx; i += 6) {
      const c = j * P.nx + i;
      if (!P.reach[c]) continue;
      const x = P.x0 + (i + 0.5) * R;
      const z = P.z0 + (j + 0.5) * R;
      let open = 0;
      for (const [dx, dz] of WAYS) if (run(P, x, z, dx, dz, 12, true) >= 12) open++;
      spots.push({ x, z, open: open + rand() * 0.5 });
    }
  }
  spots.sort((a, b) => b.open - a.open);
  const kits: PropKind[][] = shuffle([['sandbags', 'drum'], ['crate', 'box'], ['jersey', 'jersey'], ['bricks', 'reel'], ['sandbags', 'crate'], ['bags', 'drum'], ['crate', 'crate']], rand);
  let kit = 0;
  for (const s of spots) {
    if (!place || props.length - cars >= MOST || s.open < 9) break;
    if (props.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < 9)) continue;
    const [k0, k1] = kits[kit % kits.length];
    const p = at(k0, s.x, s.z, rand() * Math.PI);
    if (!p || !fits(p)) continue;
    kit++;
    put(p);
    for (const q of beside(p, k1, at, rand)) if (fits(q)) {
      put(q);
      break;
    }
  }

  // By hand: the places to clear were kept clear all along (fits).
  for (const [kind, x, z, deg] of place ? (tune.add ?? []) : []) {
    const p = at(kind, x, z, (deg * Math.PI) / 180);
    if (p && fits(p)) put(p);
  }

  const long: Cover['long'] = [];
  for (let k = 0; k < looks.L.length; k++) if (looks.open[k]) long.push([looks.x[k], looks.z[k], looks.x[k] + looks.dx[k] * looks.L[k], looks.z[k] + looks.dz[k] * looks.L[k]]);
  // How sheltered a place is, on the plan as the cover leaves it.
  const shelter = (x: number, z: number, far: number): Shelter => {
    let shut = 0;
    let open = 0;
    let most = -1;
    for (let k = 0; k < 16; k++) {
      const [dx, dz] = WAYS[k];
      const t = run(P, x, z, dx, dz, 60);
      if (t < far) shut++;
      if (t > most) {
        most = t;
        open = (k * Math.PI) / 8;
      }
    }
    return { shut, open, far: most };
  };
  return { props, before, after: looks.longest(), long, shelter };
}

// An anchor of a kind at (x, z) turned yaw: its things, the first on the ground, the rest on it.
function anchor(kind: Anchor, x: number, z: number, yaw: number, at: (kind: PropKind, x: number, z: number, yaw: number, tint?: number, on?: number) => Prop | null): Prop[] | null {
  if (kind === 'toilets') {
    const c = Math.cos(yaw + Math.PI / 2) * 0.62;
    const s = Math.sin(yaw + Math.PI / 2) * 0.62;
    const a = at('toilet', x - c, z - s, yaw);
    const b = at('toilet', x + c, z + s, yaw);
    return a && b ? [a, b] : null;
  }
  if (kind === 'stack') {
    const a = at('crate', x, z, yaw);
    if (!a) return null;
    const b = at('crate', x, z, yaw + 0.12, undefined, a.y + 1);
    return b ? [a, b] : null;
  }
  if (kind === 'pallets') {
    const a = at('bricks', x, z, yaw);
    if (!a) return null;
    const b = at('bags', x, z, yaw, undefined, a.y + 1);
    return b ? [a, b] : null;
  }
  if (kind === 'hoarding') {
    // Two panels in a line, as a site's hoarding runs.
    const c = Math.cos(yaw + Math.PI / 2) * 1.22;
    const sn = Math.sin(yaw + Math.PI / 2) * 1.22;
    const a = at('hoarding', x - c, z - sn, yaw + Math.PI / 2);
    const b = at('hoarding', x + c, z + sn, yaw + Math.PI / 2);
    return a && b ? [a, b] : null;
  }
  const a = at(kind, x, z, yaw);
  return a ? [a] : null;
}

function kindOf(ps: Prop[]): Anchor {
  const k = ps[0].kind;
  return k === 'toilet' ? 'toilets' : k === 'crate' ? 'stack' : k === 'bricks' ? 'pallets' : (k as Anchor);
}

// Whether the rest of an anchor fits: what stands on the first (over the ground under it) only needs
// to overlap nothing else; what's beside it, as any thing.
function fitsOn(p: Prop, fits: (p: Prop) => boolean): boolean {
  if (p.y > p.base + 0.3) return true;
  return fits(p);
}

// The places a thing of a kind can stand against another: along each of its sides, at its ends and
// its middle, square to it or along it, a centimetre or two off it; in a seeded order. A fence only
// runs on from it: its mesh flat against a side would be one in front of it.
function beside(base: Prop, kind: PropKind, at: (kind: PropKind, x: number, z: number, yaw: number) => Prop | null, rand: () => number): Prop[] {
  const out: Prop[] = [];
  const { L, W } = SIZE[kind];
  const c = Math.cos(base.yaw);
  const s = Math.sin(base.yaw);
  const gap = 0.06;
  const mesh = kind === 'fence';
  for (const turn of [0, Math.PI / 2]) {
    // Its half-sizes along the base's length and across it.
    const hu = turn ? W / 2 : L / 2;
    const hv = turn ? L / 2 : W / 2;
    for (const sv of [1, -1]) {
      // Along a long side, at its ends and middle.
      for (const f of mesh && !turn ? [] : [-1, 0, 1]) {
        const u = f * Math.max(0, base.L / 2 - hu);
        const v = sv * (base.W / 2 + hv + gap);
        out.push(...placed(u, v, turn));
      }
      // Off an end, flush with a side or in the middle.
      for (const f of mesh && turn ? [] : [-1, 0, 1]) {
        const u = sv * (base.L / 2 + hu + gap);
        const v = f * Math.max(0, base.W / 2 - hv);
        out.push(...placed(u, v, turn));
      }
    }
  }
  function placed(u: number, v: number, turn: number): Prop[] {
    const p = at(kind, base.x + c * u - s * v, base.z + s * u + c * v, base.yaw + turn);
    return p ? [p] : [];
  }
  return shuffle(out, rand);
}

// Whether a wall, a trunk or the arena's edge stands in a box (seen from above), at its height.
function crossed(g: WorldGround, s: Solid): boolean {
  const cs = corners(s, 0.05);
  const xs = cs.map((q) => q[0]);
  const zs = cs.map((q) => q[1]);
  for (const cells of [g.d.walls, g.extra]) {
    for (const w of cells.near(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), [])) {
      // Another thing's sides: overlap() says.
      if (w.kind === 'prop' || w.y1 <= s.y0 || w.y0 >= s.y1) continue;
      if (onSolid(s, w.ax, w.az, 0.05) || onSolid(s, w.bx, w.bz, 0.05)) return true;
      for (let k = 0; k < 4; k++) if (segs(w.ax, w.az, w.bx, w.bz, cs[k][0], cs[k][1], cs[(k + 1) % 4][0], cs[(k + 1) % 4][1])) return true;
    }
  }
  for (const p of g.d.posts.near(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), [])) if (onSolid(s, p.x, p.z, p.r + 0.05)) return true;
  return false;
}

// Whether two segments cross.
function segs(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = o(cx, cz, dx, dz, ax, az);
  const d2 = o(cx, cz, dx, dz, bx, bz);
  const d3 = o(ax, az, bx, bz, cx, cz);
  const d4 = o(ax, az, bx, bz, dx, dz);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// Whether a thing leaves no gap narrower than LANE beside it: out from each side, every metre or so
// along it, and round its corners (a building's corner off a pallet's: braga-map's task 059, whose
// pavements moved the arenas' cover, stood one so at a passage's mouth, cutting off what's behind it),
// the first thing met is against it (within 35 cm) or LANE off or more.
function lanes(g: WorldGround, P: Plan, p: Prop, inside: (x: number, z: number) => boolean): boolean {
  for (const s of p.solids) {
    if (s.y0 > p.y + 0.3) continue;
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    // How far a point is from the box (seen from above).
    const off = (x: number, z: number) => {
      const u = (x - s.x) * c + (z - s.z) * sn;
      const v = (z - s.z) * c - (x - s.x) * sn;
      return Math.hypot(Math.max(Math.abs(u) - s.L / 2, 0), Math.max(Math.abs(v) - s.W / 2, 0));
    };
    for (const [nx, nz, len, half] of [[c, sn, s.W, s.L / 2], [-c, -sn, s.W, s.L / 2], [-sn, c, s.L, s.W / 2], [sn, -c, s.L, s.W / 2]] as const) {
      // Along the side (the way across it), from end to end; at its ends, turned half way to the next
      // side's way out too.
      const ax = -nz;
      const az = nx;
      const n = Math.max(2, Math.ceil(len / 0.9));
      for (let k = 0; k <= n; k++) {
        const a = (k / n - 0.5) * (len - 0.1);
        const x0 = s.x + nx * half + ax * a;
        const z0 = s.z + nz * half + az * a;
        const end = k === 0 ? -1 : k === n ? 1 : 0;
        for (const t of end ? [0, Math.PI / 8, Math.PI / 4] : [0]) {
          const ux = nx * Math.cos(t) + ax * end * Math.sin(t);
          const uz = nz * Math.cos(t) + az * end * Math.sin(t);
          let gap = Infinity;
          for (let d = 0.1; d < LANE + 0.05; d += 0.1) {
            const x = x0 + ux * d;
            const z = z0 + uz * d;
            const cell = P.cell(x, z);
            // Where a walker stands there's no wall within 30 cm: only elsewhere is the ground asked.
            if (cell < 0 || P.out[cell] || P.see[cell] || P.room[cell] || (!P.ok[cell] && (!inside(x, z) || g.circle(x, z, x, z, p.y, 0.05, 1.75, true))) || p.solids.some((o) => o !== s && onSolid(o, x, z))) {
              gap = off(x, z);
              break;
            }
          }
          if (gap > 0.35 && gap < LANE) return false;
        }
      }
    }
  }
  return true;
}

// Whether a cell nobody stands in is only next to a wall (a walker's middle keeps 30 cm off one): a
// thing's foot may cover it when the cells round it are open ground.
function nearOk(ok: Uint8Array, P: Plan, c: number): boolean {
  const i = c % P.nx;
  const j = (c - i) / P.nx;
  let n = 0;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ii = i + di;
    const jj = j + dj;
    if (ii >= 0 && jj >= 0 && ii < P.nx && jj < P.nz && ok[jj * P.nx + ii]) n++;
  }
  return n >= 2;
}

function dist(P: Plan, c: number, x: number, z: number): number {
  return Math.hypot(P.x0 + ((c % P.nx) + 0.5) * R - x, P.z0 + (Math.floor(c / P.nx) + 0.5) * R - z);
}

function shuffle<T>(a: T[], rand: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// How sheltered a place is, on the plan as the cover leaves it: of 16 ways, how many a look at TALL is
// stopped within `far` metres; and the way it runs furthest.
export interface Shelter {
  shut: number;
  open: number; // the way that runs furthest, as an angle
  far: number; // how far it runs
}
