// Arcade handling, Trackmania-style: grippy, quick to turn, drifts when you hold Space, flies off
// ramps and crests, and lands wherever the road is.
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
const GRIP = 9;
const DRIFT_GRIP = 1.8;
const STICK = 0.05; // how far the road can fall away and the car still hugs it
const COYOTE = 0.12; // s after leaving the ground that the car still drives as if on it
const HALF_W = 1.0;
const WALL_H = 1.3;
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

export interface Car {
  p: V;
  v: V;
  yaw: number; // heading: forward is (cos yaw, 0, sin yaw)
  up: V; // the surface's normal when grounded, for drawing
  grounded: boolean;
  idx: number; // nearest track sample
  boost: number; // s of boost left
  falling: number; // s spent fallen off
  air: number; // s since last on the ground
  drifting: boolean;
  drift: number; // s into the current drift, for the mini-turbo
  turbo: number; // 1 or 2 when a drift let go just now earned a mini-turbo
  wallHit: number; // speed lost against a wall this step, for sounds
  landed: number; // how hard it just landed (m/s down), 0 if it didn't
  lat: number; // metres right of the road's centre line
  h: number; // metres above the road
}

export function newCar(track: Track, i: number, speed = 0): Car {
  const s = track.samples[i];
  return {
    p: surfacePoint(s, 0, 0.01),
    v: scale(s.t, speed),
    yaw: Math.atan2(s.t.z, s.t.x),
    up: s.n,
    grounded: true,
    idx: i,
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
export function stepCar(c: Car, inp: Input, track: Track, dt: number, mods: Mods = NO_MODS): boolean {
  c.wallHit = 0;
  c.landed = 0;
  c.turbo = 0;
  const vmax = VMAX * mods.vmax;
  const flat = v3(Math.cos(c.yaw), 0, Math.sin(c.yaw));
  const s0 = track.samples[c.idx];

  if (c.grounded || c.air < COYOTE) {
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

  c.p = addScaled(c.p, c.v, dt);
  const loc = locate(track, c.p, c.idx);
  c.idx = loc.i;
  const s = track.samples[loc.i];

  if (loc.onRoad && loc.h > -2.5 && loc.h <= STICK) {
    c.p = addScaled(c.p, s.n, -loc.h);
    const vn = dot(c.v, s.n);
    if (vn < 0) c.v = addScaled(c.v, s.n, -vn);
    if (c.air > 0.3 && vn < -10) c.v = scale(c.v, 0.97); // a hard landing costs a little
    if (c.air > 0.25) c.landed = -vn;
    c.grounded = true;
    c.air = 0;
  } else {
    c.grounded = false;
    c.air += dt;
  }

  // The walls, where there are any and the car isn't flying over them.
  const lim = s.w / 2 - HALF_W;
  if (s.walls && Math.abs(loc.lateral) > lim && loc.h < WALL_H) {
    const side = Math.sign(loc.lateral);
    c.p = addScaled(c.p, s.r, -(loc.lateral - side * lim));
    const out = dot(c.v, s.r) * side;
    if (out > 0) {
      const before = len(c.v);
      c.v = addScaled(c.v, s.r, -side * out * 1.25);
      c.v = scale(c.v, 1 - Math.min(0.25, out * 0.012));
      c.wallHit = before - len(c.v);
    }
  }

  c.lat = loc.lateral;
  c.h = loc.h;
  const lost = (!loc.onRoad && loc.h < -3) || loc.h < -12 || c.p.y < -40;
  c.falling = lost ? c.falling + dt : 0;
  return c.falling > FALL_RESPAWN;
}

export const clampSteer = (x: number) => clamp(x, -1, 1);
