// The grenades (Counter-Strike's four): thrown from the eye the way you look, overarm with the left
// button, a lob with the right, both for between; bouncing off the world's walls and ground, losing
// speed at each, till a fuse (the HE grenade's and the flash's), coming to rest (the smoke) or landing
// on the ground (the molotov) sets it off. Its flight is all in its throw (the event), worked out
// the same in every browser on the round's ground, so each draws it in the same place without sending
// where it is; and each browser works out what it does to its own fighters (the victim's rule, as the
// items'): the HE grenade's blast, the flash's blinding, the fire's burning; the smoke hides whoever's
// behind it from the bots' eyes as it does from everyone's. Pure, so the tests throw them.
import { clamp, dot, norm, v3, type V } from '../math.ts';
import type { See, Soldier } from './fight.ts';
import { isNade, NADES, type NadeId } from './arsenal.ts';

export interface NadeEv {
  k: 'nade';
  id: string;
  owner: string;
  w: NadeId;
  t: number; // round ms it left the hand
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

// The throw: how fast overarm and as a lob (m/s), how much of the thrower's own speed it takes, its
// gravity (a little floatier than a stone's, as Counter-Strike's), how much of its speed it keeps at a
// bounce, and how long one may fly at most.
export const THROW = 15;
export const LOB = 6;
const CARRY = 1.1;
const G = 8;
const BOUNCE = 0.45;
const FLY_MAX = 6000;
const DT = 1 / 120;
// A grenade's radius, kept that far off what it bounces off.
const R = 0.06;
// How long a grenade takes to leave the hand once the button's let go (ms), and before the next.
export const WINDUP = 250;
export const NEXT = 650;

export interface Flight {
  // Where it is every 1/30 s from the throw (round ms, x, y, z), for drawing it; where and when it
  // goes off; and the bounces' times and how hard, for their sound.
  path: { t: number; x: number; y: number; z: number }[];
  at: { x: number; y: number; z: number; t: number };
  bounces: { t: number; v: number }[];
  // Whether it came down on the ground (a molotov's fire needs it), and the ground's level there.
  ground: boolean;
}

// The throw from the eye the way it aims (a unit vector), as hard as `power` (1 overarm, 0 a lob),
// carrying some of the thrower's velocity: its event.
export function throwOf(id: string, owner: string, w: NadeId, t: number, eye: V, aim: V, power: number, vel: V): NadeEv {
  const s = LOB + (THROW - LOB) * clamp(power, 0, 1);
  // Thrown a little over where you look, as an arm throws.
  const d = norm(v3(aim.x, aim.y + 0.1, aim.z));
  const o = v3(eye.x + aim.x * 0.3, eye.y - 0.1, eye.z + aim.z * 0.3);
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { k: 'nade', id, owner, w, t, x: r(o.x), y: r(o.y), z: r(o.z), vx: r(d.x * s + vel.x * CARRY), vy: r(d.y * s + vel.y * CARRY), vz: r(d.z * s + vel.z * CARRY) };
}

// The whole of a grenade's flight, from its throw, on the round's ground (see: the world with nothing
// that differs between browsers in it).
export function fly(ev: NadeEv, see: See): Flight {
  const p = v3(ev.x, ev.y, ev.z);
  const v = v3(ev.vx, ev.vy, ev.vz);
  const fuse = NADES[ev.w].fuse;
  const path: Flight['path'] = [{ t: ev.t, x: p.x, y: p.y, z: p.z }];
  const bounces: Flight['bounces'] = [];
  let still = 0;
  let ground = false;
  let lastT = ev.t;
  for (let k = 1; ; k++) {
    const t = ev.t + k * DT * 1000;
    v.y -= G * DT;
    const L = Math.hypot(v.x, v.y, v.z) * DT;
    let landed = false;
    if (L > 1e-6) {
      const d = v3(v.x / (L / DT), v.y / (L / DT), v.z / (L / DT));
      const hit = see(p, d, L + R);
      if (hit.what) {
        const n = v3(hit.nx, hit.ny, hit.nz);
        // Back off the surface, and off it the other way, slower.
        const go = Math.max(0, hit.t - R);
        p.x += d.x * go;
        p.y += d.y * go;
        p.z += d.z * go;
        const vn = dot(v, n);
        if (vn < 0) {
          const hard = -vn;
          v.x -= 2 * vn * n.x;
          v.y -= 2 * vn * n.y;
          v.z -= 2 * vn * n.z;
          // Along the surface it slides on, across it it bounces.
          const k2 = n.y > 0.7 ? 0.6 : BOUNCE;
          v.x *= k2;
          v.z *= k2;
          v.y *= n.y > 0.7 ? BOUNCE * 0.7 : BOUNCE;
          if (hard > 1.2) bounces.push({ t, v: hard });
          if (n.y > 0.7) {
            landed = true;
            ground = true;
          }
        }
      } else {
        p.x += v.x * DT;
        p.y += v.y * DT;
        p.z += v.z * DT;
      }
    }
    if (t - lastT >= 1000 / 30 - 1e-6) {
      path.push({ t, x: p.x, y: p.y, z: p.z });
      lastT = t;
    }
    const slow = Math.hypot(v.x, v.y, v.z) < 0.4;
    still = slow ? still + DT : 0;
    // Resting on the ground: it stays there.
    if (slow && landed) v.x = v.y = v.z = 0;
    const off = (fuse && t - ev.t >= fuse) || (ev.w === 'molotov' && landed) || (ev.w === 'smoke' && still > 0.25) || t - ev.t >= FLY_MAX;
    if (off) {
      path.push({ t, x: p.x, y: p.y, z: p.z });
      return { path, at: { x: p.x, y: p.y, z: p.z, t }, bounces, ground: ground && (ev.w !== 'molotov' || landed) };
    }
  }
}

// Where a grenade is at round ms t on its flight.
export function along(f: Flight, t: number): V {
  const P = f.path;
  if (t <= P[0].t) return v3(P[0].x, P[0].y, P[0].z);
  for (let k = 1; k < P.length; k++) {
    if (P[k].t < t) continue;
    const a = P[k - 1];
    const b = P[k];
    const s = (t - a.t) / Math.max(1e-6, b.t - a.t);
    return v3(a.x + (b.x - a.x) * s, a.y + (b.y - a.y) * s, a.z + (b.z - a.z) * s);
  }
  const e = P[P.length - 1];
  return v3(e.x, e.y, e.z);
}

// ---- What each does ----

// The HE grenade: up to 98 next to it, none past 7.5 m, through nothing (it needs a clear line to
// the body or the head).
export const BLAST = 7.5;
export function blast(at: V, body: { x: number; y: number; z: number }, clearTo: (a: V, b: V) => boolean): number {
  const c = v3(at.x, at.y + 0.15, at.z);
  let best = 0;
  for (const h of [0.4, 1.0, 1.5]) {
    const p = v3(body.x, body.y + h, body.z);
    const d = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
    if (d > BLAST || !clearTo(c, p)) continue;
    best = Math.max(best, 98 * Math.pow(1 - d / BLAST, 1.4));
  }
  return Math.round(best);
}

// The flash: how long it blinds someone looking from their eye the way they look (ms of white out,
// then as long again fading), if they can see it: the longer the nearer and the straighter they
// look at it; out of the corner of an eye, a little; behind them, a moment.
export function blinding(at: V, eye: V, look: V, clearTo: (a: V, b: V) => boolean): number {
  const to = v3(at.x - eye.x, at.y + 0.1 - eye.y, at.z - eye.z);
  const d = Math.hypot(to.x, to.y, to.z);
  if (d > 60 || !clearTo(eye, v3(at.x, at.y + 0.1, at.z))) return 0;
  const facing = dot(norm(to), look);
  const near = clamp(1.15 - d / 30, 0.25, 1);
  const k = facing > 0.6 ? 1 : facing > 0 ? 0.35 + facing : 0.12 + 0.23 * clamp(facing / 0.1 + 1, 0, 1);
  return Math.round(4200 * near * Math.min(1, k));
}

// The smoke: a cloud this wide and high, up this long (ms), its first moments thickening and its last
// thinning.
export const CLOUD = { r: 3.8, h: 3.4, last: 18000, grow: 900, thin: 2500 };
export interface Cloud {
  x: number;
  y: number;
  z: number;
  t0: number; // round ms it went off
}
// How thick a cloud is at round ms t, 0 to 1.
export function thickness(c: Cloud, t: number): number {
  const a = t - c.t0;
  if (a < 0 || a > CLOUD.last) return 0;
  return Math.min(1, a / CLOUD.grow, (CLOUD.last - a) / CLOUD.thin);
}
// Whether the clouds up at t hide b from a (the line through the thick of one).
export function hidden(a: V, b: V, clouds: readonly Cloud[], t: number): boolean {
  for (const c of clouds) {
    if (thickness(c, t) < 0.6) continue;
    // The cloud as a ball squashed to its height: the line's nearest point to its middle, inside it.
    const sy = CLOUD.r / (CLOUD.h / 2);
    const cx = c.x;
    const cy = (c.y + CLOUD.h / 2) * sy;
    const cz = c.z;
    const ax = a.x;
    const ay = a.y * sy;
    const az = a.z;
    const dx = b.x - ax;
    const dy = b.y * sy - ay;
    const dz = b.z - az;
    const L = dx * dx + dy * dy + dz * dz || 1;
    const s = clamp(((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / L, 0, 1);
    const ex = ax + dx * s - cx;
    const ey = ay + dy * s - cy;
    const ez = az + dz * s - cz;
    if (ex * ex + ey * ey + ez * ez < (CLOUD.r * 0.85) ** 2) return true;
  }
  return false;
}

// The molotov's fire: a pool this wide on the ground where it broke, burning this long (ms), hurting
// whoever stands in it this much a second; a smoke over it puts it out.
export const FIRE = { r: 2.8, last: 7000, dps: 40 };
export interface Blaze {
  x: number;
  y: number;
  z: number;
  t0: number;
  out: number; // round ms it went out (a smoke over it), or its end
}
export function burning(b: Blaze, t: number): boolean {
  return t >= b.t0 && t < Math.min(b.out, b.t0 + FIRE.last);
}
// Whether someone standing at p is in a fire.
export function inFire(b: Blaze, p: { x: number; y: number; z: number }, t: number): boolean {
  return burning(b, t) && Math.hypot(p.x - b.x, p.z - b.z) < FIRE.r && p.y > b.y - 1 && p.y < b.y + 1.2;
}
// A cloud over a fire puts it out.
export function douse(fires: Blaze[], c: Cloud): void {
  for (const f of fires) if (f.out > c.t0 && Math.hypot(f.x - c.x, f.z - c.z) < CLOUD.r + FIRE.r * 0.5 && Math.abs(f.y - c.y) < 3) f.out = Math.max(f.t0, c.t0);
}

// The grenade in a fighter's hand thrown at round ms t (its pin pulled, `power` how hard), if it may:
// its event. The next of its kind comes to hand, or else what it held before.
export function toss(s: Soldier, eye: V, aim: V, power: number, vel: V, t: number): NadeEv | null {
  const w = s.hand;
  s.throwAt = 0;
  if (!isNade(w) || !s.alive || t < s.nextAt || t < s.drawnAt || !s.nades.includes(w)) return null;
  s.nades.splice(s.nades.indexOf(w), 1);
  const ev = throwOf(`${s.id}:${++s.shots}`, s.id, w, t, eye, aim, power, vel);
  s.nextAt = t + NEXT;
  s.safeUntil = 0;
  if (!s.nades.includes(w)) s.select(s.has(s.last) && s.last !== w ? s.last : (s.primary ?? s.secondary), t);
  return ev;
}
