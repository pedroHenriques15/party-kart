import { loadWorld, type World } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eyeOf, field, pickSpawn, type Field } from '../src/game/field.ts';
import { STAND, Walker, type WalkInput } from '../src/game/walker.ts';
import { norm, v3 } from '../src/math.ts';
import { loadParked, prop, seeded, type Prop } from '../src/world/cover.ts';
import { onSolid, WorldGround, worldGround } from '../src/world/ground.ts';
import { GRID } from '../src/world/paths.ts';
import { clear, sight } from '../src/world/sight.ts';

// A round's arenas as they're played (the owner's "100x better", 2026-10-21): their cover, the cars
// parked in them, the spawns and where the bots walk, on the map's real tiles.
const world: World = await loadWorld({ open: true });
const ground = worldGround(world);
const parked = await loadParked(world);
const DT = 1 / 120;
const built: { id: string; F: Field; bare: Field; ms: number }[] = [];
for (const a of world.arenas) {
  const t0 = performance.now();
  const F = field(ground, a, parked);
  const ms = performance.now() - t0;
  built.push({ id: a.id, F, bare: field(ground, a, [], false), ms });
}
const areaOf = (id: string) => world.arenas.find((a) => a.id === id)!;

test('the cover: in every arena, none on a door\'s way, a flight of steps or a gate, nor in another', () => {
  for (const { id, F, ms } of built) {
    const a = areaOf(id);
    const kinds = F.props.reduce<Record<string, number>>((m, p) => ((m[p.kind] = (m[p.kind] ?? 0) + 1), m), {});
    console.log(`${id}: ${F.props.length} things (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}), field built in ${ms.toFixed(0)} ms`);
    assert.ok(F.props.length >= 25 && F.props.length <= 75, `${id}: ${F.props.length} things`);
    assert.ok(kinds.car > 3, `${id}: the parked cars`);
    const doors = ground.d.rooms.flatMap((r) => r.doors.map((d) => d[0]));
    for (const p of F.props) {
      for (const s of p.solids) {
        for (const d of doors) assert.ok(!onSolid(s, d.x, d.z, 1.2), `${id}: a ${p.kind} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) before a door`);
        for (const g of a.gates) assert.ok(!onSolid(s, g.x, g.z, g.w / 2 + 1), `${id}: a ${p.kind} in a gate`);
        assert.ok(!ground.tread(s.x, s.z), `${id}: a ${p.kind} on a flight of steps`);
        assert.ok(!ground.roomAt(s.x, s.z), `${id}: a ${p.kind} in a room`);
      }
    }
  }
});

test('the walkable ground stays joined: the bots reach every spawn from every other, and nearly all they did', () => {
  for (const { id, F, bare } of built) {
    const P = F.paths;
    const at = F.spawns.map((s) => P.near(s.x, s.z, s.y));
    for (let k = 0; k < F.spawns.length; k++) {
      const s = F.spawns[k];
      assert.ok(Math.hypot(P.x[at[k]] - s.x, P.z[at[k]] - s.z) < 2.3, `${id}: spawn ${k} off the paths`);
      assert.ok(P.find(at[0], at[k]) && P.find(at[k], at[0]), `${id}: no way between spawn 0 and spawn ${k}`);
    }
    // What the cover stands on is lost to the paths, and no more than a little round it.
    const under = F.props.reduce((n, p) => n + p.L * p.W, 0) / 4;
    console.log(`${id}: the bots' paths ${bare.paths.n} points without the cover, ${P.n} with it (its foot about ${under.toFixed(0)} points)`);
    assert.ok(P.n >= (bare.paths.n - under) * 0.93, `${id}: ${P.n} of ${bare.paths.n} points`);
  }
});

test('the spawns: many, apart, sheltered, each facing open ground', () => {
  for (const { id, F, bare } of built) {
    const S = F.spawns;
    let gap = Infinity;
    for (const a of S) for (const b of S) if (a !== b) gap = Math.min(gap, Math.hypot(a.x - b.x, a.z - b.z));
    const shut = S.map((s) => s.shut ?? 0).sort((a, b) => a - b);
    const was = bare.spawns.map((s) => s.shut ?? 0).sort((a, b) => a - b);
    console.log(`${id}: ${S.length} spawns (${S.filter((s) => s.room).length} indoors), ${gap.toFixed(1)} m apart at least; sheltered (of 16 looks, stopped within 13 m) min ${shut[0]} median ${shut[S.length >> 1]} (without the cover ${was[0]}, ${was[was.length >> 1]})`);
    assert.ok(S.length >= 24 && S.length <= 36, `${id}: ${S.length} spawns`);
    assert.ok(gap >= 6, `${id}: two spawns ${gap.toFixed(1)} m apart`);
    for (const s of S) {
      const e = eyeOf(s);
      const t = sight(F.ground, e, v3(Math.cos(s.yaw), 0, Math.sin(s.yaw)), 4).t;
      assert.ok(t >= 3, `${id}: the spawn at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) faces something ${t.toFixed(1)} m off`);
      assert.ok(!F.ground.circle(s.x, s.z, s.x, s.z, s.y, 0.3, 1.75, true) && !F.ground.inSolid(s.x, s.z, s.y, s.y + 1.75, 0.3), `${id}: a spawn in something`);
    }
  }
});

test('pickSpawn: never where an enemy sees it, nor right by one, when there is such a place', () => {
  let picks = 0;
  let unseen = 0;
  let near = 0;
  const ds: number[] = [];
  for (const { id, F } of built) {
    const luck = seeded(`test:${id}`);
    for (let k = 0; k < F.spawns.length; k += 3) {
      // An enemy standing at a spawn, and another somewhere on the bots' paths.
      const q = Math.floor(luck() * F.paths.n);
      const enemies = [{ id: 'a', ...F.spawns[k] }, { id: 'b', x: F.paths.x[q], y: F.paths.y[q], z: F.paths.z[q] }];
      const sees = (s: { x: number; y: number; z: number }) => enemies.some((o) => clear(F.ground, eyeOf(o), v3(s.x, s.y + 1.58, s.z)) || clear(F.ground, eyeOf(o), v3(s.x, s.y + 1.17, s.z)));
      const far = (s: { x: number; z: number }) => Math.min(...enemies.map((o) => Math.hypot(o.x - s.x, o.z - s.z)));
      const ok = F.spawns.filter((s) => !sees(s) && far(s) >= 12);
      const s = pickSpawn(F, enemies, [], luck);
      picks++;
      if (!ok.length) continue;
      unseen++;
      assert.ok(!sees(s), `${id}: picked a spawn an enemy sees`);
      assert.ok(far(s) >= 12, `${id}: picked a spawn ${far(s).toFixed(1)} m from an enemy`);
      if (far(s) < 18) near++;
      ds.push(far(s));
    }
  }
  ds.sort((a, b) => a - b);
  console.log(`pickSpawn: ${picks} picks, ${unseen} with an unseen spawn 12 m off; the nearest enemy ${ds[0].toFixed(0)}–${ds[ds.length - 1].toFixed(0)} m, median ${ds[ds.length >> 1].toFixed(0)}; ${near} under 18 m`);
});

// A walker in a round at (x, z) on g, facing (x2, z2), and a pilot that runs at what's in front of it,
// jumping and tucking its legs up in the air, as a player climbs.
function climber(g: WorldGround, x: number, z: number, x2: number, z2: number): Walker {
  const w = new Walker(g, v3(x, g.floor(x, z, g.groundAt(x, z) + 0.5).y, z), Math.atan2(z2 - z, x2 - x));
  w.fighter = 4.6;
  return w;
}
function climb(w: Walker, seconds: number, stop: (w: Walker) => boolean): void {
  for (let i = 0; i < seconds / DT && !stop(w); i++) {
    const inp: Partial<WalkInput> = w.grounded ? { fwd: 1, jump: w.crouch === 0, crouch: false } : { fwd: 1, crouch: true };
    w.step({ ...STAND, ...inp }, DT);
  }
}

test('a walker climbs a stack of crates a step at a time, and stands on a skip by the box beside it', () => {
  // On the Rua de Santa Justa: a box, a crate, and a crate on a crate, in a row, on a ground of their own.
  const g = new WorldGround(ground.d);
  const [x, z] = [-345, 1049];
  const y = g.floor(x, z, g.groundAt(x, z) + 0.5).y;
  const box = prop('box', x, z, y, 0);
  const crate = prop('crate', x + 0.78, z, y, 0);
  const low = prop('crate', x + 1.81, z, y, 0);
  const top = prop('crate', x + 1.81, z, y + 1, 0, 0, undefined, undefined, y);
  g.addSolids([box, crate, low, top].flatMap((p) => p.solids));
  const w = climber(g, x - 2, z, x + 5, z);
  climb(w, 6, (w) => w.p.y > y + 1.95 && w.grounded);
  assert.ok(w.grounded && Math.abs(w.p.y - (y + 2)) < 0.02, `on the stack's top: ${(w.p.y - y).toFixed(2)} m up`);
  // Without the box, the crate's metre is out of reach from the ground... but not with the legs tucked.
  const bare = climber(g, x + 0.78, z - 2, x + 0.78, z + 5);
  climb(bare, 3, (w) => w.p.y > y + 0.95 && w.grounded);
  assert.ok(bare.grounded && Math.abs(bare.p.y - (y + 1)) < 0.02, `onto a crate from the ground: ${(bare.p.y - y).toFixed(2)} m up`);

  // In the arenas: a skip with its box, climbed from the box's far side.
  let tried = 0;
  for (const { id, F } of built) {
    for (const s of F.props.filter((p) => p.kind === 'skip')) {
      const b = F.props.find((p) => p.kind === 'box' && Math.abs(p.base - s.y) < 0.3 && Math.hypot(p.x - s.x, p.z - s.z) < 2.6);
      if (!b) continue;
      tried++;
      // From a metre off the box, square to the skip's side it's against, running at it.
      const c = Math.cos(s.yaw);
      const sn = Math.sin(s.yaw);
      const u = (b.x - s.x) * c + (b.z - s.z) * sn;
      const v = (b.z - s.z) * c - (b.x - s.x) * sn;
      const [nx, nz] = Math.abs(v) - s.W / 2 > Math.abs(u) - s.L / 2 ? [-sn * Math.sign(v), c * Math.sign(v)] : [c * Math.sign(u), sn * Math.sign(u)];
      const w = climber(F.ground, b.x + nx * 1.1, b.z + nz * 1.1, b.x - nx * 3, b.z - nz * 3);
      w.bound = F.inside;
      climb(w, 5, (w) => w.grounded && w.p.y > s.y + 1.45);
      assert.ok(w.grounded && Math.abs(w.p.y - (s.y + 1.5)) < 0.05 && onSolid(s.solids[0], w.p.x, w.p.z, 0.25), `${id}: not on the skip at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}): ${(w.p.y - s.y).toFixed(2)} m up`);
    }
  }
  assert.ok(tried >= 3, `${tried} skips with a box`);
});

test('a shot: stopped by a skip, saying it was metal, but not by a site fence', () => {
  const g = new WorldGround(ground.d);
  const [x, z] = [-345, 1049];
  const y = g.floor(x, z, g.groundAt(x, z) + 0.5).y;
  const skip: Prop = prop('skip', x, z, y, Math.PI / 2);
  const fence: Prop = prop('fence', x + 6, z, y, Math.PI / 2);
  g.addSolids([...skip.solids, ...fence.solids]);
  const s = sight(g, v3(x - 5, y + 1, z), v3(1, 0, 0), 20);
  assert.equal(s.what, 'metal');
  assert.ok(Math.abs(s.t - (5 - 0.9)) < 0.01 && s.nx < -0.99, `stopped ${s.t.toFixed(2)} m on, facing ${s.nx.toFixed(2)}`);
  // Over it, and through the fence beyond.
  const over = sight(g, v3(x - 5, y + 1.7, z), v3(1, 0, 0), 20);
  assert.ok(over.t > 11 || over.what !== 'metal', `over the skip ${over.t.toFixed(1)} m, ${over.what}`);
  // From above, onto its top.
  const down = sight(g, v3(x, y + 4, z), norm(v3(0.2, -1, 0)), 10);
  assert.equal(down.what, 'metal');
  assert.ok(Math.abs(down.y - (y + 1.5)) < 0.01 && down.ny > 0.99, `onto its top at ${(down.y - y).toFixed(2)} m`);
  // Not round the city: the world's ground has none of it.
  assert.notEqual(sight(ground, v3(x - 5, y + 1, z), v3(1, 0, 0), 20).what, 'metal');
  // In the arenas, a look at each thing from just off its side, half way up, is stopped by it, and says
  // what it is; a fence's lets it through.
  for (const { id, F } of built) {
    for (const p of F.props) {
      const b = p.solids[0];
      const nx = -Math.sin(b.yaw);
      const nz = Math.cos(b.yaw);
      const o = v3(b.x + nx * (b.W / 2 + 0.04), (Math.max(b.y0, p.y) + b.y1) / 2, b.z + nz * (b.W / 2 + 0.04));
      const h = sight(F.ground, o, v3(-nx, 0, -nz), 1);
      if (b.see) assert.ok(h.t > 0.5, `${id}: a fence stops a look`);
      else assert.ok(h.what === b.mat && Math.abs(h.t - 0.04) < 0.01, `${id}: a ${p.kind} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}): ${h.what} ${h.t.toFixed(2)} m on`);
    }
  }
});

test('the longest open look over each arena, before its cover and after (at 1.4 m, a crouching head)', () => {
  for (const { id, F, bare } of built) {
    // The furthest apart two of the bots' points outdoors (in one of the lattice's cells in four, the
    // same places with the cover and without: every fourth point of each would be other places, and a
    // look the cover leaves be one the bare ground's points miss) are that see each other, a crouching
    // head's height over each: the pairs from the furthest, until one does.
    const longest = (f: Field) => {
      const P = f.paths;
      const pts: number[] = [];
      for (let p = 0; p < P.n; p++) if (!(Math.floor(P.x[p] / GRID) & 1) && !(Math.floor(P.z[p] / GRID) & 1) && f.inside(P.x[p], P.z[p]) && !f.ground.roomAt(P.x[p], P.z[p])) pts.push(p);
      const pairs: [number, number, number][] = [];
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) pairs.push([Math.hypot(P.x[pts[i]] - P.x[pts[j]], P.z[pts[i]] - P.z[pts[j]]), pts[i], pts[j]]);
      pairs.sort((a, b) => b[0] - a[0]);
      for (const [d, a, b] of pairs) if (clear(f.ground, v3(P.x[a], P.y[a] + 1.4, P.z[a]), v3(P.x[b], P.y[b] + 1.4, P.z[b]))) return d;
      return 0;
    };
    // Of the pairs of points (every tenth) further apart than 32 m, how many see each other.
    const exposed = (f: Field) => {
      const P = f.paths;
      const pts: number[] = [];
      for (let p = 0; p < P.n; p += 10) if (f.inside(P.x[p], P.z[p]) && !f.ground.roomAt(P.x[p], P.z[p])) pts.push(p);
      let n = 0;
      let open = 0;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const [a, b] = [pts[i], pts[j]];
          if (Math.hypot(P.x[a] - P.x[b], P.z[a] - P.z[b]) <= 32) continue;
          n++;
          if (clear(f.ground, v3(P.x[a], P.y[a] + 1.4, P.z[a]), v3(P.x[b], P.y[b] + 1.4, P.z[b]))) open++;
        }
      }
      return open / n;
    };
    const b = longest(bare);
    const a = longest(F);
    const eb = exposed(bare);
    const ea = exposed(F);
    console.log(`${id}: the longest open look ${b.toFixed(0)} m without the cover, ${a.toFixed(0)} m with it (on the plan ${F.sightlines.before.toFixed(0)} → ${F.sightlines.after.toFixed(0)} m); of the places over 32 m apart, ${(eb * 100).toFixed(0)}% see each other without it, ${(ea * 100).toFixed(0)}% with it`);
    assert.ok(a <= b, `${id}: longer`);
    assert.ok(ea < eb * 0.8, `${id}: as open as it was`);
  }
});
