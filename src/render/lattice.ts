// The lattice the land's mesh is made on (city.ts): cells of C metres over the box, each split into
// small cells of F metres where it needs them, and every cell two triangles, split from its (i + 1, j)
// corner to its (i, j + 1). A Surface is heights on it: the land's mesh is one, and what meets the
// land (a street's retaining wall) reads the land's height on it where it's drawn.
import type { Box } from 'braga-map';
import { convexPieces } from './roofs.ts';

export type Height = (x: number, z: number) => number;

export class Lattice {
  readonly x0: number;
  readonly z0: number;
  readonly C: number;
  readonly F: number;
  readonly r: number;
  readonly nx: number;
  readonly nz: number;
  // Which big cells are split into small ones, set before any surface is made on the lattice.
  readonly fine: Uint8Array;

  constructor(B: Box, C: number, F: number) {
    this.x0 = B.x0;
    this.z0 = B.z0;
    this.C = C;
    this.F = F;
    this.r = Math.round(C / F);
    this.nx = Math.floor((B.x1 - B.x0) / C);
    this.nz = Math.floor((B.z1 - B.z0) / C);
    this.fine = new Uint8Array(this.nx * this.nz);
  }

  isFine(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.nx && j < this.nz && this.fine[j * this.nx + i] === 1;
  }

  coarse(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.nx && j < this.nz && this.fine[j * this.nx + i] === 0;
  }

  // The big cell (x, z) is in, or -1 off the lattice.
  cellAt(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / this.C);
    const j = Math.floor((z - this.z0) / this.C);
    return i >= 0 && j >= 0 && i < this.nx && j < this.nz ? j * this.nx + i : -1;
  }
}

// Heights over a lattice, from h: each point of the small cells at h, but those on the side of a big
// cell that isn't split, on the line between its corners, so the mesh made of it has no cracks. And
// where `walls` are given, the retaining walls' footprints (braga-map's task 111), each triangle of a
// small cell they meet cut along them, so the land steps under a wall as h does, not across the cell.
// A big cell isn't cut: its triangles are 10 m across (20 on Low), too coarse for a step to show.
export class Surface {
  readonly L: Lattice;
  readonly h: Height;
  readonly walls: Holes | null;
  private W: number;
  private ys: Float32Array;
  private pieces = new Map<string, XYZ[][] | null>();

  constructor(L: Lattice, h: Height, walls: Holes | null = null) {
    this.L = L;
    this.h = h;
    this.walls = walls;
    this.W = L.nx * L.r + 1;
    this.ys = new Float32Array(this.W * (L.nz * L.r + 1)).fill(NaN);
  }

  // A triangle of the land (its corners [x, y, z]) cut along the walls' footprints: its pieces, each a
  // convex ring wound as the triangle is, its corners at their heights and the points the cut made at
  // h's, which steps under the wall: the pieces either side of it and under it, so the land has no
  // holes and no cracks. But a point on a side the triangle shares with a big cell that isn't split,
  // and so isn't cut, is on that side's line, as the big cell's own triangle is there. Null where no
  // wall meets it.
  cut(t: XYZ[]): XYZ[][] | null {
    if (!this.walls) return null;
    const xs = t.map((p) => p[0]);
    const zs = t.map((p) => p[2]);
    if (!this.walls.touches(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs))) return null;
    const key = t.map((p) => `${p[0]},${p[2]}`).join(';');
    if (this.pieces.has(key)) return this.pieces.get(key)!;
    const flat = t.map(([x, , z]): XZ => [x, z]);
    const c = this.walls.cut(flat);
    let out: XYZ[][] | null = null;
    if (c) {
      const wind = Math.sign(area(flat));
      const L = this.L;
      // Whether the side p–q lies along a big cell's side next to one that isn't split.
      const byCoarse = (p: XYZ, q: XYZ): boolean => {
        if (Math.abs(p[0] - q[0]) < 1e-6) {
          const i = Math.round((p[0] - L.x0) / L.C);
          if (Math.abs(L.x0 + i * L.C - p[0]) > 1e-6) return false;
          const j = Math.floor(((p[2] + q[2]) / 2 - L.z0) / L.C);
          return L.coarse(i - 1, j) || L.coarse(i, j);
        }
        if (Math.abs(p[2] - q[2]) < 1e-6) {
          const j = Math.round((p[2] - L.z0) / L.C);
          if (Math.abs(L.z0 + j * L.C - p[2]) > 1e-6) return false;
          const i = Math.floor(((p[0] + q[0]) / 2 - L.x0) / L.C);
          return L.coarse(i, j - 1) || L.coarse(i, j);
        }
        return false;
      };
      // A point on one of its sides is on the line both triangles that share the side agree on: the
      // side's own, where the cell across it is big and isn't cut; else through its ends and where the
      // walls' footprints cross it, at h's heights there (the cut also splits the land outside a
      // footprint along its sides' lines, which only one of the two triangles has).
      const W = this.walls;
      const along = (p: XYZ, q: XYZ, f: number): number => {
        if (byCoarse(p, q)) return p[1] + (q[1] - p[1]) * f;
        const s = [0, ...W.crossings([p[0], p[2]], [q[0], q[2]]), 1];
        const y = (g: number) => (g === 0 ? p[1] : g === 1 ? q[1] : this.h(p[0] + (q[0] - p[0]) * g, p[2] + (q[2] - p[2]) * g));
        for (let k = 1; k < s.length; k++) {
          if (Math.abs(f - s[k]) < 1e-9) return y(s[k]);
          if (f < s[k]) return y(s[k - 1]) + ((y(s[k]) - y(s[k - 1])) * (f - s[k - 1])) / (s[k] - s[k - 1]);
        }
        return q[1];
      };
      const at = ([x, z]: XZ): XYZ => {
        const corner = t.find((p) => Math.abs(p[0] - x) < 1e-6 && Math.abs(p[2] - z) < 1e-6);
        if (corner) return corner;
        for (let k = 0; k < 3; k++) {
          const p = t[k];
          const q = t[(k + 1) % 3];
          const [dx, dz] = [q[0] - p[0], q[2] - p[2]];
          const f = ((x - p[0]) * dx + (z - p[2]) * dz) / (dx * dx + dz * dz);
          if (f > 0 && f < 1 && Math.abs((x - p[0]) * dz - (z - p[2]) * dx) < 1e-6 * Math.hypot(dx, dz)) return [x, along(p, q, f), z];
        }
        return [x, this.h(x, z), z];
      };
      out = [...c.out, ...c.in.map((p) => p.pts)].map((r) => (Math.sign(area(r)) === wind ? r : r.slice().reverse()).map(at));
    }
    this.pieces.set(key, out);
    return out;
  }

  // The height of the lattice's point (ix, iz), in small cells from the box's corner.
  at(ix: number, iz: number): number {
    const k = iz * this.W + ix;
    let y = this.ys[k];
    if (y === y) return y;
    const { r, F, x0, z0 } = this.L;
    const ci = Math.floor(ix / r);
    const cj = Math.floor(iz / r);
    if (ix % r === 0 && iz % r === 0) y = this.h(x0 + ix * F, z0 + iz * F);
    else if (ix % r === 0 && (this.L.coarse(ix / r - 1, cj) || this.L.coarse(ix / r, cj))) y = this.at(ix, cj * r) + (this.at(ix, (cj + 1) * r) - this.at(ix, cj * r)) * ((iz % r) / r);
    else if (iz % r === 0 && (this.L.coarse(ci, iz / r - 1) || this.L.coarse(ci, iz / r))) y = this.at(ci * r, iz) + (this.at((ci + 1) * r, iz) - this.at(ci * r, iz)) * ((ix % r) / r);
    else y = this.h(x0 + ix * F, z0 + iz * F);
    this.ys[k] = y;
    return y;
  }

  // The height at (x, z) on the triangle of the lattice under it. Off the lattice, h's own.
  y(x: number, z: number): number {
    const L = this.L;
    const c = L.cellAt(x, z);
    if (c < 0) return this.h(x, z);
    const i = c % L.nx;
    const j = (c - i) / L.nx;
    // The cell (the big one, or the small one in a split cell) and how far across it (x, z) is.
    const n = L.fine[c] ? 1 : L.r;
    let a = i * L.r;
    let b = j * L.r;
    if (n === 1) {
      a = Math.min(Math.floor((x - L.x0) / L.F), (i + 1) * L.r - 1);
      b = Math.min(Math.floor((z - L.z0) / L.F), (j + 1) * L.r - 1);
    }
    const s = n * L.F;
    const u = (x - L.x0 - a * L.F) / s;
    const v = (z - L.z0 - b * L.F) / s;
    const y00 = this.at(a, b);
    const y10 = this.at(a + n, b);
    const y01 = this.at(a, b + n);
    const y11 = this.at(a + n, b + n);
    if (this.walls && n === 1) {
      // On the piece of the triangle a wall's cut leaves (x, z) in, where one meets it.
      const [x0, z0, x1, z1] = [L.x0 + a * L.F, L.z0 + b * L.F, L.x0 + (a + n) * L.F, L.z0 + (b + n) * L.F];
      const t: XYZ[] = u + v <= 1 ? [[x0, y00, z0], [x1, y10, z0], [x0, y01, z1]] : [[x1, y11, z1], [x0, y01, z1], [x1, y10, z0]];
      const pieces = this.cut(t);
      const y = pieces && onPieces(pieces, x, z);
      if (y != null) return y;
    }
    return u + v <= 1 ? y00 + (y10 - y00) * u + (y01 - y00) * v : y11 + (y01 - y11) * (1 - u) + (y10 - y11) * (1 - v);
  }

  // Where the segment from (ax, az) to (bx, bz) crosses the lattice's lines (every small cell's sides
  // and diagonals, which a big cell's two triangles lie across as well), as how far along it, from 0 to
  // 1: where something laid along the land bends with it.
  bends(ax: number, az: number, bx: number, bz: number): number[] {
    const { F, x0, z0 } = this.L;
    const ts = [0, 1];
    const cross = (a: number, b: number, off: number) => {
      if (Math.abs(b - a) < 1e-9) return;
      const lo = Math.ceil((Math.min(a, b) - off) / F);
      const hi = Math.floor((Math.max(a, b) - off) / F);
      for (let k = lo; k <= hi; k++) {
        const t = (off + k * F - a) / (b - a);
        if (t > 1e-6 && t < 1 - 1e-6) ts.push(t);
      }
    };
    cross(ax, bx, x0);
    cross(az, bz, z0);
    cross(ax + az, bx + bz, x0 + z0);
    return ts.sort((p, q) => p - q);
  }
}

type XZ = [number, number];
type XYZ = [number, number, number];

// The height at (x, z) on whichever of some convex pieces (corners [x, y, z]) it's in, each a fan of
// triangles from its first corner; null in none.
function onPieces(pieces: XYZ[][], x: number, z: number): number | null {
  for (const p of pieces) {
    for (let k = 1; k + 1 < p.length; k++) {
      const [a, b, c] = [p[0], p[k], p[k + 1]];
      const den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(den) < 1e-12) continue;
      const wa = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / den;
      const wb = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / den;
      const wc = 1 - wa - wb;
      if (wa >= -1e-7 && wb >= -1e-7 && wc >= -1e-7) return wa * a[1] + wb * b[1] + wc * c[1];
    }
  }
  return null;
}

// The land's holes (braga-map's task 079): the outlines it isn't drawn inside, the rooms'. A room's
// floors are drawn in its place, and the land under a building stands up through its ground floor
// where the ground rises under it. Each outline as convex pieces (its triangles merged), in cells of
// 10 m. A triangle of the land is cut to what's outside them: the land outside a room is just as it
// was, to the outline, where the facade stands on it.
export class Holes {
  private parts: { pts: XZ[]; ring: number; x0: number; z0: number; x1: number; z1: number }[] = [];
  private cells = new Map<number, number[]>();

  constructor(rings: readonly (readonly XZ[])[]) {
    rings.forEach((ring, k) => {
      for (const pts of convexOf(ring as XZ[])) {
        const xs = pts.map((p) => p[0]);
        const zs = pts.map((p) => p[1]);
        const n = this.parts.push({ pts, ring: k, x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) }) - 1;
        const p = this.parts[n];
        for (const c of cellsOf(p.x0, p.z0, p.x1, p.z1)) {
          const l = this.cells.get(c);
          if (l) l.push(n);
          else this.cells.set(c, [n]);
        }
      }
    });
  }

  // The pieces of holes whose box meets this one.
  private near(x0: number, z0: number, x1: number, z1: number): number[] {
    const out = new Set<number>();
    for (const c of cellsOf(x0, z0, x1, z1)) for (const n of this.cells.get(c) ?? []) out.add(n);
    return [...out].filter((n) => {
      const p = this.parts[n];
      return p.x1 > x0 && p.x0 < x1 && p.z1 > z0 && p.z0 < z1;
    });
  }

  // Where the segment a–b crosses the holes' sides: how far along it each crossing is, 0 to 1, in order.
  crossings(a: XZ, b: XZ): number[] {
    const out: number[] = [];
    const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
    for (const n of this.near(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]))) {
      const pts = this.parts[n].pts;
      for (let k = 0; k < pts.length; k++) {
        const [c, d] = [pts[k], pts[(k + 1) % pts.length]];
        const [ex, ez] = [d[0] - c[0], d[1] - c[1]];
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-12) continue;
        const s = ((c[0] - a[0]) * ez - (c[1] - a[1]) * ex) / den;
        const r = ((c[0] - a[0]) * dz - (c[1] - a[1]) * dx) / den;
        if (s > 1e-9 && s < 1 - 1e-9 && r >= -1e-9 && r <= 1 + 1e-9) out.push(s);
      }
    }
    return out.sort((p, q) => p - q);
  }

  // Whether a hole may meet the box.
  touches(x0: number, z0: number, x1: number, z1: number): boolean {
    for (const c of cellsOf(x0, z0, x1, z1)) {
      for (const n of this.cells.get(c) ?? []) {
        const p = this.parts[n];
        if (p.x1 > x0 && p.x0 < x1 && p.z1 > z0 && p.z0 < z1) return true;
      }
    }
    return false;
  }

  // A triangle (its corners, wound either way) less the holes: the convex pieces of it outside them
  // all, wound as it is; and those inside each, with its ring's number. Null where no hole meets it.
  cut(t: XZ[]): { out: XZ[][]; in: { ring: number; pts: XZ[] }[] } | null {
    const xs = t.map((p) => p[0]);
    const zs = t.map((p) => p[1]);
    const near = this.near(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)).filter((n) => overlaps(t, this.parts[n].pts));
    if (!near.length) return null;
    let out: XZ[][] = [t];
    const ins: { ring: number; pts: XZ[] }[] = [];
    for (const n of near) {
      const q = this.parts[n];
      const next: XZ[][] = [];
      for (const p of out) {
        if (!overlaps(p, q.pts)) {
          next.push(p);
          continue;
        }
        const m = minus(p, q.pts);
        next.push(...m.out);
        if (m.inside.length >= 3 && Math.abs(area(m.inside)) > 1e-6) ins.push({ ring: q.ring, pts: m.inside });
      }
      out = next;
    }
    return { out, in: ins };
  }
}

// The 10 m cells a box is in.
function cellsOf(x0: number, z0: number, x1: number, z1: number): number[] {
  const out: number[] = [];
  for (let j = Math.floor(z0 / 10); j <= Math.floor(z1 / 10); j++) for (let i = Math.floor(x0 / 10); i <= Math.floor(x1 / 10); i++) out.push(j * 100003 + i);
  return out;
}

// Twice a ring's area, positive one way round and negative the other.
function area(r: XZ[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a;
}

// Sutherland-Hodgman: a convex polygon cut down to where `keep` is positive (or nothing), wound as it is.
function half(poly: XZ[], keep: (p: XZ) => number): XZ[] {
  const out: XZ[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const kp = keep(p);
    const kq = keep(q);
    const add = (r: XZ) => {
      const l = out[out.length - 1];
      if (!l || Math.abs(l[0] - r[0]) + Math.abs(l[1] - r[1]) > 1e-9) out.push(r);
    };
    if (kp >= 0) add(p);
    if (kp >= 0 !== kq >= 0) {
      const t = kp / (kp - kq);
      add([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) + Math.abs(out[0][1] - out[out.length - 1][1]) <= 1e-9) out.pop();
  return out.length >= 3 && Math.abs(area(out)) > 1e-7 ? out : [];
}

// A convex polygon less a convex one: what's outside each of its sides in turn and inside those before
// (convex pieces that don't overlap), and what's inside it all.
function minus(a: XZ[], q: XZ[]): { out: XZ[][]; inside: XZ[] } {
  const s = area(q) > 0 ? 1 : -1;
  const out: XZ[][] = [];
  let rest = a;
  for (let i = 0; i < q.length; i++) {
    const [ax, az] = q[i];
    const [bx, bz] = q[(i + 1) % q.length];
    const f = (p: XZ) => s * ((bx - ax) * (p[1] - az) - (bz - az) * (p[0] - ax));
    const o = half(rest, (p) => -f(p));
    if (o.length) out.push(o);
    rest = half(rest, f);
    if (!rest.length) break;
  }
  return { out, inside: rest };
}

// Whether two convex polygons overlap by more than a hair (separating axes).
function overlaps(A: XZ[], B: XZ[]): boolean {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      const b = P[(i + 1) % P.length];
      const nx = b[1] - a[1];
      const nz = a[0] - b[0];
      if (Math.abs(nx) + Math.abs(nz) < 1e-9) continue;
      let a0 = Infinity;
      let a1 = -Infinity;
      let b0 = Infinity;
      let b1 = -Infinity;
      for (const p of A) [a0, a1] = [Math.min(a0, p[0] * nx + p[1] * nz), Math.max(a1, p[0] * nx + p[1] * nz)];
      for (const p of B) [b0, b1] = [Math.min(b0, p[0] * nx + p[1] * nz), Math.max(b1, p[0] * nx + p[1] * nz)];
      const eps = 1e-6 * Math.hypot(nx, nz);
      if (a1 <= b0 + eps || b1 <= a0 + eps) return false;
    }
  }
  return true;
}

// A ring as convex pieces: its triangles (ears clipped off it one by one), merged where they stay
// convex (roofs.ts's convexPieces).
function convexOf(ring: XZ[]): XZ[][] {
  const turn = (a: XZ, b: XZ, c: XZ) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  // Without a corner twice over, or one on a straight line between its neighbours.
  let pts = ring.slice();
  for (let again = true; again && pts.length > 3; ) {
    again = false;
    for (let k = 0; k < pts.length && pts.length > 3; k++) {
      const a = pts[(k + pts.length - 1) % pts.length];
      const b = pts[k];
      const c = pts[(k + 1) % pts.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6 || Math.abs(turn(a, b, c)) < 1e-9) {
        pts = pts.filter((_, i) => i !== k);
        again = true;
      }
    }
  }
  // Which way a convex corner turns, as the corner at its lowest point does.
  const sgn = turn(...lowest(pts)) > 0 ? 1 : -1;
  const idx = pts.map((_, i) => i);
  const tris: number[][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 1000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const [i, j, l] = [idx[(k + idx.length - 1) % idx.length], idx[k], idx[(k + 1) % idx.length]];
      if (sgn * turn(pts[i], pts[j], pts[l]) <= 1e-12) continue;
      if (idx.some((m) => m !== i && m !== j && m !== l && inTri(pts[m], pts[i], pts[j], pts[l]))) continue;
      tris.push([i, j, l]);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) tris.push([...idx]);
  return convexPieces(pts, tris).map((p) => p.map((i) => pts[i]));

  // The corner at the ring's lowest point and its two neighbours: convex, whichever way it's wound.
  function lowest(r: XZ[]): [XZ, XZ, XZ] {
    let m = 0;
    for (let i = 1; i < r.length; i++) if (r[i][0] < r[m][0] || (r[i][0] === r[m][0] && r[i][1] < r[m][1])) m = i;
    return [r[(m + r.length - 1) % r.length], r[m], r[(m + 1) % r.length]];
  }
}

function inTri(p: XZ, a: XZ, b: XZ, c: XZ): boolean {
  const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const d2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
  const d3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
