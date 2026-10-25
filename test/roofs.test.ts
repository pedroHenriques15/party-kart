// The roofs' shapes (src/render/roofs.ts): each meets its walls, its faces cover its footprint once,
// and it slopes the way the map says.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clipConvex, faces, shapeOf, wallTop, type Roofed, type XZ } from '../src/render/roofs.ts';

const rect = (x0: number, z0: number, x1: number, z1: number): XZ[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const area = (p: XZ[]) => {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return Math.abs(a / 2);
};
const house = (over: Partial<Roofed>): Roofed => ({ pts: rect(0, 0, 12, 8), roof: 2, ends: 0, dir: 0, pitch: 30, h: 6, ridge: 6 + 4 * Math.tan(Math.PI / 6), ...over });
const near = (a: number, b: number, d = 1e-6) => assert.ok(Math.abs(a - b) <= d, `${a} isn't ${b}`);

test('a gabled roof: the ridge in the middle, the eaves on the long walls, a gable at each end', () => {
  const s = shapeOf(house({}));
  near(s.height(6, 4), 6 + 4 * Math.tan(Math.PI / 6));
  near(s.height(6, 0), 6);
  near(s.height(6, 8), 6);
  // The long wall's top is level; the end wall rises to the ridge and down again.
  assert.deepEqual(wallTop(s, [0, 0], [12, 0]).map((p) => p[2]), [6, 6]);
  const gable = wallTop(s, [12, 0], [12, 8]);
  assert.equal(gable.length, 3);
  near(gable[1][1], 4);
  near(gable[1][2], s.height(6, 4));
  // Two faces, covering the footprint once.
  const f = faces(s, 0);
  assert.equal(f.length, 2);
  near(f.reduce((a, q) => a + area(q.pts), 0), 96, 1e-6);
});

test('a hipped roof slopes at each end at its pitch; half a pair only at its own end', () => {
  const s = shapeOf(house({ roof: 1, ends: 3 }));
  assert.equal(faces(s, 0).length, 4);
  // The hip's eaves along the end wall, and the ridge 4 m in from it (rise / tan 30°).
  near(s.height(0, 4), 6);
  near(s.height(4, 4), 6 + 4 * Math.tan(Math.PI / 6));
  assert.equal(wallTop(s, [12, 0], [12, 8]).length, 2, 'no gable');
  // Hipped at its first end (x = 0, as dir points to +x) only: a gable at the other.
  const half = shapeOf(house({ roof: 1, ends: 1 }));
  near(half.height(0, 4), 6);
  near(half.height(12, 4), half.height(6, 4));
  assert.equal(wallTop(half, [12, 0], [12, 8]).length, 3);
});

test('a skillion falls the way it faces, to its eaves', () => {
  // Facing south (+z): high at the north wall.
  const s = shapeOf(house({ roof: 3, dir: Math.PI / 2, ridge: 8 }));
  near(s.height(6, 0), 8);
  near(s.height(6, 8), 6);
});

test('a roof cut to an L-shaped footprint covers it once', () => {
  const L: XZ[] = [[0, 0], [12, 0], [12, 8], [6, 8], [6, 4], [0, 4]];
  const s = shapeOf(house({ pts: L, roof: 1, ends: 3 }));
  assert.ok(s.fill < 0.9);
  // The footprint in two convex pieces, each face cut to each.
  let covered = 0;
  for (const piece of [rect(0, 0, 12, 4), rect(6, 4, 12, 8)]) for (const f of faces(s, 0)) covered += area(clipConvex(f.pts, piece));
  near(covered, area(L), 1e-6);
});

// An L of two gabled wings 6 m wide, 31° (0.6 a metre), their eaves at 5 m: one along x (z 0 to 6),
// one along z (x 6 to 12, z 0 to 14), as braga-map's task 087 gives a roof of its own planes.
const L: XZ[] = [[0, 0], [12, 0], [12, 14], [6, 14], [6, 6], [0, 6]];
const ell = (over: Partial<Roofed> = {}): Roofed => ({
  pts: L,
  roof: 2,
  ends: 0,
  dir: 0,
  pitch: 31,
  h: 5,
  ridge: 6.8,
  planes: [
    { c: 5, gx: 0, gz: 0.6 },
    { c: 5 + 3.6, gx: 0, gz: -0.6 },
    { c: 5 - 3.6, gx: 0.6, gz: 0 },
    { c: 5 + 7.2, gx: -0.6, gz: 0 },
  ],
  groups: [
    [0, 1],
    [2, 3],
  ],
  ...over,
});

test('a roof of its own planes: an L, its two ridges and the valleys where its wings meet', () => {
  const s = shapeOf(ell(), true);
  near(s.height(3, 3), 6.8);
  near(s.height(9, 10), 6.8);
  near(s.height(0, 0), 5);
  // In the corner the wings share, the higher of the two: a valley where they're level.
  near(s.height(8, 2), 6.2);
  near(s.height(10, 1), Math.max(Math.min(5.6, 8), Math.min(7.4, 6.2)));
  // Its faces cover the rectangle round it once, each where its plane is the roof.
  const f = faces(s, 0);
  near(f.reduce((a, q) => a + area(q.pts), 0), 12 * 14, 1e-6);
  for (const q of f) {
    const x = q.pts.reduce((a, p) => a + p[0], 0) / q.pts.length;
    const z = q.pts.reduce((a, p) => a + p[1], 0) / q.pts.length;
    near(q.plane.c + q.plane.gx * x + q.plane.gz * z, s.height(x, z), 1e-6);
  }
  // A wall's top follows it: the gable end of the wing along x rises to its ridge.
  const end = wallTop(s, [0, 6], [0, 0]);
  assert.equal(end.length, 3);
  near(end[1][2], 6.8);
  // Without `own`, the shape the map measured, as before.
  near(shapeOf(ell()).height(3, 3), shapeOf({ ...ell(), planes: undefined, groups: undefined }).height(3, 3));
});

test("a flat roof's own planes: a deck under its parapet, the walls up to the eaves round it", () => {
  const s = shapeOf(house({ roof: 0, h: 10, ridge: 10, planes: [{ c: 9, gx: 0.02, gz: 0 }], groups: [[0]] }), true);
  near(s.height(6, 4), 9.12);
  assert.deepEqual(wallTop(s, [0, 0], [12, 0]).map((p) => p[2]), [10, 10]);
  near(faces(s, 0).reduce((a, q) => a + area(q.pts), 0), 96, 1e-6);
});
