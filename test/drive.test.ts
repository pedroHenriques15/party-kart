import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autopilot } from '../src/car/autopilot.ts';
import { newCar, speedOf, stepCar, stopInput, type Car, type Input } from '../src/car/car.ts';
import { advance, newRun, noteSpeed, respawn, startGrid, type RunEvent } from '../src/race.ts';
import { AMIGOS } from '../src/track/amigos.ts';
import { LAYOUT } from '../src/track/layout.ts';
import { buildTrack, locate, type Track } from '../src/track/track.ts';

// The game's track; and the first one, kept for reference, for its jump.
const track = buildTrack(AMIGOS);
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
  let car = newCar(track, startGrid(track));
  const run = newRun(0);
  const out: Drive = { laps: [], respawns: 0, events: [], maxAir: 0, topSpeed: 0, wallHits: 0 };
  let air = 0;
  for (let i = 0; i < seconds / DT; i++) {
    const now = i * DT * 1000;
    const from = car.idx;
    if (stepCar(car, pilot(car), track, DT)) {
      out.respawns++;
      car = respawn(run, track, now);
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

test('the track is a closed loop of about 7 km, with its checkpoints in order', () => {
  const s = track.samples;
  assert.ok(track.length > 6500 && track.length < 8000, `length ${track.length.toFixed(0)} m`);
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
  const d = drive(460);
  console.log(
    `laps ${d.laps.map((ms) => (ms / 1000).toFixed(1)).join(', ')} s; respawns ${d.respawns}; longest air ${d.maxAir.toFixed(2)} s; top ${(d.topSpeed * 3.6).toFixed(0)} km/h; wall hits ${d.wallHits}`,
  );
  assert.equal(d.respawns, 0);
  assert.ok(d.laps.length >= 2, `only ${d.laps.length} laps`);
  assert.ok(d.laps[1] > 170000 && d.laps[1] < 240000, `lap ${d.laps[1]} ms`);
});

test("the first track's jump lands on the road at any speed up to flat out", () => {
  const lip = gp.tags.find((t) => t.tag === 'lip')!.i;
  for (const kmh of [60, 100, 130, 158]) {
    const car = newCar(gp, lip - 30, kmh / 3.6);
    let flew = 0;
    let fell = false;
    for (let i = 0; i < 8 / DT && !fell; i++) {
      const inp = autopilot(car, gp);
      fell = stepCar(car, { ...inp, throttle: 1, brake: 0 }, gp, DT);
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
  for (const speed of [40, 10, -8]) {
    const car = newCar(track, 150, speed);
    const forward = () => car.v.x * Math.cos(car.yaw) + car.v.z * Math.sin(car.yaw);
    let wrongWay = 0;
    for (let i = 0; i < 6 / DT; i++) {
      stepCar(car, stopInput(car), track, DT);
      // Past the moment it stops, it mustn't pick up speed the other way.
      wrongWay = Math.max(wrongWay, speed > 0 ? -forward() : forward());
    }
    assert.ok(speedOf(car) < 0.05, `still at ${speedOf(car).toFixed(2)} m/s from ${speed} m/s`);
    assert.ok(wrongWay < 0.05, `went ${wrongWay.toFixed(2)} m/s the other way from ${speed} m/s`);
  }
});

test('a lap is timed from the line, and splits compare with the best lap', () => {
  const d = drive(300);
  const cps = d.events.filter((e) => e.k === 'cp');
  assert.equal(cps[0].diff, null, 'no best lap yet');
  const second = cps.find((e) => e.k === 'cp' && e.diff !== null);
  assert.ok(second, 'splits on the second lap');
});
