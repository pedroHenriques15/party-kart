// The land as the game has it, for the simulation and the drawing alike, so a car stands on the
// ground that's drawn: braga-map's ground (DGT's LiDAR), held down at the tunnels' road in front of
// each mouth and in its throat, the stadium's ground level in its bowl, and the Rio Este's bed cut
// through it.
import type { Box, World as Braga } from 'braga-map';
import { distanceToRoad, type Track } from '../track/track.ts';

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const THROAT = 4.5; // how far into a tunnel its mouth's concrete reaches

// A tunnel's mouth: where it is, its road's height there, the way out of the tunnel, and how wide
// its opening is.
export interface Mouth {
  x: number;
  z: number;
  y: number;
  ux: number;
  uz: number;
  w: number;
}

// A mouth's concrete (levels.ts draws it, and cars hit it): how wide its opening is, how far the
// concrete reaches either side of its middle, and its top, up to the ground over the tunnel.
export function mouthShape(m: Mouth, land: (x: number, z: number) => number): { open: number; half: number; top: number } {
  const open = Math.max(6, m.w + 1);
  return { open, half: open / 2 + 1.2, top: Math.max(land(m.x - m.ux * 8, m.z - m.uz * 8) + 0.4, m.y + 5.6) };
}

// The tunnels' mouths: where a tunnel's end meets a street that isn't in one. Two carriageways going
// in side by side, the same way, share one mouth as wide as both.
export function mouths(map: Braga): Mouth[] {
  const ends = map.lines.filter((l) => l.level !== 'tunnel').flatMap((l) => [l.pts[0], l.pts[l.pts.length - 1]]);
  const out: Mouth[] = [];
  for (const l of map.lines) {
    if (l.level !== 'tunnel' || !l.heights || l.pts.length < 2) continue;
    const n = l.pts.length;
    for (const [k, k2] of [[0, 1], [n - 1, n - 2]]) {
      const [x, z] = l.pts[k];
      if (!ends.some(([ex, ez]) => Math.hypot(ex - x, ez - z) < 1.5)) continue;
      const [px, pz] = l.pts[k2];
      const L = Math.hypot(x - px, z - pz) || 1;
      out.push({ x, z, y: l.heights[k], ux: (x - px) / L, uz: (z - pz) / L, w: l.w });
    }
  }
  const merged: Mouth[] = [];
  for (const m of out) {
    const o = merged.find((q) => Math.hypot(q.x - m.x, q.z - m.z) < q.w / 2 + m.w / 2 + 6 && q.ux * m.ux + q.uz * m.uz > 0.9);
    if (!o) {
      merged.push({ ...m });
      continue;
    }
    // One mouth across both: from the outer side of the one to the outer side of the other.
    const b = -(m.x - o.x) * o.uz + (m.z - o.z) * o.ux;
    const lo = Math.min(-o.w / 2, b - m.w / 2);
    const hi = Math.max(o.w / 2, b + m.w / 2);
    const mid = (lo + hi) / 2;
    o.x += -o.uz * mid;
    o.z += o.ux * mid;
    o.w = hi - lo;
    o.y = Math.min(o.y, m.y);
  }
  return merged;
}

// A stretch of the river, its water's height at either end.
export interface Reach {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  ya: number;
  yb: number;
}

export interface Land {
  // The land's height at (x, z), as drawn.
  land: (x: number, z: number) => number;
  // The same without the river's bed cut into it: what a street stands on, so one beside the river,
  // or over it at the ground's level, keeps its height.
  firm: (x: number, z: number) => number;
  // The Rio Este in the box, and how far (x, z) is from its middle, with the water's height there
  // (d is Infinity more than 80 m from it).
  river: Reach[];
  riverAt: (x: number, z: number) => { d: number; y: number };
  // The river's half width.
  HW: number;
  openings: Mouth[];
}

// How far the stadium's bowl takes to ease to nothing before a street, in metres.
export const BOWL_EASE = 10;

// How far (x, z) is from the nearest carriageway or pavement on the ground, in the box, up to `far`
// metres (`far` beyond it, and outside the box): on a grid of half a metre, each cell in a street
// or not by its middle, and the distance between cells as a chamfer of straight and diagonal steps,
// read between the four cells round (x, z) so it has no steps of its own.
export function streetDistance(map: Braga, B: Box, far: number): (x: number, z: number) => number {
  const S = 0.5;
  const nx = Math.ceil((B.x1 - B.x0) / S) + 1;
  const nz = Math.ceil((B.z1 - B.z0) / S) + 1;
  const d = new Float32Array(nx * nz).fill(far);
  const pieces = [...map.streets.carriageways, ...map.streets.pavements].filter((p) => p.level === 'ground');
  for (const p of pieces) {
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const [, z] of p.rings[0]) {
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    // Each row of cells the piece spans: where its rings' edges cross the row's middle, filled
    // between each two (its holes, as rings of their own, left out).
    for (let j = Math.max(0, Math.ceil((z0 - B.z0) / S)); j <= Math.min(nz - 1, Math.floor((z1 - B.z0) / S)); j++) {
      const z = B.z0 + j * S;
      const xs: number[] = [];
      for (const r of p.rings) {
        for (let k = 0, m = r.length - 1; k < r.length; m = k++) {
          const [ax, az] = r[m];
          const [bx, bz] = r[k];
          if (az > z !== bz > z) xs.push(ax + ((z - az) * (bx - ax)) / (bz - az));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let i = Math.max(0, Math.ceil((xs[k] - B.x0) / S)); i <= Math.min(nx - 1, Math.floor((xs[k + 1] - B.x0) / S)); i++) d[j * nx + i] = 0;
      }
    }
  }
  const D = S * Math.SQRT2;
  const step = (i: number, j: number, di: number, dj: number, w: number) => {
    const a = i + di;
    const b = j + dj;
    if (a >= 0 && a < nx && b >= 0 && b < nz) d[j * nx + i] = Math.min(d[j * nx + i], d[b * nx + a] + w);
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      step(i, j, -1, 0, S);
      step(i, j, 0, -1, S);
      step(i, j, -1, -1, D);
      step(i, j, 1, -1, D);
    }
  }
  for (let j = nz - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      step(i, j, 1, 0, S);
      step(i, j, 0, 1, S);
      step(i, j, 1, 1, D);
      step(i, j, -1, 1, D);
    }
  }
  return (x, z) => {
    const u = (x - B.x0) / S;
    const v = (z - B.z0) / S;
    if (u < 0 || v < 0 || u > nx - 1 || v > nz - 1) return far;
    const i = Math.min(nx - 2, Math.floor(u));
    const j = Math.min(nz - 2, Math.floor(v));
    const fu = u - i;
    const fv = v - j;
    const at = (a: number, b: number) => d[b * nx + a];
    return (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv;
  };
}

// Whether the segment from (ax, az) to (bx, bz) crosses the one from (cx, cz) to (dx, dz).
function crosses(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// ---- The land at a retaining wall (braga-map's task 111) ----

// How far either side of a retaining wall of the map's the land is held to that side's own: braga-map's
// ground is a 2 m grid, whose ramp across a wall reaches 2 m past the terrain's step, and the map's
// line is about 0.75 m off the step either way (its decision 059).
export const STEP_REACH = 3;
// The least step a retaining wall holds the land either side of, and how far in from each of its ends
// it comes to the whole of it.
const STEP_MIN = 0.5;
const STEP_END = 1.5;

// A stretch of one of the map's retaining walls on the ground, one that stands STEP_MIN or more over its
// lower side: its ends, half how thick it is, and how far along the wall it starts, of the wall's whole
// length; and which wall it is. The higher ground is on the left of its line (braga-map's walls).
export interface Stretch {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
  s0: number;
  len: number;
  wall: number;
}

export function retainingStretches(map: Braga): Stretch[] {
  const out: Stretch[] = [];
  for (const [wall, w] of map.walls.entries()) {
    if (w.kind !== 'retaining' || w.level !== 'ground' || w.h < STEP_MIN) continue;
    let len = 0;
    for (let k = 1; k < w.pts.length; k++) len += Math.hypot(w.pts[k][0] - w.pts[k - 1][0], w.pts[k][1] - w.pts[k - 1][1]);
    let s0 = 0;
    for (let k = 1; k < w.pts.length; k++) {
      const [ax, az] = w.pts[k - 1];
      const [bx, bz] = w.pts[k];
      const L = Math.hypot(bx - ax, bz - az);
      if (L > 0.05) out.push({ ax, az, bx, bz, half: Math.max(0.15, w.w / 2), s0, len, wall });
      s0 += L;
    }
  }
  return out;
}

// Each stretch's footprint, as thick as the wall and as long again past its ends, so two stretches
// overlap at a bend: what the land's mesh is cut along, so it steps under the wall (lattice.ts).
export function wallFootprints(stretches: Stretch[]): [number, number][][] {
  return stretches.map((s) => {
    const L = Math.hypot(s.bx - s.ax, s.bz - s.az);
    const ux = ((s.bx - s.ax) / L) * s.half;
    const uz = ((s.bz - s.az) / L) * s.half;
    return [
      [s.ax - ux - uz, s.az - uz + ux],
      [s.bx + ux - uz, s.bz + uz + ux],
      [s.bx + ux + uz, s.bz + uz - ux],
      [s.ax - ux + uz, s.az - uz - ux],
    ];
  });
}

// The land held either side of the map's retaining walls. A 2 m grid can't step along a line that runs
// across it at a slant: it ramps from the lower side's ground to the higher's, and stood up to a metre
// or more in front of a wall's face, through a street at its foot, and curled the street up to it
// (task 111's white shards in the Travessa Conselheiro Lobato), and sank a street on its top down to it.
// Within STEP_REACH of a wall, the land on its lower side is held down to that side's ground STEP_REACH
// out, past the grid's ramp, and on its higher side up to that side's: so the land steps under the
// wall, whose face and top stand over the step. (Its own top, and its top less its height, braga-map
// measured 1.75 m either side and as the step's upper quarter: held to them, a street at its foot was
// held up to a metre over itself.) A side's ground is never taken past another wall, but half way to
// it: so between two walls a few metres apart (a street between the one above it and the one below, a
// terrace's two tiers as on the Monte da Forca), both hold the land to the same ground, not one to the
// other's foot and the other to its top. Eased out over the last metre of STEP_REACH and the first and
// last STEP_END metres of the wall, where its face tapers out; and none where the two sides' ground is
// within STEP_MIN.
export function heldAtWalls(stretches: Stretch[], nat: (x: number, z: number) => number): (x: number, z: number) => number {
  const C = 10;
  const cells = new Map<number, Stretch[]>();
  for (const s of stretches) {
    for (let i = Math.floor((Math.min(s.ax, s.bx) - STEP_REACH) / C); i <= Math.floor((Math.max(s.ax, s.bx) + STEP_REACH) / C); i++) {
      for (let j = Math.floor((Math.min(s.az, s.bz) - STEP_REACH) / C); j <= Math.floor((Math.max(s.az, s.bz) + STEP_REACH) / C); j++) {
        const k = j * 100003 + i;
        const l = cells.get(k);
        if (l) l.push(s);
        else cells.set(k, [s]);
      }
    }
  }
  const at = (x: number, z: number) => cells.get(Math.floor(z / C) * 100003 + Math.floor(x / C)) ?? [];
  // How far out from (px, pz) on a stretch, the way (ux, uz), its side's ground is taken: STEP_REACH, or
  // half way to another wall alongside it that comes first (one within 37° of it, and across from it: not
  // one it meets at a corner, nor one that goes on from its end), 1.5 m or more out: one nearer is the
  // same step twice, each line up to 0.75 m off it (braga-map's decision 059).
  const reach = (s: Stretch, px: number, pz: number, ux: number, uz: number): number => {
    let t = STEP_REACH * 2;
    const seen = new Set<Stretch>();
    for (const k of [0, 0.5, 1]) {
      for (const q of at(px + ux * STEP_REACH * k, pz + uz * STEP_REACH * k)) {
        if (q.wall === s.wall || seen.has(q)) continue;
        seen.add(q);
        const qx = q.bx - q.ax;
        const qz = q.bz - q.az;
        const ql = Math.hypot(qx, qz);
        // Alongside: the way out square to it, and (px, pz) across from it, not past either of its ends.
        const den = ux * qz - uz * qx;
        if (Math.abs(den) < 0.8 * ql) continue;
        const f = ((px - q.ax) * qx + (pz - q.az) * qz) / (ql * ql);
        if (f < 0 || f > 1) continue;
        // Where the way out meets it.
        const a = ((q.ax - px) * qz - (q.az - pz) * qx) / den;
        if (a >= 1.5 && a < t) t = a;
      }
    }
    return Math.min(STEP_REACH, t / 2);
  };
  return (x, z) => {
    const h = nat(x, z);
    const near = at(x, z);
    // The stretch that holds it most (by how near, and how far from its wall's ends: where one wall ends
    // beside another, the other), the nearer of two that hold it as much; and the nearest point of it.
    let best: Stretch | null = null;
    let d = STEP_REACH;
    let t = 0;
    let w = 0;
    for (const s of near) {
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const f = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz)));
      const e = Math.hypot(s.ax + dx * f - x, s.az + dz * f - z);
      if (e >= STEP_REACH) continue;
      const along = s.s0 + f * Math.hypot(dx, dz);
      const v = smooth(0, STEP_END, Math.min(along, s.len - along)) * (1 - smooth(STEP_REACH - 1, STEP_REACH, e));
      if (v > w + 1e-9 || (v > w - 1e-9 && e < d)) [best, d, t, w] = [s, e, f, v];
    }
    if (!best || w <= 0) return h;
    const s = best;
    const L = Math.hypot(s.bx - s.ax, s.bz - s.az);
    const px = s.ax + (s.bx - s.ax) * t;
    const pz = s.az + (s.bz - s.az) * t;
    // Its lower side's way out (on the right of its line), and each side's ground past the ramp.
    const nx = -(s.bz - s.az) / L;
    const nz = (s.bx - s.ax) / L;
    const r0 = reach(s, px, pz, nx, nz);
    const r1 = reach(s, px, pz, -nx, -nz);
    const lo = nat(px + nx * r0, pz + nz * r0);
    const hi = nat(px - nx * r1, pz - nz * r1);
    if (hi - lo < STEP_MIN) return h;
    const lower = (s.bx - s.ax) * (z - s.az) - (s.bz - s.az) * (x - s.ax) > 0;
    return lower ? h - Math.max(0, h - lo) * w : h + Math.max(0, hi - h) * w;
  };
}

// The land in the box (and 100 m round it, for the river). Given the race's track, the river is
// kept well below the road where the road crosses it.
// ground: braga-map's ground, or as ground.ts has it, a kerb under a pavement braga-map lays lower than
// the land (its task 044).
export function makeLand(map: Braga, B: Box, track?: Track, ground: (x: number, z: number) => number = map.height): Land {
  // That ground, held either side of its retaining walls (task 111).
  const nat = heldAtWalls(retainingStretches(map), ground);
  const river: Reach[] = [];
  for (const r of map.rivers) {
    const pts = r.pts
      .filter(([x, z]) => x > B.x0 - 100 && x < B.x1 + 100 && z > B.z0 - 100 && z < B.z1 + 100)
      .map(([x, z, y]) => {
        if (!track) return [x, z, y];
        const { d, i } = distanceToRoad(track, x, z);
        const s = track.samples[i];
        return [x, z, i >= 0 && d + s.w / 2 < 30 ? Math.min(y, s.p.y - 4.5) : y];
      });
    for (let k = 1; k < pts.length; k++) river.push({ ax: pts[k - 1][0], az: pts[k - 1][1], bx: pts[k][0], bz: pts[k][1], ya: pts[k - 1][2], yb: pts[k][2] });
  }
  const HW = map.riverHalfWidth;
  // The river's stretches in cells of 50 m, each within 80 m of the cell: all that riverAt looks at.
  const C = 50;
  const cells = new Map<string, Reach[]>();
  for (const s of river) {
    for (let i = Math.floor((Math.min(s.ax, s.bx) - 80) / C); i <= Math.floor((Math.max(s.ax, s.bx) + 80) / C); i++) {
      for (let j = Math.floor((Math.min(s.az, s.bz) - 80) / C); j <= Math.floor((Math.max(s.az, s.bz) + 80) / C); j++) {
        const k = `${i},${j}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k)!.push(s);
      }
    }
  }
  const riverAt = (x: number, z: number) => {
    let best = Infinity;
    let y = 0;
    for (const s of cells.get(`${Math.floor(x / C)},${Math.floor(z / C)}`) ?? []) {
      if (Math.abs(x - s.ax) > 80 && Math.abs(x - s.bx) > 80) continue;
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(x - s.ax - dx * t, z - s.az - dz * t);
      if (d < best) {
        best = d;
        y = s.ya + (s.yb - s.ya) * t;
      }
    }
    return best > 80 ? { d: Infinity, y: 0 } : { d: best, y };
  };

  // The stadium's ground is level, its pitch and stands in a bowl cut into the slope. But a street
  // keeps its own level (braga-map's task 049): the bowl eases to nothing over BOWL_EASE metres
  // before a carriageway or a pavement on the ground, so the street beside the stadium is drawn and
  // driven on braga-map's ground, not 1.2 m under it.
  const pads = map.sights.flatMap((s) => (s.kind === 'stadium' ? [{ x: s.x, z: s.z, c: Math.cos(s.angle), s: Math.sin(s.angle), rx: s.L + s.W + 30, rz: s.W + 36, y: nat(s.x, s.z) }] : []));
  const offStreets = pads.map((p) => {
    const ex = 1.3 * Math.hypot(p.rx * p.c, p.rz * p.s);
    const ez = 1.3 * Math.hypot(p.rx * p.s, p.rz * p.c);
    return streetDistance(map, { x0: p.x - ex, x1: p.x + ex, z0: p.z - ez, z1: p.z + ez }, BOWL_EASE);
  });
  // In front of a tunnel's mouth, and in its throat, the land is down at the tunnel's road: the
  // LiDAR's ground slopes up there from the cutting's floor to whatever is over the tunnel, which
  // would bury the opening (levels.ts). But not in front of it on another street's carriageway, one
  // that runs by the cutting at the street's level (none of its ends at the mouth): the race takes
  // one by the Avenida da Liberdade's underpass, 4 m wide, which the held land dug into to 1 m from
  // its middle (task 037).
  const openings = mouths(map);
  const beside = openings.map((m) =>
    map.lines
      .filter((l) => l.level === 'ground' && l.kind <= 8 && l.pts.some(([x, z]) => Math.abs(x - m.x) < 40 && Math.abs(z - m.z) < 40))
      .filter((l) => ![l.pts[0], l.pts[l.pts.length - 1]].some(([x, z]) => Math.hypot(x - m.x, z - m.z) < m.w / 2 + 1.5)),
  );
  const onStreet = (lines: typeof map.lines, x: number, z: number) =>
    lines.some((l) => {
      for (let k = 1; k < l.pts.length; k++) {
        const [ax, az] = l.pts[k - 1];
        const [bx, bz] = l.pts[k];
        const dx = bx - ax;
        const dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        if (Math.hypot(ax + dx * t - x, az + dz * t - z) < l.w / 2 + 0.3) return true;
      }
      return false;
    });
  const firm = (x: number, z: number): number => {
    let h = nat(x, z);
    pads.forEach((p, k) => {
      const dx = x - p.x;
      const dz = z - p.z;
      const e = Math.hypot((dx * p.c + dz * p.s) / p.rx, (-dx * p.s + dz * p.c) / p.rz);
      if (e < 1.3) h += (p.y - h) * (1 - smooth(0.9, 1.3, e)) * smooth(0, BOWL_EASE, offStreets[k](x, z));
    });
    openings.forEach((m, k) => {
      const dx = x - m.x;
      const dz = z - m.z;
      if (Math.abs(dx) > 16 || Math.abs(dz) > 16) return;
      const a = dx * m.ux + dz * m.uz;
      const b = -dx * m.uz + dz * m.ux;
      const half = Math.max(6, m.w + 1) / 2;
      const front = a > 0 && a < 12 && Math.abs(b) < half + 1.5 && !onStreet(beside[k], x, z);
      if (front || (a > -THROAT - 2 && a <= 0 && Math.abs(b) < half + 0.5)) h = Math.min(h, m.y - 0.05 + Math.max(0, a - 6) * 0.4);
    });
    return h;
  };
  // The bed is cut no further than a wall standing on its bank (braga-map's task 077): where the Rio
  // Este runs past walls, as by Fujacal, the land they stand on is the land, not a bed 12 m wider than
  // the river that a walker would walk along under them. A retaining wall along it is the channel's
  // side, which the bed is cut down past as before (the race's jump by Ponte Pedrinha flies over that
  // gap, braga-map's task 039). On a grid of BANK metres, each point behind one or not (a wall between
  // it and the river's middle, running within 45° of it, or within FOOT of one, which stands on it
  // whichever way it runs, as one down the bank to the water); a point is behind one if any of the four
  // round it is, so the land right behind a wall is whole and the bed eases out in front of it.
  const BANK = 1;
  const FOOT = 0.75;
  const banks = new Map<string, [number, number, number, number][]>();
  for (const w of map.walls) {
    if (w.level === 'bridge' || (w.kind !== 'wall' && w.kind !== 'hedge' && w.kind !== 'fence')) continue;
    for (let k = 1; k < w.pts.length; k++) {
      const [ax, az] = w.pts[k - 1];
      const [bx, bz] = w.pts[k];
      for (let i = Math.floor(Math.min(ax, bx) / C); i <= Math.floor(Math.max(ax, bx) / C); i++) {
        for (let j = Math.floor(Math.min(az, bz) / C); j <= Math.floor(Math.max(az, bz) / C); j++) {
          if (!cells.has(`${i},${j}`)) continue;
          const key = `${i},${j}`;
          if (!banks.has(key)) banks.set(key, []);
          banks.get(key)!.push([ax, az, bx, bz]);
        }
      }
    }
  }
  const behind = new Map<number, number>();
  const banked = (i: number, j: number): number => {
    const k = i * 65536 + j;
    let v = behind.get(k);
    if (v !== undefined) return v;
    const x = i * BANK;
    const z = j * BANK;
    // The nearest point of the river's middle, and the walls between it and (x, z).
    let best = Infinity;
    let px = x;
    let pz = z;
    let ux = 1;
    let uz = 0;
    for (const s of cells.get(`${Math.floor(x / C)},${Math.floor(z / C)}`) ?? []) {
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const L = Math.hypot(dx, dz) || 1;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (L * L)));
      const d = Math.hypot(x - s.ax - dx * t, z - s.az - dz * t);
      if (d < best) [best, px, pz, ux, uz] = [d, s.ax + dx * t, s.az + dz * t, dx / L, dz / L];
    }
    v = 0;
    if (best < HW + 14) {
      const seen = new Set<[number, number, number, number]>();
      for (let a = Math.floor(Math.min(x, px) / C); a <= Math.floor(Math.max(x, px) / C) && !v; a++) {
        for (let b = Math.floor(Math.min(z, pz) / C); b <= Math.floor(Math.max(z, pz) / C) && !v; b++) {
          for (const q of banks.get(`${a},${b}`) ?? []) {
            if (seen.has(q)) continue;
            seen.add(q);
            const [ax, az, bx, bz] = q;
            const L = Math.hypot(bx - ax, bz - az) || 1;
            const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (L * L)));
            const on = Math.hypot(ax + (bx - ax) * t - x, az + (bz - az) * t - z) < FOOT;
            if (on || (Math.abs(((bx - ax) * ux + (bz - az) * uz) / L) >= Math.SQRT1_2 && crosses(x, z, px, pz, ax, az, bx, bz))) {
              v = 1;
              break;
            }
          }
        }
      }
    }
    behind.set(k, v);
    return v;
  };
  const shore = (x: number, z: number): number => {
    const i = Math.floor(x / BANK);
    const j = Math.floor(z / BANK);
    return Math.max(banked(i, j), banked(i + 1, j), banked(i, j + 1), banked(i + 1, j + 1));
  };
  const land = (x: number, z: number): number => {
    let h = firm(x, z);
    const r = riverAt(x, z);
    if (r.d < HW + 12) {
      const bed = r.y - 1.6;
      const cut = Math.min(h, bed + (h - bed) * smooth(HW - 2, HW + 12, r.d));
      h = cut + (h - cut) * shore(x, z);
    }
    return h;
  };
  return { land, firm, river, riverAt, HW, openings };
}
