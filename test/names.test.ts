import amigosPlan from 'braga-map/tracks/amigos.js';
import { loadWorld } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { streetNames } from '../src/world/names.ts';

// The streets' names round the city (braga-map's task 042): the HUD names the street you drive onto
// from the map's lines, anywhere in the area, not only where the route turns.
const world = await loadWorld({ open: true });
const namesAt = streetNames(world.lines);

test("each street the route turns into is named where it turns in, on the map's lines", () => {
  const missed = amigosPlan.streets.filter((s) => !namesAt(s.x, s.z).includes(s.name));
  assert.ok(missed.length <= amigosPlan.streets.length / 10, `not named where the route turns in: ${missed.map((s) => s.name).join(', ')}`);
});

test('every plate names a street whose line runs past it, and every stop in the area is on the map', () => {
  const far = world.plates.filter((p) => {
    for (let r = 0; r <= 25; r += 1) for (let a = 0; a < 16; a++) if (namesAt(p.x + r * Math.cos((a * Math.PI) / 8), p.z + r * Math.sin((a * Math.PI) / 8)).includes(p.name)) return false;
    return true;
  });
  assert.ok(world.plates.length > 500, `${world.plates.length} plates`);
  assert.ok(far.length === 0, `plates 25 m or more from their street: ${far.slice(0, 5).map((p) => `${p.name} (${Math.round(p.x)}, ${Math.round(p.z)})`).join(', ')}`);
  const stops = world.stops.filter((s) => world.inOpen(s.x, s.z));
  assert.ok(stops.length > amigosPlan.stops.length, `${stops.length} bus stops in the area, the route's ${amigosPlan.stops.length}`);
});
