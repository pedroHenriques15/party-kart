import { loadWorld, type World } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawOf, GUN_IDS, GUNS, kickOf, START, type Family, type GunId, type Loadout } from '../src/game/arsenal.ts';
import { eyeOf, field, pickSpawn } from '../src/game/field.ts';
import { byKills, chestOf, fighterOf, fire, headOf, hitBody, kicked, RESPAWN, SAFE, Soldier, spreadOf, stab, struck, tally, type Body, type Score, type See } from '../src/game/fight.ts';
import { STAND, Walker } from '../src/game/walker.ts';
import { norm, v3, type V } from '../src/math.ts';
import { worldGround } from '../src/world/ground.ts';
import { clear, sight } from '../src/world/sight.ts';

// The deathmatch (braga-map's task 074), Counter-Strike's way: line of sight, the hitboxes, the guns'
// damage through armour, their times to kill, their recoil and spread, the scope, the draw, the
// shotgun's shells, the knife, the scores, on the map's real tiles.
const world: World = await loadWorld({ open: true });
const ground = worldGround(world);
const built = performance.now();
// The Topo do Fujacal, the Rua do Fujacal by the race's start (braga-map's task 079).
const F = field(ground, world.arenas.find((a) => a.id === 'topo')!);
const fieldMs = performance.now() - built;
const DT = 1 / 120;
const deg = Math.PI / 180;

// Open ground: nothing stops a shot.
const open: See = (o, d, max) => ({ t: max, x: o.x + d.x * max, y: o.y + d.y * max, z: o.z + d.z * max, nx: 0, ny: 0, nz: 0, what: null });
const kitOf = (g: GunId, nades: Loadout['nades'] = []): Loadout => (GUNS[g].slot === 'primary' ? { primary: g, secondary: 'usp', nades, armour: 2 } : { primary: null, secondary: g, nades, armour: 2 });
// Someone in a vest and a helmet, armed long ago (not safe any more).
const victim = (id = 'b') => {
  const s = new Soldier(id);
  s.arm(START, -10000);
  return s;
};
const still = { speed: 0, air: false };

test('line of sight: down an open street, and not through a building', () => {
  // Along the Rua do Fujacal, eye to eye, 43 m.
  const a = v3(176, ground.groundAt(176, 832) + 1.65, 832);
  const b = v3(162, ground.groundAt(162, 791) + 1.65, 791);
  assert.ok(clear(ground, a, b), 'the Rua do Fujacal is open');
  // A block of flats' front on the Alameda do Fujacal, from (129.5, 812.5) to (141, 809): from 6 m in
  // front of it, through it to 25 m behind.
  const [mx, mz] = [135.25, 810.75];
  const L = Math.hypot(11.5, 3.5);
  const [nx, nz] = [-3.5 / L, -11.5 / L];
  const front = v3(mx + nx * 6, ground.groundAt(mx + nx * 6, mz + nz * 6) + 1.65, mz + nz * 6);
  const back = v3(mx - nx * 25, front.y, mz - nz * 25);
  const d = norm(v3(back.x - front.x, back.y - front.y, back.z - front.z));
  const s = sight(ground, front, d, 40);
  assert.equal(s.what, 'building');
  assert.ok(Math.abs(s.t - 6) < 0.2, `stopped ${s.t.toFixed(2)} m on, at the wall 6 m away`);
  assert.ok(Math.abs(s.nx * nx + s.nz * nz - 1) < 0.01, 'its mark faces the shooter');
  // Into the ground: from the eye, down at 45° ahead, onto the street 1.65 m ahead.
  const g = sight(ground, a, norm(v3(b.x - a.x, -Math.hypot(b.x - a.x, b.z - a.z), b.z - a.z)), 10);
  assert.equal(g.what, 'ground');
  assert.ok(Math.abs(g.t - 1.65 * Math.SQRT2) < 0.25, `the street ${g.t.toFixed(2)} m along the ray`);
});

test('line of sight: fast enough for every shot and every bot looking, between the spawns', () => {
  const pairs: [V, V][] = [];
  for (const a of F.spawns) for (const b of F.spawns) if (a !== b) pairs.push([eyeOf(a), eyeOf(b)]);
  let opened = 0;
  const t0 = performance.now();
  for (let k = 0; k < 3; k++) for (const [a, b] of pairs) if (clear(F.ground, a, b)) opened++;
  const each = ((performance.now() - t0) * 1000) / (pairs.length * 3);
  const far = pairs.reduce((s, [a, b]) => s + Math.hypot(b.x - a.x, b.z - a.z), 0) / pairs.length;
  console.log(`line of sight between ${F.spawns.length} spawns: ${pairs.length} pairs, ${far.toFixed(0)} m apart on average, ${Math.round(opened / 3)} open; ${each.toFixed(0)} µs a look`);
  assert.ok(each < 400, `${each.toFixed(0)} µs a look`);
  console.log(`the round's field built in ${fieldMs.toFixed(0)} ms: ${F.spawns.length} spawns, ${F.rails.length} railings ${F.rails.reduce((s, r) => s + r.length, 0)} m, ${F.gates.length} gates`);
});

test("a bullet's hitboxes: the head, the body and the legs, standing and crouched", () => {
  const b: Body = { id: 'b', x: 10, y: 0, z: 0 };
  const at = (y: number, c = 0) => hitBody(v3(0, y, 0), v3(1, 0, 0), { ...b, c }, 50)?.part ?? null;
  assert.equal(at(1.6), 'head');
  assert.equal(at(1.2), 'body');
  assert.equal(at(0.5), 'legs');
  assert.equal(at(1.85), null, 'over the head');
  assert.equal(hitBody(v3(0, 1.2, 0.5), v3(1, 0, 0), b, 50), null, 'beside them');
  assert.equal(hitBody(v3(0, 1.2, 0), v3(1, 0, 0), b, 9), null, 'past what stopped the ray');
  // Crouched, the head's where the chest was, and a shot over it misses.
  assert.equal(at(1.24, 1), 'head');
  assert.equal(at(1.6, 1), null);
  assert.equal(at(0.82, 1), 'body');
  assert.equal(at(0.3, 1), 'legs');
  assert.ok(headOf({ ...b, c: 1 }).y < headOf(b).y - 0.4 && chestOf({ ...b, c: 1 }).y < chestOf(b).y, 'the head and the chest come down');
});

test('damage through armour: an AK-47 to the head through a helmet kills, an M4A4 does not, the AWP to the body kills, the Desert Eagle to the head kills', () => {
  // From 10 m (the AWP 20 m, scoped and settled), standing still, aimed at the middle of the part.
  const shot = (g: GunId, d: number, part: 'head' | 'body') => {
    const s = new Soldier('a');
    s.arm(kitOf(g), 0);
    let t = 0;
    if (GUNS[g].scope) {
      s.zoom(0);
      t = 500;
    }
    const b: Body = { id: 'b', x: d, y: 0, z: 0 };
    const eye = v3(0, 1.65, 0);
    const p = part === 'head' ? headOf(b) : chestOf(b);
    const ev = fire(s, eye, norm(v3(p.x - eye.x, p.y - eye.y, p.z - eye.z)), still, t, [b], open, 99)!;
    const v = victim();
    const h = ev.hits.find((x) => x.v === 'b')!;
    assert.ok(part === 'head' ? h.h > 0 : h.b > 0, `${g} hit the ${part}`);
    const r = v.hurt(h, g, t);
    return { ...r, health: v.health, armour: v.armour };
  };
  assert.ok(shot('ak47', 10, 'head').down, 'the AK-47 headshot');
  const m4 = shot('m4a4', 10, 'head');
  assert.ok(!m4.down && m4.health < 20, `the M4A4 headshot left ${m4.health}`);
  assert.ok(shot('awp', 20, 'body').down, 'the AWP body shot');
  assert.ok(shot('deagle', 10, 'head').down, 'the Desert Eagle headshot');
  const usp = shot('usp', 10, 'body');
  assert.ok(!usp.down && usp.health > 75 && usp.armour < 100, `a USP-S to the body: ${usp.health} health, ${usp.armour} armour`);
  // The legs aren't armoured: the AK-47's full damage, three quarters of it.
  const s = new Soldier('a');
  s.arm(kitOf('ak47'), 0);
  const v = victim();
  v.hurt({ b: 0, h: 0, l: 27 }, 'ak47', 0);
  assert.equal(v.health, 73);
  assert.equal(v.armour, 100);
});

// A duel's half: how long a gun takes to put down someone in a vest and a helmet standing d metres
// off, aiming at their chest and pulling against the recoil perfectly, firing as fast as it may
// (reloading when it must), scoped from 10 m if it has a scope, running or standing; the mean over n.
function ttk(g: GunId, d: number, running: boolean, n = 40): number {
  let sum = 0;
  let seed = 12345;
  const gun = GUNS[g];
  for (let k = 0; k < n; k++) {
    const s = new Soldier('a');
    s.arm(kitOf(g), 0);
    let t = 0;
    if (gun.scope && d >= 10) s.zoom(0);
    const b: Body = { id: 'b', x: d, y: 0, z: 0 };
    const v = victim();
    const eye = v3(0, 1.65, 0);
    const p = chestOf(b);
    const aim = norm(v3(p.x - eye.x, p.y - eye.y, p.z - eye.z));
    for (; t < 10000 && v.alive; t += DT * 1000) {
      s.step(DT, t);
      if (s.mag === 0) s.reload(t);
      // Scoped, it waits for the scope to settle.
      if (gun.scope && d >= 10 && (!s.scope || s.scopedFor(t) < gun.scope.settle)) continue;
      const ev = fire(s, eye, kicked(aim, { x: -s.punch.x, y: -s.punch.y }), { speed: running ? s.scope ? gun.scope!.speed : gun.speed : 0, air: false }, t, [b], open, (seed = (seed * 16807) % 2147483647));
      for (const h of ev?.hits ?? []) v.hurt(h, g, t);
    }
    sum += t;
  }
  return sum / n / 1000;
}

test('the guns: their times to kill, each family best somewhere', () => {
  const dists = [3, 10, 20, 40, 80];
  const rows: string[] = [];
  const best = new Map<string, Record<Family, number>>();
  for (const running of [false, true]) {
    for (const d of running ? [5] : dists) {
      const times = GUN_IDS.map((g) => ({ g, t: ttk(g, d, running) }));
      const fam = {} as Record<Family, number>;
      for (const { g, t } of times) fam[GUNS[g].family] = Math.min(fam[GUNS[g].family] ?? Infinity, t);
      best.set(`${d}${running ? 'r' : ''}`, fam);
      const sorted = [...times].sort((a, b) => a.t - b.t);
      rows.push(`${String(d).padStart(3)} m${running ? ' running' : '        '}  ${(Object.entries(fam) as [Family, number][]).map(([f, t]) => `${f} ${t.toFixed(2)}`).join('  ')}  | fastest ${sorted.slice(0, 4).map((x) => `${x.g} ${x.t.toFixed(2)}`).join(', ')}`);
    }
  }
  console.log(`the times to kill (s) someone in a helmet, aiming at the chest, the recoil pulled against, each family's best:\n${rows.join('\n')}`);
  const at = (k: string) => best.get(k)!;
  // Up close a shotgun is as quick as anything (one shot), and quicker than a rifle.
  assert.ok(at('3').shotgun <= Math.min(...Object.values(at('3'))) + 1e-9, 'a shotgun not the best at 3 m');
  assert.ok(at('3').shotgun < at('3').rifle, 'a rifle as quick as a shotgun at 3 m');
  // On the run, a sub-machine gun or a shotgun beats the rifles and the sniper's rifles.
  assert.ok(Math.min(at('5r').smg, at('5r').shotgun) < Math.min(at('5r').rifle, at('5r').sniper), 'running, the rifles win');
  // In the middle, a rifle beats the sub-machine guns, the shotguns and the pistols.
  for (const d of ['20', '40']) for (const f of ['smg', 'shotgun', 'pistol'] as Family[]) assert.ok(at(d).rifle < at(d)[f], `${f} as quick as a rifle at ${d} m`);
  // Far off, a sniper's rifle beats everything.
  assert.ok(at('80').sniper < Math.min(at('80').rifle, at('80').smg, at('80').pistol, at('80').heavy), 'the sniper not the best at 80 m');
});

test("recoil: an AK-47's spray climbs, the same every time, and pulling against it keeps it on the mark", () => {
  // Kicks are the same for the same shot.
  assert.deepEqual(kickOf(GUNS.ak47.recoil, 7), kickOf(GUNS.ak47.recoil, 7));
  assert.deepEqual(kickOf(GUNS.ak47.recoil, 0), { x: 0, y: 0 });
  const spray = (pull: boolean) => {
    const s = new Soldier('a');
    s.arm(kitOf('ak47'), 0);
    const aim = v3(1, 0, 0);
    const ups: number[] = [];
    const across: number[] = [];
    for (let t = 0; ups.length < 15; t += DT * 1000) {
      s.step(DT, t);
      const ev = fire(s, v3(0, 1.65, 0), pull ? kicked(aim, { x: -s.punch.x, y: -s.punch.y }) : aim, still, t, [], open, 1);
      if (!ev) continue;
      ups.push(Math.asin(ev.dy) / deg);
      across.push(Math.atan2(ev.dz, ev.dx) / deg);
    }
    return { ups, across };
  };
  const free = spray(false);
  assert.ok(free.ups[0] < 0.01, 'the first bullet where it aims');
  assert.ok(free.ups[9] - free.ups[0] > 3, `the 10th bullet only ${(free.ups[9] - free.ups[0]).toFixed(2)}° over the first`);
  assert.ok(Math.max(...free.across.slice(10)) - Math.min(...free.across.slice(10)) > 1, 'no sway once it is up');
  const pulled = spray(true);
  assert.ok(Math.max(...pulled.ups.map(Math.abs)) < 0.1 && Math.max(...pulled.across.map(Math.abs)) < 0.1, 'pulled against, still off the mark');
  console.log(`an AK-47's spray, bullet by bullet, degrees up: ${free.ups.map((u) => u.toFixed(1)).join(' ')}; across: ${free.across.map((u) => u.toFixed(1)).join(' ')}`);
  // Left alone, it comes back down.
  const s = new Soldier('a');
  s.arm(kitOf('ak47'), 0);
  for (let t = 0; t < 1000; t += DT * 1000) {
    s.step(DT, t);
    fire(s, v3(0, 1.65, 0), v3(1, 0, 0), still, t, [], open, 1);
  }
  for (let t = 1000; t < 3000; t += DT * 1000) s.step(DT, t);
  assert.ok(s.spray === 0 && s.punch.y === 0, 'the kick never came back');
});

test('spread: running with a rifle is far worse than standing; a counter-strafe stops you in a moment, letting go more slowly', () => {
  const s = new Soldier('a');
  s.arm(kitOf('ak47'), 0);
  const top = GUNS.ak47.speed;
  const stand = spreadOf(s, still, 0);
  const run = spreadOf(s, { speed: top, air: false }, 0);
  const slow = spreadOf(s, { speed: top * 0.33, air: false }, 0);
  const air = spreadOf(s, { speed: 0, air: true }, 0);
  s.crouch = true;
  const crouch = spreadOf(s, still, 0);
  assert.ok(run > stand * 10, `running ${(run / deg).toFixed(2)}°, standing ${(stand / deg).toFixed(2)}°`);
  assert.equal(slow, stand, 'under a third of the top speed is as good as standing');
  assert.ok(air > run && crouch < stand);
  // On the Rua do Fujacal, running down it with an AK-47, then letting go, or pressing back.
  const stop = (back: boolean) => {
    const w = new Walker(F.ground, v3(176, ground.groundAt(176, 832), 832), Math.atan2(813 - 832, 169.5 - 176));
    w.fighter = top;
    for (let k = 0; k < 120; k++) w.step({ ...STAND, fwd: 1, run: true }, DT);
    const was = w.speed();
    let k = 0;
    for (; k < 120 && w.speed() > top * 0.34; k++) w.step({ ...STAND, fwd: back ? -1 : 0, run: true }, DT);
    return { was, s: k * DT };
  };
  const let_go = stop(false);
  const counter = stop(true);
  console.log(`an AK-47's cone: standing ${(stand / deg).toFixed(2)}°, crouched ${(crouch / deg).toFixed(2)}°, running ${(run / deg).toFixed(2)}°, in the air ${(air / deg).toFixed(2)}°; from ${let_go.was.toFixed(2)} m/s to a third of it: letting go ${let_go.s.toFixed(3)} s, a counter-strafe ${counter.s.toFixed(3)} s`);
  assert.ok(let_go.was > top * 0.95, `ran at ${let_go.was.toFixed(2)} m/s`);
  assert.ok(counter.s <= 0.08, `a counter-strafe took ${counter.s.toFixed(3)} s`);
  assert.ok(let_go.s <= 0.22 && let_go.s > counter.s, `letting go took ${let_go.s.toFixed(3)} s`);
});

test("the scope: the AWP's cone wide without it, tiny once it's settled", () => {
  const s = new Soldier('a');
  s.arm(kitOf('awp'), 0);
  const sc = GUNS.awp.scope!;
  const noscope = spreadOf(s, still, 0) / deg;
  s.zoom(100);
  assert.equal(s.scope, 1);
  const rising = spreadOf(s, still, 100 + sc.settle - 1) / deg;
  const settled = spreadOf(s, still, 100 + sc.settle) / deg;
  assert.ok(noscope >= 4, `unscoped ${noscope}°`);
  assert.equal(rising, noscope, 'the scope not yet up');
  assert.ok(settled <= 0.02, `scoped ${settled}°`);
  // Running scoped, its cone's wide again; and a shot works the bolt, the scope down till it's done.
  assert.ok(spreadOf(s, { speed: sc.speed, air: false }, 1000) / deg > 3);
  const ev = fire(s, v3(0, 1.65, 0), v3(1, 0, 0), still, 1000, [], open, 3)!;
  assert.ok(ev);
  assert.deepEqual([s.scope, s.rezoom], [0, 1], 'the bolt took the scope down');
  s.step(DT, 1000 + GUNS.awp.every);
  assert.equal(s.scope, 1, 'back up once the bolt is worked');
  // The zoom steps on and off.
  s.zoom(5000);
  assert.equal(s.scope, 2);
  s.zoom(5100);
  assert.equal(s.scope, 0);
});

test('switching weapons: each drawn before it fires, and its draw time', () => {
  const s = new Soldier('a');
  s.arm({ primary: 'awp', secondary: 'deagle', nades: ['he', 'flash', 'flash'], armour: 2 }, 0);
  assert.equal(s.hand, 'awp');
  assert.ok(s.ready(0), 'armed with it drawn');
  for (const [n, w] of [[2, 'deagle'], [3, 'knife'], [4, 'he'], [4, 'flash'], [1, 'awp']] as const) {
    const t = 10000 * n + (w === 'flash' ? 5000 : 0);
    assert.ok(s.slot(n, t), `slot ${n}`);
    assert.equal(s.hand, w);
    assert.equal(s.drawnAt, t + drawOf(w));
    assert.ok(!s.ready(t + drawOf(w) - 1), `${w} ready before it is drawn`);
    assert.ok(s.ready(t + drawOf(w)), `${w} not ready once drawn`);
  }
  assert.equal(drawOf('awp'), GUNS.awp.draw);
  // The wheel turns round them, and taking out what's in hand does nothing.
  assert.ok(s.cycle(1, 90000));
  assert.equal(s.hand as string, 'deagle');
  assert.ok(!s.select('deagle', 91000));
});

test("a shotgun's reload: a shell at a time, and a shot stops it", () => {
  const s = new Soldier('a');
  s.arm(kitOf('nova'), 0);
  let t = 0;
  for (let k = 0; k < 3; k++, t += GUNS.nova.every) assert.ok(fire(s, v3(0, 1.65, 0), v3(1, 0, 0), still, t, [], open, k));
  assert.equal(s.mag, 5);
  assert.ok(s.reload(t));
  for (let k = 0; k <= 2 * GUNS.nova.reload; k += 10) s.step(0.01, t + k);
  assert.equal(s.mag, 7, 'two shells in');
  assert.ok(s.reloading, 'still reloading');
  t += 2 * GUNS.nova.reload + 100;
  assert.ok(s.ready(t), 'a loaded shotgun fires mid-reload');
  assert.ok(fire(s, v3(0, 1.65, 0), v3(1, 0, 0), still, t, [], open, 9));
  assert.equal(s.mag, 6);
  assert.ok(!s.reloading, 'the shot stopped the reload');
  // A rifle's magazine all at once.
  const r = new Soldier('r');
  r.arm(kitOf('ak47'), 0);
  fire(r, v3(0, 1.65, 0), v3(1, 0, 0), still, 0, [], open, 1);
  assert.ok(r.reload(100));
  r.step(DT, 100 + GUNS.ak47.reload);
  assert.equal(r.mag, 30);
  assert.equal(r.reserve, 89);
});

test("the knife: worth more in someone's back", () => {
  const cut = (heavy: boolean, back: boolean) => {
    const s = new Soldier('a');
    s.arm(kitOf('ak47'), 0);
    s.slot(3, 0);
    const t = 1000;
    // They stand 1.2 m off, their back to the blade (facing +x, as it goes) or facing it.
    const b: Body = { id: 'b', x: 1.2, y: 0, z: 0, yaw: back ? 0 : Math.PI };
    const eye = v3(0, 1.65, 0);
    const c = chestOf(b);
    const ev = stab(s, eye, norm(v3(c.x - eye.x, c.y - eye.y, c.z - eye.z)), heavy, t, [b], open)!;
    const v = victim();
    for (const h of ev.hits) v.hurt(h, 'knife', t);
    return v;
  };
  assert.ok(!cut(true, true).alive, 'a stab in the back');
  assert.ok(cut(true, false).alive && cut(true, false).health < 60, 'a stab from the front');
  assert.ok(cut(false, false).health > cut(false, true).health, 'a slash in the back worth more');
  // Out of reach, nothing.
  const s = new Soldier('a');
  s.arm(kitOf('ak47'), 0);
  s.slot(3, 0);
  const ev = stab(s, v3(0, 1.65, 0), v3(1, 0, 0), false, 1000, [{ id: 'b', x: 3, y: 0, z: 0 }], open)!;
  assert.equal(ev.hits.length, 0);
});

test('where a shot struck someone, for its tracer and the puff, as each browser draws them', () => {
  // The Nova at someone 5 m off, two others beside them: every pellet that stopped struck the one it
  // hit, on its way, at their body; none of those it missed.
  const s = new Soldier('a');
  s.arm(kitOf('nova'), 0);
  const b: Body = { id: 'b', x: 5, y: 0, z: 0 };
  const ev = fire(s, v3(0, 1.65, 0), norm(v3(5, 1.1 - 1.65, 0)), still, 0, [b, { id: 'c', x: 5, y: 0, z: 3 }], open, 777)!;
  const n = [...Array(GUNS.nova.pellets).keys()].filter((k) => ev.stop & (1 << k)).length;
  assert.ok(n > 3, `${n} pellets stopped`);
  const at = struck(ev, (id) => (id === 'b' ? v3(b.x, b.y, b.z) : id === 'c' ? v3(5, 0, 3) : null));
  assert.equal(at.length, n);
  for (const p of at) {
    assert.equal(p.v, 'b');
    assert.ok(Math.abs(p.p.x - 5) < 0.5 && Math.abs(p.p.z) < 0.6 && p.p.y > 0.4 && p.p.y < 1.8, `(${p.p.x.toFixed(2)}, ${p.p.y.toFixed(2)}, ${p.p.z.toFixed(2)})`);
    assert.ok(p.d.x > 0.9, 'its way, from the shooter');
  }
  assert.deepEqual(struck(ev, () => null), []);
});

test('the scores: kills, deaths and headshots, and no kill for a team-mate or yourself', () => {
  const board: Score[] = [];
  const teams: Record<string, number> = { a: 0, b: 1, c: 0 };
  const add = (id: string) => {
    const s: Score = { id, kills: 0, deaths: 0, hs: 0, team: teams[id] };
    board.push(s);
    return s;
  };
  tally(board, { victim: 'b', by: 'a', head: true }, add);
  tally(board, { victim: 'b', by: 'a', head: false }, add);
  tally(board, { victim: 'a', by: 'b', head: false }, add);
  tally(board, { victim: 'c', by: 'a', head: true }, add); // a team-mate
  tally(board, { victim: 'a', by: 'a', head: false }, add); // a fall, a grenade of its own
  board.sort(byKills);
  assert.deepEqual(board.map((e) => [e.id, e.kills, e.deaths, e.hs]), [['a', 2, 2, 1], ['b', 1, 2, 0], ['c', 0, 1, 0]]);
});

test("a fighter's flags: what a snapshot says of them, and back", () => {
  const s = new Soldier('a');
  s.arm({ primary: 'awp', secondary: 'glock', nades: [], armour: 2 }, 0);
  s.team = 1;
  s.crouch = true;
  s.zoom(0);
  const f = fighterOf(s.flags(100));
  assert.deepEqual(f, { armed: true, down: false, weapon: 'awp', scoped: true, reloading: false, safe: true, crouch: true, team: 1 });
  s.scope = 0;
  s.crouch = false;
  s.team = 0;
  s.slot(2, 3000);
  fire(s, v3(0, 1.65, 0), v3(1, 0, 0), still, 5000, [], open, 1);
  s.reload(5200);
  assert.deepEqual(fighterOf(s.flags(5300)), { armed: true, down: false, weapon: 'glock', scoped: false, reloading: true, safe: false, crouch: false, team: 0 });
  s.hurt({ b: 0, h: 500, l: 0 }, 'deagle', 6000);
  assert.equal(fighterOf(s.flags(6000)).down, true);
});

test('coming back: after RESPAWN, whole, safe a moment, at a spawn the others can not see', () => {
  const pa = v3(176, ground.groundAt(176, 832), 832);
  const s = new Soldier('b');
  s.arm(START, 0);
  s.hurt({ b: 0, h: 500, l: 0 }, 'ak47', SAFE + 1);
  assert.ok(!s.alive);
  const t = SAFE + 1 + RESPAWN;
  const sp = pickSpawn(F, [{ id: 'a', ...pa }]);
  assert.ok(!clear(F.ground, eyeOf(pa), eyeOf(sp)), 'A sees where B comes back');
  s.arm(START, t);
  assert.equal(s.health, 100);
  assert.equal(s.hurt({ b: 50, h: 0, l: 0 }, 'ak47', t + SAFE / 2).lost, 0, 'hurt while safe');
  s.hurt({ b: 0, h: 0, l: 50 }, 'ak47', t + SAFE + 1);
  assert.equal(s.health, 50);
  // No health back with time.
  for (let k = 0; k < 12 / DT; k++) s.step(DT, t + SAFE + 1 + k * DT * 1000);
  assert.equal(s.health, 50);
});

test("the arenas' edges: a walker can't leave one, at its gates or along it", () => {
  let out = 0;
  let walks = 0;
  let gates = 0;
  for (const a of world.arenas) {
    const A = a.id === 'topo' ? F : field(ground, a);
    const targets = [...A.gates.map((g) => ({ x: g.x + Math.cos(g.heading) * 15, z: g.z + Math.sin(g.heading) * 15, from: g })), ...A.rails.filter((r) => r.length > 6).map((r) => ({ x: r[Math.floor(r.length / 2)].x, z: r[Math.floor(r.length / 2)].z, from: null }))];
    gates += A.gates.length;
    for (const tg of targets) {
      // From the nearest spawn, or for a gate from 8 m inside it, running straight at it and past.
      const start = tg.from ? { x: tg.from.x - Math.cos(tg.from.heading) * 8, z: tg.from.z - Math.sin(tg.from.heading) * 8 } : A.spawns.reduce((p, q) => (Math.hypot(q.x - tg.x, q.z - tg.z) < Math.hypot(p.x - tg.x, p.z - tg.z) ? q : p));
      if (!world.inArena(a.id, start.x, start.z) || ground.roomAt(start.x, start.z)) continue;
      const w = new Walker(A.ground, v3(start.x, ground.groundAt(start.x, start.z) + 0.3, start.z), Math.atan2(tg.z - start.z, tg.x - start.x));
      w.bound = A.inside;
      walks++;
      for (let i = 0; i < 20 / DT; i++) {
        w.step({ ...STAND, fwd: 1, run: true }, DT);
        if (!world.inArena(a.id, w.p.x, w.p.z)) {
          out++;
          break;
        }
      }
    }
  }
  console.log(`the arenas' edges: ${walks} runs at them, at ${gates} gates and stretches of railing; out ${out}`);
  assert.ok(walks > 30);
  assert.equal(out, 0);
});

test("moving as in Counter-Strike: a hop on the landing keeps its speed, a late one loses it, strafing in the air gains it, a jump held doesn't hop again", () => {
  const top = GUNS.ak47.speed;
  // Running down the Rua do Fujacal with an AK-47 for a second.
  const runner = () => {
    const w = new Walker(F.ground, v3(176, ground.groundAt(176, 832), 832), Math.atan2(813 - 832, 169.5 - 176));
    w.fighter = top;
    for (let k = 0; k < 120; k++) w.step({ ...STAND, fwd: 1, run: true }, DT);
    return w;
  };
  // A hop, then on, holding W, till it lands, and `late` steps more on the ground before the next.
  const hop = (w: Walker, late: number, strafe: boolean) => {
    w.step({ ...STAND, fwd: 1, run: true, jump: true }, DT);
    let k = 0;
    while (!w.grounded && k++ < 200) {
      if (strafe) {
        // Strafing right, the view turned with the way it goes: the strafe all but square across it.
        const way = Math.atan2(w.v.z, w.v.x);
        w.yaw = way + Math.acos(0.2 / w.speed()) - Math.PI / 2;
        w.step({ ...STAND, side: 1, run: true }, DT);
      } else w.step({ ...STAND, fwd: 1, run: true }, DT);
    }
    for (let j = 0; j < late; j++) w.step({ ...STAND, fwd: 1, run: true }, DT);
    return w.speed();
  };
  const timed = runner();
  const v0 = timed.speed();
  hop(timed, 0, false);
  const kept = hop(timed, 0, false);
  const lateW = runner();
  hop(lateW, 0, true);
  const fast = lateW.speed();
  const slowed = hop(lateW, 6, false);
  const strafed = runner();
  const gained = hop(strafed, 0, true);
  // A jump held: one hop, then on the ground.
  const held = runner();
  held.step({ ...STAND, fwd: 1, run: true, jump: true }, DT);
  let up = 0;
  for (let k = 0; k < 240; k++) {
    held.step({ ...STAND, fwd: 1, run: true, jump: false }, DT);
    if (!held.grounded) up++;
  }
  console.log(`running ${v0.toFixed(2)} m/s; two hops on the landing ${kept.toFixed(2)}; a strafed hop ${gained.toFixed(2)}; from ${fast.toFixed(2)}, a hop 50 ms late ${slowed.toFixed(2)}`);
  assert.ok(v0 > top * 0.97);
  assert.ok(kept > v0 * 0.98, 'a hop on the landing keeps its speed');
  assert.ok(gained > v0 * 1.1, 'strafing in the air gains speed');
  assert.ok(slowed < fast * 0.85, 'a late hop loses speed to the ground');
  assert.ok(held.grounded && up < 100, 'a jump held hops once');
});
