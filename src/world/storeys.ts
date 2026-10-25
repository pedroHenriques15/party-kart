// How a building's walls are laid out (braga-map's task 017): its storeys, its bays along each wall,
// and which of its walls face a street. The facades draw them (render/facades.ts, city.ts), and the
// buildings with an inside (interiors.ts) cut their doors and windows where they're drawn. Pure, so
// the simulation and the tests share them.
import type { FacadeOpening, FacadeProportions, FacadeType, Line } from 'braga-map';

// A building's storeys: its ground floor's height and the others', from its eaves (h, over its foot)
// and its storeys, in its kind's proportions; a flat roof's parapet over the last.
export function storeys(p: FacadeProportions, h: number, floors: number, flat: boolean): { G: number; S: number; floors: number } {
  const top = h - (flat ? 0.6 : 0.15);
  if (floors <= 1 || top < p.ground + 2.2) return { G: Math.max(2.2, top), S: Math.max(2.2, top), floors: 1 };
  let G = p.ground;
  let S = (top - G) / (floors - 1);
  if (S < 2.4) {
    S = 2.4;
    G = Math.max(2.4, top - S * (floors - 1));
  }
  return { G, S, floors };
}

// A wall's bays: as many of its kind's as fit between its ends, stretched to fill it (none on a wall
// too short for one), and a glass office's from end to end.
export function baysOf(p: FacadeProportions, L: number, type: FacadeType): { bays: number; bayW: number; margin: number } {
  const margin = type === 'glass-office' ? 0 : Math.min(0.4, L / 8);
  const bays = L - 2 * margin >= p.bay * 0.7 ? Math.max(1, Math.round((L - 2 * margin) / p.bay)) : 0;
  return { bays, bayW: bays ? (L - 2 * margin) / bays : 1, margin };
}

// Where in its bay each opening's drawing is, across it (0 to 1): a window of the building's kind, a
// door's frame (the ground floor's door), a garage's door, a shop's front between its pillars, a balcony's
// door (the 2000s block's window, floor to ceiling, its bay 3.6 m); and how far its frame or its stone
// reaches past the opening, in metres, drawn round it (render/facades.ts draws them).
const PART: Record<FacadeOpening['kind'], (p: FacadeProportions) => { u0: number; u1: number; m: number }> = {
  window: (p) => ({ u0: 0.5 - p.win[0] / 2 / p.bay, u1: 0.5 + p.win[0] / 2 / p.bay, m: 0.18 }),
  door: () => ({ u0: 0.5 - 0.6 / 3.4, u1: 0.5 + 0.6 / 3.4, m: 0.15 }),
  garage: () => ({ u0: 0.4 / 3.4, u1: 3.0 / 3.4, m: 0 }),
  shop: () => ({ u0: 0.45 / 3.4, u1: 2.95 / 3.4, m: 0 }),
  balcony: () => ({ u0: 0.5 - 1.1 / 3.6, u1: 0.5 + 1.1 / 3.6, m: 0 }),
};

// A piece of a wall laid out by its layout (braga-map's task 086): s0 to s1 along it, h0 to h1 up from
// its foot, on storey `storey`; in its kind's rhythm (a storey not read), plain wall, or an opening of a
// kind, its bay's drawing from u0 at s0 to u1 at s1.
export interface WallPiece {
  s0: number;
  s1: number;
  h0: number;
  h1: number;
  storey: number;
  what: 'rhythm' | 'plain' | FacadeOpening['kind'];
  u?: [number, number];
}

// A wall's pieces, L metres long, its ground floor G high from `low` (below its foot) and its storeys S
// over it, `floors` in all: each storey not read (null, or past the layout's) whole in its kind's rhythm;
// each read, each of its openings with its frame round it (within the wall, and short of the next's),
// plain wall between them.
export function layoutPieces(storeys: (FacadeOpening[] | null)[], p: FacadeProportions, G: number, S: number, floors: number, L: number, low: number): WallPiece[] {
  const out: WallPiece[] = [];
  const piece = (q: WallPiece) => q.s1 - q.s0 > 0.005 && out.push(q);
  for (let r = 0; r < floors; r++) {
    const h0 = r ? G + (r - 1) * S : low;
    const h1 = r ? G + r * S : G;
    const st = storeys[r];
    if (!st) {
      piece({ s0: 0, s1: L, h0, h1, storey: r, what: 'rhythm' });
      continue;
    }
    let s = 0;
    const list = [...st].sort((a, b) => a.at - b.at);
    list.forEach((o, i) => {
      const part = PART[o.kind](p);
      const next = list[i + 1];
      const a = Math.max(s, o.at - part.m);
      const b = Math.min(L, next ? Math.max(o.at + o.w, next.at - PART[next.kind](p).m) : L, o.at + o.w + part.m);
      if (b - a < 0.1) return;
      // The frame's metres across in the drawing as the opening's are stretched.
      const k = (part.u1 - part.u0) / o.w;
      piece({ s0: s, s1: a, h0, h1, storey: r, what: 'plain' });
      piece({ s0: a, s1: b, h0, h1, storey: r, what: o.kind, u: [part.u0 - (o.at - a) * k, part.u1 + (b - o.at - o.w) * k] });
      s = b;
    });
    piece({ s0: s, s1: L, h0, h1, storey: r, what: 'plain' });
  }
  return out;
}

// Whether a wall from a to b, facing (nx, nz), faces a street: a street's carriageway within 7 m of a
// point 4 m out from its middle.
export function streetFront(lines: Line[]): (ax: number, az: number, bx: number, bz: number, nx: number, nz: number) => boolean {
  const C = 40;
  const cells = new Map<string, [number, number, number, number, number][]>();
  for (const l of lines) {
    if (l.level === 'tunnel' || l.kind > 7) continue;
    for (let k = 1; k < l.pts.length; k++) {
      const [ax, az] = l.pts[k - 1];
      const [bx, bz] = l.pts[k];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / C));
      const seen = new Set<string>();
      for (let f = 0; f <= n; f++) {
        const key = `${Math.floor((ax + ((bx - ax) * f) / n) / C)},${Math.floor((az + ((bz - az) * f) / n) / C)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key)!.push([ax, az, bx, bz, l.w / 2]);
      }
    }
  }
  return (ax, az, bx, bz, nx, nz) => {
    const x = (ax + bx) / 2 + nx * 4;
    const z = (az + bz) / 2 + nz * 4;
    const i = Math.floor(x / C);
    const j = Math.floor(z / C);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [sx, sz, ex, ez, hw] of cells.get(`${i + a},${j + b}`) ?? []) if (segDist(x, z, sx, sz, ex, ez) - hw < 7) return true;
    return false;
  };
}

function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}
