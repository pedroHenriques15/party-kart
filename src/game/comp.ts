// The competitive mode, after Counter-Strike 2's: two teams of up to four, Terrorists and
// Counter-Terrorists, in rounds with no coming back; a round won by putting the other side down, by
// the bomb going off (the Terrorists) or by its being defused or the time running out (the
// Counter-Terrorists). Money earned by kills and rounds, spent in the buy menu in the first seconds of
// a round, near your side's spawn; what you bought kept while you live. The sides swap at half time,
// and the first to win more than half the rounds wins the match. Every arena has two bomb sites, A and
// B, nearer the Counter-Terrorists' spawn (compMap).
//
// The host runs the match (Match), and everyone's browser sees it as the host sends it (CompState):
// your browser buys with the money the host says you have, plants and defuses where it says, and tells
// the host what it did. Pure, so the tests play matches.
import { clamp } from '../math.ts';
import type { Field, Spawn } from './field.ts';
import { ARMOUR, GUNS, isGun, NADES, type Cause, type GunId, type Loadout, type NadeId } from './arsenal.ts';

export type Side = 'T' | 'CT';
export type Phase = 'freeze' | 'live' | 'planted' | 'over' | 'end';
// How a round was won: everyone on the other side down, the bomb gone off, defused, or the time up.
export type Why = 'elim' | 'bomb' | 'defuse' | 'time';

// Counter-Strike's numbers, its seconds and its dollars (here euros).
export const COMP = {
  freeze: 15000, // ms standing at the spawn at a round's start, buying
  buy: 20000, // ms after the freeze that the buy menu still sells
  round: 115000, // ms of a round (1:55)
  bomb: 40000, // ms from the plant to the blast
  plant: 3200, // ms to plant
  defuse: 10000, // ms to defuse; with a kit
  kitDefuse: 5000,
  after: 7000, // ms from a round won to the next
  halftime: 8000, // ms more at half time
  start: 800,
  most: 16000,
  win: { elim: 3250, time: 3250, bomb: 3500, defuse: 3500 } as Record<Why, number>,
  // The loss bonus: the first loss in a row, the second, and so on to the fifth and after.
  loss: [1400, 1900, 2400, 2900, 3400],
  planted: 800, // to each Terrorist when they lose a round they planted in
  plantBy: 300, // to whoever planted, and whoever defused
  defuseBy: 300,
  teamKill: -300,
  kit: 400, // the defuse kit
  helmetOnly: 350, // a helmet bought over a vest you have
  // How near a site's middle the bomb is planted, and how near the bomb a defuse is.
  reach: 1.6,
  // How far from your side's spawn the buy menu sells (m).
  buyZone: 14,
  // The blast: its damage at the bomb, and how it falls off (a bell curve's spread, m).
  blast: 500,
  sigma: 12,
} as const;

// The money a kill earns, by the weapon (Counter-Strike 2's): a knife's most, a sub-machine gun's and a
// shotgun's more than a rifle's, the AWP's least.
export function killReward(w: Cause): number {
  if (w === 'knife') return 1500;
  if (w === 'awp') return 100;
  if (!isGun(w)) return 300;
  const g = GUNS[w];
  if (g.family === 'smg') return w === 'p90' ? 300 : 600;
  if (g.family === 'shotgun') return w === 'xm1014' ? 600 : 900;
  return 300;
}

// Each side's guns: the ones only the Terrorists can buy, those only the Counter-Terrorists, and the
// rest anyone; and the pistol each starts every half and every life with.
const T_ONLY = new Set<GunId>(['glock', 'mac10', 'galil', 'ak47', 'sg553']);
const CT_ONLY = new Set<GunId>(['usp', 'mp9', 'famas', 'm4a4', 'm4a1s', 'aug']);
export const sells = (side: Side, g: GunId): boolean => (side === 'T' ? !CT_ONLY.has(g) : !T_ONLY.has(g));
export const PISTOL: Record<Side, GunId> = { T: 'glock', CT: 'usp' };
export const startKit = (side: Side): Loadout => ({ primary: null, secondary: PISTOL[side], nades: [], armour: 0 });

// The price of buying what's new in `want` over what you `have`: each gun that isn't yours already,
// each grenade more, the armour (a helmet alone over a vest), the kit.
export function priceOf(have: Loadout, want: Loadout): number {
  let n = 0;
  if (want.primary && want.primary !== have.primary) n += GUNS[want.primary].price;
  if (want.secondary !== have.secondary) n += GUNS[want.secondary].price;
  const left = [...have.nades];
  for (const x of want.nades) {
    const k = left.indexOf(x);
    if (k >= 0) left.splice(k, 1);
    else n += NADES[x].price;
  }
  if (want.armour > have.armour) n += want.armour === 2 ? (have.armour === 1 ? COMP.helmetOnly : ARMOUR.helmet.price) : ARMOUR.vest.price;
  return n;
}

// ---- The arena's ground for a match ----

export interface Site {
  id: 'A' | 'B';
  x: number;
  y: number;
  z: number;
  r: number;
}

// Where each side starts a round, and the bomb sites.
export interface CompMap {
  t: Spawn[];
  ct: Spawn[];
  sites: Site[];
}

// The most a side has at a round's start, and how far apart.
const SPAWNS = 6;
const SPAWN_GAP = 2.2;
const SITE_R = 4.5;

// Each side's spawn at either end of the arena along its longest way across, facing its middle; and the
// two sites, a third of the way from the Counter-Terrorists' end, as far either side of the middle as
// the arena lets them (or one behind the other, where it's too narrow), each on ground the bots' paths
// reach, outdoors, as the arena's every point is reached from the others.
export function compMap(f: Field): CompMap {
  const P = f.paths;
  // The points to choose from: on the ground (none up a tower), in the arena.
  const pts: { x: number; y: number; z: number }[] = [];
  for (let p = 0; p < P.n; p++) {
    const x = P.x[p];
    const z = P.z[p];
    const y = P.y[p];
    if (!f.inside(x, z) || f.ground.roomAt(x, z)?.tower || y > f.ground.groundAt(x, z) + 1.2) continue;
    pts.push({ x, y, z });
  }
  if (!pts.length) for (const s of f.spawns) pts.push(s);
  // The longest way across: the points' first principal axis.
  let mx = 0;
  let mz = 0;
  for (const q of pts) {
    mx += q.x / pts.length;
    mz += q.z / pts.length;
  }
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (const q of pts) {
    sxx += (q.x - mx) ** 2;
    szz += (q.z - mz) ** 2;
    sxz += (q.x - mx) * (q.z - mz);
  }
  const th = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ux = Math.cos(th);
  const uz = Math.sin(th);
  const along = (q: { x: number; z: number }) => (q.x - mx) * ux + (q.z - mz) * uz;
  const across = (q: { x: number; z: number }) => -(q.x - mx) * uz + (q.z - mz) * ux;
  const us = pts.map(along);
  const u0 = Math.min(...us);
  const u1 = Math.max(...us);
  const span = Math.max(1, u1 - u0);
  const tOf = (q: { x: number; z: number }) => (along(q) - u0) / span;

  // A side's spawn: round the end's point nearest the middle across, those nearest it, apart.
  const spawnsAt = (end: 0 | 1): Spawn[] => {
    const near = pts.filter((q) => (end ? tOf(q) > 0.88 : tOf(q) < 0.12));
    const pool = near.length ? near : pts;
    const e = [...pool].sort((a, b) => Math.abs(across(a)) - Math.abs(across(b)))[0];
    const out: Spawn[] = [];
    for (const gap of [SPAWN_GAP, 1.2]) {
      for (const q of [...pts].sort((a, b) => Math.hypot(a.x - e.x, a.z - e.z) - Math.hypot(b.x - e.x, b.z - e.z))) {
        if (out.length >= SPAWNS) break;
        if (Math.abs(q.y - e.y) > 1.5 || out.some((s) => Math.hypot(s.x - q.x, s.z - q.z) < gap)) continue;
        out.push({ x: q.x, y: q.y, z: q.z, yaw: Math.atan2(mz - q.z, mx - q.x) });
      }
      if (out.length >= SPAWNS) break;
    }
    return out;
  };
  const t = spawnsAt(0);
  const ct = spawnsAt(1);

  // The sites: a third of the way from the Counter-Terrorists' end, the furthest either side across.
  const band = pts.filter((q) => tOf(q) > 0.55 && tOf(q) < 0.82);
  const pool = band.length > 4 ? band : pts;
  const byAcross = [...pool].sort((a, b) => across(a) - across(b));
  let A = byAcross[Math.floor(byAcross.length * 0.88)] ?? pool[0];
  let B = byAcross[Math.floor(byAcross.length * 0.12)] ?? pool[0];
  if (Math.hypot(A.x - B.x, A.z - B.z) < 18) {
    // Too narrow for two side by side: one behind the other, along the way across.
    const byAlong = [...pts].sort((a, b) => tOf(a) - tOf(b));
    const at = (k: number) => byAlong.filter((q) => Math.abs(tOf(q) - k) < 0.06).sort((a, b) => Math.abs(across(a)) - Math.abs(across(b)))[0] ?? byAlong[Math.floor(byAlong.length * k)];
    A = at(0.78);
    B = at(0.48);
  }
  const sites: Site[] = [
    { id: 'A', x: A.x, y: A.y, z: A.z, r: SITE_R },
    { id: 'B', x: B.x, y: B.y, z: B.z, r: SITE_R },
  ];
  return { t, ct, sites };
}

// The site a point is in, if any: within its radius and near its height.
export function siteAt(m: CompMap, x: number, y: number, z: number): Site | null {
  return m.sites.find((s) => Math.hypot(s.x - x, s.z - z) < s.r && Math.abs(s.y - y) < 2.5) ?? null;
}

// Whether a point's in its side's buy zone.
export function inBuyZone(m: CompMap, side: Side, x: number, z: number): boolean {
  return (side === 'T' ? m.t : m.ct).some((s) => Math.hypot(s.x - x, s.z - z) < COMP.buyZone);
}

// The bomb's blast at d m from it: what it does to the body, before armour.
export function blastAt(d: number): number {
  const n = COMP.blast * Math.exp(-(d * d) / (2 * COMP.sigma * COMP.sigma));
  return n >= 1 ? n : 0;
}

// ---- The match, as the host runs it ----

export interface Drop {
  id: string;
  w: GunId | 'c4';
  x: number;
  y: number;
  z: number;
  mag: number;
  reserve: number;
}

export interface Bomb {
  at: 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded';
  by: string | null; // its carrier; who planted it, or defused it
  x: number;
  y: number;
  z: number;
  site: 'A' | 'B' | null;
}

// The match as the host sends it, whenever it changes: the round and its phase, how long that has left
// (ms, as of its sending: the planted bomb's timer while it ticks), how long the buy menu still sells,
// the score by team, the rounds a half, everyone's money (and the last of each one's buys the host has
// counted), who's up, the bomb, the guns on the ground and who took which, the last round's result, each
// one's place at their side's spawn, and once it's over, who won.
export interface CompState {
  round: number;
  phase: Phase;
  left: number;
  buyLeft: number;
  score: [number, number];
  half: number;
  money: Record<string, number>;
  ack: Record<string, number>;
  alive: string[];
  bomb: Bomb;
  drops: Drop[];
  took: { d: string; by: string; w: GunId | 'c4'; mag: number; reserve: number }[];
  last: { win: number; why: Why } | null;
  spawns: Record<string, number>;
  winner: number | null; // a team, or -1 for a draw
  map: CompMap;
}

// What a player tells the host: a buy (its cost, numbered), the bomb planted or defused, a gun dropped
// (or the bomb), a gun picked up (and the one given for it).
export type CompAct =
  | { k: 'buy'; seq: number; cost: number }
  | { k: 'plant'; x: number; y: number; z: number }
  | { k: 'defuse' }
  | { k: 'drop'; w: GunId | 'c4'; x: number; y: number; z: number; mag: number; reserve: number }
  | { k: 'take'; id: string; give?: { w: GunId; mag: number; reserve: number } };

// What happened, for the host's own screen and its bots: a round begun (everyone back at their spawns),
// one won, half time, the bomb planted, gone off, defused, and the match over.
export type MatchEv = { k: 'round'; n: number; fresh: boolean } | { k: 'won'; win: number; why: Why } | { k: 'half' } | { k: 'planted'; by: string } | { k: 'boom'; x: number; y: number; z: number } | { k: 'defused'; by: string } | { k: 'end'; winner: number };

export interface Player {
  id: string;
  team: number;
}

// Which side a team is on: team 1 the Terrorists in the first half, team 0 in the second.
export const sideOf = (team: number, round: number, half: number): Side => ((team === 1) === round <= half ? 'T' : 'CT');

export class Match {
  readonly half: number;
  readonly map: CompMap;
  private readonly players = new Map<string, Player>();
  private readonly rand: () => number;
  private round = 0;
  private phase: Phase = 'freeze';
  private ends = 0; // ms the phase ends
  private liveAt = 0; // ms the round went live
  private score: [number, number] = [0, 0];
  private money = new Map<string, number>();
  private ack = new Map<string, number>();
  private alive = new Set<string>();
  private lossRun: [number, number] = [0, 0];
  private planted = false;
  private bomb: Bomb = { at: 'carried', by: null, x: 0, y: 0, z: 0, site: null };
  private drops: Drop[] = [];
  private took: CompState['took'] = [];
  private last: CompState['last'] = null;
  private spawns: Record<string, number> = {};
  private winner: number | null = null;
  private drops0 = 0;
  // What happened since `events()` last was read.
  private out: MatchEv[] = [];
  // Whether anything sent changed since `dirty` was last cleared.
  dirty = true;

  constructor(players: readonly Player[], map: CompMap, half = 12, rand: () => number = Math.random) {
    this.half = half;
    this.map = map;
    this.rand = rand;
    for (const p of players) this.join(p);
  }

  // Someone in the match: a newcomer waits for the next round, with a pistol round's money.
  join(p: Player): void {
    this.players.set(p.id, { ...p });
    if (!this.money.has(p.id)) this.money.set(p.id, COMP.start);
    this.dirty = true;
  }

  leave(id: string, now: number): void {
    if (!this.players.delete(id)) return;
    this.alive.delete(id);
    if (this.bomb.by === id && this.bomb.at === 'carried') this.bomb = { ...this.bomb, at: 'dropped', by: null };
    this.dirty = true;
    this.checkElim(now);
  }

  // Everyone in it.
  ids(): string[] {
    return [...this.players.keys()];
  }

  side(id: string): Side | null {
    const p = this.players.get(id);
    return p ? sideOf(p.team, Math.max(1, this.round), this.half) : null;
  }

  // The team on a side this round.
  teamOn(side: Side): number {
    return sideOf(1, Math.max(1, this.round), this.half) === side ? 1 : 0;
  }

  get phaseNow(): Phase {
    return this.phase;
  }

  get roundNow(): number {
    return this.round;
  }

  isUp(id: string): boolean {
    return this.alive.has(id);
  }

  get bombNow(): Bomb {
    return this.bomb;
  }

  moneyOf(id: string): number {
    return this.money.get(id) ?? 0;
  }

  events(): MatchEv[] {
    const e = this.out;
    this.out = [];
    return e;
  }

  // The first round, at ms now.
  start(now: number): void {
    this.newRound(now);
  }

  private pay(id: string, n: number): void {
    this.money.set(id, clamp((this.money.get(id) ?? 0) + n, 0, COMP.most));
  }

  private newRound(now: number): void {
    this.round++;
    const fresh = this.round === 1 || this.round === this.half + 1;
    if (fresh) {
      for (const id of this.players.keys()) this.money.set(id, COMP.start);
      this.lossRun = [0, 0];
    }
    this.phase = 'freeze';
    this.ends = now + COMP.freeze;
    this.liveAt = this.ends;
    this.planted = false;
    this.alive = new Set(this.players.keys());
    this.drops = [];
    this.took = [];
    // Each one's place at their side's spawn, in no order.
    this.spawns = {};
    for (const side of ['T', 'CT'] as Side[]) {
      const ids = [...this.players.keys()].filter((id) => this.side(id) === side).sort(() => this.rand() - 0.5);
      ids.forEach((id, k) => (this.spawns[id] = k));
    }
    // The bomb to one of the Terrorists.
    const ts = [...this.players.keys()].filter((id) => this.side(id) === 'T');
    const by = ts.length ? ts[Math.floor(this.rand() * ts.length)] : null;
    this.bomb = { at: by ? 'carried' : 'dropped', by, x: 0, y: 0, z: 0, site: null };
    if (!by && this.map.t[0]) Object.assign(this.bomb, { x: this.map.t[0].x, y: this.map.t[0].y, z: this.map.t[0].z });
    this.out.push({ k: 'round', n: this.round, fresh });
    this.dirty = true;
  }

  // The match at ms now: the freeze over, the time up, the bomb gone off, the next round.
  step(now: number): void {
    if (this.phase === 'end') return;
    if (now < this.ends) return;
    if (this.phase === 'freeze') {
      this.phase = 'live';
      this.liveAt = now;
      this.ends = now + COMP.round;
      this.dirty = true;
    } else if (this.phase === 'live') {
      this.won(this.teamOn('CT'), 'time', now);
    } else if (this.phase === 'planted') {
      this.bomb = { ...this.bomb, at: 'exploded' };
      this.out.push({ k: 'boom', x: this.bomb.x, y: this.bomb.y, z: this.bomb.z });
      this.won(this.teamOn('T'), 'bomb', now);
    } else if (this.phase === 'over') {
      if (this.winner !== null) {
        this.phase = 'end';
        this.out.push({ k: 'end', winner: this.winner });
        this.dirty = true;
      } else this.newRound(now);
    }
  }

  // A round won by a team, how: the score, the money, and in a while the next round (or the end).
  private won(win: number, why: Why, now: number): void {
    if (this.phase === 'over' || this.phase === 'end') return;
    this.score[win]++;
    const lose = 1 - win;
    const tTeam = this.teamOn('T');
    for (const [id, p] of this.players) {
      if (p.team === win) {
        this.pay(id, COMP.win[why]);
        continue;
      }
      // The Terrorists still up when the time runs out get no loss bonus.
      const bonus = why === 'time' && p.team === tTeam && this.alive.has(id) ? 0 : COMP.loss[Math.min(this.lossRun[lose], COMP.loss.length - 1)];
      this.pay(id, bonus + (p.team === tTeam && this.planted ? COMP.planted : 0));
    }
    this.lossRun[lose] = Math.min(COMP.loss.length - 1, this.lossRun[lose] + 1);
    this.lossRun[win] = Math.max(0, this.lossRun[win] - 1);
    this.last = { win, why };
    this.phase = 'over';
    const halfTime = this.round === this.half;
    this.ends = now + COMP.after + (halfTime ? COMP.halftime : 0);
    this.out.push({ k: 'won', win, why });
    if (halfTime) this.out.push({ k: 'half' });
    // Over: more than half the rounds, or all of them played.
    if (this.score[win] > this.half) this.winner = win;
    else if (this.round >= this.half * 2) this.winner = this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1;
    this.dirty = true;
  }

  // Everyone on a side down (who had anyone this round): the other side's round, but a planted bomb's
  // still to be defused.
  private checkElim(now: number): void {
    if (this.phase !== 'live' && this.phase !== 'planted') return;
    const up = (side: Side) => [...this.alive].filter((id) => this.side(id) === side).length;
    const had = (side: Side) => [...this.players.keys()].some((id) => this.side(id) === side);
    if (had('CT') && up('CT') === 0) this.won(this.teamOn('T'), 'elim', now);
    else if (this.phase === 'live' && had('T') && up('T') === 0) this.won(this.teamOn('CT'), 'elim', now);
  }

  // Someone down, by someone, with something, where; and the gun they dropped. A kill's money (a
  // team-mate's costs), the bomb dropped where its carrier fell.
  down(ev: { victim: string; by: string; w: Cause; x: number; y: number; z: number; drop?: { w: GunId; mag: number; reserve: number } }, now: number): void {
    if (!this.alive.has(ev.victim) || this.phase === 'end') return;
    this.alive.delete(ev.victim);
    const v = this.players.get(ev.victim);
    const k = this.players.get(ev.by);
    if (k && v && ev.by !== ev.victim) this.pay(ev.by, k.team === v.team ? COMP.teamKill : killReward(ev.w));
    if (this.bomb.by === ev.victim && this.bomb.at === 'carried') this.bomb = { at: 'dropped', by: null, x: ev.x, y: ev.y, z: ev.z, site: null };
    if (ev.drop && isGun(ev.drop.w)) this.drops.push({ id: `d${++this.drops0}`, w: ev.drop.w, x: ev.x, y: ev.y, z: ev.z, mag: ev.drop.mag, reserve: ev.drop.reserve });
    this.dirty = true;
    this.checkElim(now);
  }

  // The bomb planted by its carrier, at a site: true if it was.
  plant(by: string, x: number, y: number, z: number, now: number): boolean {
    const site = siteAt(this.map, x, y, z);
    if (this.phase !== 'live' || this.bomb.at !== 'carried' || this.bomb.by !== by || !this.alive.has(by) || !site) return false;
    this.bomb = { at: 'planted', by, x, y, z, site: site.id };
    this.planted = true;
    this.phase = 'planted';
    this.ends = now + COMP.bomb;
    this.pay(by, COMP.plantBy);
    this.out.push({ k: 'planted', by });
    this.dirty = true;
    return true;
  }

  // The bomb defused, by a Counter-Terrorist up: true if it was, the round theirs.
  defuse(by: string, now: number): boolean {
    if (this.phase !== 'planted' || this.side(by) !== 'CT' || !this.alive.has(by)) return false;
    this.bomb = { ...this.bomb, at: 'defused', by };
    this.pay(by, COMP.defuseBy);
    this.out.push({ k: 'defused', by });
    this.won(this.teamOn('CT'), 'defuse', now);
    return true;
  }

  // Whether the buy menu sells, at ms now.
  buying(now: number): boolean {
    return this.phase === 'freeze' || (this.phase === 'live' && now - this.liveAt < COMP.buy);
  }

  // A buy, numbered: its cost taken from the buyer's money (never below none).
  buy(id: string, seq: number, cost: number): void {
    if (seq <= (this.ack.get(id) ?? 0)) return;
    this.ack.set(id, seq);
    this.pay(id, -Math.max(0, cost));
    this.dirty = true;
  }

  // A gun (or the bomb) dropped where someone stands.
  drop(id: string, a: Extract<CompAct, { k: 'drop' }>): void {
    if (!this.alive.has(id)) return;
    if (a.w === 'c4') {
      if (this.bomb.by !== id || this.bomb.at !== 'carried') return;
      this.bomb = { at: 'dropped', by: null, x: a.x, y: a.y, z: a.z, site: null };
    } else if (isGun(a.w)) this.drops.push({ id: `d${++this.drops0}`, w: a.w, x: a.x, y: a.y, z: a.z, mag: a.mag, reserve: a.reserve });
    this.dirty = true;
  }

  // Something picked up off the ground: a gun (its taker's, the first to ask), or the bomb ('c4', a
  // Terrorist's). True if it's theirs.
  take(id: string, drop: string, give?: { w: GunId; mag: number; reserve: number }): boolean {
    if (!this.alive.has(id) || this.phase === 'over' || this.phase === 'end') return false;
    if (drop === 'c4') {
      if (this.bomb.at !== 'dropped' || this.side(id) !== 'T') return false;
      this.bomb = { ...this.bomb, at: 'carried', by: id };
      this.took = [...this.took.slice(-7), { d: 'c4', by: id, w: 'c4', mag: 0, reserve: 0 }];
      this.dirty = true;
      return true;
    }
    const k = this.drops.findIndex((d) => d.id === drop);
    if (k < 0) return false;
    const d = this.drops[k];
    this.drops.splice(k, 1);
    if (give && isGun(give.w)) this.drops.push({ id: `d${++this.drops0}`, w: give.w, x: d.x, y: d.y, z: d.z, mag: give.mag, reserve: give.reserve });
    this.took = [...this.took.slice(-7), { d: d.id, by: id, w: d.w, mag: d.mag, reserve: d.reserve }];
    this.dirty = true;
    return true;
  }

  // What a player said they did.
  act(id: string, a: CompAct, now: number): void {
    if (a.k === 'buy') this.buy(id, a.seq, a.cost);
    else if (a.k === 'plant') this.plant(id, a.x, a.y, a.z, now);
    else if (a.k === 'defuse') this.defuse(id, now);
    else if (a.k === 'drop') this.drop(id, a);
    else if (a.k === 'take') this.take(id, a.id, a.give);
  }

  // The match as it's sent, at ms now.
  state(now: number): CompState {
    return {
      round: this.round,
      phase: this.phase,
      left: Math.max(0, this.ends - now),
      buyLeft: this.phase === 'freeze' ? this.ends - now + COMP.buy : this.phase === 'live' ? Math.max(0, COMP.buy - (now - this.liveAt)) : 0,
      score: [...this.score],
      half: this.half,
      money: Object.fromEntries(this.money),
      ack: Object.fromEntries(this.ack),
      alive: [...this.alive],
      bomb: { ...this.bomb },
      drops: this.drops.map((d) => ({ ...d })),
      took: this.took.map((x) => ({ ...x })),
      last: this.last,
      spawns: { ...this.spawns },
      winner: this.winner,
      map: this.map,
    };
  }
}

// ---- The bots' money ----

// What a bot buys at a round's start with what it has and the money it has, as Counter-Strike's bots
// buy: on a pistol round armour, or a better pistol, and a grenade; with money for it, a rifle (now and
// then the AWP), a helmet, grenades and, a Counter-Terrorist, a kit; short of that, a cheap gun and a
// vest when the team has to (`force`), else nothing much (an eco round) to buy well the next.
export function botBuy(have: Loadout & { kit?: boolean }, money: number, side: Side, fresh: boolean, rand: () => number, force = false): { kit: Loadout; defuse: boolean; cost: number } {
  const want: Loadout = { ...have, nades: [...have.nades] };
  let left = money;
  let defuse = !!have.kit;
  const get = (cost: number, then: () => void) => {
    if (cost <= left) {
      left -= cost;
      then();
      return true;
    }
    return false;
  };
  const nade = (n: NadeId) => want.nades.length < 4 && want.nades.filter((x) => x === n).length < NADES[n].max && get(NADES[n].price, () => want.nades.push(n));
  if (fresh) {
    if (rand() < 0.5) get(ARMOUR.vest.price, () => (want.armour = Math.max(want.armour, 1) as 0 | 1 | 2));
    else get(GUNS.p250.price, () => (want.secondary = 'p250'));
    if (rand() < 0.5) nade('flash');
    return { kit: want, defuse, cost: money - left };
  }
  const rifle: GunId = side === 'T' ? 'ak47' : rand() < 0.5 ? 'm4a4' : 'm4a1s';
  const big = money >= 5800 && rand() < 0.15 ? 'awp' : rifle;
  const full = GUNS[big].price + ARMOUR.helmet.price;
  if (!want.primary || (GUNS[want.primary].price < GUNS[rifle].price && money >= full)) {
    if (money >= full) get(GUNS[big].price, () => (want.primary = big));
    else if (force || money >= 2600) {
      const cheap: GunId = side === 'T' ? (money >= 2400 ? 'galil' : 'mac10') : money >= 2650 ? 'famas' : 'mp9';
      get(GUNS[cheap].price, () => (want.primary = cheap));
    }
  }
  if (want.primary && want.armour < 2) get(want.armour === 1 ? COMP.helmetOnly : ARMOUR.helmet.price, () => (want.armour = 2)) || get(ARMOUR.vest.price, () => (want.armour = Math.max(want.armour, 1) as 0 | 1 | 2));
  if (want.primary) {
    if (side === 'CT' && !defuse) get(COMP.kit, () => (defuse = true));
    nade('smoke');
    nade('flash');
    if (rand() < 0.6) nade('he');
    if (rand() < 0.4) nade('molotov');
  }
  return { kit: want, defuse, cost: money - left };
}
