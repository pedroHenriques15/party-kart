import { loadWorld } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carAt, speedOf, stepCar, type Car, type Input } from '../src/car/car.ts';
import type { CarInfo } from '../src/game/arena.ts';
import { bump, type Note } from '../src/game/racer.ts';
import { Roamer } from '../src/game/roamer.ts';
import { v3 } from '../src/math.ts';
import { CAR_L, CAR_R, KART, worldGround } from '../src/world/ground.ts';

// Free roam (braga-map's decision 019): a car this browser drives anywhere in the open world's area,
// on the world's ground, from the map's real tiles.
const world = await loadWorld({ open: true });
const ground = worldGround(world);
const DT = 1 / 120;
const ahead: Input = { throttle: 1, brake: 0, steer: 0, drift: false };
const still: Input = { throttle: 0, brake: 0, steer: 0, drift: false };

// The Rua do Fujacal, one way, from (176, 832) towards the Alameda do Fujacal's junction at
// (162, 791).
const UP = Math.atan2(791 - 832, 162 - 176);

// A block like the plinth at the start (city.ts), 6 m square and 1.2 m high, on the Rua do
// Fujacal's carriageway at (172, 820), its sides along the axes: on a ground of its own.
const plinthed = worldGround(world);
const B = { x: 172, z: 820 };
const corners: [number, number][] = [
  [B.x - 3, B.z - 3],
  [B.x + 3, B.z - 3],
  [B.x + 3, B.z + 3],
  [B.x - 3, B.z + 3],
];
const top = Math.max(...corners.map(([x, z]) => plinthed.land(x, z))) + 1.2;
plinthed.stand(corners, top);

test('the plinth: a car stands on its top, drives off its edge onto the street, and from the street meets its side', () => {
  // On the top, it stays there.
  const c = plinthed.place(carAt(v3(B.x, top, B.z), UP, v3(0, 1, 0)), top + 0.5);
  assert.equal(plinthed.floor(c.p.x, c.p.z, c.p.y).kind, 'block');
  for (let i = 0; i < 120; i++) assert.equal(stepCar(c, still, plinthed, DT), false);
  assert.ok(c.grounded && Math.abs(c.p.y - top) < 0.06, `${(c.p.y - top).toFixed(2)} m off the top`);
  // Off its edge, down onto the road below, and on along the street.
  let flew = false;
  let landed = 0;
  for (let i = 0; i < 240; i++) {
    assert.equal(stepCar(c, ahead, plinthed, DT), false, 'lost');
    if (!c.grounded) flew = true;
    landed = Math.max(landed, c.landed);
  }
  assert.ok(flew, 'never left the top');
  assert.ok(Math.hypot(c.p.x - B.x, c.p.z - B.z) > 10, 'still on the block');
  assert.equal(plinthed.floor(c.p.x, c.p.z, c.p.y).kind, 'road');
  assert.ok(c.grounded && landed > 1, `came down ${landed.toFixed(1)} m/s`);
  // From the street below, into its side: stopped there, never up on it.
  const d = plinthed.place(carAt(v3(B.x - 14 * Math.cos(UP), 0, B.z - 14 * Math.sin(UP)), UP, v3(0, 1, 0)), plinthed.land(B.x, B.z) + 1);
  d.v = v3(Math.cos(UP) * 10, 0, Math.sin(UP) * 10);
  let hit = 0;
  for (let i = 0; i < 240; i++) {
    stepCar(d, ahead, plinthed, DT);
    hit += d.wallHit;
    assert.ok(d.p.y < top - 0.5, 'up on the block');
  }
  assert.ok(hit > 3, `lost ${hit.toFixed(1)} m/s against its side`);
});

test('a building the game leaves out, round the plinth or an egg, is no wall either', () => {
  // A block of flats' front on the Alameda do Fujacal, from (129.5, 812.5) to (141, 809): taken
  // away, a car driven at it goes in where it stood.
  const b = world.buildings.find((b) => b.pts.some(([x, z]) => x === 129.5 && z === 812.5) && b.pts.some(([x, z]) => x === 141 && z === 809))!;
  // It's the tower in the Topo do Fujacal (braga-map's task 079): its room goes with it, as the city
  // takes it away (render/city.ts), and with it the walls that were its outline's.
  assert.ok(plinthed.unroom(b.pts), 'a room');
  assert.equal(plinthed.unwall(b.pts), 0);
  const [mx, mz] = [(129.5 + 141) / 2, (812.5 + 809) / 2];
  const yaw = Math.atan2(809 - 141, 129.5 - 141) - Math.PI / 2; // into it, from the street
  const c = plinthed.place(carAt(v3(mx - Math.cos(yaw) * 9, plinthed.land(mx, mz) + 1, mz - Math.sin(yaw) * 9), yaw, v3(0, 1, 0)));
  c.v = v3(Math.cos(yaw) * 8, 0, Math.sin(yaw) * 8);
  let went = 0;
  for (let i = 0; i < 240; i++) {
    stepCar(c, ahead, plinthed, DT);
    went = Math.max(went, (c.p.x - mx) * Math.cos(yaw) + (c.p.z - mz) * Math.sin(yaw));
  }
  assert.ok(went > 3, `stopped ${(-went).toFixed(1)} m short of where its front stood`);
});

test("a kart's footprint (braga-map's task 105), 2.8 by 1.8 m: a wall keeps it 0.9 m off its side and 1.4 m off its nose, another kart 1.8 m off side by side and 2.8 m nose to tail", () => {
  assert.equal(2 * CAR_R, KART.wide);
  assert.equal(2 * (CAR_L + CAR_R), KART.long);
  // Put a little into the plinth's sides from the street, alongside them and nose on: pushed out.
  for (const s of [-1, 1]) {
    const side = B.x + s * 3;
    for (const [yaw, off] of [[Math.PI / 2, KART.wide / 2], [s < 0 ? 0 : Math.PI, KART.long / 2]]) {
      const x = side + s * (off - 0.1);
      const c = plinthed.place(carAt(v3(x, plinthed.land(x, B.z) + 0.3, B.z), yaw, v3(0, 1, 0)), plinthed.land(x, B.z) + 0.5);
      for (let i = 0; i < 3; i++) stepCar(c, still, plinthed, DT);
      assert.ok(Math.abs(s * (c.p.x - side) - off) < 0.01, `${(s * (c.p.x - side)).toFixed(3)} m off the side, for ${off} m`);
    }
  }
  // Another kart, still, beside it or ahead, a little further than it touches and a little nearer.
  const other = (x: number, z: number, yaw = 0): CarInfo => ({ id: 'o', name: 'O', P: 0, x, y: 0, z, yaw, vx: 0, vz: 0, flags: 0, fin: null });
  const touches = (o: CarInfo) => {
    const c = carAt(v3(0, 0, 0), 0, v3(0, 1, 0));
    const notes: Note[] = [];
    bump(c, 'me', [o], notes);
    return c.p.x !== 0 || c.p.z !== 0;
  };
  for (const [x, z] of [[0, KART.wide], [KART.long, 0], [-KART.long, 0]]) {
    const d = Math.hypot(x, z);
    assert.ok(!touches(other((x * (d + 0.05)) / d, (z * (d + 0.05)) / d)), `touches at ${(d + 0.05).toFixed(2)} m`);
    assert.ok(touches(other((x * (d - 0.05)) / d, (z * (d - 0.05)) / d)), `doesn't touch at ${(d - 0.05).toFixed(2)} m`);
  }
  // Across it, nose to its side: its nose's circle against the nearer of yours.
  const across = KART.long / 2 + KART.wide / 2;
  assert.ok(!touches(other(CAR_L, across + 0.05, Math.PI / 2)));
  assert.ok(touches(other(CAR_L, across - 0.05, Math.PI / 2)));
});

// The lane off the Praceta João XXI, between two retaining walls 3.6 to 3.8 m apart for some 7 m: two
// karts fit side by side in it, where the first karts (two 0.8 m circles, touching 2.2 m apart)
// needed 3.8 m.
test('two karts side by side in the lane off the Praceta João XXI, 3.7 m between its walls', () => {
  const [ax, az, bx, bz] = [202, 553.5, 222, 543]; // its line on the map
  const L = Math.hypot(bx - ax, bz - az);
  const [tx, tz] = [(bx - ax) / L, (bz - az) / L];
  const [nx, nz] = [-tz, tx]; // to the right, going from a to b
  const floor = (x: number, z: number) => ground.floor(x, z, ground.land(x, z) + 1.5).y;
  // How far the wall on that side is from the line, s m along it.
  const wall = (s: number, side: number) => {
    const [x, z] = [ax + tx * s, az + tz * s];
    const y = floor(x, z) + 0.05;
    let r = 0;
    while (r < 5 && !ground.circle(x + nx * r * side, z + nz * r * side, x + nx * r * side, z + nz * r * side, y, 0.01)) r += 0.01;
    return r;
  };
  for (let s = 2; s <= 7; s++) {
    const across = wall(s, -1) + wall(s, 1);
    assert.ok(across > 2 * KART.wide && across < 0.8 + 2.2 + 0.8, `${across.toFixed(2)} m across ${s} m along`);
  }
  // A kart along each wall, 2 cm off it, side by side or one a length's half on: clear of the walls,
  // and of each other.
  const kart = (s: number, side: number) => {
    const off = wall(s, side) - CAR_R - 0.02;
    const [x, z] = [ax + tx * s + nx * off * side, az + tz * s + nz * off * side];
    const yaw = Math.atan2(tz, tx) + Math.atan((side * (wall(s + 1, side) - wall(s - 1, side))) / 2);
    return carAt(v3(x, floor(x, z), z), yaw, v3(0, 1, 0));
  };
  for (let s = 3; s <= 6; s += 0.5) {
    for (const ahead of [0, KART.long / 2]) {
      const left = kart(s, -1);
      const right = kart(s + ahead, 1);
      for (const c of [left, right]) {
        for (const e of [1, -1]) {
          const [qx, qz] = [c.p.x + Math.cos(c.yaw) * CAR_L * e, c.p.z + Math.sin(c.yaw) * CAR_L * e];
          assert.equal(ground.circle(qx, qz, qx, qz, c.p.y, CAR_R), null, `in a wall ${s} m along`);
        }
      }
      const was = { ...right.p };
      bump(right, 'r', [{ id: 'l', name: 'L', P: 0, x: left.p.x, y: left.p.y, z: left.p.z, yaw: left.yaw, vx: 0, vz: 0, flags: 0, fin: null }], []);
      assert.deepEqual(right.p, was, `touching ${s} m along, ${ahead} m on`);
      if (!ahead) assert.ok(Math.hypot(right.p.x - left.p.x, right.p.z - left.p.z) < 2.2, 'where the first karts touched');
    }
  }
});

// A Roamer at a point of the Rua do Fujacal, going up it.
const roamer = (x: number, z: number, speed = 0) => {
  const c = ground.place(carAt(v3(x, ground.land(x, z) + 0.3, z), UP, v3(0, 1, 0)));
  c.v = v3(Math.cos(UP) * speed, 0, Math.sin(UP) * speed);
  return new Roamer(ground, 'me', 'Eu', c);
};

test('free roam: driving up a street, bumping into a friend, and back on the street when lost', () => {
  // Up the street, on its carriageway.
  const r = roamer(176, 832);
  for (let i = 0; i < 240; i++) r.step([], ahead, DT);
  const gone = Math.hypot(r.car.p.x - 176, r.car.p.z - 832);
  assert.ok(gone > 15, `went ${gone.toFixed(1)} m`);
  assert.equal(ground.floor(r.car.p.x, r.car.p.z, r.car.p.y).kind, 'road');
  assert.equal(r.notes.filter((n) => n.k === 'respawn').length, 0);
  // Into a friend standing still in the street 12 m on: a bump, and never through them.
  const b = roamer(176, 832, 8);
  const friend: CarInfo = { id: 'friend', name: 'Amigo', P: 0, x: 176 + 12 * Math.cos(UP), y: ground.land(176 + 12 * Math.cos(UP), 832 + 12 * Math.sin(UP)), z: 832 + 12 * Math.sin(UP), yaw: UP, vx: 0, vz: 0, flags: 0, fin: null };
  let closest = Infinity;
  for (let i = 0; i < 240; i++) {
    b.step([friend], ahead, DT);
    closest = Math.min(closest, Math.hypot(b.car.p.x - friend.x, b.car.p.z - friend.z));
  }
  assert.ok(b.notes.some((n) => n.k === 'bump'), 'never bumped');
  assert.ok(closest > KART.long - 0.2, `${closest.toFixed(2)} m from the friend's middle`);
  // Fallen into the land in the middle of a block: back on a street's carriageway within a second
  // or so, facing along it.
  const lost = new Roamer(ground, 'me', 'Eu', carAt(v3(145, ground.land(145, 820) - 3, 820), 0, v3(0, 1, 0)));
  let back = -1;
  for (let i = 0; i < 240 && back < 0; i++) {
    lost.step([], still, DT);
    if (lost.notes.some((n) => n.k === 'respawn')) back = i * DT;
  }
  assert.ok(back >= 0 && back < 1.5, `respawned after ${back.toFixed(2)} s`);
  assert.equal(ground.floor(lost.car.p.x, lost.car.p.z, lost.car.p.y).kind, 'road');
  // And "Reposicionar": from wherever it is, back on the street nearest.
  const there = r.car.p;
  r.respawn();
  assert.equal(ground.floor(r.car.p.x, r.car.p.z, r.car.p.y).kind, 'road');
  assert.ok(Math.hypot(r.car.p.x - there.x, r.car.p.z - there.z) < 20);
  assert.equal(speedOf(r.car), 0);
});

test('free roam: what a friend sees of you', () => {
  const r = roamer(176, 832, 20);
  r.car.drifting = true;
  r.car.boost = 0.5;
  const info = r.info();
  assert.equal(info.id, 'me');
  assert.equal(info.P, 0);
  assert.ok(info.flags & 16 && info.flags & 32, `flags ${info.flags}`);
  assert.ok(Math.hypot(info.vx, info.vz) > 19);
});

// Every street piece and the land is somewhere a car can be: driving straight on from points all
// over the area, a free-roam car is never lost for good (the area's edge holds it, a respawn puts it
// back on a street).
test('free roam: anywhere in the area, a car keeps to the world', () => {
  const pts = world.open.pts;
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  let tried = 0;
  let respawns = 0;
  const t0 = performance.now();
  for (let x = Math.min(...xs) + 100; x < Math.max(...xs); x += 300) {
    for (let z = Math.min(...zs) + 100; z < Math.max(...zs); z += 300) {
      if (!ground.d.inside.has(x, z)) continue;
      let c: Car;
      try {
        c = ground.spawn(x, z, ground.land(x, z), (x + z) % 6);
      } catch {
        continue;
      }
      tried++;
      const r = new Roamer(ground, 'me', 'Eu', c);
      // Flat out, weaving: off the streets, over kerbs, down banks and off retaining walls.
      let under = 0;
      for (let i = 0; i < 1200; i++) {
        r.step([], { ...ahead, steer: Math.sin(i / 90) * 0.6 }, DT);
        const p = r.car.p;
        assert.ok(ground.d.inside.has(p.x, p.z) && Number.isFinite(p.y), `left the area at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`);
        under = ground.floor(p.x, p.z, p.y + 0.5).buried ? under + 1 : 0;
        assert.ok(under < 240, `under the ground for 2 s at (${p.x.toFixed(0)}, ${p.y.toFixed(1)}, ${p.z.toFixed(0)})`);
      }
      respawns += r.notes.filter((n) => n.k === 'respawn').length;
    }
  }
  console.log(`  ${tried} cars driven 10 s each from all over the area: ${respawns} respawns, ${((performance.now() - t0) / tried).toFixed(0)} ms each`);
  assert.ok(tried >= 20, `${tried} places`);
});
