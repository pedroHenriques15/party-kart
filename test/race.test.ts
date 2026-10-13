import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newCar, stepCar, TURBO2 } from '../src/car/car.ts';
import { Arena, type Rules } from '../src/game/arena.ts';
import { botControls, newBrain, type Brain } from '../src/game/bot.ts';
import { itemOdds, ITEMS, rollItem, type ItemEv, type ItemKind } from '../src/game/items.ts';
import { NO_CONTROLS, Racer, type Controls } from '../src/game/racer.ts';
import { LAYOUT } from '../src/track/layout.ts';
import { buildTrack, surfacePoint } from '../src/track/track.ts';

const track = buildTrack(LAYOUT);
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
function arena(rules: Rules, racers: Racer[]): { a: Arena; events: ItemEv[] } {
  const a = new Arena(track, rules);
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
  for (const k of ['bomb', 'bass', 'gold', 'drone'] as ItemKind[]) assert.equal(front[k] ?? 0, 0, `leader can get ${k}`);
  assert.ok((back.bomb ?? 0) > 0 && (back.gold ?? 0) > 0);
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

test('a disco ball rolls ahead and spins the car in front; a bodyguard blocks one', () => {
  for (const shielded of [false, true]) {
    const me = at('me', 150, 30);
    const them = at('them', 190, 0);
    them.shield = shielded;
    const { a, events } = arena(RACE, [me, them]);
    me.item = { kind: 'disco', uses: 1 };
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

test('gold plating smashes what it meets', () => {
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

test('the paparazzi drone finds the car ahead; the party bomb finds the leader and catches those near', () => {
  const back = at('back', 100, 0);
  const mid = at('mid', 400, 0);
  const lead = at('lead', 700, 0);
  const near = at('near', 694, 0, 3);
  const all = [back, mid, lead, near];
  const { a, events } = arena(RACE, all);
  back.item = { kind: 'drone', uses: 1 };
  tick(a, all, (r) => (r === back ? { ...NO_CONTROLS, use: true } : NO_CONTROLS));
  const drone = events.find((e) => e.k === 'proj');
  assert.ok(drone && drone.k === 'proj' && drone.target === 'mid');
  for (let i = 0; i < 600 && mid.spin === 0; i++) tick(a, all, () => NO_CONTROLS);
  assert.ok(mid.spin > 0, 'the drone got the car ahead');

  back.item = { kind: 'bomb', uses: 1 };
  tick(a, all, (r) => (r === back ? { ...NO_CONTROLS, use: true } : NO_CONTROLS));
  for (let i = 0; i < 1200 && lead.spin === 0; i++) tick(a, all, () => NO_CONTROLS);
  assert.ok(lead.spin > 0, 'the bomb got the leader');
  assert.ok(events.some((e) => e.k === 'boom'));
  assert.ok(near.spin > 0, 'and the car beside them');
  assert.equal(back.spin, 0);
});

test('the bass drop shrinks only those ahead', () => {
  const back = at('back', 100, 0);
  const behind = at('behind', 60, 0);
  const ahead = at('ahead', 500, 0);
  const all = [back, behind, ahead];
  const { a } = arena(RACE, all);
  back.item = { kind: 'bass', uses: 1 };
  tick(a, all, (r) => (r === back ? { ...NO_CONTROLS, use: true } : NO_CONTROLS));
  assert.ok(ahead.shrink > 0);
  assert.equal(behind.shrink, 0);
  assert.equal(back.shrink, 0);
});

test('a long drift, let go, earns a mini-turbo', () => {
  const c = newCar(track, 150, 30);
  let turbo = 0;
  // Weave gently down the Avenida, drifting all the way.
  for (let i = 0; i < (TURBO2 + 0.3) / DT; i++) stepCar(c, { throttle: 1, brake: 0, steer: i % 60 < 30 ? 0.35 : -0.35, drift: true }, track, DT);
  stepCar(c, { throttle: 1, brake: 0, steer: 0, drift: false }, track, DT);
  turbo = c.turbo;
  assert.equal(turbo, 2);
  assert.ok(c.boost > 0);
});

test('following close behind someone gives a slipstream boost', () => {
  const lead = at('lead', 120, 35);
  const me = at('me', 110, 35);
  const { a } = arena({ ...RACE, items: false, catchUp: false }, [lead, me]);
  let slipped = false;
  for (let i = 0; i < 2 / DT; i++) {
    tick(a, [lead, me], cruise);
    if (me.notes.some((n) => n.k === 'slip')) slipped = true;
    me.notes = [];
  }
  assert.ok(slipped);
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

test('eight bots race two laps with items: everyone finishes, items fly, places change', () => {
  const racers = Array.from({ length: 8 }, (_, k) => new Racer(track, `bot${k}`, `Bot ${k}`, true, k));
  const brains = new Map<string, Brain>(racers.map((r, k) => [r.id, newBrain(seeded(k + 1))]));
  const { a, events } = arena(RACE, racers);
  const leaders = new Set<string>();
  let respawns = 0;
  for (let i = 0; i < 260 / DT && racers.some((r) => r.fin === null); i++) {
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
  console.log(`finish ${fins.map((f) => (f === null ? 'DNF' : (f / 1000).toFixed(1))).join(' ')} s; events ${[...kinds].join(',')}; ${hits} hits; ${leaders.size} leaders; ${respawns} respawns`);
  assert.ok(fins.every((f) => f !== null), 'everyone finishes');
  assert.ok(hits >= 3, 'items hit people');
  assert.ok(leaders.size >= 2, 'the lead changes');
  const spread = Math.max(...(fins as number[])) - Math.min(...(fins as number[]));
  assert.ok(spread < 40000, `finishes spread over ${spread} ms: catch-up keeps it close`);
});
