// The deathmatch (braga-map's task 074), after Counter-Strike 2's: everyone for themselves (or two
// teams), the guns chosen in the buy menu and kept from one life to the next, the most kills when the
// time runs out winning. What a fighter carries and does with it (the arsenal is arsenal.ts), their
// health and armour, a shot and what it hits, a knife's cut, and the scores. Pure, like the karts'
// physics, so the tests fight rounds.
//
// A shot is decided by the shooter's browser, against the others as it drew them (110 ms behind, as
// every browser draws the others), and the victim's browser takes the damage: what hit on your screen
// hit. A bullet is instant, so the items' rule (the victim decides) would have shots that hit on the
// shooter's screen miss on the victim's. Every browser draws the shot from the event: its pellets'
// directions come from its seed, so the same marks are left on the same walls everywhere.
import { addScaled, clamp, cross, dist2, dot, norm, sub, v3, type V } from '../math.ts';
import type { Sighted } from '../world/sight.ts';
import { coneOf, damageAt, drawOf, GUNS, HEAD as HEADSHOT, isGun, isNade, KNIFE, LEGS as LEGSHOT, NADES, NADES_MAX, START, throughArmour, kickOf, WEAPON_IDS, type Cause, type Gun, type GunId, type Loadout, type NadeId, type WeaponId } from './arsenal.ts';
import type { NadeEv } from './nades.ts';

export const HEALTH = 100;
export const ARMOUR = 100;
export const RESPAWN = 3000; // ms down before coming back
export const SAFE = 2000; // ms unhurt after coming back, unless it fires first
// How long after coming back the buy menu still changes what you hold (ms); after, what's bought is
// for the next life.
export const BUY_TIME = 15000;

// The flags a fighter on foot sends in its snapshot's `fl` (cleanSnap clamps it to 16 bits): the
// weapon in their hand is WEAPON_IDS' index in the top bits.
export const FIGHT = { down: 1, armed: 2, scoped: 4, reloading: 8, safe: 16, crouch: 32, team: 64, weapon: 128 } as const;

// ---- A fighter ----

interface Rounds {
  mag: number;
  reserve: number;
}

// One fighter this browser runs: you, or a bot the host runs (task 075).
export class Soldier {
  readonly id: string;
  // What it comes back with, and what it holds now.
  kit: Loadout = { ...START, nades: [...START.nades] };
  primary: GunId | null = null;
  secondary: GunId = 'glock';
  nades: NadeId[] = [];
  readonly rounds = new Map<GunId, Rounds>();
  hand: WeaponId = 'knife';
  last: WeaponId = 'knife';
  drawnAt = 0; // round ms the weapon in hand is ready
  reloadAt = 0; // round ms its reload (a shotgun's next shell) is done, while reloading
  nextAt = 0; // round ms it may fire again
  bloom = 0; // degrees its shots have spread more
  spray = 0; // how far into a spray it is, in shots, coming back after the last
  lastShot = -1e9;
  punch = { x: 0, y: 0 }; // the recoil's kick of the aim, degrees across and up
  scope = 0; // 0 unscoped, else the zoom (1 or 2)
  scopeAt = 0; // round ms the scope came up
  rezoom = 0; // the zoom a sniper's rifle goes back to once its bolt's worked
  throwAt = 0; // round ms a grenade leaves the hand, while one's thrown
  crouch = false;
  health = HEALTH;
  armour = 0;
  helmet = false;
  hurtAt = -1e9;
  alive = true;
  downAt = 0;
  spawnAt = 0;
  safeUntil = 0;
  team = 0;
  shots = 0;

  constructor(id: string, kit: Loadout = START) {
    this.id = id;
    this.kit = { ...kit, nades: [...kit.nades] };
  }

  // Back at t with its loadout, whole, its guns full, safe for a moment, the gun it likes in hand.
  arm(kit: Loadout, t: number): void {
    this.kit = { ...kit, nades: [...kit.nades] };
    this.health = HEALTH;
    this.hurtAt = -1e9;
    this.alive = true;
    this.spawnAt = t;
    this.safeUntil = t + SAFE;
    this.rounds.clear();
    this.equip(this.kit, t, true);
    this.drawnAt = t;
  }

  // What the buy menu gave it, now: new guns full (one it holds already is kept as it is), the
  // grenades topped up to what's chosen, the armour whole. Its hand on the new primary, or the new
  // secondary, if it bought one.
  equip(kit: Loadout, t: number, fresh = false): void {
    this.kit = { ...kit, nades: [...kit.nades] };
    const was = [this.primary, this.secondary];
    this.primary = kit.primary;
    this.secondary = kit.secondary;
    for (const g of [kit.primary, kit.secondary]) if (g && (fresh || !was.includes(g) || !this.rounds.has(g))) this.rounds.set(g, { mag: GUNS[g].mag, reserve: GUNS[g].reserve });
    for (const g of [...this.rounds.keys()]) if (g !== kit.primary && g !== kit.secondary) this.rounds.delete(g);
    this.nades = [];
    for (const n of kit.nades) if (this.nades.filter((x) => x === n).length < NADES[n].max && this.nades.length < NADES_MAX) this.nades.push(n);
    this.armour = kit.armour ? ARMOUR : 0;
    this.helmet = kit.armour === 2;
    const best = kit.primary ?? kit.secondary;
    if (fresh) {
      this.hand = this.last = best;
      this.reloadAt = 0;
      this.scope = this.rezoom = 0;
    } else if (kit.primary && kit.primary !== was[0]) this.select(kit.primary, t);
    else if (kit.secondary !== was[1] && (this.hand === was[1] || !kit.primary)) this.select(kit.secondary, t);
    else if (!this.has(this.hand)) this.select(best, t);
  }

  has(w: WeaponId): boolean {
    return w === 'knife' || w === this.primary || w === this.secondary || (isNade(w) && this.nades.includes(w));
  }

  // The gun in its hand, or null (the knife, a grenade).
  get gun(): Gun | null {
    return isGun(this.hand) ? GUNS[this.hand] : null;
  }

  get mag(): number {
    return isGun(this.hand) ? (this.rounds.get(this.hand)?.mag ?? 0) : 0;
  }

  get reserve(): number {
    return isGun(this.hand) ? (this.rounds.get(this.hand)?.reserve ?? 0) : 0;
  }

  get reloading(): boolean {
    return this.reloadAt > 0;
  }

  // Takes out a weapon it has: drawn after the weapon's draw time, the reload and the scope given up.
  select(w: WeaponId, t: number): boolean {
    if (!this.alive || w === this.hand || !this.has(w) || this.throwAt) return false;
    this.last = this.hand;
    this.hand = w;
    this.reloadAt = 0;
    this.scope = this.rezoom = 0;
    this.drawnAt = t + drawOf(w);
    this.spray = 0;
    this.punch = { x: 0, y: 0 };
    return true;
  }

  // The weapon in a slot, as the number keys take them: 1 the primary, 2 the secondary, 3 the knife, 4
  // the grenades in turn.
  slot(n: number, t: number): boolean {
    if (n === 1 && this.primary) return this.select(this.primary, t);
    if (n === 2) return this.select(this.secondary, t);
    if (n === 3) return this.select('knife', t);
    if (n === 4 && this.nades.length) {
      const kinds = [...new Set(this.nades)];
      const k = isNade(this.hand) ? (kinds.indexOf(this.hand) + 1) % kinds.length : 0;
      return this.select(kinds[k], t);
    }
    return false;
  }

  // The weapon a step round the slots, as the mouse wheel turns them.
  cycle(dir: 1 | -1, t: number): boolean {
    const order: WeaponId[] = [...(this.primary ? [this.primary] : []), this.secondary, 'knife', ...new Set(this.nades)];
    const k = order.indexOf(this.hand);
    return this.select(order[(k + dir + order.length) % order.length], t);
  }

  // The scope a step on: up, the next zoom, off. Only a gun with a scope, drawn, not reloading.
  zoom(t: number): void {
    const g = this.gun;
    if (!g?.scope || this.reloading || t < this.drawnAt) return;
    this.scope = (this.scope + 1) % (g.scope.zooms.length + 1);
    this.scopeAt = t;
    this.rezoom = 0;
  }

  // Reloads, if the magazine isn't full, there's a reserve, and it isn't already.
  reload(t: number): boolean {
    const g = this.gun;
    const r = g && this.rounds.get(g.id);
    if (!this.alive || !g || !r || this.reloading || r.mag >= g.mag || r.reserve <= 0 || t < this.drawnAt) return false;
    this.reloadAt = t + g.reload;
    this.scope = this.rezoom = 0;
    return true;
  }

  // A step of dt seconds at round ms t: the spread settling, the spray and its kick coming back, a
  // reload done (a shotgun's next shell), a sniper's scope back up once its bolt's worked.
  step(dt: number, t: number): void {
    const g = this.gun;
    if (g) {
      const s = g.spread.settle * dt;
      this.bloom = this.bloom > 0 ? Math.max(0, this.bloom - s) : Math.min(0, this.bloom + s);
      if (t - this.lastShot > g.every * 1.5) {
        this.spray *= Math.exp(-dt / g.recoil.back);
        if (this.spray < 0.05) this.spray = 0;
        this.punch = kickOf(g.recoil, this.spray);
      }
      if (this.reloadAt && t >= this.reloadAt) {
        const r = this.rounds.get(g.id)!;
        const n = g.shells ? 1 : Math.min(g.mag - r.mag, r.reserve);
        r.mag += n;
        r.reserve -= n;
        this.reloadAt = g.shells && r.mag < g.mag && r.reserve > 0 ? t + g.reload : 0;
      }
      if (this.rezoom && t >= this.nextAt && this.alive) {
        this.scope = this.rezoom;
        this.scopeAt = t;
        this.rezoom = 0;
      }
    } else {
      this.bloom = 0;
      this.spray = 0;
      this.punch = { x: 0, y: 0 };
    }
  }

  // Whether it may fire at t: alive, drawn, loaded, its last shot gone; a shotgun stops its reload to.
  ready(t: number): boolean {
    if (!this.alive || t < this.nextAt || t < this.drawnAt || this.throwAt) return false;
    if (this.hand === 'knife') return true;
    if (isNade(this.hand)) return this.nades.includes(this.hand);
    const g = this.gun!;
    if (this.reloading && !(g.shells && this.mag > 0)) return false;
    return this.mag > 0;
  }

  // Hurt at t by what a hit did to it (each part's damage before armour) from a weapon. What it lost,
  // and whether it's the hit that put it down.
  hurt(h: Pick<Hit, 'b' | 'h' | 'l'>, w: Cause, t: number): { lost: number; down: boolean } {
    if (!this.alive || t < this.safeUntil) return { lost: 0, down: false };
    const pen = isGun(w) ? GUNS[w].pen : w === 'knife' ? 0.85 : w === 'he' ? 0.5 : 1;
    let lost = h.l;
    let worn = 0;
    for (const [n, covered] of [[h.b, true], [h.h, this.helmet]] as const) {
      if (n <= 0) continue;
      const a = throughArmour(n, pen, this.armour - worn, covered);
      lost += a.health;
      worn += a.armour;
    }
    lost = Math.round(lost);
    if (lost <= 0) return { lost: 0, down: false };
    this.armour = Math.max(0, Math.round(this.armour - worn));
    this.health -= lost;
    this.hurtAt = t;
    if (this.health > 0) return { lost, down: false };
    this.health = 0;
    this.alive = false;
    this.downAt = t;
    this.scope = this.rezoom = 0;
    this.reloadAt = 0;
    this.throwAt = 0;
    return { lost, down: true };
  }

  // Its snapshot's flags.
  flags(t: number): number {
    return FIGHT.armed | (this.alive ? 0 : FIGHT.down) | (this.scope ? FIGHT.scoped : 0) | (this.reloading ? FIGHT.reloading : 0) | (t < this.safeUntil ? FIGHT.safe : 0) | (this.crouch ? FIGHT.crouch : 0) | (this.team ? FIGHT.team : 0) | (WEAPON_IDS.indexOf(this.hand) * FIGHT.weapon);
  }

  // How long its scope has been up, ms.
  scopedFor(t: number): number {
    return this.scope ? t - this.scopeAt : 0;
  }
}

// What a snapshot's flags say of a fighter.
export function fighterOf(fl: number): { armed: boolean; down: boolean; weapon: WeaponId; scoped: boolean; reloading: boolean; safe: boolean; crouch: boolean; team: number } {
  return { armed: !!(fl & FIGHT.armed), down: !!(fl & FIGHT.down), weapon: WEAPON_IDS[Math.floor(fl / FIGHT.weapon)] ?? 'knife', scoped: !!(fl & FIGHT.scoped), reloading: !!(fl & FIGHT.reloading), safe: !!(fl & FIGHT.safe), crouch: !!(fl & FIGHT.crouch), team: fl & FIGHT.team ? 1 : 0 };
}

// ---- Who's where, and what a bullet hits ----

// A fighter as a shot finds them: their feet, which way they face, and how far they're crouched (0
// standing, 1 down on their heels).
export interface Body {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw?: number;
  c?: number;
}

// The figure's shape (render/soldier.ts draws them a person's proportions, 1.75 m tall), from the
// feet, standing and crouched: the head a ball, the body and the legs each an upright capsule.
export const HEAD = { y: 1.58, r: 0.15, yc: 1.12 };
export const TORSO = { y0: 0.98, y1: 1.36, r: 0.21, y0c: 0.66, y1c: 0.98 };
export const LEG = { y0: 0.14, y1: 0.86, r: 0.17, y0c: 0.12, y1c: 0.56 };
export const TALL = 1.78;
export const CROUCHED = 1.3;
export type Part = 'head' | 'body' | 'legs';

const at = (a: number, b: number, c: number) => a + (b - a) * c;

// Where the ray from o the way d first meets a fighter standing at b, and where on them, if within max.
// `grow` widens them a little, for a knife's reach.
export function hitBody(o: V, d: V, b: Body, max: number, grow = 0): { t: number; part: Part } | null {
  const c = b.c ?? 0;
  // Nowhere near them: not worth the sums.
  const cx = b.x - o.x;
  const cy = b.y + 0.9 - o.y;
  const cz = b.z - o.z;
  const along = cx * d.x + cy * d.y + cz * d.z;
  if (along < -1.2 || along > max + 1.2 || cx * cx + cy * cy + cz * cz - along * along > 1.44) return null;
  let best: { t: number; part: Part } | null = null;
  const take = (t: number, part: Part) => {
    if (t >= 0 && t < max && (!best || t < best.t)) best = { t, part };
  };
  take(ball(o, d, v3(b.x, b.y + at(HEAD.y, HEAD.yc, c), b.z), HEAD.r + grow), 'head');
  take(capsule(o, d, v3(b.x, b.y + at(TORSO.y0, TORSO.y0c, c), b.z), v3(b.x, b.y + at(TORSO.y1, TORSO.y1c, c), b.z), TORSO.r + grow), 'body');
  take(capsule(o, d, v3(b.x, b.y + at(LEG.y0, LEG.y0c, c), b.z), v3(b.x, b.y + at(LEG.y1, LEG.y1c, c), b.z), LEG.r + grow), 'legs');
  return best;
}

// Where a fighter's head and chest are, for a bot's aim and a look.
export const headOf = (b: Body): V => v3(b.x, b.y + at(HEAD.y, HEAD.yc, b.c ?? 0), b.z);
export const chestOf = (b: Body): V => v3(b.x, b.y + at((TORSO.y0 + TORSO.y1) / 2, (TORSO.y0c + TORSO.y1c) / 2, b.c ?? 0), b.z);

// The ray from o the way d (a unit vector) and a ball: how far to it, or -1.
function ball(o: V, d: V, c: V, r: number): number {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const h = b * b - (ox * ox + oy * oy + oz * oz - r * r);
  return h < 0 ? -1 : -b - Math.sqrt(h);
}

// The ray and a capsule from a to b, r round: how far to it, or -1 (Íñigo Quílez's).
function capsule(o: V, d: V, a: V, b: V, r: number): number {
  const ba = v3(b.x - a.x, b.y - a.y, b.z - a.z);
  const oa = v3(o.x - a.x, o.y - a.y, o.z - a.z);
  const baba = ba.x * ba.x + ba.y * ba.y + ba.z * ba.z;
  const bard = ba.x * d.x + ba.y * d.y + ba.z * d.z;
  const baoa = ba.x * oa.x + ba.y * oa.y + ba.z * oa.z;
  const rdoa = d.x * oa.x + d.y * oa.y + d.z * oa.z;
  const oaoa = oa.x * oa.x + oa.y * oa.y + oa.z * oa.z;
  const A = baba - bard * bard;
  const B = baba * rdoa - baoa * bard;
  const C = baba * oaoa - baoa * baoa - r * r * baba;
  const h = B * B - A * C;
  if (h < 0) return -1;
  const t = (-B - Math.sqrt(h)) / A;
  const y = baoa + t * bard;
  if (y > 0 && y < baba) return t;
  return ball(o, d, y <= 0 ? a : b, r);
}

// ---- A shot ----

// What a shot did to someone, each part's damage before their armour (their browser takes it off).
export interface Hit {
  v: string; // who
  b: number; // the body
  h: number; // the head
  l: number; // the legs
}

export interface ShotEv {
  k: 'shot';
  id: string;
  owner: string;
  w: WeaponId; // a gun, or the knife
  t: number; // round ms
  // From (the eye), the way it went (the aim and its recoil), and the cone's half-angle in radians:
  // with the seed, where each pellet went. A knife's: its reach, and whether it was a stab.
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  sp: number;
  seed: number;
  stop: number; // a bit for each pellet a fighter stopped
  hits: Hit[];
  heavy?: boolean;
}

// Someone put down: by whom, with what, where. Sent by the victim's browser.
export interface DownEv {
  k: 'down';
  id: string;
  victim: string;
  by: string;
  w: Cause;
  head: boolean;
  x: number;
  y: number;
  z: number;
}

export type FightEv = ShotEv | DownEv | NadeEv;

// A number from 0 to 1 for pellet k's draw j of a shot's seed: the same in every browser.
export function rand(seed: number, k: number, j: number): number {
  let h = (seed ^ Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(j + 1, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const pelletsOf = (w: WeaponId) => (isGun(w) ? GUNS[w].pellets : 1);

// Each pellet's way, from a shot's aim, cone and seed.
export function pellets(ev: Pick<ShotEv, 'dx' | 'dy' | 'dz' | 'sp' | 'seed' | 'w'>): V[] {
  const a = norm(v3(ev.dx, ev.dy, ev.dz));
  const u = norm(Math.abs(a.y) < 0.99 ? cross(a, v3(0, 1, 0)) : cross(a, v3(1, 0, 0)));
  const w = cross(u, a);
  const out: V[] = [];
  for (let k = 0; k < pelletsOf(ev.w); k++) {
    const r = Math.tan(ev.sp * Math.sqrt(rand(ev.seed, k, 0)));
    const phi = 2 * Math.PI * rand(ev.seed, k, 1);
    const c = r * Math.cos(phi);
    const s = r * Math.sin(phi);
    out.push(norm(v3(a.x + u.x * c + w.x * s, a.y + u.y * c + w.y * s, a.z + u.z * c + w.z * s)));
  }
  return out;
}

// How the fighter's moving, for its spread: its speed over the ground, and whether it's in the air.
export interface Motion {
  speed: number;
  air: boolean;
}

// The cone a fighter's next shot goes in, in radians.
export function spreadOf(s: Soldier, m: Motion, t: number): number {
  const g = s.gun;
  if (!g) return 0;
  return (coneOf(g, { speed: m.speed, air: m.air, crouch: s.crouch, scoped: s.scope > 0, scopedFor: s.scopedFor(t), bloom: s.bloom }) * Math.PI) / 180;
}

// The aim turned by a kick (degrees across, to the right, and up).
export function kicked(aim: V, k: { x: number; y: number }): V {
  if (!k.x && !k.y) return aim;
  const right = norm(Math.abs(aim.y) < 0.999 ? cross(aim, v3(0, 1, 0)) : v3(1, 0, 0));
  const up = cross(right, aim);
  const tx = Math.tan((k.x * Math.PI) / 180);
  const ty = Math.tan((k.y * Math.PI) / 180);
  return norm(v3(aim.x + right.x * tx + up.x * ty, aim.y + right.y * tx + up.y * ty, aim.z + right.z * tx + up.z * ty));
}

// How far the world lets a ray go: sight() on the round's ground with the karts in it, or anything
// else (the tests' open ground).
export type See = (o: V, d: V, max: number) => Sighted;

// Each fighter a pellet meets first, and what it did to them: damage by the part it struck.
function strike(ev: ShotEv, eye: V, bodies: readonly Body[], see: See, owner: string, max: number, dmgAt: (d: number) => number, grow = 0): void {
  const by = new Map<string, Hit>();
  pellets(ev).forEach((d, p) => {
    const w = see(eye, d, max);
    let best: { t: number; part: Part; id: string } | null = null;
    for (const b of bodies) {
      if (b.id === owner) continue;
      const h = hitBody(eye, d, b, best ? best.t : w.t, grow);
      if (h) best = { ...h, id: b.id };
    }
    if (!best) return;
    ev.stop |= 1 << p;
    const n = dmgAt(best.t);
    const h = by.get(best.id) ?? { v: best.id, b: 0, h: 0, l: 0 };
    if (best.part === 'head') h.h += n * (ev.w === 'knife' ? 1 : HEADSHOT);
    else if (best.part === 'legs') h.l += n * (ev.w === 'knife' ? 1 : LEGSHOT);
    else h.b += n;
    by.set(best.id, h);
  });
  const r = (n: number) => Math.round(n * 10) / 10;
  ev.hits = [...by.values()].map((h) => ({ v: h.v, b: r(h.b), h: r(h.h), l: r(h.l) }));
}

// Fires the fighter's gun from its eye the way it aims (a unit vector, before the recoil) at round ms
// t, if it may: each pellet into the world and at whoever it meets first of `bodies` (the living
// others, but its team's). The shot, for every browser, with what it hit; or null if it can't fire.
export function fire(s: Soldier, eye: V, aim: V, m: Motion, t: number, bodies: readonly Body[], see: See, seed: number): ShotEv | null {
  const g = s.gun;
  if (!g || !s.ready(t)) return null;
  const r = s.rounds.get(g.id)!;
  const way = kicked(aim, s.punch);
  const ev: ShotEv = { k: 'shot', id: `${s.id}:${++s.shots}`, owner: s.id, w: g.id, t, x: eye.x, y: eye.y, z: eye.z, dx: way.x, dy: way.y, dz: way.z, sp: spreadOf(s, m, t), seed: seed >>> 0, stop: 0, hits: [] };
  strike(ev, eye, bodies, see, s.id, g.range, (d) => damageAt(g, d));
  r.mag--;
  // A shotgun's shot stops its reload; a sniper's rifle's takes its scope down till the bolt's worked.
  s.reloadAt = 0;
  s.nextAt = t + g.every;
  s.lastShot = t;
  s.spray += 1;
  s.punch = kickOf(g.recoil, s.spray);
  const st = g.spread;
  s.bloom = clamp(s.bloom + st.bloom, -st.stand * 0.85, 4);
  if (g.scope?.bolt && s.scope) {
    s.rezoom = s.scope;
    s.scope = 0;
  }
  s.safeUntil = 0;
  return ev;
}

// The knife at round ms t, if it may: a slash (or a stab, `heavy`) at whoever's within reach the way
// it aims, worth more from behind them (their back to it: they face the way the blade goes).
export function stab(s: Soldier, eye: V, aim: V, heavy: boolean, t: number, bodies: readonly Body[], see: See): ShotEv | null {
  if (s.hand !== 'knife' || !s.ready(t)) return null;
  const k = heavy ? KNIFE.stab : KNIFE.slash;
  const ev: ShotEv = { k: 'shot', id: `${s.id}:${++s.shots}`, owner: s.id, w: 'knife', t, x: eye.x, y: eye.y, z: eye.z, dx: aim.x, dy: aim.y, dz: aim.z, sp: 0, seed: 0, stop: 0, hits: [], heavy };
  const behind = (id: string) => {
    const b = bodies.find((o) => o.id === id);
    if (b?.yaw === undefined) return false;
    return Math.cos(b.yaw) * aim.x + Math.sin(b.yaw) * aim.z > 0.45;
  };
  strike(ev, eye, bodies, see, s.id, KNIFE.reach, () => k.dmg, 0.12);
  for (const h of ev.hits) {
    const n = behind(h.v) ? k.back : k.dmg;
    h.b = h.b ? n : 0;
    h.h = h.h ? n : 0;
    h.l = h.l ? n : 0;
    // One cut, one part.
    if (h.h) h.b = h.l = 0;
    else if (h.b) h.l = 0;
  }
  // A miss is quicker to come back from than a hit.
  s.nextAt = t + (ev.hits.length ? k.every : k.first * 0.7);
  s.safeUntil = 0;
  return ev;
}

// Where each pellet of a shot that no fighter stopped ends in the world, for its marks and tracers.
export function landed(ev: ShotEv, see: See): Sighted[] {
  const o = v3(ev.x, ev.y, ev.z);
  const max = ev.w === 'knife' ? KNIFE.reach : isGun(ev.w) ? GUNS[ev.w].range : 0;
  return pellets(ev).flatMap((d, p) => (ev.stop & (1 << p) ? [] : [see(o, d, max)]));
}

// Where each pellet a fighter stopped struck them, with whom and the way it went, as a browser draws
// them (`at`, their feet by id, or null for someone it doesn't draw): the point of its way nearest
// the middle of their body, for its tracer and the puff where it struck. A shot hits by where the
// shooter's browser drew them, so the victim as drawn here may be a little off its way.
export function struck(ev: ShotEv, at: (id: string) => V | null): { v: string; p: V; d: V }[] {
  if (!ev.stop) return [];
  const o = v3(ev.x, ev.y, ev.z);
  const out: { v: string; p: V; d: V }[] = [];
  pellets(ev).forEach((d, k) => {
    if (!(ev.stop & (1 << k))) return;
    let best: { v: string; p: V; off: number } | null = null;
    for (const h of ev.hits) {
      const b = at(h.v);
      if (!b) continue;
      const mid = v3(b.x, b.y + (TORSO.y0 + HEAD.y) / 2, b.z);
      const p = addScaled(o, d, Math.max(0, dot(sub(mid, o), d)));
      const off = dist2(p, mid);
      if (!best || off < best.off) best = { v: h.v, p, off };
    }
    if (best) out.push({ v: best.v, p: best.p, d });
  });
  return out;
}

// All the damage a hit did, before armour.
export const hitTotal = (h: Pick<Hit, 'b' | 'h' | 'l'>) => h.b + h.h + h.l;

// ---- The scores ----

export interface Score {
  id: string;
  kills: number;
  deaths: number;
  hs: number; // kills with a shot to the head
  team?: number;
}

// Someone down: a kill to whoever put them down (none for their own doing, nor a team-mate's), a death
// to them.
export function tally(list: Score[], ev: Pick<DownEv, 'victim' | 'by' | 'head'>, add: (id: string) => Score): void {
  const v = list.find((e) => e.id === ev.victim) ?? add(ev.victim);
  v.deaths++;
  if (ev.by === ev.victim) return;
  const k = list.find((e) => e.id === ev.by) ?? add(ev.by);
  if (k.team !== undefined && k.team === v.team) return;
  k.kills++;
  if (ev.head) k.hs++;
}

// The most kills first, then the fewest deaths.
export const byKills = (a: Score, b: Score) => b.kills - a.kills || a.deaths - b.deaths;
