// Drives the track by itself: for the tests, and for the cars on the menu screens.
import { angleDiff, clamp } from '../math.ts';
import { rampSpeed, surfacePoint, type Ramp, type Track } from '../track/track.ts';
import { COYOTE, GRIP, speedOf, turnRate, type Car, type Input } from './car.ts';

// The fastest speed that can still turn as tightly as curvature k (radians per metre).
function cornerSpeed(k: number): number {
  for (let v = 60; v > 6; v -= 1) if (turnRate(v) / v >= k) return v;
  return 6;
}

// A kart flies the way its velocity goes, and the grip turns the velocity after the nose, a tenth of a
// second behind; so a kart still turning onto a ramp leaves its lip off the flight (braga-map's task
// 060). From ONTO m before the ramp's foot to LIFT m past its lip, where the grip still turns it for
// COYOTE s, the autopilot steers its velocity onto the ramp's axis, closing on it with its steering's
// three poles at -POLE per second.
const ONTO = 18;
const LIFT = 6;
const POLE = 11;
// It comes to a ramp's foot this much slower than rampSpeed (m/s), and lets the climb take what it
// takes: off the Volta dos Amigos' lip at about 110 km/h, where braga-map's speed is 119, so it comes
// down a metre or two short of the landing street, in the corner the race takes in round the landing
// (braga-map's decision 042), with room to turn into the street, which turns there; at rampSpeed it
// lands where the street turns, and goes wide.
const SHORT = 2.1;
// In the air it turns its nose to the landing street, STREET m past the landing, as the nose turns
// there and the velocity doesn't; and down, to SETTLE m past the landing, it slows for the turn its
// velocity still has to make onto the street, which is 3 m wide and bends again.
const STREET = 16;
const SETTLE = 60;

// The steering onto ramp r's axis (its foot to its lip, as the race stands it): how far right of the
// axis the kart is (y), how far its velocity points off it (e) and how far its nose leads its velocity
// (b), the grip turning the velocity towards the nose at GRIP per second.
function ontoRamp(c: Car, track: Track, r: Ramp): number {
  const F = track.samples[r.foot].p;
  const T = track.samples[r.lip].p;
  const L = Math.hypot(T.x - F.x, T.z - F.z);
  const ux = (T.x - F.x) / L;
  const uz = (T.z - F.z) / L;
  const y = (c.p.x - F.x) * -uz + (c.p.z - F.z) * ux;
  const v = Math.atan2(c.v.z, c.v.x);
  const e = angleDiff(v, Math.atan2(uz, ux));
  const b = angleDiff(c.yaw, v);
  const V = Math.max(5, Math.hypot(c.v.x, c.v.z));
  const p = POLE;
  const turn = -((p ** 3 / (V * GRIP)) * y + ((3 * p * p) / GRIP) * e + (3 * p - GRIP) * b);
  return clamp(turn / turnRate(V), -1, 1);
}

// line: where across the road to drive, from -1 (the left edge) to 1 (the right), 0 the middle.
export function autopilot(c: Car, track: Track, caution = 1, line = 0): Input {
  const N = track.samples.length;
  const s = track.samples;
  const speed = speedOf(c);
  const aim = s[(c.idx + Math.round(6 + speed * 0.35)) % N];
  const ahead = surfacePoint(aim, line * Math.max(0, aim.w / 2 - 1.6), 0);
  const want = Math.atan2(ahead.z - c.p.z, ahead.x - c.p.x);
  let steer = clamp(angleDiff(want, c.yaw) * 2.2, -1, 1);

  // A ramp ahead: taken at the speed that clears it and not much more, or the flight overshoots the
  // landing; the corners beyond its lip count once it's landed, and the ones from where it steers onto
  // the ramp's axis don't: it drives that straight.
  const ramp = track.ramps.map((r) => ({ r, k: (r.lip - c.idx + N) % N })).find((q) => q.k < 200);
  const onto = ramp && ramp.k <= ramp.r.lip - ramp.r.foot + ONTO ? ramp.r : null;
  // A ramp behind, from its lip to SETTLE m past its landing: m since the lip.
  const off = track.ramps.map((r) => ({ r, d: (c.idx - r.lip + N) % N })).find((q) => q.d <= ((q.r.land - q.r.lip + N) % N) + SETTLE);
  if (speed > 1 && (onto || (off && off.d < LIFT))) steer = ontoRamp(c, track, onto ?? off!.r);
  else if (off && !c.grounded && c.air >= COYOTE) {
    const q = s[(off.r.land + STREET) % N].p;
    steer = clamp(angleDiff(Math.atan2(q.z - c.p.z, q.x - c.p.x), c.yaw) * 8, -1, 1);
  }
  // The slowest corner coming up, allowing for the braking distance.
  const yawAt = (i: number) => Math.atan2(s[i % N].t.z, s[i % N].t.x);
  let target = ramp ? rampSpeed(ramp.r) - SHORT : 60;
  // Down off a ramp, the turn from where its velocity goes to the road 8 m on, as a corner.
  if (off && c.grounded && speed > 5) target = Math.min(target, cornerSpeed((Math.abs(angleDiff(yawAt(c.idx + 8), Math.atan2(c.v.z, c.v.x))) / 8) * 1.15 * caution));
  for (let k = 8; k < 12 + speed * 2.2 && !(ramp && k >= ramp.k - (ramp.r.lip - ramp.r.foot + ONTO)); k += 4) {
    const curve = Math.abs(angleDiff(yawAt(c.idx + k + 8), yawAt(c.idx + k))) / 8;
    const v = cornerSpeed(curve * 1.15 * caution);
    target = Math.min(target, Math.sqrt(v * v + 2 * 24 * k));
  }
  // Onto a ramp it keeps close to its speed, which decides where it comes down; and up the ramp it lets
  // the climb take what it takes, as a slipstream's pull would put back more than its own. One that
  // came to the ramp too slow to fly (bumped, hit) drives up it.
  const up = ramp && ramp.k <= ramp.r.lip - ramp.r.foot && speed > ramp.r.v - 4;
  return {
    throttle: speed < target - 0.5 && !up ? 1 : 0,
    brake: speed > target + (ramp ? 0.5 : 2) ? 1 : 0,
    steer,
    drift: false,
  };
}
