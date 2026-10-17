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

// The land in the box (and 100 m round it, for the river). Given the race's track, the river is
// kept well below the road where the road crosses it.
export function makeLand(map: Braga, B: Box, track?: Track): Land {
  const nat = map.height;
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
  const land = (x: number, z: number): number => {
    let h = firm(x, z);
    const r = riverAt(x, z);
    if (r.d < HW + 12) {
      const bed = r.y - 1.6;
      h = Math.min(h, bed + (h - bed) * smooth(HW - 2, HW + 12, r.d));
    }
    return h;
  };
  return { land, firm, river, riverAt, HW, openings };
}
