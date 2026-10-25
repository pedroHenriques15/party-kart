// A wall laid out as its photo has it (braga-map's task 086, src/world/storeys.ts's layoutPieces): each
// storey read is its openings where they are, its frames round them, and plain wall between, end to end
// and never overlapping; a storey not read is its kind's rhythm, whole.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FacadeOpening, FacadeProportions } from 'braga-map';
import { layoutPieces } from '../src/world/storeys.ts';

const P: FacadeProportions = { storey: 2.9, ground: 3.65, win: [1.5, 1.3], sill: 0.95, bay: 3.4, balcony: 1.3 };
const o = (kind: FacadeOpening['kind'], at: number, w: number): FacadeOpening => ({ kind, at, w });
const near = (a: number, b: number, d = 1e-9) => assert.ok(Math.abs(a - b) <= d, `${a} isn't ${b}`);

test('each storey read is laid end to end: plain wall, each opening with its frame, plain wall', () => {
  const L = 10;
  const pieces = layoutPieces([[o('door', 1, 1), o('shop', 4, 3)], null, [o('window', 1, 1.5), o('balcony', 4.2, 0.9), o('window', 7, 1.5)]], P, 3.65, 2.9, 3, L, -0.6);
  for (const r of [0, 1, 2]) {
    const row = pieces.filter((q) => q.storey === r);
    // From 0 to L, each piece where the one before ends.
    near(row[0].s0, 0);
    near(row[row.length - 1].s1, L);
    for (let k = 1; k < row.length; k++) near(row[k].s0, row[k - 1].s1);
    for (const q of row) assert.ok(q.s1 > q.s0);
  }
  // The ground floor from 0.6 m below its foot to its top, the storey over it in the rhythm, whole.
  const ground = pieces.filter((q) => q.storey === 0);
  near(ground[0].h0, -0.6);
  near(ground[0].h1, 3.65);
  assert.deepEqual(pieces.filter((q) => q.storey === 1).map((q) => [q.what, q.s0, q.s1]), [['rhythm', 0, L]]);
  // The door and the shop where they are: the door with its frame (15 cm), the shop without one.
  assert.deepEqual(ground.map((q) => q.what), ['plain', 'door', 'plain', 'shop', 'plain']);
  const door = ground[1];
  near(door.s0, 0.85);
  near(door.s1, 2.15);
  const shop = ground[3];
  near(shop.s0, 4);
  near(shop.s1, 7);
  // Its drawing's door from u0 to u1 falls on the door's own metres: 1 to 2 m along the wall.
  const u = (q: (typeof pieces)[number], s: number) => q.u![0] + ((s - q.s0) / (q.s1 - q.s0)) * (q.u![1] - q.u![0]);
  near(u(door, 1), 0.5 - 0.6 / 3.4, 1e-9);
  near(u(door, 2), 0.5 + 0.6 / 3.4, 1e-9);
  // The second storey: two windows and a balcony's door between them.
  assert.deepEqual(pieces.filter((q) => q.storey === 2 && q.what !== 'plain').map((q) => q.what), ['window', 'balcony', 'window']);
});

test('a frame stops short of the next opening, and of the wall\'s ends', () => {
  const L = 4;
  const row = layoutPieces([[o('window', 0.05, 1.5), o('window', 1.6, 1.5)]], P, 3.65, 2.9, 1, L, 0);
  const [a, b] = row.filter((q) => q.what === 'window');
  near(a.s0, 0);
  // Five centimetres apart: the first's frame stops at its own glass (1.55), and the second's starts there.
  near(a.s1, 1.55);
  near(b.s0, a.s1);
  near(b.s1, 1.6 + 1.5 + 0.18);
  // A storey past the layout's in the rhythm.
  assert.deepEqual(layoutPieces([[]], P, 3.65, 2.9, 2, L, 0).map((q) => q.what), ['plain', 'rhythm']);
});
