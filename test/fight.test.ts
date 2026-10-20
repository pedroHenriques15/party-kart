import { loadWorld, type World } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byKills, damage, eyeOf, field, fire, fighterOf, hitBody, KIT_IDS, KITS, landed, pickSpawn, RESPAWN, SAFE, seeOn, Soldier, tally, type Body, type DownEv, type KitId, type Score, type See, type ShotEv } from '../src/game/fight.ts';
import { RUN, STAND, Walker } from '../src/game/walker.ts';
import { norm, v3, type V } from '../src/math.ts';
import { worldGround } from '../src/world/ground.ts';
import { clear, sight } from '../src/world/sight.ts';

// The deathmatch (braga-map's task 074): line of sight, the kits, a round, and the area's edge, on the
// map's real tiles.
const world: World = await loadWorld({ open: true });
const ground = worldGround(world);
const built = performance.now();
// The Topo do Fujacal, the Rua do Fujacal by the race's start (braga-map's task 079).
const F = field(ground, world.arenas.find((a) => a.id === 'topo')!);
const fieldMs = performance.now() - built;
const DT = 1 / 120;

test('line of sight: down an open street, and not through a building', () => {
  // Along the Rua do Fujacal, eye to eye, 43 m.
  const a = v3(176, ground.groundAt(176, 832) + 1.65, 832);
  const b = v3(162, ground.groundAt(162, 791) + 1.65, 791);
  assert.ok(clear(ground, a, b), 'the Rua do Fujacal is open');
  // A block of flats' front on the Alameda do Fujacal, from (129.5, 812.5) to (141, 809): from 6 m in
  // front of it, through it to 25 m behind.
  const [mx, mz] = [135.25, 810.75];
  const L = Math.hypot(11.5, 3.5);
  const [nx, nz] = [-3.5 / L, -11.5 / L];
  const front = v3(mx + nx * 6, ground.groundAt(mx + nx * 6, mz + nz * 6) + 1.65, mz + nz * 6);
  const back = v3(mx - nx * 25, front.y, mz - nz * 25);
  const d = norm(v3(back.x - front.x, back.y - front.y, back.z - front.z));
  const s = sight(ground, front, d, 40);
  assert.equal(s.what, 'building');
  assert.ok(Math.abs(s.t - 6) < 0.2, `stopped ${s.t.toFixed(2)} m on, at the wall 6 m away`);
  assert.ok(Math.abs(s.nx * nx + s.nz * nz - 1) < 0.01, 'its mark faces the shooter');
  // Into the ground: from the eye, down at 45° ahead, onto the street 1.65 m ahead.
  const g = sight(ground, a, norm(v3(b.x - a.x, -Math.hypot(b.x - a.x, b.z - a.z), b.z - a.z)), 10);
  assert.equal(g.what, 'ground');
  assert.ok(Math.abs(g.t - 1.65 * Math.SQRT2) < 0.25, `the street ${g.t.toFixed(2)} m along the ray`);
});

test('line of sight: fast enough for every shot and every bot looking, between the spawns', () => {
  const pairs: [V, V][] = [];
  for (const a of F.spawns) for (const b of F.spawns) if (a !== b) pairs.push([eyeOf(a), eyeOf(b)]);
  let open = 0;
  const t0 = performance.now();
  for (let k = 0; k < 3; k++) for (const [a, b] of pairs) if (clear(F.ground, a, b)) open++;
  const each = ((performance.now() - t0) * 1000) / (pairs.length * 3);
  const far = pairs.reduce((s, [a, b]) => s + Math.hypot(b.x - a.x, b.z - a.z), 0) / pairs.length;
  console.log(`line of sight between ${F.spawns.length} spawns: ${pairs.length} pairs, ${(far).toFixed(0)} m apart on average, ${Math.round(open / 3)} open; ${each.toFixed(0)} µs a look`);
  assert.ok(each < 400, `${each.toFixed(0)} µs a look`);
  console.log(`the round's field built in ${fieldMs.toFixed(0)} ms: ${F.spawns.length} spawns, ${F.rails.length} railings ${F.rails.reduce((s, r) => s + r.length, 0)} m, ${F.gates.length} gates`);
});

test("a bullet's hitboxes: the head, the body and the legs, as the figure's drawn", () => {
  const b: Body = { id: 'b', x: 10, y: 0, z: 0 };
  const at = (y: number) => hitBody(v3(0, y, 0), v3(1, 0, 0), b, 50);
  assert.equal(at(1.4)?.part, 'head');
  assert.equal(at(0.8)?.part, 'body');
  assert.equal(at(0.3)?.part, 'legs');
  assert.equal(at(1.8), null);
  assert.equal(hitBody(v3(0, 0.8, 0.5), v3(1, 0, 0), b, 50), null);
  assert.equal(hitBody(v3(0, 0.8, 0), v3(1, 0, 0), b, 9), null, 'past what stopped the ray');
});

// A duel's half: how long a kit takes to put down someone standing d metres off, aiming at their
// chest, firing as fast as it may (reloading when it must), running or not; the mean over n tries.
const open: See = (o, d, max) => ({ t: max, x: o.x + d.x * max, y: o.y + d.y * max, z: o.z + d.z * max, nx: 0, ny: 0, nz: 0, what: null });
function ttk(kit: KitId, d: number, running: boolean, scoped: boolean, n = 300): number {
  let sum = 0;
  let seed = 12345;
  for (let k = 0; k < n; k++) {
    const s = new Soldier('a', kit);
    s.scoped = scoped;
    const target: Body = { id: 'b', x: d, y: 0, z: 0 };
    let hurt = 0;
    let t = 0;
    for (; t < 30000 && hurt < 100; t += DT * 1000) {
      s.step(DT, t);
      if (s.ammo === 0) s.reload(t);
      const ev = fire(s, v3(0, 1.65, 0), norm(v3(d, 0.8 - 1.65, 0)), running ? RUN : 0, false, t, [target], open, (seed = (seed * 16807) % 2147483647));
      if (ev) hurt += ev.hits.reduce((a, h) => a + h.n, 0);
    }
    sum += t;
  }
  return sum / n / 1000;
}

test('the kits: their damage at range, and no kit wins every duel', () => {
  for (const id of KIT_IDS) {
    const k = KITS[id];
    assert.equal(damage(k, 0), k.dmg);
    assert.equal(damage(k, k.far + 1), k.dmgFar);
    assert.ok(damage(k, (k.near + k.far) / 2) < k.dmg && damage(k, (k.near + k.far) / 2) > k.dmgFar);
    assert.equal(damage(k, k.range + 1), 0);
  }
  const duels: [number, boolean][] = [[4, false], [10, false], [20, false], [40, false], [80, false], [150, false], [15, true]];
  const wins: Record<string, string[]> = {};
  const rows: string[] = [];
  for (const [d, running] of duels) {
    const times = KIT_IDS.map((id) => {
      const best = Math.min(ttk(id, d, running, false), KITS[id].scope && d >= 20 ? ttk(id, d, running, true) : Infinity);
      return { id, best };
    });
    const win = times.reduce((a, b) => (b.best < a.best ? b : a));
    (wins[win.id] ??= []).push(`${d} m${running ? ' running' : ''}`);
    rows.push(`${String(d).padStart(4)} m${running ? ' running' : '        '}  ${times.map((x) => `${x.id} ${x.best.toFixed(2)} s`.padEnd(16)).join('')}  → ${win.id}`);
  }
  console.log(`the times to kill, aiming at the chest:\n${rows.join('\n')}`);
  assert.ok(Object.keys(wins).length > 1, 'one kit wins everywhere');
  for (const [id, where] of Object.entries(wins)) assert.ok(where.length < duels.length, `${id} wins every duel`);
});

test('a round: two fighters, the shots, a kill, the score, the respawn away from the other, the clock', () => {
  const minutes = 3;
  const endAt = minutes * 60_000;
  const A = new Soldier('a', 'rifle');
  const B = new Soldier('b', 'pistol');
  A.arm('rifle', 0);
  B.arm('pistol', 0);
  // On the Rua do Fujacal, 20 m apart, facing each other.
  const pa = v3(176, ground.groundAt(176, 832), 832);
  const pb = v3(169.5, ground.groundAt(169.5, 813), 813);
  const board: Score[] = [];
  const add = (id: string) => {
    const s = { id, kills: 0, deaths: 0 };
    board.push(s);
    return s;
  };
  const see = seeOn(F);
  let t = 0;
  let down: DownEv | null = null;
  let shots = 0;
  // While B is still safe from coming in, A's shots do nothing.
  for (; t < endAt && !down; t += DT * 1000) {
    A.step(DT, t);
    B.step(DT, t);
    const aim = norm(v3(pb.x - pa.x, pb.y + 0.8 - pa.y - 1.65, pb.z - pa.z));
    const ev: ShotEv | null = fire(A, eyeOf(pa), aim, 0, false, t, [{ id: 'b', ...pb }], see, (t * 7919) | 0);
    if (!ev) {
      if (A.ammo === 0) A.reload(t);
      continue;
    }
    shots++;
    if (t < SAFE) assert.ok(!ev.hits.length || !B.hurt(ev.hits[0].n, t) && B.health === 100, 'hurt while safe');
    for (const h of ev.hits) if (h.v === 'b' && B.hurt(h.n, t)) down = { k: 'down', id: 'd1', victim: 'b', by: ev.owner, kit: ev.kit, head: h.head, ...pb };
    assert.ok(landed(ev, see).every((s) => s.t > 0), 'a mark where it landed');
  }
  assert.ok(down, 'B went down');
  assert.ok(t > SAFE && t < SAFE + 3000, `B down at ${(t / 1000).toFixed(2)} s, after ${shots} shots`);
  tally(board, down!, add);
  tally(board, { victim: 'a', by: 'a' }, add);
  board.sort(byKills);
  assert.deepEqual(board, [{ id: 'a', kills: 1, deaths: 1 }, { id: 'b', kills: 0, deaths: 1 }]);
  assert.equal(fighterOf(B.flags(t)).down, true);
  // Back after RESPAWN, at a spawn A can't see, as whole as before and safe a moment.
  t += RESPAWN;
  const s = pickSpawn(F, [{ id: 'a', ...pa }]);
  assert.ok(!clear(F.ground, eyeOf(pa), eyeOf(s)), 'A sees where B comes back');
  assert.ok(Math.hypot(s.x - pa.x, s.z - pa.z) > 20, `B back ${Math.hypot(s.x - pa.x, s.z - pa.z).toFixed(0)} m from A`);
  B.arm('shotgun', t);
  assert.equal(B.health, 100);
  assert.equal(B.hurt(50, t + SAFE / 2), false);
  assert.equal(B.health, 100);
  B.hurt(50, t + SAFE + 1);
  assert.equal(B.health, 50);
  // Health back once unhurt for a while.
  for (let k = 0; k < 12 / DT; k++) B.step(DT, t + SAFE + 1 + k * DT * 1000);
  assert.equal(B.health, 100);
  assert.ok(t < endAt, "the round's clock still running");
});

test("the arenas' edges: a walker can't leave one, at its gates or along it", () => {
  let out = 0;
  let walks = 0;
  let gates = 0;
  for (const a of world.arenas) {
    const A = a.id === 'topo' ? F : field(ground, a);
    const targets = [...A.gates.map((g) => ({ x: g.x + Math.cos(g.heading) * 15, z: g.z + Math.sin(g.heading) * 15, from: g })), ...A.rails.filter((r) => r.length > 6).map((r) => ({ x: r[Math.floor(r.length / 2)].x, z: r[Math.floor(r.length / 2)].z, from: null }))];
    gates += A.gates.length;
    for (const tg of targets) {
      // From the nearest spawn, or for a gate from 8 m inside it, running straight at it and past.
      const start = tg.from ? { x: tg.from.x - Math.cos(tg.from.heading) * 8, z: tg.from.z - Math.sin(tg.from.heading) * 8 } : A.spawns.reduce((p, q) => (Math.hypot(q.x - tg.x, q.z - tg.z) < Math.hypot(p.x - tg.x, p.z - tg.z) ? q : p));
      if (!world.inArena(a.id, start.x, start.z) || ground.roomAt(start.x, start.z)) continue;
      const w = new Walker(A.ground, v3(start.x, ground.groundAt(start.x, start.z) + 0.3, start.z), Math.atan2(tg.z - start.z, tg.x - start.x));
      w.bound = A.inside;
      walks++;
      for (let i = 0; i < 20 / DT; i++) {
        w.step({ ...STAND, fwd: 1, run: true }, DT);
        if (!world.inArena(a.id, w.p.x, w.p.z)) {
          out++;
          break;
        }
      }
    }
  }
  console.log(`the arenas' edges: ${walks} runs at them, at ${gates} gates and stretches of railing; out ${out}`);
  assert.ok(walks > 30);
  assert.equal(out, 0);
});
