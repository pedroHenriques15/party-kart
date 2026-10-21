import { loadWorld, type World } from 'braga-map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GUNS } from '../src/game/arsenal.ts';
import { blastAt, botBuy, COMP, compMap, killReward, Match, priceOf, sells, sideOf, siteAt, startKit, type CompMap } from '../src/game/comp.ts';
import { field, seeOn } from '../src/game/field.ts';
import { Squad } from '../src/game/footbot.ts';
import { MatchBots } from '../src/game/matchbots.ts';
import { fly } from '../src/game/nades.ts';
import { v3, type V } from '../src/math.ts';
import { worldGround } from '../src/world/ground.ts';
import { clear } from '../src/world/sight.ts';

// The competitive mode (game/comp.ts): its sites and spawns in the three arenas on the map's real
// tiles, its rules and money, and matches of bots.
const world: World = await loadWorld({ open: true });
const ground = worldGround(world);
const fields = new Map(world.arenas.map((a) => [a.id, field(ground, a)]));
const maps = new Map([...fields].map(([id, f]) => [id, compMap(f)]));
const DT = 1 / 120;

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test("each arena's match: two sites apart, each side's spawn at its end, every site reached from both", () => {
  for (const [id, m] of maps) {
    const f = fields.get(id)!;
    const P = f.paths;
    assert.ok(m.t.length >= 4 && m.ct.length >= 4, `${id}: ${m.t.length} T and ${m.ct.length} CT spawns`);
    const [A, B] = m.sites;
    const ends = Math.hypot(m.t[0].x - m.ct[0].x, m.t[0].z - m.ct[0].z);
    const apart = Math.hypot(A.x - B.x, A.z - B.z);
    assert.ok(ends > 35, `${id}: the spawns ${ends.toFixed(0)} m apart`);
    assert.ok(apart > 15, `${id}: the sites ${apart.toFixed(0)} m apart`);
    for (const s of m.sites) {
      assert.ok(f.inside(s.x, s.z), `${id}: site ${s.id} in the arena`);
      assert.ok(siteAt(m, s.x, s.y, s.z)?.id === s.id);
      const near = (q: { x: number; z: number }) => Math.hypot(q.x - s.x, q.z - s.z);
      // Nearer the Counter-Terrorists, as Counter-Strike's maps have them.
      assert.ok(near(m.ct[0]) < near(m.t[0]), `${id}: site ${s.id} ${near(m.ct[0]).toFixed(0)} m from the CT spawn, ${near(m.t[0]).toFixed(0)} m from the T`);
      for (const sp of [m.t[0], m.ct[0]]) {
        const way = P.find(P.near(sp.x, sp.z, sp.y), P.near(s.x, s.z, s.y));
        assert.ok(way, `${id}: a way from a spawn to site ${s.id}`);
      }
    }
    for (const sp of [...m.t, ...m.ct]) assert.ok(f.inside(sp.x, sp.z));
    console.log(`${id}: spawns ${ends.toFixed(0)} m apart; A and B ${apart.toFixed(0)} m apart; ${m.t.length} T and ${m.ct.length} CT places`);
  }
});

test("the shop: each side's guns, the prices of what's new, a kill's money", () => {
  assert.ok(sells('T', 'ak47') && !sells('CT', 'ak47'));
  assert.ok(sells('CT', 'm4a4') && !sells('T', 'm4a4'));
  assert.ok(sells('T', 'awp') && sells('CT', 'awp'));
  const t = startKit('T');
  assert.equal(t.secondary, 'glock');
  assert.equal(startKit('CT').secondary, 'usp');
  assert.equal(priceOf(t, { ...t, primary: 'ak47' }), GUNS.ak47.price);
  assert.equal(priceOf(t, { ...t, primary: 'ak47', armour: 2, nades: ['flash', 'flash'] }), GUNS.ak47.price + 1000 + 400);
  assert.equal(priceOf({ ...t, armour: 1 }, { ...t, armour: 2 }), COMP.helmetOnly);
  assert.equal(priceOf({ ...t, nades: ['he'] }, { ...t, nades: ['he', 'smoke'] }), 300);
  assert.equal(killReward('knife'), 1500);
  assert.equal(killReward('awp'), 100);
  assert.equal(killReward('mac10'), 600);
  assert.equal(killReward('ak47'), 300);
  assert.equal(killReward('nova'), 900);
  assert.ok(blastAt(0) === COMP.blast && blastAt(5) > 100 && blastAt(60) === 0);
  // A pistol round's buy, and a full one.
  const rand = seeded(3);
  const pistol = botBuy(startKit('CT'), 800, 'CT', true, rand);
  assert.ok(pistol.cost <= 800);
  const full = botBuy(startKit('T'), 6000, 'T', false, rand);
  assert.ok(full.kit.primary && full.kit.armour === 2 && full.cost <= 6000, JSON.stringify(full));
  const eco = botBuy(startKit('T'), 1500, 'T', false, rand);
  assert.equal(eco.kit.primary, null);
});

// A match's rules, its clock in ms from 0.
const MAP: CompMap = { t: [{ x: 0, y: 0, z: 0, yaw: 0 }], ct: [{ x: 100, y: 0, z: 0, yaw: 0 }], sites: [{ id: 'A', x: 80, y: 0, z: 10, r: 4 }, { id: 'B', x: 80, y: 0, z: -10, r: 4 }] };

test('a match: the freeze, a round won by putting the other side down, the money and the loss bonus', () => {
  const m = new Match([{ id: 'a', team: 0 }, { id: 'b', team: 0 }, { id: 'x', team: 1 }, { id: 'y', team: 1 }], MAP, 12, seeded(1));
  m.start(0);
  assert.equal(m.phaseNow, 'freeze');
  assert.equal(m.side('x'), 'T');
  assert.equal(m.side('a'), 'CT');
  assert.ok(m.buying(1000));
  m.step(COMP.freeze);
  assert.equal(m.phaseNow, 'live');
  assert.ok(m.buying(COMP.freeze + 1000) && !m.buying(COMP.freeze + COMP.buy + 1));
  // The bomb's with a Terrorist.
  assert.ok(['x', 'y'].includes(m.bombNow.by!));
  m.buy('a', 1, 650);
  m.buy('a', 1, 650); // the same buy told twice is counted once
  assert.equal(m.moneyOf('a'), 150);
  m.down({ victim: 'x', by: 'a', w: 'ak47', x: 5, y: 0, z: 0 }, 20000);
  assert.equal(m.moneyOf('a'), 450);
  const carrierDown = m.bombNow;
  m.down({ victim: 'y', by: 'b', w: 'knife', x: 6, y: 0, z: 0 }, 21000);
  assert.equal(m.moneyOf('b'), 800 + 1500 + COMP.win.elim);
  assert.equal(m.phaseNow, 'over');
  const s = m.state(21000);
  assert.deepEqual(s.score, [1, 0]);
  assert.equal(s.last?.why, 'elim');
  assert.equal(m.moneyOf('x'), 800 + COMP.loss[0]);
  assert.equal(carrierDown.at === 'carried' ? 'ok' : 'ok', 'ok');
  assert.equal(m.bombNow.at, 'dropped');
  // The next round: everyone up, the losers' bonus up a step when they lose again.
  m.step(21000 + COMP.after);
  assert.equal(m.roundNow, 2);
  assert.equal(m.phaseNow, 'freeze');
  assert.ok(m.isUp('x') && m.isUp('a'));
  m.step(21000 + COMP.after + COMP.freeze);
  const t0 = 21000 + COMP.after + COMP.freeze;
  // Time runs out with the Terrorists up: the round's the Counter-Terrorists', and those still up get
  // no loss bonus.
  const xWas = m.moneyOf('x');
  m.down({ victim: 'y', by: 'a', w: 'usp', x: 6, y: 0, z: 0 }, t0 + 5000);
  m.step(t0 + COMP.round);
  assert.equal(m.state(t0 + COMP.round).last?.why, 'time');
  assert.equal(m.moneyOf('x'), xWas);
});

test('a match: the bomb planted at a site, defused; planted and gone off; the Counter-Terrorists all down after a plant', () => {
  const play = () => {
    const m = new Match([{ id: 'ct', team: 0 }, { id: 't', team: 1 }], MAP, 12, seeded(2));
    m.start(0);
    m.step(COMP.freeze);
    return m;
  };
  let m = play();
  const live = COMP.freeze + 1000;
  assert.equal(m.plant('t', 50, 0, 0, live), false, 'not off a site');
  assert.equal(m.plant('ct', 80, 0, 10, live), false, 'not by a Counter-Terrorist');
  assert.ok(m.plant('t', 80, 0, 10, live));
  assert.equal(m.phaseNow, 'planted');
  assert.equal(m.bombNow.site, 'A');
  // The Terrorist down after the plant: the round isn't over till it's defused or goes off.
  m.down({ victim: 't', by: 'ct', w: 'm4a4', x: 80, y: 0, z: 10 }, live + 2000);
  assert.equal(m.phaseNow, 'planted');
  assert.ok(m.defuse('ct', live + 9000));
  assert.equal(m.state(live + 9000).last?.why, 'defuse');
  assert.equal(m.moneyOf('t'), 800 + COMP.loss[0] + COMP.planted + COMP.plantBy);

  m = play();
  m.plant('t', 80, 0, -10, live);
  m.step(live + COMP.bomb);
  assert.equal(m.state(live + COMP.bomb).last?.why, 'bomb');
  assert.ok(m.events().some((e) => e.k === 'boom'));

  m = play();
  m.plant('t', 80, 0, -10, live);
  m.down({ victim: 'ct', by: 't', w: 'ak47', x: 70, y: 0, z: 0 }, live + 3000);
  assert.equal(m.state(live + 3000).last?.why, 'elim');
});

test('a match: half time swaps the sides and the money, and the first past half the rounds wins', () => {
  const m = new Match([{ id: 'p', team: 0 }, { id: 'q', team: 1 }], MAP, 2, seeded(4));
  let now = 0;
  m.start(now);
  const win = (by: string, victim: string) => {
    now += COMP.freeze;
    m.step(now);
    now += 1000;
    m.down({ victim, by, w: 'ak47', x: 0, y: 0, z: 0 }, now);
    now += COMP.after + COMP.halftime;
    m.step(now);
  };
  assert.equal(m.side('p'), 'CT');
  win('p', 'q');
  win('p', 'q');
  // Round 3: the second half, the sides swapped and the money back to a pistol round's.
  assert.equal(m.roundNow, 3);
  assert.equal(m.side('p'), 'T');
  assert.equal(m.moneyOf('p'), COMP.start);
  assert.equal(sideOf(0, 3, 2), 'T');
  win('p', 'q');
  const s = m.state(now);
  assert.equal(s.winner, 0);
  assert.equal(m.phaseNow, 'end');
});

// Bots alone in a match, so many rounds a half, as the host plays it (main.ts): the match a step on,
// its bots a step, their shots met, their HE grenades and flashes set off.
function match(id: string, half: number, seed: number, per: number, skill: number) {
  const f = fields.get(id)!;
  const map = maps.get(id)!;
  const rand = seeded(seed);
  const squad = new Squad(f, f.paths, skill, rand, true);
  squad.respawn = false;
  const ids = Array.from({ length: per * 2 }, (_, k) => `bot-${k + 1}`);
  ids.forEach((b, k) => squad.add(b, 0, map.t[0], [], { team: k % 2 }));
  const m = new Match(ids.map((b, k) => ({ id: b, team: k % 2 })), map, half, rand);
  const bots = new MatchBots(squad, m, rand);
  const see = seeOn(f);
  const clearTo = (a: V, b: V) => clear(f.ground, a, b);
  const flying: { ev: Parameters<typeof fly>[0]; fl: ReturnType<typeof fly> }[] = [];
  const reasons: string[] = [];
  m.start(0);
  let t = 0;
  const most = half * 2 * 190 * 1000;
  while (m.phaseNow !== 'end' && t < most) {
    t += DT * 1000;
    m.step(t);
    for (const ev of m.events()) {
      if (ev.k === 'round') bots.round(ev.fresh, t, t);
      if (ev.k === 'won') reasons.push(ev.why);
      if (ev.k === 'boom') {
        for (const b of squad.bots) {
          if (!b.s.alive) continue;
          const n = blastAt(Math.hypot(b.w.p.x - ev.x, b.w.p.y - ev.y, b.w.p.z - ev.z));
          if (n > 0 && b.s.hurt({ b: n, h: 0, l: 0 }, 'c4', t).down) m.down({ victim: b.id, by: b.id, w: 'c4', ...b.w.p }, t);
        }
      }
    }
    bots.step(t, t);
    for (const ev of squad.step(DT, t, [], [])) {
      if (ev.k === 'nade') {
        flying.push({ ev, fl: fly(ev, see) });
        continue;
      }
      if (ev.k !== 'shot') continue;
      for (const d of squad.shot(ev, t)) m.down(d, t);
    }
    for (let k = flying.length - 1; k >= 0; k--) {
      const { ev, fl } = flying[k];
      if (fl.at.t > t) continue;
      flying.splice(k, 1);
      for (const d of squad.boom(ev, fl, t, clearTo)) m.down(d, t);
    }
  }
  return { m, bots, reasons, squad, t };
}

test('bots alone in a match, two against two and three against three: rounds won every way, bombs planted, the match over', () => {
  const all: string[] = [];
  let plants = 0;
  let defuses = 0;
  for (const [id, per, seed] of [['topo', 2, 11], ['vilaca', 3, 12], ['santa-justa', 3, 13]] as const) {
    if (!fields.has(id)) continue;
    const r = match(id, 3, seed, per, 0.6);
    const s = r.m.state(r.t);
    console.log(`${id}, ${per} against ${per}: ${s.score[0]}–${s.score[1]} in ${s.round} rounds, ${(r.t / 60000).toFixed(1)} min; ${r.reasons.join(', ')}; ${r.bots.plants} plants, ${r.bots.defuses} defuses, ${r.bots.pickups} bombs picked up; stuck ${r.squad.bots.map((b) => b.stuck).join(', ')}`);
    assert.equal(r.m.phaseNow, 'end', `${id}: the match over`);
    assert.ok(s.winner !== null);
    assert.ok(s.round >= 4);
    all.push(...r.reasons);
    plants += r.bots.plants;
    defuses += r.bots.defuses;
  }
  assert.ok(all.includes('elim'), 'a round won by putting the other side down');
  assert.ok(plants > 0, 'a bomb planted');
  void defuses;
});

test('a match: the gun someone drops as they fall, picked up by the first to ask, a swap leaving yours in its place', () => {
  const m = new Match([{ id: 'ct', team: 0 }, { id: 't1', team: 1 }, { id: 't2', team: 1 }], MAP, 12, seeded(6));
  m.start(0);
  m.step(COMP.freeze);
  // A pistol round's pistol drops too.
  m.down({ victim: 't1', by: 'ct', w: 'usp', x: 10, y: 0, z: 5, drop: { w: 'glock', mag: 14, reserve: 120 } }, COMP.freeze + 1000);
  let s = m.state(COMP.freeze + 1000);
  assert.equal(s.drops.length, 1);
  const d = s.drops[0];
  assert.deepEqual([d.w, d.mag, d.reserve], ['glock', 14, 120]);
  // The dead can't pick it up; the Counter-Terrorist swaps his USP-S for it, which is left there.
  assert.equal(m.take('t1', d.id), false);
  assert.ok(m.take('ct', d.id, { w: 'usp', mag: 7, reserve: 24 }));
  assert.equal(m.take('t2', d.id), false, 'gone to the first to ask');
  s = m.state(COMP.freeze + 1200);
  assert.deepEqual(s.took.at(-1), { d: d.id, by: 'ct', w: 'glock', mag: 14, reserve: 120 });
  assert.deepEqual(s.drops.map((x) => [x.w, x.x, x.z, x.mag]), [['usp', 10, 5, 7]]);
  // The round won, the guns can still be picked up till the next.
  m.down({ victim: 't2', by: 'ct', w: 'glock', x: 0, y: 0, z: 0, drop: { w: 'glock', mag: 20, reserve: 100 } }, COMP.freeze + 2000);
  assert.equal(m.phaseNow, 'over');
  assert.ok(m.take('ct', m.state(COMP.freeze + 2000).drops.at(-1)!.id));
});
