import { loadWorld } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newCar, stepCar, trackGround, TURBO2 } from '../src/car/car.ts';
import { Arena, type Rules } from '../src/game/arena.ts';
import { botControls, newBrain, type Brain } from '../src/game/bot.ts';
import { boxRows, itemOdds, ITEMS, rollItem, type ItemEv, type ItemKind } from '../src/game/items.ts';
import { NO_CONTROLS, Racer, type Controls } from '../src/game/racer.ts';
import { LAYOUT } from '../src/track/layout.ts';
import { buildTrack, surfacePoint, type Track } from '../src/track/track.ts';
import { TRACKS } from '../src/tracks.ts';
import { worldGround } from '../src/world/ground.ts';
import { raceGround } from '../src/world/race.ts';

// The items and the handling are tested on the first track, kept for reference: the places these
// tests put cars (down the Avenida's straight) were picked on it. The bots race each of the game's
// tracks (tracks.ts), on the world's ground with the race's walls, as the game runs it.
const track = buildTrack(LAYOUT);
const roam = worldGround(await loadWorld({ open: true }));
const raced = TRACKS.map(({ course }) => {
  const on = buildTrack(course.points, course.ramps);
  return { course, on, race: raceGround(roam, on, course).ground };
});
const N = track.samples.length;
const DT = 1 / 120;
const RACE: Rules = { mode: 'race', laps: 2, items: true, catchUp: true };

function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

// An arena with the given racers; events made by one are applied (and recorded) as if sent.
function arena(rules: Rules, racers: Racer[], on: Track = track): { a: Arena; events: ItemEv[] } {
  const a = new Arena(on, rules);
  const events: ItemEv[] = [];
  a.send = (ev) => events.push(ev);
  a.locals = racers;
  a.t = 0;
  a.started = true;
  for (const r of racers) a.cars.set(r.id, r.info());
  return { a, events };
}

function tick(a: Arena, racers: Racer[], ctl: (r: Racer) => Controls): void {
  a.t += DT * 1000;
  for (const r of racers) {
    r.step(a, ctl(r), DT);
    a.cars.set(r.id, r.info());
  }
  a.prune();
}

// A racer placed at sample i, driving straight at a speed.
function at(id: string, i: number, speed: number, lat = 0): Racer {
  const r = new Racer(track, id, id, true, 0);
  r.car = newCar(track, i, speed);
  r.car.p = surfacePoint(track.samples[i], lat, 0.01);
  r.car.lat = lat;
  r.run.nextCp = 1; // past the line, so P is just the sample
  return r;
}

const cruise = (r: Racer): Controls => ({ ...NO_CONTROLS, throttle: 1, steer: 0 });

test('item odds: the leader gets small stuff, the back the big guns', () => {
  const front = itemOdds(0);
  const back = itemOdds(1);
  for (const k of ['foguete', 'martelinho', 'filigrana', 'pombo'] as ItemKind[]) assert.equal(front[k] ?? 0, 0, `leader can get ${k}`);
  assert.ok((back.foguete ?? 0) > 0 && (back.filigrana ?? 0) > 0);
  assert.equal(back.pudim ?? 0, 0);
  const rand = seeded(3);
  const seen = new Set<ItemKind>();
  for (let i = 0; i < 3000; i++) seen.add(rollItem(i / 3000, rand));
  assert.deepEqual([...seen].sort(), (Object.keys(ITEMS) as ItemKind[]).sort(), 'every item turns up somewhere');
});

test('on the grid, waiting for the green light, nobody moves, even with the throttle down', () => {
  const racers = [0, 1, 2, 3].map((k) => new Racer(track, `r${k}`, `r${k}`, true, k));
  const { a } = arena(RACE, racers);
  a.started = false;
  const before = racers.map((r) => ({ ...r.car.p }));
  for (let i = 0; i < 4 / DT; i++) tick(a, racers, cruise);
  racers.forEach((r, k) => {
    const moved = Math.hypot(r.car.p.x - before[k].x, r.car.p.z - before[k].z);
    assert.ok(moved < 0.05, `${r.id} moved ${moved.toFixed(2)} m on the grid`);
  });
});

test('progress counts laps, and is negative on the grid', () => {
  const r = new Racer(track, 'me', 'me', false, 3);
  assert.ok(r.P < 0 && r.P > -40, `P on the grid ${r.P}`);
  r.run.laps = 2;
  r.run.nextCp = 3;
  r.car = newCar(track, 100);
  assert.equal(r.P, 2 * N + 100);
});

test('a bola rolls ahead and spins the car in front; a guarda-chuva keeps one off', () => {
  for (const shielded of [false, true]) {
    const me = at('me', 150, 30);
    const them = at('them', 190, 0);
    them.shield = shielded;
    const { a, events } = arena(RACE, [me, them]);
    me.item = { kind: 'bola', uses: 1 };
    tick(a, [me, them], (r) => (r === me ? { ...cruise(r), use: true } : NO_CONTROLS));
    assert.equal(events.filter((e) => e.k === 'proj').length, 1);
    for (let i = 0; i < 240; i++) tick(a, [me, them], (r) => (r === me ? NO_CONTROLS : NO_CONTROLS));
    const hit = events.find((e) => e.k === 'hit');
    assert.ok(hit && hit.k === 'hit' && hit.victim === 'them');
    assert.equal(hit.blocked, shielded);
    assert.equal(them.notes.some((n) => n.k === 'hit'), !shielded, 'spun');
    assert.equal(them.notes.some((n) => n.k === 'blocked'), shielded, 'blocked');
    assert.equal(a.projs.size, 0, 'the ball is gone');
  }
});

test('a guarda-chuva opens as soon as you get it, and leaves the slot free for the next box', () => {
  const box = boxRows(track)[0];
  const me = at('me', box.i - 50, 20, box.lat);
  const { a } = arena(RACE, [me]);
  me.roll = DT / 2;
  me.rollKind = 'guarda';
  tick(a, [me], cruise);
  assert.ok(me.shield, 'on at once');
  assert.equal(me.item, null, 'the slot is free');
  assert.ok(me.notes.some((n) => n.k === 'use' && n.kind === 'guarda'));
  const held = () => me.item; // read afresh: the assertions above narrowed me.item to null
  for (let i = 0; i < 6 / DT && !held(); i++) tick(a, [me], cruise);
  const got = held();
  assert.ok(got, 'picked up another item');
  assert.notEqual(got.kind, 'guarda', 'and not a second umbrella');
  tick(a, [me], (r) => ({ ...cruise(r), use: true }));
  assert.ok(me.notes.some((n) => n.k === 'use' && n.kind !== 'guarda'), 'and used it');
  assert.ok(me.shield, 'with the umbrella still open');
});

test('the filigrana smashes what it meets', () => {
  const me = at('me', 150, 0);
  const { a, events } = arena(RACE, [me]);
  me.gold = 5;
  a.apply({ k: 'haz', id: 'p1', kind: 'pudim', owner: 'x', t0: 0, idx: 152, lat: 0 });
  for (let i = 0; i < 240; i++) tick(a, [me], cruise);
  const hit = events.find((e) => e.k === 'hit');
  assert.ok(hit && hit.k === 'hit' && hit.victim === null);
  assert.equal(me.spin, 0);
  assert.equal(a.hazards.size, 0);
});

test('the pombo-correio finds the car ahead; the foguete finds the leader and catches those near', () => {
  const back = at('back', 100, 0);
  const mid = at('mid', 400, 0);
  const lead = at('lead', 700, 0);
  const near = at('near', 694, 0, 3);
  const all = [back, mid, lead, near];
  const { a, events } = arena(RACE, all);
  back.item = { kind: 'pombo', uses: 1 };
  tick(a, all, (r) => (r === back ? { ...NO_CONTROLS, use: true } : NO_CONTROLS));
  const pigeon = events.find((e) => e.k === 'proj');
  assert.ok(pigeon && pigeon.k === 'proj' && pigeon.target === 'mid');
  for (let i = 0; i < 600 && mid.spin === 0; i++) tick(a, all, () => NO_CONTROLS);
  assert.ok(mid.spin > 0, 'the pigeon got the car ahead');

  back.item = { kind: 'foguete', uses: 1 };
  tick(a, all, (r) => (r === back ? { ...NO_CONTROLS, use: true } : NO_CONTROLS));
  for (let i = 0; i < 1200 && lead.spin === 0; i++) tick(a, all, () => NO_CONTROLS);
  assert.ok(lead.spin > 0, 'the rocket got the leader');
  assert.ok(events.some((e) => e.k === 'boom'));
  assert.ok(near.spin > 0, 'and the car beside them');
  assert.equal(back.spin, 0);
});

test('the martelinho shrinks only those ahead', () => {
  const back = at('back', 100, 0);
  const behind = at('behind', 60, 0);
  const ahead = at('ahead', 500, 0);
  const all = [back, behind, ahead];
  const { a } = arena(RACE, all);
  back.item = { kind: 'martelinho', uses: 1 };
  tick(a, all, (r) => (r === back ? { ...NO_CONTROLS, use: true } : NO_CONTROLS));
  assert.ok(ahead.shrink > 0);
  assert.equal(behind.shrink, 0);
  assert.equal(back.shrink, 0);
});

test('a long drift, let go, earns a mini-turbo', () => {
  const c = newCar(track, 150, 30);
  let turbo = 0;
  // Weave gently down the Avenida, drifting all the way.
  for (let i = 0; i < (TURBO2 + 0.3) / DT; i++) stepCar(c, { throttle: 1, brake: 0, steer: i % 60 < 30 ? 0.35 : -0.35, drift: true }, trackGround(track), DT);
  stepCar(c, { throttle: 1, brake: 0, steer: 0, drift: false }, trackGround(track), DT);
  turbo = c.turbo;
  assert.equal(turbo, 2);
  assert.ok(c.boost > 0);
});

test('the slipstream builds up behind someone, and wears off slowly when you pull out to pass', () => {
  const lead = at('lead', 120, 33);
  const me = at('me', 106, 33);
  const solo = at('solo', 106, 33, 4); // the same car with nobody to follow, on its own track
  const { a } = arena({ ...RACE, items: false, catchUp: false }, [lead, me]);
  const { a: alone } = arena({ ...RACE, items: false, catchUp: false }, [solo]);
  const speed = (r: Racer) => Math.hypot(r.car.v.x, r.car.v.z);
  const both = () => {
    tick(a, [lead, me], cruise);
    alone.t = a.t;
    tick(alone, [solo], cruise);
  };
  both();
  assert.ok(me.slip > 0 && me.slip < 0.05, `it starts gently: ${me.slip}`);
  assert.ok(me.notes.some((n) => n.k === 'slip'), 'with a whoosh');
  assert.equal(solo.slip, 0);
  for (let i = 0; i < 0.5 / DT; i++) both();
  const half = me.slip;
  for (let i = 0; i < 1 / DT; i++) both();
  assert.ok(half < 0.5 && me.slip > 0.85, `and builds up over a second or so: ${half.toFixed(2)}, then ${me.slip.toFixed(2)}`);
  assert.ok(speed(me) > speed(solo) + 1.5, `pulling: ${speed(me).toFixed(1)} vs ${speed(solo).toFixed(1)} m/s`);
  // Pull out to pass: the pull fades over a few seconds, and the speed bleeds away gently.
  me.car.p = surfacePoint(track.samples[me.car.idx], 4, 0.01);
  let worst = 0;
  for (let i = 0; i < 1 / DT; i++) {
    const v = speed(me);
    both();
    worst = Math.max(worst, (v - speed(me)) / DT);
  }
  assert.ok(me.slip > 0.5 && speed(me) > speed(solo) + 2, `still carried a second after pulling out: slip ${me.slip.toFixed(2)}`);
  assert.ok(worst < 3, `slowing down by at most 3 m/s², not braking: ${worst.toFixed(1)}`);
  for (let i = 0; i < 3.5 / DT; i++) both();
  assert.equal(me.slip, 0, 'and then it wears off');
});

test('catch-up: far behind the leader, a car goes faster', () => {
  const top = (gap: number) => {
    const lead = at('lead', 100 + gap, 0);
    const me = at('me', 100, 0);
    const { a } = arena({ ...RACE, items: false }, [lead, me]);
    let best = 0;
    for (let i = 0; i < 6 / DT; i++) {
      tick(a, [me], cruise);
      a.cars.set('lead', { ...lead.info(), P: me.P + gap }); // keep the gap
      best = Math.max(best, Math.hypot(me.car.v.x, me.car.v.z));
    }
    return best;
  };
  assert.ok(top(800) > top(0) * 1.03, `${top(800)} vs ${top(0)}`);
});

for (const { course, on, race } of raced) {
  test(`eight bots race a lap of ${course.name} with items: everyone finishes, items fly, places change`, () => {
    const racers = Array.from({ length: 8 }, (_, k) => new Racer(on, `bot${k}`, `Bot ${k}`, true, k, race));
    const brains = new Map<string, Brain>(racers.map((r, k) => [r.id, newBrain(seeded(k + 1))]));
    const { a, events } = arena({ ...RACE, laps: 1 }, racers, on);
    const leaders = new Set<string>();
    let respawns = 0;
    for (let i = 0; i < 420 / DT && racers.some((r) => r.fin === null); i++) {
      tick(a, racers, (r) => botControls(r, brains.get(r.id)!, a, DT));
      if (i % 120 === 0) leaders.add(a.leader()!.id);
      for (const r of racers) {
        respawns += r.notes.filter((n) => n.k === 'respawn').length;
        r.notes = [];
      }
    }
    const fins = racers.map((r) => r.fin);
    const kinds = new Set(events.map((e) => (e.k === 'proj' ? e.kind : e.k)));
    const hits = events.filter((e) => e.k === 'hit' && !e.blocked).length;
    console.log(`${course.name}: finish ${fins.map((f) => (f === null ? 'DNF' : (f / 1000).toFixed(1))).join(' ')} s; events ${[...kinds].join(',')}; ${hits} hits; ${leaders.size} leaders; ${respawns} respawns`);
    assert.ok(fins.every((f) => f !== null), 'everyone finishes');
    assert.ok(hits >= 3, 'items hit people');
    assert.ok(leaders.size >= 2, 'the lead changes');
    const spread = Math.max(...(fins as number[])) - Math.min(...(fins as number[]));
    assert.ok(spread < 60000, `finishes spread over ${spread} ms: catch-up keeps it close`);
  });
}
