import { loadWorld, type World } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Soldier, type See } from '../src/game/fight.ts';
import { along, blast, blinding, burning, CLOUD, douse, FIRE, fly, hidden, inFire, throwOf, toss, type Blaze, type Cloud } from '../src/game/nades.ts';
import { norm, v3, type V } from '../src/math.ts';
import { worldGround } from '../src/world/ground.ts';
import { clear, sight } from '../src/world/sight.ts';

// The grenades, on the map's real tiles: their flights off the walls and onto the streets, the HE
// grenade's blast, the flash's blinding, the smoke's cloud and the molotov's fire.
const world: World = await loadWorld({ open: true });
const ground = worldGround(world);
// The world's ground, without what an arena puts in it (its cover moves, as arenas are tuned).
const see: See = (o, d, max) => sight(ground, o, d, max);
const clearTo = (a: V, b: V) => clear(ground, a, b);
const up = (x: number, z: number, h = 1.65) => v3(x, ground.groundAt(x, z) + h, z);
// Along the Rua do Fujacal, open for 43 m (fight.test.ts' line of sight).
const A = up(176, 832);
const B = up(162, 791);
const AB = norm(v3(B.x - A.x, 0, B.z - A.z));
// A block of flats' front on the Alameda do Fujacal, and the way out of it, towards the street.
const [mx, mz] = [135.25, 810.75];
const L = Math.hypot(11.5, 3.5);
const [nx, nz] = [-3.5 / L, -11.5 / L];
const front = (d: number, h = 1.65) => up(mx + nx * d, mz + nz * d, h);

test('a flight: the same from the same throw, bouncing off a wall, at rest on a street', () => {
  // Thrown hard at the block's front from 6 m: it comes back off it, on the street's side.
  const eye = front(6);
  const ev = throwOf('n1', 'a', 'he', 1000, eye, norm(v3(-nx, -0.05, -nz)), 1, v3());
  const f = fly(ev, see);
  assert.deepEqual(fly(ev, see), f, 'the same flight twice');
  assert.equal(f.at.t, 1000 + 1600, "the HE grenade's fuse");
  assert.ok(f.bounces.length >= 1 && f.bounces[0].v > 5, `${f.bounces.length} bounces`);
  assert.ok((f.at.x - mx) * nx + (f.at.z - mz) * nz > 0.2, 'it went through the wall');
  const p = along(f, 1000 + 300);
  assert.ok(Math.hypot(p.x - eye.x, p.z - eye.z) > 3, 'along its flight 0.3 s on');
  // A smoke lobbed down the Rua do Fujacal: it comes to rest on it, about 10 m on.
  const s = fly(throwOf('n2', 'a', 'smoke', 0, A, norm(v3(AB.x, 0.3, AB.z)), 0.3, v3()), see);
  const d = Math.hypot(s.at.x - A.x, s.at.z - A.z);
  assert.ok(s.ground, 'not on the ground');
  assert.ok(Math.abs(s.at.y - ground.groundAt(s.at.x, s.at.z)) < 0.3, `at rest ${(s.at.y - ground.groundAt(s.at.x, s.at.z)).toFixed(2)} m off the street`);
  assert.ok(d > 5 && d < 30, `${d.toFixed(1)} m on`);
  assert.ok(s.at.t < 6000, 'still rolling at the end');
  // A molotov breaks where it lands.
  const m = fly(throwOf('n3', 'a', 'molotov', 0, A, norm(v3(AB.x, 0.2, AB.z)), 0.6, v3()), see);
  assert.ok(m.ground && Math.abs(m.at.y - ground.groundAt(m.at.x, m.at.z)) < 0.3, 'not on the ground');
  assert.ok(m.at.t < 2500 && m.bounces.length <= 1, `broke at ${m.at.t.toFixed(0)} ms after ${m.bounces.length} bounces`);
  console.log(`flights: the HE grenade off the wall ${f.bounces.length} bounces, the first at ${f.bounces[0].v.toFixed(1)} m/s; the smoke at rest ${d.toFixed(1)} m down the street after ${(s.at.t / 1000).toFixed(2)} s; the molotov broke ${Math.hypot(m.at.x - A.x, m.at.z - A.z).toFixed(1)} m on after ${(m.at.t / 1000).toFixed(2)} s`);
});

test('a throw from the hand: the grenade gone from it, the gun back', () => {
  const s = new Soldier('a');
  s.arm({ primary: 'ak47', secondary: 'usp', nades: ['he', 'flash', 'flash'], armour: 2 }, 0);
  s.slot(4, 0);
  assert.equal(s.hand, 'he');
  assert.equal(toss(s, A, AB, 1, v3(), 100), null, 'thrown before it was drawn');
  const ev = toss(s, A, AB, 1, v3(), 1000)!;
  assert.equal(ev.w, 'he');
  assert.deepEqual(s.nades, ['flash', 'flash']);
  assert.equal(s.hand, 'ak47');
  s.slot(4, 5000);
  toss(s, A, AB, 1, v3(), 6000);
  assert.equal(s.hand, 'flash', 'the second flash comes to hand');
});

test("the HE grenade's blast: less the further, none past it, none through a wall", () => {
  const at = up(A.x + AB.x * 10, A.z + AB.z * 10, 0);
  const body = (d: number) => up(at.x + AB.x * d, at.z + AB.z * d, 0);
  const n = [0.5, 2, 4, 6, 8].map((d) => blast(at, body(d), clearTo));
  for (let k = 1; k < n.length; k++) assert.ok(n[k] < n[k - 1] || n[k] === 0, `${n.join(', ')}`);
  assert.ok(n[0] > 80 && n[4] === 0, n.join(', '));
  // On the street a metre from the block's front, and someone a metre inside it.
  const out = front(1, 0);
  const inside = front(-1, 0);
  assert.ok(blast(out, front(3, 0), clearTo) > 40, 'the same distance in the open');
  assert.equal(blast(out, inside, clearTo), 0, 'through the wall');
  console.log(`the HE grenade at 0.5, 2, 4, 6 and 8 m: ${n.join(', ')}`);
});

test("the flash: long looking at it, short looking away, nothing behind a wall", () => {
  const at = up(A.x + AB.x * 6, A.z + AB.z * 6, 1.2);
  const facing = blinding(at, A, AB, clearTo);
  const away = blinding(at, A, v3(-AB.x, 0, -AB.z), clearTo);
  // Looking 60° off it, out of the corner of an eye.
  const aside = blinding(at, A, norm(v3(AB.x * 0.5 - AB.z * 0.866, 0, AB.z * 0.5 + AB.x * 0.866)), clearTo);
  assert.ok(facing > 3000, `${facing} ms facing it`);
  assert.ok(away > 0 && away < 800, `${away} ms with its back to it`);
  assert.ok(aside > away && aside < facing, `${aside} ms looking aside`);
  // Thrown in front of the block, someone behind it looking its way.
  const pop = front(3, 1.2);
  const behind = front(-20);
  assert.equal(blinding(pop, behind, norm(v3(pop.x - behind.x, pop.y - behind.y, pop.z - behind.z)), clearTo), 0);
  console.log(`a flash 6 m off: ${facing} ms facing it, ${aside} ms looking aside, ${away} ms with its back to it`);
});

test('the smoke: hides a line through it, not one beside it, and puts out a fire', () => {
  const mid = up((A.x + B.x) / 2, (A.z + B.z) / 2, 0);
  const c: Cloud = { x: mid.x, y: mid.y, z: mid.z, t0: 1000 };
  const t = 1000 + CLOUD.grow + 500;
  assert.ok(hidden(A, B, [c], t), 'seen through the smoke');
  assert.ok(!hidden(A, B, [c], 1000 + 100), 'hidden before it is thick');
  assert.ok(!hidden(A, B, [c], 1000 + CLOUD.last + 1), 'hidden once it is gone');
  // Eight metres to the side, the same line is clear of it.
  const side = norm(v3(-AB.z, 0, AB.x));
  const a2 = v3(A.x + side.x * 8, A.y, A.z + side.z * 8);
  const b2 = v3(B.x + side.x * 8, B.y, B.z + side.z * 8);
  assert.ok(!hidden(a2, b2, [c], t), 'hidden beside the smoke');
  // A fire under it goes out when it goes off; one 15 m off burns on.
  const fires: Blaze[] = [
    { x: mid.x + 1, y: mid.y, z: mid.z, t0: 500, out: 500 + FIRE.last },
    { x: mid.x + AB.x * 15, y: mid.y, z: mid.z + AB.z * 15, t0: 500, out: 500 + FIRE.last },
  ];
  assert.ok(burning(fires[0], 900) && inFire(fires[0], v3(mid.x + 2, mid.y, mid.z), 900));
  douse(fires, c);
  assert.ok(!burning(fires[0], 1100) && !inFire(fires[0], v3(mid.x + 2, mid.y, mid.z), 1100), 'still burning under the smoke');
  assert.ok(burning(fires[1], 1100), 'a fire 15 m off put out');
  assert.ok(!burning(fires[1], 500 + FIRE.last), 'burning past its time');
});
