import amigosPlan from 'braga-map/tracks/amigos.js';
import { loadWorld, map } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onRoute, Router, type Route } from '../src/world/route.ts';

// The GPS's routes (braga-map's task 107) on the map's road graph: by car by the rules of the road,
// on foot any way along the streets and the paths. Each route checked against the map's data, not
// against how the router works it out.
const world = await loadWorld({ open: true });
const router = new Router(world.roads, world.turns);
const lengthOf = (i: number) => world.roads[i].pts.reduce((m, p, k, a) => (k ? m + Math.hypot(p[0] - a[k - 1][0], p[1] - a[k - 1][1]) : 0), 0);
const key = (p: readonly [number, number]) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
const bans = new Set(world.turns.map((t) => `${key(t.at)}|${key(t.from)}|${key(t.to)}`));
// The start, by the plinth on the Rua do Fujacal; the Picoto's top, its white cross.
const plinth = { x: amigosPlan.points[0].p[0], z: amigosPlan.points[0].p[2] };
const cross = map().sights.find((s) => s.kind === 'cruzeiro')!;

// Each turn a route takes from one stretch onto the next: where, and the points either side of it.
function turnsOf(route: Route) {
  const out: { at: [number, number]; from: [number, number]; to: [number, number]; back: boolean }[] = [];
  for (let k = 1; k < route.legs.length; k++) {
    const a = route.legs[k - 1];
    const b = route.legs[k];
    const pa = world.roads[a.road].pts;
    const pb = world.roads[b.road].pts;
    const at = a.fwd ? pa[pa.length - 1] : pa[0];
    out.push({ at, from: a.fwd ? pa[pa.length - 2] : pa[1], to: b.fwd ? pb[1] : pb[pb.length - 2], back: a.road === b.road });
  }
  return out;
}

// What a car may not do on a route: a one-way street the wrong way, a banned turn, turning back but
// at a dead end.
function broken(route: Route): string[] {
  const out: string[] = [];
  for (const l of route.legs) {
    const r = world.roads[l.road];
    if (!r.car && !l.off) out.push(`not for cars, and not said to be off the streets: ${r.name ?? l.road}`);
    if (l.off && r.car) out.push(`a street taken as off them: ${r.name ?? l.road}`);
    if (r.oneway && !l.fwd) out.push(`the wrong way down ${r.name ?? l.road}`);
  }
  for (const t of turnsOf(route)) {
    if (bans.has(`${key(t.at)}|${key(t.from)}|${key(t.to)}`)) out.push(`a banned turn at ${t.at}`);
    if (t.back) {
      const others = world.roads.filter((r) => r.car && (key(r.pts[0]) === key(t.at) || key(r.pts[r.pts.length - 1]) === key(t.at)));
      if (others.length > 1) out.push(`turning back at ${t.at}`);
    }
  }
  return out;
}

test('by car from the plinth to the Picoto: the one-way streets the right way, no banned turn, the turns told', () => {
  const r = router.route({ ...plinth, yaw: 0 }, cross, 'car');
  assert.ok(r, 'a route');
  assert.deepEqual(broken(r), []);
  assert.ok(r.length > 1500 && r.length < 6000, `${Math.round(r.length)} m`);
  // The Picoto's top has streets only from outside the open world's area: the route takes the streets
  // as far as they go towards it, and only then the paths up, as a kart can (across the top's own
  // streets on the way): most of it on the streets, and off them once or twice.
  const offM = r.legs.reduce((m, l) => m + (l.off ? lengthOf(l.road) : 0), 0);
  const leaves = r.legs.filter((l, k) => l.off && (k === 0 || !r.legs[k - 1].off)).length;
  assert.ok(offM < 0.4 * r.length && leaves >= 1 && leaves <= 2, `${Math.round(offM)} m off the streets, left ${leaves} times`);
  const end = r.pts[r.pts.length - 1];
  assert.ok(Math.hypot(end[0] - cross.x, end[1] - cross.z) < 80, `ends ${Math.round(Math.hypot(end[0] - cross.x, end[1] - cross.z))} m from the cross`);
  // Its turns, in order along it, each at a junction on it, onto a named street most of the time.
  assert.ok(r.steps.length >= 3, `${r.steps.length} turns`);
  for (let k = 1; k < r.steps.length; k++) assert.ok(r.steps[k].at >= r.steps[k - 1].at);
  assert.ok(r.steps.filter((s) => s.onto).length >= r.steps.length / 2, r.steps.map((s) => `${s.turn} ${s.onto}`).join(', '));
  // Where you are along it: its middle, half way along.
  const mid = r.pts[Math.floor(r.pts.length / 2)];
  const at = onRoute(r, mid[0], mid[1]);
  assert.ok(at.off < 0.5 && Math.abs(at.along - r.along[Math.floor(r.pts.length / 2)]) < 1);
  console.log(`  by car: ${(r.length / 1000).toFixed(2)} km in ${Math.round(r.time)} s, ${r.steps.length} turns: ${r.steps.map((s) => (s.turn === 'roundabout' ? `roundabout exit ${s.exit}` : s.turn) + (s.onto ? ` (${s.onto})` : '')).join(', ')}`);
});

test("on foot to the Picoto: the paths and the steps, any way, and a flight of steps a car goes round", () => {
  const r = router.route(plinth, cross, 'foot');
  assert.ok(r, 'a route on foot');
  const car = router.route({ ...plinth, yaw: 0 }, cross, 'car')!;
  assert.ok(r.length <= car.length, `on foot ${Math.round(r.length)} m, by car ${Math.round(car.length)} m`);
  assert.ok(r.legs.every((l) => world.roads[l.road].foot));
  // A flight of steps between two streets: on foot up it, by car round by the streets, further.
  const flights = world.roads.filter((s) => s.kind === 13 && Math.hypot(s.pts[0][0] - s.pts[s.pts.length - 1][0], s.pts[0][1] - s.pts[s.pts.length - 1][1]) > 15);
  let shown = 0;
  for (const s of flights) {
    const a = { x: s.pts[0][0], z: s.pts[0][1] };
    const b = { x: s.pts[s.pts.length - 1][0], z: s.pts[s.pts.length - 1][1] };
    const ca = router.spots(a.x, a.z, 'car', 10)[0];
    const cb = router.spots(b.x, b.z, 'car', 10)[0];
    if (!ca || !cb) continue;
    const walk = router.route(a, b, 'foot');
    const drive = router.route(a, b, 'car');
    if (!walk || !drive || drive.legs.some((l) => world.roads[l.road].kind === 13) || drive.length < 2 * walk.length) continue;
    assert.ok(walk.legs.some((l) => world.roads[l.road].kind === 13), 'on foot, up the steps');
    shown++;
  }
  assert.ok(shown >= 2, `${shown} flights of steps a walker takes and a car goes round, twice as far`);
  console.log(`  on foot: ${(r.length / 1000).toFixed(2)} km, ${r.legs.filter((l) => world.roads[l.road].kind === 13).length} flights of steps; ${shown} flights a car goes round`);
});

test('a turn the map bans: never taken, the car goes round', () => {
  let tried = 0;
  let round = 0;
  for (const t of world.turns) {
    // From a metre before the junction on the street one may not turn from, to a metre after it on
    // the street one may not turn onto.
    const toward = (p: [number, number], d: number) => {
      const L = Math.hypot(p[0] - t.at[0], p[1] - t.at[1]) || 1;
      return { x: t.at[0] + ((p[0] - t.at[0]) / L) * d, z: t.at[1] + ((p[1] - t.at[1]) / L) * d };
    };
    const r = router.route(toward(t.from, 1), toward(t.to, 1), 'car');
    tried++;
    if (!r) continue;
    const used = turnsOf(r).some((u) => key(u.at) === key(t.at) && key(u.from) === key(t.from) && key(u.to) === key(t.to));
    assert.ok(!used, `the banned turn at ${t.at} taken`);
    assert.deepEqual(broken(r), []);
    if (r.length > 10) round++;
  }
  assert.ok(tried >= 30 && round >= tried / 2, `${round} of ${tried} banned turns gone round`);
});
