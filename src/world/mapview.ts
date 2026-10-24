// The full map's sums (braga-map's task 106), apart from its drawing (hud.ts's FullMap): the view, a
// centre and a scale, framing a place, zooming about a point and panning, kept over the map; and who
// the maps show you.

// What the map shows: the middle of the screen, x and z in metres, and k pixels a metre.
export interface View {
  x: number;
  z: number;
  k: number;
}

export interface Bounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

// How far the view goes on a screen W by H pixels: over the map, between the whole of it on the
// screen and a street's kerbs well apart.
export interface Limits {
  bounds: Bounds;
  kMin: number;
  kMax: number;
  W: number;
  H: number;
}

// The most it zooms in, pixels a metre: a 10 m street 120 px across.
export const K_MAX = 12;

export function boundsOf(pts: Iterable<{ x: number; z: number }>): Bounds {
  const b = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const p of pts) {
    b.x0 = Math.min(b.x0, p.x);
    b.x1 = Math.max(b.x1, p.x);
    b.z0 = Math.min(b.z0, p.z);
    b.z1 = Math.max(b.z1, p.z);
  }
  return b;
}

// A place whole on a screen W by H pixels, filling `fill` of it.
export function fit(b: Bounds, W: number, H: number, fill = 0.85): View {
  const k = Math.min((W * fill) / Math.max(1, b.x1 - b.x0), (H * fill) / Math.max(1, b.z1 - b.z0));
  return { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, k };
}

// The limits for a map within `b` on a screen W by H: zoomed out as far as the whole of it.
export function limits(b: Bounds, W: number, H: number): Limits {
  return { bounds: b, kMin: Math.min(K_MAX, fit(b, W, H, 0.95).k), kMax: K_MAX, W, H };
}

// The view within its limits: each way, the map in the middle while it's narrower than the screen,
// else its edges no further in than the screen's.
export function keep(v: View, l: Limits): View {
  const k = Math.min(l.kMax, Math.max(l.kMin, v.k));
  const along = (c: number, lo: number, hi: number, half: number) => (hi - lo <= 2 * half ? (lo + hi) / 2 : Math.min(hi - half, Math.max(lo + half, c)));
  const b = l.bounds;
  return { x: along(v.x, b.x0, b.x1, l.W / 2 / k), z: along(v.z, b.z0, b.z1, l.H / 2 / k), k };
}

// Where a point of the map is on the screen, and back.
export const toScreen = (v: View, W: number, H: number, x: number, z: number): [number, number] => [W / 2 + (x - v.x) * v.k, H / 2 + (z - v.z) * v.k];
export const toMap = (v: View, W: number, H: number, sx: number, sy: number): [number, number] => [v.x + (sx - W / 2) / v.k, v.z + (sy - H / 2) / v.k];

// Zoomed `f` times about the screen's point (sx, sy), which stays over the same place (but where the
// limits stop it).
export function zoomAt(v: View, f: number, sx: number, sy: number, l: Limits): View {
  const [x, z] = toMap(v, l.W, l.H, sx, sy);
  const k = Math.min(l.kMax, Math.max(l.kMin, v.k * f));
  return keep({ x: x - (sx - l.W / 2) / k, z: z - (sy - l.H / 2) / k, k }, l);
}

// Dragged (dx, dy) pixels: the map goes with the finger.
export function pan(v: View, dx: number, dy: number, l: Limits): View {
  return keep({ x: v.x - dx / v.k, z: v.z - dy / v.k, k: v.k }, l);
}

// A line's length from its first point to each of its points, m.
export function lengths(pts: [number, number][]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

// The point s metres along a line (cum its lengths), at its ends past them.
export function pointAt(pts: [number, number][], cum: number[], s: number): [number, number] {
  if (s <= 0) return pts[0];
  if (s >= cum[cum.length - 1]) return pts[pts.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const t = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t];
}

// Someone on the maps: where they are and their colour; in a round, whether they're fighting in it,
// and down.
export interface Marked {
  id: string;
  x: number;
  z: number;
  color: string;
  fighting?: boolean;
  down?: boolean;
}

// Who the minimap and the full map show you besides yourself: round the city, everyone where they
// are; in a round, only your team-mates who are up in it, so neither map gives a foe away (and in a
// round of each for themselves, nobody).
export function onTheMap<T extends Marked>(people: T[], round: { mate: (id: string) => boolean } | null): T[] {
  return round ? people.filter((p) => p.fighting && !p.down && round.mate(p.id)) : people;
}
