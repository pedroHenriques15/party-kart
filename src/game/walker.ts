// On foot (braga-map's task 073): you get out of your kart and walk Braga at a person's height, in
// first person, your kart waiting where you left it. A walker stands on the world's ground as a kart
// does (floor()): up a kerb or a tread a step high, down any, off a retaining wall's top but never up
// its face; and the walls, fences, hedges, gates, buildings and trees stop it at its own radius
// (WorldGround.circle). Pure, like the karts' physics, so the tests walk it.
import { angleDiff, clamp, v3, type V } from '../math.ts';
import { STEP, type Floor, type WorldGround } from '../world/ground.ts';
import type { Blocker } from '../world/sight.ts';

export const HEIGHT = 1.75;
export const EYE = 1.65; // the eye's height over the feet
export const RADIUS = 0.3;
export const WALK = 1.5; // m/s
export const RUN = 5;
const JUMP = 2.8; // m/s up: about 40 cm
const G = 9.81;
// The steepest land a walker goes up off a street, a pavement or a path (45°): a bank, not a cliff.
const CLIMB = 1;
const PITCH = (85 * Math.PI) / 180;
// How far a walker reaches across a gap between two treads of a flight (the map leaves a few
// centimetres between some).
const GAP = 0.15;
// The pace eases towards the one wanted with this time constant, s: at once on the ground, hardly in
// the air.
const EASE = 0.08;
const AIR = 1;
// The arrows' turn, rad/s.
const TURN = 1.8;

export interface WalkInput {
  fwd: number; // -1 to 1: the way it faces
  side: number; // -1 to 1: to its right
  turn: number; // -1 to 1: the arrows, to the right
  look: { x: number; y: number }; // the mouse or a drag this step, in radians: to the right, and up
  run: boolean;
  jump: boolean;
}

export const STAND: WalkInput = { fwd: 0, side: 0, turn: 0, look: { x: 0, y: 0 }, run: false, jump: false };

export class Walker {
  p: V; // the feet
  v: V = v3();
  yaw: number; // as a car's: it faces (cos yaw, 0, sin yaw)
  pitch: number; // up from level
  grounded = true;
  ground: WorldGround;
  // What else stops it, for a while (braga-map's task 074): the karts waiting and the others on foot,
  // as upright circles; and an area it keeps in, a round's.
  blockers: readonly Blocker[] = [];
  bound: ((x: number, z: number) => boolean) | null = null;

  constructor(ground: WorldGround, p: V, yaw: number, pitch = 0) {
    this.ground = ground;
    this.p = v3(p.x, ground.floor(p.x, p.z, p.y + STEP).y, p.z);
    this.yaw = yaw;
    this.pitch = clamp(pitch, -PITCH, PITCH);
  }

  // How fast it goes over the ground.
  speed(): number {
    return Math.hypot(this.v.x, this.v.z);
  }

  // The way it looks.
  dir(): V {
    const c = Math.cos(this.pitch);
    return v3(Math.cos(this.yaw) * c, Math.sin(this.pitch), Math.sin(this.yaw) * c);
  }

  // Turns its head by the mouse's or a finger's drag, in radians: to the right, and up.
  look(d: { x: number; y: number }): void {
    this.yaw = angleDiff(this.yaw + d.x, 0);
    this.pitch = clamp(this.pitch + d.y, -PITCH, PITCH);
  }

  // A step of dt. True when it was lost (out of the world, under it) and put back on a street.
  step(inp: WalkInput, dt: number): boolean {
    this.yaw = angleDiff(this.yaw + inp.turn * TURN * dt, 0);
    this.look(inp.look);
    const { p, v, ground: g } = this;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    let mx = inp.fwd * cy - inp.side * sy;
    let mz = inp.fwd * sy + inp.side * cy;
    const m = Math.hypot(mx, mz);
    if (m > 1) {
      mx /= m;
      mz /= m;
    }
    const pace = inp.run ? RUN : WALK;
    const k = 1 - Math.exp(-dt / (this.grounded ? EASE : AIR));
    v.x += (mx * pace - v.x) * k;
    v.z += (mz * pace - v.z) * k;

    // Across: out of the walls round it, and back where the ground won't have it (the land over its
    // head, a bank too steep, the river, the area's edge), sliding along whatever stopped it.
    const [x, z] = this.clear(p.x, p.z, p.x + v.x * dt, p.z + v.z * dt);
    if (this.can(x, z)) [p.x, p.z] = [x, z];
    else if (this.can(x, p.z)) p.x = x;
    else if (this.can(p.x, z)) p.z = z;
    if (p.x !== x) v.x = 0;
    if (p.z !== z) v.z = 0;

    // Up and down: on the highest surface a step over its feet or under them, or falling.
    if (this.grounded && inp.jump) {
      v.y = JUMP;
      this.grounded = false;
    }
    if (this.grounded) {
      const f = this.footing(p.x, p.z, p.y);
      if (f.y >= p.y - STEP) p.y = f.y;
      else this.grounded = false;
    }
    if (!this.grounded) {
      const was = p.y;
      v.y -= G * dt;
      p.y += v.y * dt;
      // What it's come down on this step, however far it fell into it.
      const f = this.footing(p.x, p.z, Math.max(was, p.y));
      if (v.y <= 0 && p.y <= f.y) {
        p.y = f.y;
        v.y = 0;
        this.grounded = true;
      }
    }
    const b = g.d.world.box;
    if (p.y < -40 || p.x < b.x0 || p.x > b.x1 || p.z < b.z0 || p.z > b.z1 || this.footing(p.x, p.z, p.y).buried) {
      this.respawn();
      return true;
    }
    return false;
  }

  // What it stands on at (x, z), from height y: the ground's floor, but where that's the land over its
  // head, a tread a step or less up within reach, as between two treads of a flight in a cutting.
  footing(x: number, z: number, y: number): Floor {
    const g = this.ground;
    const f = g.floor(x, z, y);
    if (!f.buried) return f;
    let best: Floor | null = null;
    for (const [dx, dz] of [[GAP, 0], [-GAP, 0], [0, GAP], [0, -GAP]]) {
      const t = g.tread(x + dx, z + dz);
      if (t && t.y <= y + STEP && (!best || t.y > best.y)) best = { y: t.y, kind: 'steps', raise: 0, piece: null, buried: false };
    }
    return best ?? f;
  }

  // Back on the street nearest where it is, at its level.
  respawn(): void {
    const c = this.ground.spawn(this.p.x, this.p.z, this.p.y, this.yaw);
    this.p = v3(c.p.x, c.p.y, c.p.z);
    this.v = v3();
    this.grounded = true;
  }

  // Where a walker moving from (x0, z0) to (x, z) ends up, pushed out of the walls and trunks round it;
  // else, where two of them push it back and forth (at a wall's end, going straight at it), along the
  // first it met, sliding round the end; else where it was.
  private clear(x0: number, z0: number, x: number, z: number): [number, number] {
    const first = this.deepest(x, z, x0, z0);
    if (!first) return [x, z];
    const [mx, mz] = [x - x0, z - z0];
    // Out by a millimetre more than it's in: just out, the next look could find it in by a rounding
    // error too small to move it, for ever.
    for (let pass = 0; pass < 4; pass++) {
      const hit = pass ? this.deepest(x, z, x0, z0) : first;
      if (!hit) return [x, z];
      x += hit.nx * (hit.d + 1e-3);
      z += hit.nz * (hit.d + 1e-3);
    }
    if (!this.deepest(x, z, x0, z0)) return [x, z];
    const along = mx * -first.nz + mz * first.nx;
    const sx = x0 - first.nz * along;
    const sz = z0 + first.nx * along;
    return this.deepest(sx, sz, x0, z0) ? [x0, z0] : [sx, sz];
  }

  // The wall, trunk or blocker a walker at (x, z) is deepest into, coming from (x0, z0).
  private deepest(x: number, z: number, x0: number, z0: number): { nx: number; nz: number; d: number } | null {
    let best = this.ground.circle(x, z, x0, z0, this.p.y, RADIUS, HEIGHT, true);
    for (const b of this.blockers) {
      if (this.p.y >= b.y1 || this.p.y + HEIGHT <= b.y0) continue;
      const dx = x - b.x;
      const dz = z - b.z;
      const q = Math.hypot(dx, dz);
      const d = RADIUS + b.r - q;
      if (d > 0 && (!best || d > best.d)) best = q > 1e-6 ? { nx: dx / q, nz: dz / q, d } : { nx: 1, nz: 0, d };
    }
    return best;
  }

  // Whether the ground lets it stand at (x, z), coming from where it is.
  private can(x: number, z: number): boolean {
    const g = this.ground;
    const d = g.d;
    if (!d.inside.has(x, z) || (this.bound && !this.bound(x, z))) return false;
    const f = this.footing(x, z, this.p.y);
    if (f.buried) return false;
    // In the river.
    const r = d.land.riverAt(x, z);
    if (r.d < d.land.HW && f.y < r.y - 0.3) return false;
    // Up a bank too steep, off the streets and paths; or jumping up it, from the land under it. (A
    // retaining wall's foot is such a bank: the land is a 2 m grid's, which ramps up to its top.)
    if (f.kind === 'land' && f.y > this.p.y - 0.5) {
      const h = d.land.land;
      const gx = h(x + 0.5, z) - h(x - 0.5, z);
      const gz = h(x, z + 0.5) - h(x, z - 0.5);
      const mx = x - this.p.x;
      const mz = z - this.p.z;
      const up = (mx * gx + mz * gz) / (Math.hypot(mx, mz) || 1);
      if (up > CLIMB) return false;
    }
    return true;
  }
}

// Out of the kart at (p, yaw): beside it on the side with the pavement, if there's room on it (the
// walls and trees clear, and nothing between it and the kart), else on the other side, in front,
// behind, or where the kart is.
export function alight(g: WorldGround, p: V, yaw: number): Walker {
  const rx = -Math.sin(yaw);
  const rz = Math.cos(yaw);
  const fx = Math.cos(yaw);
  const fz = Math.sin(yaw);
  let best: { x: number; y: number; z: number; score: number } | null = null;
  const spots: [number, number, number][] = [];
  for (const s of [1, -1]) for (const d of [1.6, 2.2, 2.8]) spots.push([rx * s * d, rz * s * d, d]);
  for (const s of [1, -1]) spots.push([fx * s * 3, fz * s * 3, 6]);
  for (const [dx, dz, d] of spots) {
    const x = p.x + dx;
    const z = p.z + dz;
    if (!g.d.inside.has(x, z)) continue;
    const f = g.floor(x, z, p.y + 0.5);
    if (f.buried || Math.abs(f.y - p.y) > 1 || g.circle(x, z, p.x, p.z, f.y, RADIUS, HEIGHT, true)) continue;
    const score = d + (f.kind === 'pavement' || f.kind === 'path' || f.kind === 'steps' ? 0 : 10);
    if (!best || score < best.score) best = { x, y: f.y, z, score };
  }
  return new Walker(g, best ? v3(best.x, best.y, best.z) : v3(p.x, p.y, p.z), yaw);
}
