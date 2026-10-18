// The streets' names (braga-map's task 042): which named streets' carriageways a point is on, from
// the map's lines, each its street's name where the map has one.
import type { Line } from 'braga-map';

const CELL = 20;

// The names of the streets whose carriageway (x, z) is on, within half a metre past its kerbs, the
// nearest first: every street the map names, but the railway, on the ground or not.
export function streetNames(lines: Line[]): (x: number, z: number) => string[] {
  const cells = new Map<string, { ax: number; az: number; bx: number; bz: number; r: number; name: string }[]>();
  for (const l of lines) {
    if (!l.name || l.kind > 8) continue;
    const r = l.w / 2 + 0.5;
    for (let i = 1; i < l.pts.length; i++) {
      const [ax, az] = l.pts[i - 1];
      const [bx, bz] = l.pts[i];
      for (let a = Math.floor((Math.min(ax, bx) - r) / CELL); a <= Math.floor((Math.max(ax, bx) + r) / CELL); a++) {
        for (let b = Math.floor((Math.min(az, bz) - r) / CELL); b <= Math.floor((Math.max(az, bz) + r) / CELL); b++) {
          const k = `${a},${b}`;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k)!.push({ ax, az, bx, bz, r, name: l.name });
        }
      }
    }
  }
  return (x, z) => {
    const got = new Map<string, number>();
    for (const s of cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const L = dx * dx + dz * dz;
      const t = L ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L)) : 0;
      const d = Math.hypot(s.ax + dx * t - x, s.az + dz * t - z);
      if (d <= s.r && d < (got.get(s.name) ?? Infinity)) got.set(s.name, d);
    }
    return [...got].sort((p, q) => p[1] - q[1]).map(([name]) => name);
  };
}
