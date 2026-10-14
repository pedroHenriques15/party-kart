// The lattice the land's mesh is made on (city.ts): cells of C metres over the box, each split into
// small cells of F metres where it needs them, and every cell two triangles, split from its (i + 1, j)
// corner to its (i, j + 1). A Surface is heights on it: the land's mesh is one, and what meets the
// land (a street's retaining wall) reads the land's height on it where it's drawn.
import type { Box } from 'braga-map';

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
// cell that isn't split, on the line between its corners, so the mesh made of it has no cracks.
export class Surface {
  readonly L: Lattice;
  readonly h: Height;
  private W: number;
  private ys: Float32Array;

  constructor(L: Lattice, h: Height) {
    this.L = L;
    this.h = h;
    this.W = L.nx * L.r + 1;
    this.ys = new Float32Array(this.W * (L.nz * L.r + 1)).fill(NaN);
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
