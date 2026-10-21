// The bots on foot (braga-map's task 075): the deathmatch's empty places filled, as the race's are,
// run by the host, playing as Counter-Strike's bots do. A bot has a taste in guns and comes back with
// a loadout from it each time, finds its way round the arena on the walkable ground (world/paths.ts),
// looks for someone, turns to a shot or a footstep it hears and to a hit, aims with a reaction time
// and an error that shrink with its skill, pulls against its gun's recoil as well as its skill lets
// it, stops dead to shoot (a counter-strafe), taps at range and sprays up close, crouches to spray
// far, scopes a sniper's rifle and waits for it to settle, swaps to its pistol when it runs dry,
// reloads behind cover, throws a grenade at someone it heard round a corner or a flash before it
// pushes, can't see through smoke or while it's flashed, and walks out of a fire. It sees only what a
// look lets it see (world/sight.ts), and it shoots as a player does: fire() from its eye the way it
// looks, its gun's spread and recoil and all. Pure, like the karts' physics, so the tests fight rounds
// of bots.
import { angleDiff, clamp, norm, v3, type V } from '../math.ts';
import type { Paths } from '../world/paths.ts';
import { clear, type Blocker } from '../world/sight.ts';
import { GUNS, isGun, isNade, KNIFE, speedWith, type Family, type Gun, type GunId, type Loadout, type NadeId } from './arsenal.ts';
import { pickSpawn, seeOn, type Field, type Spawn } from './field.ts';
import { chestOf, fire, headOf, kicked, RESPAWN, Soldier, stab, type Body, type DownEv, type FightEv, type ShotEv } from './fight.ts';
import { blast, blinding, FIRE, fly, hidden, inFire, LOB, THROW, throwOf, toss, type Blaze, type Cloud, type Flight, type NadeEv } from './nades.ts';
import { HEIGHT, RADIUS, STAND, Walker, type WalkInput } from './walker.ts';

// The bots' levels, as the round's settings offer them.
export const SKILLS = ['Fácil', 'Médio', 'Difícil'] as const;

// Someone a bot might see and shoot: where they stand, which way they face and how far they're
// crouched (a Body's), how fast they go (for their footsteps), and their team in a team round.
export interface Mark extends Body {
  spd: number;
  team?: number;
}

// What's burning and smoking in the round, for the bots' eyes and feet: the smokes' clouds and the
// molotovs' fires. And a fire as the bots are hurt by it: whose it is, for the kill.
export interface Hazards {
  clouds: readonly Cloud[];
  fires: readonly Blaze[];
}
export type Burning = Blaze & { owner: string };
const NONE: Hazards = { clouds: [], fires: [] };

const deg = Math.PI / 180;
const mix = (a: number, b: number, s: number) => a + (b - a) * s;
// The same, the middle the two's geometric mean: for an error, the middle level's nearer the best's.
const gmix = (a: number, b: number, s: number) => a * Math.pow(b / a, s);

// What a level of skill (0 the lowest, 1 the highest) makes of a bot.
interface Skill {
  level: number;
  react: number; // s from seeing someone to the first shot
  err: number; // rad off at first, aiming at someone just seen; it settles on them
  settle: number; // s, as quickly as this (a time constant)
  shake: number; // rad off, however long it has aimed
  lag: number; // s its aim trails someone moving
  turn: number; // rad/s, the fastest it turns
  fov: number; // rad, half its field of view
  far: number; // m, the furthest it sees someone
  control: number; // how much of its gun's recoil it pulls against, 0 to 1
  stop: number; // how likely it is to stop dead to shoot (a counter-strafe), each fight
  crouch: number; // how likely it is to crouch to spray at range, each fight
  scoped: number; // ms it waits past its scope's settling before a scoped shot
  pace: number; // s more between a semi-automatic's shots than the gun needs
  burst: number; // an automatic's shots in a burst at middle range
  tap: number; // and far off
  rest: number; // s between bursts
  strafe: number; // how likely it is to move across between its shots
  head: number; // how likely it is to aim at the head
  hurt: number; // health under which a hit sends it into cover
  ears: number; // how far it hears, as a part of the most
  nade: number; // how likely it is to throw a grenade it could, at each look
  sneak: number; // how likely it is to walk quietly up to someone it heard
  knife: number; // how likely it is to knife someone up close while its gun's empty
  flinch: number; // how likely it is to look away from its own flash
}

export function skillOf(s: number): Skill {
  s = clamp(s, 0, 1);
  return {
    level: s,
    react: mix(0.85, 0.2, s),
    err: gmix(11, 3, s) * deg,
    settle: gmix(1.1, 0.3, s),
    shake: gmix(1.5, 0.25, s) * deg,
    lag: mix(0.35, 0.06, s),
    turn: mix(150, 480, s) * deg,
    fov: mix(50, 70, s) * deg,
    far: mix(110, 260, s),
    control: mix(0.25, 0.9, s),
    stop: mix(0.25, 0.95, s),
    crouch: mix(0.05, 0.6, s),
    scoped: mix(380, 60, s),
    pace: mix(0.5, 0.08, s),
    burst: mix(2, 8, s),
    tap: mix(1, 3, s),
    rest: mix(0.6, 0.25, s),
    strafe: mix(0.15, 0.85, s),
    head: mix(0.05, 0.4, s),
    hurt: mix(25, 50, s),
    ears: mix(0.6, 1, s),
    nade: mix(0.1, 0.35, s),
    sneak: mix(0, 0.8, s),
    knife: mix(0.05, 0.4, s),
    flinch: mix(0.1, 0.9, s),
  };
}

// How far each family's bot likes to fight from: further than `close` it comes in, and past `far` it
// doesn't fire but comes closer. A shotgun closes right in, a sub-machine gun to middle range, a pistol
// to where it still hits; a rifle and a sniper's rifle hold where they are.
const RANGE: Record<Family, { close: number; far: number }> = {
  pistol: { close: 25, far: 50 },
  smg: { close: 15, far: 45 },
  rifle: { close: 1e9, far: 120 },
  sniper: { close: 1e9, far: 300 },
  shotgun: { close: 5, far: 20 },
  heavy: { close: 1e9, far: 90 },
};
// The families that run and gun (their spread hardly grows on the move): the rest stop to shoot.
const RUN_AND_GUN = new Set<Family>(['smg', 'shotgun']);

// A bot's taste in guns, as Counter-Strike's players buy them: rifles mostly, then the sniper's rifles
// and the sub-machine guns, a shotgun now and then, the Desert Eagle alone, and the odd Negev.
const TASTES: [number, GunId[], number[]][] = [
  [52, ['ak47', 'm4a4', 'm4a1s', 'galil', 'famas', 'sg553', 'aug'], [3, 2, 2, 1, 1, 1, 1]],
  [15, ['awp', 'ssg08'], [2, 1]],
  [15, ['mac10', 'mp9', 'ump', 'p90'], [1, 1, 1, 1]],
  [8, ['nova', 'xm1014'], [1, 1]],
  [5, ['deagle'], [1]],
  [3, ['negev'], [1]],
];
const SECONDARY: GunId[] = ['usp', 'glock', 'p250', 'deagle'];
const SECONDARY_ODDS = [4, 3, 2, 2];

function pickOf<T>(xs: readonly T[], odds: readonly number[], rand: () => number): T {
  let r = rand() * odds.reduce((a, b) => a + b, 0);
  for (let k = 0; k < xs.length; k++) if ((r -= odds[k]) < 0) return xs[k];
  return xs[xs.length - 1];
}

// A loadout of a bot's taste: its guns and armour (its grenades are its level's, each life).
export function tasteOf(rand: () => number): Loadout {
  const [, guns, odds] = pickOf(TASTES, TASTES.map((x) => x[0]), rand);
  const g = pickOf(guns, odds, rand);
  if (GUNS[g].slot === 'secondary') return { primary: null, secondary: g, nades: [], armour: 2 };
  return { primary: g, secondary: pickOf(SECONDARY, SECONDARY_ODDS, rand), nades: [], armour: 2 };
}

// How often a bot looks round for someone (s), and how long it remembers where it last saw or heard
// someone.
const LOOK = 0.15;
const RECALL = 7;
const HEARD = 9;
// Footsteps: heard this far (m), and only running (Counter-Strike's 135 units a second: walking and
// crouching are silent). A shot is heard all over the arena, but where it was is only roughly known,
// the less the further: off by up to this much of the way to it; a silenced gun's only this near.
const STEPS = 18;
const LOUD = 2.9;
const SHOTS = 0.15;
const MUFFLED = 15;
// With nothing seen or heard for this long (ms), a bot has an idea where someone is, as far-off
// footsteps would give a player: it makes for somewhere this far (m) from one of them.
const QUIET = 8000;
const HUNCH = [8, 20];
// Up a tower, how long it holds there (ms), and how fast it looks round meanwhile (rad/s).
const HOLD = [8000, 16000];
const SCAN = 0.5;
// How long its hands' tremble takes to change, s.
const TREMBLE = 0.35;
// A grenade: the nearest and furthest someone out of sight is to be worth one (m), how long a bot
// remembers them for it (ms), the most throws it weighs for one, and how many a step.
const NADE_NEAR = 8;
const NADE_FAR = 30;
const NADE_RECALL = 4000;
const NADE_TRIES = 10;
const NADE_STEP = 1;
// Closer than this (m), a sniper's rifle is put away for the pistol.
const NO_SCOPE = 7;

// A number about as likely as a bell curve's, its spread 1.
const gauss = (rand: () => number) => (rand() + rand() + rand() + rand() - 2) * 1.73;

interface Sighting {
  id: string;
  x: number;
  y: number;
  z: number;
  c: number;
  yaw?: number;
  t: number; // round ms it was last seen
  first: number; // round ms it was first seen, this time
}

// A grenade a bot means to throw: at what, the throws it weighs (the way it aims and how hard), how
// many it has flown, and the best so far, with where it goes off.
interface Plan {
  w: NadeId;
  to: V;
  tries: { aim: V; power: number }[];
  k: number;
  best: { aim: V; power: number; score: number; at: V } | null;
  since: number;
}

// How it fights someone, decided as it first sees them: whether it stops dead to shoot, crouches to
// spray, scopes a rifle with a scope, and knifes them if they come close while its gun's empty.
interface Style {
  stop: boolean;
  crouch: boolean;
  scope: boolean;
  knife: boolean;
}

// What a bot knows of the round, a step at a time: the others (everyone up in the round but itself,
// its team-mates too: they stop it walking), what stops a look, a shot and someone on foot besides the
// walls (the karts waiting), the smokes and the fires, and whether it's a team round. plans: how many
// more bots may find a way, look for cover or weigh a grenade this step (a millisecond or so each):
// the rest wait for the next, so the bots together never hold up a frame.
export interface View {
  others: readonly Mark[];
  blockers: readonly Blocker[];
  plans?: { left: number };
  clouds?: readonly Cloud[];
  fires?: readonly Blaze[];
  teams?: boolean;
}

export class FootBot {
  readonly id: string;
  readonly s: Soldier;
  w: Walker;
  skill: Skill;
  taste: Loadout; // the guns it likes
  private readonly f: Field;
  private readonly paths: Paths;
  private readonly rand: () => number;
  // Where it's going, and why: a way along the paths' points, and the point on it it's making for.
  private way: number[] | null = null;
  private next = 0;
  private cutAt = 0;
  private goal: 'roam' | 'hunt' | 'cover' = 'roam';
  private wayAt = -1e9; // round ms the way was found
  // Who it's after, where it last saw or heard someone, and who hurt it last.
  private foe: Sighting | null = null;
  private seen: Sighting | null = null;
  private heard: { x: number; y: number; z: number; t: number } | null = null;
  private threat: { x: number; y: number; z: number; t: number } | null = null;
  private news = 0; // round ms it last saw or heard anyone
  private lookAt = 0;
  private fought = -1e9; // round ms it last had someone in sight
  // Its aim: the point it's making for on someone, trailing them, and how far off it is.
  private aim: V | null = null;
  private ex = 0;
  private ey = 0;
  private jx = 0; // and its hands' tremble, wandering
  private jy = 0;
  private headShot = false;
  private style: Style = { stop: false, crouch: false, scope: false, knife: false };
  private burstLeft = 0;
  private restUntil = 0;
  private side = 1;
  private sideUntil = 0;
  private sideAt = 0;
  private covered = 0; // round ms it got to cover
  private coverAt = 0; // round ms it may look for cover again
  // Flashed: blind till then, and whether it sprays where it last saw someone meanwhile.
  private blindUntil = 0;
  private blindSpray = false;
  // A grenade it means to throw; when it may weigh another; and its own flash it looks away from.
  private plan: Plan | null = null;
  private nadeAt = 0;
  private away: { x: number; z: number; from: number; until: number } | null = null;
  // The fires as of this step, to keep out of.
  private fires: readonly Blaze[] = [];
  // Standing in one: the paths' point it's making for out of it.
  private out = -1;
  // Whether it's moved, for getting itself out of a corner.
  private pin: { x: number; z: number; t: number } = { x: 0, z: 0, t: 0 };
  private last = -1; // the last of the paths' points it passed
  // Pinned: how far it has got in getting itself out, the way it steps aside till dodgeUntil (round
  // ms), and the point it steps back to till backUntil.
  private stage = 0;
  private dodge: V = v3();
  private dodgeUntil = 0;
  private back = -1;
  private backUntil = 0;
  // Up a tower: where it can go, whether it's making for one, and till when it holds it.
  private perches: { x: number; y: number; z: number }[] = [];
  private perching = false;
  private holdUntil = 0;
  // What it's done, for the tests and the host's page: times it had to be put back on the paths, shots
  // (scoped ones too), grenades thrown, times flashed.
  stuck = 0;
  shots = 0;
  scopedShots = 0;
  thrown = 0;
  flashed = 0;

  constructor(id: string, f: Field, paths: Paths, skill: number, rand: () => number = Math.random) {
    this.id = id;
    this.f = f;
    this.paths = paths;
    this.skill = skillOf(skill);
    this.rand = rand;
    this.taste = tasteOf(rand);
    this.s = new Soldier(id, this.taste);
    const s0 = f.spawns[0];
    this.w = new Walker(f.ground, v3(s0.x, s0.y, s0.z), s0.yaw);
    this.w.bound = f.inside;
    this.w.fighter = speedWith(this.s.hand, false);
    // The arena's towers' floors and roof (braga-map's task 079): each flight's top, and the roof
    // outside its hut.
    for (const r of f.ground.d.rooms) {
      if (!r.stair || !f.inside((r.box.x0 + r.box.x1) / 2, (r.box.z0 + r.box.z1) / 2)) continue;
      for (const way of r.stair.ways) this.perches.push(way[way.length - 1]);
    }
  }

  // The loadout it comes back with: of its taste, more often than not, armour and helmet, and the
  // grenades its level carries (the better, the more).
  pick(): Loadout {
    const kit = this.rand() < 0.75 ? this.taste : tasteOf(this.rand);
    const k = this.skill.level;
    const nades: NadeId[] = [];
    if (this.rand() < mix(0.25, 0.85, k)) nades.push('he');
    if (this.rand() < mix(0.2, 0.75, k)) nades.push('flash');
    if (this.rand() < mix(0.05, 0.45, k)) nades.push('smoke');
    if (this.rand() < mix(0.05, 0.3, k)) nades.push('molotov');
    return { ...kit, nades };
  }

  // Back at a spawn at round ms t with a loadout, knowing nothing.
  spawn(sp: Spawn, kit: Loadout, t: number): void {
    const w = this.w;
    w.p = v3(sp.x, sp.y, sp.z);
    w.v = v3();
    w.yaw = sp.yaw;
    w.pitch = 0;
    w.grounded = true;
    w.crouch = 0;
    w.landed = 0;
    this.s.arm(kit, t);
    w.fighter = speedWith(this.s.hand, false);
    this.way = null;
    this.goal = 'roam';
    this.last = -1;
    this.foe = this.seen = this.heard = this.threat = null;
    this.news = t;
    this.fought = -1e9;
    this.aim = null;
    this.burstLeft = 0;
    this.restUntil = 0;
    this.blindUntil = 0;
    this.plan = null;
    this.away = null;
    this.nadeAt = t + 4000;
    this.pin = { x: sp.x, z: sp.z, t };
    this.holdUntil = 0;
    this.perching = false;
    // Back, it makes for a tower now and then; with a sniper's rifle, more often than not.
    const sniper = kit.primary && GUNS[kit.primary].family === 'sniper';
    if (this.perches.length && this.rand() < (sniper ? 0.7 : 0.25)) {
      const q = this.perches[Math.floor(this.rand() * this.perches.length)];
      this.perching = this.go(q, 'roam', t);
    }
  }

  // Where it stands, as a shot and a knife find it.
  body(): Mark {
    const w = this.w;
    return { id: this.id, x: w.p.x, y: w.p.y, z: w.p.z, yaw: w.yaw, c: w.crouch, spd: w.speed(), team: this.s.team };
  }

  // Its eye, as crouched as it is.
  eye(): V {
    return v3(this.w.p.x, this.w.p.y + this.w.eye(), this.w.p.z);
  }

  // A shot (or a grenade) heard at round ms t, from (x, y, z): about there.
  hear(x: number, y: number, z: number, t: number): void {
    if (!this.s.alive) return;
    const d = Math.hypot(x - this.w.p.x, z - this.w.p.z);
    if (d < 1) return;
    const off = d * SHOTS * (2 - this.skill.ears) * this.rand();
    const a = this.rand() * Math.PI * 2;
    this.heard = { x: x + Math.cos(a) * off, y, z: z + Math.sin(a) * off, t };
    this.news = t;
  }

  // Hit at round ms t by something from (x, y, z): it knows where from, and turns to it.
  hit(x: number, y: number, z: number, t: number): void {
    this.threat = { x, y, z, t };
    this.heard = { x, y, z, t };
    this.news = t;
  }

  // Flashed till round ms `until`: it sees nothing, and sprays where it last saw someone, or not.
  blind(until: number, t: number): void {
    if (until <= t || !this.s.alive) return;
    if (until > this.blindUntil) this.blindUntil = until;
    this.blindSpray = this.rand() < 0.6;
    this.flashed++;
    this.foe = null;
    // No grenade thrown blind.
    if (this.plan) this.abandon(t);
  }

  // Whether it's flashed at round ms t.
  blinded(t: number): boolean {
    return t < this.blindUntil;
  }

  // Those of the others it fights: in a team round, not its team-mates.
  private foes(view: View): Mark[] {
    return view.others.filter((o) => o.id !== this.id && (!view.teams || o.team !== this.s.team));
  }

  // A step of dt at round ms t: it looks, thinks, walks, aims, and fires or throws if it means to.
  // Its shot or grenade, or null.
  step(dt: number, t: number, view: View): ShotEv | NadeEv | null {
    const { w, s } = this;
    s.step(dt, t);
    w.landed = 0;
    if (!s.alive) return null;
    this.fires = view.fires ?? [];
    const foes = this.foes(view);
    w.blockers = [...view.blockers, ...view.others.map((o) => ({ x: o.x, z: o.z, r: RADIUS, y0: o.y, y1: o.y + HEIGHT }))];
    if (t >= this.lookAt) {
      this.lookAt = t + LOOK * 1000 * (0.8 + this.rand() * 0.4);
      this.look(t, view, foes);
    }
    // Whoever it saw at its last look, it follows with its eyes till the next; down, they're gone.
    const foe = this.foe;
    const o = foe && foes.find((x) => x.id === foe.id);
    if (foe && !o) this.foe = null;
    else if (foe && o && foe.t === this.seen?.t) Object.assign(foe, { x: o.x, y: o.y, z: o.z, c: o.c ?? 0, yaw: o.yaw });
    const inp = this.think(dt, t, view);
    w.fighter = speedWith(s.hand, s.scope > 0);
    if (w.step(inp, dt)) this.stuck++;
    s.crouch = w.crouch > 0.5;
    this.unpin(t, inp);
    if (this.plan) return this.throwing(t, view);
    return this.trigger(t, view, foes);
  }

  // Who it can see now (the nearest, or the one it was after while it still can), and what it hears.
  private look(t: number, view: View, foes: readonly Mark[]): void {
    const { w, skill } = this;
    const eye = this.eye();
    const facing = w.yaw;
    const blind = t < this.blindUntil;
    const clouds = view.clouds ?? [];
    const g = this.s.gun;
    const far = skill.far * (g?.family === 'sniper' ? 1.5 : 1);
    let best: Sighting | null = null;
    // Nearest first, the one it's after counting nearer (it doesn't switch for someone a little
    // closer): the first it sees is the one.
    const near = foes
      .map((o) => ({ o, d: Math.hypot(o.x - w.p.x, o.z - w.p.z) }))
      .sort((a, b) => a.d * (a.o.id === this.foe?.id ? 0.6 : 1) - b.d * (b.o.id === this.foe?.id ? 0.6 : 1));
    for (const { o, d } of near) {
      // Footsteps, seen or not: only running.
      if (o.spd > LOUD && d < STEPS * skill.ears && (!this.heard || t - this.heard.t > 1000)) {
        this.heard = { x: o.x, y: o.y, z: o.z, t };
        this.news = t;
      }
      if (best || blind || d > far) continue;
      const mine = this.foe?.id === o.id;
      // In its field of view, or close by, or the one it's after (it's turned to them).
      if (d > 3 && !mine && Math.abs(angleDiff(Math.atan2(o.z - w.p.z, o.x - w.p.x), facing)) > skill.fov) continue;
      if (!this.sees(eye, o, view.blockers, clouds, t)) continue;
      best = { id: o.id, x: o.x, y: o.y, z: o.z, c: o.c ?? 0, yaw: o.yaw, t, first: mine ? this.foe!.first : t };
    }
    if (best) {
      // Someone new, or someone it lost a while ago: its aim starts off.
      if (!this.foe || this.foe.id !== best.id || t - this.foe.t > 1200) this.acquire(best, t);
      this.foe = best;
      this.seen = { ...best };
      this.news = t;
      // No time for a grenade now.
      if (this.plan) {
        this.plan = null;
        this.drop(t);
      }
    } else if (this.foe && t - this.foe.t > 400) {
      this.foe = null;
    }
    if (!best && !blind) this.weigh(t, view);
  }

  // Whether it sees someone from its eye: their head or their chest, nothing in the way, no smoke.
  private sees(eye: V, o: Body, blockers: readonly Blocker[], clouds: readonly Cloud[], t: number): boolean {
    for (const p of [headOf(o), chestOf(o)]) if (clear(this.f.ground, eye, p, blockers) && !(clouds.length && hidden(eye, p, clouds, t))) return true;
    return false;
  }

  // Someone new in its sights: its aim starts off, and how it fights them is decided.
  private acquire(o: Sighting, t: number): void {
    const { skill } = this;
    const a = this.rand() * Math.PI * 2;
    const e = skill.err * (0.6 + this.rand() * 0.8);
    this.ex = Math.cos(a) * e;
    this.ey = Math.sin(a) * e * 0.6;
    this.headShot = this.rand() < skill.head;
    this.style = { stop: this.rand() < skill.stop, crouch: this.rand() < skill.crouch, scope: this.rand() < skill.level, knife: this.rand() < skill.knife };
    this.aim = this.aim && this.foe ? this.aim : chestOf(o);
    const g = this.s.gun;
    if (g) this.burstLeft = this.burstFor(Math.hypot(o.x - this.w.p.x, o.z - this.w.p.z), g);
    o.first = t;
  }

  // An automatic's burst at d metres: a spray up close, a burst in the middle, a tap or two far off;
  // the Negev's a long one (it's the more accurate the longer it fires).
  private burstFor(d: number, g: Gun): number {
    if (!g.auto) return 1;
    const j = 0.75 + this.rand() * 0.5;
    if (g.family === 'heavy') return Math.round(mix(10, 40, this.skill.level) * j);
    if (g.family === 'shotgun') return 3;
    if (d < 10 || (g.family === 'smg' && d < 16)) return g.mag;
    if (d < 25) return Math.max(2, Math.round(this.skill.burst * j));
    return Math.max(1, Math.round(this.skill.tap * j));
  }

  // The gun it holds this step: out of bullets, the pistol (quicker than a reload) or a reload; a
  // sniper's rifle swapped for the pistol up close; the knife now and then, someone close and its gun
  // empty; and with nobody about, the primary back in hand and topped up.
  private handle(t: number, d: number | null): void {
    const s = this.s;
    if (this.plan) return;
    if (isNade(s.hand)) {
      this.drop(t);
      return;
    }
    const g = s.gun;
    if (d !== null) {
      if (g?.family === 'sniper' && d < NO_SCOPE && this.loaded(s.secondary)) {
        s.slot(2, t);
        return;
      }
      if (s.hand === 'knife') {
        if (d > 3) this.drop(t);
        return;
      }
      if (g && this.style.knife && d < 1.6 && (s.mag === 0 || s.reloading)) {
        s.slot(3, t);
        return;
      }
      if (g && s.mag === 0 && !s.reloading) {
        if (s.hand === s.primary && (d < 20 || s.reserve === 0) && this.loaded(s.secondary)) s.slot(2, t);
        else if (s.reserve > 0) s.reload(t);
        else if (s.hand === s.secondary && this.loaded(s.primary)) s.slot(1, t);
        else s.slot(3, t);
      }
      return;
    }
    if (t - this.fought < 1500) {
      if (g && s.mag === 0 && !s.reloading) s.reload(t);
      return;
    }
    if (s.primary && s.hand !== s.primary && this.loaded(s.primary)) s.slot(1, t);
    else if (s.hand === 'knife' || (g && s.mag + s.reserve === 0)) this.drop(t);
    else if (g && !s.reloading && s.mag < g.mag * 0.4 && s.reserve > 0) s.reload(t);
  }

  // Whether a gun of its has a bullet left.
  private loaded(id: GunId | null): boolean {
    const r = id && this.s.rounds.get(id);
    return !!r && r.mag + r.reserve > 0;
  }

  // Back to a gun: the primary if it has bullets, else the pistol, else the knife.
  private drop(t: number): void {
    const s = this.s;
    if (s.primary && this.loaded(s.primary)) s.select(s.primary, t);
    else if (this.loaded(s.secondary)) s.select(s.secondary, t);
    else s.select('knife', t);
  }

  // Its scope up, or down. Down, it stays down (no rescope once a sniper's bolt is worked).
  private scopeTo(up: boolean, t: number): void {
    const s = this.s;
    if (up) {
      if (!s.scope && !s.rezoom && s.gun?.scope && !s.reloading && t >= s.drawnAt) s.zoom(t);
    } else {
      s.rezoom = 0;
      s.scope = 0;
    }
  }

  // Where to go and where to look this step.
  private think(dt: number, t: number, view: View): WalkInput {
    const { w, s, skill } = this;
    const foe = this.foe;
    const d = foe ? Math.hypot(foe.x - w.p.x, foe.z - w.p.z) : null;
    if (foe) this.fought = t;
    this.handle(t, d);
    const g = s.gun;
    const fam: Family = g?.family ?? 'pistol';
    const hurt = s.health < skill.hurt;
    const threat = this.threat && t - this.threat.t < 4000 ? this.threat : foe && t - foe.t < 1500 ? foe : null;
    const blind = t < this.blindUntil;
    // What it sprays at blind: where it last saw someone.
    const spray = blind && this.blindSpray && this.seen && t - this.seen.t < 1500 ? this.seen : null;

    // Just hit and hurt, or reloading with someone about: into cover, away from them, till it's
    // reloaded and has caught its breath (or someone comes close); a smoke behind it, if it has one.
    const hitNow = this.threat && t - this.threat.t < 1500;
    if (((hurt && hitNow) || (s.reloading && foe)) && threat && this.goal !== 'cover' && t >= this.coverAt && !this.plan && this.may(view)) {
      if (this.takeCover(threat, t) && s.nades.includes('smoke') && this.rand() < skill.level) {
        const dd = Math.hypot(threat.x - w.p.x, threat.z - w.p.z) || 1;
        const k = Math.min(5, dd / 2) / dd;
        const at = v3(w.p.x + (threat.x - w.p.x) * k, w.p.y, w.p.z + (threat.z - w.p.z) * k);
        this.ready('smoke', at, t);
      }
    }
    if (this.goal === 'cover') {
      const done = !this.way || this.next >= this.way.length;
      if (done && !this.covered) this.covered = t;
      const rested = this.covered && !s.reloading && t - this.covered > 2500;
      if (rested || (this.covered && t - this.covered > 8000) || (d !== null && d < 8)) {
        this.goal = 'roam';
        this.way = null;
        this.coverAt = t + 4000;
      }
    }

    let move: V | null = null;
    let walk = false;
    let crouch = false;
    if (this.plan) {
      // Throwing: it stands to aim it, but a smoke it throws on its way to cover.
      this.scopeTo(false, t);
      if (this.goal === 'cover') move = this.follow(t);
    } else if (foe && this.goal !== 'cover') {
      // Someone in sight: it fights them, from where its gun likes.
      const R = RANGE[fam];
      if (d! > R.far || d! > R.close) move = this.towards(foe, t, view);
      const top = speedWith(s.hand, s.scope > 0);
      // About to fire: a gun that stops to shoot, stopped; between shots, across their line, now one
      // way and now the other, not into a wall. A sniper's rifle stands still; so does a crouch.
      const firing = t >= this.restUntil - 120;
      const stopper = !RUN_AND_GUN.has(fam) && (this.style.stop || fam === 'sniper');
      crouch = this.style.crouch && d! > 15 && (fam === 'rifle' || fam === 'heavy' || fam === 'sniper') && firing;
      if (!move) {
        const dx = (foe.x - w.p.x) / (d || 1);
        const dz = (foe.z - w.p.z) / (d || 1);
        const open = (k: number) => this.paths.straight(w.p.x, w.p.z, w.p.x - dz * k * 2, w.p.z + dx * k * 2, w.p.y);
        if (this.side && w.speed() < 0.3 && t - this.sideAt > 400) this.sideUntil = 0;
        if (t >= this.sideUntil) {
          this.sideUntil = t + 500 + this.rand() * 1200;
          this.sideAt = t;
          this.side = fam !== 'sniper' && this.rand() < skill.strafe ? (this.rand() < 0.5 ? -1 : 1) : 0;
          if (this.side && !open(this.side)) this.side = open(-this.side) ? -this.side : 0;
        }
        if ((stopper && firing) || crouch) {
          // A counter-strafe: the other way till it's all but stopped.
          const sp = w.speed();
          if (sp > top * 0.3) move = v3(-w.v.x / sp, 0, -w.v.z / sp);
        } else if (this.side) {
          move = v3(-dz * this.side, 0, dx * this.side);
          walk = !stopper;
        }
      }
      if (g?.scope?.bolt) this.scopeTo(d! >= NO_SCOPE && !s.reloading, t);
      else if (g?.scope) this.scopeTo(this.style.scope && d! > 25 && !s.reloading, t);
    } else {
      if (!spray) this.scopeTo(false, t);
      if (this.goal !== 'cover') {
        // Where it last saw someone, or heard them; else somewhere else in the arena.
        const lead = this.seen && t - this.seen.t < RECALL * 1000 ? this.seen : this.heard && t - this.heard.t < HEARD * 1000 ? this.heard : null;
        if (lead && !this.perching) {
          // There, or no way there: it forgets it.
          const fresh = this.goal !== 'hunt' || t - this.wayAt > 3000;
          const far = Math.hypot(lead.x - w.p.x, lead.z - w.p.z);
          if ((fresh && this.may(view) && !this.go(lead, 'hunt', t)) || far < 3) {
            if (lead === this.seen) this.seen = null;
            else this.heard = null;
          }
          // Close to someone it heard, it walks the last of the way quietly, as a player does.
          walk = far < 15 && this.rand() < skill.sneak;
        } else {
          // Up a tower, it holds there a while, looking round.
          const there = !this.way || this.next >= this.way.length;
          if (there && this.perching) {
            this.perching = false;
            this.holdUntil = t + HOLD[0] + (HOLD[1] - HOLD[0]) * this.rand();
          }
          if (t >= this.holdUntil && (this.goal !== 'roam' || (there && t - this.wayAt > 500) || (t - this.news > QUIET && t - this.wayAt > QUIET)) && this.may(view)) this.roam(t, view);
        }
      }
      move = this.follow(t);
    }
    if (this.goal === 'cover' && !move) move = this.follow(t);

    // Standing in a fire: out of it, before anything else, to the nearest of the paths' points it
    // isn't burning at.
    const p = w.p;
    const burning = this.fires.filter((b) => inFire(b, p, t));
    if (burning.length) {
      const P = this.paths;
      const out = this.out;
      const hot = (q: number) => this.fires.some((b) => inFire(b, { x: P.x[q], y: P.y[q], z: P.z[q] }, t));
      if (out < 0 || hot(out)) {
        this.out = -1;
        const here = P.near(p.x, p.z, p.y);
        if (here >= 0) for (const { p: q } of P.round(here, 10)) if (!hot(q)) {
          this.out = q;
          break;
        }
      }
      const q = this.out;
      if (q >= 0) move = norm(v3(P.x[q] - p.x, 0, P.z[q] - p.z));
      else {
        const b = burning[0];
        const L = Math.hypot(p.x - b.x, p.z - b.z);
        move = L > 0.05 ? v3((p.x - b.x) / L, 0, (p.z - b.z) / L) : v3(Math.cos(w.yaw + Math.PI), 0, Math.sin(w.yaw + Math.PI));
      }
      walk = crouch = false;
    } else this.out = -1;

    // Where it looks: at whoever it's fighting (or where it last saw them, blind), its recoil pulled
    // against; at what it's throwing at; else where it heard something, or was hurt from; else the
    // way it goes. Away from its own flash as it goes off.
    let yaw = w.yaw;
    let pitch = 0;
    const tgt = foe ?? spray;
    if (this.plan) {
      const P = this.plan;
      const a = P.best?.aim ?? P.tries[0]?.aim ?? norm(v3(P.to.x - p.x, 0, P.to.z - p.z));
      yaw = Math.atan2(a.z, a.x);
      pitch = Math.asin(clamp(a.y, -1, 1));
    } else if (tgt) {
      const want = this.headShot ? headOf(tgt) : chestOf(tgt);
      // Its aim trails them, and settles on them.
      const a = this.aim ?? want;
      const q = 1 - Math.exp(-dt / skill.lag);
      this.aim = v3(a.x + (want.x - a.x) * q, a.y + (want.y - a.y) * q, a.z + (want.z - a.z) * q);
      const decay = Math.exp(-dt / skill.settle);
      this.ex *= decay;
      this.ey *= decay;
      // The tremble wanders round nothing, about `shake` off, changing over a third of a second.
      const kick = skill.shake * Math.sqrt((2 * dt) / TREMBLE);
      this.jx += (-this.jx * dt) / TREMBLE + kick * gauss(this.rand);
      this.jy += (-this.jy * dt) / TREMBLE + kick * gauss(this.rand) * 0.7;
      const e = this.eye();
      const dx = this.aim.x - e.x;
      const dy = this.aim.y - e.y;
      const dz = this.aim.z - e.z;
      // The recoil pulled against: its aim under where the kick will take the shot, as much as its
      // skill knows the gun's pattern.
      const c = skill.control * deg;
      yaw = Math.atan2(dz, dx) + this.ex + this.jx - s.punch.x * c;
      pitch = Math.atan2(dy, Math.hypot(dx, dz)) + this.ey + this.jy - s.punch.y * c;
    } else {
      this.aim = null;
      const turn = threat ?? (this.heard && t - this.heard.t < 1500 ? this.heard : null);
      if (turn && this.goal !== 'cover') yaw = Math.atan2(turn.z - p.z, turn.x - p.x);
      else if (move && (move.x || move.z)) yaw = Math.atan2(move.z, move.x);
      else if (t < this.holdUntil) yaw = w.yaw + SCAN * dt;
    }
    const aw = this.away;
    if (aw && t >= aw.from && t < aw.until) yaw = Math.atan2(p.z - aw.z, p.x - aw.x);
    if (aw && t >= aw.until) this.away = null;
    const most = skill.turn * dt;
    const dyaw = clamp(angleDiff(yaw, w.yaw), -most, most);
    const dpitch = clamp(pitch - w.pitch, -most, most);
    w.look({ x: dyaw, y: dpitch });

    if (!move) return { ...STAND, crouch };
    const cy = Math.cos(w.yaw);
    const sy = Math.sin(w.yaw);
    return { ...STAND, fwd: move.x * cy + move.z * sy, side: -move.x * sy + move.z * cy, run: true, walk, crouch };
  }

  // Towards someone it sees, on the paths: a way found every second or so.
  private towards(o: { x: number; y: number; z: number }, t: number, view: View): V | null {
    if ((this.goal !== 'hunt' || t - this.wayAt > 1000) && this.may(view)) this.go(o, 'hunt', t);
    return this.follow(t);
  }

  // Whether it may find a way (or weigh a grenade) this step.
  private may(view: View): boolean {
    if (!view.plans) return true;
    if (view.plans.left <= 0) return false;
    view.plans.left--;
    return true;
  }

  // A way to (x, z) on the paths, for a reason. Whether there's one.
  private go(to: { x: number; y: number; z: number }, why: FootBot['goal'], t: number): boolean {
    const a = this.paths.near(this.w.p.x, this.w.p.z, this.w.p.y);
    const b = this.paths.near(to.x, to.z, to.y);
    this.way = this.paths.find(a, b);
    this.next = 0;
    if (this.last < 0 || Math.hypot(this.paths.x[this.last] - this.w.p.x, this.paths.z[this.last] - this.w.p.z) > 4) this.last = a;
    this.goal = why;
    this.wayAt = t;
    this.covered = 0;
    return !!this.way;
  }

  // Somewhere else in the arena, 25 m off or more, or up a tower; or, having seen and heard nobody
  // for a while, somewhere near someone.
  private roam(t: number, view: View): void {
    const P = this.paths;
    this.perching = false;
    // Up a tower, now and then; with a sniper's rifle, more often than not.
    const sniper = this.s.primary && GUNS[this.s.primary].family === 'sniper';
    if (this.perches.length && this.rand() < (sniper ? 0.6 : 0.2)) {
      const q = this.perches[Math.floor(this.rand() * this.perches.length)];
      if (this.go(q, 'roam', t)) {
        this.perching = true;
        return;
      }
    }
    const foes = this.foes(view);
    if (t - this.news > QUIET && foes.length && this.rand() < 0.7) {
      const o = foes[Math.floor(this.rand() * foes.length)];
      const a = this.rand() * Math.PI * 2;
      const r = HUNCH[0] + (HUNCH[1] - HUNCH[0]) * this.rand();
      const p = P.near(o.x + Math.cos(a) * r, o.z + Math.sin(a) * r);
      this.news = t;
      if (p >= 0 && this.go({ x: P.x[p], y: P.y[p], z: P.z[p] }, 'roam', t)) return;
    }
    for (let k = 0; k < 20; k++) {
      const p = Math.floor(this.rand() * P.n);
      if (Math.hypot(P.x[p] - this.w.p.x, P.z[p] - this.w.p.z) < 25 && k < 19) continue;
      this.go({ x: P.x[p], y: P.y[p], z: P.z[p] }, 'roam', t);
      return;
    }
  }

  // Into cover from someone at `from`: the nearest point within 30 m's walk they can't see from where
  // they are, not past them.
  private takeCover(from: { x: number; y: number; z: number }, t: number): boolean {
    const P = this.paths;
    const here = P.near(this.w.p.x, this.w.p.z, this.w.p.y);
    const eye = v3(from.x, from.y + 1.65, from.z);
    const d0 = Math.hypot(from.x - this.w.p.x, from.z - this.w.p.z);
    this.coverAt = t + 1000;
    let looked = 0;
    for (const { p } of P.round(here, 30)) {
      if (looked > 24) break;
      const x = P.x[p];
      const z = P.z[p];
      if (Math.hypot(from.x - x, from.z - z) < Math.min(d0, 12)) continue;
      // Every third or so, to look further for the same cost.
      if (this.rand() < 0.6) continue;
      looked++;
      const b = { id: '', x, y: P.y[p], z };
      if (clear(this.f.ground, eye, headOf(b)) || clear(this.f.ground, eye, chestOf(b))) continue;
      this.way = P.find(here, p);
      this.next = 0;
      this.goal = 'cover';
      this.wayAt = t;
      this.covered = 0;
      return true;
    }
    return false;
  }

  // The way it goes along its way this step: to the furthest of its next few points it can walk to
  // straight; waiting, where the next is on fire.
  private follow(t: number): V | null {
    const way = this.way;
    if (!way) return null;
    const P = this.paths;
    const p = this.w.p;
    if (t < this.dodgeUntil) return this.dodge;
    if (t < this.backUntil && this.back >= 0 && Math.hypot(P.x[this.back] - p.x, P.z[this.back] - p.z) > 0.25) return norm(v3(P.x[this.back] - p.x, 0, P.z[this.back] - p.z));
    while (this.next < way.length && Math.hypot(P.x[way[this.next]] - p.x, P.z[way[this.next]] - p.z) < 0.9) this.last = way[this.next++];
    if (this.next >= way.length) return null;
    // Five times a second it looks along its way for a corner to cut.
    for (let k = Math.min(way.length - 1, this.next + 4); k > this.next && t >= this.cutAt; k--) {
      const q = way[k];
      if (Math.abs(P.y[q] - p.y) < 1 && P.straight(p.x, p.z, P.x[q], P.z[q], p.y)) {
        this.next = k;
        break;
      }
    }
    if (t >= this.cutAt) this.cutAt = t + 200;
    const q = way[this.next];
    const at = { x: P.x[q], y: P.y[q], z: P.z[q] };
    if (this.fires.some((b) => inFire(b, at, t) && !inFire(b, p, t))) return null;
    return norm(v3(at.x - p.x, 0, at.z - p.z));
  }

  // Not moving for a while when it means to (someone standing in its way, a wall's end, a hollow off
  // its way): a step aside; then back to the last point it passed, and on from there; then a new way;
  // and still stuck, back on that point, as a player would press Enter.
  private unpin(t: number, inp: WalkInput): void {
    const p = this.w.p;
    if (Math.hypot(p.x - this.pin.x, p.z - this.pin.z) > 1 || (!inp.fwd && !inp.side) || (this.foe && this.side)) {
      this.pin = { x: p.x, z: p.z, t };
      this.stage = 0;
      return;
    }
    const e = t - this.pin.t;
    if (e > 500 && this.stage === 0) {
      const k = this.rand() < 0.5 ? -1 : 1;
      const yaw = Math.atan2(inp.side * Math.cos(this.w.yaw) + inp.fwd * Math.sin(this.w.yaw), inp.fwd * Math.cos(this.w.yaw) - inp.side * Math.sin(this.w.yaw)) + (k * Math.PI) / 2;
      this.dodge = v3(Math.cos(yaw), 0, Math.sin(yaw));
      this.dodgeUntil = t + 450;
      this.stage = 1;
    }
    if (e > 1200 && this.stage === 1) {
      this.back = this.last >= 0 && Math.hypot(this.paths.x[this.last] - p.x, this.paths.z[this.last] - p.z) < 4 ? this.last : this.paths.near(p.x, p.z, p.y);
      this.backUntil = t + 700;
      this.stage = 2;
    }
    if (e > 2200 && this.stage === 2) {
      if (this.goal !== 'cover') {
        this.way = null;
        this.goal = 'roam';
      }
      this.stage = 3;
    }
    if (e > 5000) {
      const P = this.paths;
      const q = this.last >= 0 ? this.last : P.near(p.x, p.z, p.y);
      if (q >= 0) {
        this.w.p = v3(P.x[q], P.y[q], P.z[q]);
        this.w.v = v3();
        this.stuck++;
      }
      this.way = null;
      this.goal = 'roam';
      this.pin = { x: this.w.p.x, z: this.w.p.z, t };
      this.stage = 0;
    }
  }

  // ---- Grenades ----

  // Whether to throw a grenade, looking round and seeing nobody: someone seen or heard lately, out of
  // sight 8 to 25 m off. A flash before it goes after them, else an HE grenade or a molotov at them.
  private weigh(t: number, view: View): void {
    const { s, w, skill } = this;
    if (this.plan || t < this.nadeAt || !s.nades.length || this.goal === 'cover' || s.reloading || t - this.fought < 1000) return;
    const seen = this.seen && t - this.seen.t < NADE_RECALL ? this.seen : null;
    const lead = seen ?? (this.heard && t - this.heard.t < NADE_RECALL ? this.heard : null);
    if (!lead) return;
    const d = Math.hypot(lead.x - w.p.x, lead.z - w.p.z);
    if (d < NADE_NEAR || d > NADE_FAR || this.rand() >= skill.nade) return;
    this.nadeAt = t + 2500;
    const to = v3(lead.x, lead.y, lead.z);
    if (clear(this.f.ground, this.eye(), v3(to.x, to.y + 1.2, to.z), view.blockers)) return;
    const has = (n: NadeId) => s.nades.includes(n);
    const kind: NadeId | null = has('flash') && (this.rand() < 0.5 || !(has('he') || has('molotov'))) ? 'flash' : has('he') ? 'he' : has('molotov') ? 'molotov' : null;
    if (kind) this.ready(kind, to, t);
  }

  // A grenade taken out to throw at `to`, and the throws worth weighing: for each of a few strengths,
  // the arcs (low and high) that would land it there in no wind and with nothing in the way, and a
  // little either side of them. The world decides which is best (`throwing`).
  private ready(w: NadeId, to: V, t: number): void {
    const s = this.s;
    if (!s.nades.includes(w) || (s.hand !== w && !s.select(w, t))) return;
    const e = this.eye();
    const dx = to.x - e.x;
    const dz = to.z - e.z;
    const yaw = Math.atan2(dz, dx);
    // From where it leaves the hand, to a little short (it rolls on), or over them (a flash in the air).
    const D = Math.max(1, Math.hypot(dx, dz) - 0.3 - (w === 'he' ? 1 : 0));
    const dh = to.y + (w === 'flash' ? 1.8 : 0.2) - (e.y - 0.1);
    const G = 8;
    // An HE grenade or a flash has to get there before its fuse; a high lob takes too long.
    const most = w === 'he' ? 1.5 : w === 'flash' ? 2 : 4;
    const arcs: { th: number; power: number; yaw: number }[] = [];
    for (const power of [1, 0.5, 0.1]) {
      const v = LOB + (THROW - LOB) * power;
      const q = v ** 4 - G * (G * D * D + 2 * dh * v * v);
      if (q < 0) continue;
      for (const sg of [-1, 1]) {
        const th = Math.atan((v * v + sg * Math.sqrt(q)) / (G * D));
        if (th < 1.25 && D / (v * Math.cos(th)) < most) arcs.push({ th, power, yaw });
      }
    }
    // Each arc, then each a little either side (round a corner, off a wall), then a little higher and
    // lower.
    const tries = [...arcs, ...arcs.flatMap((a) => [{ ...a, yaw: yaw + 12 * deg }, { ...a, yaw: yaw - 12 * deg }]), ...arcs.flatMap((a) => [{ ...a, th: a.th + 5 * deg }, { ...a, th: a.th - 5 * deg }])]
      .slice(0, NADE_TRIES)
      .map((a) => {
        // The way to aim for the throw to leave at th: thrown a little over the aim, as an arm throws
        // (throwOf's).
        const u = v3(Math.cos(a.th) * Math.cos(a.yaw), Math.sin(a.th), Math.cos(a.th) * Math.sin(a.yaw));
        const k = 0.1 * u.y + Math.sqrt(0.01 * u.y * u.y + 0.99);
        return { aim: norm(v3(u.x * k, u.y * k - 0.1, u.z * k)), power: a.power };
      });
    if (!tries.length) {
      this.drop(t);
      return;
    }
    this.plan = { w, to, tries, k: 0, best: null, since: t };
  }

  // A step of a grenade it means to throw: a couple more throws flown (when the step's plans allow),
  // and once they're all weighed (or one's good enough), it drawn and the bot turned to it, thrown;
  // none good enough, put away.
  private throwing(t: number, view: View): NadeEv | null {
    const { s, w } = this;
    const P = this.plan!;
    if (t - P.since > 3000 || !s.nades.includes(P.w)) return this.abandon(t);
    const good = { he: 70, flash: 70, molotov: 75, smoke: 60 }[P.w];
    if (P.k < P.tries.length && !(P.best && P.best.score >= good) && this.may(view)) {
      const see = seeOn(this.f);
      for (let j = 0; j < NADE_STEP && P.k < P.tries.length; j++, P.k++) {
        const c = P.tries[P.k];
        const f = fly(throwOf('plan', this.id, P.w, t, this.eye(), c.aim, c.power, w.v), see);
        const score = this.worth(P.w, f, P.to);
        if (score > (P.best?.score ?? 0)) P.best = { ...c, score, at: v3(f.at.x, f.at.y, f.at.z) };
      }
    }
    if (P.k < P.tries.length && !(P.best && P.best.score >= good)) return null;
    const enough = { he: 20, flash: 25, molotov: 1, smoke: 1 }[P.w];
    if (!P.best || P.best.score < enough) return this.abandon(t);
    if (s.hand !== P.w || t < s.drawnAt || t < s.nextAt) return null;
    const b = P.best;
    if (Math.abs(angleDiff(Math.atan2(b.aim.z, b.aim.x), w.yaw)) > 0.15) return null;
    const ev = toss(s, this.eye(), b.aim, b.power, w.v, t);
    this.plan = null;
    this.nadeAt = t + mix(14000, 6000, this.skill.level) * (0.7 + this.rand() * 0.6);
    if (!ev) return null;
    this.thrown++;
    if (P.w === 'flash') {
      // It looks away as it goes off (if it knows to), and goes after them.
      if (this.rand() < this.skill.flinch) this.away = { x: b.at.x, z: b.at.z, from: t + 1300, until: t + 1750 };
      if (this.goal !== 'cover') this.go(P.to, 'hunt', t);
    }
    return ev;
  }

  private abandon(t: number): null {
    this.plan = null;
    this.drop(t);
    return null;
  }

  // What a throw's worth, by where its flight goes off: an HE grenade's blast at them (and none at the
  // thrower), a molotov's fire under them, a flash in their eyes and not in its own, a smoke where
  // it's wanted.
  private worth(w: NadeId, f: Flight, to: V): number {
    const ground = this.f.ground;
    const clearTo = (a: V, b: V) => clear(ground, a, b);
    const at = v3(f.at.x, f.at.y, f.at.z);
    const me = this.w.p;
    if (w === 'he') return blast(at, me, clearTo) > 5 ? 0 : blast(at, to, clearTo);
    if (w === 'molotov') {
      if (!f.ground || Math.hypot(at.x - me.x, at.z - me.z) < FIRE.r + 1.5 || Math.abs(at.y - to.y) > 1.5) return 0;
      const d = Math.hypot(at.x - to.x, at.z - to.z);
      return d < FIRE.r ? 100 - d * 10 : 0;
    }
    if (w === 'flash') {
      const eye = v3(to.x, to.y + 1.6, to.z);
      const them = blinding(at, eye, norm(v3(at.x - eye.x, at.y - eye.y, at.z - eye.z)), clearTo);
      const e = this.eye();
      const mine = blinding(at, e, norm(v3(to.x - e.x, 0, to.z - e.z)), clearTo);
      return (them - mine) / 42;
    }
    const d = Math.hypot(at.x - to.x, at.z - to.z);
    return d < 4 ? 100 - d * 15 : 0;
  }

  // ---- Firing ----

  // Whether it fires this step: someone in sight, in its gun's range, seen long enough to have
  // reacted, its aim on them as far as it can tell, between bursts, stopped (if it stops to shoot),
  // its scope settled; or flashed, spraying where it last saw them.
  private trigger(t: number, view: View, foes: readonly Mark[]): ShotEv | null {
    const { s, w, skill } = this;
    if (!s.ready(t) || t < this.restUntil) return null;
    const g = s.gun;
    const e = this.eye();
    if (t < this.blindUntil) {
      const lk = this.seen;
      if (!this.blindSpray || !g?.auto || !lk || t - lk.t > 1500) return null;
      return this.shoot(t, view, foes, e, Math.hypot(lk.x - e.x, lk.z - e.z), g);
    }
    const foe = this.foe;
    if (!foe || t - foe.t > 250 || t - foe.first < skill.react * 1000) return null;
    const d = Math.hypot(foe.x - e.x, foe.z - e.z);
    const dir = w.dir();
    if (s.hand === 'knife') {
      if (d > KNIFE.reach + 0.3) return null;
      const to = norm(v3(foe.x - e.x, chestOf(foe).y - e.y, foe.z - e.z));
      const behind = foe.yaw !== undefined && Math.cos(foe.yaw) * to.x + Math.sin(foe.yaw) * to.z > 0.45;
      const ev = stab(s, e, to, behind, t, foes, seeOn(this.f, view.blockers));
      if (ev) this.shots++;
      return ev;
    }
    if (!g || d > RANGE[g.family].far) return null;
    // A sniper's rifle fires scoped once it's settled (up close it's the pistol's turn); a rifle with a
    // scope, if it means to scope, likewise.
    const settled = !!g.scope && s.scope > 0 && s.scopedFor(t) >= g.scope.settle + skill.scoped;
    if (g.scope?.bolt && d >= NO_SCOPE && !settled) return null;
    if (g.scope && !g.scope.bolt && s.scope > 0 && !settled) return null;
    // Stopped, if it stops to shoot: under a third of its top speed, where the spread's a standing one.
    const top = speedWith(s.hand, s.scope > 0);
    if (!RUN_AND_GUN.has(g.family) && (this.style.stop || g.family === 'sniper') && w.speed() > top * 0.34) return null;
    // On them: the way it looks, with the kick it means to come, within their width (half its own
    // tremble's give or take: it can't tell that well), as it sees them.
    const c = skill.control;
    const way = kicked(dir, { x: s.punch.x * c, y: s.punch.y * c });
    const p = this.headShot ? headOf(foe) : chestOf(foe);
    const to = norm(v3(p.x - e.x, p.y - e.y, p.z - e.z));
    const off = Math.acos(clamp(way.x * to.x + way.y * to.y + way.z * to.z, -1, 1));
    if (off > Math.atan2(0.25, d) + skill.shake * 0.5) return null;
    // Still in sight, where they are now: else it holds its fire till it sees them again.
    if (!this.sees(e, foe, view.blockers, view.clouds ?? [], t)) {
      foe.t = -1e9;
      return null;
    }
    return this.shoot(t, view, foes, e, d, g);
  }

  // A shot from its eye the way it looks, at its foes only (a team-mate's in no danger), and the
  // burst or the pause it means after it.
  private shoot(t: number, view: View, foes: readonly Mark[], e: V, d: number, g: Gun): ShotEv | null {
    const { s, w, skill } = this;
    const scoped = s.scope > 0;
    const ev = fire(s, e, w.dir(), { speed: w.speed(), air: !w.grounded }, t, foes, seeOn(this.f, view.blockers), (this.rand() * 4294967296) >>> 0);
    if (!ev) return null;
    this.shots++;
    if (scoped) this.scopedShots++;
    const j = 0.7 + this.rand() * 0.6;
    if (g.auto) {
      if (--this.burstLeft <= 0) {
        this.burstLeft = this.burstFor(d, g);
        this.restUntil = t + (d < 10 ? 0.1 : skill.rest * (d > 25 ? 1.4 : 1)) * 1000 * j;
      }
    } else {
      // A pistol far off waits for its spread to settle; a shotgun and a sniper's rifle only for
      // themselves.
      const settle = g.family === 'pistol' && d > 12 && g.spread.settle > 0 ? s.bloom / g.spread.settle : 0;
      this.restUntil = t + Math.max(skill.pace, settle) * 1000 * j;
    }
    return ev;
  }
}

// A round's bots, as the host runs them: each comes back after a while at the spawn none of its
// enemies sees, with a loadout; the shots and grenades they fire, and anyone's, heard by them and
// hurting them; and the fires they stand in.
export class Squad {
  readonly bots: FootBot[] = [];
  // Whether it's a team round, the bots' `s.team` and the others' `team` saying who's on which: set,
  // or seen in them (anyone on team 1).
  teams: boolean;
  private teamed = false;
  private readonly f: Field;
  private readonly paths: Paths;
  private readonly skill: number;
  private readonly rand: () => number;
  private readonly teamOf = new Map<string, number>();
  // The fire each bot's taken and not yet lost: a whole point at a time.
  private readonly burnt = new Map<string, number>();
  private downs = 0;
  private turn = 0;

  constructor(f: Field, paths: Paths, skill: number, rand: () => number = Math.random, teams = false) {
    this.f = f;
    this.paths = paths;
    this.skill = skill;
    this.rand = rand;
    this.teams = teams;
    this.teamed = teams;
  }

  // A bot at a spawn (or, joining a round under way, where none of its enemies sees), with a loadout;
  // in a team round on its team; as good as the squad's bots, or as `skill` says.
  add(id: string, t: number, at: Spawn | null, others: readonly (Body & { team?: number })[] = [], o: { team?: number; skill?: number } = {}): FootBot {
    const b = new FootBot(id, this.f, this.paths, o.skill ?? this.skill, this.rand);
    b.s.team = o.team ?? 0;
    this.teamOf.set(id, b.s.team);
    if (b.s.team) this.teamed = true;
    b.spawn(at ?? pickSpawn(this.f, this.enemies(b, [...others, ...this.up()]), [], this.rand), b.pick(), t);
    this.bots.push(b);
    return b;
  }

  // The bots up, as the others see and shoot them.
  up(): Mark[] {
    return this.bots.filter((b) => b.s.alive).map((b) => b.body());
  }

  // Of a list of fighters, those a bot fights.
  private enemies<T extends Body & { team?: number }>(b: FootBot, list: readonly T[]): T[] {
    return list.filter((o) => o.id !== b.id && (!this.teamed || (o.team ?? this.teamOf.get(o.id)) !== b.s.team));
  }

  // Whether someone's a bot's team-mate in a team round (not the bot itself).
  private mates(id: string, b: FootBot): boolean {
    return this.teamed && id !== b.id && this.teamOf.get(id) === b.s.team;
  }

  // A step of dt at round ms t, the others (everyone up in the round but the bots) where they are, the
  // karts waiting, and the smokes and fires: each bot coming back, or looking, walking, and firing or
  // throwing. Its shots and grenades.
  step(dt: number, t: number, others: readonly Mark[], blockers: readonly Blocker[], world: Hazards = NONE): FightEv[] {
    // Who's on which team (the host sets a bot's after adding it), and whether it's a team round.
    let teamed = this.teams;
    for (const o of others) {
      if (o.team !== undefined) this.teamOf.set(o.id, o.team);
      if (o.team) teamed = true;
    }
    for (const b of this.bots) {
      this.teamOf.set(b.id, b.s.team);
      if (b.s.team) teamed = true;
    }
    this.teamed = teamed;
    const out: FightEv[] = [];
    const up = this.up();
    // One of them may plan a way (or weigh a grenade) each step, each first in turn.
    const plans = { left: 1 };
    const n = this.bots.length;
    this.turn = (this.turn + 1) % Math.max(1, n);
    for (let k = 0; k < n; k++) {
      const b = this.bots[(k + this.turn) % n];
      if (!b.s.alive) {
        if (t - b.s.downAt >= RESPAWN) b.spawn(pickSpawn(this.f, this.enemies(b, [...others, ...up]), blockers, this.rand), b.pick(), t);
        continue;
      }
      const ev = b.step(dt, t, { others: [...others, ...up.filter((o) => o.id !== b.id)], blockers, plans, clouds: world.clouds, fires: world.fires, teams: teamed });
      if (ev) out.push(ev);
    }
    return out;
  }

  // A shot, anyone's (a gun's or a knife's), at round ms t: the bots hear it (a silenced gun only
  // close by, a team-mate's not at all), and those it hit are hurt (a team-mate's bullets pass
  // through). Those it put down.
  shot(ev: ShotEv, t: number): DownEv[] {
    const out: DownEv[] = [];
    const quiet = ev.w === 'knife' || (isGun(ev.w) && GUNS[ev.w].silenced);
    for (const b of this.bots) {
      if (b.id === ev.owner) continue;
      const mate = this.mates(ev.owner, b);
      const d = Math.hypot(ev.x - b.w.p.x, ev.z - b.w.p.z);
      if (!mate && (!quiet || d < (ev.w === 'knife' ? 4 : MUFFLED))) b.hear(ev.x, ev.y, ev.z, t);
      const h = ev.hits.find((x) => x.v === b.id);
      if (!h || !b.s.alive || mate) continue;
      b.hit(ev.x, ev.y, ev.z, t);
      if (!b.s.hurt(h, ev.w, t).down) continue;
      const p = b.w.p;
      out.push({ k: 'down', id: `${b.id}:d${++this.downs}`, victim: b.id, by: ev.owner, w: ev.w, head: h.h > 0, x: p.x, y: p.y, z: p.z });
    }
    return out;
  }

  // A grenade going off at round ms t (its flight's end), anyone's: an HE grenade's blast hurts the
  // bots it reaches (not the thrower's team-mates, in a team round), a flash blinds those who see it,
  // by where they look, and both are heard. clearTo: whether nothing stops a line between two points
  // (the round's ground). Those it put down.
  boom(ev: NadeEv, f: Flight, t: number, clearTo: (a: V, b: V) => boolean): DownEv[] {
    const out: DownEv[] = [];
    if (ev.w !== 'he' && ev.w !== 'flash') return out;
    const at = v3(f.at.x, f.at.y, f.at.z);
    for (const b of this.bots) {
      if (!b.s.alive) continue;
      const p = b.w.p;
      const mate = this.mates(ev.owner, b);
      if (ev.w === 'flash') {
        const ms = blinding(at, b.eye(), b.w.dir(), clearTo);
        if (ms > 0) b.blind(t + ms * 1.2, t);
        continue;
      }
      if (!mate && b.id !== ev.owner && Math.hypot(at.x - p.x, at.z - p.z) < 30) b.hear(ev.x, ev.y, ev.z, t);
      if (mate) continue;
      const n = blast(at, p, clearTo);
      if (n <= 0) continue;
      if (b.id !== ev.owner) b.hit(ev.x, ev.y, ev.z, t);
      if (!b.s.hurt({ b: n, h: 0, l: 0 }, 'he', t).down) continue;
      out.push({ k: 'down', id: `${b.id}:d${++this.downs}`, victim: b.id, by: ev.owner, w: 'he', head: false, x: p.x, y: p.y, z: p.z });
    }
    return out;
  }

  // The fires at round ms t, a step of dt: each bot standing in one burns (a whole point of health at
  // a time), but in a team-mate's in a team round. Those it put down, the fire's thrower's kill.
  burn(fires: readonly Burning[], t: number, dt: number): DownEv[] {
    const out: DownEv[] = [];
    for (const b of this.bots) {
      if (!b.s.alive) continue;
      const p = b.w.p;
      const on = fires.find((f) => inFire(f, p, t) && !this.mates(f.owner, b));
      if (!on) {
        this.burnt.delete(b.id);
        continue;
      }
      const acc = (this.burnt.get(b.id) ?? 0) + FIRE.dps * dt;
      const n = Math.floor(acc);
      this.burnt.set(b.id, acc - n);
      if (n < 1 || !b.s.hurt({ b: n, h: 0, l: 0 }, 'molotov', t).down) continue;
      this.burnt.delete(b.id);
      out.push({ k: 'down', id: `${b.id}:d${++this.downs}`, victim: b.id, by: on.owner, w: 'molotov', head: false, x: p.x, y: p.y, z: p.z });
    }
    return out;
  }
}
