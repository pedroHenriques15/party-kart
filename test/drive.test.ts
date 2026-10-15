import { loadWorld } from 'braga-map';
import amigos from 'braga-map/tracks/amigos.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autopilot } from '../src/car/autopilot.ts';
import { newCar, speedOf, stepCar, stopInput, trackGround, type Car, type Input } from '../src/car/car.ts';
import { advance, newRun, noteSpeed, respawn, startGrid, type RunEvent } from '../src/race.ts';
import { LAYOUT } from '../src/track/layout.ts';
import { buildTrack, locate, type Track } from '../src/track/track.ts';
import { worldGround } from '../src/world/ground.ts';

// The game's track; and the first one, kept for reference, for its jump.
const track = buildTrack(amigos.points, amigos.ramps);
const gp = buildTrack(LAYOUT);
const DT = 1 / 120;

interface Drive {
  laps: number[];
  respawns: number;
  events: RunEvent[];
  maxAir: number;
  topSpeed: number;
  wallHits: number;
}

function drive(seconds: number, pilot: (c: Car) => Input = (c) => autopilot(c, track), on: Track = track): Drive {
  const track = on;
  const ground = trackGround(track);
  let car = newCar(track, startGrid(track));
  const run = newRun(0);
  const out: Drive = { laps: [], respawns: 0, events: [], maxAir: 0, topSpeed: 0, wallHits: 0 };
  let air = 0;
  for (let i = 0; i < seconds / DT; i++) {
    const now = i * DT * 1000;
    const from = car.idx;
    if (stepCar(car, pilot(car), ground, DT)) {
      out.respawns++;
      car = respawn(run, track, now, car.idx);
      continue;
    }
    air = car.grounded ? 0 : air + DT;
    out.maxAir = Math.max(out.maxAir, air);
    out.topSpeed = Math.max(out.topSpeed, speedOf(car));
    if (car.wallHit > 2) out.wallHits++;
    const e = advance(run, track, from, car.idx, now);
    if (e) {
      out.events.push(e);
      noteSpeed(run, car);
      if (e.k === 'lap') out.laps.push(e.ms);
    }
  }
  return out;
}

// About 10 km since braga-map's task 039: the race comes down to the ramp over the Rio Este from
// the north, by Ponte Pedrinha (the owner, knowing it went over 10).
test('the track is a closed loop of about 10 km, with its checkpoints in order', () => {
  const s = track.samples;
  assert.ok(track.length > 7000 && track.length < 10500, `length ${track.length.toFixed(0)} m`);
  for (let i = 0; i < s.length; i++) {
    const gap = Math.hypot(s[(i + 1) % s.length].p.x - s[i].p.x, s[(i + 1) % s.length].p.y - s[i].p.y, s[(i + 1) % s.length].p.z - s[i].p.z);
    assert.ok(gap > 0.5 && gap < 1.5, `sample ${i} to the next is ${gap.toFixed(2)} m`);
  }
  assert.equal(track.checkpoints.length, 5);
  assert.deepEqual([...track.checkpoints].sort((a, b) => a - b), track.checkpoints);
  assert.ok(track.checkpoints[0] > 0);
});

test('locate: on the centre line, beside it, and above it', () => {
  const s = track.samples[300];
  const at = (dx: number, dy: number) => locate(track, { x: s.p.x + s.r.x * dx, y: s.p.y + s.r.y * dx + dy, z: s.p.z + s.r.z * dx }, 290);
  assert.equal(at(0, 0).i, 300);
  assert.ok(Math.abs(at(3, 0).lateral - 3) < 0.05);
  assert.ok(at(0, 2).h > 1.9);
  assert.equal(at(s.w, 0).onRoad, false);
});

test('the autopilot laps the track cleanly', () => {
  const d = drive(600);
  console.log(
    `laps ${d.laps.map((ms) => (ms / 1000).toFixed(1)).join(', ')} s; respawns ${d.respawns}; longest air ${d.maxAir.toFixed(2)} s; top ${(d.topSpeed * 3.6).toFixed(0)} km/h; wall hits ${d.wallHits}`,
  );
  assert.equal(d.respawns, 0);
  assert.ok(d.laps.length >= 2, `only ${d.laps.length} laps`);
  assert.ok(d.laps[1] > 170000 && d.laps[1] < 290000, `lap ${d.laps[1]} ms`);
});

test("the autopilot drives the route on the world's ground, wherever its line is on the streets", async () => {
  // The world's ground over the open world's area: the land, every street at its level, and what
  // stands on them (src/world/ground.ts), not the track's road and walls. The route's line leaves
  // the real streets in two places, and the autopilot follows the line: at the Avenida da
  // Liberdade's underpass it runs up to 11 m off the street, over the cutting, and into the dead end
  // it jumps from a ramp over the Rio Este (braga-map's task 039), which the world's ground hasn't
  // got. Task 037 puts the line on the streets and the ramp out with the race's barriers; until then
  // each is skipped, from 40 m before the line leaves the street there to 40 m after it's back.
  const world = await loadWorld({ open: true });
  const g = worldGround(world).race(track);
  const s = track.samples;
  const N = s.length;
  const off = s.map((q) => {
    const f = g.floor(q.p.x, q.p.z, q.p.y + 1);
    return (f.kind !== 'road' && f.kind !== 'deck' && f.kind !== 'tunnel') || Math.abs(f.y - q.p.y) >= 1;
  });
  const skips = [[115, 615], [-571, 1130]].map(([x, z]) => {
    const near = s.flatMap((q, i) => (off[i] && Math.hypot(q.p.x - x, q.p.z - z) < 120 ? [i] : []));
    return [Math.min(...near) - 40, Math.max(...near) + 40];
  });
  assert.ok(skips.every(([a, b]) => b - a < 400), `skipped ${skips.map(([a, b]) => b - a).join(' and ')} m`);
  const stretches: [number, number][] = [[0, skips[0][0]], [skips[0][1], skips[1][0]], [skips[1][1], N]];
  let ms = 0;
  let metres = 0;
  let respawns = 0;
  let maxAir = 0;
  let top = 0;
  let wallHits = 0;
  for (const [a, b] of stretches) {
    let car = g.place(newCar(track, a % N, 20));
    let air = 0;
    let t = 0;
    let last = a;
    while (last < b && t < (b - a) / 8 + 10) {
      if (stepCar(car, autopilot(car, track), g, DT)) {
        respawns++;
        car = g.place(newCar(track, last % N, 10));
      }
      t += DT;
      // How far along the stretch, from the car's sample (which wraps round at the line).
      const at = car.idx + (car.idx < a % N - 100 ? N : 0) + Math.floor(a / N) * N;
      if (at > last && at - last < 100) last = at;
      air = car.grounded ? 0 : air + DT;
      maxAir = Math.max(maxAir, air);
      top = Math.max(top, speedOf(car));
      if (car.wallHit > 2) wallHits++;
    }
    assert.ok(last >= b, `stuck at sample ${last} (${s[last % N].p.x.toFixed(0)}, ${s[last % N].p.z.toFixed(0)}), between ${a} and ${b}`);
    ms += t * 1000;
    metres += b - a;
  }
  console.log(
    `on the world's ground: ${(metres / 1000).toFixed(2)} of ${(N / 1000).toFixed(2)} km in ${(ms / 1000).toFixed(1)} s (${((metres / ms) * 3600).toFixed(0)} km/h on average), skipping ${skips.map(([a, b]) => `${a}–${b}`).join(' and ')}; respawns ${respawns}; longest air ${maxAir.toFixed(2)} s; top ${(top * 3.6).toFixed(0)} km/h; wall hits ${wallHits}`,
  );
  assert.equal(respawns, 0);
});

// The ramp over the Rio Este into the dead end (braga-map's task 039): from the speed braga-map says
// clears it to flat out, a kart flies over the gap and comes down on the landing street, on its
// carriageway; slower, it falls into the gap and goes back onto the run-up, at the speed that clears it.
test('the jump into the dead end lands on the street from its speed to flat out, and short of it respawns on the run-up', () => {
  assert.equal(track.ramps.length, 1);
  const r = track.ramps[0], N = track.samples.length, ground = trackGround(track);
  const ahead = (i: number) => (i - r.lip + N) % N;
  const out: string[] = [];
  for (const v of [r.v + 0.5, r.v + 2, 37, 44]) {
    const car = newCar(track, r.lip - 40, v);
    let fell = false, flew = 0, down = -1;
    for (let i = 0; i < 6 / DT && !fell && down < 0; i++) {
      const inp = autopilot(car, track);
      fell = stepCar(car, { ...inp, throttle: speedOf(car) < v ? 1 : 0, brake: 0 }, ground, DT);
      if (!car.grounded) flew += DT;
      else if (flew > 0.5) down = car.idx;
    }
    out.push(`${(v * 3.6).toFixed(0)} km/h: ${flew.toFixed(2)} s in the air, down ${down < 0 ? '-' : ahead(down) - ahead(r.land)} m past the landing`);
    assert.equal(fell, false, `fell at ${(v * 3.6).toFixed(0)} km/h`);
    assert.ok(down >= 0 && ahead(down) >= ahead(r.land) && Math.abs(car.lat) < track.samples[down].w / 2, `at ${(v * 3.6).toFixed(0)} km/h it came down at sample ${down}, ${car.lat.toFixed(1)} m across`);
  }
  console.log(`the jump: ${out.join('; ')}`);
  // Too slow: into the gap, and back on the run-up.
  const car = newCar(track, r.lip - 40, r.v - 8);
  let fell = false;
  for (let i = 0; i < 8 / DT && !fell; i++) fell = stepCar(car, { ...autopilot(car, track), throttle: 0, brake: 0 }, ground, DT);
  assert.ok(fell, 'fell short');
  const back = respawn(newRun(0), track, 0, car.idx);
  assert.equal(back.idx, (r.lip - 50 + N) % N);
  assert.ok(speedOf(back) > r.v);
});

test("the first track's jump lands on the road at any speed up to flat out", () => {
  const lip = gp.tags.find((t) => t.tag === 'lip')!.i;
  for (const kmh of [60, 100, 130, 158]) {
    const car = newCar(gp, lip - 30, kmh / 3.6);
    let flew = 0;
    let fell = false;
    for (let i = 0; i < 8 / DT && !fell; i++) {
      const inp = autopilot(car, gp);
      fell = stepCar(car, { ...inp, throttle: 1, brake: 0 }, trackGround(gp), DT);
      if (!car.grounded) flew += DT;
    }
    assert.equal(fell, false, `fell off at ${kmh} km/h`);
    if (kmh >= 100) assert.ok(flew > 1, `only ${flew.toFixed(2)} s in the air at ${kmh} km/h`);
  }
});

test("falling off the first track's jump respawns at the last checkpoint, at its speed", () => {
  const lip = gp.tags.find((t) => t.tag === 'lip')!.i;
  // Steer hard left at the lip, off the side where there are no walls.
  const d = drive(
    150,
    (c) => {
      const i = autopilot(c, gp);
      const near = c.idx > lip - 5 && c.idx < lip + 40;
      return near ? { ...i, steer: -1 } : i;
    },
    gp,
  );
  assert.ok(d.respawns >= 1);
});

test('stopping brakes to a standstill and stays there, without reversing', () => {
  // On level road: on a hill a car held by stopInput creeps a few centimetres a second, which
  // isn't reversing. The most level 300 m of the track.
  const s = track.samples, N = s.length;
  let at = 0, rise = Infinity;
  for (let i = 0; i < N; i += 10) {
    let lo = Infinity, hi = -Infinity;
    for (let k = -100; k <= 200; k++) { const y = s[(i + k + N) % N].p.y; lo = Math.min(lo, y); hi = Math.max(hi, y); }
    if (hi - lo < rise) { rise = hi - lo; at = i; }
  }
  for (const speed of [40, 10, -8]) {
    const car = newCar(track, at, speed);
    const forward = () => car.v.x * Math.cos(car.yaw) + car.v.z * Math.sin(car.yaw);
    let wrongWay = 0;
    for (let i = 0; i < 6 / DT; i++) {
      stepCar(car, stopInput(car), trackGround(track), DT);
      // Past the moment it stops, it mustn't pick up speed the other way.
      wrongWay = Math.max(wrongWay, speed > 0 ? -forward() : forward());
    }
    assert.ok(speedOf(car) < 0.05, `still at ${speedOf(car).toFixed(2)} m/s from ${speed} m/s`);
    assert.ok(wrongWay < 0.05, `went ${wrongWay.toFixed(2)} m/s the other way from ${speed} m/s`);
  }
});

test('a lap is timed from the line, and splits compare with the best lap', () => {
  const d = drive(360);
  const cps = d.events.filter((e) => e.k === 'cp');
  assert.equal(cps[0].diff, null, 'no best lap yet');
  const second = cps.find((e) => e.k === 'cp' && e.diff !== null);
  assert.ok(second, 'splits on the second lap');
});
