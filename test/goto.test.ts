import { loadWorld, type World } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kartTo, mayGo } from '../src/world/goto.ts';
import { worldGround } from '../src/world/ground.ts';

// "Ir para aqui" (braga-map's task 108): where a place picked on the full map puts your kart, and
// when the map offers it.
const world: World = await loadWorld({ open: true });
const ground = worldGround(world);

test('a place anywhere in the open world: your kart on the nearest street, at the ground, facing along it', () => {
  // Every 400 m across the area, and under the Avenida Robert Smith's deck.
  const [xs, zs] = [world.open.pts.map(([x]) => x), world.open.pts.map(([, z]) => z)];
  const spots: [number, number][] = [[1535, 1070]];
  for (let x = Math.min(...xs); x < Math.max(...xs); x += 400) for (let z = Math.min(...zs); z < Math.max(...zs); z += 400) if (world.inOpen(x, z)) spots.push([x, z]);
  assert.ok(spots.length > 15, `${spots.length} places`);
  const bad: string[] = [];
  for (const [x, z] of spots) {
    const c = kartTo(ground, x, z, 0)!;
    const at = `(${x}, ${z})`;
    const f = ground.floor(c.p.x, c.p.z, c.p.y);
    if (f.kind !== 'road') bad.push(`${at}: on ${f.kind}`);
    if (!world.inOpen(c.p.x, c.p.z)) bad.push(`${at}: out of the area`);
    if (Math.hypot(c.p.x - x, c.p.z - z) > 200) bad.push(`${at}: ${Math.round(Math.hypot(c.p.x - x, c.p.z - z))} m off`);
    if (Math.abs(c.p.y - ground.groundAt(c.p.x, c.p.z)) > 0.5) bad.push(`${at}: not at the ground's level`);
    // Facing along the street: it goes on 2.5 m ahead and behind.
    for (const d of [2.5, -2.5]) {
      const k = ground.floor(c.p.x + Math.cos(c.yaw) * d, c.p.z + Math.sin(c.yaw) * d, c.p.y + 0.5).kind;
      if (k !== 'road') bad.push(`${at}: ${d > 0 ? 'ahead' : 'behind'} is ${k}`);
    }
  }
  console.log(`  ${spots.length} places, ${bad.length} not as wanted${bad.length ? `: ${bad.join('; ')}` : ''}`);
  assert.ok(bad.length <= spots.length / 10, bad.join('; '));
  // Under the deck: on the street on the ground, not on the deck.
  const under = kartTo(ground, 1535, 1070)!;
  assert.equal(ground.floor(under.p.x, under.p.z, under.p.y).kind, 'road');
  // Out of the area: nowhere.
  assert.equal(kartTo(ground, -1550, -700), null);
});

test("it's offered round the city only: never in a race or a round, nor while one is starting", () => {
  assert.equal(mayGo('roam', false), true);
  assert.equal(mayGo('roam', true), false);
  assert.equal(mayGo('race', false), false);
  assert.equal(mayGo('round', false), false);
  assert.equal(mayGo(null, false), false);
});
