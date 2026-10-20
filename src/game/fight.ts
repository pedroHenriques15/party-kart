// The deathmatch (braga-map's task 074): a round on foot in Fujacal, everyone for themselves, a kit
// chosen at each spawn, the most kills when the time runs out winning. What a kit is and does, a
// fighter's health, a shot and what it hits, where a fighter comes back, and the scores. Pure, like
// the karts' physics, so the tests fight rounds.
//
// A shot is decided by the shooter's browser, against the others as it drew them (110 ms behind, as
// every browser draws the others), and the victim's browser takes the damage: what hit on your screen
// hit. A bullet is instant, so the items' rule (the victim decides) would have shots that hit on the
// shooter's screen miss on the victim's. Every browser draws the shot from the event: its pellets'
// directions come from its seed, so the same marks are left on the same walls everywhere.
import { clamp, cross, norm, v3, type V } from '../math.ts';
import { clear, sight, type Blocker, type Sighted } from '../world/sight.ts';
import { Rings, WorldGround, type Wall } from '../world/ground.ts';
import { Paths } from '../world/paths.ts';
import { EYE, RUN } from './walker.ts';

export type KitId = 'rifle' | 'shotgun' | 'sniper' | 'pistol';
// In the order a snapshot's flags count them (FIGHT.kit).
export const KIT_IDS: KitId[] = ['rifle', 'shotgun', 'sniper', 'pistol'];

export interface Kit {
  name: string;
  article: string; // 'a carabina', for the feed
  blurb: string;
  // A bullet's (or a pellet's) damage to the body up to `near` metres, down to `dmgFar` from `far`
  // metres on; a hit on the head counts `head` times as much, on the legs LEGS times.
  dmg: number;
  dmgFar: number;
  near: number;
  far: number;
  head: number;
  pellets: number;
  every: number; // ms between shots
  auto: boolean; // fires while the trigger's held
  // The cone a shot goes in, its half-angle in degrees: standing still, and how much more running flat
  // out (walking, under a third of it), in the air, and after each shot (up to bloomMax, settling back
  // at `settle` degrees a second).
  spread: number;
  moving: number;
  bloom: number;
  bloomMax: number;
  settle: number;
  // Through the scope: its spread, and how many times it narrows the view.
  scope: { spread: number; zoom: number } | null;
  mag: number;
  reload: number; // ms
  range: number; // m, as far as a bullet goes
}

export const LEGS = 0.75;
const AIR = 3; // degrees more in the air

// None is best everywhere (the tests' duels): the shotgun to 10 m or so, the carabina from there
// to 60 or so, the sniper's rifle past that, scoped and standing still; the pistol shooting on the run.
export const KITS: Record<KitId, Kit> = {
  rifle: { name: 'Carabina', article: 'a carabina', blurb: 'Automática, 30 balas: boa a quase todas as distâncias', dmg: 24, dmgFar: 14, near: 25, far: 70, head: 2, pellets: 1, every: 100, auto: true, spread: 0.5, moving: 4, bloom: 0.4, bloomMax: 3, settle: 7, scope: null, mag: 30, reload: 2300, range: 400 },
  shotgun: { name: 'Caçadeira', article: 'a caçadeira', blurb: 'Dez chumbos de cada vez: mata de perto, não chega longe', dmg: 15, dmgFar: 1, near: 10, far: 35, head: 1.5, pellets: 10, every: 850, auto: false, spread: 2.6, moving: 1.2, bloom: 0, bloomMax: 0, settle: 0, scope: null, mag: 6, reload: 2800, range: 60 },
  sniper: { name: 'Espingarda de precisão', article: 'a espingarda de precisão', blurb: 'Mira telescópica: dois tiros no corpo, um na cabeça', dmg: 60, dmgFar: 55, near: 100, far: 400, head: 2.5, pellets: 1, every: 1200, auto: false, spread: 5, moving: 6, bloom: 0, bloomMax: 0, settle: 0, scope: { spread: 0.03, zoom: 4.5 }, mag: 5, reload: 3000, range: 800 },
  pistol: { name: 'Pistola', article: 'a pistola', blurb: 'Leve e certeira, mesmo a correr', dmg: 30, dmgFar: 18, near: 15, far: 50, head: 2.2, pellets: 1, every: 220, auto: false, spread: 0.8, moving: 0.6, bloom: 0.5, bloomMax: 2, settle: 8, scope: null, mag: 12, reload: 1400, range: 200 },
};

export const HEALTH = 100;
export const REGEN_AFTER = 5000; // ms unhurt before health comes back
const REGEN = 12; // a second
export const RESPAWN = 4000; // ms down before coming back
export const SAFE = 2000; // ms unhurt after coming back, unless it fires first

// A fighter's damage from a kit at d metres, to the body.
export function damage(k: Kit, d: number): number {
  if (d > k.range) return 0;
  return k.dmg + (k.dmgFar - k.dmg) * clamp((d - k.near) / (k.far - k.near), 0, 1);
}

// The flags a fighter on foot sends in its snapshot's `fl`.
export const FIGHT = { down: 1, kit: 2, scoped: 8, reloading: 16, safe: 32, armed: 64 } as const;

// ---- A fighter ----

// One fighter this browser runs: you, or a bot the host runs (task 075).
export class Soldier {
  readonly id: string;
  kit: KitId;
  ammo: number;
  reloadAt = 0; // round ms its reload is done, while reloading
  nextAt = 0; // round ms it may fire again
  bloom = 0; // degrees its shots have spread more
  health = HEALTH;
  hurtAt = -1e9;
  alive = true;
  downAt = 0;
  safeUntil = 0;
  scoped = false;
  shots = 0;

  constructor(id: string, kit: KitId = 'rifle') {
    this.id = id;
    this.kit = kit;
    this.ammo = KITS[kit].mag;
  }

  // Back at t with a kit, whole, safe for a moment.
  arm(kit: KitId, t: number): void {
    this.kit = kit;
    this.ammo = KITS[kit].mag;
    this.reloadAt = 0;
    this.nextAt = t;
    this.bloom = 0;
    this.health = HEALTH;
    this.hurtAt = -1e9;
    this.alive = true;
    this.safeUntil = t + SAFE;
    this.scoped = false;
  }

  get reloading(): boolean {
    return this.reloadAt > 0;
  }

  // A step of dt seconds at round ms t: the spread settling, a reload done, health coming back.
  step(dt: number, t: number): void {
    const k = KITS[this.kit];
    this.bloom = Math.max(0, this.bloom - k.settle * dt);
    if (this.reloadAt && t >= this.reloadAt) {
      this.reloadAt = 0;
      this.ammo = k.mag;
    }
    if (this.alive && this.health < HEALTH && t - this.hurtAt > REGEN_AFTER) this.health = Math.min(HEALTH, this.health + REGEN * dt);
  }

  // Reloads, if the magazine isn't full and it isn't already.
  reload(t: number): boolean {
    if (!this.alive || this.reloading || this.ammo >= KITS[this.kit].mag) return false;
    this.reloadAt = t + KITS[this.kit].reload;
    this.scoped = false;
    return true;
  }

  // Whether it may fire at t: alive, loaded, not reloading, its last shot gone.
  ready(t: number): boolean {
    return this.alive && !this.reloading && this.ammo > 0 && t >= this.nextAt;
  }

  // Hurt by n at t. True if it's the shot that put it down.
  hurt(n: number, t: number): boolean {
    if (!this.alive || t < this.safeUntil || n <= 0) return false;
    this.health -= n;
    this.hurtAt = t;
    if (this.health > 0) return false;
    this.health = 0;
    this.alive = false;
    this.downAt = t;
    this.scoped = false;
    this.reloadAt = 0;
    return true;
  }

  // Its snapshot's flags.
  flags(t: number): number {
    return FIGHT.armed | (this.alive ? 0 : FIGHT.down) | (KIT_IDS.indexOf(this.kit) * FIGHT.kit) | (this.scoped ? FIGHT.scoped : 0) | (this.reloading ? FIGHT.reloading : 0) | (t < this.safeUntil ? FIGHT.safe : 0);
  }
}

// What a snapshot's flags say of a fighter.
export function fighterOf(fl: number): { armed: boolean; down: boolean; kit: KitId; scoped: boolean; reloading: boolean; safe: boolean } {
  return { armed: !!(fl & FIGHT.armed), down: !!(fl & FIGHT.down), kit: KIT_IDS[(fl / FIGHT.kit) & 3], scoped: !!(fl & FIGHT.scoped), reloading: !!(fl & FIGHT.reloading), safe: !!(fl & FIGHT.safe) };
}

// ---- Who's where, and what a bullet hits ----

// A fighter as a shot finds them: their feet.
export interface Body {
  id: string;
  x: number;
  y: number;
  z: number;
}

// The figure's shape (render/drivers.ts's buildWalker: the friends' cartoon figures, 1.75 m tall,
// with their big heads), from the feet: the head a ball, the body and the legs each an upright capsule.
export const HEAD = { y: 1.34, r: 0.34 };
export const TORSO = { y0: 0.62, y1: 0.98, r: 0.27 };
export const LEG = { y0: 0.16, y1: 0.42, r: 0.2 };
export type Part = 'head' | 'body' | 'legs';

// Where the ray from o the way d first meets a fighter standing at b, and where on them, if within max.
export function hitBody(o: V, d: V, b: Body, max: number): { t: number; part: Part } | null {
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
  take(ball(o, d, v3(b.x, b.y + HEAD.y, b.z), HEAD.r), 'head');
  take(capsule(o, d, v3(b.x, b.y + TORSO.y0, b.z), v3(b.x, b.y + TORSO.y1, b.z), TORSO.r), 'body');
  take(capsule(o, d, v3(b.x, b.y + LEG.y0, b.z), v3(b.x, b.y + LEG.y1, b.z), LEG.r), 'legs');
  return best;
}

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

export interface Hit {
  v: string; // who
  n: number; // how much, all its pellets together
  head: boolean;
}

export interface ShotEv {
  k: 'shot';
  id: string;
  owner: string;
  kit: KitId;
  t: number; // round ms
  // From (the eye), the way it was aimed, and the cone's half-angle in radians: with the seed, where
  // each pellet went.
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
}

// Someone put down: by whom, with what, where. Sent by the victim's browser.
export interface DownEv {
  k: 'down';
  id: string;
  victim: string;
  by: string;
  kit: KitId;
  head: boolean;
  x: number;
  y: number;
  z: number;
}

export type FightEv = ShotEv | DownEv;

// A number from 0 to 1 for pellet k's draw j of a shot's seed: the same in every browser.
function rand(seed: number, k: number, j: number): number {
  let h = (seed ^ Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(j + 1, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Each pellet's way, from a shot's aim, cone and seed.
export function pellets(ev: Pick<ShotEv, 'dx' | 'dy' | 'dz' | 'sp' | 'seed' | 'kit'>): V[] {
  const a = norm(v3(ev.dx, ev.dy, ev.dz));
  const u = norm(Math.abs(a.y) < 0.99 ? cross(a, v3(0, 1, 0)) : cross(a, v3(1, 0, 0)));
  const w = cross(u, a);
  const out: V[] = [];
  for (let k = 0; k < KITS[ev.kit].pellets; k++) {
    const r = Math.tan(ev.sp * Math.sqrt(rand(ev.seed, k, 0)));
    const phi = 2 * Math.PI * rand(ev.seed, k, 1);
    const c = r * Math.cos(phi);
    const s = r * Math.sin(phi);
    out.push(norm(v3(a.x + u.x * c + w.x * s, a.y + u.y * c + w.y * s, a.z + u.z * c + w.z * s)));
  }
  return out;
}

// The cone a fighter's next shot goes in, in radians: its kit's, more on the move (speed in m/s) or
// in the air, and its bloom.
export function spreadOf(s: Soldier, speed: number, air: boolean): number {
  const k = KITS[s.kit];
  const base = s.scoped && k.scope ? k.scope.spread : k.spread;
  return ((base + k.moving * clamp(speed / RUN, 0, 1) + (air ? AIR : 0) + s.bloom) * Math.PI) / 180;
}

// How far the world lets a ray go: sight() on the round's ground with the karts in it, or anything
// else (the tests' open ground).
export type See = (o: V, d: V, max: number) => Sighted;

// Fires the fighter's kit from its eye the way it aims (a unit vector) at round ms t, if it may: each
// pellet into the world and at whoever it meets first of `bodies` (the living others). The shot, for
// every browser, with what it hit; or null if it can't fire.
export function fire(s: Soldier, eye: V, aim: V, speed: number, air: boolean, t: number, bodies: readonly Body[], see: See, seed: number): ShotEv | null {
  if (!s.ready(t)) return null;
  const k = KITS[s.kit];
  const ev: ShotEv = { k: 'shot', id: `${s.id}:${++s.shots}`, owner: s.id, kit: s.kit, t, x: eye.x, y: eye.y, z: eye.z, dx: aim.x, dy: aim.y, dz: aim.z, sp: spreadOf(s, speed, air), seed: seed >>> 0, stop: 0, hits: [] };
  const by = new Map<string, Hit>();
  pellets(ev).forEach((d, p) => {
    const w = see(eye, d, k.range);
    let best: { t: number; part: Part; id: string } | null = null;
    for (const b of bodies) {
      if (b.id === s.id) continue;
      const h = hitBody(eye, d, b, best ? best.t : w.t);
      if (h) best = { ...h, id: b.id };
    }
    if (!best) return;
    ev.stop |= 1 << p;
    const n = damage(k, best.t) * (best.part === 'head' ? k.head : best.part === 'legs' ? LEGS : 1);
    const h = by.get(best.id) ?? { v: best.id, n: 0, head: false };
    h.n += n;
    h.head ||= best.part === 'head';
    by.set(best.id, h);
  });
  ev.hits = [...by.values()].map((h) => ({ ...h, n: Math.round(h.n * 10) / 10 }));
  s.ammo--;
  s.nextAt = t + k.every;
  s.bloom = Math.min(k.bloomMax, s.bloom + k.bloom);
  s.safeUntil = 0;
  return ev;
}

// Where each pellet of a shot that no fighter stopped ends in the world, for its marks and tracers.
export function landed(ev: ShotEv, see: See): Sighted[] {
  const o = v3(ev.x, ev.y, ev.z);
  return pellets(ev).flatMap((d, p) => (ev.stop & (1 << p) ? [] : [see(o, d, KITS[ev.kit].range)]));
}

// ---- The scores ----

export interface Score {
  id: string;
  kills: number;
  deaths: number;
}

// Someone down: a kill to whoever put them down (none for their own doing), a death to them.
export function tally(list: Score[], ev: Pick<DownEv, 'victim' | 'by'>, add: (id: string) => Score): void {
  const v = list.find((e) => e.id === ev.victim) ?? add(ev.victim);
  v.deaths++;
  if (ev.by === ev.victim) return;
  const k = list.find((e) => e.id === ev.by) ?? add(ev.by);
  k.kills++;
}

// The most kills first, then the fewest deaths.
export const byKills = (a: Score, b: Score) => b.kills - a.kills || a.deaths - b.deaths;

// ---- Where the round is played ----

// The round's arena as braga-map gives it (world.arenas, its task 079): its edge, and where streets
// and paths cross it.
export interface Area {
  pts: [number, number][];
  gates: { x: number; z: number; heading: number; w: number; k: number; level: string; y: number }[];
}

export interface Spawn {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

// The round's ground and what's stood for it: the world's, with the arena's edge a wall at every
// level; the places a fighter comes back at; and where the edge is drawn, a railing where someone on
// foot can reach it and a barrier across each street and path it crosses (gates).
export interface Field {
  ground: WorldGround;
  inside: (x: number, z: number) => boolean;
  spawns: Spawn[];
  // Where someone on foot can walk in it, all of it reached from the spawns and reaching them: for the
  // bots (braga-map's task 075), and to keep the spawns out of a garden or a yard nothing else reaches.
  paths: Paths;
  rails: { x: number; y: number; z: number }[][];
  gates: { x: number; y: number; z: number; heading: number; w: number }[];
}

// How far apart the spawns are at least, how far in from the edge, and how many: an arena is about
// 80 m across (braga-map's task 079).
const SPAWN_GAP = 12;
const SPAWN_IN = 3;
const SPAWNS = 8;

export function field(world: WorldGround, area: Area): Field {
  const pts = area.pts;
  // Whether a point is in the area: the map's own test takes a few microseconds, this a fraction of
  // one, for every step of everyone on foot and every point of the bots' paths.
  const ring = new Rings([pts]);
  const inside = (x: number, z: number) => ring.has(x, z);
  const edge: Wall[] = pts.map(([ax, az], k) => {
    const [bx, bz] = pts[(k + 1) % pts.length];
    return { ax, az, bx, bz, y0: -1e4, y1: 1e4, open: true };
  });
  const ground = new WorldGround(world.d, null, edge);
  const toEdge = (x: number, z: number) => {
    let d = Infinity;
    for (const w of edge) {
      const ex = w.bx - w.ax;
      const ez = w.bz - w.az;
      const L = ex * ex + ez * ez;
      const t = L ? clamp(((x - w.ax) * ex + (z - w.az) * ez) / L, 0, 1) : 0;
      d = Math.min(d, Math.hypot(w.ax + ex * t - x, w.az + ez * t - z));
    }
    return d;
  };

  // The spawns: points every 3 m over the arena, outdoors (not in a building, nor a room), in from
  // its edge, on the ground with room to stand, facing its middle; the most spread out of them, each
  // the furthest from those taken.
  let cx = 0;
  let cz = 0;
  for (const [x, z] of pts) {
    cx += x / pts.length;
    cz += z / pts.length;
  }
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const built = new Rings(world.d.world.buildings.filter((b) => b.pts.some(([x, z]) => x > Math.min(...xs) - 60 && x < Math.max(...xs) + 60 && z > Math.min(...zs) - 60 && z < Math.max(...zs) + 60)).map((b) => b.pts));
  const cand: Spawn[] = [];
  for (let x = Math.min(...xs) + 1.5; x < Math.max(...xs); x += 3) {
    for (let z = Math.min(...zs) + 1.5; z < Math.max(...zs); z += 3) {
      if (!inside(x, z) || toEdge(x, z) < SPAWN_IN || (built.has(x, z) && !world.d.cuts.has(x, z)) || world.roomAt(x, z)) continue;
      const f = ground.floor(x, z, ground.groundAt(x, z) + 0.5);
      if (f.buried || ground.circle(x, z, x, z, f.y, 0.6, 1.75, true)) continue;
      const r = world.d.land.riverAt(x, z);
      if (r.d < world.d.land.HW && f.y < r.y - 0.3) continue;
      cand.push({ x, y: f.y, z, yaw: Math.atan2(cz - z, cx - x) });
    }
  }
  // Only those on the arena's ground that the rest of it reaches, and that reach it: the walkable
  // ground round the candidate nearest its middle, or the next nearest, as long as it's most of what
  // the candidates are on.
  const box = { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
  const near = (P: Paths, c: Spawn) => {
    const p = P.near(c.x, c.z, c.y);
    return p >= 0 && Math.hypot(P.x[p] - c.x, P.z[p] - c.z) < 2.2 && Math.abs(P.y[p] - c.y) < 0.6;
  };
  const all = new Paths(ground, inside, box, cand);
  const byMiddle = [...cand].sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
  let paths: Paths | null = null;
  for (const c of byMiddle.slice(0, 12)) {
    const P = new Paths(ground, inside, box, [c]);
    if (!paths || P.n > paths.n) paths = P;
    if (P.n > all.n * 0.6) break;
  }
  paths ??= all;
  const on = cand.filter((c) => near(paths, c));
  cand.length = 0;
  cand.push(...on);
  const spawns: Spawn[] = [];
  if (cand.length) {
    // From the one nearest the middle.
    let first = cand[0];
    for (const c of cand) if (Math.hypot(c.x - cx, c.z - cz) < Math.hypot(first.x - cx, first.z - cz)) first = c;
    spawns.push(first);
    const gap = cand.map((c) => Math.hypot(c.x - first.x, c.z - first.z));
    while (spawns.length < SPAWNS) {
      let k = -1;
      for (let i = 0; i < cand.length; i++) if (k < 0 || gap[i] > gap[k]) k = i;
      if (k < 0 || gap[k] < SPAWN_GAP) break;
      const s = cand[k];
      spawns.push(s);
      cand.forEach((c, i) => (gap[i] = Math.min(gap[i], Math.hypot(c.x - s.x, c.z - s.z))));
    }
  }

  // The railing: the stretches of the edge where the ground half a metre in is somewhere to stand,
  // away from the gates, in runs, a point a metre.
  const gates = area.gates.map((g) => {
    const f = ground.floor(g.x, g.z, g.y + 0.5);
    return { x: g.x, y: f.buried ? g.y : f.y, z: g.z, heading: g.heading, w: g.w };
  });
  const rails: Field['rails'] = [];
  let run: Field['rails'][number] = [];
  const end = () => {
    if (run.length > 1) rails.push(run);
    run = [];
  };
  for (let k = 0; k < pts.length; k++) {
    const [ax, az] = pts[k];
    const [bx, bz] = pts[(k + 1) % pts.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) continue;
    const n = Math.max(1, Math.round(L));
    let nx = -(bz - az) / L;
    let nz = (bx - ax) / L;
    if (!inside((ax + bx) / 2 + nx * 0.5, (az + bz) / 2 + nz * 0.5)) [nx, nz] = [-nx, -nz];
    for (let i = 0; i <= n; i++) {
      if (i === 0 && k > 0) continue;
      const x = ax + ((bx - ax) * i) / n;
      const z = az + ((bz - az) * i) / n;
      const ix = x + nx * 0.5;
      const iz = z + nz * 0.5;
      const f = ground.floor(ix, iz, ground.groundAt(ix, iz) + 0.5);
      const reach = !f.buried && !world.circle(ix, iz, ix, iz, f.y, 0.3, 1.75, true) && !gates.some((g) => Math.hypot(g.x - x, g.z - z) < g.w / 2 + 1.2);
      if (!reach) {
        end();
        continue;
      }
      const y = ground.floor(x, z, f.y + 0.5);
      run.push({ x, y: y.buried ? f.y : y.y, z });
    }
  }
  end();
  // The buildings' roofs, which a look and a shot need, indexed now rather than at the first of them
  // (15 ms).
  if (spawns.length) sight(ground, eyeOf(spawns[0]), v3(1, 0, 0), 1);
  return { ground, inside, spawns, paths, rails, gates };
}

// Where a fighter's eye is, standing at b.
export const eyeOf = (b: { x: number; y: number; z: number }): V => v3(b.x, b.y + EYE, b.z);

// The spawn to come back at: one none of the others (the living) can see, the furthest from the
// nearest of them; else the furthest. A little luck between those alike.
export function pickSpawn(f: Field, others: readonly Body[], blockers: readonly Blocker[] = [], luck: () => number = Math.random): Spawn {
  if (!others.length) return f.spawns[Math.floor(luck() * f.spawns.length)];
  const scored = f.spawns.map((s) => ({ s, d: Math.min(...others.map((o) => Math.hypot(o.x - s.x, o.z - s.z))) + luck() * 8 })).sort((a, b) => b.d - a.d);
  for (const { s } of scored) {
    const seen = others.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 300 && clear(f.ground, eyeOf(o), eyeOf(s), blockers));
    if (!seen) return s;
  }
  return scored[0].s;
}

// How far the world lets a shot go on the round's ground, the karts in it.
export const seeOn = (f: Field, blockers: readonly Blocker[] = []): See => (o, d, max) => sight(f.ground, o, d, max, blockers);
