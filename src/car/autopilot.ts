// Drives the track by itself: for the tests, and for the cars on the menu screens.
import { angleDiff, clamp } from '../math.ts';
import { rampSpeed, surfacePoint, type Track } from '../track/track.ts';
import { speedOf, turnRate, type Car, type Input } from './car.ts';

// The fastest speed that can still turn as tightly as curvature k (radians per metre).
function cornerSpeed(k: number): number {
  for (let v = 60; v > 6; v -= 1) if (turnRate(v) / v >= k) return v;
  return 6;
}

// line: where across the road to drive, from -1 (the left edge) to 1 (the right), 0 the middle.
export function autopilot(c: Car, track: Track, caution = 1, line = 0): Input {
  const N = track.samples.length;
  const s = track.samples;
  const speed = speedOf(c);
  const aim = s[(c.idx + Math.round(6 + speed * 0.35)) % N];
  const ahead = surfacePoint(aim, line * Math.max(0, aim.w / 2 - 1.6), 0);
  const want = Math.atan2(ahead.z - c.p.z, ahead.x - c.p.x);
  const steer = clamp(angleDiff(want, c.yaw) * 2.2, -1, 1);

  // A ramp ahead: taken at the speed that clears it and not much more, or the flight overshoots the
  // landing; the corners beyond its lip count once it's landed.
  const ramp = track.ramps.map((r) => ({ r, k: (r.lip - c.idx + N) % N })).find((q) => q.k < 200);
  // The slowest corner coming up, allowing for the braking distance.
  const yawAt = (i: number) => Math.atan2(s[i % N].t.z, s[i % N].t.x);
  let target = ramp ? rampSpeed(ramp.r) : 60;
  for (let k = 8; k < 12 + speed * 2.2 && !(ramp && k >= ramp.k); k += 4) {
    const curve = Math.abs(angleDiff(yawAt(c.idx + k + 8), yawAt(c.idx + k))) / 8;
    const v = cornerSpeed(curve * 1.15 * caution);
    target = Math.min(target, Math.sqrt(v * v + 2 * 24 * k));
  }
  return {
    throttle: speed < target - 0.5 ? 1 : 0,
    brake: speed > target + 2 ? 1 : 0,
    steer,
    drift: false,
  };
}
