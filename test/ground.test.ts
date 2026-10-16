import { loadWorld, type World } from 'braga-map';
import amigos from 'braga-map/tracks/amigos.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autopilot } from '../src/car/autopilot.ts';
import { carAt, newCar, speedOf, stepCar, type Car, type Input } from '../src/car/car.ts';
import { angleDiff, clamp, v3 } from '../src/math.ts';
import { buildTrack } from '../src/track/track.ts';
import { CAR_R, STEP, wallSpan, worldGround } from '../src/world/ground.ts';

// The open world's area (braga-map's task 032) and the tiles round it, and the world's ground over
// it, from the map's real tiles.
const world: World = await loadWorld({ open: true });
const ground = worldGround(world);
const DT = 1 / 120;

// Drives down a street: towards a point 8 m on along the line of points pts, at a speed.
function follow(pts: [number, number][], speed: number): (c: Car) => Input {
  return (c) => {
    let best = Infinity;
    let at: [number, number] = pts[pts.length - 1];
    for (let k = 1; k < pts.length; k++) {
      const [ax, az] = pts[k - 1];
      const [bx, bz] = pts[k];
      const L = Math.hypot(bx - ax, bz - az);
      const t = clamp(((c.p.x - ax) * (bx - ax) + (c.p.z - az) * (bz - az)) / (L * L), 0, 1);
      const d = Math.hypot(ax + (bx - ax) * t - c.p.x, az + (bz - az) * t - c.p.z);
      if (d >= best) continue;
      best = d;
      // 8 m on from the nearest point, onto the next stretch if this one ends sooner.
      const on = t * L + 8;
      if (on <= L || k === pts.length - 1) at = [ax + ((bx - ax) * Math.min(on, L)) / L, az + ((bz - az) * Math.min(on, L)) / L];
      else {
        const [cx, cz] = pts[k + 1];
        const M = Math.hypot(cx - bx, cz - bz);
        at = [bx + ((cx - bx) * Math.min(1, (on - L) / M)), bz + ((cz - bz) * Math.min(1, (on - L) / M))];
      }
    }
    const v = speedOf(c);
    const steer = clamp(angleDiff(Math.atan2(at[1] - c.p.z, at[0] - c.p.x), c.yaw) * 2.2, -1, 1);
    return { throttle: v < speed ? 1 : 0, brake: v > speed + 2 ? 1 : 0, steer, drift: false };
  };
}

// A car on the world's ground at (x, z), facing (x2, z2), at a speed, on the surface found from
// height y (the land's by default).
function start(x: number, z: number, x2: number, z2: number, speed: number, y = ground.land(x, z) + 0.3): Car {
  const yaw = Math.atan2(z2 - z, x2 - x);
  const c = ground.place(carAt(v3(x, y, z), yaw, v3(0, 1, 0)), y);
  c.v = v3(Math.cos(yaw) * speed, 0, Math.sin(yaw) * speed);
  return c;
}

interface Run {
  steps: { x: number; y: number; z: number; kind: string; floor: number; grounded: boolean; speed: number; wall: number }[];
  respawns: number;
}

// Steps a car for a while with a pilot, noting where it was and what it stood on.
function run(c: Car, pilot: (c: Car) => Input, seconds: number, until: (c: Car) => boolean = () => false): Run {
  const out: Run = { steps: [], respawns: 0 };
  for (let i = 0; i < seconds / DT && !until(c); i++) {
    if (stepCar(c, pilot(c), ground, DT)) out.respawns++;
    const f = ground.floor(c.p.x, c.p.z, c.p.y);
    out.steps.push({ x: c.p.x, y: c.p.y, z: c.p.z, kind: f.kind, floor: f.y, grounded: c.grounded, speed: speedOf(c), wall: c.wallHit });
  }
  return out;
}

test('the world as a ground: built in well under a second, every part of it there', () => {
  const t0 = performance.now();
  const g = worldGround(world);
  const ms = performance.now() - t0;
  console.log(`the world's ground built in ${ms.toFixed(0)} ms: ${Object.entries(g.counts).map(([k, n]) => `${n} ${k}`).join(', ')}`);
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
  for (const k of ['building walls', 'buildings trimmed at the kerb', 'parapets', 'tunnel sides', 'mouth walls', 'trees', 'joins at grade', 'edge', 'barriers', 'walls', 'retaining walls', 'hedges', 'fences and railings', 'gates']) assert.ok(g.counts[k] > 0, k);
  assert.equal(g.counts.barriers, world.open.gates.length);
});

test('straight across a junction on Fujacal, on the carriageway and on the ground all the way', () => {
  // The Rua do Fujacal, one way, across the Alameda do Fujacal at (162, 791).
  const street: [number, number][] = [[176, 832], [162, 791], [150, 755]];
  const r = run(start(176, 832, 162, 791, 12), follow(street, 14), 8, (c) => c.p.z < 758);
  assert.equal(r.respawns, 0);
  assert.ok(r.steps.at(-1)!.z < 758, `got to z ${r.steps.at(-1)!.z.toFixed(0)}`);
  assert.ok(r.steps.some((s) => Math.hypot(s.x - 162, s.z - 791) < 3), 'went through the junction');
  for (const s of r.steps) {
    assert.equal(s.kind, 'road', `on ${s.kind} at (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);
    assert.ok(s.grounded, `in the air at (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);
    assert.ok(Math.abs(s.y - s.floor) < 0.06, `${(s.y - s.floor).toFixed(2)} m off the road at (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);
    assert.equal(s.wall, 0);
  }
});

test('up a kerb onto the pavement, with a bump, and back down onto the road', () => {
  // The Rua do Fujacal's east kerb, 15 cm high, from (166.5, 793.8) to (172.5, 812.6): from the
  // carriageway at 30° to it, onto the pavement, then back.
  const kx = 6 / 19.73;
  const kz = 18.8 / 19.73;
  const nx = kz;
  const nz = -kx; // out of the road, east
  const s30 = Math.sin(Math.PI / 6);
  const c30 = Math.cos(Math.PI / 6);
  const c = start(165, 795, 165 + kx * c30 + nx * s30, 795 + kz * c30 + nz * s30, 12);
  const yaw = c.yaw;
  const r1 = run(c, (c) => ({ throttle: speedOf(c) < 12 ? 1 : 0, brake: 0, steer: clamp(angleDiff(yaw, c.yaw) * 2, -1, 1), drift: false }), 3, () => ground.floor(c.p.x, c.p.z, c.p.y).kind === 'pavement' && c.grounded && ground.floor(c.p.x - nx, c.p.z - nz, c.p.y).kind === 'pavement');
  const up = r1.steps.findIndex((s) => s.kind === 'pavement');
  assert.ok(up > 0, 'reached the pavement');
  const before = r1.steps[up - 1].speed;
  const after = Math.min(...r1.steps.slice(up, up + 30).map((s) => s.speed));
  assert.ok(before - after > 0.2, `lost ${(before - after).toFixed(2)} m/s at the kerb`);
  assert.ok(r1.steps.slice(up, up + 30).some((s) => !s.grounded), 'hopped at the kerb');
  const on = r1.steps.at(-1)!;
  assert.ok(Math.abs(on.floor - ground.land(on.x, on.z) - 0.15) < 0.02, `the pavement ${(on.floor - ground.land(on.x, on.z)).toFixed(2)} m over the land`);
  // And back onto the road.
  const back = Math.atan2(kz * c30 - nz * s30, kx * c30 - nx * s30);
  const r2 = run(c, (c) => ({ throttle: speedOf(c) < 10 ? 1 : 0, brake: 0, steer: clamp(angleDiff(back, c.yaw) * 2, -1, 1), drift: false }), 3, () => ground.floor(c.p.x, c.p.z, c.p.y).kind === 'road' && c.grounded);
  assert.equal(r1.respawns + r2.respawns, 0);
  assert.equal(r2.steps.at(-1)!.kind, 'road');
  assert.ok(r1.steps.every((s) => s.wall === 0) && r2.steps.every((s) => s.wall === 0), 'hit nothing');
});

test("into a building's wall at any speed and angle: stopped, never through it", () => {
  // A block of flats' front on the Alameda do Fujacal, from (129.5, 812.5) to (141, 809), 12 m
  // long, behind its pavement.
  const b = world.buildings.find((b) => b.pts.some(([x, z]) => x === 129.5 && z === 812.5) && b.pts.some(([x, z]) => x === 141 && z === 809))!;
  assert.ok(b, 'the building');
  const [ax, az, bx, bz] = [129.5, 812.5, 141, 809];
  const L = Math.hypot(bx - ax, bz - az);
  const nx = (bz - az) / L; // out of it, towards the street
  const nz = (ax - bx) / L;
  assert.ok(nz < 0, 'faces north');
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const inside = (x: number, z: number) => {
    let odd = false;
    for (let k = 0, j = b.pts.length - 1; k < b.pts.length; j = k++) {
      const [px, pz] = b.pts[k];
      const [qx, qz] = b.pts[j];
      if (pz > z !== qz > z && x < px + ((z - pz) / (qz - pz)) * (qx - px)) odd = !odd;
    }
    return odd;
  };
  for (const deg of [0, 30, -30, 60, -60]) {
    for (const speed of [8, 20, 44, 60]) {
      const a = (deg * Math.PI) / 180;
      const ox = nx * Math.cos(a) - nz * Math.sin(a);
      const oz = nx * Math.sin(a) + nz * Math.cos(a);
      const c = start(mx + ox * 9, mz + oz * 9, mx, mz, speed);
      const yaw = c.yaw;
      let hit = 0;
      let closest = Infinity;
      for (let i = 0; i < 3 / DT; i++) {
        stepCar(c, { throttle: 1, brake: 0, steer: clamp(angleDiff(yaw, c.yaw) * 2, -1, 1), drift: false }, ground, DT);
        hit = Math.max(hit, c.wallHit);
        // Its middle's distance in front of the wall, along its normal.
        const t = ((c.p.x - ax) * (bx - ax) + (c.p.z - az) * (bz - az)) / (L * L);
        if (t > 0 && t < 1) closest = Math.min(closest, (c.p.x - ax) * nx + (c.p.z - az) * nz);
        assert.ok(!inside(c.p.x, c.p.z), `in the building at ${speed} m/s, ${deg}°`);
      }
      assert.ok(hit > 0, `never hit it at ${speed} m/s, ${deg}°`);
      assert.ok(closest > CAR_R - 0.05, `${closest.toFixed(2)} m from the wall at ${speed} m/s, ${deg}°`);
    }
  }
});

test("over the Avenida Robert Smith's deck, and under it on the Avenida Frei Bartolomeu dos Mártires", () => {
  // Over: east along the Robert Smith, its deck from x 1505 to 1564, 42 m up.
  const over = run(start(1446, 1084, 1505, 1079, 15), follow([[1441, 1084], [1505, 1079], [1564, 1070], [1606, 1064]], 16), 12, (c) => c.p.x > 1595);
  assert.equal(over.respawns, 0);
  assert.ok(over.steps.at(-1)!.x > 1595, 'crossed it');
  const on = over.steps.filter((s) => s.x > 1512 && s.x < 1558);
  assert.ok(on.length > 100);
  for (const s of on) {
    assert.equal(s.kind, 'deck');
    assert.ok(Math.abs(s.y - 42.15) < 0.5, `at ${s.y.toFixed(2)} m on the deck at x ${s.x.toFixed(0)}`);
  }
  // Under: south along the Frei Bartolomeu dos Mártires, 7 m under the deck.
  const under = run(start(1529, 1030, 1529, 1055, 15), follow([[1529, 1037], [1529, 1055], [1528, 1063], [1527, 1082], [1525, 1098], [1521, 1123]], 16), 8, (c) => c.p.z > 1115);
  assert.equal(under.respawns, 0);
  assert.ok(under.steps.at(-1)!.z > 1115, 'went under it');
  const below = under.steps.filter((s) => s.z > 1062 && s.z < 1082);
  assert.ok(below.length > 50);
  for (const s of below) {
    assert.equal(s.kind, 'road');
    assert.ok(s.y < 37, `at ${s.y.toFixed(2)} m under the deck at z ${s.z.toFixed(0)}`);
  }
  console.log(`the deck: ${Math.min(...on.map((s) => s.y)).toFixed(2)}–${Math.max(...on.map((s) => s.y)).toFixed(2)} m; the road under it: ${Math.min(...below.map((s) => s.y)).toFixed(2)}–${Math.max(...below.map((s) => s.y)).toFixed(2)} m`);
});

test("through the Avenida da Liberdade's underpass, in at one mouth and out of the other, both ways", () => {
  // Two one-way tunnels under the Liberdade at (181, 589), their road 5.5 m under it.
  const ways: [number, number][][] = [
    [[276, 525], [250, 548], [226, 564], [207, 575], [165, 593], [123, 608], [60, 627]],
    [[-20, 655], [124, 611], [166, 596], [208, 578], [228, 567], [251, 551], [278, 528]],
  ];
  for (const w of ways) {
    const r = run(start(w[0][0], w[0][1], w[1][0], w[1][1], 12), follow(w, 14), 30, (c) => Math.hypot(c.p.x - w.at(-1)![0], c.p.z - w.at(-1)![1]) < 10);
    assert.equal(r.respawns, 0);
    assert.ok(Math.hypot(r.steps.at(-1)!.x - w.at(-1)![0], r.steps.at(-1)!.z - w.at(-1)![1]) < 10, `came out at (${r.steps.at(-1)!.x.toFixed(0)}, ${r.steps.at(-1)!.z.toFixed(0)})`);
    const inside = r.steps.filter((s) => s.kind === 'tunnel');
    assert.ok(inside.length > 100, 'in the tunnel');
    const mid = r.steps.filter((s) => s.x > 172 && s.x < 190);
    for (const s of mid) {
      assert.equal(s.kind, 'tunnel');
      assert.ok(s.y < 10, `at ${s.y.toFixed(2)} m under the Liberdade (the street's at 14 m)`);
    }
    // Out of both mouths: on the street before it went in and after it came out.
    const first = r.steps.findIndex((s) => s.kind === 'tunnel');
    const last = r.steps.length - 1 - [...r.steps].reverse().findIndex((s) => s.kind === 'tunnel');
    assert.ok(r.steps.slice(0, first).some((s) => s.kind === 'road'), 'on the street before');
    assert.ok(r.steps.slice(last + 1).some((s) => s.kind === 'road'), 'on the street after');
    assert.ok(r.steps.every((s) => s.wall < 2), `hit a wall at ${Math.max(...r.steps.map((s) => s.wall)).toFixed(1)} m/s`);
  }
});

// braga-map's task 013: the walls, fences, hedges and gates, which a kart hits as a building.
test('into a wall, a hedge, a gate and a retaining wall from below: stopped', () => {
  // Of each kind, the first five in the area with a straight stretch 4 m long or more (a gate 2 m) and
  // clear land 6 m out from its middle (a retaining wall's lower side, on its right), nothing else standing in between, driven
  // into square on at three speeds.
  const kinds = ['wall', 'hedge', 'gate', 'retaining'] as const;
  let tried = 0;
  for (const kind of kinds) {
    const picked = [];
    for (const w of world.walls) {
      if (picked.length >= 5) break;
      if (w.kind !== kind || !world.inOpen(w.pts[0][0], w.pts[0][1])) continue;
      // The middle of its longest straight stretch (a wall can turn a corner).
      let k = 1;
      for (let i = 2; i < w.pts.length; i++) if (Math.hypot(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1]) > Math.hypot(w.pts[k][0] - w.pts[k - 1][0], w.pts[k][1] - w.pts[k - 1][1])) k = i;
      const L = Math.hypot(w.pts[k][0] - w.pts[k - 1][0], w.pts[k][1] - w.pts[k - 1][1]);
      if (L < (kind === 'gate' ? 2 : 4)) continue;
      const [cx, cz] = [(w.pts[k][0] + w.pts[k - 1][0]) / 2, (w.pts[k][1] + w.pts[k - 1][1]) / 2];
      const m = wallSpan(ground, w).reduce((b, q) => (Math.hypot(q.x - cx, q.z - cz) < Math.hypot(b.x - cx, b.z - cz) ? q : b));
      // Standing on the ground a kart drives on, not at a level of its own (on a deck, over a cutting).
      if (Math.abs(m.y0 + 0.3 - Math.min(ground.groundAt(m.x, m.z), m.y1 - w.h)) > 0.5) continue;
      // Out to its right ((nx, nz) is its line's right): a retaining wall's lower side.
      const [ox, oz] = [m.nx, m.nz];
      const clear = [1.5, 3, 4.5, 6].every((d) => {
        const x = m.x + ox * (d + w.w / 2);
        const z = m.z + oz * (d + w.w / 2);
        const f = ground.floor(x, z, ground.groundAt(x, z) + 0.5);
        return (f.kind === 'land' || f.kind === 'pavement' || f.kind === 'road' || f.kind === 'path') && Math.abs(f.y - ground.groundAt(m.x + ox * (6 + w.w / 2), m.z + oz * (6 + w.w / 2))) < 1.5;
      });
      const others = ground.d.walls.near(m.x + ox * 3 - 4, m.z + oz * 3 - 4, m.x + ox * 3 + 4, m.z + oz * 3 + 4, []).filter((q) => {
        // A wall crossing the way in, other than this one's.
        const ex = q.bx - q.ax;
        const ez = q.bz - q.az;
        const den = ex * oz - ez * ox;
        if (Math.abs(den) < 1e-9) return false;
        const t = ((m.x + ox * (w.w / 2 + 0.3) - q.ax) * oz - (m.z + oz * (w.w / 2 + 0.3) - q.az) * ox) / den;
        const u = ((m.x + ox * (w.w / 2 + 0.3) - q.ax) * ez - (m.z + oz * (w.w / 2 + 0.3) - q.az) * ex) / den;
        return t > 0 && t < 1 && u > 0 && u < 6;
      });
      if (clear && !others.length) picked.push({ w, m, ox, oz });
    }
    assert.ok(picked.length >= 3, `only ${picked.length} ${kind}s to drive into`);
    for (const { w, m, ox, oz } of picked) {
      for (const speed of [5, 15, 30]) {
        const [x, z] = [m.x + ox * (6 + w.w / 2), m.z + oz * (6 + w.w / 2)];
        const c = ground.place(carAt(v3(x, ground.groundAt(x, z) + 0.3, z), Math.atan2(-oz, -ox), v3(0, 1, 0)), ground.groundAt(x, z) + 0.5);
        c.v = v3(-ox * speed, 0, -oz * speed);
        let near = Infinity;
        let hit = 0;
        for (let i = 0; i < 2 / DT; i++) {
          stepCar(c, { throttle: 1, brake: 0, steer: 0, drift: false }, ground, DT);
          near = Math.min(near, (c.p.x - m.x) * ox + (c.p.z - m.z) * oz);
          hit = Math.max(hit, c.wallHit);
        }
        const at = `the ${kind} at (${m.x.toFixed(1)}, ${m.z.toFixed(1)}), ${w.h} m high, at ${speed} m/s`;
        assert.ok(hit > 0, `never hit ${at}`);
        // Its centre stops a car's radius from the wall's face (the car's two circles are a little ahead
        // of it, and it may slew along the wall).
        assert.ok(near > w.w / 2 + CAR_R - 0.15, `${near.toFixed(2)} m from the line of ${at}`);
        tried++;
      }
    }
  }
  console.log(`into walls, hedges, gates and retaining walls: ${tried} runs, all stopped`);
});

test("into a gate's barriers at the area's edge: stopped", () => {
  // The first ten gates on the ground across a street at least 5 m wide that runs straight for 20 m
  // inside the area, driven into along it at three speeds.
  const straight = (g: World['open']['gates'][number]) => {
    for (let d = 2; d <= 20; d += 2) if (ground.floor(g.x - Math.cos(g.heading) * d, g.z - Math.sin(g.heading) * d, g.y + 1).kind !== 'road') return false;
    return true;
  };
  const gates = world.open.gates.filter((g) => g.level === 'ground' && g.w >= 5 && straight(g)).slice(0, 10);
  assert.equal(gates.length, 10);
  for (const gate of gates) {
    const ux = Math.cos(gate.heading);
    const uz = Math.sin(gate.heading);
    for (const speed of [10, 30, 50]) {
      const c = ground.place(carAt(v3(gate.x - ux * 20, gate.y + 0.3, gate.z - uz * 20), gate.heading, v3(0, 1, 0)), gate.y + 0.5);
      c.v = v3(ux * speed, 0, uz * speed);
      let past = -Infinity;
      let hit = 0;
      for (let i = 0; i < 3 / DT; i++) {
        stepCar(c, { throttle: 1, brake: 0, steer: 0, drift: false }, ground, DT);
        past = Math.max(past, (c.p.x - gate.x) * ux + (c.p.z - gate.z) * uz);
        hit = Math.max(hit, c.wallHit);
      }
      const at = `the gate at (${gate.x}, ${gate.z}) at ${speed} m/s`;
      assert.ok(hit > 0, `never hit ${at}`);
      assert.ok(past < -CAR_R + 0.05 && past > -CAR_R - 1, `${past.toFixed(2)} m from ${at}`);
    }
  }
});

// braga-map's task 050: the footways and the steps, which a kart drives as everything else (the
// owner's answer).
test('along a footway, on it all the way', () => {
  // A footway of calçada 53 m long, from (361.8, 661.6) to (371, 713.6), between the blocks east of
  // the Avenida da Liberdade.
  const way: [number, number][] = [[361.8, 661.6], [371, 713.6]];
  const r = run(start(362.5, 665.5, 371, 713.6, 6), follow(way, 7), 12, (c) => c.p.z > 708);
  assert.equal(r.respawns, 0);
  assert.ok(r.steps.at(-1)!.z > 708, `got to z ${r.steps.at(-1)!.z.toFixed(0)}`);
  const on = r.steps.filter((s) => s.kind === 'path');
  assert.ok(on.length > r.steps.length * 0.95, `on the footway ${on.length} of ${r.steps.length} steps`);
  for (const s of on) assert.ok(Math.abs(s.y - s.floor) < 0.06 && Math.abs(s.floor - ground.d.land.firm(s.x, s.z)) < 0.01, `off the footway at (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);
  assert.equal(ground.surface(366, 690, ground.d.land.firm(366, 690)), 'paving');
});

test('up a flight of steps a riser at a time, bumping up them, and back down', () => {
  // The 47 steps from (-158.9, 1278), 10.2 m over elev0, up to (-127.4, 1309), 7.4 m higher: 16 cm
  // a riser, no handrail. From 4 m before its foot to 4 m past its top, and back.
  const [fx, fz, tx, tz] = [-158.9, 1278, -127.4, 1309];
  const L = Math.hypot(tx - fx, tz - fz);
  const [ux, uz] = [(tx - fx) / L, (tz - fz) / L];
  const flight = (r: Run) => r.steps.filter((s) => s.kind === 'steps');
  const up = run(start(fx - ux * 4, fz - uz * 4, tx, tz, 4), follow([[fx - ux * 4, fz - uz * 4], [tx + ux * 4, tz + uz * 4]], 5), 20, (c) => (c.p.x - tx) * ux + (c.p.z - tz) * uz > 3);
  const steps = flight(up);
  assert.equal(up.respawns, 0);
  assert.ok((up.steps.at(-1)!.x - tx) * ux + (up.steps.at(-1)!.z - tz) * uz > 3, 'got to the top');
  assert.ok(steps.length > 200, `on the steps ${steps.length} steps`);
  const treads = [...new Set(steps.map((s) => s.floor))];
  assert.ok(treads.length >= 40, `${treads.length} treads under it`);
  for (let k = 1; k < treads.length; k++) assert.ok(treads[k] > treads[k - 1], `down a riser going up, at ${treads[k].toFixed(2)}`);
  assert.ok(treads.at(-1)! - treads[0] > 46 * 0.16 - 0.2, `from ${treads[0].toFixed(2)} to ${treads.at(-1)!.toFixed(2)} m`);
  // Each riser a bump: off the tread for a moment, as up a kerb.
  const hops = up.steps.filter((s, k) => k && !s.grounded && up.steps[k - 1].grounded).length;
  assert.ok(hops >= 20, `${hops} hops up it`);
  const c = start(tx + ux * 3, tz + uz * 3, fx, fz, 2);
  const down = run(c, follow([[tx + ux * 3, tz + uz * 3], [fx - ux * 4, fz - uz * 4]], 5), 20, (c) => (c.p.x - fx) * ux + (c.p.z - fz) * uz < -3);
  assert.equal(down.respawns, 0);
  assert.ok((down.steps.at(-1)!.x - fx) * ux + (down.steps.at(-1)!.z - fz) * uz < -3, 'got to the foot');
  const back = [...new Set(flight(down).map((s) => s.floor))];
  assert.ok(back.length >= 40 && back.every((y, k) => !k || y < back[k - 1]), 'down every tread');
  console.log(`the 47 steps: up in ${(steps.length * DT).toFixed(1)} s with ${hops} hops, ${treads.length} treads from ${treads[0].toFixed(2)} to ${treads.at(-1)!.toFixed(2)} m; down in ${(flight(down).length * DT).toFixed(1)} s`);
});

test('a riser more than a step high is a wall, and how many there are', () => {
  // The flight of 6 from (592.9, 805.9) up to (595, 809.4): 2 m in five risers of 39 cm, more than a
  // kart steps up, for the map counts too few of them. Driven at from 5 m out at its foot: it doesn't
  // climb it.
  const [fx, fz, tx, tz] = [592.9, 805.9, 595, 809.4];
  const L = Math.hypot(tx - fx, tz - fz);
  const [ux, uz] = [(tx - fx) / L, (tz - fz) / L];
  const c = start(fx - ux * 5, fz - uz * 5, tx, tz, 4);
  const r = run(c, follow([[fx - ux * 5, fz - uz * 5], [tx, tz]], 5), 4);
  const top = Math.max(...r.steps.map((s) => s.floor));
  const foot = ground.floor(fx - ux * 1, fz - uz * 1, 30).y;
  assert.ok(top < foot + 0.7, `climbed to ${top.toFixed(2)} m from ${foot.toFixed(2)}`);
  const c2 = ground.counts;
  console.log(`risers between treads: ${c2.risers}, ${c2['risers over a step']} more than ${STEP} m high, walls; and of the treads' edges over a street or a path, ${c2['tread edges over a street over a step']} of ${c2['tread edges over a street']}; that flight climbed ${(top - foot).toFixed(2)} m of its 2`);
  assert.ok(c2['risers over a step'] > 0 && c2['risers over a step'] < c2.risers / 20, `${c2['risers over a step']} of ${c2.risers}`);
});

test('a respawn puts the car on the nearest carriageway at its level, along the street', () => {
  // From the land in the middle of a block on Fujacal: onto a street, on its carriageway.
  const c = ground.spawn(145, 820, ground.land(145, 820), 0);
  assert.equal(ground.floor(c.p.x, c.p.z, c.p.y).kind, 'road');
  assert.ok(Math.hypot(c.p.x - 145, c.p.z - 820) < 30);
  // From the tunnel under the Liberdade: back in the tunnel, not on the street over it.
  const t = ground.spawn(170, 594, 8.4, 0);
  assert.equal(ground.floor(t.p.x, t.p.z, t.p.y).kind, 'tunnel');
  // From the Robert Smith's deck: on the deck.
  const d = ground.spawn(1535, 1070, 42.2, 0);
  assert.equal(ground.floor(d.p.x, d.p.z, d.p.y).kind, 'deck');
});

test('eight cars a step: well inside a frame', () => {
  // Eight karts round the route on the world's ground, the autopilot driving each.
  const track = buildTrack(amigos.points, amigos.ramps);
  const g = ground.race(track);
  const cars = Array.from({ length: 8 }, (_, k) => g.place(newCar(track, 1000 + k * 900, 20)));
  const steps = 1200;
  for (let i = 0; i < 120; i++) for (const c of cars) stepCar(c, autopilot(c, track), g, DT);
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) for (const c of cars) stepCar(c, autopilot(c, track), g, DT);
  const ms = (performance.now() - t0) / steps;
  console.log(`eight cars on the world's ground: ${(ms * 1000).toFixed(0)} µs a step (the game takes two steps a frame at 60 fps)`);
  assert.ok(ms < 1, `${ms.toFixed(2)} ms a step`);
});
