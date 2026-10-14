// What's round every stretch of the track, for the city's sound: how much traffic, town, park and
// woods there is within about 150 m, from the map's streets, areas and buildings, every 10 m of the
// track; and where the sounds with a place are, the churches, the rivers, the bus stops and the
// stadium. Worked out once, from the map's world, after the city is built. No three.js and no DOM,
// so the tests can load it.
import type { Track as Course, World } from 'braga-map';
import type { Track } from './track/track.ts';

export interface Surround {
  traffic: number;
  town: number;
  park: number;
  woods: number;
}

export interface Spot {
  x: number;
  y: number;
  z: number;
}

export interface Ambience {
  // One every EVERY samples of the track, from the start line.
  at: Surround[];
  churches: Spot[];
  // The rivers' courses, a point every 10 m or so, at the water.
  water: Spot[];
  stops: Spot[];
  stadium: Spot | null;
}

const EVERY = 10;
const REACH = 150;

// How much traffic a street carries, by its class: the fast roads and the primaries most, a
// residential street a little, a service road or a path hardly. The railway's trains don't run.
const TRAFFIC: Record<number, number> = { 0: 1, 1: 0.8, 2: 0.85, 3: 0.65, 4: 0.4, 5: 0.12, 7: 0.04 };
// Which bed an area's kind belongs to.
const BED: Record<string, keyof Omit<Surround, 'traffic'>> = {
  urban: 'town',
  industrial: 'town',
  plaza: 'town',
  hospital: 'town',
  school: 'town',
  park: 'park',
  grass: 'park',
  sport: 'park',
  cemetery: 'park',
  forest: 'woods',
  scrub: 'woods',
  farm: 'woods',
};

// A square grid of buckets over the plane, for finding what's near a point without looking at all
// of it.
function buckets<T>(size: number) {
  const m = new Map<string, T[]>();
  const key = (i: number, j: number) => `${i},${j}`;
  return {
    add(x0: number, z0: number, x1: number, z1: number, v: T) {
      for (let i = Math.floor(x0 / size); i <= Math.floor(x1 / size); i++) {
        for (let j = Math.floor(z0 / size); j <= Math.floor(z1 / size); j++) {
          const k = key(i, j);
          const l = m.get(k);
          if (l) l.push(v);
          else m.set(k, [v]);
        }
      }
    },
    near(x: number, z: number, r: number): Set<T> {
      const out = new Set<T>();
      for (let i = Math.floor((x - r) / size); i <= Math.floor((x + r) / size); i++) {
        for (let j = Math.floor((z - r) / size); j <= Math.floor((z + r) / size); j++) for (const v of m.get(key(i, j)) ?? []) out.add(v);
      }
      return out;
    },
  };
}

const segDist = (x: number, z: number, a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
};

const inside = (x: number, z: number, pts: [number, number][]) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};

export function ambienceOf(track: Track, world: World, course: Course): Ambience {
  const lines = buckets<{ w: number; pts: [number, number][] }>(100);
  for (const l of world.lines) {
    const w = TRAFFIC[l.kind] ?? 0;
    if (!w) continue;
    const xs = l.pts.map((p) => p[0]);
    const zs = l.pts.map((p) => p[1]);
    lines.add(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), { w, pts: l.pts });
  }
  // Later areas are painted over earlier ones, so the last that holds a point is what's there.
  const areas = buckets<{ k: number; bed: keyof Omit<Surround, 'traffic'>; pts: [number, number][] }>(100);
  world.areas.forEach((a, k) => {
    const bed = BED[a.kind];
    if (!bed) return;
    const xs = a.pts.map((p) => p[0]);
    const zs = a.pts.map((p) => p[1]);
    areas.add(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), { k, bed, pts: a.pts });
  });
  const trees = buckets<{ x: number; z: number }>(50);
  for (const t of world.trees) trees.add(t.x, t.z, t.x, t.z, t);
  const houses = buckets<{ x: number; z: number }>(50);
  for (const b of world.buildings) {
    const x = b.pts.reduce((s, p) => s + p[0], 0) / b.pts.length;
    const z = b.pts.reduce((s, p) => s + p[1], 0) / b.pts.length;
    houses.add(x, z, x, z, { x, z });
  }

  const at: Surround[] = [];
  for (let i = 0; i < track.samples.length; i += EVERY) {
    const { x, z } = track.samples[i].p;
    // Traffic: each street near, by its class and how close, added up and eased towards 1. The
    // Avenida da Liberdade comes to 0.87, a street of houses in Fujacal 0.44, the Picoto 0.14.
    let sum = 0;
    for (const l of lines.near(x, z, REACH)) {
      let d = Infinity;
      for (let k = 1; k < l.pts.length; k++) d = Math.min(d, segDist(x, z, l.pts[k - 1], l.pts[k]));
      if (d < REACH) sum += l.w * (1 - d / REACH) ** 2;
    }
    // The rest: what covers a grid of points round it, every 40 m to 120 m out, the nearer weighing
    // more. A point no area covers is town where there are buildings, and fields where there
    // aren't.
    const s = { town: 0, park: 0, woods: 0 };
    let all = 0;
    const near = [...areas.near(x, z, REACH)];
    for (let a = -120; a <= 120; a += 40) {
      for (let b = -120; b <= 120; b += 40) {
        const r = Math.hypot(a, b);
        if (r > 170) continue;
        const w = 1 - r / 200;
        all += w;
        let on: (typeof near)[number] | null = null;
        for (const ar of near) if ((!on || ar.k > on.k) && inside(x + a, z + b, ar.pts)) on = ar;
        if (on) s[on.bed] += w;
        else if ([...houses.near(x + a, z + b, 30)].length >= 2) s.town += w;
        else s.woods += w * 0.5;
      }
    }
    // Woods, too, where trees stand thick, as the map draws most of its woods as parks and trees.
    let n = 0;
    for (const t of trees.near(x, z, 80)) if (Math.hypot(t.x - x, t.z - z) < 80) n++;
    at.push({ traffic: 1 - Math.exp(-sum / 4), town: s.town / all, park: s.park / all, woods: Math.max(s.woods / all, Math.min(1, n / 50) * 0.7) });
  }

  const churches = world.buildings
    .filter((b) => b.kind === 3)
    .map((b) => ({ x: b.pts.reduce((s, p) => s + p[0], 0) / b.pts.length, y: b.y + b.h, z: b.pts.reduce((s, p) => s + p[1], 0) / b.pts.length }));
  const water: Spot[] = [];
  for (const r of world.rivers) {
    for (let k = 1; k < r.pts.length; k++) {
      const [x0, z0, y0] = r.pts[k - 1];
      const [x1, z1, y1] = r.pts[k];
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 10));
      for (let j = 0; j < n; j++) water.push({ x: x0 + ((x1 - x0) * j) / n, y: y0 + ((y1 - y0) * j) / n, z: z0 + ((z1 - z0) * j) / n });
    }
  }
  const st = world.sights.find((s) => s.kind === 'stadium');
  return {
    at,
    churches,
    water,
    stops: course.stops.map((s) => ({ x: s.x, y: world.height(s.x, s.z), z: s.z })),
    stadium: st ? { x: st.x, y: st.y, z: st.z } : null,
  };
}

// What's round a sample of the track, between the two entries either side of it.
export function surroundAt(a: Ambience, idx: number): Surround {
  const f = idx / EVERY;
  const i = Math.floor(f) % a.at.length;
  const j = (i + 1) % a.at.length;
  const t = f - Math.floor(f);
  const p = a.at[i];
  const q = a.at[j];
  return { traffic: p.traffic + (q.traffic - p.traffic) * t, town: p.town + (q.town - p.town) * t, park: p.park + (q.park - p.park) * t, woods: p.woods + (q.woods - p.woods) * t };
}
