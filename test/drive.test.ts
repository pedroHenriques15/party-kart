import { loadWorld } from 'braga-map';
import amigos from 'braga-map/tracks/amigos.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autopilot } from '../src/car/autopilot.ts';
import { COYOTE, newCar, speedOf, stepCar, stopInput, trackGround, type Car, type Ground, type Input } from '../src/car/car.ts';
import { advance, newRun, noteSpeed, respawn, startGrid, type RunEvent } from '../src/race.ts';
import { LAYOUT } from '../src/track/layout.ts';
import { buildTrack, locate, type Track } from '../src/track/track.ts';
import { Rings, worldGround } from '../src/world/ground.ts';
import { clearedPieces, raceGround, reachable } from '../src/world/race.ts';

// The game's track; and the first one, kept for reference, for its jump.
const track = buildTrack(amigos.points, amigos.ramps);
const gp = buildTrack(LAYOUT);
const DT = 1 / 120;
// The race as the game runs it (braga-map's task 037): on the world's ground, its road the route's own
// streets at their real widths, walled at its edges and barred across the side streets.
const world = await loadWorld({ open: true });
const roam = worldGround(world);
const { ground: race, rows } = raceGround(roam, track, amigos);
const road = new Rings(amigos.road.flat());

interface Drive {
  laps: number[];
  respawns: number;
  events: RunEvent[];
  maxAir: number;
  topSpeed: number;
  wallHits: number;
}

function drive(seconds: number, pilot: (c: Car) => Input = (c) => autopilot(c, track), on: Track = track, ground: Ground = on === track ? race : trackGround(on)): Drive {
  const track = on;
  const put = (c: Car) => ground.place?.(c) ?? c;
  let car = put(newCar(track, startGrid(track)));
  const run = newRun(0);
  const out: Drive = { laps: [], respawns: 0, events: [], maxAir: 0, topSpeed: 0, wallHits: 0 };
  let air = 0;
  for (let i = 0; i < seconds / DT; i++) {
    const now = i * DT * 1000;
    const from = car.idx;
    if (stepCar(car, pilot(car), ground, DT)) {
      out.respawns++;
      car = put(respawn(run, track, now, car.idx));
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

test("the autopilot laps the race cleanly, on the world's ground within its walls", () => {
  // Long enough for two laps of up to 310 s from the standing start (braga-map's task 026 made the
  // loop 10.25 km, the two laps 604 s).
  const d = drive(640);
  console.log(
    `laps ${d.laps.map((ms) => (ms / 1000).toFixed(1)).join(', ')} s; respawns ${d.respawns}; longest air ${d.maxAir.toFixed(2)} s; top ${(d.topSpeed * 3.6).toFixed(0)} km/h; wall hits ${d.wallHits}`,
  );
  assert.equal(d.respawns, 0);
  assert.ok(d.laps.length >= 2, `only ${d.laps.length} laps`);
  // 170–310 s since braga-map's task 037 put the race on the streets at their real widths (the owner,
  // knowing it went over 290: 296.7 s, the line round each street's own bends and its tighter corners).
  assert.ok(d.laps[1] > 170000 && d.laps[1] < 310000, `lap ${d.laps[1]} ms`);
});

// The ramp over the Rio Este into the dead end (braga-map's task 039), on the world's ground: from the
// speed braga-map says clears it to flat out, a kart flies over the gap and comes down on the race's
// road: on the landing street, or flat out past that 4 m street on the ground beside it, which the
// race's road takes in so it drives back on (the owner's answer in task 037); slower, it falls into
// the gap and goes back onto the run-up, at the speed that clears it.
test("the jump into the dead end lands on the race's road from its speed to flat out, and short of it respawns on the run-up", () => {
  assert.equal(track.ramps.length, 1);
  const r = track.ramps[0], N = track.samples.length;
  const ahead = (i: number) => (i - r.lip + N) % N;
  const out: string[] = [];
  const fly = (v: number, throttle: boolean) => {
    const car = race.place!(newCar(track, r.lip - 40, v));
    let fell = false, flew = 0, down = -1, after = 0;
    for (let i = 0; i < 8 / DT && !fell && after < 1.5; i++) {
      const inp = autopilot(car, track);
      fell = stepCar(car, { ...inp, throttle: throttle && speedOf(car) < v ? 1 : 0, brake: 0 }, race, DT);
      if (!car.grounded && down < 0) flew += DT;
      else if (flew > 0.5 && down < 0) down = car.idx;
      if (down >= 0) after += DT;
    }
    return { car, fell, flew, down };
  };
  for (const v of [r.v + 0.5, r.v + 2, 37, 40, 44]) {
    const { car, fell, flew, down } = fly(v, true);
    out.push(`${(v * 3.6).toFixed(0)} km/h: ${flew.toFixed(2)} s in the air, down ${down < 0 ? '-' : ahead(down) - ahead(r.land)} m past the landing`);
    assert.equal(fell, false, `fell at ${(v * 3.6).toFixed(0)} km/h`);
    assert.ok(down >= 0 && ahead(down) >= ahead(r.land) - 2 && road.has(car.p.x, car.p.z), `at ${(v * 3.6).toFixed(0)} km/h it came down at sample ${down}, ${car.lat.toFixed(1)} m across`);
  }
  console.log(`the jump: ${out.join('; ')}`);
  // Too slow: into the gap, and back on the run-up.
  const { car, fell } = fly(r.v - 8, false);
  assert.ok(fell, `too slow, it's still in the race at sample ${car.idx}`);
  const back = race.place!(respawn(newRun(0), track, 0, car.idx));
  assert.equal(back.idx, (r.lip - 50 + N) % N);
  assert.ok(speedOf(back) > r.v);
});

// The autopilot flies the jump's flight (braga-map's task 060): from 200 m before the lip, on either side
// of the road or its middle, flat out or careful, its velocity leaves the lip within 1° of the flight
// (once the grip has let it go), comes down within 1 m of the flight's line, a little short of the
// landing street, and turns into the street without touching a wall.
test("the autopilot flies the jump's flight from any line, and turns into the landing street clean", () => {
  const r = track.ramps[0], N = track.samples.length;
  const [lx, , lz] = amigos.ramps[0].lip, [ex, , ez] = amigos.ramps[0].land;
  const L = Math.hypot(ex - lx, ez - lz), ux = (ex - lx) / L, uz = (ez - lz) / L;
  const out: string[] = [];
  for (const caution of [1, 1.27]) {
    for (const line of [-0.5, 0, 0.5]) {
      const car = race.place!(newCar(track, (r.lip - 200 + N) % N, 25));
      let off = NaN, across = NaN, on = NaN, flown = 0, after = 0, hits = 0;
      for (let i = 0; i < 12 / DT && after < 3; i++) {
        assert.equal(stepCar(car, autopilot(car, track, caution, line), race, DT), false, `fell at line ${line}, caution ${caution}`);
        if (!car.grounded && car.air >= COYOTE && isNaN(off)) off = (Math.atan2(car.v.z, car.v.x) - Math.atan2(uz, ux)) * (180 / Math.PI);
        if (!isNaN(off) && !car.grounded) flown += DT;
        if (flown > 0.5 && car.grounded && isNaN(across)) {
          across = (car.p.x - lx) * -uz + (car.p.z - lz) * ux;
          on = (car.p.x - lx) * ux + (car.p.z - lz) * uz - L;
        }
        if (!isNaN(across)) after += DT;
        if (!isNaN(across) && car.wallHit > 2) hits++;
      }
      out.push(`${line}/${caution}: ${off.toFixed(2)}°, ${across.toFixed(2)} m across, ${on.toFixed(1)} m on`);
      assert.ok(Math.abs(off) < 1, `line ${line}, caution ${caution}: off the flight by ${off.toFixed(2)}°`);
      assert.ok(Math.abs(across) < 1, `line ${line}, caution ${caution}: down ${across.toFixed(2)} m off the flight's line`);
      assert.equal(hits, 0, `line ${line}, caution ${caution}: ${hits} wall hits after the landing`);
    }
  }
  console.log(`off the lip (line/caution: off the flight, where it came down): ${out.join('; ')}`);
});

// Round the jump's landing the race takes in the corner between the flight and the landing street, a
// walled lot's, and takes the lot's walls there down while it runs (braga-map's task 057, `cleared`):
// about 32 m of them and a gate. Round the city they stand, and no building's taken down.
test("the race takes the lot's walls down at the landing, and round the city they stand", () => {
  const down = [...race.down];
  assert.equal(roam.down.size, 0);
  assert.ok(down.length > 5, `${down.length} pieces of wall down`);
  assert.ok(down.every((w) => w.kind && roam.d.walls.near(w.ax, w.az, w.ax, w.az, []).includes(w)), "only the map's walls, which free roam keeps");
  // The pieces the city draws apart, to hide in a race: as long as braga-map says.
  const pieces = clearedPieces(world.walls, amigos.cleared).filter((q) => q.down);
  const length = pieces.reduce((s, q) => s + q.w.pts.reduce((t, p, k) => (k ? t + Math.hypot(p[0] - q.w.pts[k - 1][0], p[1] - q.w.pts[k - 1][1]) : 0), 0), 0);
  console.log(`down in a race: ${down.length} pieces of wall, ${pieces.length} drawn apart, ${length.toFixed(1)} m`);
  assert.ok(length > 25 && length < 40, `${length.toFixed(1)} m of wall down`);
});

// The race is closed (decision 019): from its line, a kart going anywhere a metre at a time, up no
// more than a kerb and never through a wall, gets nowhere off the race's road nor down off the route,
// but where it falls under the jump.
test("the race is closed: from its line, nowhere off its road and nothing under the route", () => {
  const r = reachable(race, track, amigos.road);
  console.log(`the race's road: ${r.cells} m² a kart can reach, ${rows.length} rows of barriers`);
  assert.ok(r.cells > 50000, `only ${r.cells} m² reached`);
  assert.deepEqual(r.out.map(([x, y, z]) => [Math.round(x), Math.round(y), Math.round(z)]), []);
});

// Every row of barriers across a side street holds: a kart driven straight at its middle flat out,
// from 6 m inside the race's road, or 4 (where there's room for it), stays on the road and in the race.
test('the barriers across the side streets stop a kart driven straight at them', () => {
  let tried = 0;
  const through: string[] = [];
  for (const row of amigos.closures) {
    const k = row.length >> 1, [ax, , az] = row[Math.max(0, k - 1)], [bx, , bz] = row[Math.min(row.length - 1, k)];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.3) continue;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let nx = -(bz - az) / L, nz = (bx - ax) / L;
    if (road.has(mx + nx, mz + nz)) [nx, nz] = [-nx, -nz];
    // From 6 m in, or 4, where there's room for a kart all round it.
    const room = (x: number, z: number) => [0, 1, 2, 3, 4, 5, 6, 7].every((q) => road.has(x + 1.8 * Math.cos((q * Math.PI) / 4), z + 1.8 * Math.sin((q * Math.PI) / 4)));
    const back = [6, 4].find((d) => room(mx - nx * d, mz - nz * d));
    if (!back || !road.has(mx - nx * 2, mz - nz * 2)) continue;
    const sx = mx - nx * back, sz = mz - nz * back, i = locate(track, { x: sx, y: 0, z: sz }, null).i;
    if (track.samples[i].air) continue;
    tried++;
    const car = race.place!({ ...newCar(track, i, 0), p: { x: sx, y: track.samples[i].p.y + 1, z: sz }, yaw: Math.atan2(nz, nx) });
    car.v = { x: nx * 30, y: 0, z: nz * 30 };
    let fell = false;
    for (let s = 0; s < 1.5 / DT && !fell; s++) fell = stepCar(car, { throttle: 1, brake: 0, steer: 0, drift: false }, race, DT);
    if (fell || !road.has(car.p.x, car.p.z)) through.push(`(${mx.toFixed(0)}, ${mz.toFixed(0)})`);
  }
  console.log(`barriers: ${tried} rows driven at, ${through.length} gone through`);
  assert.ok(tried > 80, `only ${tried} rows tried`);
  assert.deepEqual(through, []);
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
