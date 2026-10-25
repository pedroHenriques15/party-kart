import { loadWorld, type World } from 'braga-map';
import amigos from 'braga-map/tracks/amigos.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Holes, Lattice, Surface } from '../src/render/lattice.ts';
import { edgePoints, surface, type Grain } from '../src/render/tin.ts';
import { worldGround } from '../src/world/ground.ts';
import { retainingStretches, wallFootprints } from '../src/world/land.ts';

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

test("the land cut along the retaining walls has no crack where a split cell meets a big one, on High's lattice and on Low's (braga-map's task 111)", () => {
  // Round capela-santo-adriao's walls, a cell in two split: along every side between two cells, from
  // either side's triangles, the same height, where a wall's cut meets the side too.
  const B = { x0: 840, x1: 1000, z0: 1180, z1: 1340 };
  const walls = new Holes(wallFootprints(retainingStretches(world)));
  for (const [C, F] of [[10, 2], [20, 4]]) {
    const L = new Lattice(B, C, F);
    for (let j = 0; j < L.nz; j++) for (let i = 0; i < L.nx; i++) L.fine[j * L.nx + i] = (i + j) % 2;
    const S = new Surface(L, land, walls);
    let worst = 0;
    let at = '';
    for (let j = 0; j < L.nz; j++) {
      for (let i = 0; i < L.nx; i++) {
        for (let f = 0.025; f < 1; f += 0.05) {
          const [x, z] = [B.x0 + i * C, B.z0 + (j + f) * C];
          const [u, v] = [B.x0 + (i + f) * C, B.z0 + j * C];
          const sides: [number, number, number][] = [];
          if (i) sides.push([Math.abs(S.y(x - 1e-7, z) - S.y(x + 1e-7, z)), x, z]);
          if (j) sides.push([Math.abs(S.y(u, v - 1e-7) - S.y(u, v + 1e-7)), u, v]);
          for (const [d, p, q] of sides) if (d > worst) [worst, at] = [d, `(${p.toFixed(1)}, ${q.toFixed(1)})`];
        }
      }
    }
    assert.ok(worst < 1e-3, `a crack ${worst.toFixed(2)} m deep at ${at} on a lattice of ${C} m`);
  }
  // And with every cell split, across every small triangle's sides, its diagonal too: the cut splits
  // the land outside a footprint along its sides' lines, which only one of two triangles may have
  // (sameiro's bank, and between capela-santo-adriao's walls, cracked so on Low).
  for (const [x0, z0] of [[580, 1085], [890, 1250]]) {
    for (const F of [2, 4]) {
      const L = new Lattice({ x0: x0 - 40, x1: x0 + 80, z0: z0 - 40, z1: z0 + 80 }, F * 5, F);
      L.fine.fill(1);
      const S = new Surface(L, land, walls);
      let worst = 0;
      let at = '';
      const e = 1e-6;
      for (let x = x0; x < x0 + 40; x += F) {
        for (let z = z0; z < z0 + 40; z += F) {
          for (let f = 0.01; f < 1; f += 0.02) {
            const [dx, dz] = [x + F * (1 - f), z + F * f];
            const sides: [number, string][] = [
              [Math.abs(S.y(x - e, z + f * F) - S.y(x + e, z + f * F)), `(${x}, ${(z + f * F).toFixed(2)})`],
              [Math.abs(S.y(x + f * F, z - e) - S.y(x + f * F, z + e)), `(${(x + f * F).toFixed(2)}, ${z})`],
              [Math.abs(S.y(dx - e, dz - e) - S.y(dx + e, dz + e)), `(${dx.toFixed(2)}, ${dz.toFixed(2)})`],
            ];
            for (const [d, p] of sides) if (d > worst) [worst, at] = [d, p];
          }
        }
      }
      assert.ok(worst < 1e-3, `a crack ${worst.toFixed(2)} m deep at ${at}, small cells of ${F} m`);
    }
  }
});

test("the land steps under a retaining wall, not in front of it: none stands over a street at its foot, and the street isn't curled up to it (braga-map's task 111)", () => {
  // The land as city.ts draws it on High beside a street at a wall: the lattice's small cells (a cell
  // there is split where its triangles would miss the land, as they do across a wall's step), each
  // triangle a wall's footprint, or a strip along a pavement's back where the land's higher (braga-map's
  // task 044), meets cut along it.
  const stretches = retainingStretches(world);
  const S = new Surface(new Lattice(world.box, 10, 2), land, new Holes([...wallFootprints(stretches), ...ground.backs().map((b) => b.pts)]));
  S.L.fine.fill(1);
  const near = (q: (typeof stretches)[number], x: number, z: number) => {
    const [dx, dz] = [q.bx - q.ax, q.bz - q.az];
    const f = Math.max(0, Math.min(1, ((x - q.ax) * dx + (z - q.az) * dz) / (dx * dx + dz * dz)));
    return { d: Math.hypot(q.ax + dx * f - x, q.az + dz * f - z), f, upper: dx * (z - q.az) - dz * (x - q.ax) < 0 };
  };
  // The stretches within 3 m of each 10 m cell.
  const cells = new Map<string, typeof stretches>();
  for (const q of stretches) {
    for (let i = Math.floor((Math.min(q.ax, q.bx) - 3) / 10); i <= Math.floor((Math.max(q.ax, q.bx) + 3) / 10); i++) {
      for (let j = Math.floor((Math.min(q.az, q.bz) - 3) / 10); j <= Math.floor((Math.max(q.az, q.bz) + 3) / 10); j++) {
        const k = `${i},${j}`;
        cells.set(k, [...(cells.get(k) ?? []), q]);
      }
    }
  }
  const around = (x: number, z: number) => cells.get(`${Math.floor(x / 10)},${Math.floor(z / 10)}`) ?? [];
  // Under a wall, where its block stands over the land; behind another, where its face does.
  const under = (x: number, z: number) => around(x, z).some((q) => near(q, x, z).d < q.half);
  const behind = (x: number, z: number, me: (typeof stretches)[number]) =>
    around(x, z).some((q) => {
      if (q === me) return false;
      const n = near(q, x, z);
      return n.d < 3 && n.upper && n.f > 0 && n.f < 1;
    });
  const kind = (x: number, z: number) => (ground.d.roads.has(x, z) ? 1 : ground.d.paves.has(x, z) ? 2 : 0);
  const street = (x: number, z: number) => [null, firm(x, z), pave(x, z)][kind(x, z)];
  // Every half metre along each wall (but its last 2 m, where it eases out), on either side, where a
  // street comes within 1.5 m of its face: on its lower side, the land from 0.3 m short of the street's
  // edge to 0.6 m into it (paintGround leaves it drawn that far into a street, so it meets the street),
  // against the street there; and either side, the street at the wall against itself 2 m further out.
  let len = 0;
  let over = 0;
  let worst = { by: 0, at: '' };
  const curl: Record<string, number[]> = { lower: [], higher: [] };
  for (const s of stretches) {
    const Ls = Math.hypot(s.bx - s.ax, s.bz - s.az);
    const [ux, uz] = [(s.bx - s.ax) / Ls, (s.bz - s.az) / Ls];
    for (let t = 0.25; t < Ls; t += 0.5) {
      if (s.s0 + t < 2 || s.s0 + t > s.len - 2) continue;
      const [x, z] = [s.ax + ux * t, s.az + uz * t];
      for (const side of ['lower', 'higher']) {
        const [nx, nz] = side === 'lower' ? [-uz, ux] : [uz, -ux];
        const out = (o: number): [number, number] => [x + nx * (s.half + o), z + nz * (s.half + o)];
        let edge = -1;
        for (let o = 0.05; o <= 1.5 && edge < 0; o += 0.05) if (kind(...out(o))) edge = o;
        if (edge < 0) continue;
        const y = street(...out(edge))!;
        if (kind(...out(edge + 2)) === kind(...out(edge))) curl[side].push(y - street(...out(edge + 2))!);
        if (side === 'higher') continue;
        len += 0.5;
        let from = 0;
        for (let o = 0.02; o <= edge; o += 0.05) if (under(...out(o))) from = o;
        let by = 0;
        for (let o = Math.max(from + 0.02, edge - 0.3); o <= edge + 0.6; o += 0.1) if (!under(...out(o)) && !behind(...out(o), s)) by = Math.max(by, S.y(...out(o)) - y);
        if (by > 0.15) over += 0.5;
        if (by > worst.by) worst = { by, at: `(${x.toFixed(0)}, ${z.toFixed(0)})` };
      }
    }
  }
  const tail = (v: number[], f: number) => v.sort((a, b) => a - b)[Math.floor(v.length * f)];
  const [up, up97, down, down3] = [tail(curl.lower, 0.5), tail(curl.lower, 0.97), tail(curl.higher, 0.5), tail(curl.higher, 0.03)];
  console.log(
    `retaining walls with a street at their foot: ${len} m; the land drawn more than 15 cm over the street on ${over} m (the most ${worst.by.toFixed(2)} m, at ${worst.at}); ` +
      `the street at a wall's foot over itself 2 m out ${Math.round(up * 100) || 0} cm at the median, ${(up97 * 100).toFixed(0)} at the 97th percentile; on its top, under itself 2 m in ${Math.round(-down * 100) || 0} and ${(-down3 * 100).toFixed(0)}`,
  );
  assert.ok(len > 3000, `${len} m of wall with a street at its foot`);
  assert.ok(over < len / 100, `the land stands over the street at ${over} m of ${len} m`);
  assert.ok(worst.by < 0.6, `the land stands ${worst.by.toFixed(2)} m over the street at ${worst.at}`);
  assert.ok(Math.abs(up) < 0.05 && up97 < 0.2, `the street at a wall's foot climbs to it: ${up.toFixed(2)} m at the median, ${up97.toFixed(2)} at the 97th percentile`);
  assert.ok(Math.abs(down) < 0.05 && down3 > -0.2, `the street on a wall's top sinks to it: ${(-down).toFixed(2)} m at the median, ${(-down3).toFixed(2)} at the 97th percentile`);
});
