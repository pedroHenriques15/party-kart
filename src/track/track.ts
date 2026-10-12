// Turns the layout into a road sampled every metre: centre, direction, banking and what's there.
import { add, addScaled, cross, dist2, dot, norm, scale, sub, UP, v3, type V } from '../math.ts';
import type { Point, Surface, Tag } from './layout.ts';

export interface Sample {
  p: V; // centre of the road surface
  t: V; // forward
  r: V; // right, along the surface
  n: V; // up, out of the surface
  w: number;
  walls: boolean;
  boost: boolean;
  surface: Surface;
  d: number; // metres from the start line
}

export interface Track {
  samples: Sample[];
  length: number;
  start: number; // sample index of the start line
  checkpoints: number[]; // sample indices, in order; the start line comes after the last
  tags: { tag: Tag; i: number }[];
  grid: Map<string, number[]>; // 20 m cells of sample indices, for nearest-sample lookups
}

const BOOST_LEN = 14;
const CELL = 20;

// Centripetal Catmull-Rom between p1 and p2: smooth, and without loops at sharp corners.
function catmull(p0: V, p1: V, p2: V, p3: V, u: number): V {
  const k = (a: V, b: V) => Math.sqrt(Math.sqrt(dist2(a, b))) || 1e-4;
  const t0 = 0;
  const t1 = t0 + k(p0, p1);
  const t2 = t1 + k(p1, p2);
  const t3 = t2 + k(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const mix = (a: V, b: V, ta: number, tb: number) => add(scale(a, (tb - t) / (tb - ta)), scale(b, (t - ta) / (tb - ta)));
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

export function buildTrack(layout: Point[]): Track {
  const pts = layout.map((q) => v3(...q.p));
  const n = pts.length;

  // Carry the per-stretch settings forward from point to point.
  const opts: { w: number; bank: number; walls: boolean; surface: Surface }[] = [];
  let cur: (typeof opts)[number] = { w: 16, bank: 0, walls: true, surface: 'asphalt' };
  for (const q of layout) {
    cur = { w: q.w ?? cur.w, bank: q.bank ?? cur.bank, walls: q.walls ?? cur.walls, surface: q.surface ?? cur.surface };
    opts.push(cur);
  }

  // Dense points along the curve, then resampled every metre.
  const dense: { p: V; seg: number; u: number }[] = [];
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [pts[(i - 1 + n) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]];
    for (let s = 0; s < 60; s++) dense.push({ p: catmull(p0, p1, p2, p3, s / 60), seg: i, u: s / 60 });
  }
  const startSeg = layout.findIndex((q) => q.tag === 'start');
  const startAt = dense.findIndex((d) => d.seg === startSeg && d.u === 0);
  const ordered = [...dense.slice(startAt), ...dense.slice(0, startAt)];

  const raw: { p: V; seg: number; u: number }[] = [];
  let acc = 0;
  let want = 0;
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    const l = Math.sqrt(dist2(a.p, b.p));
    while (want <= acc + l && l > 0) {
      const f = (want - acc) / l;
      const segNext = b.seg === a.seg ? a.u + (b.u - a.u) * f : a.u + (1 - a.u) * f;
      raw.push({ p: add(a.p, scale(sub(b.p, a.p), f)), seg: a.seg, u: Math.min(1, segNext) });
      want += 1;
    }
    acc += l;
  }
  const length = acc;
  // The last sample can land just short of the first.
  while (raw.length > 1 && dist2(raw[raw.length - 1].p, raw[0].p) < 0.25) raw.pop();

  const samples: Sample[] = raw.map((s, i) => {
    const prev = raw[(i - 1 + raw.length) % raw.length].p;
    const next = raw[(i + 1) % raw.length].p;
    const t = norm(sub(next, prev));
    const o = opts[s.seg];
    const o2 = opts[(s.seg + 1) % n];
    const bank = o.bank + (o2.bank - o.bank) * s.u;
    const w = o.w + (o2.w - o.w) * s.u;
    const flat = norm(cross(t, UP));
    const r = norm(add(scale(flat, Math.cos(bank)), scale(UP, Math.sin(bank))));
    return { p: s.p, t, r, n: norm(cross(r, t)), w, walls: o.walls, boost: false, surface: o.surface, d: i };
  });

  const nearest = (q: V) => {
    let best = 0;
    let bd = Infinity;
    samples.forEach((s, i) => {
      const d = dist2(s.p, q);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };
  const tags = layout.flatMap((q, i) => (q.tag ? [{ tag: q.tag, i: nearest(pts[i]) }] : []));
  for (const { tag, i } of tags) {
    if (tag !== 'boost') continue;
    for (let k = 0; k < BOOST_LEN; k++) samples[(i + k) % samples.length].boost = true;
  }

  const grid = new Map<string, number[]>();
  samples.forEach((s, i) => {
    const key = `${Math.floor(s.p.x / CELL)},${Math.floor(s.p.z / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(i);
  });

  return {
    samples,
    length,
    start: 0,
    checkpoints: tags.filter((t) => t.tag === 'cp').map((t) => t.i).sort((a, b) => a - b),
    tags,
    grid,
  };
}

export interface Loc {
  i: number;
  lateral: number; // metres right of the centre line
  h: number; // metres above the surface (below if negative)
  onRoad: boolean;
}

// Where a point is relative to the road. hint is the sample the car was nearest to last time: the
// search stays near it, so a road that passes over another is never confused with it.
export function locate(track: Track, p: V, hint: number | null): Loc {
  const N = track.samples.length;
  let best = 0;
  let bd = Infinity;
  if (hint === null) {
    track.samples.forEach((s, i) => {
      const d = dist2(s.p, p);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
  } else {
    for (let k = -40; k <= 40; k++) {
      const i = (hint + k + N) % N;
      const d = dist2(track.samples[i].p, p);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
  }
  const s = track.samples[best];
  const d = sub(p, s.p);
  const lateral = dot(d, s.r);
  return { i: best, lateral, h: dot(d, s.n), onRoad: Math.abs(lateral) <= s.w / 2 + 0.3 };
}

// The surface point at a lateral offset from a sample's centre.
export const surfacePoint = (s: Sample, lateral: number, up = 0): V => addScaled(addScaled(s.p, s.r, lateral), s.n, up);

// Metres from the road edge to (x, z), ignoring height; for placing scenery.
export function distanceToRoad(track: Track, x: number, z: number): { d: number; i: number } {
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  let bd = Infinity;
  let bi = -1;
  for (let a = -2; a <= 2; a++) {
    for (let b = -2; b <= 2; b++) {
      for (const i of track.grid.get(`${cx + a},${cz + b}`) ?? []) {
        const s = track.samples[i];
        const d = Math.hypot(s.p.x - x, s.p.z - z) - s.w / 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
    }
  }
  return { d: bd, i: bi };
}
