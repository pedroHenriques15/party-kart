// The host's bots in a competitive match (game/comp.ts), playing it as Counter-Strike's bots do: each
// round they buy with their money, as a team (an eco round to buy well the next, a force buy when the
// half or the match is at stake); the Terrorists go to the round's site with the bomb, its carrier
// plants it there when nobody's about, the nearest to a dropped bomb picks it up, and once it's
// planted they hold round it; the Counter-Terrorists hold the sites, half at each, and once it's
// planted go to it, the nearest defusing (quicker with a kit). The fighting is their own (footbot.ts).
// Pure, so the tests play matches of bots.
import { botBuy, COMP, siteAt, startKit, type Match, type Side } from './comp.ts';
import type { Loadout } from './arsenal.ts';
import type { Soldier } from './fight.ts';
import type { FootBot, Squad } from './footbot.ts';

export interface BotInfo {
  kit: boolean; // a defuse kit
  busy: 'plant' | 'defuse' | null;
  seq: number; // its buys, numbered for the match
}

// What a fighter carries, as a loadout.
export const carriedBy = (s: Soldier): Loadout => ({ primary: s.primary, secondary: s.secondary, nades: [...s.nades], armour: s.armour > 0 ? (s.helmet ? 2 : 1) : 0 });

export class MatchBots {
  readonly info = new Map<string, BotInfo>();
  // The Terrorists' site this round.
  target: 'A' | 'B' = 'A';
  // What they did, for the tests: plants, defuses, the bomb picked up.
  plants = 0;
  defuses = 0;
  pickups = 0;
  private readonly squad: Squad;
  private readonly m: Match;
  private readonly rand: () => number;

  constructor(squad: Squad, m: Match, rand: () => number = Math.random) {
    this.squad = squad;
    this.m = m;
    this.rand = rand;
  }

  private infoOf(id: string): BotInfo {
    let i = this.info.get(id);
    if (!i) this.info.set(id, (i = { kit: false, busy: null, seq: 0 }));
    return i;
  }

  // A round begun (at ms now, round ms t): each bot at its place at its side's spawn, with what it had
  // if it lived (else its side's pistol) and what it buys; the site chosen. Frozen till the freeze ends.
  round(fresh: boolean, now: number, t: number): void {
    const m = this.m;
    const s = m.state(now);
    this.target = this.rand() < 0.5 ? 'A' : 'B';
    // A force buy when it has to: the last round of a half, or either side a round from winning.
    const force = s.round === s.half || s.round === s.half * 2 || s.score.some((n) => n === s.half);
    for (const b of this.squad.bots) {
      const side = m.side(b.id);
      if (!side) continue;
      const info = this.infoOf(b.id);
      const lived = b.s.alive && !fresh;
      const had = lived ? carriedBy(b.s) : startKit(side);
      if (!lived) info.kit = false;
      const bought = botBuy({ ...had, kit: info.kit }, m.moneyOf(b.id), side, fresh, this.rand, force);
      info.kit = bought.defuse;
      info.busy = null;
      if (bought.cost > 0) m.buy(b.id, ++info.seq, bought.cost);
      const spawns = side === 'T' ? s.map.t : s.map.ct;
      const sp = spawns[(s.spawns[b.id] ?? 0) % Math.max(1, spawns.length)];
      const armour = b.s.armour;
      if (sp) b.spawn(sp, bought.kit, t);
      // Armour it lived with is as worn as it was, unless it bought more.
      if (lived && bought.kit.armour <= had.armour) b.s.armour = armour;
      b.s.safeUntil = 0;
      b.frozen = true;
      b.busyUntil = 0;
      b.aimFor(null, false);
    }
  }

  // A step at round ms t (ms now by the match's clock): where each wants to be, and the planting,
  // defusing and picking up.
  step(t: number, now: number): void {
    const m = this.m;
    const phase = m.phaseNow;
    const bomb = m.bombNow;
    const map = m.map;
    const site = map.sites.find((x) => x.id === this.target) ?? map.sites[0];
    const up = (side: Side) => this.squad.bots.filter((b) => b.s.alive && m.side(b.id) === side);
    const ts = up('T');
    const cts = up('CT');
    const nearest = (list: FootBot[], p: { x: number; z: number }) => [...list].sort((a, b) => Math.hypot(a.w.p.x - p.x, a.w.p.z - p.z) - Math.hypot(b.w.p.x - p.x, b.w.p.z - p.z))[0];
    for (const b of this.squad.bots) b.frozen = phase === 'freeze' && m.isUp(b.id);
    if (phase === 'freeze' || phase === 'end' || !site) return;
    const fetcher = bomb.at === 'dropped' ? nearest(ts, bomb) : null;
    ts.forEach((b, k) => {
      const info = this.infoOf(b.id);
      if (bomb.at === 'carried' && bomb.by === b.id) {
        b.aimFor({ x: site.x, y: site.y, z: site.z, r: site.r * 0.5 }, true);
        // On the site with nobody about: it plants (and gives up if someone turns up).
        const on = siteAt(map, b.w.p.x, b.w.p.y, b.w.p.z);
        if (info.busy !== 'plant' && on && phase === 'live' && !b.fighting(t)) {
          info.busy = 'plant';
          b.busyUntil = t + COMP.plant;
        } else if (info.busy === 'plant') {
          if (b.fighting(t) && t < b.busyUntil - 200) {
            info.busy = null;
            b.busyUntil = 0;
          } else if (t >= b.busyUntil) {
            info.busy = null;
            if (m.plant(b.id, b.w.p.x, b.w.p.y, b.w.p.z, now)) this.plants++;
          }
        }
      } else if (b === fetcher) {
        b.aimFor({ x: bomb.x, y: bomb.y, z: bomb.z, r: 0.6 }, true);
        if (Math.hypot(b.w.p.x - bomb.x, b.w.p.z - bomb.z) < 1.1 && Math.abs(b.w.p.y - bomb.y) < 1.6 && m.take(b.id, 'c4')) this.pickups++;
      } else if (bomb.at === 'planted') {
        const a = (k * 2.4) % (Math.PI * 2);
        b.aimFor({ x: bomb.x + Math.cos(a) * 6, y: bomb.y, z: bomb.z + Math.sin(a) * 6, r: 2.5 }, false);
      } else b.aimFor({ x: site.x + Math.cos(k * 2.1) * 3, y: site.y, z: site.z + Math.sin(k * 2.1) * 3, r: 3 }, k === 0);
    });
    const defuser = bomb.at === 'planted' ? nearest(cts, bomb) : null;
    cts.forEach((b, k) => {
      const info = this.infoOf(b.id);
      if (bomb.at === 'planted') {
        b.aimFor({ x: bomb.x, y: bomb.y, z: bomb.z, r: b === defuser ? 0.9 : 5 }, b === defuser);
        const close = Math.hypot(b.w.p.x - bomb.x, b.w.p.z - bomb.z) < COMP.reach - 0.3 && Math.abs(b.w.p.y - bomb.y) < 1.5;
        if (b === defuser && close && info.busy !== 'defuse' && !b.fighting(t)) {
          info.busy = 'defuse';
          b.busyUntil = t + (info.kit ? COMP.kitDefuse : COMP.defuse);
        } else if (info.busy === 'defuse') {
          if (b.fighting(t) && t < b.busyUntil - 200) {
            info.busy = null;
            b.busyUntil = 0;
          } else if (t >= b.busyUntil) {
            info.busy = null;
            if (m.defuse(b.id, now)) this.defuses++;
          }
        }
      } else {
        const at = map.sites[k % map.sites.length];
        b.aimFor({ x: at.x, y: at.y, z: at.z, r: 4 }, false);
      }
    });
  }
}
