import { loadWorld, type World } from 'braga-map';
import amigos from 'braga-map/tracks/amigos.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Lattice, Surface } from '../src/render/lattice.ts';
import { edgePoints, surface, type Grain } from '../src/render/tin.ts';
import { worldGround } from '../src/world/ground.ts';

// The streets as they're drawn (src/render/streets.ts) are laid on the ground the karts drive on by
// tin.ts, and the land under them is made on lattice.ts's: the geometry, without three.js's scene.
const world: World = await loadWorld(amigos.box);
const ground = worldGround(world);
const { firm, land } = ground.d.land;
// High's grain for a carriageway, and for a pavement (streets.ts).
const ROAD: Grain = { dense: 10, max: 24, min: 5, tol: 0.25 };
const PAVE: Grain = { dense: 10, max: 24, min: 8, tol: 0.5 };
const pave = (x: number, z: number) => firm(x, z) + ground.raise(x, z);

// A piece's triangles as drawn: each corner [x, y, z].
function laid(rings: [number, number][][], h: (x: number, z: number) => number, g: Grain): number[][][] {
  const out: number[][][] = [];
  let t: number[][] = [];
  surface(rings, h, g, (x, y, z) => {
    t.push([x, y, z]);
    if (t.length === 3) {
      out.push(t);
      t = [];
    }
  });
  return out;
}

const area = (r: [number, number][]) => {
  let a = 0;
  for (let k = 0, j = r.length - 1; k < r.length; j = k++) a += (r[j][0] - r[k][0]) * (r[j][1] + r[k][1]);
  return a / 2;
};

test('a street piece laid on the ground covers its outline, faces up, and follows the ground', () => {
  const pieces = world.streets.carriageways.filter((c) => c.level === 'ground');
  const off: number[] = [];
  let n = 0;
  // A few of the map's outlines cross themselves (a kink a metre across), where the triangles overlap.
  let crossed = 0;
  for (const c of pieces) {
    const tris = laid(c.rings, firm, ROAD);
    const drawn = tris.reduce((a, [p, q, r]) => a + Math.abs((q[0] - p[0]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[0] - p[0])) / 2, 0);
    const outline = Math.abs(area(c.rings[0])) - c.rings.slice(1).reduce((a, r) => a + Math.abs(area(r)), 0);
    if (Math.abs(drawn - outline) > 0.01 * outline + 0.5) crossed++;
    for (const [p, q, r] of tris) {
      // Up: clockwise seen from above, with x east and z south.
      assert.ok((q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]) >= -1e-9, 'faces up');
      if (n++ % 7 === 0) off.push(Math.abs((p[1] + q[1] + r[1]) / 3 - firm((p[0] + q[0] + r[0]) / 3, (p[2] + q[2] + r[2]) / 3)));
    }
  }
  off.sort((a, b) => a - b);
  const q = (f: number) => off[Math.floor(off.length * f)];
  console.log(`the carriageways drawn: ${n} triangles, their middles off the ground ${(q(0.5) * 100).toFixed(1)} cm at the median, ${(q(0.9) * 100).toFixed(1)} at the 90th percentile; ${crossed} of ${pieces.length} outlines cross themselves`);
  assert.ok(q(0.5) < 0.05, `${q(0.5).toFixed(3)} m off at the median`);
  assert.ok(crossed < pieces.length / 100, `${crossed} pieces drawn bigger or smaller than their outlines`);
});

test('two pieces either side of an edge meet on it at the same points, so the street has no cracks', () => {
  // Every pair of pieces sharing an edge (a tile's cut, a junction's seam): the carriageways' own,
  // and a pavement against its carriageway along a kerb.
  const edges = new Map<string, [number, number][][]>();
  const key = (a: [number, number], b: [number, number]) => `${a[0]},${a[1]},${b[0]},${b[1]}`;
  for (const c of world.streets.carriageways) if (c.level === 'ground') for (const r of c.rings) for (let k = 0; k < r.length; k++) edges.set(key(r[k], r[(k + 1) % r.length]), c.rings);
  let roads = 0;
  let kerbs = 0;
  for (const c of world.streets.carriageways) {
    if (c.level !== 'ground') continue;
    for (const r of c.rings) {
      for (let k = 0; k < r.length; k++) {
        const [a, b] = [r[k], r[(k + 1) % r.length]];
        if (!edges.has(key(b, a))) continue;
        // The other piece runs it the other way: the same points, back to front.
        const here = edgePoints(a[0], a[1], b[0], b[1], firm, ROAD);
        const there = edgePoints(b[0], b[1], a[0], a[1], firm, ROAD).reverse();
        assert.deepEqual(here, there);
        roads++;
      }
    }
  }
  for (const p of world.streets.pavements) {
    if (p.level !== 'ground') continue;
    for (const r of p.rings) {
      for (let k = 0; k < r.length; k++) {
        const [a, b] = [r[k], r[(k + 1) % r.length]];
        if (!edges.has(key(b, a))) continue;
        // A kerb: the pavement's points along it are where the carriageway's are, or between them.
        const mine = edgePoints(a[0], a[1], b[0], b[1], pave, PAVE);
        assert.deepEqual(mine[0], a);
        assert.deepEqual(mine.at(-1), b);
        kerbs++;
      }
    }
  }
  console.log(`${roads} edges between carriageways and ${kerbs} kerbs checked`);
  assert.ok(roads > 100 && kerbs > 1000);
});

test("the land's lattice: a big cell and its split neighbour meet without a crack", () => {
  const B = { x0: 0, x1: 200, z0: 700, z1: 900 };
  const L = new Lattice(B, 10, 2);
  for (let j = 0; j < L.nz; j++) for (let i = 0; i < L.nx; i++) if ((i * 7 + j * 3) % 5 === 0) L.fine[j * L.nx + i] = 1;
  const S = new Surface(L, land);
  // Along every side between two cells, from either side's triangles, the same height.
  for (let j = 0; j < L.nz; j++) {
    for (let i = 1; i < L.nx; i++) {
      const x = B.x0 + i * 10;
      for (let f = 0.05; f < 1; f += 0.1) {
        const z = B.z0 + (j + f) * 10;
        assert.ok(Math.abs(S.y(x - 1e-7, z) - S.y(x + 1e-7, z)) < 1e-3, `a crack at (${x}, ${z.toFixed(1)})`);
      }
    }
  }
  // A split cell's corners are the land's own.
  assert.ok(Math.abs(S.y(B.x0 + 20, B.z0 + 20) - land(B.x0 + 20, B.z0 + 20)) < 1e-4);
});
