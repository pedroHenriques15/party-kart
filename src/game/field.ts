// Where a round is played (braga-map's task 079): the arena's ground, its edge, its cover, the places
// a fighter comes back at, the ways the bots walk, and what's stood at its edge. Pure, so the tests
// fight in it.
import { clamp, v3, type V } from '../math.ts';
import { clear, sight, type Blocker } from '../world/sight.ts';
import { Rings, WorldGround, type Wall } from '../world/ground.ts';
import { Paths } from '../world/paths.ts';
import { cover, seeded, type Parked, type Prop } from '../world/cover.ts';
import { inside as inRing } from '../world/interiors.ts';
import { EYE } from './walker.ts';
import type { Body, See } from './fight.ts';

// The round's arena as braga-map gives it (world.arenas, its task 079): its id, its edge, and where
// streets and paths cross it.
export interface Area {
  id?: string;
  pts: [number, number][];
  gates: { x: number; z: number; heading: number; w: number; k: number; level: string; y: number }[];
}

// A place a fighter comes back at: its feet, the way it faces (the way a look runs furthest from it,
// never at a wall), whether it's in a building, and how sheltered it is (of 16 looks, how many are
// stopped within SHELTER m).
export interface Spawn {
  x: number;
  y: number;
  z: number;
  yaw: number;
  room?: boolean;
  shut?: number;
}

// The round's ground and what's stood for it: the world's, with the arena's edge a wall at every
// level and its cover in it; the places a fighter comes back at; and where the edge is drawn, a
// railing where someone on foot can reach it and a barrier across each street and path it crosses
// (gates).
export interface Field {
  ground: WorldGround;
  inside: (x: number, z: number) => boolean;
  spawns: Spawn[];
  // Where someone on foot can walk in it, all of it reached from the spawns and reaching them: for the
  // bots (braga-map's task 075), and to keep the spawns out of a garden or a yard nothing else reaches.
  paths: Paths;
  rails: { x: number; y: number; z: number }[][];
  gates: { x: number; y: number; z: number; heading: number; w: number }[];
  // What stands in it for cover (world/cover.ts): the cars parked there and the road works' things,
  // in the ground already; render/props.ts draws them.
  props: Prop[];
  // The longest look at a crouching head's height over its open ground, before the cover and after
  // (m, on cover.ts's plan), and those still longer than cover.ts's LONG.
  sightlines: { before: number; after: number; long: [number, number, number, number][] };
}

// The spawns: how many at most and at least, how far apart (and how far when the arena hasn't room for
// the least so far apart), how far in from the edge, a door and a gate; how far a look is counted as
// stopped for their shelter, and the least a look has to run the way one faces.
const SPAWNS = 32;
const FEWEST = 24;
const SPAWN_GAP = 7;
const SPAWN_GAP_MIN = 6;
const SPAWN_IN = 2.5;
const SPAWN_DOOR = 1.6;
const SPAWN_GATE = 2.5;
const SHELTER = 13;
const FACING = 5;
// The most of them in a building.
const INDOORS = 0.4;

// The round's field in an arena of the world's ground: its cover with the cars parked in it
// (cover.ts's loadParked; none if not given), unless `props` is false (the arena as the map has it, to
// compare).
export function field(world: WorldGround, area: Area, parked: readonly Parked[] = [], props = true): Field {
  const pts = area.pts;
  const id = area.id ?? pts.map(([x, z]) => `${x.toFixed(0)},${z.toFixed(0)}`).join(';');
  // Whether a point is in the area: the map's own test takes a few microseconds, this a fraction of
  // one, for every step of everyone on foot and every point of the bots' paths.
  const ring = new Rings([pts]);
  const inside = (x: number, z: number) => ring.has(x, z);
  const edge: Wall[] = pts.map(([ax, az], k) => {
    const [bx, bz] = pts[(k + 1) % pts.length];
    return { ax, az, bx, bz, y0: -1e4, y1: 1e4, open: true };
  });
  const ground = new WorldGround(world.d, null, edge);
  const toEdge = (x: number, z: number) => {
    let d = Infinity;
    for (const w of edge) {
      const ex = w.bx - w.ax;
      const ez = w.bz - w.az;
      const L = ex * ex + ez * ez;
      const t = L ? clamp(((x - w.ax) * ex + (z - w.az) * ez) / L, 0, 1) : 0;
      d = Math.min(d, Math.hypot(w.ax + ex * t - x, w.az + ez * t - z));
    }
    return d;
  };

  let cx = 0;
  let cz = 0;
  for (const [x, z] of pts) {
    cx += x / pts.length;
    cz += z / pts.length;
  }
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const box = { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
  const built = new Rings(world.d.world.buildings.filter((b) => b.pts.some(([x, z]) => x > box.x0 - 60 && x < box.x1 + 60 && z > box.z0 - 60 && z < box.z1 + 60)).map((b) => b.pts));

  // The cover, in the ground before anything else is worked out on it.
  const cv = cover(ground, id, inside, box, built, area.gates, props ? parked : [], props);

  // The spawns' candidates: points every 2 m outdoors (not in a building, nor a room), in from the
  // edge, on the ground with room to stand and nothing of the cover in the way; and every 1.5 m on a
  // room's ground floor (not its stairs); none by a door or a gate.
  const doors = world.d.rooms.flatMap((r) => r.doors.flat());
  const cand: Spawn[] = [];
  const fits = (x: number, z: number, y: number) => {
    if (ground.circle(x, z, x, z, y, 0.45, 1.75, true) || ground.inSolid(x, z, y, y + 1.75, 0.45)) return false;
    if (doors.some((d) => Math.hypot(d.x - x, d.z - z) < SPAWN_DOOR) || area.gates.some((q) => Math.hypot(q.x - x, q.z - z) < q.w / 2 + SPAWN_GATE)) return false;
    const r = world.d.land.riverAt(x, z);
    return !(r.d < world.d.land.HW && y < r.y - 0.3);
  };
  for (let x = box.x0 + 1; x < box.x1; x += 2) {
    for (let z = box.z0 + 1; z < box.z1; z += 2) {
      if (!inside(x, z) || toEdge(x, z) < SPAWN_IN || (built.has(x, z) && !world.d.cuts.has(x, z)) || ground.roomAt(x, z)) continue;
      const f = ground.floor(x, z, ground.groundAt(x, z) + 0.5);
      if (f.buried || f.kind === 'steps' || !fits(x, z, f.y)) continue;
      cand.push({ x, y: f.y, z, yaw: 0 });
    }
  }
  for (const r of world.d.rooms) {
    if (!inside((r.box.x0 + r.box.x1) / 2, (r.box.z0 + r.box.z1) / 2)) continue;
    for (let x = r.box.x0 + 0.75; x < r.box.x1; x += 1.5) {
      for (let z = r.box.z0 + 0.75; z < r.box.z1; z += 1.5) {
        if (ground.roomAt(x, z) !== r || (r.stair && inRing(r.stair.pts, x, z)) || !inside(x, z) || toEdge(x, z) < SPAWN_IN) continue;
        if (!fits(x, z, r.y)) continue;
        cand.push({ x, y: r.y, z, yaw: 0, room: true });
      }
    }
  }
  // Only those on the arena's ground that the rest of it reaches, and that reach it: the walkable
  // ground round the candidate nearest its middle, or the next nearest, as long as it's most of what
  // the candidates are on.
  const near = (P: Paths, c: Spawn) => {
    const p = P.near(c.x, c.z, c.y);
    return p >= 0 && Math.hypot(P.x[p] - c.x, P.z[p] - c.z) < 2.2 && Math.abs(P.y[p] - c.y) < 0.6;
  };
  const outdoors = cand.filter((c) => !c.room);
  const byMiddle = [...outdoors].sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
  let paths: Paths | null = null;
  for (const c of byMiddle.slice(0, 12)) {
    const P = new Paths(ground, inside, box, [c]);
    if (!paths || P.n > paths.n) paths = P;
    // The points are as far apart as the candidates outdoors: most of those on it is enough.
    if (P.n > outdoors.length * 0.6) break;
  }
  paths ??= new Paths(ground, inside, box, outdoors);

  // How sheltered each is, the way it faces, and the most sheltered of them, each at least SPAWN_GAP
  // from those taken (SPAWN_GAP_MIN where there isn't room for FEWEST so), no more than INDOORS of them
  // in a building; a little luck between those alike.
  const luck = seeded(`spawns:${id}`);
  const scored = cand
    .filter((c) => near(paths, c))
    .map((c) => {
      const s = cv.shelter(c.x, c.z, SHELTER);
      return { c: { ...c, yaw: s.open, shut: s.shut }, far: s.far, score: s.shut + luck() * 1.5 };
    })
    .filter((q) => q.far >= FACING)
    .sort((a, b) => b.score - a.score);
  const spawns: Spawn[] = [];
  for (const gap of [SPAWN_GAP, SPAWN_GAP_MIN]) {
    for (const { c } of scored) {
      if (spawns.length >= (gap === SPAWN_GAP ? SPAWNS : FEWEST)) break;
      if (c.room && spawns.filter((s) => s.room).length >= SPAWNS * INDOORS) continue;
      if (spawns.some((s) => s === c || Math.hypot(s.x - c.x, s.z - c.z) < gap)) continue;
      spawns.push(c);
    }
  }
  // Each faces the way a look from its eye runs furthest (the plan's looks miss what's lower than a
  // crouching head: a crate, a sandbag wall).
  for (const s of spawns) {
    let most = -1;
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      const t = sight(ground, eyeOf(s), v3(Math.cos(a), 0, Math.sin(a)), 30).t + 0.5 * Math.cos(a - s.yaw);
      if (t > most) {
        most = t;
        s.yaw = a;
      }
    }
  }

  // The railing: the stretches of the edge where the ground half a metre in is somewhere to stand,
  // away from the gates, in runs, a point a metre.
  const gates = area.gates.map((g) => {
    const f = ground.floor(g.x, g.z, g.y + 0.5);
    return { x: g.x, y: f.buried ? g.y : f.y, z: g.z, heading: g.heading, w: g.w };
  });
  const rails: Field['rails'] = [];
  let run: Field['rails'][number] = [];
  const end = () => {
    if (run.length > 1) rails.push(run);
    run = [];
  };
  for (let k = 0; k < pts.length; k++) {
    const [ax, az] = pts[k];
    const [bx, bz] = pts[(k + 1) % pts.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) continue;
    const n = Math.max(1, Math.round(L));
    let nx = -(bz - az) / L;
    let nz = (bx - ax) / L;
    if (!inside((ax + bx) / 2 + nx * 0.5, (az + bz) / 2 + nz * 0.5)) [nx, nz] = [-nx, -nz];
    for (let i = 0; i <= n; i++) {
      if (i === 0 && k > 0) continue;
      const x = ax + ((bx - ax) * i) / n;
      const z = az + ((bz - az) * i) / n;
      const ix = x + nx * 0.5;
      const iz = z + nz * 0.5;
      const f = ground.floor(ix, iz, ground.groundAt(ix, iz) + 0.5);
      const reach = !f.buried && !world.circle(ix, iz, ix, iz, f.y, 0.3, 1.75, true) && !gates.some((g) => Math.hypot(g.x - x, g.z - z) < g.w / 2 + 1.2);
      if (!reach) {
        end();
        continue;
      }
      const y = ground.floor(x, z, f.y + 0.5);
      run.push({ x, y: y.buried ? f.y : y.y, z });
    }
  }
  end();
  // The buildings' roofs, which a look and a shot need, indexed now rather than at the first of them
  // (15 ms).
  if (spawns.length) sight(ground, eyeOf(spawns[0]), v3(1, 0, 0), 1);
  return { ground, inside, spawns, paths, rails, gates, props: cv.props, sightlines: { before: cv.before, after: cv.after, long: cv.long } };
}

// Where a fighter's eye is, standing at b.
export const eyeOf = (b: { x: number; y: number; z: number }): V => v3(b.x, b.y + EYE, b.z);

// Where a fighter standing at a spawn has its head and its chest (fight.ts's HEAD and TORSO), for
// whether someone sees it.
const HEAD_Y = 1.58;
const CHEST_Y = 1.17;

// How near an enemy a spawn may never be, and how far off the nearest is best: not on top of them, nor
// the far corner every time.
const NEAR = 12;
const GOOD = [18, 45];

// The spawn to come back at, away from the others (the living enemies: in teams, the caller leaves its
// own side out): never one any of them sees (from their eye to its head or its chest), nor within NEAR
// of one; best one whose nearest is GOOD far, with a little luck between those alike. Failing that,
// the furthest none sees; failing that, the furthest.
export function pickSpawn(f: Field, others: readonly Body[], blockers: readonly Blocker[] = [], luck: () => number = Math.random): Spawn {
  const S = f.spawns;
  if (!others.length) return S[Math.floor(luck() * S.length)];
  const want = (d: number) => (d < NEAR ? -1 : d < GOOD[0] ? (d - NEAR) / (GOOD[0] - NEAR) : d <= GOOD[1] ? 1 : Math.max(0.2, 1 - (d - GOOD[1]) / 40));
  const order = S.map((s) => {
    const d = Math.min(...others.map((o) => Math.hypot(o.x - s.x, o.z - s.z)));
    return { s, d, score: want(d) + luck() * 0.5 };
  }).sort((a, b) => b.score - a.score);
  const seen = (s: Spawn) =>
    others.some((o) => {
      if (Math.hypot(o.x - s.x, o.z - s.z) > 300) return false;
      const e = eyeOf(o);
      return clear(f.ground, e, v3(s.x, s.y + HEAD_Y, s.z), blockers) || clear(f.ground, e, v3(s.x, s.y + CHEST_Y, s.z), blockers);
    });
  for (const q of order) if (q.d >= NEAR && !seen(q.s)) return q.s;
  const far = [...order].sort((a, b) => b.d - a.d);
  for (const q of far) if (!seen(q.s)) return q.s;
  return far[0].s;
}

// How far the world lets a shot go on the round's ground, the karts in it.
export const seeOn = (f: Field, blockers: readonly Blocker[] = []): See => (o, d, max) => sight(f.ground, o, d, max, blockers);
