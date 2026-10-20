// How a building's walls are laid out (braga-map's task 017): its storeys, its bays along each wall,
// and which of its walls face a street. The facades draw them (render/facades.ts, city.ts), and the
// buildings with an inside (interiors.ts) cut their doors and windows where they're drawn. Pure, so
// the simulation and the tests share them.
import type { FacadeProportions, FacadeType, Line } from 'braga-map';

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
