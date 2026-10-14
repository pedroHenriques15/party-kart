import amigosPlan from 'braga-map/tracks/amigos.js';
import { loadWorld } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ambienceOf, surroundAt } from '../src/ambience.ts';
import { buildTrack } from '../src/track/track.ts';

// The city's sound follows what's round the track. These are the places braga-map's task 025 judges
// it at, found on the track by the streets and landmarks it passes.
const track = buildTrack(amigosPlan.points);
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

test('the city round the track: busy on the Avenida da Liberdade, quiet and green at the Picoto, the river by São João da Ponte', async () => {
  const a = ambienceOf(track, await loadWorld(amigosPlan.box), amigosPlan);
  for (const s of a.at) for (const v of Object.values(s)) assert.ok(v >= 0 && v <= 1, `${v} out of 0..1`);
  const liberdade = surroundAt(a, street('Avenida da Liberdade'));
  const p = landmark('Picoto Adventure Park');
  const picoto = surroundAt(a, sampleNear(p.x, p.z));
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
