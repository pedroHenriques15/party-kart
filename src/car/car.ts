// Arcade handling, Trackmania-style: grippy, quick to turn, drifts when you hold Space, flies off
// ramps and crests, and lands wherever the road is. What it drives on is a Ground: the race's track,
// or the world (src/world/ground.ts).
import { add, addScaled, clamp, cross, dot, len, norm, scale, sub, v3, type V } from '../math.ts';
import { locate, surfacePoint, type Track } from '../track/track.ts';

export const G = 12;
export const VMAX = 44; // m/s, about 158 km/h
const ACC = 17;
const BRAKE = 32;
const REVERSE = 12;
const VREV = 12;
const DRAG = 0.0015;
const ROLL = 0.6;
export const VBOOST = 60;
const BOOST_ACC = 28;
const BOOST_TIME = 1.2;
export const GRIP = 9;
const DRIFT_GRIP = 1.8;
export const STICK = 0.05; // how far the road can fall away and the car still hugs it
export const COYOTE = 0.12; // s after leaving the ground that the car still drives as if on it
const HALF_W = 1.0;
export const WALL_H = 1.3; // a car this far over a wall's foot flies over it
const FALL_RESPAWN = 0.9; // s off the road and well below it before a respawn
// The drift mini-turbo: drift this long, let go, and get this much boost.
export const TURBO1 = 0.8;
export const TURBO2 = 1.7;

export interface Input {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 left .. 1 right
  drift: boolean;
}

export const NO_INPUT: Input = { throttle: 0, brake: 0, steer: 0, drift: false };

// Brakes to a standstill and stays there. (Holding the brake alone would reverse once stopped.)
export function stopInput(c: Car, force = 1): Input {
  const vF = c.v.x * Math.cos(c.yaw) + c.v.z * Math.sin(c.yaw);
  return { throttle: vF < -0.5 ? force : 0, brake: vF > 0.5 ? force : 0, steer: 0, drift: false };
}

// What power-ups and catch-up do to the car: multiply its top speed and its acceleration.
export interface Mods {
  vmax: number;
  acc: number;
}
const NO_MODS: Mods = { vmax: 1, acc: 1 };

// What a car drives on. It says where the car's surface is and what it has run into; the handling
// (stepCar) is the same on any of them. The world's (worldGround in src/world/ground.ts) is the land
// and the streets at their levels, and what stands on them; a race's is the world's with the race's
// walls and ramp (src/world/race.ts). The track's own (trackGround) is the road's samples, walled at
// its edges: the first track's, kept for reference, which has no world round it, and the tests'.
export interface Ground {
  // The surface under the car where it is, before it moves: its normal, and whether it's a boost pad.
  under(c: Car): { n: V; boost: boolean };
  // After the car's move from `from`: stands it on what it's over (settle) or lets it fly (fly),
  // stops it at walls (bounce), and says whether it has fallen off or is stuck, which counts
  // towards a respawn.
  contact(c: Car, from: V, dt: number): boolean;
  // Puts a car made on the track (newCar, at the track's own height) on what's really under it.
  // The track's ground has no need: its road is the track's.
  place?(c: Car): Car;
  // A car moved from `from` by something besides its own driving (bumped by another): out of any
  // wall that took it through. The track's walls hold it wherever it is.
  nudge?(c: Car, from: V): void;
}

export interface Car {
  p: V;
  v: V;
  yaw: number; // heading: forward is (cos yaw, 0, sin yaw)
  up: V; // the surface's normal when grounded, for drawing
  grounded: boolean;
  idx: number; // nearest track sample, in a race
  boost: number; // s of boost left
  falling: number; // s spent fallen off
  air: number; // s since last on the ground
  drifting: boolean;
  drift: number; // s into the current drift, for the mini-turbo
  turbo: number; // 1 or 2 when a drift let go just now earned a mini-turbo
  wallHit: number; // speed lost against a wall this step, for sounds
  landed: number; // how hard it just landed (m/s down), 0 if it didn't
  lat: number; // metres right of the road's centre line, in a race
  h: number; // metres above the surface under it
}

// A car at a sample of the track, going along it.
export function newCar(track: Track, i: number, speed = 0): Car {
  const s = track.samples[i];
  return { ...carAt(surfacePoint(s, 0, 0.01), Math.atan2(s.t.z, s.t.x), s.n), v: scale(s.t, speed), idx: i };
}

// A car standing still at p, facing yaw, on a surface whose normal is up.
export function carAt(p: V, yaw: number, up: V): Car {
  return {
    p,
    v: v3(),
    yaw,
    up,
    grounded: true,
    idx: 0,
    boost: 0,
    falling: 0,
    air: 0,
    drifting: false,
    drift: 0,
    turbo: 0,
    wallHit: 0,
    landed: 0,
    lat: 0,
    h: 0,
  };
}

export const speedOf = (c: Car) => len(c.v);

// How fast the car can turn at a speed: quick when slow, wider when fast.
export function turnRate(speed: number): number {
  const v = Math.abs(speed);
  return Math.min(2.5, v * 0.3) * (1 - 0.45 * Math.min(1, v / VMAX));
}

// Advances the car by dt. Returns true when it fell off and should respawn.
export function stepCar(c: Car, inp: Input, g: Ground, dt: number, mods: Mods = NO_MODS): boolean {
  c.wallHit = 0;
  c.landed = 0;
  c.turbo = 0;
  const vmax = VMAX * mods.vmax;
  const flat = v3(Math.cos(c.yaw), 0, Math.sin(c.yaw));

  if (c.grounded || c.air < COYOTE) {
    const s0 = g.under(c);
    const n = s0.n;
    const f = norm(sub(flat, scale(n, dot(flat, n))));
    const r = norm(cross(f, n));
    let vF = dot(c.v, f);
    let vR = dot(c.v, r);

    let a = 0;
    if (inp.throttle > 0) a += vF >= -0.5 ? ACC * mods.acc * inp.throttle * Math.max(0, 1 - vF / vmax) : BRAKE * inp.throttle;
    if (inp.brake > 0) a -= vF > 0.5 ? BRAKE * inp.brake : REVERSE * inp.brake * Math.max(0, 1 + vF / VREV);
    if (s0.boost) c.boost = BOOST_TIME;
    if (c.boost > 0 && vF < VBOOST * mods.vmax) a += BOOST_ACC;
    // Above top speed (after a boost, or shrunk), ease back down to it.
    if (c.boost <= 0 && vF > vmax + 0.5) a -= (vF - vmax) * 1.5;
    a -= vF * Math.abs(vF) * DRAG + (Math.abs(vF) > 0.1 ? Math.sign(vF) * ROLL : 0);
    if (inp.throttle === 0 && inp.brake === 0 && Math.abs(vF) < 0.6) vF = 0;
    vF += a * dt;

    const wasDrifting = c.drifting;
    c.drifting = inp.drift && Math.abs(vF) > 12;
    // A drift held into the corner charges a mini-turbo, let go when you straighten up.
    if (c.drifting && Math.abs(inp.steer) > 0.3) c.drift += dt;
    if (wasDrifting && !c.drifting) {
      if (c.drift >= TURBO2) c.turbo = 2;
      else if (c.drift >= TURBO1) c.turbo = 1;
      if (c.turbo) c.boost = Math.max(c.boost, c.turbo === 2 ? 1.1 : 0.6);
      c.drift = 0;
    }
    if (!c.drifting) c.drift = 0;
    vR *= Math.exp(-(c.drifting ? DRIFT_GRIP : GRIP) * dt);
    // Keep whatever speed the car has off the surface (none on the road, some on a crest).
    c.v = add(add(scale(f, vF), scale(r, vR)), scale(n, dot(c.v, n)));
    // Full gravity: the road pushes back below (slopes slow you up and speed you down), and
    // where it falls away faster than the car can drop, the car flies.
    c.v.y -= G * dt;

    c.yaw += inp.steer * turnRate(vF) * Math.sign(vF || 1) * (c.drifting ? 1.3 : 1) * dt;
    c.up = n;
  } else {
    c.v.y -= G * dt;
    c.yaw += inp.steer * 0.9 * dt;
    // Level out slowly in the air.
    c.up = norm(add(c.up, scale(v3(0, 1, 0), dt * 1.5)));
  }
  c.boost = Math.max(0, c.boost - dt);

  const from = c.p;
  c.p = addScaled(c.p, c.v, dt);
  c.falling = g.contact(c, from, dt) ? c.falling + dt : 0;
  return c.falling > FALL_RESPAWN;
}

// Puts a car that's h over its surface (under it if negative, and no more than STICK over it) onto
// it, along its normal n: it stops sinking, a hard landing costs a little speed, and it notes how
// hard it landed after a flight.
export function settle(c: Car, n: V, h: number): void {
  c.p = addScaled(c.p, n, -h);
  const vn = dot(c.v, n);
  if (vn < 0) c.v = addScaled(c.v, n, -vn);
  if (c.air > 0.3 && vn < -10) c.v = scale(c.v, 0.97); // a hard landing costs a little
  if (c.air > 0.25) c.landed = -vn;
  c.grounded = true;
  c.air = 0;
}

// Off the ground for another dt.
export function fly(c: Car, dt: number): void {
  c.grounded = false;
  c.air += dt;
}

// Pushes a car d metres out of a wall whose face looks along n (towards the car), and bounces it
// off: it loses what speed it ran into the wall with, a little more, and a share of the rest by how
// hard it hit, all of which goes into wallHit, for sounds.
export function bounce(c: Car, n: V, d: number): void {
  c.p = addScaled(c.p, n, d);
  const out = -dot(c.v, n);
  if (out > 0) {
    const before = len(c.v);
    c.v = addScaled(c.v, n, out * 1.25);
    c.v = scale(c.v, 1 - Math.min(0.25, out * 0.012));
    c.wallHit += before - len(c.v);
  }
}

// A track as a ground: the car is on the road where it's within its width and not far
// under it, the walls stand at its edges where it has any, and it has fallen off when it's well off
// the road and below it. The car's sample (idx) keeps it on the stretch it was on, so a road that
// passes over another is never taken for it. In a ramp's flight (s.air) there's no road and no
// walls: the car flies on to the landing, and one that drops 3 m below the flight's line (straight
// from the lip to the landing) has fallen short, into what's really there.
export function trackGround(track: Track): Ground {
  return {
    under: (c) => track.samples[c.idx],
    contact(c, _from, dt) {
      const loc = locate(track, c.p, c.idx);
      c.idx = loc.i;
      const s = track.samples[loc.i];
      if (loc.onRoad && !s.air && loc.h > -2.5 && loc.h <= STICK) settle(c, s.n, loc.h);
      else fly(c, dt);

      // The walls, where there are any and the car isn't flying over them.
      const lim = s.w / 2 - HALF_W;
      if (s.walls && !s.air && Math.abs(loc.lateral) > lim && loc.h < WALL_H) {
        const side = Math.sign(loc.lateral);
        bounce(c, scale(s.r, -side), side * loc.lateral - lim);
      }

      c.lat = loc.lateral;
      c.h = loc.h;
      return ((!loc.onRoad || s.air) && loc.h < -3) || loc.h < -12 || c.p.y < -40;
    },
  };
}

export const clampSteer = (x: number) => clamp(x, -1, 1);
