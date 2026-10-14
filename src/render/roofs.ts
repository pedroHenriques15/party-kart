// The shape of a building's roof, as braga-map measured it from DGT's LiDAR (or guessed it): flat,
// gabled, hipped at either end of its ridge or both, or one slope (a skillion), its ridge the way
// the map says, at its pitch, between the eaves and the ridge's height. A roof is the lowest of a few
// planes over the rectangle round the footprint lined up with the ridge: each of its faces is where
// one of them is lowest. The walls rise to it, so a gable is the wall at a gabled end. Plain
// geometry, without three.js, so the tests can check it.

export type XZ = [number, number];

export interface Roofed {
  pts: XZ[];
  roof: number; // 0 flat, 1 hipped, 2 gabled, 3 skillion
  ends: number; // which ends of the ridge are hipped: 1 the first, 2 the second
  dir: number; // the way the ridge runs, from its first end to its second (a skillion: the way it slopes down)
  pitch: number; // degrees
  h: number; // the eaves, above the ground it stands on
  ridge: number; // the ridge, above the same
}

// A plane over the map: its height at (x, z) is c + gx·x + gz·z.
interface Plane {
  c: number;
  gx: number;
  gz: number;
}
const at = (p: Plane, x: number, z: number) => p.c + p.gx * x + p.gz * z;

export interface Shape {
  // The rectangle round the footprint lined up with the ridge: its middle, its axes (u along the
  // ridge, v across it), its half-sizes along them, and how much of it the footprint fills.
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  L: number;
  W: number;
  fill: number;
  planes: Plane[];
  // The roof's height over (x, z), from the ground the building stands on.
  height: (x: number, z: number) => number;
}

export function shapeOf(b: Roofed): Shape {
  // Flat roofs and those without a direction: the footprint's long side.
  const ux = Math.cos(b.dir);
  const uz = Math.sin(b.dir);
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const [x, z] of b.pts) {
    const a = x * ux + z * uz;
    const c = -x * uz + z * ux;
    a0 = Math.min(a0, a);
    a1 = Math.max(a1, a);
    b0 = Math.min(b0, c);
    b1 = Math.max(b1, c);
  }
  const am = (a0 + a1) / 2;
  const bm = (b0 + b1) / 2;
  const L = Math.max(0.01, (a1 - a0) / 2);
  const W = Math.max(0.01, (b1 - b0) / 2);
  const cx = am * ux - bm * uz;
  const cz = am * uz + bm * ux;
  let area = 0;
  for (let i = 0, j = b.pts.length - 1; i < b.pts.length; j = i++) area += (b.pts[j][0] + b.pts[i][0]) * (b.pts[j][1] - b.pts[i][1]);
  const fill = Math.abs(area / 2) / (4 * L * W);
  // A plane whose height is h0 at the rectangle's middle, rising ka a metre along the ridge and kb
  // across it (to its left, the way (-uz, ux) points).
  const plane = (h0: number, ka: number, kb: number): Plane => ({ c: h0 - ka * am - kb * bm, gx: ka * ux - kb * uz, gz: ka * uz + kb * ux });
  const rise = Math.max(0, b.ridge - b.h);
  const planes: Plane[] = [];
  if (b.roof === 0 || rise < 0.05) planes.push(plane(b.h, 0, 0));
  else if (b.roof === 3) {
    // One slope, high at its back, falling the way dir points to its eaves.
    planes.push(plane(b.h + rise / 2, -rise / (2 * L), 0));
  } else {
    // The two long slopes, from the eaves along the rectangle's long sides up to the ridge in its
    // middle; and a hip at each hipped end, from the eaves along that end, as steep as the pitch (or
    // meeting the other end's in the middle, a pyramid).
    planes.push(plane(b.h + rise, 0, -rise / W), plane(b.h + rise, 0, rise / W));
    if (b.roof === 1 && b.ends) {
      const e = Math.min(L, rise / Math.tan((Math.max(5, Math.min(75, b.pitch)) * Math.PI) / 180));
      if (b.ends & 1) planes.push(plane(b.h + (rise / e) * L, rise / e, 0));
      if (b.ends & 2) planes.push(plane(b.h + (rise / e) * L, -rise / e, 0));
    }
  }
  const height = (x: number, z: number) => {
    let m = Infinity;
    for (const p of planes) m = Math.min(m, at(p, x, z));
    return m;
  };
  return { cx, cz, ux, uz, L, W, fill, planes, height };
}

// Sutherland-Hodgman: a polygon cut down to where `keep` is positive, a linear function.
function clipHalf(poly: XZ[], keep: (x: number, z: number) => number): XZ[] {
  const out: XZ[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const kp = keep(p[0], p[1]);
    const kq = keep(q[0], q[1]);
    if (kp >= 0) out.push(p);
    if (kp >= 0 !== kq >= 0) {
      const t = kp / (kp - kq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

// A convex polygon cut down to inside another convex one, wound either way.
export function clipConvex(poly: XZ[], by: XZ[]): XZ[] {
  let area = 0;
  for (let i = 0, j = by.length - 1; i < by.length; j = i++) area += (by[j][0] - by[i][0]) * (by[j][1] + by[i][1]);
  const s = area > 0 ? 1 : -1;
  let out = poly;
  for (let i = 0; i < by.length && out.length >= 3; i++) {
    const [ax, az] = by[i];
    const [bx, bz] = by[(i + 1) % by.length];
    out = clipHalf(out, (x, z) => s * ((bx - ax) * (z - az) - (bz - az) * (x - ax)));
  }
  return out.length >= 3 ? out : [];
}

// A footprint's triangles (corner numbers) put together into as few convex pieces as merging
// neighbours that stay convex gives (Hertel and Mehlhorn's), so a roof's faces are cut to fewer of
// them. Each piece's corners, wound one way.
export function convexPieces(pts: XZ[], tris: number[][]): number[][] {
  const turn = (a: number, b: number, c: number) => (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
  const polys = tris.map((t) => (turn(t[0], t[1], t[2]) < 0 ? [t[0], t[2], t[1]] : [...t]));
  const convex = (p: number[]) => p.every((_, i) => turn(p[i], p[(i + 1) % p.length], p[(i + 2) % p.length]) >= -1e-9);
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < polys.length && !merged; i++) {
      for (let j = i + 1; j < polys.length && !merged; j++) {
        const A = polys[i];
        const B = polys[j];
        for (let k = 0; k < A.length && !merged; k++) {
          const p = A[k];
          const q = A[(k + 1) % A.length];
          const m = B.findIndex((v, n) => v === q && B[(n + 1) % B.length] === p);
          if (m < 0) continue;
          // Round A from q to p, then round B from p's next back to before q.
          const out: number[] = [];
          for (let n = 0; n < A.length; n++) out.push(A[(k + 1 + n) % A.length]);
          for (let n = 2; n < B.length; n++) out.push(B[(m + n) % B.length]);
          if (convex(out)) {
            polys[i] = out;
            polys.splice(j, 1);
            merged = true;
          }
        }
      }
    }
  }
  return polys;
}

// The roof's faces over the rectangle round the footprint, `o` metres past it all round (its eaves
// and verges overhanging the walls): each where its plane is the lowest, and that plane.
export function faces(s: Shape, o: number): { pts: XZ[]; plane: Plane }[] {
  const L = s.L + o;
  const W = s.W + o;
  const vx = -s.uz;
  const vz = s.ux;
  const rect: XZ[] = [
    [s.cx - s.ux * L - vx * W, s.cz - s.uz * L - vz * W],
    [s.cx + s.ux * L - vx * W, s.cz + s.uz * L - vz * W],
    [s.cx + s.ux * L + vx * W, s.cz + s.uz * L + vz * W],
    [s.cx - s.ux * L + vx * W, s.cz - s.uz * L + vz * W],
  ];
  const out: { pts: XZ[]; plane: Plane }[] = [];
  s.planes.forEach((p, i) => {
    let poly = rect;
    for (let j = 0; j < s.planes.length && poly.length >= 3; j++) {
      if (j === i) continue;
      const q = s.planes[j];
      poly = clipHalf(poly, (x, z) => at(q, x, z) - at(p, x, z));
    }
    if (poly.length >= 3) out.push({ pts: poly, plane: p });
  });
  return out;
}

// The top of a wall from a to c, as [x, z, height] at each end and wherever the roof over it bends.
export function wallTop(s: Shape, a: XZ, c: XZ): [number, number, number][] {
  const ts = [0, 1];
  for (let i = 0; i < s.planes.length; i++) {
    for (let j = i + 1; j < s.planes.length; j++) {
      // Where planes i and j are level along the wall.
      const p = s.planes[i];
      const q = s.planes[j];
      const fa = at(p, a[0], a[1]) - at(q, a[0], a[1]);
      const fc = at(p, c[0], c[1]) - at(q, c[0], c[1]);
      if ((fa > 0 && fc < 0) || (fa < 0 && fc > 0)) ts.push(fa / (fa - fc));
    }
  }
  ts.sort((u, v) => u - v);
  const out: [number, number, number][] = [];
  for (const t of ts) {
    const x = a[0] + (c[0] - a[0]) * t;
    const z = a[1] + (c[1] - a[1]) * t;
    const y = s.height(x, z);
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - x) < 1e-6 && Math.abs(last[1] - z) < 1e-6) continue;
    // Where two planes cross under the lowest, the roof runs straight on: no bend.
    if (out.length >= 2) {
      const [px, pz, py] = out[out.length - 2];
      const f = Math.hypot(last[0] - px, last[1] - pz) / (Math.hypot(x - px, z - pz) || 1);
      if (Math.abs(py + (y - py) * f - last[2]) < 1e-6) out.pop();
    }
    out.push([x, z, y]);
  }
  return out;
}
