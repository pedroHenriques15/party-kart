// The GPS's routes (braga-map's task 107): from where you are to a waypoint along braga-map's road
// graph (world.roads, world.turns). By car, the right way down the one-way streets, no turn the map
// bans and no turning back but at a dead end, the quickest by each kind of street's speed; and off the
// streets, up a path or a flight of steps as a kart can, only to reach what no street does inside the
// open world's area (the Picoto's top, whose streets come in from outside it). On foot, any way along
// the streets and the paths, the quickest at a walker's pace. And, along a route, where you are on it
// and the turns it takes.
import type { Road, Turn } from 'braga-map';

export type Travel = 'car' | 'foot';

// A car's speed on each kind of street (m/s, braga-map's Line kinds 0 to 8), so a route keeps to the
// avenues as a driver would; and a walker's, slower on a flight of steps.
const CAR_SPEED = [19, 14, 14, 12.5, 11, 8.5, 3, 4.5, 4.5];
const WALK = 1.4;
const STEPS = 0.7;
// A car off the streets: slow, and each time it leaves them, ten minutes, so it never takes a pavement
// to save going round a one-way street.
const OFF_ROAD = 1;
const OFF_ROAD_STEPS = 0.5;
const LEAVE = 600;
// A turn's cost by car (s), by how sharp it is (radians): none straight on.
const turnCost = (a: number) => (a < 0.35 ? 0 : a < 1 ? 2 : 5);
// Setting off the other way from the one a car faces costs this much (s): a turn in the road first.
const BEHIND = 15;
// A route starts and ends on any stretch this near (m), each charged the walk to it from the point
// (s a metre, four times a walk's along a street): the nearest it can reach (the map has a footway
// or two joined to nothing, and a one-way street leaving the area has no way out).
const SNAP = 80;
const OFF = { car: 1000, foot: 4 / WALK };

export type TurnKind = 'left' | 'right' | 'slight-left' | 'slight-right' | 'sharp-left' | 'sharp-right' | 'back' | 'roundabout' | 'path';

// A turn the route takes: `at` metres along it, where, which way, a roundabout's exit (1 the first),
// and the street it turns onto (or the next one named on the route, close after it).
export interface Step {
  at: number;
  x: number;
  z: number;
  turn: TurnKind;
  exit?: number;
  onto: string | null;
}

// A stretch the route takes, the way it goes; by car, off the streets (a path, a flight of steps).
export interface Leg {
  road: number;
  fwd: boolean;
  off: boolean;
}

export interface Route {
  travel: Travel;
  pts: [number, number][];
  along: number[]; // metres from the start to each point
  length: number;
  time: number; // s
  steps: Step[];
  legs: Leg[];
  goal: { x: number; z: number };
}

const key = (p: readonly [number, number]) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
const lengthsOf = (pts: [number, number][]) => {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
};

// A heap of [cost, state].
class Heap {
  private a: [number, number][] = [];
  get size() {
    return this.a.length;
  }
  push(c: number, s: number): void {
    const a = this.a;
    a.push([c, s]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// Where on a stretch a point is: the stretch, how far along it (m), and how far off it.
interface Spot {
  road: number;
  s: number;
  d: number;
  x: number;
  z: number;
}

// The road graph made into directed edges, each stretch's two ways (edge 2i along its points, 2i + 1
// against), joined at their ends; and the banned turns, by the points either side of the junction.
export class Router {
  readonly roads: Road[];
  private cum: number[][];
  private from: number[]; // edge -> the node it leaves
  private to: number[]; // edge -> the node it reaches
  private out: number[][]; // node -> the edges leaving it
  private bans = new Set<string>();
  private cells = new Map<string, number[]>(); // 50 m cells -> the stretches through them
  private nodes = new Map<string, number>();

  constructor(roads: Road[], turns: Turn[]) {
    this.roads = roads;
    this.cum = roads.map((r) => lengthsOf(r.pts));
    this.from = [];
    this.to = [];
    this.out = [];
    const node = (p: [number, number]) => {
      const k = key(p);
      let n = this.nodes.get(k);
      if (n === undefined) {
        this.nodes.set(k, (n = this.out.length));
        this.out.push([]);
      }
      return n;
    };
    roads.forEach((r, i) => {
      const a = node(r.pts[0]);
      const b = node(r.pts[r.pts.length - 1]);
      this.from[2 * i] = a;
      this.to[2 * i] = b;
      this.from[2 * i + 1] = b;
      this.to[2 * i + 1] = a;
      this.out[a].push(2 * i);
      this.out[b].push(2 * i + 1);
      for (const c of new Set(r.pts.map(([x, z]) => `${Math.floor(x / 50)},${Math.floor(z / 50)}`))) {
        const list = this.cells.get(c);
        if (list) list.push(i);
        else this.cells.set(c, [i]);
      }
    });
    for (const t of turns) this.bans.add(`${key(t.at)}|${key(t.from)}|${key(t.to)}`);
  }

  private may(e: number, travel: Travel): boolean {
    const r = this.roads[e >> 1];
    return travel === 'car' && r.car ? !(e & 1) || !r.oneway : r.foot;
  }

  private speed(e: number, travel: Travel): number {
    const r = this.roads[e >> 1];
    if (travel === 'foot') return r.kind === 13 ? STEPS : WALK;
    return r.car ? (CAR_SPEED[r.kind] ?? 8) : r.kind === 13 ? OFF_ROAD_STEPS : OFF_ROAD;
  }

  // By car, onto a stretch off the streets from one on them (or setting off on one).
  private leaves(e: number, f: number, travel: Travel): number {
    return travel === 'car' && !this.roads[f >> 1].car && (e < 0 || this.roads[e >> 1].car) ? LEAVE : 0;
  }

  private len(e: number): number {
    const c = this.cum[e >> 1];
    return c[c.length - 1];
  }

  // The point next to an edge's start, the way it goes, and next to its end.
  private afterStart(e: number): [number, number] {
    const p = this.roads[e >> 1].pts;
    return e & 1 ? p[p.length - 2] : p[1];
  }
  private beforeEnd(e: number): [number, number] {
    const p = this.roads[e >> 1].pts;
    return e & 1 ? p[1] : p[p.length - 2];
  }
  private endOf(e: number): [number, number] {
    const p = this.roads[e >> 1].pts;
    return e & 1 ? p[0] : p[p.length - 1];
  }

  // How sharply a turn from edge e onto edge f bends (radians, 0 straight on, π back), and which way
  // (+ to the right: x is east and z south).
  bend(e: number, f: number): number {
    const [px, pz] = this.beforeEnd(e);
    const [jx, jz] = this.endOf(e);
    const [qx, qz] = this.afterStart(f);
    const ux = jx - px;
    const uz = jz - pz;
    const vx = qx - jx;
    const vz = qz - jz;
    return Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz);
  }

  // Whether one may go on from edge e onto f where they meet: by car, a turn the map doesn't ban, and
  // not back the way one came unless there's no other way on.
  private next(e: number, f: number, travel: Travel): boolean {
    if (!this.may(f, travel)) return false;
    if (travel === 'foot') return true;
    if ((f ^ 1) === e) return !this.out[this.to[e]].some((g) => g !== f && this.may(g, travel));
    return !this.bans.has(`${key(this.endOf(e))}|${key(this.beforeEnd(e))}|${key(this.afterStart(f))}`);
  }

  // The stretches near (x, z) one may travel, the nearest first, each where on it.
  spots(x: number, z: number, travel: Travel, r = SNAP): Spot[] {
    const seen = new Set<number>();
    const out: Spot[] = [];
    const n = Math.ceil(r / 50);
    const ci = Math.floor(x / 50);
    const cj = Math.floor(z / 50);
    for (let i = ci - n; i <= ci + n; i++) {
      for (let j = cj - n; j <= cj + n; j++) {
        for (const k of this.cells.get(`${i},${j}`) ?? []) {
          if (seen.has(k)) continue;
          seen.add(k);
          const road = this.roads[k];
          if (!road.foot && !(travel === 'car' && road.car)) continue;
          const p = road.pts;
          const c = this.cum[k];
          let best: Spot | null = null;
          for (let m = 1; m < p.length; m++) {
            const [ax, az] = p[m - 1];
            const dx = p[m][0] - ax;
            const dz = p[m][1] - az;
            const L = dx * dx + dz * dz;
            const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
            const sx = ax + dx * t;
            const sz = az + dz * t;
            const d = Math.hypot(sx - x, sz - z);
            if (!best || d < best.d) best = { road: k, s: c[m - 1] + (c[m] - c[m - 1]) * t, d, x: sx, z: sz };
          }
          if (best && best.d <= r) out.push(best);
        }
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }

  // The route from `a` (facing `yaw`, by car) to `b`, or null if there's none: from any stretch near
  // a to any near b, the quickest with the walks to them.
  route(a: { x: number; z: number; yaw?: number }, b: { x: number; z: number }, travel: Travel): Route | null {
    const starts = this.spots(a.x, a.z, travel);
    const goals = this.spots(b.x, b.z, travel);
    if (!starts.length || !goals.length) return null;
    const r = this.search(starts, goals, travel, a.yaw);
    return r && { ...r, goal: { x: b.x, z: b.z } };
  }

  private search(starts: Spot[], goals: Spot[], travel: Travel, yaw?: number): Omit<Route, 'goal'> | null {
    const cost = new Map<number, number>();
    const prev = new Map<number, number>();
    const heap = new Heap();
    const startOn = new Map(starts.map((s) => [s.road, s]));
    const goalOn = new Map(goals.map((g) => [g.road, g]));
    // Setting off: each way along the stretch one starts on, from where one is on it.
    const behind = (e: number) => {
      if (yaw === undefined || travel !== 'car') return 0;
      const p = this.roads[e >> 1].pts;
      const [ax, az] = e & 1 ? p[p.length - 1] : p[0];
      const [bx, bz] = e & 1 ? p[0] : p[p.length - 1];
      return (bx - ax) * Math.cos(yaw) + (bz - az) * Math.sin(yaw) < 0 ? BEHIND : 0;
    };
    for (const s of starts) {
      for (const e of [2 * s.road, 2 * s.road + 1]) {
        if (!this.may(e, travel)) continue;
        const left = e & 1 ? s.s : this.len(e) - s.s;
        const c = s.d * OFF[travel] + left / this.speed(e, travel) + behind(e) + this.leaves(-1, e, travel);
        if (c >= (cost.get(e) ?? Infinity)) continue;
        cost.set(e, c);
        prev.set(e, -1);
        heap.push(c, e);
      }
    }
    // Arriving: along a goal's stretch from either end to the goal; or straight there, from a start on
    // the same stretch the right way.
    let best = Infinity;
    let last = -1; // the edge arrived on before the goal's stretch, -1 straight there
    let lastWay = -1; // the goal's edge taken
    let s = starts[0];
    let g = goals[0];
    for (const gg of goals) {
      const ss = startOn.get(gg.road);
      if (!ss) continue;
      for (const e of [2 * gg.road, 2 * gg.road + 1]) {
        if (!this.may(e, travel)) continue;
        const d = e & 1 ? ss.s - gg.s : gg.s - ss.s;
        if (d < 0) continue;
        const c = (ss.d + gg.d) * OFF[travel] + d / this.speed(e, travel) + behind(e) + this.leaves(-1, e, travel);
        if (c < best) {
          best = c;
          last = -1;
          lastWay = e;
          s = ss;
          g = gg;
        }
      }
    }
    const done = new Set<number>();
    while (heap.size) {
      const [c, e] = heap.pop();
      if (c >= best) break;
      if (done.has(e)) continue;
      done.add(e);
      for (const f of this.out[this.to[e]]) {
        if (!this.next(e, f, travel)) continue;
        const turn = (travel === 'car' ? turnCost(Math.abs(this.bend(e, f))) : 0) + this.leaves(e, f, travel);
        const gg = goalOn.get(f >> 1);
        if (gg) {
          const d = f & 1 ? this.len(f) - gg.s : gg.s;
          const cg = c + turn + d / this.speed(f, travel) + gg.d * OFF[travel];
          if (cg < best) {
            best = cg;
            last = e;
            lastWay = f;
            g = gg;
          }
        }
        const cf = c + turn + this.len(f) / this.speed(f, travel);
        if (cf < (cost.get(f) ?? Infinity)) {
          cost.set(f, cf);
          prev.set(f, e);
          heap.push(cf, f);
        }
      }
    }
    if (!Number.isFinite(best)) return null;
    // The edges taken, in order: the first (part of the start's stretch), every one whole between,
    // and the goal's stretch to the goal.
    const whole: number[] = [];
    for (let e = last; e !== -1; e = prev.get(e) ?? -1) whole.unshift(e);
    if (whole.length) s = startOn.get(whole[0] >> 1)!;
    const legs: Leg[] = [];
    const pts: [number, number][] = [];
    let time = 0; // s, on the way: the search's costs have the walks to its ends and the penalties
    const piece = (e: number, s0: number, s1: number) => {
      time += Math.abs(s1 - s0) / this.speed(e, travel);
      // The stretch's points from s0 to s1 metres along it, the way edge e goes.
      const r = this.roads[e >> 1];
      const c = this.cum[e >> 1];
      const at = (s: number): [number, number] => {
        let m = 1;
        while (m < c.length - 1 && c[m] < s) m++;
        const t = c[m] > c[m - 1] ? (s - c[m - 1]) / (c[m] - c[m - 1]) : 0;
        const [ax, az] = r.pts[m - 1];
        return [ax + (r.pts[m][0] - ax) * t, az + (r.pts[m][1] - az) * t];
      };
      const lo = Math.min(s0, s1);
      const hi = Math.max(s0, s1);
      const run: [number, number][] = [at(lo), ...r.pts.filter((_, m) => c[m] > lo && c[m] < hi), at(hi)];
      if (s0 > s1) run.reverse();
      for (const p of run) if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 0.01) pts.push(p);
      legs.push({ road: e >> 1, fwd: !(e & 1), off: travel === 'car' && !r.car });
    };
    if (last === -1) piece(lastWay, s.s, g.s);
    else {
      whole.forEach((e, k) => {
        const L = this.len(e);
        piece(e, k === 0 ? s.s : e & 1 ? L : 0, e & 1 ? 0 : L);
      });
      piece(lastWay, lastWay & 1 ? this.len(lastWay) : 0, g.s);
    }
    const along = lengthsOf(pts);
    const route = { travel, pts, along, length: along[along.length - 1], time, legs, steps: [] as Step[] };
    route.steps = this.steps(route, whole.concat(last === -1 ? [] : [lastWay]), travel);
    return route;
  }

  // The turns a route takes at its junctions: where there was another way on, and it bends; a
  // roundabout as its exit.
  private steps(route: Omit<Route, 'goal'>, edges: number[], travel: Travel): Step[] {
    const out: Step[] = [];
    // How far along the route a junction is: the route's next point there.
    let m = 0;
    const endAlong = (p: [number, number]) => {
      for (; m < route.pts.length; m++) if (Math.hypot(route.pts[m][0] - p[0], route.pts[m][1] - p[1]) < 0.05) return route.along[m];
      return route.length;
    };
    const named = (k: number) => {
      // The street turned onto, or the next named one within 60 m along.
      let d = 0;
      for (let j = k; j < edges.length && d < 60; j++) {
        const r = this.roads[edges[j] >> 1];
        if (r.name) return r.name;
        d += this.len(edges[j]);
      }
      return null;
    };
    for (let k = 0; k + 1 < edges.length; k++) {
      const e = edges[k];
      const f = edges[k + 1];
      const at = endAlong(this.endOf(e));
      const [x, z] = this.endOf(e);
      const others = this.out[this.to[e]].filter((g) => g !== f && (g ^ 1) !== e && this.may(g, travel));
      const re = this.roads[e >> 1];
      const rf = this.roads[f >> 1];
      // By car off the streets, once, where it leaves them; no turns told on the way.
      if (travel === 'car' && !rf.car) {
        if (re.car) out.push({ at, x, z, turn: 'path', onto: rf.name });
        continue;
      }
      if (rf.ring && !re.ring) {
        // Into a roundabout: its exits counted to the one taken.
        let exit = 0;
        let j = k + 1;
        for (; j < edges.length && this.roads[edges[j] >> 1].ring; j++) {
          const n = this.to[edges[j]];
          if (this.out[n].some((g) => !this.roads[g >> 1].ring && (g ^ 1) !== edges[j] && this.may(g, travel))) exit++;
        }
        out.push({ at, x, z, turn: 'roundabout', exit: Math.max(1, exit), onto: named(j) });
        k = j - 1;
        continue;
      }
      if (re.ring && rf.ring) continue;
      const a = this.bend(e, f);
      const A = Math.abs(a);
      if ((f ^ 1) === e) {
        out.push({ at, x, z, turn: 'back', onto: named(k + 1) });
        continue;
      }
      if (!others.length || A < 0.35) continue;
      const side = a > 0 ? 'right' : 'left';
      const turn = (A < 0.8 ? `slight-${side}` : A > 2.3 ? `sharp-${side}` : side) as TurnKind;
      out.push({ at, x, z, turn, onto: named(k + 1) });
    }
    return out;
  }
}

// Where (x, z) is along a route: how far along it (m), how far off it, and the point it's nearest
// after (to look from next time, from `from` on, a stretch back and forward).
export function onRoute(route: Route, x: number, z: number, from = 0): { along: number; off: number; i: number } {
  const p = route.pts;
  let best = { along: 0, off: Infinity, i: 0 };
  const lo = Math.max(1, from - 20);
  for (let i = lo; i < p.length; i++) {
    if (route.along[i - 1] - route.along[lo - 1] > 400 && best.off < 30) break;
    const [ax, az] = p[i - 1];
    const dx = p[i][0] - ax;
    const dz = p[i][1] - az;
    const L = dx * dx + dz * dz;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best.off) best = { along: route.along[i - 1] + Math.sqrt(L) * t, off: d, i: i - 1 };
  }
  return best;
}

// The next turn the route takes after `along` metres, if any.
export const nextStep = (route: Route, along: number): Step | null => route.steps.find((s) => s.at > along - 3) ?? null;
