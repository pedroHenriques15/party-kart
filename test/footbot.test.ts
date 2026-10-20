import { loadWorld, type World } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byKills, field, hitBody, HEAD, KITS, pellets, tally, type Score, type ShotEv } from '../src/game/fight.ts';
import { CHEST, Squad } from '../src/game/footbot.ts';
import { v3 } from '../src/math.ts';
import { worldGround } from '../src/world/ground.ts';
import { Paths } from '../src/world/paths.ts';
import { clear, sight } from '../src/world/sight.ts';

// The bots on foot (braga-map's task 075): the paths they walk, and rounds of bots alone, in the arenas
// (its task 079) on the map's real tiles.
const world: World = await loadWorld({ open: true });
const ground = worldGround(world);
// Each arena's field (braga-map's task 079), and the bots' paths in it.
const fields = new Map(world.arenas.map((a) => [a.id, field(ground, a)]));
const F = fields.get('topo')!;
const P = F.paths;
const DT = 1 / 120;

// The same dice every run.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test("the paths: each arena's walkable ground, every spawn reaching every other", () => {
  for (const [id, A] of fields) {
    const Q = A.paths;
    let none = 0;
    let pairs = 0;
    const t0 = performance.now();
    for (const a of A.spawns) {
      for (const b of A.spawns) {
        if (a === b) continue;
        pairs++;
        if (!Q.find(Q.near(a.x, a.z, a.y), Q.near(b.x, b.z, b.y))) none++;
      }
    }
    const each = (performance.now() - t0) / pairs;
    console.log(`the paths in ${id}: ${Q.n} points, made in ${Q.ms.toFixed(0)} ms; ${pairs} ways between the spawns, ${each.toFixed(2)} ms each`);
    assert.equal(none, 0, `${none} of ${pairs} spawns don't reach each other`);
    for (let p = 0; p < Q.n; p++) assert.ok(A.inside(Q.x[p], Q.z[p]));
    assert.ok(Q.n > 600, `${Q.n} points`);
  }
});

test('the levels: the higher, the sooner a bot puts down someone standing in the street', () => {
  // On the Rua do Fujacal, 20 m apart, the bot facing them, with a carabina.
  const a = { x: 176, z: 832 };
  const b = { x: 169.5, z: 813 };
  const target = { id: 'you', x: b.x, y: ground.groundAt(b.x, b.z), z: b.z, spd: 0 };
  const rows: string[] = [];
  let was = Infinity;
  for (const level of [0, 0.5, 1]) {
    let sum = 0;
    let shots = 0;
    let hit = 0;
    const tries = 40;
    for (let k = 0; k < tries; k++) {
      const squad = new Squad(F, P, level, seeded(1000 + k));
      // Facing them, give or take 30°.
      const at = { x: a.x, y: ground.groundAt(a.x, a.z), z: a.z, yaw: Math.atan2(b.z - a.z, b.x - a.x) + (seeded(k)() - 0.5) };
      squad.add('bot', 0, at).spawn(at, 'rifle', 0);
      let hurt = 0;
      let t = 0;
      for (; t < 20000 && hurt < 100; t += DT * 1000) {
        for (const ev of squad.step(DT, t, [target], [])) {
          shots++;
          for (const h of ev.hits) {
            hurt += h.n;
            hit++;
          }
        }
      }
      sum += t;
    }
    const mean = sum / tries / 1000;
    rows.push(`${level}: ${mean.toFixed(2)} s, ${((hit / shots) * 100).toFixed(0)}% of ${(shots / tries).toFixed(0)} shots hit`);
    assert.ok(mean < was, `level ${level} no quicker than the one under it`);
    was = mean;
  }
  console.log(`a bot with a carabina putting down someone standing 20 m off, the mean of 40: ${rows.join('; ')}`);
});

// Three bots alone in an arena for so many minutes: what they did.
function round(id: string, minutes: number, seed: number) {
  const A = fields.get(id)!;
  const squad = new Squad(A, A.paths, 0.5, seeded(seed));
  const ids = ['bot-1', 'bot-2', 'bot-3'];
  ids.forEach((id, k) => squad.add(id, 0, A.spawns[(k * 3) % A.spawns.length]));
  const board: Score[] = [];
  const add = (id: string) => {
    const s = { id, kills: 0, deaths: 0 };
    board.push(s);
    return s;
  };
  ids.forEach(add);
  // Where each has been, in squares of 10 m; how far each walked; how long indoors, and up a tower.
  const squares = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  const walked = new Map<string, number>(ids.map((id) => [id, 0]));
  const last = new Map(squad.bots.map((b) => [b.id, { ...b.w.p }]));
  let indoors = 0;
  let upstairs = 0;
  let shots = 0;
  let blind = 0;
  let through = 0;
  let hits = 0;
  let ms = 0;
  let worst = 0;
  const steps = (minutes * 60) / DT;
  for (let i = 0; i < steps; i++) {
    const t = i * DT * 1000;
    // Where everyone stood as the shots were fired.
    const at = new Map(squad.bots.map((b) => [b.id, { ...b.w.p, alive: b.s.alive }]));
    const t0 = performance.now();
    const fired: ShotEv[] = squad.step(DT, t, [], []);
    const took = performance.now() - t0;
    ms += took;
    if (i > 120) worst = Math.max(worst, took);
    for (const ev of fired) {
      shots++;
      const eye = v3(ev.x, ev.y, ev.z);
      const others = [...at.entries()].filter(([id, o]) => id !== ev.owner && o.alive).map(([, o]) => o);
      // It saw someone it fired at.
      if (!others.some((o) => clear(A.ground, eye, v3(o.x, o.y + HEAD.y, o.z)) || clear(A.ground, eye, v3(o.x, o.y + CHEST, o.z)))) blind++;
      // What it hit, a pellet reached before the world stopped it.
      for (const h of ev.hits) {
        hits++;
        const v = at.get(h.v)!;
        const ok = pellets(ev).some((d) => {
          const b = hitBody(eye, d, { id: h.v, ...v }, KITS[ev.kit].range);
          return b && b.t <= sight(A.ground, eye, d, KITS[ev.kit].range).t;
        });
        if (!ok) through++;
      }
      for (const d of squad.shot(ev, t)) tally(board, d, add);
    }
    for (const b of squad.bots) {
      const p = b.w.p;
      const q = last.get(b.id)!;
      const step = Math.hypot(p.x - q.x, p.z - q.z);
      if (step < 2) walked.set(b.id, walked.get(b.id)! + step);
      last.set(b.id, { ...p });
      if (!b.s.alive) continue;
      squares.get(b.id)!.add(`${Math.floor(p.x / 10)},${Math.floor(p.z / 10)}`);
      const r = A.ground.roomAt(p.x, p.z);
      if (r) indoors++;
      if (r?.tower && p.y > r.levels[1] - 0.5) upstairs++;
    }
  }
  board.sort(byKills);
  const area = new Set<string>();
  for (let p = 0; p < A.paths.n; p += 3) area.add(`${Math.floor(A.paths.x[p] / 10)},${Math.floor(A.paths.z[p] / 10)}`);
  const all = new Set([...squares.values()].flatMap((q) => [...q]));
  return { squad, ids, board, squares, walked, all, area, indoors: (indoors * DT) / 60, upstairs: (upstairs * DT) / 60, shots, blind, through, hits, perStep: ms / steps, worst };
}

test('three bots alone in each arena, five minutes: none stuck, none shooting through a wall, each scoring, indoors too', () => {
  for (const id of fields.keys()) {
    const r = round(id, 5, 75);
    console.log(`three bots in ${id}, 5 min: ${r.shots} shots, ${r.hits} hits, ${r.blind} fired at nobody in sight, ${r.through} through a wall; stuck ${r.squad.bots.map((b) => b.stuck).join(', ')}`);
    console.log(`  ${r.board.map((e) => `${e.id} ${e.kills} kills ${e.deaths} deaths`).join('; ')}`);
    console.log(`  walked ${r.ids.map((b) => `${r.walked.get(b)!.toFixed(0)} m over ${r.squares.get(b)!.size} squares of 10 m`).join('; ')}; together through ${r.all.size} of the ${r.area.size} squares that have paths; indoors ${r.indoors.toFixed(1)} bot-minutes of 15, up a tower ${r.upstairs.toFixed(1)}`);
    console.log(`  their cost: ${(r.perStep * 1000).toFixed(0)} µs a step of the simulation, ${(r.perStep * 2).toFixed(2)} ms a frame at 60 fps (two steps); the worst step after the first second ${r.worst.toFixed(1)} ms`);
    assert.equal(r.through, 0, 'a hit through a wall');
    assert.equal(r.blind, 0, 'a shot at nobody in sight');
    for (const b of r.squad.bots) assert.equal(b.stuck, 0, `${b.id} stuck ${b.stuck} times`);
    for (const b of r.ids) {
      assert.ok(r.board.find((e) => e.id === b)!.kills > 0, `${b} has no kills in ${id}`);
      assert.ok(r.squares.get(b)!.size >= 15, `${b} only in ${r.squares.get(b)!.size} squares`);
    }
    assert.ok(r.all.size >= r.area.size / 2, `the three only in ${r.all.size} of ${r.area.size} squares`);
    assert.ok(r.indoors > 0, 'never indoors');
    assert.ok(r.perStep * 2 < 2, `${(r.perStep * 2).toFixed(2)} ms a frame`);
  }
});

test('seven bots, a full room with the host, two minutes: their cost', () => {
  const V = fields.get('vilaca')!;
  const squad = new Squad(V, V.paths, 1, seeded(7));
  for (let k = 0; k < 7; k++) squad.add(`bot-${k + 1}`, 0, V.spawns[k % V.spawns.length]);
  const steps = (2 * 60) / DT;
  let ms = 0;
  let worst = 0;
  let shots = 0;
  for (let i = 0; i < steps; i++) {
    const t = i * DT * 1000;
    const t0 = performance.now();
    const fired = squad.step(DT, t, [], []);
    for (const ev of fired) squad.shot(ev, t);
    const took = performance.now() - t0;
    shots += fired.length;
    ms += took;
    if (i > 120) worst = Math.max(worst, took);
  }
  const perFrame = (ms / steps) * 2;
  console.log(`seven bots, two minutes: ${shots} shots; ${perFrame.toFixed(2)} ms a frame at 60 fps, the worst step after the first second ${worst.toFixed(1)} ms; stuck ${squad.bots.reduce((a, b) => a + b.stuck, 0)}`);
  assert.ok(perFrame < 2, `${perFrame.toFixed(2)} ms a frame`);
});
