// Laps and checkpoints. A lap counts when you've passed every checkpoint in order and cross the
// start line. Respawning puts you back at your last checkpoint, at the speed you passed it; or, when
// you fell at a jump (short of its landing, or off its ramp), on its run-up at the speed that clears it.
import { newCar, speedOf, type Car } from './car/car.ts';
import { rampSpeed, type Ramp, type Track } from './track/track.ts';

export interface Run {
  lapStart: number; // ms, race time
  nextCp: number; // index into track.checkpoints; checkpoints.length = the line is next
  splits: number[]; // ms into the lap at each checkpoint
  lastCp: { i: number; speed: number } | null;
  best: number | null;
  bestSplits: number[] | null;
  laps: number;
}

export type RunEvent = { k: 'cp'; n: number; ms: number; diff: number | null } | { k: 'lap'; ms: number; best: boolean; diff: number | null };

export const newRun = (now: number): Run => ({ lapStart: now, nextCp: 0, splits: [], lastCp: null, best: null, bestSplits: null, laps: 0 });

// Is sample c in (from, to], going forwards and not more than a short way?
function passed(N: number, from: number, to: number, c: number): boolean {
  const fd = (a: number, b: number) => (b - a + N) % N;
  const moved = fd(from, to);
  return moved > 0 && moved < 60 && fd(from, c) > 0 && fd(from, c) <= moved;
}

export function advance(run: Run, track: Track, from: number, to: number, now: number): RunEvent | null {
  const N = track.samples.length;
  const cps = track.checkpoints;
  if (run.nextCp < cps.length) {
    const c = cps[run.nextCp];
    if (!passed(N, from, to, c)) return null;
    const ms = now - run.lapStart;
    run.splits[run.nextCp] = ms;
    const n = run.nextCp;
    run.nextCp++;
    run.lastCp = { i: c, speed: 0 };
    return { k: 'cp', n, ms, diff: run.bestSplits ? ms - run.bestSplits[n] : null };
  }
  if (!passed(N, from, to, track.start)) return null;
  const ms = now - run.lapStart;
  const diff = run.best === null ? null : ms - run.best;
  const best = run.best === null || ms < run.best;
  if (best) {
    run.best = ms;
    run.bestSplits = [...run.splits];
  }
  run.laps++;
  run.lapStart = now;
  run.nextCp = 0;
  run.splits = [];
  run.lastCp = { i: track.start, speed: 0 };
  return { k: 'lap', ms, best, diff };
}

// Remember how fast the car went through the checkpoint it just passed.
export function noteSpeed(run: Run, car: Car): void {
  if (run.lastCp && run.lastCp.speed === 0) run.lastCp.speed = speedOf(car);
}

// A respawn: at the last checkpoint, or at the start of the lap (with the clock reset) if none.
export function respawn(run: Run, track: Track, now: number, at = -1): Car {
  const jump = at < 0 ? null : jumpAt(track, at);
  if (jump) return newCar(track, (jump.lip - RUN_UP + track.samples.length) % track.samples.length, rampSpeed(jump));
  if (run.lastCp) return newCar(track, run.lastCp.i, run.lastCp.speed);
  run.lapStart = now;
  return newCar(track, startGrid(track));
}

export function restart(run: Run, track: Track, now: number): Car {
  run.lapStart = now;
  run.nextCp = 0;
  run.splits = [];
  run.lastCp = null;
  return newCar(track, startGrid(track));
}

// How far before a ramp's lip a car that fell there goes back to (m), and the jump a sample is at:
// from there to 30 m past its landing.
export const RUN_UP = 50;
export function jumpAt(track: Track, i: number): Ramp | null {
  const N = track.samples.length, fd = (a: number, b: number) => (b - a + N) % N;
  return track.ramps.find((r) => fd(r.lip - RUN_UP, i) <= fd(r.lip - RUN_UP, r.land) + 30) ?? null;
}

// A few metres behind the line.
export const startGrid = (track: Track) => track.samples.length - 6;
