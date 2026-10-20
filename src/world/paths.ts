// Where someone on foot can walk in an area (braga-map's task 075, for the bots in a round): a lattice
// of points 2 m apart over its ground (the streets, pavements, paths and steps, the land, a passage
// under a building, a room's floor), each with room to stand, joined to its eight neighbours where a
// walker gets from one to the other: no wall, hedge, fence, building or trunk between them, no rise a
// walker can't climb (a flight's treads one by one, a bank up to 45°), and a retaining wall only off
// its top. Where a building has floors over its ground floor (a tower, braga-map's task 079), a point
// on each, and the ways no lattice lines up with joined by hand: through each door of a room, and up
// each flight of a tower's stairs. Only the points the area's places reach are kept. A bot finds its
// way on it (A*) and looks for cover round it.
import { HOLD, Rings, STEP, type Floor, type Post, type Wall, type WorldGround } from './ground.ts';
import { inside as inRoom, type Room } from './interiors.ts';

// The lattice's spacing; the room a point needs round it, and an edge beside a wall (a little less,
// as a walker slides along one); and how far over the ground a walker's head is.
export const GRID = 2;
const ROOM = 0.3;
const PASS = 0.26;
const TALL = 1.75;
// The steepest a walker goes up, rise over run: a flight's (its treads a step each), a bank's (45°),
// and a street's or a path's.
const STAIR = 0.75;
const BANK = 1;
const SLOPE = 0.3;
// The furthest drop a walker comes down off.
const DROP = 4;
// Four of the eight neighbours: the others are theirs.
const DI = [1, 1, 0, -1];
const DJ = [0, 1, 1, 1];
// How far a hand-made point (a door's, a flight's) reaches for the lattice's.
const REACH = 2.9;

export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

type P3 = { x: number; y: number; z: number };

export class Paths {
  // The points: where each stands (its floor's height), and the points each goes to (`to` from
  // `off[p]` to `off[p + 1]`).
  readonly n: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly off: Int32Array;
  readonly to: Int32Array;
  readonly ms: number; // how long it took to make
  private readonly i0: number;
  private readonly j0: number;
  private readonly W: number;
  private readonly H: number;
  // The lattice's cells, each its points (several where floors stand over each other).
  private readonly cells = new Map<number, number[]>();
  private readonly ground: WorldGround;
  // A*'s working arrays, kept between searches; `stamp` says which search a point's values are from.
  private readonly g: Float32Array;
  private readonly from: Int32Array;
  private readonly seen: Uint32Array;
  private readonly shut: Uint32Array;
  private stamp = 0;
  private heap: number[] = [];
  private fs: Float32Array;

  constructor(ground: WorldGround, inside: (x: number, z: number) => boolean, box: Box, roots: readonly { x: number; z: number }[], rooms: readonly Room[] = ground.d.rooms) {
    const t0 = performance.now();
    this.ground = ground;
    const g = ground;
    this.i0 = Math.floor(box.x0 / GRID);
    this.j0 = Math.floor(box.z0 / GRID);
    this.W = Math.floor(box.x1 / GRID) - this.i0 + 1;
    this.H = Math.floor(box.z1 / GRID) - this.j0 + 1;
    const W = this.W;
    const H = this.H;
    // The buildings over the box, but where one is cut back over a passage, or has an inside: nobody
    // stands in the rest.
    const roomed = new Set(rooms.map((r) => r.b));
    const rings: [number, number][][] = [];
    for (const b of g.d.world.buildings) {
      const p = b.pts[0];
      if (!roomed.has(b) && p && p[0] > box.x0 - 100 && p[0] < box.x1 + 100 && p[1] > box.z0 - 100 && p[1] < box.z1 + 100) rings.push(b.pts);
    }
    const built = new Rings(rings);
    const here = rooms.filter((r) => r.box.x1 > box.x0 && r.box.x0 < box.x1 && r.box.z1 > box.z0 && r.box.z0 < box.z1);

    // The points: in each cell, at the ground's level and on each of a tower's floors over it, the
    // cell's middle or near it where that hasn't room; none in a stairwell (its flights' own are).
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    const kinds: Floor['kind'][] = [];
    const cellOf: number[] = [];
    const add = (c: number, x: number, y: number, z: number, kind: Floor['kind']) => {
      const p = xs.length;
      xs.push(x);
      ys.push(y);
      zs.push(z);
      kinds.push(kind);
      cellOf.push(c);
      const l = this.cells.get(c);
      if (l) l.push(p);
      else this.cells.set(c, [p]);
      return p;
    };
    const tries = [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]];
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const c = j * W + i;
        const mx = (this.i0 + i + 0.5) * GRID;
        const mz = (this.j0 + j + 0.5) * GRID;
        const tower = here.find((r) => r.tower && mx > r.box.x0 - 1 && mx < r.box.x1 + 1 && mz > r.box.z0 - 1 && mz < r.box.z1 + 1);
        const probes = [NaN, ...(tower ? tower.levels.slice(1) : [])];
        for (const level of probes) {
          for (const [ox, oz] of tries) {
            const x = mx + ox;
            const z = mz + oz;
            if (!inside(x, z) || !g.d.inside.has(x, z) || (built.has(x, z) && !g.d.cuts.has(x, z))) continue;
            if (here.some((r) => r.stair && inRoom(r.stair.pts, x, z))) continue;
            const y0 = Number.isNaN(level) ? g.groundAt(x, z) : level;
            const f = g.floor(x, z, y0 + 0.5);
            if (f.buried || this.wet(x, z, f.y) || g.circle(x, z, x, z, f.y, ROOM, TALL, true)) continue;
            if ((this.cells.get(c) ?? []).some((q) => Math.abs(ys[q] - f.y) < 1)) break;
            add(c, x, f.y, z, f.kind);
            break;
          }
        }
      }
    }

    // Each way from each point to its neighbours', where a walker gets there; a diagonal only where
    // the straight ways round it have points at its level: not across a corner.
    const edges: number[] = [];
    const walls: Wall[] = [];
    const posts: Post[] = [];
    const level = (c: number, y: number) => (this.cells.get(c) ?? []).some((q) => Math.abs(ys[q] - y) < 1);
    const lattice = xs.length;
    for (let a = 0; a < lattice; a++) {
      const c = cellOf[a];
      const i = c % W;
      const j = (c - i) / W;
      for (let k = 0; k < 4; k++) {
        const ni = i + DI[k];
        const nj = j + DJ[k];
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        for (const b of this.cells.get(nj * W + ni) ?? []) {
          if (Math.abs(ys[a] - ys[b]) > 2.5) continue;
          if (k % 2 && (!level(j * W + ni, ys[a]) || !level(nj * W + i, ys[a]))) continue;
          const [ab, ba] = this.joins(xs[a], ys[a], zs[a], kinds[a], xs[b], ys[b], zs[b], kinds[b], walls, posts);
          if (ab) edges.push(a, b);
          if (ba) edges.push(b, a);
        }
      }
    }

    // The ways no lattice lines up with: through a door, and up a tower's flights, each point joined to
    // the next, the ends to the lattice's points within reach a walker gets to straight.
    const hand = (q: P3) => add(Math.floor(q.z / GRID - this.j0) * W + Math.floor(q.x / GRID - this.i0), q.x, q.y, q.z, 'block');
    const link = (a: number, b: number) => edges.push(a, b, b, a);
    const reach = (p: number) => {
      const ci = Math.floor(xs[p] / GRID) - this.i0;
      const cj = Math.floor(zs[p] / GRID) - this.j0;
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          for (const q of this.cells.get((cj + dj) * W + ci + di) ?? []) {
            if (q >= lattice || Math.abs(ys[q] - ys[p]) > 0.6 || Math.hypot(xs[q] - xs[p], zs[q] - zs[p]) > REACH) continue;
            if (this.straight(xs[p], zs[p], xs[q], zs[q], ys[p]) && this.straight(xs[q], zs[q], xs[p], zs[p], ys[q])) link(p, q);
          }
        }
      }
    };
    for (const r of here) {
      for (const [o, i] of r.doors) {
        const a = hand(o);
        const b = hand(i);
        link(a, b);
        reach(a);
        reach(b);
      }
      if (!r.stair) continue;
      let prev = -1;
      for (const way of r.stair.ways) {
        const ids = way.map(hand);
        for (let k = 1; k < ids.length; k++) link(ids[k - 1], ids[k]);
        // A flight's foot and the next floor at its top, and the roof outside the hut.
        reach(ids[0]);
        reach(ids[3]);
        if (ids.length > 4) reach(ids[ids.length - 1]);
        if (prev >= 0) link(prev, ids[0]);
        prev = ids[3];
      }
    }

    // Only what the roots reach (the spawns), and what reaches them: not the inside of a block's yard,
    // or a garden behind its wall.
    const n0 = xs.length;
    const outs: number[][] = Array.from({ length: n0 }, () => []);
    const ins: number[][] = Array.from({ length: n0 }, () => []);
    for (let k = 0; k < edges.length; k += 2) {
      outs[edges[k]].push(edges[k + 1]);
      ins[edges[k + 1]].push(edges[k]);
    }
    const start: number[] = [];
    for (const r of roots) {
      const i = Math.floor(r.x / GRID) - this.i0;
      const j = Math.floor(r.z / GRID) - this.j0;
      const p = i >= 0 && j >= 0 && i < W && j < H ? (this.cells.get(j * W + i) ?? []).find((q) => q < lattice) : undefined;
      if (p !== undefined) start.push(p);
    }
    const flood = (next: number[][]) => {
      const mark = new Uint8Array(n0);
      const stack = [...start];
      for (const p of stack) mark[p] = 1;
      while (stack.length) {
        const p = stack.pop()!;
        for (const q of next[p]) {
          if (mark[q]) continue;
          mark[q] = 1;
          stack.push(q);
        }
      }
      return mark;
    };
    const fwd = flood(outs);
    const back = flood(ins);
    const keep = new Int32Array(n0).fill(-1);
    let n = 0;
    for (let p = 0; p < n0; p++) if (fwd[p] && back[p]) keep[p] = n++;
    this.n = n;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.z = new Float32Array(n);
    this.off = new Int32Array(n + 1);
    const to: number[] = [];
    for (let p = 0; p < n0; p++) {
      const q = keep[p];
      if (q < 0) continue;
      this.x[q] = xs[p];
      this.y[q] = ys[p];
      this.z[q] = zs[p];
      this.off[q] = to.length;
      for (const t of new Set(outs[p])) if (keep[t] >= 0) to.push(keep[t]);
    }
    this.off[n] = to.length;
    this.to = Int32Array.from(to);
    for (const [c, l] of [...this.cells]) {
      const kept = l.filter((p) => keep[p] >= 0).map((p) => keep[p]);
      if (kept.length) this.cells.set(c, kept);
      else this.cells.delete(c);
    }
    this.g = new Float32Array(n);
    this.fs = new Float32Array(n);
    this.from = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.shut = new Uint32Array(n);
    this.ms = performance.now() - t0;
  }

  // Whether (x, z) at height y is in the river.
  private wet(x: number, z: number, y: number): boolean {
    const r = this.ground.d.land.riverAt(x, z);
    return r.d < this.ground.d.land.HW && y < r.y - 0.3;
  }

  // Whether a walker gets from a to b, and from b to a.
  private joins(ax: number, ay: number, az: number, ak: Floor['kind'], bx: number, by: number, bz: number, bk: Floor['kind'], walls: Wall[], posts: Post[]): [boolean, boolean] {
    const g = this.ground;
    const run = Math.hypot(bx - ax, bz - az);
    // The ground between them: there, and not much over or under the line between their floors.
    let stairs = ak === 'steps' || bk === 'steps';
    let land = ak === 'land' && bk === 'land';
    for (const u of [1 / 3, 2 / 3]) {
      const x = ax + (bx - ax) * u;
      const z = az + (bz - az) * u;
      const y = ay + (by - ay) * u;
      const f = g.floor(x, z, Math.max(ay, by) + 0.2);
      if (f.buried || f.y > y + STEP || f.y < Math.min(ay, by) - DROP || this.wet(x, z, f.y)) return [false, false];
      if (f.kind === 'steps') stairs = true;
      if (f.kind !== 'land') land = false;
    }
    const steep = stairs ? STAIR : land ? BANK : SLOPE;
    const up = (rise: number) => rise <= STEP + steep * run && rise >= -DROP;
    let ab = up(by - ay);
    let ba = up(ay - by);
    // On a flight, or up anything more than a step: the ground walked every third of a metre, as a
    // walker climbs it, a tread at a time and not up a flight's side where it stands out of the land.
    if (stairs || Math.abs(by - ay) > STEP) {
      ab &&= this.climbs(ax, ay, az, bx, bz, DROP);
      ba &&= this.climbs(bx, by, bz, ax, az, DROP);
    }
    if (!ab && !ba) return [false, false];

    // The walls and trunks between them, at the height of a walker on the lower of the two; a
    // retaining wall stops one only coming up at its face.
    const lo = Math.min(ay, by);
    const r = PASS;
    for (const cells of [g.d.walls, g.extra]) {
      for (const w of cells.near(Math.min(ax, bx) - 1, Math.min(az, bz) - 1, Math.max(ax, bx) + 1, Math.max(az, bz) + 1, walls)) {
        const top = w.kind === 'retaining' ? w.y1 - HOLD : w.y1;
        if (lo >= top || Math.max(ay, by) + TALL <= w.y0 || g.down.has(w)) continue;
        if (segments(ax, az, bx, bz, w.ax, w.az, w.bx, w.bz) >= r + (w.half ?? 0)) continue;
        if (w.kind === 'retaining') {
          // Its lower side is on the right of its line: from the upper side, a drop.
          const side = (px: number, pz: number) => (w.bx - w.ax) * (pz - w.az) - (w.bz - w.az) * (px - w.ax) < 0;
          if (!side(ax, az)) ab = false;
          if (!side(bx, bz)) ba = false;
        } else return [false, false];
        if (!ab && !ba) return [false, false];
      }
    }
    for (const p of g.d.posts.near(Math.min(ax, bx) - 1, Math.min(az, bz) - 1, Math.max(ax, bx) + 1, Math.max(az, bz) + 1, posts)) {
      if (lo >= p.y1 || Math.max(ay, by) + TALL <= p.y0) continue;
      if (toSeg(p.x, p.z, ax, az, bx, bz) < p.r + r) return [false, false];
    }
    return [ab, ba];
  }

  // The point nearest (x, z) at about height y: within a few metres, or else anywhere.
  near(x: number, z: number, y = NaN): number {
    const p = this.close(x, z, y);
    if (p >= 0 || !this.n) return p;
    let best = 0;
    for (let q = 1; q < this.n; q++) if (Math.hypot(this.x[q] - x, this.z[q] - z) < Math.hypot(this.x[best] - x, this.z[best] - z)) best = q;
    return best;
  }

  private close(x: number, z: number, y: number): number {
    const ci = Math.floor(x / GRID) - this.i0;
    const cj = Math.floor(z / GRID) - this.j0;
    let best = -1;
    let bd = Infinity;
    for (let r = 0; r <= 3 && best < 0; r++) {
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || i < 0 || j < 0 || i >= this.W || j >= this.H) continue;
          for (const p of this.cells.get(j * this.W + i) ?? []) {
            const d = Math.hypot(this.x[p] - x, this.z[p] - z) + (Number.isNaN(y) ? 0 : 3 * Math.abs(this.y[p] - y));
            if (d < bd) {
              bd = d;
              best = p;
            }
          }
        }
      }
    }
    return best;
  }

  // The points p goes to, and how far each is.
  each(p: number, then: (q: number, d: number) => void): void {
    for (let k = this.off[p]; k < this.off[p + 1]; k++) {
      const q = this.to[k];
      then(q, Math.hypot(this.x[q] - this.x[p], this.y[q] - this.y[p], this.z[q] - this.z[p]));
    }
  }

  // The way from point a to point b, its points in order (a first), or null if there's none. `cost`
  // adds to a point's: a bot's wish to keep out of someone's sight. Its guess of the way left counts
  // half as much again as the crow flies: a way a little longer than the shortest, found looking at
  // far fewer points.
  find(a: number, b: number, cost?: (p: number) => number): number[] | null {
    if (a < 0 || b < 0) return null;
    if (a === b) return [a];
    const s = ++this.stamp;
    const { g, fs, from, seen, shut, x, z } = this;
    const heap = this.heap;
    heap.length = 0;
    const h = (p: number) => 1.5 * Math.hypot(x[p] - x[b], z[p] - z[b]);
    g[a] = 0;
    fs[a] = h(a);
    from[a] = -1;
    seen[a] = s;
    push(heap, fs, a);
    while (heap.length) {
      const p = pop(heap, fs);
      if (p === b) {
        const out: number[] = [];
        for (let q = b; q >= 0; q = from[q]) out.push(q);
        return out.reverse();
      }
      if (shut[p] === s) continue;
      shut[p] = s;
      this.each(p, (q, d) => {
        if (shut[q] === s) return;
        const c = g[p] + d + (cost ? cost(q) : 0);
        if (seen[q] === s && c >= g[q]) return;
        seen[q] = s;
        g[q] = c;
        from[q] = p;
        fs[q] = c + h(q);
        push(heap, fs, q);
      });
    }
    return null;
  }

  // The points within `far` metres' walk of a, nearest first, with how far each is.
  round(a: number, far: number): { p: number; d: number }[] {
    const out: { p: number; d: number }[] = [];
    if (a < 0) return out;
    const s = ++this.stamp;
    const { g, fs, seen, shut } = this;
    const heap = this.heap;
    heap.length = 0;
    g[a] = 0;
    fs[a] = 0;
    seen[a] = s;
    push(heap, fs, a);
    while (heap.length) {
      const p = pop(heap, fs);
      if (shut[p] === s) continue;
      shut[p] = s;
      out.push({ p, d: g[p] });
      this.each(p, (q, d) => {
        const c = g[p] + d;
        if (shut[q] === s || c > far || (seen[q] === s && c >= g[q])) return;
        seen[q] = s;
        g[q] = c;
        fs[q] = c;
        push(heap, fs, q);
      });
    }
    return out;
  }

  // Whether the ground takes a walker from (ax, az), height y, to (bx, bz): there all along, and no
  // rise in it more than a step (a tread on a flight, a bank's third of a metre), looked at every third
  // of a metre.
  private climbs(ax: number, y: number, az: number, bx: number, bz: number, drop = 1): boolean {
    const g = this.ground;
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.33);
    let h = y;
    for (let k = 1; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n;
      const z = az + ((bz - az) * k) / n;
      const f = g.floor(x, z, h + 0.2);
      if (f.buried || f.y > h + (f.kind === 'steps' ? 0.4 : f.kind === 'land' ? 0.36 : STEP) || f.y < h - drop || this.wet(x, z, f.y)) return false;
      h = f.y;
    }
    return true;
  }

  // Whether a walker at (ax, az), height y, goes straight to (bx, bz): nothing of the walls and trunks
  // in the way, and the ground there all along, no step up too high (for cutting a way's corners).
  straight(ax: number, az: number, bx: number, bz: number, y: number): boolean {
    const g = this.ground;
    if (!this.climbs(ax, y, az, bx, bz)) return false;
    for (const cells of [g.d.walls, g.extra]) {
      for (const w of cells.near(Math.min(ax, bx) - 1, Math.min(az, bz) - 1, Math.max(ax, bx) + 1, Math.max(az, bz) + 1, scratchWalls)) {
        const top = w.kind === 'retaining' ? w.y1 - HOLD : w.y1;
        if (y >= top || y + TALL <= w.y0 || g.down.has(w)) continue;
        if (segments(ax, az, bx, bz, w.ax, w.az, w.bx, w.bz) < PASS + (w.half ?? 0)) return false;
      }
    }
    for (const p of g.d.posts.near(Math.min(ax, bx) - 1, Math.min(az, bz) - 1, Math.max(ax, bx) + 1, Math.max(az, bz) + 1, scratchPosts)) {
      if (y >= p.y1 || y + TALL <= p.y0) continue;
      if (toSeg(p.x, p.z, ax, az, bx, bz) < p.r + PASS) return false;
    }
    return true;
  }
}

const scratchWalls: Wall[] = [];
const scratchPosts: Post[] = [];

// A binary heap of points by their f.
function push(heap: number[], f: Float32Array, p: number): void {
  heap.push(p);
  let k = heap.length - 1;
  while (k > 0) {
    const up = (k - 1) >> 1;
    if (f[heap[up]] <= f[p]) break;
    heap[k] = heap[up];
    k = up;
  }
  heap[k] = p;
}

function pop(heap: number[], f: Float32Array): number {
  const top = heap[0];
  const last = heap.pop()!;
  if (heap.length) {
    let k = 0;
    for (;;) {
      const l = 2 * k + 1;
      if (l >= heap.length) break;
      const c = l + 1 < heap.length && f[heap[l + 1]] < f[heap[l]] ? l + 1 : l;
      if (f[heap[c]] >= f[last]) break;
      heap[k] = heap[c];
      k = c;
    }
    heap[k] = last;
  }
  return top;
}

// The distance from (x, z) to the segment from a to b.
function toSeg(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const ex = bx - ax;
  const ez = bz - az;
  const L = ex * ex + ez * ez;
  const t = L ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L)) : 0;
  return Math.hypot(ax + ex * t - x, az + ez * t - z);
}

// The distance between two segments, seen from above: 0 where they cross.
function segments(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = o(cx, cz, dx, dz, ax, az);
  const d2 = o(cx, cz, dx, dz, bx, bz);
  const d3 = o(ax, az, bx, bz, cx, cz);
  const d4 = o(ax, az, bx, bz, dx, dz);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(toSeg(ax, az, cx, cz, dx, dz), toSeg(bx, bz, cx, cz, dx, dz), toSeg(cx, cz, ax, az, bx, bz), toSeg(dx, dz, ax, az, bx, bz));
}
