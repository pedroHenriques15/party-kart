import { loadWorld } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { speedOf } from '../src/car/car.ts';
import { CEILING, FASTER, FLOOR, Flyer, landing, nearestOn, onGrid, paceAt, STILL, type FlyInput } from '../src/game/flyer.ts';
import { v3 } from '../src/math.ts';
import { worldGround } from '../src/world/ground.ts';

// The flying camera (braga-map's task 054), over a ground of its own: rising to the east, in waves.
const DT = 1 / 60;
const ground = (x: number, z: number) => 20 + x * 0.05 + 8 * Math.sin(x / 40) * Math.cos(z / 55);
const flat = () => 0;
const bound = { x0: -2000, x1: 2000, z0: -1500, z1: 1500 };
const fly = (f: Flyer, inp: Partial<FlyInput>, s: number, each?: () => void) => {
  for (let k = 0; k < Math.round(s / DT); k++) {
    f.step({ ...STILL, ...inp }, DT);
    each?.();
  }
};
const speed = (f: Flyer) => Math.hypot(f.v.x, f.v.y, f.v.z);

test('flying: driven at the ground, it stops 1 m over it', () => {
  const f = new Flyer(v3(0, 150, 0), 0, -1.2, ground, bound);
  let low = Infinity;
  fly(f, { fwd: 1, up: -1 }, 10, () => (low = Math.min(low, f.height())));
  assert.ok(Math.abs(f.height() - FLOOR) < 0.01, `${f.height().toFixed(2)} m over the ground`);
  assert.ok(low >= FLOOR - 1e-9, `${low.toFixed(2)} m over it at the lowest`);
});

test('flying: driven at its bound, faster, it stops there', () => {
  const f = new Flyer(v3(0, 300, 0), 0.6, 0, ground, bound);
  fly(f, { fwd: 1, fast: true }, 10);
  assert.equal(f.p.x, bound.x1);
  assert.equal(f.p.z, bound.z1);
  // Started 300 m up, so it flew at its fastest: four times 80 m/s.
  fly(f, { fwd: -1, fast: true }, 1);
  assert.ok(Math.abs(speed(f) - 80 * FASTER) < 1, `${speed(f).toFixed(1)} m/s`);
});

test('flying: straight up, it stops 500 m over the ground, and comes down to that over a valley', () => {
  const f = new Flyer(v3(100, ground(100, 50) + 2, 50), 0, 0, ground, bound);
  fly(f, { up: 1 }, 10);
  assert.ok(Math.abs(f.height() - CEILING) < 0.5, `${f.height().toFixed(1)} m over the ground`);
  // Flown west at the ceiling, the ground falls away: it follows it down, a little behind.
  fly(f, { fwd: -1, up: 1 }, 10, () => assert.ok(f.height() < CEILING + 30, `${f.height().toFixed(1)} m over the ground`));
  assert.ok(Math.abs(f.height() - CEILING) < 5, `${f.height().toFixed(1)} m over the ground`);
});

test('flying: let go, it stops within half a second, from any pace', () => {
  for (const [h, fast] of [
    [2, false],
    [100, false],
    [300, true],
  ] as const) {
    const f = new Flyer(v3(0, h, 0), 0.3, 0, flat, bound);
    fly(f, { fwd: 1, side: 0.5, fast }, 3);
    const going = speed(f);
    const at = { ...f.p };
    fly(f, {}, 0.5);
    assert.equal(speed(f), 0, `from ${going.toFixed(0)} m/s, ${h} m up: ${speed(f).toFixed(2)} m/s after 0.5 s`);
    const drift = Math.hypot(f.p.x - at.x, f.p.z - at.z);
    assert.ok(drift < going * 0.25, `${drift.toFixed(1)} m on from ${going.toFixed(0)} m/s`);
  }
});

test('flying: about 6 m/s at a person\'s height, 80 m/s from 80 m up', () => {
  for (const [h, pace] of [
    [2, 6],
    [100, 80],
  ]) {
    const f = new Flyer(v3(0, h, 0), 1, 0, flat, bound);
    fly(f, { fwd: 1 }, 1);
    const x = f.p.x;
    const z = f.p.z;
    fly(f, { fwd: 1 }, 1);
    const went = Math.hypot(f.p.x - x, f.p.z - z);
    assert.ok(Math.abs(went - pace) < pace * 0.05, `${went.toFixed(1)} m/s at ${h} m`);
    assert.ok(Math.abs(f.p.y - h) < 1e-9, 'not level');
  }
  assert.ok(paceAt(40) > 6 && paceAt(40) < 80);
});

test('flying: it looks round, and never further up or down than 85°', () => {
  const f = new Flyer(v3(0, 50, 0), 0, 0, flat, bound);
  fly(f, { turn: 1 }, 0.5);
  assert.ok(Math.abs(f.yaw - 0.9) < 1e-9, `turned ${f.yaw.toFixed(2)} rad`);
  fly(f, { look: { x: 0, y: 0.1 } }, 1);
  assert.ok(Math.abs(f.pitch - (85 * Math.PI) / 180) < 1e-9);
  assert.ok(f.dir().y > 0.99);
  fly(f, { look: { x: 0.5, y: -0.2 } }, 1);
  assert.ok(Math.abs(f.pitch + (85 * Math.PI) / 180) < 1e-9);
  assert.ok(f.yaw > -Math.PI && f.yaw <= Math.PI);
  // Forward is level, whichever way it looks.
  fly(f, { fwd: 1 }, 1);
  assert.equal(f.p.y, 50);
});

test('the hills as drawn: two triangles a square, split from its (i + 1, j) corner to its (i, j + 1)', () => {
  const g = { x0: 100, z0: 200, step: 50, nx: 3, nz: 2, h: new Float32Array([0, 10, 20, 40, 0, 0]) };
  const y = (i: number, j: number) => g.h[j * g.nx + i];
  assert.equal(onGrid(g, 100, 200, y), 0);
  assert.equal(onGrid(g, 150, 200, y), 10);
  assert.equal(onGrid(g, 100, 249.999, y)?.toFixed(2), '40.00');
  // Halfway along the split, between 10 and 40; and past it, in the square's other triangle.
  assert.equal(onGrid(g, 125, 225, y), 25);
  assert.equal(onGrid(g, 140, 240, y)?.toFixed(2), String((0 + (40 - 0) * 0.2 + (10 - 0) * 0.2).toFixed(2)));
  assert.equal(onGrid(g, 99, 200, y), null);
  assert.equal(onGrid(g, 210, 200, y), null);
  assert.equal(onGrid(g, 175, 225, y, (i) => i !== 1), null);
});

test('landing: your kart on the street under the camera, or from outside the area, on its nearest', async () => {
  const world = await loadWorld({ open: true });
  const g = worldGround(world);
  const ring = world.open.pts;
  // Over the Rua do Fujacal (roam.test.ts's), 200 m up, facing north-west.
  const over = landing(g, 172, 400, 820, -2.2);
  assert.ok(Math.hypot(over.p.x - 172, over.p.z - 820) < 15, `landed at (${over.p.x.toFixed(0)}, ${over.p.z.toFixed(0)})`);
  assert.equal(g.floor(over.p.x, over.p.z, over.p.y).kind, 'road');
  assert.ok(Math.cos(over.yaw + 2.2) > 0, 'facing the way the camera faced');
  assert.equal(speedOf(over), 0);
  // 5 km east of the area's easternmost point, facing out: on a street near that edge, inside the
  // area, facing into it.
  const east = ring.reduce((a, b) => (b[0] > a[0] ? b : a));
  const far = landing(g, east[0] + 5000, 300, east[1], 0);
  assert.ok(g.d.inside.has(far.p.x, far.p.z));
  assert.ok(Math.hypot(far.p.x - east[0], far.p.z - east[1]) < 400, `landed at (${far.p.x.toFixed(0)}, ${far.p.z.toFixed(0)})`);
  assert.ok(Math.cos(far.yaw) < 0, 'facing into the area');
  assert.deepEqual(nearestOn([[0, 0], [10, 0], [10, 10], [0, 10]], 30, 4), [10, 4]);
});
