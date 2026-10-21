// The insides of the arenas' buildings (braga-map's task 079, world/interiors.ts): each room's walls'
// inside faces, 20 cm in from the facade, with the reveals round its doors and windows (city.ts cuts
// the openings through the facade, and leaves the land out under the room), a threshold at each door
// and a skirting board along the foot of every wall; its partitions, their doorways' lintels; its
// floors, each of its rooms' in what it's laid with (tiles, boards, concrete, carpet: a texture drawn
// here, darker towards the walls, as a room's corners are), and its ceilings with a light in each
// room; its furniture, in plain boxes; and in a tower its stairs, its stairwell's walls, the parapet
// round its roof and the hut over the stairs. Gathered by material, so all of it is six draws: the
// rest, the four floors and the lights.
import type { World as Braga } from 'braga-map';
import * as THREE from 'three';
import { HUT, inset, PART, SKIN, SLAB, inside, type Finish, type Room, type Solid, type Zone } from '../world/interiors.ts';
import { linearOf, type Rgb } from './facades.ts';
import { drawTexture } from './textures.ts';

type XZ = [number, number];
type V3 = [number, number, number];

const lin = (r: number, g: number, b: number): Rgb => linearOf([r, g, b]);
const times = (k: Rgb, f: number): Rgb => [k[0] * f, k[1] * f, k[2] * f];

// The walls' colours inside (a room has one of them, world/interiors.ts's tone): warm white, a pale
// sage, beige, a pale blue-grey, a blush and a greige, as plaster is painted.
const TONES: Rgb[] = [lin(226, 221, 210), lin(205, 214, 200), lin(216, 204, 186), lin(198, 207, 214), lin(222, 205, 194), lin(196, 191, 180)];
const CEILING = lin(236, 232, 224);
const CONCRETE = lin(160, 155, 146);
const SKIRTING = lin(112, 100, 88);
const SILL = lin(176, 170, 160);
// A floor's tint over its texture, by what's laid there.
const TINTS: Record<Finish, Rgb[]> = {
  tiles: [lin(236, 234, 228), lin(214, 222, 226), lin(232, 222, 206)],
  wood: [lin(255, 255, 255), lin(232, 222, 210), lin(255, 244, 228)],
  concrete: [lin(255, 255, 255), lin(236, 236, 232)],
  carpet: [lin(176, 186, 204), lin(204, 190, 168), lin(186, 186, 182)],
};
// How many metres a floor's texture repeats over.
const REPEAT: Record<Finish, number> = { tiles: 1.2, wood: 2.4, concrete: 3.2, carpet: 1.2 };
const FINISHES: Finish[] = ['tiles', 'wood', 'concrete', 'carpet'];

// The furniture's colours.
const WOODS = [lin(178, 140, 94), lin(160, 122, 80), lin(192, 158, 108)];
const DARK_WOOD = lin(92, 62, 40);
const FABRICS = [lin(118, 62, 52), lin(70, 86, 112), lin(92, 98, 78), lin(120, 112, 100)];
const METAL = lin(150, 154, 158);
const WHITE = lin(228, 228, 222);
const CABINET = lin(206, 200, 190);
const WORKTOP = lin(80, 78, 76);
const CLOTHS = [lin(232, 228, 216), lin(170, 52, 48), lin(64, 96, 72)];
const GOODS = [lin(196, 64, 52), lin(60, 110, 170), lin(230, 190, 70), lin(90, 150, 80), lin(220, 220, 214), lin(150, 96, 60), lin(120, 70, 140)];
const DARK = lin(40, 40, 42);

// A number from 0 to 1 for a place: the same in every browser, for picking a colour.
const pick = (x: number, z: number, k: number) => {
  const s = Math.sin(Math.round(x * 4) * 12.9898 + Math.round(z * 4) * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
};
const of = <T,>(list: T[], x: number, z: number, k = 0): T => list[Math.floor(pick(x, z, k) * list.length) % list.length];

class Mesh {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  // A triangle facing n, each corner its colour (one for all, or three).
  tri(a: number[], b: number[], c: number[], n: number[], k: Rgb | Rgb[], uv?: number[][]): void {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const m = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const ks = (k.length === 3 && typeof k[0] === 'number' ? [k, k, k] : k) as Rgb[];
    const order = m[0] * n[0] + m[1] * n[1] + m[2] * n[2] < 0 ? [0, 2, 1] : [0, 1, 2];
    const ps = [a, b, c];
    for (const i of order) {
      const p = ps[i];
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(ks[i][0], ks[i][1], ks[i][2]);
      if (uv) this.uv.push(uv[i][0], uv[i][1]);
    }
  }
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], k: Rgb | Rgb[]): void {
    const ks = (k.length === 3 && typeof k[0] === 'number' ? [k, k, k, k] : k) as Rgb[];
    this.tri(a, b, c, n, [ks[0], ks[1], ks[2]]);
    this.tri(a, c, d, n, [ks[0], ks[2], ks[3]]);
  }
  // A flat ring at height y, with holes, facing up or down; its corners' colours from `k` at each.
  floor(ring: XZ[], holes: XZ[][], y: number, up: boolean, k: Rgb | ((p: XZ) => Rgb), uv?: (p: XZ) => number[]): void {
    const all = [...ring, ...holes.flat()];
    const V = (p: XZ) => new THREE.Vector2(p[0], p[1]);
    const col = typeof k === 'function' ? k : () => k;
    for (const [i, j, q] of THREE.ShapeUtils.triangulateShape(ring.map(V), holes.map((h) => h.map(V)))) {
      const t = [all[i], all[j], all[q]];
      this.tri([t[0][0], y, t[0][1]], [t[1][0], y, t[1][1]], [t[2][0], y, t[2][1]], [0, up ? 1 : -1, 0], t.map(col), uv && t.map(uv));
    }
  }
  // An upright face from a to b, y0 to y1, facing n (or both ways).
  face(a: XZ, b: XZ, y0: number, y1: number, n: number[] | null, k: Rgb | Rgb[]): void {
    const p = [[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const out = n ?? [(b[1] - a[1]) / L, 0, -(b[0] - a[0]) / L];
    this.quad(p[0], p[1], p[2], p[3], out, k);
    if (!n) this.quad(p[0], p[1], p[2], p[3], [-out[0], 0, -out[2]], k);
  }
  // A box over a convex ring, from y0 to y1: its top and its sides, its foot a little darker (the
  // shade where it meets the floor); its bottom too if it's off the floor.
  box(r: XZ[], y0: number, y1: number, k: Rgb, bottom = false): void {
    const cx = r.reduce((s, p) => s + p[0], 0) / r.length;
    const cz = r.reduce((s, p) => s + p[1], 0) / r.length;
    this.floor(r, [], y1, true, times(k, 1.06));
    if (bottom) this.floor(r, [], y0, false, times(k, 0.7));
    const foot = times(k, bottom ? 0.85 : 0.62);
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const mx = (a[0] + b[0]) / 2 - cx;
      const mz = (a[1] + b[1]) / 2 - cz;
      const ex = b[0] - a[0];
      const ez = b[1] - a[1];
      const L = Math.hypot(ex, ez) || 1;
      // Out: square to the side, the way away from the middle.
      let n = [ez / L, 0, -ex / L];
      if (n[0] * mx + n[2] * mz < 0) n = [-n[0], 0, -n[2]];
      this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], n, [foot, foot, k, k]);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

// ---- The floors' textures, drawn here, their noise seeded ----

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function floorTexture(f: Finish): THREE.CanvasTexture {
  const rand = seeded(FINISHES.indexOf(f) + 7);
  const N = 256;
  const grain = (g: CanvasRenderingContext2D, n: number, a: number, size = 2) => {
    for (let i = 0; i < n; i++) {
      const v = Math.floor(rand() * 255);
      g.fillStyle = `rgba(${v},${v},${v},${a})`;
      g.fillRect(rand() * N, rand() * N, size, size);
    }
  };
  return drawTexture(N, N, (g) => {
    switch (f) {
      case 'tiles': {
        // Three by three tiles of 40 cm, each a shade of its own, in grout.
        g.fillStyle = '#9d9a94';
        g.fillRect(0, 0, N, N);
        const T = N / 3;
        for (let j = 0; j < 3; j++) {
          for (let i = 0; i < 3; i++) {
            const l = 225 + Math.floor(rand() * 22);
            g.fillStyle = `rgb(${l},${l - 2},${l - 6})`;
            g.fillRect(i * T + 1.5, j * T + 1.5, T - 3, T - 3);
          }
        }
        grain(g, 2500, 0.05);
        break;
      }
      case 'wood': {
        // Boards 12 cm wide, their joints staggered, with their grain.
        const rows = 20;
        const h = N / rows;
        for (let row = 0; row < rows; row++) {
          const joint = Math.floor(rand() * N);
          for (const x0 of [joint - N, joint]) {
            const l = 150 + Math.floor(rand() * 50);
            g.fillStyle = `rgb(${l},${Math.floor(l * 0.74)},${Math.floor(l * 0.5)})`;
            g.fillRect(x0, row * h, N, h);
            for (let k = 0; k < 6; k++) {
              g.fillStyle = `rgba(70,45,25,${0.08 + rand() * 0.12})`;
              g.fillRect(x0, row * h + rand() * h, N, 1);
            }
            g.fillStyle = 'rgba(40,25,15,0.55)';
            g.fillRect(x0, row * h, 1, h);
          }
          g.fillStyle = 'rgba(40,25,15,0.5)';
          g.fillRect(0, row * h, N, 1);
        }
        break;
      }
      case 'concrete': {
        g.fillStyle = '#b4b0a8';
        g.fillRect(0, 0, N, N);
        for (let i = 0; i < 40; i++) {
          g.fillStyle = `rgba(${rand() < 0.5 ? '90,88,84' : '220,216,208'},${0.04 + rand() * 0.06})`;
          g.beginPath();
          g.arc(rand() * N, rand() * N, 10 + rand() * 40, 0, Math.PI * 2);
          g.fill();
        }
        grain(g, 6000, 0.08);
        // A saw cut across it, where a slab ends.
        g.fillStyle = 'rgba(60,58,55,0.5)';
        g.fillRect(0, N - 2, N, 2);
        break;
      }
      case 'carpet': {
        g.fillStyle = '#c4c4c4';
        g.fillRect(0, 0, N, N);
        grain(g, 30000, 0.12, 1);
        break;
      }
    }
  });
}

export function buildInteriors(rooms: readonly Room[], map: Braga): THREE.Group {
  const out = new Mesh();
  const floors = new Map<Finish, Mesh>(FINISHES.map((f) => [f, new Mesh()]));
  const lights = new Mesh();
  for (const r of rooms) {
    const wallRgb = linearOf(map.facadeColours[r.b.facade.colour]);
    const tone = TONES[r.tone % TONES.length];
    const n = r.tower ? r.levels.length - 1 : 1;
    // Each floor's foot and the underside of what's over it: the ground floor's, and a tower's
    // storeys'.
    const bands = Array.from({ length: n }, (_, i) => [r.levels[i], r.tower ? r.levels[i + 1] - SLAB : r.ceiling]);
    // The walls' inside faces, each its side of the inside ring, a storey at a time, with its openings
    // moved in to it (a door a notch up from the floor), darker at their foot and in the corners; the
    // skirting along their foot; and the reveals round each opening from the facade to there.
    r.sides.forEach((sd, k) => {
      const a = r.inner[k];
      const b = r.inner[(k + 1) % r.inner.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.05 || sd.L < 0.05) return;
      const ux = (b[0] - a[0]) / L;
      const uz = (b[1] - a[1]) / L;
      const inN = [-sd.nx, 0, -sd.nz];
      // The outside's s to the inside's.
      const inS = (s: number) => (sd.a[0] + ((sd.b[0] - sd.a[0]) * s) / sd.L - sd.nx * SKIN - a[0]) * ux + (sd.a[1] + ((sd.b[1] - sd.a[1]) * s) / sd.L - sd.nz * SKIN - a[1]) * uz;
      const P = (s: number, y: number, d = 0) => [a[0] + ux * s - sd.nx * d, y, a[1] + uz * s - sd.nz * d];
      for (const [y0, y1] of bands) {
        const here = sd.open.filter((o) => o.y0 < y1 && o.y1 > y0);
        const clampS = (s: number) => Math.max(0.02, Math.min(L - 0.02, s));
        const notches = here.filter((o) => o.y0 <= y0 + 0.01).map((o) => ({ s0: clampS(inS(o.s0)), s1: clampS(inS(o.s1)), y: Math.min(y1 - 0.01, o.y1) })).filter((h) => h.s1 > h.s0 + 0.05).sort((p, q) => p.s0 - q.s0);
        const holes = here.filter((o) => o.y0 > y0 + 0.01).map((o) => ({ s0: clampS(inS(o.s0)), s1: clampS(inS(o.s1)), y0: Math.max(y0 + 0.01, o.y0), y1: Math.min(y1 - 0.01, o.y1) })).filter((h) => h.s1 > h.s0 + 0.05 && h.y1 > h.y0 + 0.05);
        const V2 = (s: number, y: number) => new THREE.Vector2(s, y);
        const contour = [V2(0, y0)];
        for (const h of notches) contour.push(V2(h.s0, y0), V2(h.s0, h.y), V2(h.s1, h.y), V2(h.s1, y0));
        contour.push(V2(L, y0), V2(L, y1), V2(0, y1));
        const hs = holes.map((h) => [V2(h.s0, h.y0), V2(h.s0, h.y1), V2(h.s1, h.y1), V2(h.s1, h.y0)]);
        const pts = [...contour, ...hs.flat()];
        // Darker at the foot and the head, and in the corners.
        const shade = (v: THREE.Vector2): Rgb => times(tone, (0.8 + 0.2 * Math.min(1, (v.y - y0) / 1.6)) * (v.y > y1 - 0.02 ? 0.94 : 1) * (v.x < 0.03 || v.x > L - 0.03 ? 0.9 : 1));
        for (const [i, j, q] of THREE.ShapeUtils.triangulateShape(contour, hs)) out.tri(P(pts[i].x, pts[i].y), P(pts[j].x, pts[j].y), P(pts[q].x, pts[q].y), inN, [shade(pts[i]), shade(pts[j]), shade(pts[q])]);
        // The skirting, but across a door.
        let s = 0;
        for (const h of [...notches, { s0: L, s1: L }]) {
          if (h.s0 - s > 0.05) {
            out.quad(P(s, y0, 0.015), P(h.s0, y0, 0.015), P(h.s0, y0 + 0.1, 0.015), P(s, y0 + 0.1, 0.015), inN, SKIRTING);
            out.quad(P(s, y0 + 0.1, 0), P(h.s0, y0 + 0.1, 0), P(h.s0, y0 + 0.1, 0.015), P(s, y0 + 0.1, 0.015), [0, 1, 0], SKIRTING);
          }
          s = h.s1;
        }
      }
      // The reveals: the jambs, the head and the sill, from the facade in; at a door, the threshold
      // across the wall at the floor, and its front down to where the facade's cut ends.
      for (const o of sd.open) {
        const at = (s: number, y: number, d: number) => [sd.a[0] + ((sd.b[0] - sd.a[0]) * s) / sd.L - sd.nx * d, y, sd.a[1] + ((sd.b[1] - sd.a[1]) * s) / sd.L - sd.nz * d];
        const u = [(sd.b[0] - sd.a[0]) / sd.L, 0, (sd.b[1] - sd.a[1]) / sd.L];
        const y0 = o.door ? r.y : o.y0;
        const rev = times(tone, 0.92);
        out.quad(at(o.s0, y0, 0), at(o.s0, y0, SKIN), at(o.s0, o.y1, SKIN), at(o.s0, o.y1, 0), u, rev);
        out.quad(at(o.s1, y0, 0), at(o.s1, y0, SKIN), at(o.s1, o.y1, SKIN), at(o.s1, o.y1, 0), [-u[0], 0, -u[2]], rev);
        out.quad(at(o.s0, o.y1, 0), at(o.s1, o.y1, 0), at(o.s1, o.y1, SKIN), at(o.s0, o.y1, SKIN), [0, -1, 0], rev);
        if (!o.door) out.quad(at(o.s0, o.y0, 0), at(o.s1, o.y0, 0), at(o.s1, o.y0, SKIN), at(o.s0, o.y0, SKIN), [0, 1, 0], SILL);
        else {
          out.quad(at(o.s0, r.y + 0.005, -0.02), at(o.s1, r.y + 0.005, -0.02), at(o.s1, r.y + 0.005, SKIN + 0.01), at(o.s0, r.y + 0.005, SKIN + 0.01), [0, 1, 0], SILL);
          out.quad(at(o.s0, o.y0, -0.02), at(o.s1, o.y0, -0.02), at(o.s1, r.y + 0.005, -0.02), at(o.s0, r.y + 0.005, -0.02), [sd.nx, 0, sd.nz], times(SILL, 0.8));
        }
      }
    });

    // The walls of a building that stands into the room (the map's outlines overlap now and then),
    // plastered on the room's side, a little in front of them: else they're seen from behind.
    for (const o of r.intruders) {
      for (let k = 0; k < o.length; k++) {
        const a = o[k];
        const b = o[(k + 1) % o.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.01) continue;
        const ts = [0, 1];
        for (let j = 0; j < r.inner.length; j++) {
          const c = r.inner[j];
          const d = r.inner[(j + 1) % r.inner.length];
          const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
          if (Math.abs(den) < 1e-12) continue;
          const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
          const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
          if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
        }
        ts.sort((p, q) => p - q);
        let nn: XZ = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
        const mx = (a[0] + b[0]) / 2;
        const mz = (a[1] + b[1]) / 2;
        if (inside(o, mx + nn[0] * 0.05, mz + nn[1] * 0.05)) nn = [-nn[0], -nn[1]];
        for (let i = 0; i + 1 < ts.length; i++) {
          const tm = (ts[i] + ts[i + 1]) / 2;
          if (!inside(r.inner, a[0] + (b[0] - a[0]) * tm, a[1] + (b[1] - a[1]) * tm)) continue;
          const P = (t: number): XZ => [a[0] + (b[0] - a[0]) * t + nn[0] * 0.02, a[1] + (b[1] - a[1]) * t + nn[1] * 0.02];
          for (const [y0, y1] of bands) out.face(P(ts[i]), P(ts[i + 1]), y0, y1, [nn[0], 0, nn[1]], [times(tone, 0.8), times(tone, 0.8), tone, tone]);
        }
      }
    }

    // Each room of each floor: its floor, in what it's laid with, darker towards its walls; its
    // ceiling, open over the stairs in a tower; and a light in it, two in a big one.
    const hole = r.stair?.hole ?? null;
    for (const z of r.zones) zone(r, z, hole, floors, out, lights);

    // The partitions: each piece a slab PART thick, in a shade of the walls, with its skirting; a
    // lintel's underside.
    for (const w of r.partitions) {
      const L = Math.hypot(w.bx - w.ax, w.bz - w.az);
      if (L < 0.01) continue;
      const e: XZ = [(w.bx - w.ax) / L, (w.bz - w.az) / L];
      const h: XZ = [(-e[1] * PART) / 2, (e[0] * PART) / 2];
      const ring: XZ[] = [[w.ax - h[0], w.az - h[1]], [w.bx - h[0], w.bz - h[1]], [w.bx + h[0], w.bz + h[1]], [w.ax + h[0], w.az + h[1]]];
      const lintel = !r.levels.some((l) => Math.abs(l - 0.05 - w.y0) < 1e-6);
      const foot = lintel ? w.y0 : w.y0 + 0.05;
      out.box(ring, foot, w.y1, times(tone, 0.96), lintel);
      if (!lintel) {
        for (const s of [1, -1]) {
          const o: XZ = [-e[1] * (PART / 2 + 0.012) * s, e[0] * (PART / 2 + 0.012) * s];
          out.face([w.ax + o[0], w.az + o[1]], [w.bx + o[0], w.bz + o[1]], foot, foot + 0.1, [o[0] / Math.hypot(...o), 0, o[1] / Math.hypot(...o)], SKIRTING);
        }
      }
    }

    // The furniture.
    for (const s of r.solids) thing(out, s);

    if (!r.stair) continue;
    // The stairs: each tread and landing a box, the stairwell's walls, the hut over them and its roof;
    // the parapet round the roof.
    for (const s of r.stair.steps) out.box(s.pts, s.y - 0.18, s.y, CONCRETE, true);
    for (const w of r.stair.walls) {
      const hut = w.y0 >= r.stair.hut.y - 0.2;
      out.face([w.ax, w.az], [w.bx, w.bz], w.y0, w.y1, null, hut ? wallRgb : tone);
    }
    const roof = r.stair.hut.y + HUT;
    out.floor(r.stair.hut.pts, [], roof, true, wallRgb);
    out.floor(r.stair.hut.pts, [], roof - 0.01, false, CEILING);
    for (const w of r.parapet) out.face([w.ax, w.az], [w.bx, w.bz], w.y0, w.y1, null, wallRgb);
  }

  const g = new THREE.Group();
  if (out.pos.length) {
    const m = new THREE.Mesh(out.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  for (const [f, mesh] of floors) {
    if (!mesh.pos.length) continue;
    const t = floorTexture(f);
    const m = new THREE.Mesh(mesh.geometry(), new THREE.MeshStandardMaterial({ map: t, vertexColors: true, roughness: f === 'tiles' ? 0.6 : f === 'wood' ? 0.75 : 0.95 }));
    m.receiveShadow = true;
    g.add(m);
  }
  if (lights.pos.length) g.add(new THREE.Mesh(lights.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));
  return g;
}

// A room of a floor: its floor over its outline (a strip round it shaded towards the walls, where the
// outline moves in cleanly and the stairs don't cut it), its ceiling, and its lights.
function zone(r: Room, z: Zone, hole: XZ[] | null, floors: Map<Finish, Mesh>, out: Mesh, lights: Mesh): void {
  const [ux, uz] = r.axis;
  const S = REPEAT[z.finish];
  const uv = (p: XZ) => [(p[0] * ux + p[1] * uz) / S, (-p[0] * uz + p[1] * ux) / S];
  const cx = z.pts.reduce((s, p) => s + p[0], 0) / z.pts.length;
  const cz = z.pts.reduce((s, p) => s + p[1], 0) / z.pts.length;
  const tint = of(TINTS[z.finish], cx, cz, 1);
  const holed = !!hole && inside(z.pts, hole.reduce((s, p) => s + p[0], 0) / 4, hole.reduce((s, p) => s + p[1], 0) / 4);
  const up = z.y > r.y + 0.5;
  const fl = floors.get(z.finish)!;
  const y = z.y + 0.005;
  const ring = holed ? null : inset(z.pts, 0.45);
  if (!ring) fl.floor(z.pts, holed && up ? [hole!] : [], y, true, times(tint, 0.92), uv);
  else {
    const dark = times(tint, 0.66);
    for (let k = 0; k < z.pts.length; k++) {
      const a = z.pts[k];
      const b = z.pts[(k + 1) % z.pts.length];
      const c = ring[(k + 1) % ring.length];
      const d = ring[k];
      fl.tri([a[0], y, a[1]], [b[0], y, b[1]], [c[0], y, c[1]], [0, 1, 0], [dark, dark, tint], [uv(a), uv(b), uv(c)]);
      fl.tri([a[0], y, a[1]], [c[0], y, c[1]], [d[0], y, d[1]], [0, 1, 0], [dark, tint, tint], [uv(a), uv(c), uv(d)]);
    }
    fl.floor(ring, [], y, true, tint, uv);
  }
  if (!Number.isFinite(z.top)) return;
  out.floor(z.pts, holed ? [hole!] : [], z.top, false, CEILING);
  // The lights: panels 1.2 m by 30 cm along the room, a light grey frame round each.
  const area = Math.abs(z.pts.reduce((s, p, i) => s + p[0] * z.pts[(i + 1) % z.pts.length][1] - z.pts[(i + 1) % z.pts.length][0] * p[1], 0) / 2);
  const along = Math.max(...z.pts.map((p) => p[0] * ux + p[1] * uz)) - Math.min(...z.pts.map((p) => p[0] * ux + p[1] * uz));
  const spots: XZ[] = area > 22 && along > 5 ? [[cx - ux * along * 0.22, cz - uz * along * 0.22], [cx + ux * along * 0.22, cz + uz * along * 0.22]] : [[cx, cz]];
  for (const [x, zz] of spots) {
    if (!inside(z.pts, x, zz) || (hole && inside(hole, x, zz))) continue;
    const panel = (w: number, d: number): XZ[] => [
      [x - ux * w - -uz * d, zz - uz * w - ux * d],
      [x + ux * w - -uz * d, zz + uz * w - ux * d],
      [x + ux * w + -uz * d, zz + uz * w + ux * d],
      [x - ux * w + -uz * d, zz - uz * w + ux * d],
    ];
    out.floor(panel(0.66, 0.2), [], z.top - 0.01, false, lin(200, 200, 196));
    lights.floor(panel(0.6, 0.14), [], z.top - 0.02, false, [1.0, 0.97, 0.9]);
  }
}

// A piece of furniture, as what it is: its boxes, its back (pts[0] to pts[1]) to the wall.
function thing(out: Mesh, s: Solid): void {
  const [p0, p1, p2, p3] = s.pts;
  const cx = (p0[0] + p2[0]) / 2;
  const cz = (p0[1] + p2[1]) / 2;
  const w = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const d = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  const e: XZ = [(p1[0] - p0[0]) / w, (p1[1] - p0[1]) / w];
  const n: XZ = [(p3[0] - p0[0]) / d, (p3[1] - p0[1]) / d];
  // A box inside its outline: from a0 to a1 along its back, d0 to d1 deep, y0 to y1.
  const at = (a: number, dd: number): XZ => [p0[0] + e[0] * a + n[0] * dd, p0[1] + e[1] * a + n[1] * dd];
  const part = (a0: number, a1: number, d0: number, d1: number, y0: number, y1: number, k: Rgb, bottom = false) => out.box([at(a0, d0), at(a1, d0), at(a1, d1), at(a0, d1)], y0, y1, k, bottom);
  // A thin face on its front, at a and up from y0 to y1, w wide.
  const front = (a0: number, a1: number, y0: number, y1: number, k: Rgb, dd = d + 0.006) => out.face(at(a0, dd), at(a1, dd), y0, y1, [n[0], 0, n[1]], k);
  const { y0, y1 } = s;
  const h = y1 - y0;
  switch (s.kind) {
    case 'crate': {
      const k = of(WOODS, cx, cz);
      out.box(s.pts, y0, y1, k);
      // Its frame: a post at each corner and a band round its middle, a shade darker.
      const dk = times(k, 0.72);
      for (const [a, dd] of [[0, 0], [w - 0.07, 0], [w - 0.07, d - 0.07], [0, d - 0.07]]) part(a - 0.01, a + 0.08, dd - 0.01, dd + 0.08, y0, y1 + 0.004, dk);
      part(-0.008, w + 0.008, -0.008, d + 0.008, y0 + h / 2 - 0.04, y0 + h / 2 + 0.04, dk);
      break;
    }
    case 'shelf': {
      // A metal frame open at the front, its back closed, its shelves stocked.
      const k = METAL;
      part(0, w, 0, 0.03, y0, y1, times(k, 0.8));
      part(0, 0.04, 0, d, y0, y1, k);
      part(w - 0.04, w, 0, d, y0, y1, k);
      const rows = 4;
      for (let i = 0; i <= rows; i++) {
        const y = y0 + 0.08 + ((h - 0.1) * i) / rows;
        part(0.04, w - 0.04, 0.03, d, y - 0.025, y, k, true);
        if (i === rows) continue;
        // The goods on it: boxes and tins in a row, a gap here and there.
        let a = 0.06;
        let j = 0;
        while (a < w - 0.12) {
          const bw = 0.12 + pick(cx + a, cz, i * 7 + j) * 0.22;
          if (a + bw > w - 0.06) break;
          if (pick(cx, cz + a, i + j * 3) > 0.15) part(a, a + bw - 0.015, 0.06, d - 0.04 - pick(cz, a, j) * 0.1, y, y + 0.12 + pick(a, cx, i) * ((h - 0.1) / rows - 0.2), of(GOODS, cx + a, cz + i, j));
          a += bw;
          j++;
        }
      }
      break;
    }
    case 'wardrobe': {
      out.box(s.pts, y0, y1, of(WOODS, cx, cz, 2));
      front(w / 2 - 0.006, w / 2 + 0.006, y0 + 0.05, y1 - 0.05, DARK_WOOD);
      for (const a of [w / 2 - 0.08, w / 2 + 0.06]) front(a, a + 0.02, y0 + 0.9, y0 + 1.15, METAL, d + 0.012);
      break;
    }
    case 'counter': {
      part(0, w, 0, d - 0.03, y0, y1 - 0.04, CABINET);
      part(0, w, 0, d - 0.02, y0, y0 + 0.1, times(CABINET, 0.6));
      part(0, w, 0, d + 0.02, y1 - 0.04, y1, WORKTOP, true);
      for (let a = 0.6; a < w - 0.1; a += 0.6) front(a - 0.004, a + 0.004, y0 + 0.12, y1 - 0.06, times(CABINET, 0.75), d - 0.025);
      break;
    }
    case 'bar': {
      part(0, w, 0.02, d - 0.02, y0, y1 - 0.05, DARK_WOOD);
      part(-0.05, w + 0.05, -0.05, d + 0.05, y1 - 0.05, y1, lin(60, 42, 30), true);
      // A brass rail along each side, low down.
      for (const dd of [-0.12, d + 0.08]) part(0.1, w - 0.1, dd, dd + 0.04, y0 + 0.18, y0 + 0.22, lin(196, 160, 80), true);
      break;
    }
    case 'table': {
      // A table with its cloth down to the floor (a box to shoot at is a box to see).
      part(0, w, 0, d, y0, y1 - 0.03, of(CLOTHS, cx, cz));
      part(-0.03, w + 0.03, -0.03, d + 0.03, y1 - 0.03, y1, of(WOODS, cx, cz, 3), true);
      break;
    }
    case 'desk': {
      part(0, w, 0, d, y1 - 0.035, y1, lin(214, 206, 190), true);
      part(0, 0.04, 0, d, y0, y1 - 0.035, lin(120, 124, 128));
      part(w - 0.04, w, 0, d, y0, y1 - 0.035, lin(120, 124, 128));
      part(0.04, w - 0.04, 0.02, d - 0.02, y0 + 0.02, y1 - 0.035, lin(150, 152, 156));
      // A screen on it, now and then.
      if (pick(cx, cz, 5) > 0.4) part(w / 2 - 0.25, w / 2 + 0.25, 0.12, 0.16, y1, y1 + 0.32, DARK);
      break;
    }
    case 'sofa': {
      const k = of(FABRICS, cx, cz);
      out.box(s.pts, y0, y1, k);
      // Its arms, a little over the seat at each end.
      for (const a of [0, w - 0.18]) part(a, a + 0.18, 0, d, y1, y1 + 0.17, times(k, 0.9));
      break;
    }
    case 'sofa-back':
      // The back over the seat (0.9 m deep, its middle 45 cm out from the wall): the seat's cloth.
      out.box(s.pts, y0, y1, times(of(FABRICS, (p0[0] + p1[0]) / 2 + n[0] * 0.45, (p0[1] + p1[1]) / 2 + n[1] * 0.45), 0.85));
      break;
    case 'bed': {
      part(0, w, 0, d, y0, y0 + 0.28, DARK_WOOD);
      part(0.03, w - 0.03, 0.03, d - 0.03, y0 + 0.28, y1, lin(236, 234, 228));
      part(0.01, w - 0.01, 0.65, d + 0.01, y0 + 0.2, y1 + 0.03, of(FABRICS, cx, cz, 4));
      part(0.15, w / 2 - 0.05, 0.12, 0.5, y1, y1 + 0.1, WHITE);
      part(w / 2 + 0.05, w - 0.15, 0.12, 0.5, y1, y1 + 0.1, WHITE);
      break;
    }
    case 'headboard':
      out.box(s.pts, y0 - 0.5, y1, DARK_WOOD);
      break;
    case 'fridge': {
      out.box(s.pts, y0, y1, WHITE);
      front(0, w, y0 + 1.18, y0 + 1.2, times(WHITE, 0.6));
      front(w - 0.08, w - 0.05, y0 + 1.3, y0 + 1.7, METAL, d + 0.02);
      front(w - 0.08, w - 0.05, y0 + 0.75, y0 + 1.05, METAL, d + 0.02);
      break;
    }
    case 'unit': {
      // A roof's air conditioning unit: grey, a fan's grille on top, vents down its sides.
      out.box(s.pts, y0, y1, lin(176, 178, 176));
      part(w / 2 - 0.32, w / 2 + 0.32, d / 2 - 0.32, d / 2 + 0.32, y1, y1 + 0.006, DARK);
      for (let a = 0.12; a < w - 0.1; a += 0.1) front(a, a + 0.04, y0 + 0.15, y1 - 0.15, times(lin(176, 178, 176), 0.6));
      break;
    }
  }
}
