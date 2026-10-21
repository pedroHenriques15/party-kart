import { loadWorld, type World } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GUNS, isGun, START, type Family, type Loadout } from '../src/game/arsenal.ts';
import { field, seeOn } from '../src/game/field.ts';
import { byKills, chestOf, headOf, hitBody, pellets, Soldier, tally, type DownEv, type Score } from '../src/game/fight.ts';
import { Squad, type Burning } from '../src/game/footbot.ts';
import { douse, FIRE, fly, hidden, type Cloud, type Flight, type NadeEv } from '../src/game/nades.ts';
import { v3, type V } from '../src/math.ts';
import { worldGround } from '../src/world/ground.ts';
import { clear, sight } from '../src/world/sight.ts';

// The bots on foot (braga-map's task 075): the paths they walk, and rounds of bots alone, in the arenas
// (its task 079) on the map's real tiles, with the guns, the grenades, the smokes and the fires.
const world: World = await loadWorld({ open: true });
const ground = worldGround(world);
// Each arena's field (braga-map's task 079), and the bots' paths in it.
const fields = new Map(world.arenas.map((a) => [a.id, field(ground, a)]));
const F = fields.get('topo')!;
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

test('the levels: the higher, the sooner a bot with an AK-47 puts down someone standing in the street', () => {
  // Two places in the arena 20 m apart in sight of each other, the bot facing them, give or take 30°;
  // they wear a vest and a helmet.
  const { a, b } = pairAt(20);
  const target = { id: 'you', ...b, spd: 0 };
  const rows: string[] = [];
  let was = Infinity;
  for (const level of [0, 0.5, 1]) {
    let sum = 0;
    let shots = 0;
    let hit = 0;
    let heads = 0;
    const tries = 30;
    for (let k = 0; k < tries; k++) {
      const squad = new Squad(F, F.paths, level, seeded(1000 + k));
      const at = { ...a, yaw: a.yaw + (seeded(k)() - 0.5) };
      squad.add('bot', 0, at).spawn(at, { ...START, primary: 'ak47', nades: [] }, 0);
      const you = new Soldier('you');
      you.arm(START, -5000);
      let t = 0;
      for (; t < 20000 && you.alive; t += DT * 1000) {
        for (const ev of squad.step(DT, t, [target], [])) {
          if (ev.k !== 'shot') continue;
          shots++;
          for (const h of ev.hits) {
            hit++;
            if (h.h) heads++;
            you.hurt(h, ev.w, t);
          }
        }
      }
      sum += t;
    }
    const mean = sum / tries / 1000;
    rows.push(`${level}: ${mean.toFixed(2)} s, ${((hit / shots) * 100).toFixed(0)}% of ${(shots / tries).toFixed(1)} shots hit, ${heads} to the head`);
    assert.ok(mean < was, `level ${level} no quicker than the one under it`);
    was = mean;
  }
  console.log(`a bot with an AK-47 putting down someone in a helmet standing 20 m off, the mean of 30: ${rows.join('; ')}`);
});

// Bots alone in an arena for so many minutes, at the levels given (a bot each), every man for himself
// or in two teams: what they did. The host's part played as main.ts plays it: their grenades flown and
// set off, the smokes' clouds and the molotovs' fires kept, and the fires burning them.
function round(id: string, minutes: number, seed: number, skills: number[], teams = false) {
  const A = fields.get(id)!;
  const squad = new Squad(A, A.paths, 0.5, seeded(seed), teams);
  const ids = skills.map((_, k) => `bot-${k + 1}`);
  ids.forEach((b, k) => squad.add(b, 0, A.spawns[(k * 3) % A.spawns.length], [], { skill: skills[k], team: teams ? k % 2 : 0 }));
  const team = new Map(squad.bots.map((b) => [b.id, b.s.team]));
  const board: Score[] = [];
  const add = (b: string) => {
    const s: Score = { id: b, kills: 0, deaths: 0, hs: 0, ...(teams ? { team: team.get(b) } : {}) };
    board.push(s);
    return s;
  };
  ids.forEach(add);
  const see = seeOn(A);
  const clearTo = (a: V, b: V) => clear(A.ground, a, b);
  const clouds: Cloud[] = [];
  const fires: Burning[] = [];
  const flying: { ev: NadeEv; f: Flight }[] = [];
  const nades: Record<string, number> = { he: 0, flash: 0, smoke: 0, molotov: 0 };
  const families: Partial<Record<Family, number>> = {};
  // The lives each family's guns were carried for, each bot's main gun.
  const lives: Partial<Record<Family, number>> = {};
  const born = new Map<string, number>();
  let shots = 0;
  let blind = 0;
  let through = 0;
  let hits = 0;
  let mates = 0;
  let ms = 0;
  let worst = 0;
  let burnt = 0;
  let blasted = 0;
  let flashed = 0;
  const down = (d: DownEv) => {
    if (teams && d.by !== d.victim && team.get(d.by) === team.get(d.victim)) mates++;
    tally(board, d, add);
  };
  // Where each has been, in squares of 10 m.
  const squares = new Map<string, Set<string>>(ids.map((b) => [b, new Set()]));
  const steps = (minutes * 60) / DT;
  for (let i = 0; i < steps; i++) {
    const t = i * DT * 1000;
    // Where everyone stood as the shots were fired.
    const at = new Map(squad.bots.map((b) => [b.id, { ...b.body(), alive: b.s.alive }]));
    const live = { clouds: clouds.filter((c) => t - c.t0 < 20000), fires: fires.filter((f) => t < f.out) };
    const t0 = performance.now();
    const evs = squad.step(DT, t, [], [], live);
    const took = performance.now() - t0;
    ms += took;
    if (i > 120) worst = Math.max(worst, took);
    for (const ev of evs) {
      if (ev.k === 'nade') {
        nades[ev.w]++;
        flying.push({ ev, f: fly(ev, see) });
        continue;
      }
      if (ev.k !== 'shot') continue;
      shots++;
      if (isGun(ev.w)) families[GUNS[ev.w].family] = (families[GUNS[ev.w].family] ?? 0) + 1;
      const eye = v3(ev.x, ev.y, ev.z);
      const shooter = squad.bots.find((b) => b.id === ev.owner)!;
      const others = [...at.values()].filter((o) => o.id !== ev.owner && o.alive && (!teams || team.get(o.id) !== team.get(ev.owner)));
      // It saw someone it fired at, unless it's flashed and spraying where it last saw them.
      if (!shooter.blinded(t) && !others.some((o) => clear(A.ground, eye, headOf(o)) || clear(A.ground, eye, chestOf(o)))) blind++;
      // What it hit, a pellet reached before the world stopped it.
      for (const h of ev.hits) {
        hits++;
        const v = at.get(h.v)!;
        const range = isGun(ev.w) ? GUNS[ev.w].range : 2.2;
        const ok = pellets(ev).some((d) => {
          const b = hitBody(eye, d, v, range, ev.w === 'knife' ? 0.12 : 0);
          return b && b.t <= sight(A.ground, eye, d, range).t;
        });
        if (!ok) through++;
      }
      for (const d of squad.shot(ev, t)) down(d);
    }
    // The grenades going off.
    for (let k = flying.length - 1; k >= 0; k--) {
      const { ev, f } = flying[k];
      if (f.at.t > t) continue;
      flying.splice(k, 1);
      if (ev.w === 'smoke') {
        const c = { x: f.at.x, y: f.at.y, z: f.at.z, t0: t };
        clouds.push(c);
        douse(fires, c);
      } else if (ev.w === 'molotov') {
        if (f.ground) fires.push({ x: f.at.x, y: f.at.y, z: f.at.z, t0: t, out: t + FIRE.last, owner: ev.owner });
      } else {
        const was = squad.bots.map((b) => b.s.health + b.flashed * 1000);
        for (const d of squad.boom(ev, f, t, clearTo)) down(d);
        squad.bots.forEach((b, j) => {
          const n = b.s.health + b.flashed * 1000;
          if (ev.w === 'he' && n < was[j]) blasted++;
          if (ev.w === 'flash' && n > was[j]) flashed++;
        });
      }
    }
    const hp = squad.bots.map((b) => b.s.health);
    for (const d of squad.burn(fires, t, DT)) down(d);
    squad.bots.forEach((b, j) => {
      if (b.s.health < hp[j]) burnt++;
    });
    for (const b of squad.bots) {
      if (!b.s.alive) continue;
      if (born.get(b.id) !== b.s.spawnAt) {
        born.set(b.id, b.s.spawnAt);
        const f = GUNS[b.s.primary ?? b.s.secondary].family;
        lives[f] = (lives[f] ?? 0) + 1;
      }
      squares.get(b.id)!.add(`${Math.floor(b.w.p.x / 10)},${Math.floor(b.w.p.z / 10)}`);
    }
  }
  board.sort(byKills);
  const all = new Set([...squares.values()].flatMap((q) => [...q]));
  const scoped = squad.bots.reduce((a, b) => a + b.scopedShots, 0);
  return { squad, ids, board, squares, all, lives, shots, blind, through, hits, mates, nades, families, scoped, burnt: (burnt * DT).toFixed(1), blasted, flashed, perStep: ms / steps, worst };
}

function report(label: string, r: ReturnType<typeof round>) {
  const lv = (id: string) => ['easy', 'medium', 'hard'][Math.round(r.squad.bots.find((b) => b.id === id)!.skill.level * 2)];
  console.log(`${label}: ${r.shots} shots (${r.scoped} scoped), ${r.hits} hits, ${r.blind} fired at nobody in sight, ${r.through} through a wall; stuck ${r.squad.bots.map((b) => b.stuck).join(', ')}`);
  console.log(`  ${r.board.map((e) => `${e.id} (${lv(e.id)}${e.team !== undefined ? `, team ${e.team}` : ''}) ${e.kills}/${e.deaths} ${e.hs} hs`).join('; ')}`);
  console.log(`  lives by family: ${Object.entries(r.lives).map(([f, n]) => `${f} ${n}`).join(', ')}`);
  console.log(`  shots by family: ${Object.entries(r.families).map(([f, n]) => `${f} ${n}`).join(', ')}; grenades: ${Object.entries(r.nades).map(([w, n]) => `${w} ${n}`).join(', ')}; ${r.blasted} hurt by an HE grenade, ${r.flashed} flashed, ${r.burnt} bot-seconds burning`);
  console.log(`  together through ${r.all.size} squares of 10 m; their cost ${(r.perStep * 1000).toFixed(0)} µs a step, the worst after the first second ${r.worst.toFixed(1)} ms`);
}

const SKILLS6 = [0, 0, 0.5, 0.5, 1, 1];
const families = new Map<Family, number>();
let scoped = 0;
let thrown = 0;

test('six bots in each arena, two of each level, two and a half minutes: kills, none stuck, none shooting through a wall, every gun and grenade', () => {
  const kills = [0, 0, 0];
  for (const id of fields.keys()) {
    const r = round(id, 2.5, 75, SKILLS6);
    report(`six bots in ${id}, 2.5 min`, r);
    assert.equal(r.through, 0, 'a hit through a wall');
    assert.ok(r.blind <= r.shots * 0.02, `${r.blind} shots at nobody in sight`);
    for (const b of r.squad.bots) assert.ok(b.stuck <= 2, `${b.id} stuck ${b.stuck} times`);
    assert.ok(r.board.reduce((a, e) => a + e.kills, 0) >= 15, 'hardly any kills');
    assert.ok(r.all.size >= 25, `the six only in ${r.all.size} squares`);
    assert.ok(r.perStep < 1, `${(r.perStep * 1000).toFixed(0)} µs a step`);
    for (const e of r.board) kills[Math.round(r.squad.bots.find((b) => b.id === e.id)!.skill.level * 2)] += e.kills;
    for (const [f, n] of Object.entries(r.families)) families.set(f as Family, (families.get(f as Family) ?? 0) + n);
    scoped += r.scoped;
    thrown += Object.values(r.nades).reduce((a, b) => a + b, 0);
  }
  console.log(`kills by level over the three arenas: easy ${kills[0]}, medium ${kills[1]}, hard ${kills[2]}; shots by family ${[...families].map(([f, n]) => `${f} ${n}`).join(', ')}; ${scoped} scoped; ${thrown} grenades`);
  assert.ok(kills[2] > kills[1] && kills[1] > kills[0], 'the better bots no better');
  assert.ok(scoped > 10, 'nobody scoped');
  assert.ok(thrown >= 5, `${thrown} grenades thrown`);
});

test('a team round, three against three, two minutes: no team kills', () => {
  const r = round('vilaca', 2, 31, [0.5, 0.5, 1, 1, 0, 0], true);
  report('three against three in vilaca, 2 min', r);
  assert.equal(r.mates, 0, 'a team-mate put down');
  assert.equal(r.through, 0, 'a hit through a wall');
  assert.ok(r.board.reduce((a, e) => a + e.kills, 0) >= 8, 'hardly any kills');
  // Over these rounds, every family's guns fired (the Negev's may be too rare to).
  for (const [f, n] of Object.entries(r.families)) families.set(f as Family, (families.get(f as Family) ?? 0) + n);
  for (const f of ['pistol', 'smg', 'rifle', 'sniper', 'shotgun'] as Family[]) assert.ok((families.get(f) ?? 0) > 0, `nobody fired a ${f}`);
});

// Two places on the arena's paths about d m apart, outdoors, on about the same level, each in sight
// of the other: for a bot and someone standing still.
function pairAt(d: number): { a: { x: number; y: number; z: number; yaw: number }; b: { x: number; y: number; z: number } } {
  const P = F.paths;
  for (let i = 0; i < P.n; i += 7) {
    if (ground.roomAt(P.x[i], P.z[i])) continue;
    for (let j = 0; j < P.n; j += 5) {
      const L = Math.hypot(P.x[j] - P.x[i], P.z[j] - P.z[i]);
      if (Math.abs(L - d) > 1 || Math.abs(P.y[j] - P.y[i]) > 0.5 || ground.roomAt(P.x[j], P.z[j])) continue;
      const a = { x: P.x[i], y: P.y[i], z: P.z[i] };
      const b = { x: P.x[j], y: P.y[j], z: P.z[j] };
      if (!clear(F.ground, v3(a.x, a.y + 1.65, a.z), chestOf({ id: '', ...b })) || !clear(F.ground, v3(a.x, a.y + 1.65, a.z), headOf({ id: '', ...b }))) continue;
      return { a: { ...a, yaw: Math.atan2(b.z - a.z, b.x - a.x) }, b };
    }
  }
  throw new Error(`no two places ${d} m apart in sight`);
}

// A hard bot with a loadout facing someone standing at b, for so long: its shots, and the squad.
function face(kit: Loadout, d: number, ms: number, world: { clouds: Cloud[]; fires: Burning[] } = { clouds: [], fires: [] }, before?: (squad: Squad, t: number) => void, spd = 0) {
  const { a, b } = pairAt(d);
  const squad = new Squad(F, F.paths, 1, seeded(5));
  const bot = squad.add('bot', 0, a);
  bot.spawn(a, kit, -5000);
  const target = { id: 'you', ...b, spd };
  const shots: { t: number; w: string; scoped: boolean; hit: boolean; smoked: boolean }[] = [];
  for (let t = 0; t < ms; t += DT * 1000) {
    before?.(squad, t);
    const was = bot.scopedShots;
    for (const ev of squad.step(DT, t, [target], [], world)) if (ev.k === 'shot') shots.push({ t, w: ev.w, scoped: bot.scopedShots > was, hit: ev.hits.length > 0, smoked: [headOf, chestOf].every((f) => hidden(v3(ev.x, ev.y, ev.z), f({ id: '', ...b }), world.clouds, t)) });
  }
  return { bot, squad, shots, a, b };
}

test('a bot and its guns: an AWP scoped far off and swapped for the pistol up close, a smoke it cannot see through, a flash that blinds it, a fire it walks out of', () => {
  // The AWP at 30 m: every shot scoped, the first once the scope has settled.
  const awp = face({ primary: 'awp', secondary: 'deagle', nades: [], armour: 2 }, 30, 4000);
  assert.ok(awp.shots.length > 0 && awp.shots.every((s) => s.w === 'awp' && s.scoped), `the AWP at 30 m: ${JSON.stringify(awp.shots)}`);
  // At 4 m, the Desert Eagle.
  const close = face({ primary: 'awp', secondary: 'deagle', nades: [], armour: 2 }, 4, 4000);
  assert.ok(close.shots.length > 0 && close.shots.every((s) => s.w === 'deagle'), `the AWP at 4 m: ${JSON.stringify(close.shots.map((s) => s.w))}`);
  // A smoke between them: no shot while it's thick; and none before.
  const { a, b } = pairAt(20);
  const mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y), z: (a.z + b.z) / 2, t0: -2000 };
  const smoked = face({ ...START, nades: [] }, 20, 4000, { clouds: [mid], fires: [] });
  assert.ok(smoked.shots.every((s) => !s.smoked), 'it shot through the smoke');
  assert.ok(!smoked.shots.length || smoked.shots[0].t > 1000, 'it shot at once, through the smoke');
  const clean = face({ ...START, nades: [] }, 20, 4000);
  assert.ok(clean.shots.length > 0, 'with no smoke, it never shot');
  // A flash in its face as the round starts: nothing for as long as it's blind, then (hearing them
  // run on the spot, turned to them again) it shoots.
  let blindFor = 0;
  const flashed = face({ ...START, nades: [] }, 20, 9000, undefined, (squad, t) => {
    if (t !== 0) return;
    const bot = squad.bots[0];
    const e = bot.eye();
    const d = bot.w.dir();
    const at = { x: e.x + d.x * 3, y: e.y - 0.1, z: e.z + d.z * 3 };
    squad.boom({ k: 'nade', id: 'n', owner: 'you', w: 'flash', t: -1600, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }, { path: [], at: { ...at, t: 0 }, bounces: [], ground: false }, 0, (p, q) => clear(F.ground, p, q));
    for (; bot.blinded(blindFor); blindFor += 10);
  }, 4);
  assert.ok(blindFor > 2500, `blind ${blindFor} ms`);
  assert.ok(flashed.shots.length > 0 && flashed.shots[0].t > blindFor, `shot at ${flashed.shots[0]?.t.toFixed(0)} ms, blind till ${blindFor}`);
  // Stood in a fire: out of it within a second and a half, burnt meanwhile, the fire's thrower
  // credited if it puts it down.
  const fire = { x: a.x, y: a.y, z: a.z, t0: -100, out: 7000, owner: 'you' };
  const burnt = face({ ...START, nades: [] }, 20, 1500, { clouds: [], fires: [fire] });
  const p = burnt.bot.w.p;
  assert.ok(Math.hypot(p.x - fire.x, p.z - fire.z) > FIRE.r, `still in the fire, ${Math.hypot(p.x - fire.x, p.z - fire.z).toFixed(1)} m from its middle`);
  const squad = new Squad(F, F.paths, 1, seeded(9));
  const bot = squad.add('bot', 0, a);
  let downs: DownEv[] = [];
  for (let t = 0; t < 6000 && !downs.length; t += DT * 1000) downs = squad.burn([fire], t, DT);
  assert.ok(downs.length === 1 && downs[0].by === 'you' && downs[0].w === 'molotov' && !bot.s.alive, 'burnt down in the fire');
  console.log(`a hard bot: the AWP at 30 m, ${awp.shots.length} shots, all scoped, the first at ${awp.shots[0].t.toFixed(0)} ms; at 4 m the Desert Eagle, ${close.shots.length} shots; behind a smoke ${smoked.shots.length} shots (once it had walked round it), without ${clean.shots.length}; flashed ${blindFor} ms, its first shot at ${flashed.shots[0].t.toFixed(0)} ms; out of a fire after ${'<'}1.5 s`);
});
