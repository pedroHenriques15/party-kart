// A street's surface as triangles laid on the ground (streets.ts): its outline triangulated, then
// each edge halved where the ground under it bends, until the surface is within a few centimetres
// of it. Whether an edge is halved depends on that edge alone, so the two pieces either side of a
// shared edge (a kerb's line, a tile's cut) halve it at the same points and meet without cracks. No
// three.js here but its triangulation, so the tests can check it.
import { ShapeUtils, Vector2 } from 'three';

export type Height = (x: number, z: number) => number;

// How finely a surface follows the ground: its outline cut into pieces no longer than `dense`, then
// every edge halved while it's longer than `max`, or (longer than `min`) its middle is more than `tol`
// off the straight line between its ends.
export interface Grain {
  dense: number;
  max: number;
  min: number;
  tol: number;
}

// Whether the edge from a to b, each end at its height, is halved: undefined where it isn't, else the
// height at its middle. It depends on the edge alone, whichever way it's taken.
const need = (ax: number, az: number, ay: number, bx: number, bz: number, by: number, h: Height, g: Grain): number | undefined => {
  const L = Math.hypot(bx - ax, bz - az);
  if (L <= g.min) return undefined;
  const ym = h((ax + bx) / 2, (az + bz) / 2);
  return L > g.max || Math.abs(ym - (ay + by) / 2) > g.tol ? ym : undefined;
};

// A ring cut into pieces no longer than d, each point computed the same from either end, so two
// rings sharing an edge get the same points along it.
function dense(r: [number, number][], d: number): [number, number][] {
  const out: [number, number][] = [];
  const n = r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.length - 1 : r.length;
  for (let k = 0; k < n; k++) {
    const [ax, az] = r[k];
    const [bx, bz] = r[(k + 1) % n];
    const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / d));
    out.push([ax, az]);
    for (let f = 1; f < m; f++) out.push([(ax * (m - f) + bx * f) / m, (az * (m - f) + bz * f) / m]);
  }
  return out;
}

// The polygon (an outline, then its holes) as triangles: its points, x and z by turns, and three
// indices into them a triangle.
function earcut(rings: [number, number][][]): { pts: number[]; tris: number[] } {
  const v = (r: [number, number][]) => r.map(([x, z]) => new Vector2(x, z));
  const outer = v(rings[0]);
  const holes = rings.slice(1).map(v);
  // (It drops a ring's last point where it repeats its first, so the points are listed after.)
  const tris = ShapeUtils.triangulateShape(outer, holes).flat();
  const pts: number[] = [];
  for (const p of [...outer, ...holes.flat()]) pts.push(p.x, p.y);
  return { pts, tris };
}

// The polygon (an outline, then its holes) as triangles, each three flat x, z pairs.
export function triangles(rings: [number, number][][]): number[][] {
  const { pts, tris } = earcut(rings);
  const out: number[][] = [];
  for (let k = 0; k < tris.length; k += 3) out.push([pts[tris[k] * 2], pts[tris[k] * 2 + 1], pts[tris[k + 1] * 2], pts[tris[k + 1] * 2 + 1], pts[tris[k + 2] * 2], pts[tris[k + 2] * 2 + 1]]);
  return out;
}

// Lays the polygon (an outline, then its holes) on h, as finely as g says. emit gets each triangle's
// corners in turn, wound to face up. Each point's height is looked up once, as it's made.
export function surface(rings: [number, number][][], h: Height, g: Grain, emit: (x: number, y: number, z: number) => void): void {
  const put = (ax: number, az: number, ay: number, bx: number, bz: number, by: number, cx: number, cz: number, cy: number) => {
    // Facing up: clockwise seen from above, with x east and z south.
    emit(ax, ay, az);
    if ((bx - ax) * (cz - az) - (bz - az) * (cx - ax) > 0) {
      emit(cx, cy, cz);
      emit(bx, by, bz);
    } else {
      emit(bx, by, bz);
      emit(cx, cy, cz);
    }
  };
  const split = (ax: number, az: number, ay: number, bx: number, bz: number, by: number, cx: number, cz: number, cy: number, depth: number): void => {
    // The longest of the edges that need halving.
    const m0 = need(ax, az, ay, bx, bz, by, h, g);
    const m1 = need(bx, bz, by, cx, cz, cy, h, g);
    const m2 = need(cx, cz, cy, ax, az, ay, h, g);
    const e0 = m0 === undefined ? -1 : (bx - ax) ** 2 + (bz - az) ** 2;
    const e1 = m1 === undefined ? -1 : (cx - bx) ** 2 + (cz - bz) ** 2;
    const e2 = m2 === undefined ? -1 : (ax - cx) ** 2 + (az - cz) ** 2;
    const m = Math.max(e0, e1, e2);
    if (m < 0 || depth > 40) return put(ax, az, ay, bx, bz, by, cx, cz, cy);
    if (m === e0) {
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      split(ax, az, ay, mx, mz, m0!, cx, cz, cy, depth + 1);
      split(mx, mz, m0!, bx, bz, by, cx, cz, cy, depth + 1);
    } else if (m === e1) {
      const mx = (bx + cx) / 2;
      const mz = (bz + cz) / 2;
      split(ax, az, ay, bx, bz, by, mx, mz, m1!, depth + 1);
      split(ax, az, ay, mx, mz, m1!, cx, cz, cy, depth + 1);
    } else {
      const mx = (cx + ax) / 2;
      const mz = (cz + az) / 2;
      split(ax, az, ay, bx, bz, by, mx, mz, m2!, depth + 1);
      split(mx, mz, m2!, bx, bz, by, cx, cz, cy, depth + 1);
    }
  };
  const { pts, tris } = earcut(rings.map((r) => dense(r, g.dense)));
  const ys: number[] = [];
  for (let k = 0; k < pts.length; k += 2) ys.push(h(pts[k], pts[k + 1]));
  for (let k = 0; k < tris.length; k += 3) {
    const [a, b, c] = [tris[k], tris[k + 1], tris[k + 2]];
    split(pts[a * 2], pts[a * 2 + 1], ys[a], pts[b * 2], pts[b * 2 + 1], ys[b], pts[c * 2], pts[c * 2 + 1], ys[c], 0);
  }
}

// The points the surface's outline has along the edge from a to b of one of its rings (a ring's
// edge, as given to surface), from a to b: for what stands along it (a kerb, a skirt) to follow it.
export function edgePoints(ax: number, az: number, bx: number, bz: number, h: Height, g: Grain): [number, number][] {
  const out: [number, number][] = [[ax, az]];
  const halve = (px: number, pz: number, py: number, qx: number, qz: number, qy: number, depth: number) => {
    const ym = depth <= 40 ? need(px, pz, py, qx, qz, qy, h, g) : undefined;
    if (ym === undefined) return void out.push([qx, qz]);
    const mx = (px + qx) / 2;
    const mz = (pz + qz) / 2;
    halve(px, pz, py, mx, mz, ym, depth + 1);
    halve(mx, mz, ym, qx, qz, qy, depth + 1);
  };
  // As dense() cuts it, then halved as surface() halves it.
  const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / g.dense));
  let px = ax;
  let pz = az;
  let py = h(ax, az);
  for (let f = 1; f <= m; f++) {
    const qx = f === m ? bx : (ax * (m - f) + bx * f) / m;
    const qz = f === m ? bz : (az * (m - f) + bz * f) / m;
    const qy = h(qx, qz);
    halve(px, pz, py, qx, qz, qy, 0);
    [px, pz, py] = [qx, qz, qy];
  }
  return out;
}
