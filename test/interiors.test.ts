import { loadWorld, type World } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eyeOf, field } from '../src/game/fight.ts';
import { STAND, Walker } from '../src/game/walker.ts';
import { v3 } from '../src/math.ts';
import { worldGround } from '../src/world/ground.ts';
import type { Room } from '../src/world/interiors.ts';
import { clear, sight } from '../src/world/sight.ts';

// The arenas and the insides of their buildings (braga-map's task 079), on the map's real tiles.
const world: World = await loadWorld({ open: true });
const ground = worldGround(world);
const DT = 1 / 120;
const rooms = ground.d.rooms;

// A walker from p heading for q, running, for up to s seconds: where it got to.
function walkTo(w: Walker, q: { x: number; z: number }, s: number, close = 0.4): boolean {
  for (let i = 0; i < s / DT; i++) {
    const dx = q.x - w.p.x;
    const dz = q.z - w.p.z;
    if (Math.hypot(dx, dz) < close) return true;
    w.yaw = Math.atan2(dz, dx);
    w.step({ ...STAND, fwd: 1, run: true }, DT);
  }
  return Math.hypot(q.x - w.p.x, q.z - w.p.z) < close;
}

test('the arenas: three small places, about 80 m across, eight spawns each', () => {
  assert.equal(world.arenas.length, 3);
  for (const a of world.arenas) {
    const xs = a.pts.map((p) => p[0]);
    const zs = a.pts.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...zs) - Math.min(...zs);
    const F = field(ground, a);
    console.log(`${a.name}: ${w.toFixed(0)} by ${h.toFixed(0)} m, ${F.spawns.length} spawns, ${a.gates.length} gates, ${F.paths.n} points to walk, ${rooms.filter((r) => r.arena === a.id).length} rooms`);
    assert.ok(w < 110 && h < 110 && w > 50 && h > 50, `${a.name} ${w.toFixed(0)} by ${h.toFixed(0)} m`);
    assert.equal(F.spawns.length, 8);
    for (const s of F.spawns) assert.ok(world.inArena(a.id, s.x, s.z) && !ground.roomAt(s.x, s.z), 'a spawn outdoors in the arena');
    // Every spawn reaches every other.
    for (const s of F.spawns) {
      for (const q of F.spawns) {
        if (s === q) continue;
        assert.ok(F.paths.find(F.paths.near(s.x, s.z, s.y), F.paths.near(q.x, q.z, q.y)), `from ${s.x.toFixed(0)},${s.z.toFixed(0)} to ${q.x.toFixed(0)},${q.z.toFixed(0)}`);
      }
    }
  }
});

test('the rooms: most buildings in the arenas have a ground floor to walk into, two have every floor and a roof', () => {
  for (const a of world.arenas) {
    const whole = world.buildings.filter((b) => b.pts.every(([x, z]) => world.inArena(a.id, x, z)));
    const here = rooms.filter((r) => r.arena === a.id);
    console.log(`${a.name}: ${here.length} rooms of ${whole.length} buildings wholly in it, ${here.reduce((s, r) => s + r.doors.length, 0)} doors, ${here.reduce((s, r) => s + r.sides.reduce((q, sd) => q + sd.open.filter((o) => !o.door).length, 0), 0)} windows${here.some((r) => r.tower) ? `; a tower of ${here.find((r) => r.tower)!.levels.length - 2} floors over its ground floor and its roof` : ''}`);
    assert.ok(here.length >= whole.length / 2, `${a.name}: ${here.length} of ${whole.length}`);
    for (const r of here) assert.ok(r.doors.length >= 1);
  }
  const towers = rooms.filter((r) => r.tower);
  assert.equal(towers.length, 2);
  for (const t of towers) assert.ok(t.levels.length >= 4 && t.stair, 'every floor and the roof');
});

test('into a room through its door, and not through a window', () => {
  let doors = 0;
  let windows = 0;
  for (const r of rooms) {
    for (const [o, i] of r.doors) {
      const w = new Walker(ground, v3(o.x, o.y, o.z), 0);
      assert.ok(walkTo(w, i, 4), `through the door at ${o.x.toFixed(1)},${o.z.toFixed(1)}: got to ${w.p.x.toFixed(1)},${w.p.z.toFixed(1)}`);
      assert.ok(ground.roomAt(w.p.x, w.p.z) === r && Math.abs(w.p.y - r.y) < 0.05, 'on its floor');
      // And back out.
      assert.ok(walkTo(w, o, 4), 'back out');
      doors++;
    }
    // At each ground floor window from outside: stopped at the wall.
    for (const sd of r.sides) {
      for (const op of sd.open) {
        if (op.door || op.y0 > r.y + 2) continue;
        const s = (op.s0 + op.s1) / 2;
        const x = sd.a[0] + ((sd.b[0] - sd.a[0]) * s) / sd.L;
        const z = sd.a[1] + ((sd.b[1] - sd.a[1]) * s) / sd.L;
        const f = ground.floor(x + sd.nx, z + sd.nz, op.y0);
        if (f.buried || ground.circle(x + sd.nx, z + sd.nz, x + sd.nx, z + sd.nz, f.y, 0.3, 1.75, true)) continue;
        const w = new Walker(ground, v3(x + sd.nx, f.y, z + sd.nz), 0);
        walkTo(w, { x: x - sd.nx * 1.5, z: z - sd.nz * 1.5 }, 2);
        assert.ok(!ground.roomAt(w.p.x, w.p.z), `in through the window at ${x.toFixed(1)},${z.toFixed(1)}`);
        windows++;
      }
    }
  }
  console.log(`${doors} doors walked through, both ways; ${windows} windows walked at and not through`);
  assert.ok(doors >= 20 && windows >= 20);
});

test("up each tower's stairs to its roof, floor by floor, and back down", () => {
  for (const t of rooms.filter((r) => r.tower) as Room[]) {
    const ways = t.stair!.ways;
    const w = new Walker(ground, v3(ways[0][0].x, ways[0][0].y, ways[0][0].z), 0);
    const seen: number[] = [];
    for (const p of ways.flat().slice(1)) {
      assert.ok(walkTo(w, p, 6, 0.3), `to ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}, got to ${w.p.x.toFixed(1)},${w.p.y.toFixed(1)},${w.p.z.toFixed(1)}`);
      assert.ok(Math.abs(w.p.y - p.y) < 0.35, `at ${p.y.toFixed(1)} m, not ${w.p.y.toFixed(1)}`);
      seen.push(w.p.y);
    }
    const roof = t.levels[t.levels.length - 1];
    assert.ok(Math.abs(w.p.y - roof) < 0.05, 'on the roof');
    // Out of the hut, onto the roof, and to its parapet: stopped there.
    const c = { x: (t.box.x0 + t.box.x1) / 2, z: (t.box.z0 + t.box.z1) / 2 };
    walkTo(w, c, 6);
    assert.ok(Math.abs(w.p.y - roof) < 0.05);
    // Back down: every way backwards.
    for (const p of ways.flat().reverse()) assert.ok(walkTo(w, p, 6, 0.3), `back down to ${p.y.toFixed(1)}`);
    assert.ok(Math.abs(w.p.y - t.y) < 0.05, 'on the ground floor');
    console.log(`the tower in ${t.arena}: ${t.levels.length - 2} floors over its ground floor and its roof, at ${(roof - t.y).toFixed(1)} m, ${t.stair!.steps.length} treads and landings, climbed and come down`);
  }
});

test('a look through a window, and not through the wall beside it', () => {
  let through = 0;
  for (const r of rooms) {
    for (const sd of r.sides) {
      for (const op of sd.open) {
        if (op.door) continue;
        const s = (op.s0 + op.s1) / 2;
        const y = (op.y0 + op.y1) / 2;
        const at = (s: number, d: number) => v3(sd.a[0] + ((sd.b[0] - sd.a[0]) * s) / sd.L + sd.nx * d, y, sd.a[1] + ((sd.b[1] - sd.a[1]) * s) / sd.L + sd.nz * d);
        // Through it, past the wall (inside, a tower's stairwell may stand behind one).
        const a = at(s, 2);
        const b = at(s, -1);
        const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        assert.ok(sight(ground, a, v3((b.x - a.x) / L, (b.y - a.y) / L, (b.z - a.z) / L), L).t > 2.25, 'through the window');
        // A metre past its side, if the wall goes on there.
        const s2 = op.s1 + 1;
        if (s2 < sd.L - 0.5 && !sd.open.some((o) => o.s0 - 0.1 < s2 && o.s1 + 0.1 > s2 && o.y0 < y && o.y1 > y)) assert.ok(!clear(ground, at(s2, 2), at(s2, -1)), 'through the wall');
        through++;
      }
    }
  }
  console.log(`${through} windows looked through`);
  assert.ok(through > 50);
  // From a tower's roof, over its parapet (standing at it), the street round it.
  const t = rooms.find((r) => r.tower && r.arena === 'topo')!;
  const roof = t.levels[t.levels.length - 1];
  const F = field(ground, world.arenas.find((a) => a.id === 'topo')!);
  const at = t.inner.map((p, k) => {
    const q = t.inner[(k + 1) % t.inner.length];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    // The middle of each side, 0.5 m in.
    return eyeOf({ x: (p[0] + q[0]) / 2 - ((q[1] - p[1]) / L) * 0.5, y: roof, z: (p[1] + q[1]) / 2 + ((q[0] - p[0]) / L) * 0.5 });
  });
  const seen = F.spawns.filter((s) => at.some((e) => clear(F.ground, e, v3(s.x, s.y + 1.4, s.z)))).length;
  console.log(`from the roof of the tower in Topo do Fujacal, ${seen} of the ${F.spawns.length} spawns in sight`);
  assert.ok(seen >= 2);
});
