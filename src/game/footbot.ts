// The bots on foot (braga-map's task 075): the deathmatch's empty places filled, as the race's are,
// run by the host. A bot chooses a kit each time it comes back, finds its way round Fujacal on the
// walkable ground (world/paths.ts), looks for someone, turns to a shot or a footstep it hears and to a
// hit, aims with a reaction time and an error that shrink with its skill, fires in bursts, reloads,
// and backs off into cover when it's hurt. It sees only what a look lets it see (world/sight.ts), and
// it shoots as a player does: fire() from its eye the way it looks, its kit's spread and all.
// Pure, like the karts' physics, so the tests fight rounds of bots.
import { angleDiff, clamp, norm, v3, type V } from '../math.ts';
import type { Paths } from '../world/paths.ts';
import { clear, type Blocker } from '../world/sight.ts';
import { eyeOf, fire, HEAD, KIT_IDS, KITS, pickSpawn, RESPAWN, seeOn, Soldier, TORSO, type Body, type DownEv, type Field, type KitId, type ShotEv, type Spawn } from './fight.ts';
import { HEIGHT, RADIUS, STAND, Walker, type WalkInput } from './walker.ts';

// The bots' levels, as the round's settings offer them.
export const SKILLS = ['Fácil', 'Médio', 'Difícil'] as const;

// Someone a bot might see and shoot: where they stand, and how fast they go (for their footsteps).
export interface Mark extends Body {
  spd: number;
}

const deg = Math.PI / 180;
const mix = (a: number, b: number, s: number) => a + (b - a) * s;

// What a level of skill (0 the lowest, 1 the highest) makes of a bot.
interface Skill {
  react: number; // s from seeing someone to the first shot
  err: number; // rad off at first, aiming at someone just seen; it settles on them
  settle: number; // s, as quickly as this (a time constant)
  shake: number; // rad off, however long it has aimed
  lag: number; // s its aim trails someone moving
  turn: number; // rad/s, the fastest it turns
  fov: number; // rad, half its field of view
  far: number; // m, the furthest it sees someone
  pace: number; // s more between a semi-automatic's shots than the gun needs
  burst: number; // an automatic's shots in a burst
  rest: number; // s between bursts
  strafe: number; // how likely it is to move across while it fires
  head: number; // how likely it is to aim at the head
  hurt: number; // health under which it backs off
  ears: number; // how far it hears, as a part of the most
}

export function skillOf(s: number): Skill {
  s = clamp(s, 0, 1);
  return {
    react: mix(0.85, 0.22, s),
    err: mix(11, 3, s) * deg,
    settle: mix(1.1, 0.3, s),
    shake: mix(1.6, 0.25, s) * deg,
    lag: mix(0.35, 0.06, s),
    turn: mix(150, 480, s) * deg,
    fov: mix(50, 70, s) * deg,
    far: mix(110, 260, s),
    pace: mix(0.5, 0.06, s),
    burst: Math.round(mix(3, 6, s)),
    rest: mix(0.7, 0.22, s),
    strafe: mix(0.1, 0.8, s),
    head: mix(0, 0.35, s),
    hurt: mix(25, 55, s),
    ears: mix(0.6, 1, s),
  };
}

// How far each kit's bot likes to fight from: closer it comes in, further it holds and fires; and
// past `far`, it doesn't fire but comes closer.
const RANGE: Record<KitId, { near: number; far: number }> = {
  rifle: { near: 0, far: 110 },
  shotgun: { near: 7, far: 26 },
  sniper: { near: 0, far: 400 },
  pistol: { near: 0, far: 55 },
};

// How often a bot looks round for someone (s), and how long it remembers where it last saw or heard
// someone.
const LOOK = 0.15;
const RECALL = 7;
const HEARD = 9;
// Footsteps: running heard this far, walking this far (m). A shot is heard all over Fujacal (as a
// player hears it, 1.5 km off), but where it was is only roughly known, the less the further: off by
// up to this much of the way to it.
const STEPS_RUN = 18;
const STEPS_WALK = 6;
const SHOTS = 0.15;
// With nothing seen or heard for this long (ms), a bot has an idea where someone is, as far-off
// footsteps would give a player: it makes for somewhere this far (m) from one of them.
const QUIET = 8000;
const HUNCH = [8, 20];
// Up a tower, how long it holds there (ms), and how fast it looks round meanwhile (rad/s).
const HOLD = [8000, 16000];
const SCAN = 0.5;

// Where on someone a bot aims, and looks for them (and their head).
export const CHEST = (TORSO.y0 + TORSO.y1) / 2 + 0.05;
// How long its hands' tremble takes to change, s.
const TREMBLE = 0.35;

// A number about as likely as a bell curve's, its spread 1.
const gauss = (rand: () => number) => (rand() + rand() + rand() + rand() - 2) * 1.73;

interface Sighting {
  id: string;
  x: number;
  y: number;
  z: number;
  t: number; // round ms it was last seen
  first: number; // round ms it was first seen, this time
}

// What a bot knows of the round, a step at a time: the others it might see and shoot (everyone up in
// the round but itself), and what stops a look, a shot and someone on foot besides the walls (the
// karts waiting). The others stop it walking too, but not its look at them. plans: how many more
// bots may find a way or look for cover this step (a millisecond or so each): the rest wait for the
// next, so the bots together never hold up a frame.
export interface View {
  others: readonly Mark[];
  blockers: readonly Blocker[];
  plans?: { left: number };
}

export class FootBot {
  readonly id: string;
  readonly s: Soldier;
  w: Walker;
  skill: Skill;
  fav: KitId; // the kit it likes
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
  // Its aim: the point it's making for on someone, trailing them, and how far off it is.
  private aim: V | null = null;
  private ex = 0;
  private ey = 0;
  private jx = 0; // and its hands' tremble, wandering
  private jy = 0;
  private headShot = false;
  private burstLeft = 0;
  private restUntil = 0;
  private side = 1;
  private sideUntil = 0;
  private sideAt = 0;
  private covered = 0; // round ms it got to cover
  private coverAt = 0; // round ms it may look for cover again, having found none
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
  stuck = 0; // times it had to be put back on the paths
  shots = 0;

  constructor(id: string, f: Field, paths: Paths, skill: number, rand: () => number = Math.random) {
    this.id = id;
    this.f = f;
    this.paths = paths;
    this.skill = skillOf(skill);
    this.rand = rand;
    this.fav = KIT_IDS[Math.floor(rand() * KIT_IDS.length)];
    this.s = new Soldier(id, this.fav);
    const s0 = f.spawns[0];
    this.w = new Walker(f.ground, v3(s0.x, s0.y, s0.z), s0.yaw);
    this.w.bound = f.inside;
    // The arena's towers' floors and roof (braga-map's task 079): each flight's top, and the roof
    // outside its hut.
    for (const r of f.ground.d.rooms) {
      if (!r.stair || !f.inside((r.box.x0 + r.box.x1) / 2, (r.box.z0 + r.box.z1) / 2)) continue;
      for (const way of r.stair.ways) this.perches.push(way[way.length - 1]);
    }
  }

  // The kit it comes back with: the one it likes, more often than not.
  pick(): KitId {
    return this.rand() < 0.55 ? this.fav : KIT_IDS[Math.floor(this.rand() * KIT_IDS.length)];
  }

  // Back at a spawn at round ms t with a kit, knowing nothing.
  spawn(sp: Spawn, kit: KitId, t: number): void {
    this.w.p = v3(sp.x, sp.y, sp.z);
    this.w.v = v3();
    this.w.yaw = sp.yaw;
    this.w.pitch = 0;
    this.w.grounded = true;
    this.s.arm(kit, t);
    this.way = null;
    this.last = -1;
    this.foe = this.seen = this.heard = this.threat = null;
    this.news = t;
    this.aim = null;
    this.burstLeft = 0;
    this.pin = { x: sp.x, z: sp.z, t };
    this.holdUntil = 0;
    this.perching = false;
    // Back, it makes for a tower now and then; with the sniper's rifle, more often than not.
    if (this.perches.length && this.rand() < (kit === 'sniper' ? 0.7 : 0.25)) {
      const q = this.perches[Math.floor(this.rand() * this.perches.length)];
      this.perching = this.go(q, 'roam', t);
    }
  }

  // Where it stands, as a shot finds it.
  body(): Mark {
    return { id: this.id, x: this.w.p.x, y: this.w.p.y, z: this.w.p.z, spd: this.w.speed() };
  }

  // A shot heard at round ms t, fired from (x, y, z): about there.
  hear(x: number, y: number, z: number, t: number): void {
    if (!this.s.alive) return;
    const d = Math.hypot(x - this.w.p.x, z - this.w.p.z);
    if (d < 1) return;
    const off = d * SHOTS * (2 - this.skill.ears) * this.rand();
    const a = this.rand() * Math.PI * 2;
    this.heard = { x: x + Math.cos(a) * off, y, z: z + Math.sin(a) * off, t };
    this.news = t;
  }

  // Hit at round ms t by a shot from (x, y, z): it knows where from, and turns to it.
  hit(x: number, y: number, z: number, t: number): void {
    this.threat = { x, y, z, t };
    this.heard = { x, y, z, t };
  }

  // A step of dt at round ms t: it looks, thinks, walks, aims, and fires if it means to. Its shot, or
  // null.
  step(dt: number, t: number, view: View): ShotEv | null {
    const { w, s } = this;
    s.step(dt, t);
    if (!s.alive) return null;
    w.blockers = [...view.blockers, ...view.others.map((o) => ({ x: o.x, z: o.z, r: RADIUS, y0: o.y, y1: o.y + HEIGHT }))];
    if (t >= this.lookAt) {
      this.lookAt = t + LOOK * 1000 * (0.8 + this.rand() * 0.4);
      this.look(t, view);
    }
    // Whoever it saw at its last look, it follows with its eyes till the next; down, they're gone.
    const foe = this.foe;
    const o = foe && view.others.find((x) => x.id === foe.id);
    if (foe && !o) this.foe = null;
    else if (foe && o && foe.t === this.seen?.t) Object.assign(foe, { x: o.x, y: o.y, z: o.z });
    const inp = this.think(dt, t, view);
    if (w.step(inp, dt)) this.stuck++;
    this.unpin(t, inp);
    return this.trigger(t, view);
  }

  // Who it can see now (the nearest, or the one it was after while it still can), and what it hears.
  private look(t: number, view: View): void {
    const { w, skill } = this;
    const eye = eyeOf(w.p);
    const facing = w.yaw;
    const far = skill.far * (this.s.kit === 'sniper' ? 1.5 : 1);
    let best: Sighting | null = null;
    // Nearest first, the one it's after counting nearer (it doesn't switch for someone a little
    // closer): the first it sees is the one.
    const near = view.others
      .filter((o) => o.id !== this.id)
      .map((o) => ({ o, d: Math.hypot(o.x - w.p.x, o.z - w.p.z) }))
      .sort((a, b) => a.d * (a.o.id === this.foe?.id ? 0.6 : 1) - b.d * (b.o.id === this.foe?.id ? 0.6 : 1));
    for (const { o, d } of near) {
      const dx = o.x - w.p.x;
      const dz = o.z - w.p.z;
      // Footsteps, seen or not.
      if (o.spd > 0.6 && d < (o.spd > 3 ? STEPS_RUN : STEPS_WALK) * skill.ears && (!this.heard || t - this.heard.t > 1000)) {
        this.heard = { x: o.x, y: o.y, z: o.z, t };
        this.news = t;
      }
      if (d > far) continue;
      const mine = this.foe?.id === o.id;
      // In its field of view, or close by, or the one it's after (it's turned to them).
      if (d > 3 && !mine && Math.abs(angleDiff(Math.atan2(dz, dx), facing)) > skill.fov) continue;
      const head = v3(o.x, o.y + HEAD.y, o.z);
      const chest = v3(o.x, o.y + CHEST, o.z);
      if (best) continue;
      if (!clear(this.f.ground, eye, head, view.blockers) && !clear(this.f.ground, eye, chest, view.blockers)) continue;
      best = { id: o.id, x: o.x, y: o.y, z: o.z, t, first: mine ? this.foe!.first : t };
    }
    if (best) {
      // Someone new, or someone it lost a while ago: its aim starts off.
      if (!this.foe || this.foe.id !== best.id || t - this.foe.t > 1200) this.acquire(best, t);
      this.foe = best;
      this.seen = { ...best };
      this.news = t;
    } else if (this.foe && t - this.foe.t > 400) {
      this.foe = null;
    }
  }

  private acquire(o: Sighting, t: number): void {
    const a = this.rand() * Math.PI * 2;
    const e = this.skill.err * (0.6 + this.rand() * 0.8);
    this.ex = Math.cos(a) * e;
    this.ey = Math.sin(a) * e * 0.6;
    this.headShot = this.rand() < this.skill.head;
    this.aim = this.aim && this.foe ? this.aim : v3(o.x, o.y + CHEST, o.z);
    o.first = t;
  }

  // Where to go and where to look this step.
  private think(dt: number, t: number, view: View): WalkInput {
    const { w, s, skill } = this;
    const k = KITS[s.kit];
    const foe = this.foe;
    const hurt = s.health < skill.hurt;
    const threat = this.threat && t - this.threat.t < 4000 ? this.threat : foe && t - foe.t < 1500 ? foe : null;

    // Out of bullets, it reloads; with nobody in sight and its magazine low, too.
    if (s.ammo === 0 || (!foe && s.ammo < k.mag / 2 && !s.reloading)) s.reload(t);

    // Hurt, or reloading with someone about: into cover, away from them, till it's whole (or someone
    // comes close).
    if ((hurt || (s.reloading && foe)) && threat && this.goal !== 'cover' && t >= this.coverAt && this.may(view)) this.takeCover(threat, t);
    if (this.goal === 'cover') {
      const safe = s.health >= 90 && !s.reloading;
      const done = !this.way || this.next >= this.way.length;
      if (done && !this.covered) this.covered = t;
      if (safe || (this.covered && t - this.covered > 12000) || (foe && Math.hypot(foe.x - w.p.x, foe.z - w.p.z) < 8)) {
        this.goal = 'roam';
        this.way = null;
      }
    }

    // Someone in sight: it turns to them and fights, from where its kit likes.
    let move: V | null = null;
    let run = true;
    if (foe && this.goal !== 'cover') {
      const d = Math.hypot(foe.x - w.p.x, foe.z - w.p.z);
      const r = RANGE[s.kit];
      // Too far for its kit, or a shotgun coming in: towards them.
      if (d > r.far || (s.kit === 'shotgun' && d > r.near + 1)) move = this.towards(foe, t, view);
      // Across their line, walking, now one way and now the other: a target that moves, and a gun
      // that still hits. Not into a wall, and not with a sniper's rifle, which stands still to shoot.
      const dx = (foe.x - w.p.x) / (d || 1);
      const dz = (foe.z - w.p.z) / (d || 1);
      const open = (k: number) => this.paths.straight(w.p.x, w.p.z, w.p.x - dz * k * 2, w.p.z + dx * k * 2, w.p.y);
      if (this.side && w.speed() < 0.3 && t - this.sideAt > 400) this.sideUntil = 0;
      if (!move && t >= this.sideUntil) {
        this.sideUntil = t + 600 + this.rand() * 1400;
        this.sideAt = t;
        this.side = s.kit !== 'sniper' && this.rand() < skill.strafe ? (this.rand() < 0.5 ? -1 : 1) : 0;
        if (this.side && !open(this.side)) this.side = open(-this.side) ? -this.side : 0;
      }
      if (!move && this.side) {
        move = v3(-dz * this.side, 0, dx * this.side);
        run = false;
      }
      if (s.kit === 'sniper' && !move) s.scoped = d > 6 && !s.reloading;
      else s.scoped = false;
    } else {
      s.scoped = false;
      if (this.goal !== 'cover') {
        // Where it last saw someone, or heard them; else somewhere else in Fujacal.
        const lead = this.seen && t - this.seen.t < RECALL * 1000 ? this.seen : this.heard && t - this.heard.t < HEARD * 1000 ? this.heard : null;
        if (lead && !this.perching) {
          // There, or no way there: it forgets it.
          const fresh = this.goal !== 'hunt' || t - this.wayAt > 3000;
          if ((fresh && this.may(view) && !this.go(lead, 'hunt', t)) || Math.hypot(lead.x - w.p.x, lead.z - w.p.z) < 3) {
            if (lead === this.seen) this.seen = null;
            else this.heard = null;
          }
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

    // Where it looks: at whoever it's fighting; else where it heard something, or was hurt from; else
    // the way it goes.
    let yaw = w.yaw;
    let pitch = 0;
    if (foe) {
      const want = v3(foe.x, foe.y + (this.headShot ? HEAD.y : CHEST), foe.z);
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
      const e = eyeOf(w.p);
      const dx = this.aim.x - e.x;
      const dy = this.aim.y - e.y;
      const dz = this.aim.z - e.z;
      yaw = Math.atan2(dz, dx) + this.ex + this.jx;
      pitch = Math.atan2(dy, Math.hypot(dx, dz)) + this.ey + this.jy;
    } else {
      this.aim = null;
      const turn = threat ?? (this.heard && t - this.heard.t < 1500 ? this.heard : null);
      if (turn && this.goal !== 'cover') yaw = Math.atan2(turn.z - w.p.z, turn.x - w.p.x);
      else if (move && (move.x || move.z)) yaw = Math.atan2(move.z, move.x);
      else if (t < this.holdUntil) yaw = w.yaw + SCAN * dt;
    }
    const most = skill.turn * dt;
    const dyaw = clamp(angleDiff(yaw, w.yaw), -most, most);
    const dpitch = clamp(pitch - w.pitch, -most, most);
    w.look({ x: dyaw, y: dpitch });

    if (!move) return STAND;
    const cy = Math.cos(w.yaw);
    const sy = Math.sin(w.yaw);
    return { ...STAND, fwd: move.x * cy + move.z * sy, side: -move.x * sy + move.z * cy, run };
  }

  // Towards someone it sees, on the paths: a way found every second or so.
  private towards(o: { x: number; y: number; z: number }, t: number, view: View): V | null {
    if ((this.goal !== 'hunt' || t - this.wayAt > 1000) && this.may(view)) this.go(o, 'hunt', t);
    return this.follow(t);
  }

  // Whether it may find a way this step.
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
    // Up a tower, now and then; with the sniper's rifle, more often than not.
    if (this.perches.length && this.rand() < (this.s.kit === 'sniper' ? 0.6 : 0.2)) {
      const q = this.perches[Math.floor(this.rand() * this.perches.length)];
      if (this.go(q, 'roam', t)) {
        this.perching = true;
        return;
      }
    }
    if (t - this.news > QUIET && view.others.length && this.rand() < 0.7) {
      const o = view.others[Math.floor(this.rand() * view.others.length)];
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
  private takeCover(from: { x: number; y: number; z: number }, t: number): void {
    const P = this.paths;
    const here = P.near(this.w.p.x, this.w.p.z, this.w.p.y);
    const eye = eyeOf(from);
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
      if (clear(this.f.ground, eye, v3(x, P.y[p] + HEAD.y, z)) || clear(this.f.ground, eye, v3(x, P.y[p] + CHEST, z))) continue;
      this.way = P.find(here, p);
      this.next = 0;
      this.goal = 'cover';
      this.wayAt = t;
      this.covered = 0;
      return;
    }
  }

  // The way it goes along its way this step: to the furthest of its next few points it can walk to
  // straight.
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
    return norm(v3(P.x[q] - p.x, 0, P.z[q] - p.z));
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

  // Whether it fires this step: someone in sight, in its kit's range, seen long enough to have
  // reacted, its aim on them as far as it can tell, between bursts.
  private trigger(t: number, view: View): ShotEv | null {
    const { s, w, skill } = this;
    const foe = this.foe;
    if (!foe || t - foe.t > 250 || !s.ready(t) || t - foe.first < skill.react * 1000 || t < this.restUntil) return null;
    const k = KITS[s.kit];
    const e = eyeOf(w.p);
    const d = Math.hypot(foe.x - e.x, foe.z - e.z);
    if (d > RANGE[s.kit].far) return null;
    // On them: the way it looks within their width, as it sees them.
    const dir = w.dir();
    const to = norm(v3(foe.x - e.x, foe.y + CHEST - e.y, foe.z - e.z));
    const off = Math.acos(clamp(dir.x * to.x + dir.y * to.y + dir.z * to.z, -1, 1));
    if (off > Math.atan2(0.45, d) + skill.shake) return null;
    // Still in sight, where they are now: else it holds its fire till it sees them again.
    const head = v3(foe.x, foe.y + HEAD.y, foe.z);
    const chest = v3(foe.x, foe.y + CHEST, foe.z);
    if (!clear(this.f.ground, e, head, view.blockers) && !clear(this.f.ground, e, chest, view.blockers)) {
      foe.t = -1e9;
      return null;
    }
    const bodies: Body[] = view.others.filter((o) => o.id !== this.id);
    const ev = fire(s, e, dir, w.speed(), !w.grounded, t, bodies, seeOn(this.f, view.blockers), (this.rand() * 4294967296) >>> 0);
    if (!ev) return null;
    this.shots++;
    if (k.auto) {
      if (--this.burstLeft <= 0) {
        this.burstLeft = skill.burst + Math.floor(this.rand() * 3) - 1;
        this.restUntil = t + skill.rest * 1000 * (0.7 + this.rand() * 0.6);
      }
    } else this.restUntil = t + skill.pace * 1000 * (0.7 + this.rand() * 0.6);
    return ev;
  }
}

// A round's bots, as the host runs them: each comes back after a while at the spawn none of the others
// sees, with a kit; the shots they fire, and the shots anyone fires, heard by them and hurting them.
export class Squad {
  readonly bots: FootBot[] = [];
  private readonly f: Field;
  private readonly paths: Paths;
  private readonly skill: number;
  private readonly rand: () => number;
  private downs = 0;
  private turn = 0;

  constructor(f: Field, paths: Paths, skill: number, rand: () => number = Math.random) {
    this.f = f;
    this.paths = paths;
    this.skill = skill;
    this.rand = rand;
  }

  // A bot at a spawn (or, joining a round under way, where none of the others sees), with a kit.
  add(id: string, t: number, at: Spawn | null, others: readonly Body[] = []): FootBot {
    const b = new FootBot(id, this.f, this.paths, this.skill, this.rand);
    b.spawn(at ?? pickSpawn(this.f, [...others, ...this.bots.filter((o) => o.s.alive).map((o) => o.body())], [], this.rand), b.pick(), t);
    this.bots.push(b);
    return b;
  }

  // The bots up, as the others see and shoot them.
  up(): Mark[] {
    return this.bots.filter((b) => b.s.alive).map((b) => b.body());
  }

  // A step of dt at round ms t, the others (everyone up in the round but the bots) where they are and
  // the karts waiting: each bot coming back, or looking, walking and firing. The shots.
  step(dt: number, t: number, others: readonly Mark[], blockers: readonly Blocker[]): ShotEv[] {
    const shots: ShotEv[] = [];
    const up = this.up();
    // One of them may plan a way each step, each first in turn.
    const plans = { left: 1 };
    const n = this.bots.length;
    this.turn = (this.turn + 1) % Math.max(1, n);
    for (let k = 0; k < n; k++) {
      const b = this.bots[(k + this.turn) % n];
      if (!b.s.alive) {
        if (t - b.s.downAt >= RESPAWN) b.spawn(pickSpawn(this.f, [...others, ...up], blockers, this.rand), b.pick(), t);
        continue;
      }
      const ev = b.step(dt, t, { others: [...others, ...up.filter((o) => o.id !== b.id)], blockers, plans });
      if (ev) shots.push(ev);
    }
    return shots;
  }

  // A shot, anyone's, at round ms t: the bots hear it, and those it hit are hurt. Those it put down.
  shot(ev: ShotEv, t: number): DownEv[] {
    const out: DownEv[] = [];
    for (const b of this.bots) {
      if (b.id === ev.owner) continue;
      b.hear(ev.x, ev.y, ev.z, t);
      const h = ev.hits.find((x) => x.v === b.id);
      if (!h || !b.s.alive) continue;
      b.hit(ev.x, ev.y, ev.z, t);
      if (!b.s.hurt(h.n, t)) continue;
      const p = b.w.p;
      out.push({ k: 'down', id: `${b.id}:d${++this.downs}`, victim: b.id, by: ev.owner, kit: ev.kit, head: h.head, x: p.x, y: p.y, z: p.z });
    }
    return out;
  }
}
