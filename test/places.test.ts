import amigosPlan from 'braga-map/tracks/amigos.js';
import { loadWorld, map } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fold, Places } from '../src/world/places.ts';
import { Router } from '../src/world/route.ts';

// Finding a place by its name on the full map (braga-map's task 109), and the GPS's route to it.
const world = await loadWorld({ open: true });
const places = new Places({ lines: world.lines, landmarks: map().landmarks, arenas: world.arenas, stops: world.stops, inside: (x, z) => world.inOpen(x, z) });
const router = new Router(world.roads, world.turns);
const plinth = { x: amigosPlan.points[0].p[0], z: amigosPlan.points[0].p[2] };

test('"picoto", "fujacal" and "joao xxi" find their places, accents or not, the nearest first', () => {
  assert.equal(fold('Avenida João XXI'), 'avenida joao xxi');
  const picoto = places.find('picoto', plinth);
  assert.ok(picoto.some((f) => f.kind === 'place' && /Picoto/.test(f.name)), picoto.map((f) => f.name).join(', '));
  const fujacal = places.find('fujacal', plinth);
  assert.equal(fujacal[0].name, 'Rua do Fujacal');
  assert.ok(fujacal[0].d < 5, `${fujacal[0].d} m: you're on it`);
  assert.ok(fujacal.some((f) => f.kind === 'arena' && f.name === 'Topo do Fujacal'));
  const joao = places.find('joao xxi', plinth);
  assert.equal(joao[0].name, 'Avenida João XXI');
  assert.deepEqual(places.find('João XXI', plinth)[0], joao[0]);
  // Every word asked, in any order; at most eight, nearest first.
  assert.equal(places.find('xxi joao', plinth)[0].name, 'Avenida João XXI');
  const rua = places.find('rua', plinth);
  assert.equal(rua.length, 8);
  for (let k = 1; k < rua.length; k++) assert.ok(rua[k].d >= rua[k - 1].d);
  assert.equal(places.find('', plinth).length, 0);
  // Only what's in the open world's area.
  for (const f of places.find('a', plinth, 200)) assert.ok(world.inOpen(f.x, f.z), `${f.name} out of the area`);
});

test('picking one sets the route to it', () => {
  for (const q of ['picoto', 'fujacal', 'joao xxi', 'parque da ponte', 'santa justa']) {
    const f = places.find(q, plinth)[0];
    assert.ok(f, `${q}: nothing`);
    const r = router.route({ ...plinth, yaw: 0 }, f, 'car');
    assert.ok(r, `${q}: no route to ${f.name}`);
    const end = r.pts[r.pts.length - 1];
    assert.ok(Math.hypot(end[0] - f.x, end[1] - f.z) < 80, `${q}: the route ends ${Math.round(Math.hypot(end[0] - f.x, end[1] - f.z))} m from ${f.name}`);
  }
});
