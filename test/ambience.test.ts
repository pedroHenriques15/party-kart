import amigosPlan from 'braga-map/tracks/amigos.js';
import { loadWorld } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ambienceOf, surroundAt } from '../src/ambience.ts';
import { buildTrack } from '../src/track/track.ts';

// The city's sound follows what's round your kart, anywhere in the city. These are the places
// braga-map's task 025 judges it at, found on the track by the streets and landmarks it passes.
const track = buildTrack(amigosPlan.points, amigosPlan.ramps);
const sampleNear = (x: number, z: number) => {
  let best = 0;
  track.samples.forEach((s, i) => {
    if (Math.hypot(s.p.x - x, s.p.z - z) < Math.hypot(track.samples[best].p.x - x, track.samples[best].p.z - z)) best = i;
  });
  return best;
};
const street = (name: string) => {
  const s = amigosPlan.streets.find((x) => x.name === name)!;
  return sampleNear(s.x, s.z);
};
const landmark = (name: string) => amigosPlan.landmarks.find((x) => x.name === name)!;

const world = await loadWorld(amigosPlan.box);
const at = (i: number) => track.samples[i].p;

test('the city round the track: busy on the Avenida da Liberdade, quiet and green at the Picoto, the river by São João da Ponte', () => {
  const a = ambienceOf(world, amigosPlan);
  const l = at(street('Avenida da Liberdade'));
  const liberdade = surroundAt(a, l.x, l.z);
  const p = landmark('Picoto Adventure Park');
  const q = at(sampleNear(p.x, p.z));
  const picoto = surroundAt(a, q.x, q.z);
  assert.ok(liberdade.traffic > 0.7, `the Avenida's traffic ${liberdade.traffic}`);
  assert.ok(liberdade.town > 0.6, `the Avenida's town ${liberdade.town}`);
  assert.ok(picoto.traffic < 0.35, `the Picoto's traffic ${picoto.traffic}`);
  assert.ok(picoto.park + picoto.woods > picoto.town, `the Picoto: park ${picoto.park}, woods ${picoto.woods}, town ${picoto.town}`);
  const ponte = track.samples[street('Largo São João da Ponte')].p;
  const river = Math.min(...a.water.map((w) => Math.hypot(w.x - ponte.x, w.z - ponte.z)));
  assert.ok(river < 50, `the river ${river} m from São João da Ponte`);
  assert.ok(a.churches.length >= 100, `${a.churches.length} churches`);
  assert.equal(a.stops.length, amigosPlan.stops.length);
  const e = landmark('Estádio 1.º de Maio');
  assert.ok(a.stadium && Math.hypot(a.stadium.x - e.x, a.stadium.z - e.z) < 50, 'the stadium where the Estádio 1.º de Maio is');
  console.log(`  the Avenida: traffic ${liberdade.traffic.toFixed(2)}, town ${liberdade.town.toFixed(2)}; the Picoto: traffic ${picoto.traffic.toFixed(2)}, park ${picoto.park.toFixed(2)}, woods ${picoto.woods.toFixed(2)}; the river ${Math.round(river)} m from São João da Ponte`);
});

// Free roam (braga-map's decision 019): the sound follows the kart off the route too, so it has to
// be worked out anywhere in the area, and quickly enough to do as you drive.
test('the city round any point of the area, off the route as on it', () => {
  const a = ambienceOf(world, amigosPlan);
  const pts = world.open.pts;
  const inArea = (x: number, z: number) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if (pts[i][1] > z !== pts[j][1] > z && x < ((pts[j][0] - pts[i][0]) * (z - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) c = !c;
    }
    return c;
  };
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const off: { x: number; z: number; s: ReturnType<typeof surroundAt> }[] = [];
  const t0 = performance.now();
  for (let x = Math.min(...xs); x < Math.max(...xs); x += 100) {
    for (let z = Math.min(...zs); z < Math.max(...zs); z += 100) {
      if (!inArea(x, z)) continue;
      // Off the route: more than 60 m from the track.
      if (track.samples.some((s, i) => i % 5 === 0 && Math.hypot(s.p.x - x, s.p.z - z) < 60)) continue;
      off.push({ x, z, s: surroundAt(a, x + 3, z + 7) });
    }
  }
  const ms = (performance.now() - t0) / (off.length * 4);
  for (const { s } of off) for (const v of Object.values(s)) assert.ok(v >= 0 && v <= 1, `${v} out of 0..1`);
  assert.ok(off.length >= 50, `${off.length} points off the route`);
  const spread = (k: 'traffic' | 'town' | 'park' | 'woods') => Math.max(...off.map((o) => o.s[k])) - Math.min(...off.map((o) => o.s[k]));
  for (const k of ['traffic', 'town', 'park', 'woods'] as const) assert.ok(spread(k) > 0.3, `${k} changes by only ${spread(k).toFixed(2)} across the area`);
  assert.ok(ms < 2, `${ms.toFixed(2)} ms a point of the grid`);
  console.log(`  ${off.length} points off the route: traffic ${spread('traffic').toFixed(2)}, town ${spread('town').toFixed(2)}, park ${spread('park').toFixed(2)}, woods ${spread('woods').toFixed(2)} from the quietest to the busiest; ${ms.toFixed(2)} ms a point of the grid`);
});
