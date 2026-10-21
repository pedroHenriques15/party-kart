// The deathmatch's arsenal, after Counter-Strike 2's: twenty guns in six families, the knife, four
// grenades and armour, each with its price (the round's money is unlimited, but a price says what a
// gun is worth), its damage and how armour takes it, its rate of fire, its magazine and reserve, its
// reload and its draw, how fast it lets you run, how its shots spread standing, crouched, moving and in
// the air, and its recoil: a spray pattern each automatic climbs and sways along, the same every time,
// so a player learns to pull against it. Pure data and the sums on it, so the tests fight with it.
import { clamp } from '../math.ts';

export type Family = 'pistol' | 'smg' | 'rifle' | 'sniper' | 'shotgun' | 'heavy';
export type GunId = 'glock' | 'usp' | 'p250' | 'deagle' | 'mac10' | 'mp9' | 'ump' | 'p90' | 'galil' | 'famas' | 'ak47' | 'm4a4' | 'm4a1s' | 'sg553' | 'aug' | 'ssg08' | 'awp' | 'nova' | 'xm1014' | 'negev';
export type NadeId = 'he' | 'flash' | 'smoke' | 'molotov';
export type WeaponId = GunId | 'knife' | NadeId;
// What put someone down that isn't a weapon in a hand: a fall, or the bomb (the competitive mode's,
// game/comp.ts); or the fire's left after its thrower.
export type Cause = WeaponId | 'fall' | 'c4';

// In the order a snapshot's flags count them (FIGHT.weapon): never reorder, only add at the end.
export const WEAPON_IDS: WeaponId[] = ['knife', 'glock', 'usp', 'p250', 'deagle', 'mac10', 'mp9', 'ump', 'p90', 'galil', 'famas', 'ak47', 'm4a4', 'm4a1s', 'sg553', 'aug', 'ssg08', 'awp', 'nova', 'xm1014', 'negev', 'he', 'flash', 'smoke', 'molotov'];
export const NADE_IDS: NadeId[] = ['he', 'flash', 'smoke', 'molotov'];

// Counter-Strike's units (an inch, its figure 72 of them tall) in the game's metres, a little slower
// than they'd be: Braga's streets are narrower than a map's.
const U = 0.0216;

export interface Spread {
  // A shot's cone, its half-angle in degrees: standing still, crouched still, and how much more running
  // flat out (none below a third of the gun's top speed: Counter-Strike's accurate walk) and in the air.
  stand: number;
  crouch: number;
  move: number;
  air: number;
  // How much more each shot spreads the next, and how fast that settles (degrees a second).
  bloom: number;
  settle: number;
}

export interface Recoil {
  // The spray: how far each shot kicks the aim up (degrees) at first, the most it climbs, how wide it
  // sways once it's up, and which way it sways first; and how fast the kick comes back after the last
  // shot (its time constant, s).
  up: number;
  top: number;
  sway: number;
  lean: number;
  back: number;
}

export interface Scope {
  // How many times each zoom narrows the view; the cone through it, and how long the scope takes to
  // come up before it's that (ms): before, the shot's as unscoped. Its running speed scoped. Whether a
  // shot takes it down till the bolt's worked (a sniper's rifle).
  zooms: number[];
  spread: number;
  settle: number;
  speed: number;
  bolt: boolean;
}

export interface Gun {
  id: GunId;
  name: string;
  family: Family;
  slot: 'primary' | 'secondary';
  price: number;
  // A bullet's (or a pellet's) damage: to the body at the muzzle, the share of it kept every 10 m
  // (Counter-Strike's range modifier), the share that gets through armour (the rest the armour takes,
  // at half), and as far as it goes.
  dmg: number;
  keep: number;
  pen: number;
  range: number;
  pellets: number;
  every: number; // ms between shots
  auto: boolean;
  mag: number;
  reserve: number;
  reload: number; // ms; a shotgun's, each shell
  shells: boolean; // reloaded a shell at a time, and a shot stops it
  draw: number; // ms from taking it out to firing it
  speed: number; // m/s, running with it out
  spread: Spread;
  recoil: Recoil;
  scope: Scope | null;
  silenced: boolean;
  blurb: string;
}

const pistol = (s: Partial<Spread> = {}): Spread => ({ stand: 0.35, crouch: 0.25, move: 2.2, air: 6, bloom: 1.1, settle: 6, ...s });
const smg = (s: Partial<Spread> = {}): Spread => ({ stand: 0.6, crouch: 0.45, move: 2.2, air: 6, bloom: 0.35, settle: 7, ...s });
const rifle = (s: Partial<Spread> = {}): Spread => ({ stand: 0.18, crouch: 0.12, move: 5.5, air: 9, bloom: 0.28, settle: 6, ...s });

export const GUNS: Record<GunId, Gun> = {
  glock: { id: 'glock', name: 'Glock-18', family: 'pistol', slot: 'secondary', price: 200, dmg: 30, keep: 0.88, pen: 0.47, range: 200, pellets: 1, every: 150, auto: false, mag: 20, reserve: 120, reload: 2270, shells: false, draw: 900, speed: 240 * U, spread: pistol({ stand: 0.45, bloom: 0.9 }), recoil: { up: 0.9, top: 3, sway: 0.4, lean: 1, back: 0.18 }, scope: null, silenced: false, blurb: 'Leve e rápida, 20 balas' },
  usp: { id: 'usp', name: 'USP-S', family: 'pistol', slot: 'secondary', price: 200, dmg: 35, keep: 0.99, pen: 0.505, range: 200, pellets: 1, every: 170, auto: false, mag: 12, reserve: 24, reload: 2200, shells: false, draw: 900, speed: 240 * U, spread: pistol({ stand: 0.2, bloom: 1 }), recoil: { up: 1.1, top: 3, sway: 0.3, lean: -1, back: 0.2 }, scope: null, silenced: true, blurb: 'Silenciada e certeira' },
  p250: { id: 'p250', name: 'P250', family: 'pistol', slot: 'secondary', price: 300, dmg: 38, keep: 0.9, pen: 0.64, range: 200, pellets: 1, every: 150, auto: false, mag: 13, reserve: 26, reload: 2200, shells: false, draw: 900, speed: 240 * U, spread: pistol({ stand: 0.35, bloom: 1.3 }), recoil: { up: 1.3, top: 3.5, sway: 0.5, lean: 1, back: 0.2 }, scope: null, silenced: false, blurb: 'Fura o colete' },
  deagle: { id: 'deagle', name: 'Desert Eagle', family: 'pistol', slot: 'secondary', price: 700, dmg: 53, keep: 0.84, pen: 0.932, range: 300, pellets: 1, every: 225, auto: false, mag: 7, reserve: 35, reload: 2200, shells: false, draw: 1100, speed: 230 * U, spread: pistol({ stand: 0.22, move: 3.5, bloom: 3.2, settle: 4.5 }), recoil: { up: 3.4, top: 6, sway: 0.8, lean: 1, back: 0.3 }, scope: null, silenced: false, blurb: 'Um tiro na cabeça chega' },
  mac10: { id: 'mac10', name: 'MAC-10', family: 'smg', slot: 'primary', price: 1050, dmg: 29, keep: 0.8, pen: 0.575, range: 150, pellets: 1, every: 75, auto: true, mag: 30, reserve: 100, reload: 2600, shells: false, draw: 900, speed: 240 * U, spread: smg({ stand: 0.75, move: 1.6 }), recoil: { up: 0.35, top: 4, sway: 1.4, lean: -1, back: 0.25 }, scope: null, silenced: false, blurb: 'Despeja balas a correr' },
  mp9: { id: 'mp9', name: 'MP9', family: 'smg', slot: 'primary', price: 1250, dmg: 26, keep: 0.87, pen: 0.6, range: 150, pellets: 1, every: 70, auto: true, mag: 30, reserve: 120, reload: 2100, shells: false, draw: 900, speed: 240 * U, spread: smg({ move: 1.7 }), recoil: { up: 0.33, top: 3.6, sway: 1.1, lean: 1, back: 0.25 }, scope: null, silenced: false, blurb: 'A mais rápida das pequenas' },
  ump: { id: 'ump', name: 'UMP-45', family: 'smg', slot: 'primary', price: 1200, dmg: 35, keep: 0.77, pen: 0.65, range: 150, pellets: 1, every: 90, auto: true, mag: 25, reserve: 100, reload: 3500, shells: false, draw: 1000, speed: 230 * U, spread: smg({ stand: 0.5 }), recoil: { up: 0.42, top: 4.2, sway: 1, lean: -1, back: 0.25 }, scope: null, silenced: false, blurb: 'Balas pesadas para uma pequena' },
  p90: { id: 'p90', name: 'P90', family: 'smg', slot: 'primary', price: 2350, dmg: 26, keep: 0.86, pen: 0.69, range: 150, pellets: 1, every: 70, auto: true, mag: 50, reserve: 100, reload: 3300, shells: false, draw: 1000, speed: 230 * U, spread: smg({ stand: 0.55 }), recoil: { up: 0.26, top: 3.2, sway: 1.2, lean: 1, back: 0.25 }, scope: null, silenced: false, blurb: '50 balas sem parar' },
  galil: { id: 'galil', name: 'Galil AR', family: 'rifle', slot: 'primary', price: 1800, dmg: 30, keep: 0.98, pen: 0.775, range: 400, pellets: 1, every: 90, auto: true, mag: 35, reserve: 90, reload: 3000, shells: false, draw: 1000, speed: 215 * U, spread: rifle({ stand: 0.3, move: 5 }), recoil: { up: 0.5, top: 5.5, sway: 1.5, lean: -1, back: 0.3 }, scope: null, silenced: false, blurb: 'A espingarda barata, 35 balas' },
  famas: { id: 'famas', name: 'FAMAS', family: 'rifle', slot: 'primary', price: 2050, dmg: 30, keep: 0.96, pen: 0.7, range: 400, pellets: 1, every: 90, auto: true, mag: 25, reserve: 90, reload: 3300, shells: false, draw: 1000, speed: 220 * U, spread: rifle({ stand: 0.28, move: 5 }), recoil: { up: 0.48, top: 5, sway: 1.3, lean: 1, back: 0.3 }, scope: null, silenced: false, blurb: 'Leve e rápida a disparar' },
  ak47: { id: 'ak47', name: 'AK-47', family: 'rifle', slot: 'primary', price: 2700, dmg: 36, keep: 0.98, pen: 0.775, range: 500, pellets: 1, every: 100, auto: true, mag: 30, reserve: 90, reload: 2500, shells: false, draw: 1000, speed: 215 * U, spread: rifle({ stand: 0.2, move: 6.5, bloom: 0.32 }), recoil: { up: 0.62, top: 7, sway: 2.2, lean: 1, back: 0.32 }, scope: null, silenced: false, blurb: 'Um tiro na cabeça, mesmo de capacete' },
  m4a4: { id: 'm4a4', name: 'M4A4', family: 'rifle', slot: 'primary', price: 3100, dmg: 33, keep: 0.97, pen: 0.7, range: 500, pellets: 1, every: 90, auto: true, mag: 30, reserve: 90, reload: 3100, shells: false, draw: 1000, speed: 225 * U, spread: rifle({ stand: 0.16, move: 5.5 }), recoil: { up: 0.5, top: 5.5, sway: 1.6, lean: -1, back: 0.3 }, scope: null, silenced: false, blurb: 'Certeira e mansa' },
  m4a1s: { id: 'm4a1s', name: 'M4A1-S', family: 'rifle', slot: 'primary', price: 2900, dmg: 38, keep: 0.99, pen: 0.7, range: 500, pellets: 1, every: 100, auto: true, mag: 20, reserve: 80, reload: 3100, shells: false, draw: 1000, speed: 225 * U, spread: rifle({ stand: 0.13, move: 5.5, bloom: 0.22 }), recoil: { up: 0.4, top: 4.5, sway: 1.1, lean: -1, back: 0.3 }, scope: null, silenced: true, blurb: 'Silenciada, sem rasto' },
  sg553: { id: 'sg553', name: 'SG 553', family: 'rifle', slot: 'primary', price: 3000, dmg: 30, keep: 0.98, pen: 1, range: 500, pellets: 1, every: 110, auto: true, mag: 30, reserve: 90, reload: 2800, shells: false, draw: 1000, speed: 210 * U, spread: rifle({ stand: 0.2, move: 6 }), recoil: { up: 0.55, top: 6, sway: 1.8, lean: 1, back: 0.32 }, scope: { zooms: [1.6], spread: 0.08, settle: 150, speed: 150 * U, bolt: false }, silenced: false, blurb: 'Com mira: atravessa o colete' },
  aug: { id: 'aug', name: 'AUG', family: 'rifle', slot: 'primary', price: 3300, dmg: 28, keep: 0.98, pen: 0.9, range: 500, pellets: 1, every: 100, auto: true, mag: 30, reserve: 90, reload: 3800, shells: false, draw: 1000, speed: 220 * U, spread: rifle({ stand: 0.18, move: 5.5 }), recoil: { up: 0.45, top: 5, sway: 1.3, lean: -1, back: 0.3 }, scope: { zooms: [1.6], spread: 0.07, settle: 150, speed: 150 * U, bolt: false }, silenced: false, blurb: 'Com mira, mansa a disparar' },
  ssg08: { id: 'ssg08', name: 'SSG 08', family: 'sniper', slot: 'primary', price: 1700, dmg: 88, keep: 0.98, pen: 0.85, range: 900, pellets: 1, every: 1250, auto: false, mag: 10, reserve: 90, reload: 3700, shells: false, draw: 1100, speed: 230 * U, spread: { stand: 1.6, crouch: 1.3, move: 5, air: 0.05, bloom: 0, settle: 0 }, recoil: { up: 2.5, top: 2.5, sway: 0, lean: 1, back: 0.35 }, scope: { zooms: [2.25, 6], spread: 0.02, settle: 100, speed: 230 * U, bolt: true }, silenced: false, blurb: 'Leve: no ar, ainda acerta' },
  awp: { id: 'awp', name: 'AWP', family: 'sniper', slot: 'primary', price: 4750, dmg: 115, keep: 0.99, pen: 0.975, range: 900, pellets: 1, every: 1460, auto: false, mag: 5, reserve: 30, reload: 3700, shells: false, draw: 1300, speed: 200 * U, spread: { stand: 4, crouch: 3.2, move: 9, air: 12, bloom: 0, settle: 0 }, recoil: { up: 4, top: 4, sway: 0, lean: 1, back: 0.4 }, scope: { zooms: [2.25, 9], spread: 0.015, settle: 140, speed: 100 * U, bolt: true }, silenced: false, blurb: 'Um tiro no corpo, sem mira é sorte' },
  nova: { id: 'nova', name: 'Nova', family: 'shotgun', slot: 'primary', price: 1050, dmg: 26, keep: 0.7, pen: 0.5, range: 60, pellets: 9, every: 880, auto: false, mag: 8, reserve: 32, reload: 500, shells: true, draw: 1000, speed: 220 * U, spread: { stand: 3.4, crouch: 3.2, move: 1.2, air: 3, bloom: 0, settle: 0 }, recoil: { up: 3, top: 3, sway: 0, lean: 1, back: 0.35 }, scope: null, silenced: false, blurb: 'De bomba, nove chumbos' },
  xm1014: { id: 'xm1014', name: 'XM1014', family: 'shotgun', slot: 'primary', price: 2000, dmg: 20, keep: 0.7, pen: 0.8, range: 60, pellets: 6, every: 350, auto: true, mag: 7, reserve: 32, reload: 420, shells: true, draw: 1000, speed: 215 * U, spread: { stand: 3.6, crouch: 3.4, move: 1.4, air: 3, bloom: 0.4, settle: 4 }, recoil: { up: 2, top: 4, sway: 0.6, lean: 1, back: 0.3 }, scope: null, silenced: false, blurb: 'Automática: limpa uma sala' },
  negev: { id: 'negev', name: 'Negev', family: 'heavy', slot: 'primary', price: 1700, dmg: 35, keep: 0.97, pen: 0.71, range: 400, pellets: 1, every: 75, auto: true, mag: 150, reserve: 300, reload: 5700, shells: false, draw: 1200, speed: 150 * U, spread: { stand: 1.6, crouch: 1.2, move: 5, air: 9, bloom: -0.1, settle: 2.5 }, recoil: { up: 0.25, top: 3, sway: 1, lean: 1, back: 0.4 }, scope: null, silenced: false, blurb: '150 balas: acerta mais quanto mais dispara' },
};

export const GUN_IDS = Object.keys(GUNS) as GunId[];

// The buy menu's families, in its order, as Counter-Strike lays them out.
export const FAMILIES: { id: Family; name: string; key: string }[] = [
  { id: 'pistol', name: 'Pistolas', key: '1' },
  { id: 'smg', name: 'Pistolas-metralhadoras', key: '2' },
  { id: 'rifle', name: 'Espingardas', key: '3' },
  { id: 'sniper', name: 'Precisão', key: '4' },
  { id: 'shotgun', name: 'Caçadeiras', key: '5' },
  { id: 'heavy', name: 'Pesadas', key: '6' },
];

// The knife: a quick slash (the left button) or a heavy stab (the right), worth more from behind.
export const KNIFE = {
  name: 'Faca',
  slash: { dmg: 40, back: 90, every: 400, first: 500 },
  stab: { dmg: 65, back: 180, every: 1000, first: 1000 },
  reach: 1.9,
  speed: 250 * U,
  draw: 600,
} as const;

export interface Nade {
  id: NadeId;
  name: string;
  price: number;
  max: number; // carried at most
  fuse: number; // ms from the throw; 0 for when it comes to rest (a smoke) or lands (a molotov)
  blurb: string;
}

export const NADES: Record<NadeId, Nade> = {
  he: { id: 'he', name: 'Granada', price: 300, max: 1, fuse: 1600, blurb: 'Rebenta: até 98 de perto' },
  flash: { id: 'flash', name: 'Flash', price: 200, max: 2, fuse: 1600, blurb: 'Cega quem olhar para ela' },
  smoke: { id: 'smoke', name: 'Fumo', price: 300, max: 1, fuse: 0, blurb: 'Uma nuvem que ninguém vê através' },
  molotov: { id: 'molotov', name: 'Molotov', price: 400, max: 1, fuse: 0, blurb: 'Fogo no chão por 7 s' },
};
// How many grenades a fighter carries at most, of every kind together.
export const NADES_MAX = 4;

export const ARMOUR = { vest: { name: 'Colete', price: 650 }, helmet: { name: 'Colete e capacete', price: 1000 } } as const;

// A hit on the head counts this many times a body's, on the legs this.
export const HEAD = 4;
export const LEGS = 0.75;

// What a fighter comes back with: the guns, the grenades and the armour they chose, kept from one life
// to the next (Counter-Strike's deathmatch: the guns are free, chosen once).
export interface Loadout {
  primary: GunId | null;
  secondary: GunId;
  nades: NadeId[];
  armour: 0 | 1 | 2; // none, a vest, a vest and a helmet
}

export const START: Loadout = { primary: 'ak47', secondary: 'usp', nades: [], armour: 2 };

export function isGun(w: WeaponId | Cause): w is GunId {
  return w in GUNS;
}
export function isNade(w: WeaponId | Cause): w is NadeId {
  return w in NADES;
}

export function nameOf(w: Cause): string {
  if (w === 'fall') return 'uma queda';
  if (w === 'c4') return 'A bomba';
  if (w === 'knife') return KNIFE.name;
  return isGun(w) ? GUNS[w].name : NADES[w].name;
}

// How fast someone runs with a weapon out, scoped or not.
export function speedWith(w: WeaponId, scoped: boolean): number {
  if (w === 'knife') return KNIFE.speed;
  if (!isGun(w)) return 245 * U;
  const g = GUNS[w];
  return scoped && g.scope ? g.scope.speed : g.speed;
}

// A bullet's damage to the body from a gun at d metres, before armour: its range modifier, every 10 m.
export function damageAt(g: Gun, d: number): number {
  if (d > g.range) return 0;
  return g.dmg * Math.pow(g.keep, d / 10);
}

// What a hit does through armour (Counter-Strike's): the health lost, and the armour. Armour covers the
// body, and the head with a helmet; the legs never.
export function throughArmour(n: number, pen: number, armour: number, covered: boolean): { health: number; armour: number } {
  if (!covered || armour <= 0) return { health: n, armour: 0 };
  let health = n * pen;
  let worn = (n - health) * 0.5;
  if (worn > armour) {
    health += (worn - armour) * 2;
    worn = armour;
  }
  return { health, armour: worn };
}

// The kick of the k-th shot of a spray (k from 1), in degrees: across (to the right) and up. It climbs
// at `up` a shot, more slowly as it nears `top`, then sways side to side, wider as it goes, the first
// way `lean` says, as a gun's own pattern always does.
export function kickOf(r: Recoil, k: number): { x: number; y: number } {
  if (k <= 0) return { x: 0, y: 0 };
  const y = r.top * (1 - Math.exp((-k * r.up) / r.top));
  const rise = Math.min(1, (k - 1) / 9);
  // Up the first shots with a slight drift, then the sway: a slow swing with a quicker wobble on it.
  const swing = k < 10 ? 0.12 * (k - 1) * r.lean : r.lean * (1.1 * Math.sin((k - 10) * 0.32 + 0.9) + 0.25 * Math.sin((k - 10) * 1.3));
  return { x: r.sway * swing * (0.4 + 0.6 * rise), y };
}

// The cone of the next shot, in degrees, as the arsenal's numbers make it: standing or crouched, the
// speed past a third of the gun's top one, in the air, and the bloom of the shots before.
export function coneOf(g: Gun, o: { speed: number; air: boolean; crouch: boolean; scoped: boolean; scopedFor: number; bloom: number }): number {
  const s = g.spread;
  let base = o.crouch ? s.crouch : s.stand;
  if (g.scope && o.scoped && o.scopedFor >= g.scope.settle) base = g.scope.spread;
  const top = speedWith(g.id, o.scoped);
  const moving = s.move * clamp((o.speed - top * 0.34) / (top * 0.66), 0, 1);
  return Math.max(0, base + moving + (o.air ? s.air : 0) + o.bloom);
}

// How long a weapon takes to come out, ms.
export function drawOf(w: WeaponId): number {
  return isGun(w) ? GUNS[w].draw : w === 'knife' ? KNIFE.draw : 450;
}
