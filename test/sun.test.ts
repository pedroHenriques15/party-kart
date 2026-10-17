import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BRAGA, braga, inSummer, sunAt, sunDir } from '../src/sun.ts';

// Where the sun is over Braga (braga-map's task 022), for the light.
const RAD = Math.PI / 180;
const day = (y: number, m: number, d: number) => Array.from({ length: 1440 }, (_, k) => Date.UTC(y, m - 1, d, 0, k));
const highest = (y: number, m: number, d: number) => day(y, m, d).reduce((a, t) => (sunAt(t).el > sunAt(a).el ? t : a));

// The Astronomical Almanac's low-precision sun, a hundredth of a degree from 1950 to 2050: another way
// to the same place in the sky.
function almanac(t: number): { el: number; az: number } {
  const n = t / 86400000 + 2440587.5 - 2451545;
  const g = (357.528 + 0.9856003 * n) * RAD;
  const lambda = (280.46 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) * 15 * RAD;
  const h = gmst + BRAGA.lon * RAD - ra;
  const lat = BRAGA.lat * RAD;
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h));
  const az = Math.atan2(-Math.sin(h), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(h));
  return { el: el / RAD, az: ((az / RAD) % 360 + 360) % 360 };
}

test('sun: as high at noon as the latitude and the season say, and due south', () => {
  for (const [m, d, decl] of [[6, 21, 23.436], [12, 21, -23.436], [3, 20, 0]] as const) {
    const noon = sunAt(highest(2026, m, d));
    assert.ok(Math.abs(noon.el - (90 - BRAGA.lat + decl)) < 0.15, `${m}/${d}: ${noon.el.toFixed(2)}° up`);
    assert.ok(Math.abs(noon.az - 180) < 1, `${m}/${d}: at ${noon.az.toFixed(1)}°`);
  }
});

test('sun: where the Almanac puts it, all year round', () => {
  for (let k = 0; k < 400; k++) {
    const t = Date.UTC(2018, 0, 1) + k * 5.3 * 86400000 + (k % 17) * 3600000;
    const a = sunAt(t);
    const b = almanac(t);
    assert.ok(Math.abs(a.el - b.el) < 0.05, `${new Date(t).toISOString()}: ${a.el.toFixed(3)}° up, the Almanac ${b.el.toFixed(3)}°`);
    if (b.el > 1) assert.ok(Math.abs(((a.az - b.az + 540) % 360) - 180) < 0.1, `${new Date(t).toISOString()}: at ${a.az.toFixed(2)}°, the Almanac ${b.az.toFixed(2)}°`);
  }
});

test('sun: behind the camera on the Conselheiro Lobato, as its photo has it', () => {
  // The photo (Mapillary, 2019-03-13 15:09 UTC) looks along the street at 78.5°, and the buildings on its
  // left are lit, those on the right in shade: the sun was behind, to the right, in the south-west.
  const s = sunAt(Date.parse('2019-03-13T15:09:35Z'));
  assert.ok(s.az > 220 && s.az < 232, `at ${s.az.toFixed(1)}°`);
  assert.ok(s.el > 33 && s.el < 36, `${s.el.toFixed(1)}° up`);
});

test('sun: its direction in the game, x east, y up and z south', () => {
  const t = highest(2026, 6, 21);
  const d = sunDir(t);
  assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-9);
  assert.ok(Math.abs(d.x) < 0.02 && d.z > 0.2 && d.y > 0.9, `at noon: ${JSON.stringify(d)}`);
  const evening = sunDir(braga('2026-06-21T20:00')!);
  assert.ok(evening.x < -0.6 && evening.z < 0, `a summer evening, in the north-west: ${JSON.stringify(evening)}`);
});

test('sun: ?time= in Braga’s clock, an hour on in summer', () => {
  const iso = (s: string) => {
    const t = braga(s);
    return t === null ? null : new Date(t).toISOString();
  };
  assert.equal(iso('2026-10-13T17:30'), '2026-10-13T16:30:00.000Z');
  assert.equal(iso('2026-12-01T09:05'), '2026-12-01T09:05:00.000Z');
  assert.equal(iso('2026-07-04'), '2026-07-04T11:00:00.000Z');
  assert.equal(iso('2026-03-29T00:30'), '2026-03-29T00:30:00.000Z');
  assert.equal(iso('2026-03-29T02:30'), '2026-03-29T01:30:00.000Z');
  assert.equal(iso('2026-10-13T17:30Z'), '2026-10-13T17:30:00.000Z');
  assert.equal(iso('2026-10-13T17:30+02:00'), '2026-10-13T15:30:00.000Z');
  assert.equal(iso('tomorrow'), null);
  assert.equal(iso('2026-13-01T10:00'), null);
  // The clocks go forward at 01:00 UTC on the last Sunday of March, and back on October's.
  assert.equal(inSummer(Date.UTC(2026, 2, 29, 0, 59)), false);
  assert.equal(inSummer(Date.UTC(2026, 2, 29, 1, 0)), true);
  assert.equal(inSummer(Date.UTC(2026, 9, 25, 0, 59)), true);
  assert.equal(inSummer(Date.UTC(2026, 9, 25, 1, 0)), false);
});
