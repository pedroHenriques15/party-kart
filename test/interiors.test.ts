import { loadWorld, type World } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eyeOf, field } from '../src/game/field.ts';
import { STAND, Walker } from '../src/game/walker.ts';
import { v3 } from '../src/math.ts';
import { worldGround } from '../src/world/ground.ts';
import { Holes } from '../src/render/lattice.ts';
import { inside, type Room } from '../src/world/interiors.ts';
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

test('the arenas: three small places, about 80 m across, 24 to 36 spawns each', () => {
  assert.equal(world.arenas.length, 3);
  for (const a of world.arenas) {
    const xs = a.pts.map((p) => p[0]);
    const zs = a.pts.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...zs) - Math.min(...zs);
    const F = field(ground, a);
    console.log(`${a.name}: ${w.toFixed(0)} by ${h.toFixed(0)} m, ${F.spawns.length} spawns, ${a.gates.length} gates, ${F.paths.n} points to walk, ${rooms.filter((r) => r.arena === a.id).length} rooms`);
    assert.ok(w < 110 && h < 110 && w > 50 && h > 50, `${a.name} ${w.toFixed(0)} by ${h.toFixed(0)} m`);
    assert.ok(F.spawns.length >= 24 && F.spawns.length <= 36, `${F.spawns.length} spawns`);
    for (const s of F.spawns) assert.ok(world.inArena(a.id, s.x, s.z) && !!ground.roomAt(s.x, s.z) === !!s.room, 'a spawn in the arena, in a room only if it says so');
    // Every spawn reaches every other.
    for (const s of F.spawns) {
      for (const q of F.spawns) {
        if (s === q) continue;
        assert.ok(F.paths.find(F.paths.near(s.x, s.z, s.y), F.paths.near(q.x, q.z, q.y)), `from ${s.x.toFixed(0)},${s.z.toFixed(0)} to ${q.x.toFixed(0)},${q.z.toFixed(0)}`);
      }
    }
  }
});

test('the rooms: most buildings in the arenas have a ground floor to walk into, three have every floor and a roof', () => {
  for (const a of world.arenas) {
    const whole = world.buildings.filter((b) => b.pts.every(([x, z]) => world.inArena(a.id, x, z)));
    const here = rooms.filter((r) => r.arena === a.id);
    console.log(`${a.name}: ${here.length} rooms of ${whole.length} buildings wholly in it, ${here.reduce((s, r) => s + r.doors.length, 0)} doors, ${here.reduce((s, r) => s + r.sides.reduce((q, sd) => q + sd.open.filter((o) => !o.door).length, 0), 0)} windows${here.some((r) => r.tower) ? `; a tower of ${here.find((r) => r.tower)!.levels.length - 2} floors over its ground floor and its roof` : ''}`);
    assert.ok(here.length >= whole.length / 2, `${a.name}: ${here.length} of ${whole.length}`);
    for (const r of here) assert.ok(r.doors.length >= 1);
  }
  const towers = rooms.filter((r) => r.tower);
  assert.equal(towers.length, 3);
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

type XZ = [number, number];

// Points in a ring: its box's, every `step` metres, those in it.
function samples(ring: XZ[], step: number): XZ[] {
  const xs = ring.map((p) => p[0]);
  const zs = ring.map((p) => p[1]);
  const out: XZ[] = [];
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) if (inside(ring, x, z)) out.push([x, z]);
  return out;
}

test("the land isn't drawn in a room, and is drawn round it, to its walls", () => {
  // The city's land: each cell two triangles, split from (i + 1, j) to (i, j + 1), on a lattice of 10 m
  // and of 2 m; each a room's outline meets cut by the rooms' holes (render/lattice.ts).
  const holes = new Holes(rooms.map((r) => r.pts));
  let under = 0;
  let round = 0;
  for (const r of rooms) {
    for (const F of [2, 10]) {
      const tris: XZ[][] = [];
      for (let x = Math.floor(r.box.x0 / F) * F - F; x < r.box.x1 + F; x += F) {
        for (let z = Math.floor(r.box.z0 / F) * F - F; z < r.box.z1 + F; z += F) tris.push([[x, z], [x, z + F], [x + F, z]], [[x + F, z], [x, z + F], [x + F, z + F]]);
      }
      const drawn = tris.flatMap((t) => holes.cut(t)?.out ?? [t]);
      const shown = (x: number, z: number) => drawn.some((q) => inside(q, x, z));
      // Under its floor (its inside outline), none; just outside its walls, all of it (but where
      // another room stands).
      for (const [x, z] of samples(r.inner, 0.3)) {
        assert.ok(!shown(x, z), `the land at ${x.toFixed(2)},${z.toFixed(2)} in the room at ${r.box.x0},${r.box.z0}`);
        under++;
      }
      for (let k = 0; k < r.pts.length; k++) {
        const [ax, az] = r.pts[k];
        const [bx, bz] = r.pts[(k + 1) % r.pts.length];
        const L = Math.hypot(bx - ax, bz - az);
        for (let s = 0.25; s < L - 0.25; s += 0.5) {
          const x = ax + ((bx - ax) * s) / L + ((bz - az) / L) * 0.05;
          const z = az + ((bz - az) * s) / L - ((bx - ax) / L) * 0.05;
          if (rooms.some((q) => inside(q.pts, x, z))) continue;
          assert.ok(shown(x, z), `no land at ${x.toFixed(2)},${z.toFixed(2)}, outside the room at ${r.box.x0},${r.box.z0}`);
          round++;
        }
      }
    }
    // Its floor is drawn where the land isn't: its rooms cover its inside outline.
    for (const [x, z] of samples(r.inner, 0.5)) assert.ok(r.zones.some((q) => Math.abs(q.y - r.y) < 1e-6 && inside(q.pts, x, z)), `no floor at ${x.toFixed(1)},${z.toFixed(1)}`);
  }
  console.log(`${under} points under the rooms' floors with no land, ${round} just outside their walls with it`);
});

// Where a walker stands on a floor of a room at level y, on squares of 25 cm: those whose floor is y
// and where nothing stops it, joined to their four neighbours; and the way between two points on it.
function standable(r: Room, y: number) {
  const S = 0.25;
  const x0 = r.box.x0;
  const z0 = r.box.z0;
  const nx = Math.ceil((r.box.x1 - x0) / S);
  const nz = Math.ceil((r.box.z1 - z0) / S);
  const ok = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * S;
      const z = z0 + (j + 0.5) * S;
      if (ground.roomAt(x, z) !== r) continue;
      const f = ground.floor(x, z, y + 0.1);
      if (f.buried || Math.abs(f.y - y) > 0.01 || ground.circle(x, z, x, z, y, 0.3, 1.75, true)) continue;
      ok[j * nx + i] = 1;
    }
  }
  const cell = (p: { x: number; z: number }) => {
    let best = -1;
    let bd = 0.6;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        if (!ok[j * nx + i]) continue;
        const d = Math.hypot(x0 + (i + 0.5) * S - p.x, z0 + (j + 0.5) * S - p.z);
        if (d < bd) [best, bd] = [j * nx + i, d];
      }
    }
    return best;
  };
  return (a: { x: number; z: number }, b: { x: number; z: number }): { x: number; z: number }[] | null => {
    const s = cell(a);
    const t = cell(b);
    if (s < 0 || t < 0) return null;
    const from = new Int32Array(nx * nz).fill(-1);
    from[s] = s;
    const queue = [s];
    for (let h = 0; h < queue.length && from[t] < 0; h++) {
      const k = queue[h];
      const i = k % nx;
      for (const q of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) {
        if (q < 0 || q >= ok.length || !ok[q] || from[q] >= 0) continue;
        from[q] = k;
        queue.push(q);
      }
    }
    if (from[t] < 0) return null;
    const out: { x: number; z: number }[] = [];
    for (let k = t; k !== s; k = from[k]) out.push({ x: x0 + ((k % nx) + 0.5) * S, z: z0 + (Math.floor(k / nx) + 0.5) * S });
    return out.reverse();
  };
}

test("inside, every room's doors, doorways and stairs are joined, and walked between", () => {
  let joined = 0;
  let walked = 0;
  for (const r of rooms) {
    const levels = r.tower ? r.levels : [r.y];
    levels.forEach((y, i) => {
      // What a floor's lanes join: inside each door, either side of each doorway, each flight's foot
      // and top, and the roof outside the hut.
      const points: { x: number; z: number; what: string }[] = [];
      if (i === 0) for (const [, inner] of r.doors) points.push({ ...inner, what: 'a door' });
      for (const [a, b] of r.gaps) if (Math.abs(a.y - y) < 1e-6) points.push({ ...a, what: 'a doorway' }, { ...b, what: 'a doorway' });
      const ways = r.stair?.ways ?? [];
      if (i < levels.length - 1 && ways[i]) points.push({ ...ways[i][0], what: "a flight's foot" });
      if (i >= 1 && ways[i - 1]) {
        const w = ways[i - 1];
        const roof = i === levels.length - 1;
        points.push({ ...(roof ? w[w.length - 1] : w[3]), what: roof ? 'the roof by the hut' : "a flight's top" });
      }
      if (points.length < 2) return;
      const way = standable(r, y);
      for (const p of points.slice(1)) {
        assert.ok(way(points[0], p), `in the room at ${r.box.x0},${r.box.z0}, ${(y - r.y).toFixed(1)} m up: no way from ${points[0].what} at ${points[0].x.toFixed(1)},${points[0].z.toFixed(1)} to ${p.what} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
        joined++;
      }
      // And a walker, along the way from its first door to its last, gets there.
      if (i === 0 && r.doors.length >= 2) {
        const [a, b] = [r.doors[0][1], r.doors[r.doors.length - 1][1]];
        const route = way(a, b)!;
        const w = new Walker(ground, v3(a.x, a.y, a.z), 0);
        for (let k = 3; k < route.length; k += 4) assert.ok(walkTo(w, route[k], 3, 0.3), `across the room at ${r.box.x0},${r.box.z0}: stuck at ${w.p.x.toFixed(1)},${w.p.z.toFixed(1)}`);
        assert.ok(walkTo(w, b, 3), 'to the other door');
        walked++;
      }
    });
  }
  console.log(`${joined} ways inside the rooms, from a door, a doorway or a flight to the others; ${walked} rooms walked across from door to door`);
  assert.ok(joined > 40 && walked >= 5);
});

test("the rooms are furnished, and nothing stands in a door's way or on the stairs", () => {
  let things = 0;
  for (const r of rooms) {
    things += r.solids.length;
    const inSolid = (x: number, z: number, y?: number) => r.solids.find((s) => (y === undefined || Math.abs(s.y0 - y) < 1e-6) && inside(s.pts, x, z));
    // A door's way, on the ground floor: as wide as it is, from outside it to 1.6 m in.
    for (const sd of r.sides) {
      for (const o of sd.open) {
        if (!o.door) continue;
        for (let s = o.s0; s <= o.s1; s += 0.1) {
          for (let d = 0; d <= 1.6; d += 0.1) {
            const x = sd.a[0] + ((sd.b[0] - sd.a[0]) * s) / sd.L - sd.nx * d;
            const z = sd.a[1] + ((sd.b[1] - sd.a[1]) * s) / sd.L - sd.nz * d;
            assert.ok(!inSolid(x, z, r.y), `a ${inSolid(x, z, r.y)?.kind} in a door's way at ${x.toFixed(1)},${z.toFixed(1)}`);
          }
        }
      }
    }
    // The stairs, and a metre before their open end.
    if (r.stair) {
      const [h0, h1, , h3] = r.stair.pts;
      const Ls = Math.hypot(h1[0] - h0[0], h1[1] - h0[1]);
      const W = Math.hypot(h3[0] - h0[0], h3[1] - h0[1]);
      for (let a = -1; a <= Ls; a += 0.1) {
        for (let c = 0; c <= W; c += 0.1) {
          const x = h0[0] + ((h1[0] - h0[0]) * a) / Ls + ((h3[0] - h0[0]) * c) / W;
          const z = h0[1] + ((h1[1] - h0[1]) * a) / Ls + ((h3[1] - h0[1]) * c) / W;
          assert.ok(!inSolid(x, z), `a ${inSolid(x, z)?.kind} on the stairs at ${x.toFixed(1)},${z.toFixed(1)}`);
        }
      }
    }
    // A big floor is split into rooms; every floor of a tower is furnished.
    const area = Math.abs(r.inner.reduce((s, p, k) => s + p[0] * r.inner[(k + 1) % r.inner.length][1] - r.inner[(k + 1) % r.inner.length][0] * p[1], 0) / 2);
    if (area > 120) assert.ok(r.partitions.length >= 2 && r.gaps.length >= 1, `no partitions in the room at ${r.box.x0},${r.box.z0}`);
    if (r.tower) for (const y of r.levels) assert.ok(r.solids.some((s) => Math.abs(s.y0 - y) < 1e-6), `nothing on the floor ${(y - r.y).toFixed(1)} m up`);
  }
  console.log(`${things} pieces of furniture in ${rooms.length} rooms, ${rooms.reduce((s, r) => s + r.gaps.length, 0)} doorways between their rooms`);
  assert.ok(things > 200);
});

test('a crate to jump onto, a shelf to stand behind and to stop a shot', () => {
  // Onto a crate 60 cm high, walking up to it, with a jump and the legs tucked up (a crouch in the
  // air), as in a round.
  let climbed = 0;
  let tried = 0;
  for (const r of rooms) {
    for (const s of r.solids) {
      if (tried >= 12) break;
      if (s.kind !== 'crate' || s.y1 - s.y0 > 0.65 || r.solids.some((q) => q !== s && Math.abs(q.y0 - s.y1) < 1e-6)) continue;
      const cx = s.pts.reduce((a, p) => a + p[0], 0) / 4;
      const cz = s.pts.reduce((a, p) => a + p[1], 0) / 4;
      for (let k = 0; k < 4; k++) {
        const a = Math.atan2(s.pts[1][1] - s.pts[0][1], s.pts[1][0] - s.pts[0][0]) + (k * Math.PI) / 2; // square to a side
        const [x, z] = [cx + Math.cos(a) * 2.6, cz + Math.sin(a) * 2.6];
        const f = ground.floor(x, z, s.y0 + 0.1);
        if (ground.roomAt(x, z) !== r || Math.abs(f.y - s.y0) > 0.01 || ground.circle(x, z, x, z, s.y0, 0.3, 1.75, true) || !clear(ground, v3(x, s.y0 + 0.3, z), v3(cx + Math.cos(a) * 0.65, s.y0 + 0.3, cz + Math.sin(a) * 0.65))) continue;
        // Room to walk up to it: nothing in the way, a walker wide.
        let free = true;
        for (let t = 2.5; t >= 1; t -= 0.1) if (ground.circle(cx + Math.cos(a) * t, cz + Math.sin(a) * t, x, z, s.y0, 0.32, 1.75, true)) free = false;
        if (!free) continue;
        tried++;
        const w = new Walker(ground, v3(x, s.y0, z), a + Math.PI);
        w.fighter = 5;
        let on = false;
        for (let i = 0; i < 2 / DT && !on; i++) {
          w.step({ ...STAND, fwd: 1, walk: true, jump: Math.hypot(w.p.x - cx, w.p.z - cz) < 1.6, crouch: !w.grounded }, DT);
          on = w.grounded && Math.abs(w.p.y - s.y1) < 0.01 && inside(s.pts, w.p.x, w.p.z);
        }
        if (on) climbed++;
        break;
      }
    }
  }
  console.log(`onto ${climbed} of ${tried} crates with a jump`);
  assert.ok(tried >= 4 && climbed >= tried - 1);
  // At a shelf from in front of it: stopped by it, on the floor; and a shot at it stopped there.
  let shelves = 0;
  for (const r of rooms) {
    for (const s of r.solids) {
      if (s.kind !== 'shelf' || shelves >= 20) continue;
      const [p0, p1, , p3] = s.pts;
      const d = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
      const n = [(p3[0] - p0[0]) / d, (p3[1] - p0[1]) / d];
      const cx = s.pts.reduce((a, p) => a + p[0], 0) / 4;
      const cz = s.pts.reduce((a, p) => a + p[1], 0) / 4;
      const [x, z] = [(p0[0] + p1[0]) / 2 + n[0] * (d + 1.2), (p0[1] + p1[1]) / 2 + n[1] * (d + 1.2)];
      const f = ground.floor(x, z, s.y0 + 0.1);
      if (ground.roomAt(x, z) !== r || Math.abs(f.y - s.y0) > 0.01 || ground.circle(x, z, x, z, s.y0, 0.3, 1.75, true)) continue;
      const w = new Walker(ground, v3(x, s.y0, z), 0);
      walkTo(w, { x: cx - n[0] * d, z: cz - n[1] * d }, 2);
      assert.ok(!inside(s.pts, w.p.x, w.p.z) && Math.abs(w.p.y - s.y0) < 0.01, `through a shelf at ${cx.toFixed(1)},${cz.toFixed(1)}`);
      const L = Math.hypot(cx - x, cz - z);
      assert.ok(sight(ground, v3(x, s.y0 + 1.4, z), v3((cx - x) / L, 0, (cz - z) / L), L + 1).t < L, 'a shot through a shelf');
      shelves++;
    }
  }
  console.log(`${shelves} shelves walked at and shot at`);
  assert.ok(shelves >= 10);
});
