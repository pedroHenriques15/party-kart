import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fit, K_MAX, lengths, limits, onTheMap, pan, pointAt, toMap, toScreen, zoomAt, type Marked } from '../src/world/mapview.ts';

// The full map (braga-map's task 106): its view's sums (world/mapview.ts) and who it shows.
const city = { x0: -1500, x1: 2600, z0: -700, z1: 2500 };
const [W, H] = [1280, 720];

test('the full map frames a place whole, zooms about the pointer and pans with the finger, kept over the city', () => {
  const l = limits(city, W, H);
  // Zoomed out as far as the whole city on the screen, in as far as K_MAX.
  assert.ok(l.kMin * (city.x1 - city.x0) <= W && l.kMin * (city.z1 - city.z0) <= H);
  assert.equal(l.kMax, K_MAX);
  // An 80 m arena framed whole fills most of the screen.
  const arena = { x0: 100, x1: 180, z0: 300, z1: 370 };
  const v = fit(arena, W, H, 0.8);
  const [ax, ay] = toScreen(v, W, H, arena.x0, arena.z0);
  const [bx, by] = toScreen(v, W, H, arena.x1, arena.z1);
  assert.ok(ax >= 0 && bx <= W && ay >= 0 && by <= H, 'the arena whole on the screen');
  assert.ok(Math.max(bx - ax, by - ay) > 0.75 * H, 'and big on it');
  // The place under the pointer stays under it as it zooms.
  const v0 = { x: 400, z: 900, k: 1 };
  const before = toMap(v0, W, H, 300, 200);
  const v1 = zoomAt(v0, 2.5, 300, 200, l);
  assert.equal(v1.k, 2.5);
  const after = toMap(v1, W, H, 300, 200);
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 1e-6);
  // Never past its limits, however far the wheel goes; zoomed out as far as it goes, the city in the
  // middle of the screen.
  assert.equal(zoomAt(v0, 1e6, 300, 200, l).k, K_MAX);
  const out = zoomAt(v0, 1e-6, 300, 200, l);
  assert.equal(out.k, l.kMin);
  assert.deepEqual([out.x, out.z], [(city.x0 + city.x1) / 2, (city.z0 + city.z1) / 2]);
  // Dragged right and down, the map goes with the finger: what was west and north comes into the middle.
  const p = pan(v0, 100, 50, l);
  assert.deepEqual([p.x, p.z], [300, 850]);
  // And the city's edges come no further in than the screen's.
  const far = pan(v0, -1e7, -1e7, l);
  assert.deepEqual([far.x, far.z], [city.x1 - W / 2, city.z1 - H / 2]);
});

test("a street's name goes along it: the point so far along its line", () => {
  const pts: [number, number][] = [
    [0, 0],
    [30, 0],
    [30, 40],
  ];
  const cum = lengths(pts);
  assert.deepEqual(cum, [0, 30, 70]);
  assert.deepEqual(pointAt(pts, cum, 15), [15, 0]);
  assert.deepEqual(pointAt(pts, cum, 50), [30, 20]);
  assert.deepEqual(pointAt(pts, cum, -5), [0, 0]);
  assert.deepEqual(pointAt(pts, cum, 99), [30, 40]);
});

test('in a deathmatch round the maps show no foe: only your team-mates who are up', () => {
  const people: Marked[] = [
    { id: 'mate', x: 1, z: 1, color: '#00f', fighting: true, down: false },
    { id: 'foe', x: 2, z: 2, color: '#f80', fighting: true, down: false },
    { id: 'mate-down', x: 3, z: 3, color: '#00f', fighting: true, down: true },
    { id: 'mate-kart', x: 4, z: 4, color: '#00f', fighting: false, down: false },
  ];
  const teams = (id: string) => id.startsWith('mate');
  assert.deepEqual(
    onTheMap(people, { mate: teams }).map((p) => p.id),
    ['mate'],
  );
  // Each for themselves, nobody's your team-mate: nobody but you.
  assert.deepEqual(onTheMap(people, { mate: () => false }), []);
  // Round the city, everyone.
  assert.equal(onTheMap(people, null).length, people.length);
});
