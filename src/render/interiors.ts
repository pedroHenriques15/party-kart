// The insides of the arenas' buildings (braga-map's task 079, world/interiors.ts), drawn plainly in one
// mesh: each room's walls' inside faces, 20 cm in from the facade, with the reveals round its doors
// and windows (city.ts cuts the openings through the facade); its floors and ceilings; and in a tower
// its stairs, its stairwell's walls, the parapet round its roof and the hut over the stairs. Plaster
// and concrete, its parapet and hut in the building's colour.
import type { World as Braga } from 'braga-map';
import * as THREE from 'three';
import { HUT, SKIN, SLAB, type Room } from '../world/interiors.ts';
import { linearOf, type Rgb } from './facades.ts';

type XZ = [number, number];

const PLASTER: Rgb = linearOf([226, 221, 210]);
const FLOOR: Rgb = linearOf([170, 160, 146]);
const CEILING: Rgb = linearOf([236, 232, 224]);
const CONCRETE: Rgb = linearOf([160, 155, 146]);

class Mesh {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  // A triangle facing n.
  tri(a: number[], b: number[], c: number[], n: number[], k: Rgb): void {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const m = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const order = m[0] * n[0] + m[1] * n[1] + m[2] * n[2] < 0 ? [a, c, b] : [a, b, c];
    for (const p of order) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(k[0], k[1], k[2]);
    }
  }
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], k: Rgb): void {
    this.tri(a, b, c, n, k);
    this.tri(a, c, d, n, k);
  }
  // A flat ring at height y, with holes, facing up or down.
  floor(ring: XZ[], holes: XZ[][], y: number, up: boolean, k: Rgb): void {
    const all = [...ring, ...holes.flat()];
    const V = (p: XZ) => new THREE.Vector2(p[0], p[1]);
    for (const [i, j, q] of THREE.ShapeUtils.triangulateShape(ring.map(V), holes.map((h) => h.map(V)))) {
      this.tri([all[i][0], y, all[i][1]], [all[j][0], y, all[j][1]], [all[q][0], y, all[q][1]], [0, up ? 1 : -1, 0], k);
    }
  }
  // An upright wall from a to b, y0 to y1, seen from both sides.
  wall(a: XZ, b: XZ, y0: number, y1: number, k: Rgb): void {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const n = [(b[1] - a[1]) / L, 0, -(b[0] - a[0]) / L];
    const p = [[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]];
    this.quad(p[0], p[1], p[2], p[3], n, k);
    this.quad(p[0], p[1], p[2], p[3], [-n[0], 0, -n[2]], k);
  }
  // A box over a ring of four, from y0 to y1: its top and its sides.
  box(r: XZ[], y0: number, y1: number, k: Rgb): void {
    this.floor(r, [], y1, true, k);
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      const cx = r.reduce((s, p) => s + p[0], 0) / r.length;
      const cz = r.reduce((s, p) => s + p[1], 0) / r.length;
      const L = Math.hypot(mx - cx, mz - cz) || 1;
      this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [(mx - cx) / L, 0, (mz - cz) / L], k);
    }
  }
  mesh(): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

export function buildInteriors(rooms: readonly Room[], map: Braga): THREE.Group {
  const out = new Mesh();
  for (const r of rooms) {
    const wallRgb = linearOf(map.facadeColours[r.b.facade.colour]);
    const top = r.tower ? r.levels[r.levels.length - 1] - SLAB : r.ceiling;
    // The walls' inside faces, each its side of the inside ring, with its openings moved in to it, and
    // the reveals round each opening from the facade to there.
    r.sides.forEach((sd, k) => {
      const a = r.inner[k];
      const b = r.inner[(k + 1) % r.inner.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.05 || sd.L < 0.05) return;
      const ux = (b[0] - a[0]) / L;
      const uz = (b[1] - a[1]) / L;
      // The outside's s to the inside's.
      const inS = (s: number) => (sd.a[0] + ((sd.b[0] - sd.a[0]) * s) / sd.L - sd.nx * SKIN - a[0]) * ux + (sd.a[1] + ((sd.b[1] - sd.a[1]) * s) / sd.L - sd.nz * SKIN - a[1]) * uz;
      const holes = sd.open.filter((o) => o.y0 < top && o.y1 > r.y).map((o) => ({ s0: Math.max(0.02, inS(o.s0)), s1: Math.min(L - 0.02, inS(o.s1)), y0: Math.max(r.y + 0.01, o.y0), y1: Math.min(top - 0.01, o.y1), o }));
      const V2 = (s: number, y: number) => new THREE.Vector2(s, y);
      const contour = [V2(0, r.y), V2(L, r.y), V2(L, top), V2(0, top)];
      const hs = holes.filter((h) => h.s1 > h.s0 + 0.05 && h.y1 > h.y0 + 0.05).map((h) => [V2(h.s0, h.y0), V2(h.s0, h.y1), V2(h.s1, h.y1), V2(h.s1, h.y0)]);
      const pts = [...contour, ...hs.flat()];
      const P = (v: THREE.Vector2) => [a[0] + ux * v.x, v.y, a[1] + uz * v.x];
      for (const [i, j, q] of THREE.ShapeUtils.triangulateShape(contour, hs)) out.tri(P(pts[i]), P(pts[j]), P(pts[q]), [-sd.nx, 0, -sd.nz], PLASTER);
      // The reveals: the jambs, the head and the sill, from the facade in.
      for (const o of sd.open) {
        const at = (s: number, y: number, d: number) => [sd.a[0] + ((sd.b[0] - sd.a[0]) * s) / sd.L - sd.nx * d, y, sd.a[1] + ((sd.b[1] - sd.a[1]) * s) / sd.L - sd.nz * d];
        const u = [(sd.b[0] - sd.a[0]) / sd.L, 0, (sd.b[1] - sd.a[1]) / sd.L];
        out.quad(at(o.s0, o.y0, 0), at(o.s0, o.y0, SKIN), at(o.s0, o.y1, SKIN), at(o.s0, o.y1, 0), u, PLASTER);
        out.quad(at(o.s1, o.y0, 0), at(o.s1, o.y0, SKIN), at(o.s1, o.y1, SKIN), at(o.s1, o.y1, 0), [-u[0], 0, -u[2]], PLASTER);
        out.quad(at(o.s0, o.y1, 0), at(o.s1, o.y1, 0), at(o.s1, o.y1, SKIN), at(o.s0, o.y1, SKIN), [0, -1, 0], PLASTER);
        out.quad(at(o.s0, o.y0, 0), at(o.s1, o.y0, 0), at(o.s1, o.y0, SKIN), at(o.s0, o.y0, SKIN), [0, 1, 0], PLASTER);
      }
    });
    // The floors and ceilings: the ground floor, the ceiling over it (in a tower, each floor's top and
    // the ceiling under it, open over the stairs, up to the roof's underside).
    out.floor(r.inner, [], r.y + 0.005, true, FLOOR);
    if (!r.tower) out.floor(r.inner, [], r.ceiling, false, CEILING);
    else {
      const hole = r.stair ? [r.stair.hole] : [];
      for (let i = 1; i < r.levels.length; i++) {
        if (i < r.levels.length - 1) out.floor(r.inner, hole, r.levels[i], true, FLOOR);
        out.floor(r.inner, hole, r.levels[i] - SLAB, false, CEILING);
      }
    }
    if (!r.stair) continue;
    // The stairs: each tread and landing a box, the stairwell's walls, the hut over them and its roof;
    // the parapet round the roof.
    for (const s of r.stair.steps) out.box(s.pts, s.y - 0.18, s.y, CONCRETE);
    for (const w of r.stair.walls) {
      const hut = w.y0 >= r.stair.hut.y - 0.2;
      out.wall([w.ax, w.az], [w.bx, w.bz], w.y0, w.y1, hut ? wallRgb : PLASTER);
    }
    const roof = r.stair.hut.y + HUT;
    out.floor(r.stair.hut.pts, [], roof, true, wallRgb);
    out.floor(r.stair.hut.pts, [], roof - 0.01, false, CEILING);
    for (const w of r.parapet) out.wall([w.ax, w.az], [w.bx, w.bz], w.y0, w.y1, wallRgb);
  }
  const g = new THREE.Group();
  if (out.pos.length) g.add(out.mesh());
  return g;
}
