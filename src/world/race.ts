// The race on the world's ground (braga-map's decision 019 and task 037): what it stands on the streets
// for as long as it runs. The race's road is braga-map's `road`: the route's own streets at their real
// widths, as they're drawn, and the ramp's flight. Its outline is the race's walls: every kerb along
// the route, and a row of barriers wherever the street drawn goes on past it (`closures`: across each
// side street it passes, and between a road's two carriageways where they're drawn as one). The ramp
// into the dead end stands on its run-up: a slope a kart drives up, its sides walls.
import type { Ramp, Track } from '../track/track.ts';
import { distanceToRoad } from '../track/track.ts';
import { Rings, STEP, type Slope, type Wall, type WorldGround } from './ground.ts';

// How far a race's wall reaches under and over its road: a kart flying more than HIGH over the road
// passes over it, as over the track's own walls.
const LOW = 1.5;
const HIGH = 3;
// How far under the route its road may drop beside it before a fence stands there (raceDips).
const DIP = 1.5;

// The road's height beside a point of its edge, inside the road, at the route's level there: the
// floor at most a little over the track's own height nearby; or, where the road has dropped away
// under the route (raceDips), the route's.
function roadY(g: WorldGround, track: Track, inside: Rings, x: number, z: number, nx: number, nz: number): number {
  const [px, pz] = inside.has(x + nx * 0.3, z + nz * 0.3) ? [x + nx * 0.3, z + nz * 0.3] : [x - nx * 0.3, z - nz * 0.3];
  const s = track.samples[distanceToRoad(track, px, pz).i];
  const route = g.floor(s.p.x, s.p.z, s.p.y + 1.5).y;
  const y = g.floor(px, pz, route + 1.5).y;
  return y < route - DIP ? route : y;
}

// The walls: the race's road's outline, in pieces up to 2 m long, each standing from LOW under the road
// beside it to HIGH over it; and each ramp's sides.
export function raceWalls(g: WorldGround, track: Track, road: [number, number][][][], slopes: Slope[] = []): Wall[] {
  const inside = new Rings(road.flat());
  const out: Wall[] = [];
  for (const r of road.flat()) {
    for (let k = 0; k < r.length; k++) {
      const [ax, az] = r[k];
      const [bx, bz] = r[(k + 1) % r.length];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-6) continue;
      const n = Math.ceil(L / 2);
      for (let f = 0; f < n; f++) {
        const x0 = ax + ((bx - ax) * f) / n;
        const z0 = az + ((bz - az) * f) / n;
        const x1 = ax + ((bx - ax) * (f + 1)) / n;
        const z1 = az + ((bz - az) * (f + 1)) / n;
        const y = roadY(g, track, inside, (x0 + x1) / 2, (z0 + z1) / 2, -(bz - az) / L, (bx - ax) / L);
        out.push({ ax: x0, az: z0, bx: x1, bz: z1, y0: y - LOW, y1: y + HIGH });
      }
    }
  }
  // A ramp's sides, half a metre at a time, a step short of its planks: a kart on it never meets them.
  for (const s of slopes) {
    for (const side of [-1, 1]) {
      const ox = -s.uz * side * (s.w / 2);
      const oz = s.ux * side * (s.w / 2);
      for (let a = 0; a < s.L; a += 0.5) {
        const b = Math.min(s.L, a + 0.5);
        const top = s.y0 + ((s.y1 - s.y0) * b) / s.L;
        out.push({ ax: s.fx + s.ux * a + ox, az: s.fz + s.uz * a + oz, bx: s.fx + s.ux * b + ox, bz: s.fz + s.uz * b + oz, y0: s.y0 - LOW, y1: Math.max(s.y0 + 0.05, top - STEP) });
      }
    }
  }
  return out;
}

// A ramp as the race stands it: straight from its foot to its lip, on the street at its foot (the
// world's, which the track's own height can be a little off), rising as braga-map planned it.
export function rampSlope(g: WorldGround, track: Track, r: Ramp): Slope {
  const F = track.samples[r.foot].p;
  const T = track.samples[r.lip].p;
  const L = Math.hypot(T.x - F.x, T.z - F.z);
  const y0 = g.floor(F.x, F.z, F.y + 1).y;
  return { fx: F.x, fz: F.z, ux: (T.x - F.x) / L, uz: (T.z - F.z) / L, L, w: r.w, y0, y1: y0 + T.y - F.y };
}

// Where the race's road drops away under the route beside it: in front of a tunnel's mouth, where the
// land is down at the tunnel's road (land.ts) and the route's street runs by it, drawn close (the
// Avenida da Liberdade's underpass, the Avenida João XXI's). From each metre of the track within
// 30 m of a mouth, out either side, to where the road drops more than DIP under the line there: a
// fence along those points, as a row of barriers [x, y, z].
export function raceDips(g: WorldGround, track: Track, inside: Rings): [number, number, number][][] {
  const N = track.samples.length;
  const out: [number, number, number][][] = [];
  const near = (x: number, z: number) => g.d.land.openings.some((m) => Math.hypot(m.x - x, m.z - z) < 30);
  for (const side of [-1, 1]) {
    let row: [number, number, number][] = [];
    for (let k = 0; k <= N; k++) {
      const s = track.samples[k % N];
      let at: [number, number, number] | null = null;
      if (k < N && !s.air && near(s.p.x, s.p.z)) {
        const rl = Math.hypot(s.r.x, s.r.z) || 1;
        const rx = (s.r.x / rl) * side;
        const rz = (s.r.z / rl) * side;
        const y = g.floor(s.p.x, s.p.z, s.p.y + 1.5).y;
        for (let o = 0.5; o < 16; o += 0.5) {
          const x = s.p.x + rx * o;
          const z = s.p.z + rz * o;
          if (!inside.has(x, z)) break;
          if (g.floor(x, z, y + 1.5).y < y - DIP) {
            at = [s.p.x + rx * (o - 0.25), y, s.p.z + rz * (o - 0.25)];
            break;
          }
        }
      }
      if (at) row.push(at);
      else if (row.length) {
        if (row.length > 1) out.push(row);
        row = [];
      }
    }
  }
  return out;
}

// Where a kart could get to in a race on its ground, from the track's line: a metre at a time over
// the floor, up no more than a step, down as far as it likes, and never through a wall it would meet
// or within half a metre of one. Returns how much it reaches, and where it gets off the race's road
// (`road`, braga-map's) or `drop` m under the route (but under a ramp's flight, where a kart that falls
// is put back). For the tests: a race is closed.
export function reachable(g: WorldGround, track: Track, road: [number, number][][][], drop = 3): { cells: number; out: [number, number, number][] } {
  const inside = new Rings(road.flat());
  const seen = new Set<string>();
  const todo: [number, number, number][] = [];
  const out: [number, number, number][] = [];
  const push = (x: number, z: number, y: number) => {
    const k = `${Math.round(x)},${Math.round(z)},${Math.round(y)}`;
    if (seen.has(k)) return;
    seen.add(k);
    todo.push([x, z, y]);
  };
  const near: Wall[] = [];
  const walled = (x: number, z: number, nx: number, nz: number, y: number) => {
    for (const cells of [g.d.walls, g.extra]) {
      for (const w of cells.near(Math.min(x, nx) - 1, Math.min(z, nz) - 1, Math.max(x, nx) + 1, Math.max(z, nz) + 1, near)) {
        if (y >= w.y1 || y + 1.3 <= w.y0) continue;
        const ex = w.bx - w.ax;
        const ez = w.bz - w.az;
        const L = ex * ex + ez * ez;
        const t = L ? Math.max(0, Math.min(1, ((nx - w.ax) * ex + (nz - w.az) * ez) / L)) : 0;
        if (Math.hypot(w.ax + ex * t - nx, w.az + ez * t - nz) < 0.5) return true;
        const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => Math.sign((qx - px) * (rz - qz) - (qz - pz) * (rx - qx));
        if (o(x, z, nx, nz, w.ax, w.az) !== o(x, z, nx, nz, w.bx, w.bz) && o(w.ax, w.az, w.bx, w.bz, x, z) !== o(w.ax, w.az, w.bx, w.bz, nx, nz)) return true;
      }
    }
    return false;
  };
  const N = track.samples.length;
  const flight = (i: number) => track.ramps.some((r) => (i - r.foot + N) % N <= (r.land - r.foot + N) % N + 10);
  for (const s of track.samples) {
    if (s.air) continue;
    // Off the 10 cm grid the map's outlines are on, so no step lands on the seam between two pieces.
    const x = Math.floor(s.p.x) + 0.5123;
    const z = Math.floor(s.p.z) + 0.4871;
    push(x, z, g.floor(x, z, s.p.y + 1).y);
  }
  while (todo.length) {
    const [x, z, y] = todo.pop()!;
    const { i } = distanceToRoad(track, x, z);
    if (!inside.has(x, z) || (y < track.samples[i].p.y - drop && !flight(i))) {
      out.push([x, y, z]);
      continue;
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const f = g.floor(x + dx, z + dz, y);
      if (!f.buried && !walled(x, z, x + dx, z + dz, y)) push(x + dx, z + dz, f.y);
    }
  }
  return { cells: seen.size, out };
}

// The walls along rows of barriers [x, y, z], each piece from LOW under its height to HIGH over it.
function rowWalls(rows: [number, number, number][][]): Wall[] {
  return rows.flatMap((r) => r.slice(1).map(([bx, y, bz], k) => ({ ax: r[k][0], az: r[k][2], bx, bz, y0: Math.min(y, r[k][1]) - LOW, y1: Math.max(y, r[k][1]) + HIGH })));
}

// The race's ground (the world's, with the race's walls and its ramps), and the rows of barriers it
// stands: braga-map's closures, across the side streets and between a road's carriageways, and the
// fences where its road drops away (raceDips).
export function raceGround(g: WorldGround, track: Track, plan: { road: [number, number][][][]; closures: [number, number, number][][] }): { ground: WorldGround; rows: [number, number, number][][] } {
  const slopes = track.ramps.map((r) => rampSlope(g, track, r));
  const dips = raceDips(g, track, new Rings(plan.road.flat()));
  const inside = new Rings(plan.road.flat());
  return { ground: g.race(track, [...raceWalls(g, track, plan.road, slopes), ...rowWalls(dips)], slopes, inside), rows: [...plan.closures, ...dips] };
}
