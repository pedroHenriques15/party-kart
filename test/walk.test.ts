import { loadWorld, type World } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carAt } from '../src/car/car.ts';
import { alight, HEIGHT, RADIUS, RUN, STAND, WALK, Walker, type WalkInput } from '../src/game/walker.ts';
import { angleDiff, clamp, v3 } from '../src/math.ts';
import { wallSpan, worldGround } from '../src/world/ground.ts';

// On foot (braga-map's task 073): a walker on the world's ground, from the map's real tiles.
const world: World = await loadWorld({ open: true });
const ground = worldGround(world);
const DT = 1 / 120;

// A walker at (x, z) facing (x2, z2), on the surface found from height y (the ground's by default).
function stand(x: number, z: number, x2: number, z2: number, y = ground.groundAt(x, z)): Walker {
  return new Walker(ground, v3(x, y, z), Math.atan2(z2 - z, x2 - x));
}

interface Walk {
  steps: { x: number; y: number; z: number; kind: string; floor: number; grounded: boolean }[];
  lost: number;
}

// Walks a walker for a while with a pilot, noting where it was and what it stood on.
function walk(w: Walker, pilot: (w: Walker) => Partial<WalkInput>, seconds: number, until: (w: Walker) => boolean = () => false): Walk {
  const out: Walk = { steps: [], lost: 0 };
  for (let i = 0; i < seconds / DT && !until(w); i++) {
    if (w.step({ ...STAND, ...pilot(w) }, DT)) out.lost++;
    const f = ground.floor(w.p.x, w.p.z, w.p.y);
    out.steps.push({ x: w.p.x, y: w.p.y, z: w.p.z, kind: f.kind, floor: f.y, grounded: w.grounded });
  }
  return out;
}

// Straight on towards (x, z), turning to face it.
const towards = (x: number, z: number, run = false) => (w: Walker): Partial<WalkInput> => ({ fwd: 1, run, look: { x: clamp(angleDiff(Math.atan2(z - w.p.z, x - w.p.x), w.yaw), -0.1, 0.1), y: 0 } });

test('on foot: walks at 1.5 m/s and runs at 5, along the Rua do Fujacal', () => {
  for (const [run, pace] of [[false, WALK], [true, RUN]] as const) {
    const w = stand(176, 832, 162, 791);
    walk(w, () => ({ fwd: 1, run }), 1);
    const at = { ...w.p };
    const r = walk(w, () => ({ fwd: 1, run }), 2);
    const v = Math.hypot(w.p.x - at.x, w.p.z - at.z) / 2;
    assert.equal(r.lost, 0);
    assert.ok(Math.abs(v - pace) < 0.05, `${v.toFixed(2)} m/s ${run ? 'running' : 'walking'}`);
    assert.ok(r.steps.every((s) => s.grounded && Math.abs(s.y - s.floor) < 1e-9), 'off the street');
  }
});

test('on foot: up a kerb onto the pavement, and back down', () => {
  // The Rua do Fujacal's east kerb, 15 cm high, from (168.4, 793.8) to (174.4, 812.6): from the
  // carriageway across it, onto the pavement.
  const [kx, kz] = [6 / 19.73, 18.8 / 19.73];
  const [nx, nz] = [kz, -kx]; // out of the road, east
  const w = stand(171.2 - nx * 2, 808.3 - nz * 2, 171.2 + nx, 808.3 + nz);
  assert.equal(ground.floor(w.p.x, w.p.z, w.p.y).kind, 'road');
  const up = walk(w, () => ({ fwd: 1 }), 2.5);
  const on = up.steps.at(-1)!;
  assert.equal(on.kind, 'pavement');
  assert.ok(Math.abs(on.y - ground.land(on.x, on.z) - 0.15) < 0.02, `${(on.y - ground.land(on.x, on.z)).toFixed(2)} m over the land`);
  const down = walk(w, () => ({ fwd: -1 }), 2.5);
  assert.equal(down.steps.at(-1)!.kind, 'road');
  assert.equal(up.lost + down.lost, 0);
});

test('on foot: up a flight of steps tread by tread, and back down', () => {
  // The 47 steps from (-158.9, 1278) up to (-127.4, 1309), 7.4 m higher: 16 cm a riser.
  const [fx, fz, tx, tz] = [-158.9, 1278, -127.4, 1309];
  const L = Math.hypot(tx - fx, tz - fz);
  const [ux, uz] = [(tx - fx) / L, (tz - fz) / L];
  for (const run of [false, true]) {
    const w = stand(fx - ux * 3, fz - uz * 3, tx, tz);
    const up = walk(w, towards(tx + ux * 4, tz + uz * 4, run), 40, (w) => (w.p.x - tx) * ux + (w.p.z - tz) * uz > 3);
    assert.equal(up.lost, 0);
    assert.ok((w.p.x - tx) * ux + (w.p.z - tz) * uz > 3, `got to the top ${run ? 'running' : 'walking'}`);
    const treads = [...new Set(up.steps.filter((s) => s.kind === 'steps').map((s) => s.floor))];
    assert.ok(treads.length >= 40, `${treads.length} treads under it`);
    for (let k = 1; k < treads.length; k++) assert.ok(treads[k] > treads[k - 1], `down a riser going up, at ${treads[k].toFixed(2)}`);
    assert.ok(up.steps.every((s) => s.grounded), 'left the steps');
    w.yaw = Math.atan2(-uz, -ux);
    const down = walk(w, towards(fx - ux * 4, fz - uz * 4, run), 40, (w) => (w.p.x - fx) * ux + (w.p.z - fz) * uz < -3);
    assert.equal(down.lost, 0);
    const back = [...new Set(down.steps.filter((s) => s.kind === 'steps').map((s) => s.floor))];
    assert.ok(back.length >= 40 && back.every((y, k) => !k || y < back[k - 1]), 'down every tread');
    if (!run) console.log(`the 47 steps on foot: up in ${(up.steps.length * DT).toFixed(1)} s, ${treads.length} treads from ${treads[0].toFixed(2)} to ${treads.at(-1)!.toFixed(2)} m; down in ${(down.steps.length * DT).toFixed(1)} s`);
  }
});

test("on foot: into a building's wall, running at any angle, stopped a walker's width from it", () => {
  // A block of flats' front on the Alameda do Fujacal, from (129.5, 812.5) to (141, 809).
  const [ax, az, bx, bz] = [129.5, 812.5, 141, 809];
  const L = Math.hypot(bx - ax, bz - az);
  const [nx, nz] = [(bz - az) / L, (ax - bx) / L]; // out of it
  const [mx, mz] = [(ax + bx) / 2, (az + bz) / 2];
  for (const deg of [0, 30, -30, 60, -60]) {
    const a = (deg * Math.PI) / 180;
    const ox = nx * Math.cos(a) - nz * Math.sin(a);
    const oz = nx * Math.sin(a) + nz * Math.cos(a);
    const w = stand(mx + ox * 6, mz + oz * 6, mx, mz);
    let closest = Infinity;
    walk(w, () => ({ fwd: 1, run: true }), 3, (w) => {
      const t = ((w.p.x - ax) * (bx - ax) + (w.p.z - az) * (bz - az)) / (L * L);
      if (t > 0 && t < 1) closest = Math.min(closest, (w.p.x - ax) * nx + (w.p.z - az) * nz);
      return false;
    });
    assert.ok(closest > RADIUS - 0.02 && closest < RADIUS + 0.2, `${closest.toFixed(2)} m from the wall at ${deg}°`);
  }
});

// The first few of a kind of the map's walls in the area with a straight stretch 3 m long and clear
// ground 4 m out from its middle on its right (a retaining wall's lower side) at about its foot's
// level: its middle, the way out, and the wall.
function wallsOf(kind: string, n: number, high = 0) {
  const out = [];
  for (const w of world.walls) {
    if (out.length >= n) break;
    if (w.kind !== kind || w.h < high || !world.inOpen(w.pts[0][0], w.pts[0][1])) continue;
    let k = 1;
    for (let i = 2; i < w.pts.length; i++) if (Math.hypot(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1]) > Math.hypot(w.pts[k][0] - w.pts[k - 1][0], w.pts[k][1] - w.pts[k - 1][1])) k = i;
    if (Math.hypot(w.pts[k][0] - w.pts[k - 1][0], w.pts[k][1] - w.pts[k - 1][1]) < 3) continue;
    const [cx, cz] = [(w.pts[k][0] + w.pts[k - 1][0]) / 2, (w.pts[k][1] + w.pts[k - 1][1]) / 2];
    const m = wallSpan(ground, w).reduce((b, q) => (Math.hypot(q.x - cx, q.z - cz) < Math.hypot(b.x - cx, b.z - cz) ? q : b));
    if (Math.abs(m.y0 + 0.3 - Math.min(ground.groundAt(m.x, m.z), m.y1 - w.h)) > 0.5) continue;
    const at = (d: number) => [m.x + m.nx * (d + w.w / 2), m.z + m.nz * (d + w.w / 2)] as const;
    const foot = ground.groundAt(...at(4));
    const clear = [0.5, 1, 2, 3, 4].every((d) => {
      const [x, z] = at(d);
      const f = ground.floor(x, z, ground.groundAt(x, z) + 0.2);
      return !f.buried && Math.abs(f.y - foot) < 0.6 && !ground.circle(x, z, ...at(4), f.y, RADIUS, HEIGHT, true);
    });
    // A retaining wall where the land drawn under it drops as it does.
    if (clear && (kind !== 'retaining' || foot < m.y1 - w.h * 0.6)) out.push({ w, m, at, foot });
  }
  return out;
}

test('on foot: into a garden wall, a hedge and a gate, walking and running: stopped', () => {
  let tried = 0;
  for (const kind of ['wall', 'hedge', 'gate']) {
    const picked = wallsOf(kind, 5);
    assert.ok(picked.length >= 3, `only ${picked.length} ${kind}s to walk into`);
    for (const { w, m, at } of picked) {
      for (const run of [false, true]) {
        const [x, z] = at(4);
        const wk = stand(x, z, m.x, m.z);
        let near = Infinity;
        walk(wk, () => ({ fwd: 1, run }), 4, (wk) => ((near = Math.min(near, (wk.p.x - m.x) * m.nx + (wk.p.z - m.z) * m.nz)), false));
        // Its face, where it's drawn, a walker's radius off.
        assert.ok(near > w.w / 2 + RADIUS - 0.05, `${near.toFixed(2)} m from the line of the ${kind} at (${m.x.toFixed(1)}, ${m.z.toFixed(1)}), ${w.w} m thick and ${w.h} m high`);
        assert.ok(near < w.w / 2 + RADIUS + 0.3, `never got to the ${kind} at (${m.x.toFixed(1)}, ${m.z.toFixed(1)}): ${near.toFixed(2)} m`);
        tried++;
      }
    }
  }
  console.log(`on foot into walls, hedges and gates: ${tried} walks, all stopped`);
});

test("on foot: into a tree's trunk: stopped round it", () => {
  // The first ten trees round the Rua do Fujacal on open ground, walked into from 4 m off.
  const trees = ground.d.posts
    .near(0, 650, 300, 950, [])
    .filter((p, k, a) => a.indexOf(p) === k)
    .sort((a, b) => Math.hypot(a.x - 160, a.z - 800) - Math.hypot(b.x - 160, b.z - 800));
  let tried = 0;
  for (const t of trees) {
    if (tried >= 10) break;
    const [x, z] = [t.x - 4, t.z];
    const f = ground.floor(x, z, ground.groundAt(x, z) + 0.2);
    if (!world.inOpen(x, z) || f.buried || Math.abs(f.y - ground.groundAt(t.x, t.z)) > 0.3) continue;
    let clear = true;
    for (let d = 0.5; d <= 4 - t.r - RADIUS; d += 0.5) if (ground.circle(t.x - 4 + d, t.z, t.x - 4, t.z, f.y, RADIUS, HEIGHT, true)) clear = false;
    if (!clear) continue;
    const w = stand(x, z, t.x, t.z);
    let near = Infinity;
    walk(w, () => ({ fwd: 1, run: true }), 3, (w) => ((near = Math.min(near, Math.hypot(w.p.x - t.x, w.p.z - t.z))), false));
    assert.ok(near > t.r + RADIUS - 0.02 && near < t.r + RADIUS + 0.1, `${near.toFixed(2)} m from the trunk at (${t.x.toFixed(1)}, ${t.z.toFixed(1)}), ${t.r.toFixed(2)} m round`);
    tried++;
  }
  assert.ok(tried >= 5, `only ${tried} trees`);
});

test("on foot: a retaining wall can't be climbed, jumping or not, but is dropped off", () => {
  const picked = wallsOf('retaining', 5, 1.2);
  assert.ok(picked.length >= 3, `only ${picked.length} retaining walls`);
  let dropped = 0;
  for (const { w, m, at, foot } of picked) {
    const where = `the retaining wall at (${m.x.toFixed(1)}, ${m.z.toFixed(1)}), ${w.h} m high`;
    // From below, walking, running and jumping at it.
    for (const run of [false, true]) {
      const [x, z] = at(3);
      const wk = stand(x, z, m.x, m.z);
      let high = -Infinity;
      let near = Infinity;
      walk(wk, (wk) => ({ fwd: 1, run, jump: wk.grounded }), 4, (wk) => {
        high = Math.max(high, wk.grounded ? wk.p.y : -Infinity);
        near = Math.min(near, (wk.p.x - m.x) * m.nx + (wk.p.z - m.z) * m.nz);
        return false;
      });
      // At its face, on the land as it's drawn (which ramps up to the wall's top over 2 m), and never up it.
      assert.ok(near > w.w / 2 + RADIUS - 0.05 && near < w.w / 2 + RADIUS + 0.3, `${near.toFixed(2)} m from the line of ${where}`);
      assert.ok(high < m.y1 - 0.5, `climbed ${where} to ${(high - foot).toFixed(2)} m over its foot, its top ${(m.y1 - foot).toFixed(2)}`);
    }
    // From the top, off it.
    const [ux, uz] = [-m.nx, -m.nz];
    const [x, z] = [m.x + ux * (w.w / 2 + 1), m.z + uz * (w.w / 2 + 1)];
    const top = ground.floor(x, z, m.y1 + 1);
    if (top.buried || top.y < foot + w.h * 0.6) continue;
    const wk = new Walker(ground, v3(x, top.y, z), Math.atan2(m.nz, m.nx));
    const r = walk(wk, () => ({ fwd: 1 }), 4);
    assert.equal(r.lost, 0);
    const past = (wk.p.x - m.x) * m.nx + (wk.p.z - m.z) * m.nz;
    assert.ok(past > 1 && wk.p.y < (top.y + foot) / 2, `didn't drop off ${where}: ${past.toFixed(2)} m past it, ${(top.y - wk.p.y).toFixed(2)} m down of ${(top.y - foot).toFixed(2)}`);
    dropped++;
  }
  assert.ok(dropped >= 2, `dropped off ${dropped}`);
});

test("on foot: no wall in the shooter's area walked through or under, nor a retaining wall climbed from below", () => {
  // Task 073's survey (braga-map's task 077): into the middle of every straight stretch of every wall 0.75
  // m high or more in Fujacal, from 2 m out on each side (a retaining wall's lower side, on its right),
  // running and jumping; one that takes the walker past it, along the stretch, is walked through.
  const tried: Record<string, number> = {};
  const through: string[] = [];
  for (const w of world.walls) {
    if (w.h < 0.75) continue;
    for (let i = 1; i < w.pts.length; i++) {
      const [ax, az] = w.pts[i - 1];
      const [bx, bz] = w.pts[i];
      const L = Math.hypot(bx - ax, bz - az);
      const [mx, mz] = [(ax + bx) / 2, (az + bz) / 2];
      if (L < 1 || !world.inShooter(mx, mz)) continue;
      const [nx, nz] = [-(bz - az) / L, (bx - ax) / L];
      for (const side of w.kind === 'retaining' ? [1] : [1, -1]) {
        const [x, z] = [mx + nx * side * (2 + w.w / 2), mz + nz * side * (2 + w.w / 2)];
        if (!ground.d.inside.has(x, z)) continue;
        const f = ground.floor(x, z, ground.groundAt(x, z) + 0.2);
        if (f.buried || ground.circle(x, z, x, z, f.y, RADIUS, HEIGHT, true)) continue;
        tried[w.kind] = (tried[w.kind] ?? 0) + 1;
        const wk = new Walker(ground, v3(x, f.y, z), Math.atan2(-nz * side, -nx * side));
        walk(wk, (wk) => ({ fwd: 1, run: true, jump: wk.grounded }), 3, (wk) => {
          const d = ((wk.p.x - mx) * nx + (wk.p.z - mz) * nz) * side;
          if (d > -w.w / 2 - 0.05 || Math.abs((wk.p.x - mx) * -nz + (wk.p.z - mz) * nx) > L / 2) return false;
          through.push(`the ${w.kind} ${w.h} m high at (${mx.toFixed(1)}, ${mz.toFixed(1)}), its top at ${(w.ys[i - 1] / 2 + w.ys[i] / 2).toFixed(2)}, the walker's feet at ${wk.p.y.toFixed(2)}`);
          return true;
        });
      }
    }
  }
  console.log(`on foot into Fujacal's walls: ${Object.entries(tried).map(([k, n]) => `${n} stretches of ${k}`).join(', ')}; ${through.length} walked through`);
  assert.ok(tried.retaining > 50 && tried.wall > 80 && tried.hedge > 50 && tried.gate > 30, JSON.stringify(tried));
  assert.deepEqual(through, []);
});

test('on foot: through both passages under the houses south of the Rua Doutor José Vilaça, both ways', () => {
  // The one at (-262, 924), and the courtyard's at (-319, 931) (braga-map's task 078), from 6 m out of
  // either end to 6 m out of the other, along its middle.
  for (const [ax, az, bx, bz] of [[-248, 921.5, -275, 926.3], [-305, 927, -332, 935.5]]) {
    for (const [fx, fz, tx, tz] of [[ax, az, bx, bz], [bx, bz, ax, az]]) {
      const L = Math.hypot(tx - fx, tz - fz);
      const [ux, uz] = [(tx - fx) / L, (tz - fz) / L];
      const w = stand(fx, fz, tx, tz);
      let far = 0;
      const r = walk(w, (w) => ({ fwd: 1, look: { x: clamp(angleDiff(Math.atan2(uz, ux) - clamp((-(w.p.x - fx) * uz + (w.p.z - fz) * ux) * 0.8, -0.5, 0.5), w.yaw), -0.1, 0.1), y: 0 } }), 25, (w) => (far = (w.p.x - fx) * ux + (w.p.z - fz) * uz) > L - 0.5);
      assert.equal(r.lost, 0);
      assert.ok(far > L - 0.5, `stopped ${far.toFixed(1)} m into ${L.toFixed(1)}, from (${fx}, ${fz})`);
    }
  }
});

test("on foot: stays inside the open world's area", () => {
  // Into the barrier across each of the first ten streets leaving the area, and on past it.
  const gates = world.open.gates.filter((g) => g.level === 'ground' && g.w >= 5).slice(0, 10);
  for (const g of gates) {
    const [ux, uz] = [Math.cos(g.heading), Math.sin(g.heading)];
    const w = stand(g.x - ux * 6, g.z - uz * 6, g.x, g.z, g.y);
    walk(w, () => ({ fwd: 1, run: true, jump: true }), 4);
    assert.ok(world.inOpen(w.p.x, w.p.z) && (w.p.x - g.x) * ux + (w.p.z - g.z) * uz < 0, `past the gate at (${g.x}, ${g.z})`);
  }
});

test("out of the kart beside it, on the pavement's side", () => {
  // A kart on the Rua do Fujacal's carriageway by its east kerb, facing up the street (north), the
  // pavement on its right.
  const yaw = Math.atan2(-18.8, -6);
  const k = ground.place(carAt(v3(170.4, ground.land(170.4, 806) + 0.3, 806), yaw, v3(0, 1, 0)));
  const w = alight(ground, k.p, k.yaw);
  assert.equal(ground.floor(w.p.x, w.p.z, w.p.y).kind, 'pavement');
  assert.ok(Math.hypot(w.p.x - k.p.x, w.p.z - k.p.z) < 3);
  // To its right.
  assert.ok((w.p.x - k.p.x) * -Math.sin(yaw) + (w.p.z - k.p.z) * Math.cos(yaw) > 1);
});
