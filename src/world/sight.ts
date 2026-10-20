// Line of sight (braga-map's task 074): how far a ray goes through the world before something stops
// it, for a shot and for a look. What stops one is what you'd hide behind: the buildings' walls and
// their roofs, the walls and hedges, the decks' parapets and the tunnels' sides and mouths, a riser's
// face, the trees' trunks, a waiting kart, and the ground (the land, the streets and paths, the
// steps, the decks). A fence's mesh, a railing's or a gate's bars, the railing on a low wall, a
// handrail, the area's edge and the barriers across its streets let it through, as does a tree's
// crown: leaves hide someone but don't stop a bullet, and a shot through them is a shot the shooter
// chose.
//
// The walls and trunks are looked up cell by cell along the ray (the ground's cells of 10 m), the
// nearest first, stopping at the first cell past what stopped it; then the ground is looked at every
// 30 cm up to there, quickly where the ray is well over the land and nothing stands on it.
import type { Building } from 'braga-map';
import { Cells, DEEP, HOLD, inRing, type Wall, type WorldGround } from './ground.ts';
import { roomSolid } from './interiors.ts';

const CELL = 10;
// How far apart the ground is looked at along a ray, and how far over the land (firm under the
// streets) a ray has to be for nothing there to stop it: a kerb's 15 cm, and some.
const STRIDE = 0.3;
const CLEAR = 0.35;
// The top of a building this deep is its roof, for a ray from above: no deeper, as a passage can run
// under a building, and a ray along it is under its roof, not in it.
const ROOF = 1.5;

export interface Sighted {
  t: number; // how far along the ray it was stopped; max when nothing stopped it
  x: number;
  y: number;
  z: number;
  // The surface's way out where it was stopped, for a bullet's mark.
  nx: number;
  ny: number;
  nz: number;
  what: 'wall' | 'hedge' | 'building' | 'roof' | 'tree' | 'ground' | 'kart' | null;
}

// Something round the game puts in the world for a while: a kart waiting, as two circles.
export interface Blocker {
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
}

// What a ray passes of the map's walls by their kind: their bars and mesh.
const SEE_THROUGH = new Set(['fence', 'railing', 'gate', 'bar', 'guard_rail']);

// The buildings' footprints near the open world, in cells, for their roofs: made once for a ground's
// data, the first time a ray needs them.
interface Roof {
  pts: [number, number][];
  y0: number; // the roof's foot, ROOF under its top
  y1: number;
  box: { x0: number; z0: number; x1: number; z1: number };
}
const roofsOf = new WeakMap<object, Cells<Roof>>();
function roofs(g: WorldGround): Cells<Roof> {
  let c = roofsOf.get(g.d);
  if (c) return c;
  c = new Cells<Roof>();
  const open = g.d.world.open.pts;
  const xs = open.map((p) => p[0]);
  const zs = open.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs) - 50, Math.max(...xs) + 50, Math.min(...zs) - 50, Math.max(...zs) + 50];
  // A building with an inside (braga-map's task 079) has its own floors, and none of this.
  const roomed = new Set(g.d.rooms.map((r) => r.b));
  for (const b of g.d.world.buildings as Building[]) {
    if (roomed.has(b)) continue;
    const bx = b.pts.map((p) => p[0]);
    const bz = b.pts.map((p) => p[1]);
    const box = { x0: Math.min(...bx), z0: Math.min(...bz), x1: Math.max(...bx), z1: Math.max(...bz) };
    if (box.x1 < x0 || box.x0 > x1 || box.z1 < z0 || box.z0 > z1) continue;
    const top = b.y + Math.max(b.h, b.ridge);
    c.add(box.x0, box.z0, box.x1, box.z1, { pts: b.pts, y0: top - ROOF, y1: top, box });
  }
  roofsOf.set(g.d, c);
  return c;
}

const seen: Wall[] = [];

// How far the ray from o the way d (a unit vector) goes, up to max, before something in the world
// stops it, and where.
export function sight(g: WorldGround, o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, max: number, blockers: readonly Blocker[] = []): Sighted {
  let best: Sighted = { t: max, x: o.x + d.x * max, y: o.y + d.y * max, z: o.z + d.z * max, nx: 0, ny: 0, nz: 0, what: null };
  const hit = (t: number, nx: number, ny: number, nz: number, what: Sighted['what']) => {
    if (t >= best.t || t < 0) return;
    best = { t, x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t, nx, ny, nz, what };
  };
  const flat = Math.hypot(d.x, d.z);

  // The walls and trunks, cell by cell along the ray, nearest first.
  if (flat > 1e-9) {
    let i = Math.floor(o.x / CELL);
    let j = Math.floor(o.z / CELL);
    const si = Math.sign(d.x);
    const sj = Math.sign(d.z);
    const di = d.x ? CELL / Math.abs(d.x) : Infinity;
    const dj = d.z ? CELL / Math.abs(d.z) : Infinity;
    let ti = d.x ? ((i + (d.x > 0 ? 1 : 0)) * CELL - o.x) / d.x : Infinity;
    let tj = d.z ? ((j + (d.z > 0 ? 1 : 0)) * CELL - o.z) / d.z : Infinity;
    for (;;) {
      const cx = (i + 0.5) * CELL;
      const cz = (j + 0.5) * CELL;
      for (const cells of [g.d.walls, g.extra]) {
        for (const w of cells.at(cx, cz) ?? seen) {
          if (w.open || g.down.has(w) || (w.kind && SEE_THROUGH.has(w.kind))) continue;
          const top = (w.kind === 'retaining' ? w.y1 - HOLD : w.y1) - (w.rail ?? 0);
          const c = crossing(o, d, w);
          if (!c || c.t >= best.t) continue;
          const y = o.y + d.y * c.t;
          if (y < w.y0 || y > top) continue;
          hit(c.t, c.nx, 0, c.nz, w.kind === 'hedge' ? 'hedge' : w.kind ? 'wall' : 'building');
        }
      }
      for (const p of g.d.posts.at(cx, cz) ?? []) round(o, d, p, best.t, (t, nx, nz) => hit(t, nx, 0, nz, 'tree'));
      const out = Math.min(ti, tj);
      if (best.t <= out || out >= max) break;
      if (ti < tj) {
        ti += di;
        i += si;
      } else {
        tj += dj;
        j += sj;
      }
    }
  }
  for (const b of blockers) round(o, d, b, best.t, (t, nx, nz) => hit(t, nx, 0, nz, 'kart'));

  // The ground and the roofs, every STRIDE up to what stopped it.
  const R = roofs(g);
  let was = 0;
  for (let t = Math.min(STRIDE, best.t); t <= best.t; t += STRIDE) {
    if (solid(g, R, o.x + d.x * t, o.y + d.y * t, o.z + d.z * t)) {
      // Where between the last clear point and this one.
      let a = was;
      let b = t;
      for (let k = 0; k < 6; k++) {
        const m = (a + b) / 2;
        if (solid(g, R, o.x + d.x * m, o.y + d.y * m, o.z + d.z * m)) b = m;
        else a = m;
      }
      const x = o.x + d.x * b;
      const z = o.z + d.z * b;
      const y = o.y + d.y * b;
      const roof = roofAt(R, g, x, y, z);
      if (roof) hit(b, 0, 1, 0, 'roof');
      else {
        const f = g.floor(x, z, y + 0.05);
        const n = f.buried ? { x: 0, y: 1, z: 0 } : g.normal(f, x, z);
        hit(b, n.x, n.y, n.z, 'ground');
      }
      break;
    }
    was = t;
    if (t + STRIDE > best.t && t < best.t - 1e-6) t = best.t - STRIDE;
  }
  return best;
}

// Whether the segment from a to b is clear: nothing in the world between them.
export function clear(g: WorldGround, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, blockers: readonly Blocker[] = []): boolean {
  const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  if (L < 1e-6) return true;
  return sight(g, a, { x: (b.x - a.x) / L, y: (b.y - a.y) / L, z: (b.z - a.z) / L }, L, blockers).t >= L - 1e-6;
}

// Whether (x, y, z) is in the ground, a deck, the plinth or a roof; in a room (braga-map's task 079),
// in its floors and stairs.
function solid(g: WorldGround, R: Cells<Roof>, x: number, y: number, z: number): boolean {
  const d = g.d;
  const room = g.roomAt(x, z);
  if (room) return roomSolid(room, x, y, z);
  const pieces = d.pieceCells.at(x, z);
  const treads = d.treads.at(x, z);
  const blocks = d.blocks.at(x, z);
  if (roofAt(R, g, x, y, z)) return true;
  if (!pieces?.length && !treads?.length && !blocks?.length && y > d.land.firm(x, z) + CLEAR) return false;
  const f = g.floor(x, z, y);
  if (f.buried || f.y > y) return true;
  for (const p of pieces ?? []) if (p.rings.has(x, z) && y <= p.height(x, z) && y >= p.height(x, z) - DEEP) return true;
  for (const b of blocks ?? []) if (y < b.y && inRing(b.pts, x, z)) return true;
  return false;
}

// The roof (x, y, z) is in, if any: under a building's top, by no more than ROOF, and not over a
// carriageway or a passage a building is cut back at.
function roofAt(R: Cells<Roof>, g: WorldGround, x: number, y: number, z: number): boolean {
  for (const r of R.at(x, z) ?? []) {
    if (y > r.y1 || y < r.y0 || x < r.box.x0 || x > r.box.x1 || z < r.box.z0 || z > r.box.z1) continue;
    if (inRing(r.pts, x, z) && !g.d.cuts.has(x, z)) return true;
  }
  return false;
}

// Where the ray from o the way d crosses a wall's line, seen from above: how far along the ray, and
// the wall's side it came from.
function crossing(o: { x: number; z: number }, d: { x: number; z: number }, w: Wall): { t: number; nx: number; nz: number } | null {
  const ex = w.bx - w.ax;
  const ez = w.bz - w.az;
  const den = d.x * ez - d.z * ex;
  if (Math.abs(den) < 1e-12) return null;
  const qx = w.ax - o.x;
  const qz = w.az - o.z;
  const t = (qx * ez - qz * ex) / den;
  const u = (qx * d.z - qz * d.x) / den;
  if (t < 0 || u < 0 || u > 1) return null;
  const L = Math.hypot(ex, ez) || 1;
  // Its normal towards where the ray came from.
  const s = -Math.sign(d.x * -ez + d.z * ex) || 1;
  return { t, nx: (-ez / L) * s, nz: (ex / L) * s };
}

// Where the ray from o the way d first meets an upright cylinder (a trunk, a kart's circle), if
// before `before` and at a height it stands at.
function round(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, c: { x: number; z: number; r: number; y0: number; y1: number }, before: number, then: (t: number, nx: number, nz: number) => void): void {
  const fx = o.x - c.x;
  const fz = o.z - c.z;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-12) return;
  const b = fx * d.x + fz * d.z;
  const k = fx * fx + fz * fz - c.r * c.r;
  if (k < 0) return; // inside it already
  const h = b * b - a * k;
  if (h < 0) return;
  const t = (-b - Math.sqrt(h)) / a;
  if (t < 0 || t >= before) return;
  const y = o.y + d.y * t;
  if (y < c.y0 || y > c.y1) return;
  then(t, (fx + d.x * t) / c.r, (fz + d.z * t) / c.r);
}
