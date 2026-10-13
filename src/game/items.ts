import type { Track } from '../track/track.ts';

// The power-ups: what they are, who gets which, and where the moving ones are at any moment.
//
// Everything that moves is deterministic: a projectile is its start (progress along the track,
// lateral offset, speed, race time), so every browser draws it in the same place without
// sending positions. Hits are decided by the one who gets hit, in their own browser, and told to
// the others; so what you see is what happened to you.

export type ItemKind = 'champagne' | 'champagne3' | 'pudim' | 'disco' | 'drone' | 'bomb' | 'gold' | 'bass' | 'shield';

export const ITEMS: Record<ItemKind, { name: string; icon: string; uses: number; blurb: string }> = {
  champagne: { name: 'Champagne', icon: '🍾', uses: 1, blurb: 'A burst of speed' },
  champagne3: { name: 'Three champagnes', icon: '🍾', uses: 3, blurb: 'Three bursts of speed' },
  pudim: { name: 'Pudim Abade de Priscos', icon: '🍮', uses: 1, blurb: 'Dropped behind you; whoever hits it spins' },
  disco: { name: 'Disco ball', icon: '🪩', uses: 1, blurb: 'Rolls ahead; hold ↓ to roll it back' },
  drone: { name: 'Paparazzi drone', icon: '📸', uses: 1, blurb: 'Flies to the car ahead of you' },
  bomb: { name: 'Party bomb', icon: '💣', uses: 1, blurb: 'Goes for the leader' },
  gold: { name: 'Gold plating', icon: '👑', uses: 1, blurb: 'Faster, and nothing touches you' },
  bass: { name: 'Bass drop', icon: '🔊', uses: 1, blurb: 'Shrinks everyone ahead of you' },
  shield: { name: 'Bodyguard', icon: '🛡️', uses: 1, blurb: 'On as soon as you get it; blocks the next hit' },
};

// Who gets what: the leader gets defence and small stuff, the back of the pack the big guns.
type Weights = Partial<Record<ItemKind, number>>;
const FRONT: Weights = { pudim: 35, disco: 25, champagne: 20, shield: 20 };
const MIDDLE: Weights = { champagne: 18, champagne3: 8, disco: 20, drone: 20, pudim: 14, shield: 10, gold: 5, bass: 2, bomb: 3 };
const BACK: Weights = { champagne3: 20, drone: 18, gold: 16, bomb: 12, bass: 10, champagne: 14, disco: 6, shield: 4 };

// The odds at a place in the race: 0 is the leader, 1 the last.
export function itemOdds(place: number): Weights {
  const [a, b, f] = place <= 0.5 ? [FRONT, MIDDLE, place * 2] : [MIDDLE, BACK, (place - 0.5) * 2];
  const out: Weights = {};
  for (const k of Object.keys(ITEMS) as ItemKind[]) {
    const w = (a[k] ?? 0) * (1 - f) + (b[k] ?? 0) * f;
    if (w > 0) out[k] = w;
  }
  return out;
}

export function rollItem(place: number, rand: () => number = Math.random): ItemKind {
  const odds = itemOdds(place);
  const total = Object.values(odds).reduce((s, w) => s + (w ?? 0), 0);
  let r = rand() * total;
  for (const [k, w] of Object.entries(odds) as [ItemKind, number][]) {
    r -= w;
    if (r <= 0) return k;
  }
  return 'champagne';
}

// Where you are in the race, 0 (first) to 1 (last); 0.5 when alone.
export const placeFraction = (rank: number, count: number) => (count <= 1 ? 0.5 : (rank - 1) / (count - 1));

// ---- What happens in a race, as events every browser applies. ----

export type ProjKind = 'disco' | 'drone' | 'bomb';

export interface Proj {
  id: string;
  kind: ProjKind;
  owner: string;
  t0: number; // race ms when thrown
  p0: number; // progress (metres along the track, counting laps) when thrown
  lat: number; // metres right of the centre line
  v: number; // m/s along the track; negative rolls back
  target?: string; // the drone's
}

export interface Hazard {
  id: string;
  kind: 'pudim';
  owner: string;
  t0: number;
  idx: number; // track sample
  lat: number;
}

export type ItemEv =
  | ({ k: 'proj' } & Proj)
  | ({ k: 'haz' } & Hazard)
  | { k: 'bass'; id: string; owner: string; t0: number; p0: number }
  // Someone got hit (or an item was smashed by a gold car, victim null), and the item is gone.
  | { k: 'hit'; id: string; item: string; victim: string | null; blocked: boolean; how: string; x: number; y: number; z: number }
  // The party bomb went off here: everyone close spins.
  | { k: 'boom'; id: string; owner: string; victim: string; x: number; y: number; z: number };

export const LIFE: Record<ProjKind, number> = { disco: 7000, drone: 16000, bomb: 22000 };
export const DISCO_SPEED = 26; // m/s faster than the thrower
export const DISCO_BACK = -20;
export const DRONE_SPEED = 80;
export const BOMB_SPEED = 95;
export const SPIN_TIME = 1.0;
export const SHRINK_TIME = 3.5;
export const GOLD_TIME = 6;
export const BOOM_RADIUS = 12;

export const projProgress = (p: Proj, t: number) => p.p0 + (p.v * (t - p.t0)) / 1000;
export const projAlive = (p: Proj, t: number) => t - p.t0 < LIFE[p.kind];

// The signed distance from b to a along a loop of length n, the short way round.
export function loopDelta(a: number, b: number, n: number): number {
  const d = (((a - b) % n) + n) % n;
  return d > n / 2 ? d - n : d;
}

export interface Box {
  key: string;
  i: number; // track sample
  lat: number;
}

// The item boxes: rows of five across the road, where the layout says.
export function boxRows(track: Track): Box[] {
  return track.tags
    .filter((t) => t.tag === 'items')
    .flatMap(({ i }) => {
      const w = track.samples[i].w;
      return [-0.32, -0.16, 0, 0.16, 0.32].map((f, k) => ({ key: `${i}:${k}`, i, lat: f * w }));
    });
}
