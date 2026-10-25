// A facade's drawing in relief on Ultra (braga-map's task 123, src/render/relief.ts): a window set into
// its wall has its reveal's light on all four sides facing in, a sill standing out its top facing up,
// and the wall round them flat.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillBox, fillHalfDisc, normalsOf } from '../src/render/relief.ts';

const n = 64;
// A bay 3.2 m across and 3.2 m high: 5 cm a pixel.
const px = 3.2 / n;
// The normal at column i, row r from the bottom (as the texture has it), each part from -1 to 1.
const at = (out: Uint8Array, i: number, r: number) => [0, 1, 2].map((c) => out[(r * n + i) * 4 + c] / 127.5 - 1);

test('a window set into its wall: its reveal faces in on each side, the wall and the glass flat', () => {
  const z = new Float32Array(n * n);
  // Columns 20 to 43, rows 16 to 39 from the top, 14 cm in.
  fillBox(z, n, 20, 16, 24, 24, -0.14);
  const out = normalsOf(z, n, px, px, 0.05);
  const row = n - 1 - 28;
  const [lx] = at(out, 20, row);
  const [rx] = at(out, 43, row);
  assert.ok(lx > 0.3, `its left reveal faces right (${lx.toFixed(2)})`);
  assert.ok(rx < -0.3, `its right reveal faces left (${rx.toFixed(2)})`);
  const [, ty] = at(out, 32, n - 1 - 16);
  const [, by] = at(out, 32, n - 1 - 39);
  assert.ok(ty < -0.3, `its head faces down (${ty.toFixed(2)})`);
  assert.ok(by > 0.3, `its sill's reveal faces up (${by.toFixed(2)})`);
  for (const [i, r] of [[5, 5], [32, n - 1 - 28], [60, 50]]) {
    const [x, y, zz] = at(out, i, r);
    assert.ok(Math.abs(x) < 0.02 && Math.abs(y) < 0.02 && zz > 0.98, `flat at ${i}, ${r}: ${x}, ${y}, ${zz}`);
  }
});

test("a sill standing out: its top faces up, its foot down; an arch's head only over its spring", () => {
  const z = new Float32Array(n * n);
  // Rows 40 and 41 from the top, 6 cm out: its top edge over row 40, its foot under row 41.
  fillBox(z, n, 10, 40, 40, 2, 0.06);
  const out = normalsOf(z, n, px, px, 0.05);
  assert.ok(at(out, 30, n - 1 - 39)[1] > 0.2, 'its top faces up');
  assert.ok(at(out, 30, n - 1 - 42)[1] < -0.2, 'its foot faces down');
  const a = new Float32Array(n * n);
  fillHalfDisc(a, n, 32, 32, 10, 10, -0.2);
  assert.ok(Math.abs(a[25 * n + 32] + 0.2) < 1e-6);
  assert.equal(a[36 * n + 32], 0);
  assert.equal(a[31 * n + 5], 0);
});

test("a pane's mark in the normals' alpha, laid out as they are (task 117's reflections)", () => {
  const z = new Float32Array(n * n);
  const glass = new Float32Array(n * n);
  // A pane at columns 20 to 43, rows 16 to 39 from the top; a bar across it at row 28.
  fillBox(glass, n, 20, 16, 24, 24, 1);
  fillBox(glass, n, 20, 28, 24, 1, 0);
  const out = normalsOf(z, n, px, px, 0.05, glass);
  const alpha = (i: number, top: number) => out[((n - 1 - top) * n + i) * 4 + 3];
  assert.equal(alpha(30, 20), 255);
  assert.equal(alpha(30, 28), 0);
  assert.equal(alpha(5, 20), 0);
  assert.equal(normalsOf(z, n, px, px)[3], 255);
});
