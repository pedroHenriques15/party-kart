// The season on Ultra (braga-map's task 093): what a kind's crown is on a day of the year, by its year in
// Braga as the map gives it (treeKinds' `year`): bare, its buds bursting, in leaf, turning, falling, and
// in flower. trees.ts draws it.
import type { TreeYear } from 'braga-map';

export interface Season {
  // How much of the crown is in leaf: 0 bare (its twigs), 1 full.
  leaves: number;
  // How far its leaves have turned to their autumn colour.
  turned: number;
  // How fresh they are: a spring's paler green as they open, gone a few weeks after they're full.
  fresh: number;
  // How much it's in flower.
  bloom: number;
}

// The day of the year (1 on 1 January) at a moment, by the UTC date (Braga's, but for its first hour).
export function dayOf(utcMs: number): number {
  const year = new Date(utcMs).getUTCFullYear();
  return Math.floor((utcMs - Date.UTC(year, 0, 1)) / 86400000) + 1;
}

const ramp = (a: number, b: number, d: number) => Math.max(0, Math.min(1, (d - a) / (b - a)));

// A kind's crown on a day. A kind with no year, or one that keeps its leaves, is in full leaf. As its buds
// burst its leaves come card by card, a few at first; once full they stay a spring's green for three
// weeks; from `turn` they take their autumn colour, all of it by `fall`, when half are down; the last are
// down by `bare`. Its flowers come over a week to `from` and go over a week from `to`.
export function seasonOf(year: TreeYear | null | undefined, day: number): Season {
  const f = year?.flowers;
  const bloom = f ? Math.min(ramp(f.from - 7, f.from, day), 1 - ramp(f.to, f.to + 7, day)) : 0;
  if (!year || year.bud === undefined || year.full === undefined || year.turn === undefined || year.fall === undefined || year.bare === undefined) return { leaves: 1, turned: 0, fresh: 0, bloom };
  const { bud, full, turn, fall, bare } = year;
  if (day < bud || day >= bare) return { leaves: 0, turned: 1, fresh: 0, bloom };
  if (day < full) return { leaves: 0.15 + 0.85 * ramp(bud, full, day), turned: 0, fresh: 1, bloom };
  if (day < turn) return { leaves: 1, turned: 0, fresh: 1 - ramp(full, full + 21, day), bloom };
  return { leaves: day < fall ? 1 - 0.5 * ramp(turn, fall, day) : 0.5 * (1 - ramp(fall, bare, day)), turned: ramp(turn, fall, day), fresh: 0, bloom };
}
