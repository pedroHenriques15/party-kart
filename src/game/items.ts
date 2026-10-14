import type { Track } from '../track/track.ts';

// The power-ups: what they are, who gets which, and where the moving ones are at any moment.
//
// Everything that moves is deterministic: a projectile is its start (progress along the track,
// lateral offset, speed, race time), so every browser draws it in the same place without
// sending positions. Hits are decided by the one who gets hit, in their own browser, and told to
// the others; so what you see is what happened to you.

export type ItemKind = 'cafe' | 'cafe3' | 'pudim' | 'bola' | 'pombo' | 'foguete' | 'filigrana' | 'martelinho' | 'guarda';

export const ITEMS: Record<ItemKind, { name: string; icon: string; uses: number; blurb: string }> = {
  cafe: { name: 'Café', icon: '☕', uses: 1, blurb: 'Uma dose de velocidade' },
  cafe3: { name: 'Três cafés', icon: '☕', uses: 3, blurb: 'Três doses de velocidade' },
  pudim: { name: 'Pudim Abade de Priscos', icon: '🍮', uses: 1, blurb: 'Fica atrás de ti; quem lhe passar por cima, rodopia' },
  bola: { name: 'Bola do Braga', icon: '⚽', uses: 1, blurb: 'Rola para a frente; com ↓ rola para trás' },
  pombo: { name: 'Pombo-correio', icon: '🕊️', uses: 1, blurb: 'Voa até ao carro que vai à tua frente' },
  foguete: { name: 'Foguete', icon: '🚀', uses: 1, blurb: 'Vai direito ao primeiro' },
  filigrana: { name: 'Filigrana', icon: '✨', uses: 1, blurb: 'Ouro dos pés à cabeça: mais rápido, e nada te toca' },
  martelinho: { name: 'Martelinho', icon: '🔨', uses: 1, blurb: 'Encolhe à martelada quem vai à tua frente' },
  guarda: { name: 'Guarda-chuva', icon: '☂️', uses: 1, blurb: 'Abre-se logo; aguenta o próximo ataque' },
};

// Who gets what: the leader gets defence and small stuff, the back of the pack the big guns.
type Weights = Partial<Record<ItemKind, number>>;
const FRONT: Weights = { pudim: 35, bola: 25, cafe: 20, guarda: 20 };
const MIDDLE: Weights = { cafe: 18, cafe3: 8, bola: 20, pombo: 20, pudim: 14, guarda: 10, filigrana: 5, martelinho: 2, foguete: 3 };
const BACK: Weights = { cafe3: 20, pombo: 18, filigrana: 16, foguete: 12, martelinho: 10, cafe: 14, bola: 6, guarda: 4 };

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
  return 'cafe';
}

// Where you are in the race, 0 (first) to 1 (last); 0.5 when alone.
export const placeFraction = (rank: number, count: number) => (count <= 1 ? 0.5 : (rank - 1) / (count - 1));

// ---- What happens in a race, as events every browser applies. ----

export type ProjKind = 'bola' | 'pombo' | 'foguete';

export interface Proj {
  id: string;
  kind: ProjKind;
  owner: string;
  t0: number; // race ms when thrown
  p0: number; // progress (metres along the track, counting laps) when thrown
  lat: number; // metres right of the centre line
  v: number; // m/s along the track; negative rolls back
  target?: string; // the pigeon's
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
  | { k: 'martelinho'; id: string; owner: string; t0: number; p0: number }
  // Someone got hit (or an item was smashed by a gold car, victim null), and the item is gone.
  | { k: 'hit'; id: string; item: string; victim: string | null; blocked: boolean; how: string; x: number; y: number; z: number }
  // The rocket burst here: everyone close spins.
  | { k: 'boom'; id: string; owner: string; victim: string; x: number; y: number; z: number };

export const LIFE: Record<ProjKind, number> = { bola: 7000, pombo: 16000, foguete: 22000 };
export const BALL_SPEED = 26; // m/s faster than the thrower
export const BALL_BACK = -20;
export const PIGEON_SPEED = 80;
export const ROCKET_SPEED = 95;
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
