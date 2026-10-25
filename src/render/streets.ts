// Every street in the open world's area as it is (braga-map's world.streets, its task 033, decision
// 019): the carriageways in asphalt or setts, the pavements in calçada, the central reservations and
// islands, a granite kerb wherever a pavement stands over the road, and the lines painted on them; the
// decks' and tunnels' roads at their levels, with their parapets; and where a street meets the land,
// a skirt down to it or a granite retaining wall up to it. And every footway, path, cycleway and
// flight of steps (its task 050): each in what it's paved with, a cycleway's asphalt red, each step a
// tread with its riser, the handrails where the map has them. Each lies on the ground the karts drive
// on (src/world/ground.ts): a carriageway or a path on it, a pavement a kerb over it, a tread or a
// deck at its height. And the walls, fences, railings, hedges and gates (its task 013), each on that
// ground, in what it's made of. Along them stand the lamps, the traffic lights at the stop lines, the
// bus stops (braga-map's task 042: its plates are plates.ts's), and across every street and path where
// it leaves the area, road-works barriers. A tile's surfaces and faces are one mesh, their textures layers of one, and its paint
// another, so whole tiles out of view are skipped.
import type { Track as Course, Path, Sight, Streets, World as Braga } from 'braga-map';
import * as THREE from 'three';
import { alongSpan, wallSpan, type Piece, type WorldGround } from '../world/ground.ts';
import { clearedPieces } from '../world/race.ts';
import { bake, box, mat } from './kit.ts';
import type { Surface } from './lattice.ts';
import { levelOf, LIT, WET, type Graphics, type Quality } from './look.ts';
import { reflects } from './post.ts';
import { halos } from './road.ts';
import * as tex from './textures.ts';
import { edgePoints, surface, type Grain, type Height } from './tin.ts';

const LIFT = 0.02; // the surfaces are drawn this far over the ground they stand on
const TILE = 500;
const DEEP = 1.2; // a deck's depth under its road, as ground.ts has it

// How finely the surfaces follow the ground (tin.ts), by the graphics level: a carriageway closely,
// where the karts drive; a pavement, a strip a few metres wide, less so.
const GRAIN: Record<Quality, { road: Grain; pave: Grain }> = {
  high: { road: { dense: 10, max: 24, min: 5, tol: 0.25 }, pave: { dense: 10, max: 24, min: 8, tol: 0.5 } },
  medium: { road: { dense: 12, max: 30, min: 6, tol: 0.3 }, pave: { dense: 12, max: 30, min: 10, tol: 0.6 } },
  low: { road: { dense: 16, max: 40, min: 8, tol: 0.4 }, pave: { dense: 16, max: 40, min: 12, tol: 0.8 } },
};

type Ring = [number, number][];
const key = (ax: number, az: number, bx: number, bz: number) => `${ax},${az},${bx},${bz}`;

// Twice a ring's area, positive when it runs counter-clockwise with x right and z up: its inside is
// then to the left of each edge.
function area2(r: Ring): number {
  let a = 0;
  for (let k = 0, j = r.length - 1; k < r.length; j = k++) a += (r[j][0] - r[k][0]) * (r[j][1] + r[k][1]);
  return a;
}

// Every edge of every street and path piece, at any level, by its two ends in order: a piece's edge
// that another runs back along is shared (a kerb's line, a tile's cut, a deck's end); one that isn't
// is the edge of the streets, where the land is beside them.
export function streetEdges(S: Streets): Set<string> {
  const edges = new Set<string>();
  for (const p of [...S.carriageways, ...S.pavements, ...S.paths]) {
    for (const r of p.rings) for (let k = 0; k < r.length; k++) edges.add(key(r[k][0], r[k][1], r[(k + 1) % r.length][0], r[(k + 1) % r.length][1]));
  }
  return edges;
}

// Things in cells of C metres, by the box they cover.
class Grid<T> {
  m = new Map<number, T[]>();
  C: number;
  constructor(C: number) {
    this.C = C;
  }
  private k(i: number, j: number) {
    return (i + 32768) * 65536 + (j + 32768);
  }
  add(x0: number, z0: number, x1: number, z1: number, t: T): void {
    for (let i = Math.floor(x0 / this.C); i <= Math.floor(x1 / this.C); i++) {
      for (let j = Math.floor(z0 / this.C); j <= Math.floor(z1 / this.C); j++) {
        const k = this.k(i, j);
        const l = this.m.get(k);
        if (l) l.push(t);
        else this.m.set(k, [t]);
      }
    }
  }
  at(x: number, z: number): T[] {
    return this.m.get(this.k(Math.floor(x / this.C), Math.floor(z / this.C))) ?? [];
  }
}

// The way a street runs near a point, from the map's centre lines: its texture's rows go across it.
interface Frame {
  ax: number;
  az: number;
  tx: number;
  tz: number;
  L: number;
  s0: number; // metres along the line at (ax, az)
}
const WORLD: Frame = { ax: 0, az: 0, tx: 1, tz: 0, L: 0, s0: 0 };

// The streets' textures, as layers of one texture: a tile's surfaces and faces are one mesh, whatever
// they're made of.
const LAYERS = ['asphalt', 'setts', 'calcada', 'verge', 'dirt', 'granite', 'skirt', 'concrete', 'paving', 'cycle', 'gravel', 'blocks', 'render', 'hedge', 'cement', 'planks'] as const;
type Layer = (typeof LAYERS)[number];

// What a path is drawn in (braga-map's task 050): its surface's, a cycleway's asphalt red, a metal
// footbridge's deck grey, and a wooden one's boards (the Picoto's boardwalk, its task 021).
const PATH_LAYER: Record<Path['surface'], Layer> = { calcada: 'calcada', paving: 'paving', setts: 'setts', asphalt: 'asphalt', concrete: 'concrete', gravel: 'gravel', dirt: 'dirt', metal: 'skirt', wood: 'planks' };
const pathLayer = (p: Path): Layer => (p.kind === 'cycleway' && p.surface === 'asphalt' ? 'cycle' : PATH_LAYER[p.surface]);

// An arch's opening over the river (braga-map's task 021): across the river's way there, over the
// water and the paths that pass under the deck beside it (its photos: the arch spans the river and
// the riverside path), from the water up to just under the deck, a segmental curve. Its ceiling at
// (x, z): the arch's face's height there, or Infinity outside its opening.
export function archOf(s: Extract<Sight, { kind: 'arch' }>, rivers: { pts: [number, number, number][] }[], under: Path[]) {
  // The river's way at the crossing: its nearest stretch's.
  let best = { d: Infinity, ux: 1, uz: 0, y: s.y - 6 };
  for (const r of rivers) {
    for (let k = 1; k < r.pts.length; k++) {
      const [ax, az] = r.pts[k - 1];
      const [bx, bz] = r.pts[k];
      const L = Math.hypot(bx - ax, bz - az) || 1;
      const t = Math.max(0, Math.min(1, ((s.x - ax) * (bx - ax) + (s.z - az) * (bz - az)) / (L * L)));
      const d = Math.hypot(ax + (bx - ax) * t - s.x, az + (bz - az) * t - s.z);
      if (d < best.d) best = { d, ux: (bx - ax) / L, uz: (bz - az) / L, y: r.pts[k][2] };
    }
  }
  const [px, pz] = [-best.uz, best.ux];
  const across = (x: number, z: number) => (x - s.x) * px + (z - s.z) * pz;
  // The water, 3 m either side of its line, and the paths under the deck, a metre and a half past.
  let [a, b] = [-3, 3];
  for (const p of under) {
    for (const ring of p.rings) {
      for (const [x, z] of ring) {
        if (Math.hypot(x - s.x, z - s.z) > s.r) continue;
        a = Math.min(a, across(x, z) - 1.5);
        b = Math.max(b, across(x, z) + 1.5);
      }
    }
  }
  const half = (b - a) / 2;
  const m = (a + b) / 2;
  const crown = s.y - DEEP - 0.35;
  const spring = Math.min(crown - 1, Math.max(best.y, crown - half * 0.9));
  return {
    x: s.x,
    z: s.z,
    r: s.r,
    ceiling: (x: number, z: number) => {
      const v = across(x, z) - m;
      return Math.abs(v) >= half ? Infinity : spring + (crown - spring) * Math.sqrt(1 - (v / half) ** 2);
    },
  };
}

// The paths at the ground's level: on it, or under something there (a passage under a building).
export function groundPaths(S: Streets): Path[] {
  return S.paths.filter((p) => p.level === 'ground' || p.level === 'under');
}

// Each a layer 256 pixels a side; on Ultra (braga-map's task 085) 1024, each drawing made that much
// finer (textures.ts's `finer`).
function layers(fine: number): THREE.DataArrayTexture {
  const S = 256 * fine;
  const art: Partial<Record<Layer, () => THREE.CanvasTexture>> = { asphalt: tex.asphalt, setts: tex.setts, calcada: tex.calcada, verge: tex.ground, dirt: tex.rock, granite: tex.granite, paving: tex.paving, cycle: tex.cycleway, gravel: tex.gravel, blocks: tex.wallBlocks, render: tex.plaster, hedge: tex.hedge, cement: tex.plaster, planks: tex.planks };
  const tint: Partial<Record<Layer, string>> = { dirt: '#c9b79c', skirt: '#77736b', concrete: '#bcb7ae', cement: '#8a867f' };
  const images = LAYERS.map((name) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, S, S);
    const t = tex.finer(fine, () => art[name]?.());
    if (t) {
      // The granite's 128 pixels are a metre, twice over in 256.
      const n = (t.image as HTMLCanvasElement).width < S ? 2 : 1;
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) g.drawImage(t.image as HTMLCanvasElement, (a * S) / n, (b * S) / n, S / n, S / n);
      t.dispose();
    }
    if (tint[name]) {
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = tint[name]!;
      g.fillRect(0, 0, S, S);
    }
    return c;
  });
  return tex.layered(images, S, S);
}

// The streets' material: each vertex's texture is a layer of the array, its uv and layer in `tuv`. Wet
// (look.ts's grey day), a street is darker and gives back the sky; on Ultra, the city too (braga-map's
// task 117), as much as a film of water on it does (WET_REFLECTS).
function surfaceMaterial(graphics: Graphics): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: WET ? '#a6a6a6' : '#ffffff', roughness: WET ? 0.32 : 0.86, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const array = layers(graphics === 'ultra' ? 4 : 1);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.layers = { value: array };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 tuv;\nvarying vec3 vTuv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTuv = tuv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray layers;\nvarying vec3 vTuv;')
      .replace('#include <map_fragment>', 'diffuseColor *= texture(layers, vTuv);');
    if (WET && graphics === 'ultra') reflects(sh, WET_REFLECTS.street, WET_REFLECTS.spread);
  };
  return m;
}
// How much a wet street and its paint reflect on Ultra, of what water would (GLSL), and how far what
// they reflect spreads, of the way to it: a film of water over the asphalt's grain, not a mirror.
const WET_REFLECTS = { street: '0.6', paint: '0.5', spread: 0.04 };

// Numbers three at a time, in an array that grows as they come.
class Floats {
  a = new Float32Array(3 * 1024);
  length = 0;
  push(x: number, y: number, z: number): void {
    if (this.length + 3 > this.a.length) {
      const b = new Float32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.length++] = x;
    this.a[this.length++] = y;
    this.a[this.length++] = z;
  }
  attribute(): THREE.BufferAttribute {
    return new THREE.BufferAttribute(this.a.slice(0, this.length), 3);
  }
}

// Geometry gathered for one mesh in one tile: positions, normals, and each vertex's uv and layer.
class Batch {
  pos = new Floats();
  nor = new Floats();
  tuv = new Floats();
  mesh(m: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', this.pos.attribute());
    g.setAttribute('normal', this.nor.attribute());
    g.setAttribute('tuv', this.tuv.attribute());
    g.computeBoundingSphere();
    const o = new THREE.Mesh(g, m);
    o.receiveShadow = true;
    return o;
  }
}

// Draws into a batch in one layer.
class Pen {
  b: Batch;
  layer: number;
  constructor(b: Batch, layer: number) {
    this.b = b;
    this.layer = layer;
  }
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number): void {
    this.b.pos.push(x, y, z);
    this.b.nor.push(nx, ny, nz);
    this.b.tuv.push(u, w, this.layer);
  }
  // A flat quad from its four corners in order round it, [x, y, z, u, v] each, its front the side
  // its normal (nx, ny, nz) is on.
  quad(c: number[][], nx: number, ny: number, nz: number): void {
    const [a, b, d] = [c[0], c[1], c[2]];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const ez = b[2] - a[2];
    const fx = d[0] - a[0];
    const fy = d[1] - a[1];
    const fz = d[2] - a[2];
    const along = (ey * fz - ez * fy) * nx + (ez * fx - ex * fz) * ny + (ex * fy - ey * fx) * nz;
    for (const i of along >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) this.v(c[i][0], c[i][1], c[i][2], nx, ny, nz, c[i][3] ?? 0, c[i][4] ?? 0);
  }
}

// The carriageways' triangles as drawn, for laying the lines on them: their heights wherever they are.
class Drawn {
  t: number[] = []; // nine numbers a triangle
  cells = new Grid<number>(5);
  add(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    const k = this.t.length / 9;
    this.t.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.cells.add(Math.min(ax, bx, cx), Math.min(az, bz, cz), Math.max(ax, bx, cx), Math.max(az, bz, cz), k);
  }
  // The height at (x, z) of the triangle under it nearest to `near`, or null where there's none.
  y(x: number, z: number, near: number): number | null {
    const t = this.t;
    let best: number | null = null;
    for (const k of this.cells.at(x, z)) {
      const o = k * 9;
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = t.slice(o, o + 9);
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (!d) continue;
      const a = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const b = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (a < -1e-4 || b < -1e-4 || a + b > 1 + 1e-4) continue;
      const y = a * ay + b * by + (1 - a - b) * cy;
      if (best === null || Math.abs(y - near) < Math.abs(best - near)) best = y;
    }
    return best;
  }
}

export interface Built {
  group: THREE.Group;
  // The world's walls a race takes down while it runs (braga-map's `cleared`, its task 057), drawn
  // apart: up round the city, hidden in a race (main.ts).
  cleared: THREE.Group;
  update: (t: number) => void;
  // The nearest raised kerb on the ground to (x, z) within r: the point on it, the way it runs and the
  // way into its pavement.
  kerbNear: (x: number, z: number, r: number) => { x: number; z: number; tx: number; tz: number; nx: number; nz: number; d: number } | null;
  // The top of the pavement at (x, z), as it's drawn, or the ground's where there's none.
  paveTop: (x: number, z: number) => number;
  // How many triangles each kind of thing came to, for the docs.
  counts: Record<string, number>;
}

// `housed` says whether (x, z) is in a building, where what meets the land doesn't show. `ground` is
// the land's own material, what the ground is as the map classes it (city.ts's coverMaterial), for a
// roundabout's island (braga-map's task 014): null where the map's cover didn't load, and the island is
// grass.
export function buildStreets(world: Braga, wg: WorldGround, landMesh: Surface, housed: (x: number, z: number) => boolean, graphics: Graphics, course: Course, ground: THREE.Material | null = null): Built {
  const quality = levelOf(graphics);
  const S = world.streets;
  const grain = GRAIN[quality];
  // How far the land has to stand over a street's edge for a retaining wall: less is just the land
  // reaching it.
  const rise = quality === 'low' ? 0.25 : 0.12;
  const { firm } = wg.d.land;
  const group = new THREE.Group();
  // What stands along them, baked at the end; and what of it a race takes down.
  const things = new THREE.Group();
  const clearedThings = new THREE.Group();
  const updates: ((t: number) => void)[] = [];
  const counts: Record<string, number> = {};
  const edges = streetEdges(S);
  const shared = (ax: number, az: number, bx: number, bz: number) => edges.has(key(bx, bz, ax, az));
  // The map's retaining walls (its task 013): where one stands along a street's edge, it's drawn in
  // the plain granite wall's place.
  const holding = new Grid<[number, number, number, number]>(10);
  for (const w of world.walls) {
    if (w.kind !== 'retaining') continue;
    for (let i = 1; i < w.pts.length; i++) {
      const [ax, az] = w.pts[i - 1];
      const [bx, bz] = w.pts[i];
      holding.add(Math.min(ax, bx) - 2, Math.min(az, bz) - 2, Math.max(ax, bx) + 2, Math.max(az, bz) + 2, [ax, az, bx, bz]);
    }
  }
  const held = (px: number, pz: number, qx: number, qz: number) => {
    const mx = (px + qx) / 2;
    const mz = (pz + qz) / 2;
    const L = Math.hypot(qx - px, qz - pz) || 1;
    return holding.at(mx, mz).some(([ax, az, bx, bz]) => {
      const ex = bx - ax;
      const ez = bz - az;
      const M = Math.hypot(ex, ez) || 1;
      const t = Math.max(0, Math.min(1, ((mx - ax) * ex + (mz - az) * ez) / (M * M)));
      return Math.hypot(ax + ex * t - mx, az + ez * t - mz) < 2 && Math.abs(((qx - px) * ex + (qz - pz) * ez) / (L * M)) > 0.8;
    });
  };

  // ---- The materials, and the batches per tile: the surfaces and faces, and the paint. ----
  const surfaces = surfaceMaterial(graphics);
  const paintMat = new THREE.MeshStandardMaterial({ color: WET ? '#c9c9c3' : '#efefe8', roughness: WET ? 0.3 : 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
  if (WET && graphics === 'ultra') paintMat.onBeforeCompile = (sh) => reflects(sh, WET_REFLECTS.paint, WET_REFLECTS.spread);
  // Metres a tile of each texture: along the street's rows for the setts and the calçada.
  const SCALE: Partial<Record<Layer, number>> = { asphalt: 8, setts: 2, calcada: 2.5, verge: 2, dirt: 6, granite: 1, paving: 2, cycle: 8, gravel: 4, blocks: 2, render: 2, hedge: 2, cement: 2, planks: 0.6 };
  const tiles = new Map<string, { surf: Batch; paint: Batch }>();
  // The walls a race takes down are batched apart, into these while they're drawn.
  const clearedTiles = new Map<string, { surf: Batch; paint: Batch }>();
  let into = tiles;
  const tileOf = (x: number, z: number) => {
    const k = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    let t = into.get(k);
    if (!t) into.set(k, (t = { surf: new Batch(), paint: new Batch() }));
    return t;
  };
  const batch = (x: number, z: number, m: Layer | 'paint') => {
    const t = tileOf(x, z);
    return m === 'paint' ? new Pen(t.paint, 0) : new Pen(t.surf, LAYERS.indexOf(m));
  };
  const count = (what: string, n: number) => (counts[what] = (counts[what] ?? 0) + n);

  // ---- São João da Ponte's bridge (braga-map's task 021): the decks within an arch's reach are an
  // arch of dressed granite. ----
  const arches = world.sights.flatMap((q) => (q.kind === 'arch' ? [archOf(q, world.rivers, S.paths.filter((p) => p.level === 'under'))] : []));
  const archAt = (x: number, z: number) => arches.find((a) => Math.hypot(x - a.x, z - a.z) < a.r) ?? null;

  // ---- The ways the streets run, for their textures. ----
  const frames = new Grid<Frame>(20);
  for (const l of world.lines) {
    if (l.kind > 8) continue;
    let s0 = 0;
    for (let k = 1; k < l.pts.length; k++) {
      const [ax, az] = l.pts[k - 1];
      const [bx, bz] = l.pts[k];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      frames.add(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), { ax, az, tx: (bx - ax) / L, tz: (bz - az) / L, L, s0 });
      s0 += L;
    }
  }
  // Looked for once in each square of 4 m, so the triangles in it share their texture's rows.
  const near = new Map<number, Frame>();
  const frameAt = (x: number, z: number): Frame => {
    const k = (Math.floor(x / 4) + 32768) * 65536 + Math.floor(z / 4) + 32768;
    let f = near.get(k);
    if (!f) near.set(k, (f = frameNear(Math.floor(x / 4) * 4 + 2, Math.floor(z / 4) * 4 + 2)));
    return f;
  };
  const frameNear = (x: number, z: number): Frame => {
    let best = WORLD;
    let bd = 15;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const f of frames.at(x + a * 20, z + b * 20)) {
          const t = Math.max(0, Math.min(f.L, (x - f.ax) * f.tx + (z - f.az) * f.tz));
          const d = Math.hypot(f.ax + f.tx * t - x, f.az + f.tz * t - z);
          if (d < bd) {
            bd = d;
            best = f;
          }
        }
      }
    }
    return best;
  };

  // ---- The surfaces: each piece laid on the ground (or on its deck), as finely as the ground needs,
  // its normals the ground's over a couple of metres so it isn't faceted. ----
  // The surface's normal at a point at height y on it, over a metre on: made once a point.
  const normals = new Map<number, [number, number, number]>();
  const normal = (h: Height, x: number, y: number, z: number, piece: unknown): [number, number, number] => {
    const k = (Math.round(x * 1000) + 5e6) * 1e7 + Math.round(z * 1000) + 5e6 + (piece ? 0.5 : 0);
    let n = normals.get(k);
    if (!n) {
      const gx = h(x + 1, z) - y;
      const gz = h(x, z + 1) - y;
      const l = Math.hypot(gx, 1, gz);
      normals.set(k, (n = [-gx / l, 1 / l, -gz / l]));
    }
    return n;
  };
  const drawn = new Drawn();
  // A roundabout's island, in what the ground is there, all in one batch: there are a few dozen.
  const islands = new Batch();
  const lay = (rings: Ring[], h: Height, m: Layer, road: boolean, piece: Piece | null, skip?: (x: number, z: number) => boolean, into?: Batch) => {
    const c = new Float64Array(9);
    let n = 0;
    const scale = SCALE[m] ?? 4;
    const layer = LAYERS.indexOf(m);
    surface(rings, h, road ? grain.road : grain.pave, (x, y, z) => {
      c[n++] = x;
      c[n++] = y;
      c[n++] = z;
      if (n < 9) return;
      n = 0;
      const mx = (c[0] + c[3] + c[6]) / 3;
      const mz = (c[2] + c[5] + c[8]) / 3;
      if (skip?.(mx, mz)) return;
      const f = frameAt(mx, mz);
      const b = into ?? tileOf(mx, mz).surf;
      for (let k = 0; k < 9; k += 3) {
        const [px, py, pz] = [c[k], c[k + 1], c[k + 2]];
        const nn = normal(h, px, py, pz, piece);
        b.pos.push(px, py, pz);
        b.nor.push(nn[0], nn[1], nn[2]);
        b.tuv.push(((px - f.ax) * -f.tz + (pz - f.az) * f.tx) / scale, (f.s0 + (px - f.ax) * f.tx + (pz - f.az) * f.tz) / scale, layer);
      }
      if (road) drawn.add(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8]);
      count(m, 1);
    });
  };
  const onCarriageway = (s: 'asphalt' | 'setts' | 'paving' | 'dirt'): Layer => (s === 'setts' ? 'setts' : s === 'paving' ? 'calcada' : s === 'dirt' ? 'dirt' : 'asphalt');
  // A reservation or an island: grass where it's wide enough, else paved.
  const besides = (kind: string, rings: Ring[]): Layer => {
    if (kind === 'pavement') return 'calcada';
    const a = Math.abs(area2(rings[0])) / 2;
    let perimeter = 0;
    for (const r of rings) for (let k = 0; k < r.length; k++) perimeter += Math.hypot(r[(k + 1) % r.length][0] - r[k][0], r[(k + 1) % r.length][1] - r[k][1]);
    return (kind === 'island' && a > 20) || (2 * a) / perimeter > 1.6 ? 'verge' : 'calcada';
  };
  // The heights of the surfaces on the ground: a carriageway on it, a pavement a kerb over it.
  const roadY: Height = (x, z) => firm(x, z) + LIFT;
  const paveY: Height = (x, z) => firm(x, z) + wg.raise(x, z) + LIFT;
  // A ground pavement that runs onto a deck's or a tunnel's road at its end gives way to the road, as
  // the karts find it (ground.ts).
  const pieceCells = wg.d.pieceCells;
  const yields = (x: number, z: number) => (pieceCells.at(x, z) ?? []).some((p) => p.rings.has(x, z) && Math.abs(p.height(x, z) - firm(x, z) - 0.15) < 0.5);
  for (const c of S.carriageways) if (c.level === 'ground') lay(c.rings, roadY, onCarriageway(c.surface), true, null);
  for (const p of S.pavements) if (p.level === 'ground') lay(p.rings, paveY, besides(p.kind, p.rings), false, null, yields, p.round && ground ? islands : undefined);
  // The paths on the ground (braga-map's task 050): on the land, flush with a pavement, or a flight's
  // treads, each at its height.
  const flat = groundPaths(S);
  const pathY = (p: Path): Height => (p.kind === 'steps' ? () => p.ys![0][0] + LIFT : p.raised ? paveY : roadY);
  for (const p of flat) lay(p.rings, pathY(p), pathLayer(p), false, null);
  for (const p of wg.d.pieces) {
    const h: Height = (x, z) => p.height(x, z) + LIFT;
    lay(p.outline, h, p.path ? pathLayer(p.path) : p.surface ? onCarriageway(p.surface) : 'calcada', !!p.surface && !p.path, p);
    // A deck's underside: under an arch, granite; under a boardwalk, its boards.
    if (p.level === 'bridge') {
      const arch = archAt((p.box.x0 + p.box.x1) / 2, (p.box.z0 + p.box.z1) / 2);
      const under: Height = (x, z) => p.height(x, z) - DEEP;
      const b = batch(p.outline[0][0][0], p.outline[0][0][1], arch ? 'blocks' : p.path?.surface === 'wood' ? 'planks' : 'concrete');
      const corner: number[] = [];
      surface(p.outline, under, p.surface ? grain.road : grain.pave, (x, y, z) => {
        corner.push(x, y, z);
        if (corner.length < 9) return;
        // Wound to face down.
        const [ax, ay, az, bx, by, bz, cx, cy, cz] = corner;
        corner.length = 0;
        for (const [px, py, pz] of [[ax, ay, az], [cx, cy, cz], [bx, by, bz]]) b.v(px, py, pz, 0, -1, 0, 0, 0);
      });
    }
  }

  // The height a piece's surface is drawn at along one of its edges, for what stands along it.
  const heightOf = (c: { level: string; rings: Ring[] }, isRoad: boolean): Height => {
    if (c.level === 'ground') return isRoad ? roadY : paveY;
    const p = wg.d.pieces.find((q) => q.outline === c.rings);
    return p ? (x, z) => p.height(x, z) + LIFT : isRoad ? roadY : paveY;
  };
  // Of a carriageway, a pavement or a path: a path flush with a pavement is as high, one on the
  // ground on it.
  const heightOfAny = (c: { level: string; rings: Ring[] }): Height => ('kind' in c && 'raised' in c && (c.level === 'ground' || c.level === 'under') ? pathY(c as Path) : heightOf(c, 'surface' in c || ('raised' in c && !c.raised)));
  // A vertical face along a line, between two heights at each of its points; uv along it and up it.
  const face = (m: Layer, pts: [number, number, number, number][], nx: number, nz: number) => {
    let u = 0;
    for (let k = 1; k < pts.length; k++) {
      const [ax, az, a0, a1] = pts[k - 1];
      const [bx, bz, b0, b1] = pts[k];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-4) continue;
      const s = SCALE[m] ?? 4;
      batch((ax + bx) / 2, (az + bz) / 2, m).quad(
        [
          [ax, a0, az, u / s, a0 / s],
          [bx, b0, bz, (u + L) / s, b0 / s],
          [bx, b1, bz, (u + L) / s, b1 / s],
          [ax, a1, az, u / s, a1 / s],
        ],
        nx,
        0,
        nz,
      );
      u += L;
      count(m, 2);
    }
  };

  // ---- Kerbs: where a pavement (a reservation, an island) meets a carriageway, a granite face from
  // the road up to it, and the kerbstones' tops along its edge. Where the kerb's dropped at a crossing
  // the pavement comes down to the road, and so does the face. And so where a path flush with a
  // pavement meets a carriageway, or a pavement or a path flush with one meets a cycle lane or a path
  // on the ground. ----
  {
    type Low = (typeof S.carriageways)[number] | Path;
    const roads = new Map<string, { c: Low }>();
    const level = (p: { level: string }) => (p.level === 'under' ? 'ground' : p.level);
    for (const c of [...S.carriageways, ...flat.filter((p) => p.kind !== 'steps' && !p.raised)]) for (const r of c.rings) for (let k = 0; k < r.length; k++) roads.set(key(r[k][0], r[k][1], r[(k + 1) % r.length][0], r[(k + 1) % r.length][1]), { c });
    for (const p of [...S.pavements, ...flat.filter((q) => q.raised)]) {
      const hp = heightOfAny(p);
      for (const r of p.rings) {
        const inside = Math.sign(area2(r)) || 1;
        for (let k = 0; k < r.length; k++) {
          const [ax, az] = r[k];
          const [bx, bz] = r[(k + 1) % r.length];
          const road = roads.get(key(bx, bz, ax, az));
          if (!road || level(road.c) !== level(p)) continue;
          const hc = heightOfAny(road.c);
          const L = Math.hypot(bx - ax, bz - az);
          // The points either surface has along it, and each one's heights as the surfaces have them.
          const ts = new Set<number>();
          const at = (pts: [number, number][], h: Height) => pts.map(([x, z]) => ({ t: Math.hypot(x - ax, z - az) / L, y: h(x, z) })).sort((p, q) => p.t - q.t);
          const onP = at(edgePoints(ax, az, bx, bz, hp, grain.pave), hp);
          const onC = at(edgePoints(bx, bz, ax, az, hc, grain.road), hc);
          for (const { t } of [...onP, ...onC]) ts.add(Math.round(t * 1e6) / 1e6);
          const along = (s: { t: number; y: number }[], t: number) => {
            let i = 1;
            while (i < s.length - 1 && s[i].t < t) i++;
            const [p, q] = [s[i - 1], s[i]];
            return q.t > p.t ? p.y + ((q.y - p.y) * (t - p.t)) / (q.t - p.t) : p.y;
          };
          const pts = [...ts].sort((p, q) => p - q).map((t) => [ax + (bx - ax) * t, az + (bz - az) * t, along(onC, t) - 0.03, along(onP, t)] as [number, number, number, number]);
          // Facing the road: out of the pavement.
          const nx = (inside * (bz - az)) / L;
          const nz = (-inside * (bx - ax)) / L;
          face('granite', pts, nx, nz);
          count('kerb face', pts.length - 1);
          // The kerbstones' tops, a quarter of a metre into the pavement, where it's raised.
          const b = batch((ax + bx) / 2, (az + bz) / 2, 'granite');
          for (let q = 1; q < pts.length; q++) {
            const [x0, z0, c0, y0] = pts[q - 1];
            const [x1, z1, c1, y1] = pts[q];
            if ((y0 - c0 < 0.08 && y1 - c1 < 0.08) || quality !== 'high') continue;
            const ix = -nx * 0.25;
            const iz = -nz * 0.25;
            b.quad(
              [
                [x0, y0 + 0.004, z0, x0, z0],
                [x1, y1 + 0.004, z1, x1, z1],
                [x1 + ix, y1 + 0.004, z1 + iz, x1 + ix, z1 + iz],
                [x0 + ix, y0 + 0.004, z0 + iz, x0 + ix, z0 + iz],
              ],
              0,
              1,
              0,
            );
            count('granite', 2);
            count('kerb top', 1);
          }
        }
      }
    }
  }

  // ---- Where the streets meet the land: from each piece's free edge on the ground, a skirt down to
  // the land where it's lower, or a granite retaining wall up to it where it's higher, so no gap shows
  // between them. A pavement's edge is a granite step, and a path's flush with one; a path on the
  // ground is as a carriageway. (A flight's treads, below.) ----
  for (const p of [...S.carriageways, ...S.pavements, ...flat.filter((q) => q.kind !== 'steps')]) {
    if (p.level !== 'ground' && p.level !== 'under') continue;
    const isRoad = 'raised' in p ? !p.raised : 'surface' in p;
    const h = heightOfAny(p);
    for (const r of p.rings) {
      const inside = Math.sign(area2(r)) || 1;
      for (let k = 0; k < r.length; k++) {
        const [ax, az] = r[k];
        const [bx, bz] = r[(k + 1) % r.length];
        if (shared(ax, az, bx, bz)) continue;
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1e-3) continue;
        // Facing out of the street.
        const nx = (inside * (bz - az)) / L;
        const nz = (-inside * (bx - ax)) / L;
        const along = edgePoints(ax, az, bx, bz, h, isRoad ? grain.road : grain.pave);
        for (let q = 1; q < along.length; q++) {
          const [px, pz] = along[q - 1];
          const [qx, qz] = along[q];
          const yp = h(px, pz);
          const yq = h(qx, qz);
          // The land beside it, as its mesh has it, a little out from the edge: where it bends.
          const all = landMesh.bends(px, pz, qx, qz).map((t) => {
            const x = px + (qx - px) * t;
            const z = pz + (qz - pz) * t;
            return [x, z, yp + (yq - yp) * t, landMesh.y(x + nx * 0.05, z + nz * 0.05), t] as const;
          });
          const pts = all.filter((q, k) => {
            if (k === 0 || k === all.length - 1) return true;
            const [a, b] = [all[k - 1], all[k + 1]];
            return Math.abs(q[3] - (a[3] + ((b[3] - a[3]) * (q[4] - a[4])) / (b[4] - a[4]))) > 0.01;
          });
          // Against a building, nothing shows.
          if (housed((px + qx) / 2 + nx * 0.5, (pz + qz) / 2 + nz * 0.5)) continue;
          const higher = pts.some(([, , y, l]) => l > y + rise);
          if (higher && held(px, pz, qx, qz)) {
            count('walls left to the map', 1);
            continue;
          }
          if (higher) {
            face('granite', pts.map(([x, z, y, l]) => [x, z, Math.min(y, l) - 0.25, Math.max(y, l)]), -nx, -nz);
            count('wall', pts.length - 1);
            continue;
          }
          const low = Math.min(...pts.map(([, , , l]) => l)) - 0.3;
          if ((isRoad || quality !== 'high') && pts.every(([, , y, l]) => y - l < (isRoad ? 0.02 : 0.3))) continue;
          count(isRoad ? 'skirt quads' : 'step', 1);
          face(isRoad ? 'skirt' : 'granite', [
            [px, pz, low, yp],
            [qx, qz, low, yq],
          ], nx, nz);
        }
      }
    }
  }

  // ---- A flight of steps (braga-map's task 050): along each tread's edge, where what's beside it is
  // lower, a face down to it (a riser, where it's the tread below), in what the steps are made of;
  // where the land beside it is higher, a granite wall up to it. A higher tread draws the riser
  // between them; so does a street or a path higher than the tread, its edge's. ----
  for (const p of flat) {
    if (p.kind !== 'steps' || !p.ys) continue;
    const y = p.ys[0][0] + LIFT;
    const m = pathLayer(p);
    for (const r of p.rings) {
      const inside = Math.sign(area2(r)) || 1;
      for (let k = 0; k < r.length; k++) {
        const [ax, az] = r[k];
        const [bx, bz] = r[(k + 1) % r.length];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1e-3) continue;
        const nx = (inside * (bz - az)) / L;
        const nz = (-inside * (bx - ax)) / L;
        const n = Math.max(1, Math.ceil(L));
        for (let q = 0; q < n; q++) {
          const [px, pz] = [ax + ((bx - ax) * q) / n, az + ((bz - az) * q) / n];
          const [qx, qz] = [ax + ((bx - ax) * (q + 1)) / n, az + ((bz - az) * (q + 1)) / n];
          const [mx, mz] = [(px + qx) / 2 + nx * 0.05, (pz + qz) / 2 + nz * 0.05];
          const o = wg.tread(mx, mz);
          if (o && o.y + LIFT >= y) continue;
          const land = !o && !wg.d.roads.has(mx, mz) && !wg.d.paves.has(mx, mz) && !wg.d.paths.has(mx, mz) && !wg.d.raised.has(mx, mz);
          if (land && housed(mx + nx * 0.45, mz + nz * 0.45)) continue;
          const out = (x: number, z: number) => (o ? o.y + LIFT : land ? landMesh.y(x + nx * 0.05, z + nz * 0.05) : wg.groundAt(x + nx * 0.05, z + nz * 0.05) + LIFT);
          const [yp, yq] = [out(px, pz), out(qx, qz)];
          if (yp > y + 0.02 || yq > y + 0.02) {
            if (!land) continue;
            face('granite', [[px, pz, y - 0.25, Math.max(y, yp)], [qx, qz, y - 0.25, Math.max(y, yq)]], -nx, -nz);
            count('step walls', 1);
            continue;
          }
          face(m, [[px, pz, Math.min(yp, y) - 0.03, y], [qx, qz, Math.min(yq, y) - 0.03, y]], nx, nz);
          count('risers', 1);
        }
      }
    }
  }

  // ---- The handrails, where the map has them: a steel rail on posts every metre and a half. ----
  {
    const steel = mat('#5d6266', { metalness: 0.6, roughness: 0.4 });
    for (const h of S.handrails) {
      if (h.level === 'tunnel') continue;
      let run = 0; // metres along it, for the posts
      for (let i = 1; i < h.pts.length; i++) {
        const [ax, az] = h.pts[i - 1];
        const [bx, bz] = h.pts[i];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.05) continue;
        const [ya, yb] = [h.ys[i - 1], h.ys[i]];
        const rail = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(L, yb - ya), 0.05, 0.05), steel);
        rail.position.set((ax + bx) / 2, (ya + yb) / 2, (az + bz) / 2);
        rail.rotation.set(0, -Math.atan2(bz - az, bx - ax), Math.atan2(yb - ya, L), 'YXZ');
        things.add(rail);
        for (let s = (1.5 - (run % 1.5)) % 1.5; s <= L; s += 1.5) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 0.04), steel);
          post.position.set(ax + ((bx - ax) * s) / L, ya + ((yb - ya) * s) / L - 0.45, az + ((bz - az) * s) / L);
          things.add(post);
          count('handrail posts', 1);
        }
        run += L;
      }
    }
    counts.handrails = S.handrails.length;
  }

  // ---- The walls, fences, railings, hedges and gates (braga-map's task 013), as the karts meet them
  // (ground.ts, wallSpan): a wall, a hedge or a fence as high as the map says over the ground they
  // drive on, a retaining wall from its foot to its top where the map has it. A wall is a block in
  // what it's made of, with a coping stone on it (granite on a granite or a rendered one), a railing its
  // top half where the map has one on it; a hedge a block of leaves; a fence's mesh, a railing's and a
  // gate's bars see-through, on posts; a guard rail a steel band; a lift gate a red bar. ----
  {
    const see = {
      mesh: new THREE.MeshStandardMaterial({ map: tex.chainLink(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.4 }),
      bars: new THREE.MeshStandardMaterial({ map: tex.bars(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 }),
    };
    const panes = { mesh: { pos: [] as number[], uv: [] as number[] }, bars: { pos: [] as number[], uv: [] as number[] } };
    // And those of the walls a race takes down, apart.
    const clearedPanes = { mesh: { pos: [] as number[], uv: [] as number[] }, bars: { pos: [] as number[], uv: [] as number[] } };
    let paneSet = panes;
    // A see-through pane along a line, between two heights at each point: the mesh's uv in metres
    // over two, the bars' along in metres over two and up from 0 at the foot to 1 at the top.
    const pane = (which: 'mesh' | 'bars', pts: [number, number, number, number][]) => {
      let u = 0;
      const p = paneSet[which];
      for (let k = 1; k < pts.length; k++) {
        const [ax, az, a0, a1] = pts[k - 1];
        const [bx, bz, b0, b1] = pts[k];
        const L = Math.hypot(bx - ax, bz - az);
        const [va0, va1, vb0, vb1] = which === 'mesh' ? [a0 / 2, a1 / 2, b0 / 2, b1 / 2] : [0, 1, 0, 1];
        p.pos.push(ax, a0, az, bx, b0, bz, bx, b1, bz, ax, a0, az, bx, b1, bz, ax, a1, az);
        p.uv.push(u / 2, va0, (u + L) / 2, vb0, (u + L) / 2, vb1, u / 2, va0, (u + L) / 2, vb1, u / 2, va1);
        u += L;
        count(which === 'mesh' ? 'fence mesh' : 'bars', 2);
      }
    };
    const steel = mat('#5d6266', { metalness: 0.6, roughness: 0.4 });
    const red = mat('#c8102e', { roughness: 0.5 });
    // A concrete wall is weathered, darker than a deck's underside.
    const LAYER: Record<string, Layer> = { granite: 'blocks', rendered: 'render', concrete: 'cement', wood: 'dirt', metal: 'skirt' };
    // How finely a wall follows the ground, by the graphics level.
    const step = quality === 'high' ? 3 : quality === 'medium' ? 4 : 6;
    // Each cut where it crosses the race's `cleared`, the pieces inside drawn apart.
    for (const { w, down } of clearedPieces(world.walls, course.cleared ?? [])) {
      into = down ? clearedTiles : tiles;
      paneSet = down ? clearedPanes : panes;
      const sink = down ? clearedThings : things;
      const span = wallSpan(wg, w, step);
      if (span.length < 2) continue;
      // Along it, each point with its foot and top.
      const pts: [number, number, number, number][] = span.map((q) => [q.x, q.z, q.y0, q.y1]);
      if (w.kind === 'wall' || w.kind === 'retaining' || w.kind === 'hedge') {
        const layer: Layer = w.kind === 'hedge' ? 'hedge' : (LAYER[w.material ?? 'granite'] ?? 'blocks');
        const coping = w.kind !== 'hedge' && quality === 'high' && (w.material === 'granite' || w.material === 'rendered' || w.material === 'concrete');
        const cap = coping ? 0.06 : 0;
        // A low wall with a railing on it: the railing its top half, up to 1.2 m of it, the wall under it
        // half a metre high at least.
        const rail = w.on === 'railing' ? Math.max(0, Math.min(1.2, w.h / 2, w.h - 0.5)) : 0;
        // A block half wide either side of its line, from lo to hi at each point: its sides, its top
        // and its ends; a retaining wall's back (on its left, its higher ground's side) buried in it.
        const slab = (m: Layer, half: number, lo: (k: number) => number, hi: (k: number) => number) => {
          // L on its right ((nx, nz)), a retaining wall's lower side; R on its left.
          const side = (sgn: number) => span.map((q, k) => [q.x + q.nx * half * sgn, q.z + q.nz * half * sgn, lo(k), hi(k)] as [number, number, number, number]);
          const [L, R] = [side(1), side(-1)];
          for (let k = 1; k < span.length; k++) {
            const { nx, nz } = span[k];
            face(m, [L[k - 1], L[k]], nx, nz);
            if (w.kind !== 'retaining') face(m, [R[k - 1], R[k]], -nx, -nz);
            batch(span[k].x, span[k].z, m).quad(
              [
                [L[k - 1][0], L[k - 1][3], L[k - 1][1], L[k - 1][0], L[k - 1][1]],
                [L[k][0], L[k][3], L[k][1], L[k][0], L[k][1]],
                [R[k][0], R[k][3], R[k][1], R[k][0], R[k][1]],
                [R[k - 1][0], R[k - 1][3], R[k - 1][1], R[k - 1][0], R[k - 1][1]],
              ],
              0,
              1,
              0,
            );
            count(m, 2);
          }
          const last = span.length - 1;
          face(m, [L[0], R[0]], -span[0].ux, -span[0].uz);
          face(m, [L[last], R[last]], span[last].ux, span[last].uz);
        };
        slab(layer, w.w / 2, (k) => span[k].y0, (k) => span[k].y1 - rail - cap);
        if (coping) slab(w.material === 'concrete' ? 'cement' : 'granite', w.w / 2 + 0.04, (k) => span[k].y1 - rail - cap, (k) => span[k].y1 - rail);
        if (rail > 0) pane('bars', pts.map((q) => [q[0], q[1], q[3] - rail, q[3]]));
        count(w.kind === 'hedge' ? 'hedges' : w.kind === 'retaining' ? 'retaining walls' : 'walls', 1);
        continue;
      }
      if (w.kind === 'guard_rail') face('skirt', pts.map((q) => [q[0], q[1], q[3] - 0.3, q[3]]), span[0].nx, span[0].nz);
      else if (w.kind === 'bar') {
        const [a, b] = [span[0], span[span.length - 1]];
        const bar = box(Math.hypot(b.x - a.x, b.z - a.z), 0.08, 0.08, red);
        bar.position.set((a.x + b.x) / 2, a.y1 - 0.04, (a.z + b.z) / 2);
        bar.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
        sink.add(bar);
      } else pane(w.kind === 'fence' ? 'mesh' : 'bars', pts.map((q) => [q[0], q[1], q[2] + 0.3, q[3]]));
      // Its posts: every 2.5 m along a fence, a railing or a guard rail, and at each end of a gate.
      const L = span.reduce((a, q, k) => (k ? a + Math.hypot(q.x - span[k - 1].x, q.z - span[k - 1].z) : 0), 0);
      const every = w.kind === 'gate' || w.kind === 'bar' ? Math.max(L, 0.1) : 2.5;
      for (let s = 0; s <= L + 1e-6; s += every) {
        const q = alongSpan(span, s);
        sink.add(box(0.06, q.y1 - q.y0 - 0.3, 0.06, steel, q.x, q.y0 + 0.3, q.z));
        count('posts', 1);
      }
      count(w.kind === 'fence' ? 'fences' : w.kind === 'bar' ? 'lift gates' : w.kind + 's', 1);
    }
    into = tiles;
    for (const [set, sink] of [[panes, things], [clearedPanes, clearedThings]] as const) {
      for (const which of ['mesh', 'bars'] as const) {
        const p = set[which];
        if (!p.pos.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
        g.computeVertexNormals();
        sink.add(new THREE.Mesh(g, see[which]));
      }
    }
  }

  // ---- The decks' parapets and the tunnels' sides, where the karts meet them (ground.ts). ----
  const timber = mat('#6b5641', { map: tex.planks(), roughness: 0.9 });
  for (const w of wg.d.sides) {
    const L = Math.hypot(w.bx - w.ax, w.bz - w.az);
    if (L < 1e-3) continue;
    // A boardwalk's edge: a board along it under the deck, posts every 1.5 m from the ground to the
    // handrail, and a rail half way up.
    if (w.kind === 'parapet' && w.piece.path?.surface === 'wood') {
      const road = w.y0 + DEEP;
      const top = w.y1 - 0.05;
      face('planks', [[w.ax + w.nx * 0.05, w.az + w.nz * 0.05, road - 0.25, road], [w.bx + w.nx * 0.05, w.bz + w.nz * 0.05, road - 0.25, road]], w.nx, w.nz);
      const yaw = -Math.atan2(w.bz - w.az, w.bx - w.ax);
      const [mx, mz] = [(w.ax + w.bx) / 2 - w.nx * 0.05, (w.az + w.bz) / 2 - w.nz * 0.05];
      for (const y of [top - 0.08, road + 0.45]) {
        const rail = box(L + 0.02, 0.08, 0.1, timber, mx, y, mz);
        rail.rotation.y = yaw;
        things.add(rail);
      }
      for (let d = 0; d < L; d += 1.5) {
        const [px, pz] = [w.ax + ((w.bx - w.ax) * d) / L - w.nx * 0.05, w.az + ((w.bz - w.az) * d) / L - w.nz * 0.05];
        const foot = Math.min(road - 0.25, firm(px, pz) - 0.2);
        things.add(box(0.1, top - foot, 0.1, timber, px, foot, pz));
      }
      count('boardwalk', 8);
      continue;
    }
    // An arch's: granite; and on its outer face, down from the deck, the arch's face over the river
    // and the abutments either side, down to the ground.
    const arch = w.kind === 'parapet' ? archAt((w.ax + w.bx) / 2, (w.az + w.bz) / 2) : null;
    if (arch) {
      const o = 0.3;
      const n = Math.max(1, Math.ceil(L / 0.5));
      const pts: [number, number, number, number][] = [];
      for (let f = 0; f <= n; f++) {
        const x = w.ax + ((w.bx - w.ax) * f) / n + w.nx * o;
        const z = w.az + ((w.bz - w.az) * f) / n + w.nz * o;
        pts.push([x, z, Math.min(w.y0, Math.max(firm(x, z) - 0.3, arch.ceiling(x, z))), w.y1]);
      }
      face('blocks', pts, w.nx, w.nz);
      face('granite', [[w.ax, w.az, w.y0 + DEEP, w.y1], [w.bx, w.bz, w.y0 + DEEP, w.y1]], -w.nx, -w.nz);
      batch((w.ax + w.bx) / 2, (w.az + w.bz) / 2, 'granite').quad([[w.ax, w.y1, w.az], [w.bx, w.y1, w.bz], [w.bx + w.nx * o, w.y1, w.bz + w.nz * o], [w.ax + w.nx * o, w.y1, w.az + w.nz * o]], 0, 1, 0);
      continue;
    }
    const b = batch((w.ax + w.bx) / 2, (w.az + w.bz) / 2, 'concrete');
    const quad = (pts: number[][], nx: number, ny: number, nz: number) => {
      b.quad(pts, nx, ny, nz);
      count('concrete', 2);
    };
    const { ax, az, bx, bz, nx, nz } = w;
    if (w.kind === 'bore') {
      quad([[ax, w.y0, az], [bx, w.y0, bz], [bx, w.y1, bz], [ax, w.y1, az]], -nx, 0, -nz);
      continue;
    }
    // The deck's side and the parapet over it, 0.3 m thick: its outer face, its top and its inner face.
    const o = 0.3;
    const top = w.y1;
    const road = w.y0 + DEEP;
    quad([[ax + nx * o, w.y0, az + nz * o], [bx + nx * o, w.y0, bz + nz * o], [bx + nx * o, top, bz + nz * o], [ax + nx * o, top, az + nz * o]], nx, 0, nz);
    quad([[ax, top, az], [bx, top, bz], [bx + nx * o, top, bz + nz * o], [ax + nx * o, top, az + nz * o]], 0, 1, 0);
    quad([[ax, road, az], [bx, road, bz], [bx, top, bz], [ax, top, az]], -nx, 0, -nz);
    quad([[ax, w.y0, az], [bx, w.y0, bz], [bx + nx * o, w.y0, bz + nz * o], [ax + nx * o, w.y0, az + nz * o]], 0, -1, 0);
  }

  // ---- The lines painted on the carriageways: lanes and the middle, dashed or solid, zebra crossings,
  // the stop lines at traffic lights, and at a roundabout's entries the give-way line and the
  // triangles behind it (braga-map's task 014), on the road as it's drawn. ----
  {
    const at = (x: number, z: number, near: number) => (drawn.y(x, z, near) ?? near) + 0.02;
    // A strip w wide from a to b, laid in pieces no longer than `piece`, so it bends where the road
    // under it does.
    const strip = (ax: number, az: number, bx: number, bz: number, w: number, near: (x: number, z: number) => number, piece = 2) => {
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) return;
      const ox = (-(bz - az) / L) * (w / 2);
      const oz = ((bx - ax) / L) * (w / 2);
      const n = Math.max(1, Math.ceil(L / piece));
      const b = batch((ax + bx) / 2, (az + bz) / 2, 'paint');
      for (let f = 0; f < n; f++) {
        const x0 = ax + ((bx - ax) * f) / n;
        const z0 = az + ((bz - az) * f) / n;
        const x1 = ax + ((bx - ax) * (f + 1)) / n;
        const z1 = az + ((bz - az) * (f + 1)) / n;
        const P = (x: number, z: number) => [x, at(x, z, near(x, z)), z];
        b.quad([P(x0 - ox, z0 - oz), P(x1 - ox, z1 - oz), P(x1 + ox, z1 + oz), P(x0 + ox, z0 + oz)], 0, 1, 0);
        count('paint', 2);
      }
    };
    // A crossing the map has as several zebras over each other (a node on each of a road's ways)
    // is drawn once, the longest of them; and zebras side by side keep their bars in line, measured
    // from the first one's start.
    type Zebra = { ax: number; az: number; ux: number; uz: number; L: number };
    const zebras: Zebra[] = [];
    const lineOf = (m: (typeof S.markings)[number]): Zebra | null => {
      const [ax, az] = m.pts[0];
      const [bx, bz] = m.pts[m.pts.length - 1];
      const L = Math.hypot(bx - ax, bz - az) || 1;
      const [ux, uz] = [(bx - ax) / L, (bz - az) / L];
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      let by: Zebra | null = null;
      for (const o of zebras) {
        const along = (mx - o.ax) * o.ux + (mz - o.az) * o.uz;
        const off = Math.abs(-(mx - o.ax) * o.uz + (mz - o.az) * o.ux);
        if (Math.abs(ux * o.ux + uz * o.uz) < 0.95 || along < -2 || along > o.L + 2 || off > 2 * m.w + 1) continue;
        if (off < m.w) return null;
        by ??= o;
      }
      const z = { ax, az, ux, uz, L };
      zebras.push(z);
      return by ?? z;
    };
    const markings = [...S.markings].sort((a, b) => (a.kind === 'zebra' && b.kind === 'zebra' ? Math.hypot(b.pts[0][0] - b.pts.at(-1)![0], b.pts[0][1] - b.pts.at(-1)![1]) - Math.hypot(a.pts[0][0] - a.pts.at(-1)![0], a.pts[0][1] - a.pts.at(-1)![1]) : 0));
    for (const m of markings) {
      const grid = m.kind === 'zebra' ? lineOf(m) : null;
      if (m.kind === 'zebra' && !grid) continue;
      const near = (x: number, z: number, k: number, t: number) => (m.level === 'ground' || !m.ys ? firm(x, z) + LIFT : m.ys[k - 1] + (m.ys[k] - m.ys[k - 1]) * t);
      let run = 0; // metres along the line, for the dashes
      for (let k = 1; k < m.pts.length; k++) {
        const [ax, az] = m.pts[k - 1];
        const [bx, bz] = m.pts[k];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.01) continue;
        const ny = (x: number, z: number) => near(x, z, k, Math.min(1, Math.hypot(x - ax, z - az) / L));
        const P = (s: number): [number, number] => [ax + ((bx - ax) * s) / L, az + ((bz - az) * s) / L];
        if (m.kind === 'zebra') {
          // Bars half a metre wide, half a metre apart, across the road; each w deep, along it: every
          // metre along its line as measured on the line it keeps in step with.
          const ux = (bx - ax) / L;
          const uz = (bz - az) / L;
          const o = grid!;
          const c = ux * o.ux + uz * o.uz || 1;
          const g0 = (ax - o.ax) * o.ux + (az - o.az) * o.uz;
          for (let k = Math.floor(Math.min(g0, g0 + c * L)) - 1; k <= Math.max(g0, g0 + c * L); k++) {
            const s = (k + 0.5 - g0) / c;
            if (s < 0.25 || s > L - 0.25) continue;
            const [cx, cz] = P(s);
            strip(cx - uz * (m.w / 2), cz + ux * (m.w / 2), cx + uz * (m.w / 2), cz - ux * (m.w / 2), 0.5, ny, 1);
          }
        } else if (m.dash) {
          const [on, off] = m.dash;
          const period = on + off;
          for (let s = 0; s < L; ) {
            const phase = (run + s) % period;
            if (phase < on) {
              const e = Math.min(L, s + on - phase);
              strip(...P(s), ...P(e), m.w, ny);
              s = e;
            } else s += period - phase;
          }
        } else strip(ax, az, bx, bz, m.w, ny, m.kind === 'stop' ? 1 : 2);
        run += L;
      }
    }
  }

  if (islands.pos.length && ground) group.add(Object.assign(islands.mesh(ground), { name: 'islands' }));
  for (const t of tiles.values()) {
    if (t.surf.pos.length) group.add(t.surf.mesh(surfaces));
    if (t.paint.pos.length) group.add(t.paint.mesh(paintMat));
  }
  const cleared = new THREE.Group();
  for (const t of clearedTiles.values()) if (t.surf.pos.length) cleared.add(t.surf.mesh(surfaces));

  // ---- What stands along them. ----
  const paves = wg.d.paves;
  const roadsRings = wg.d.roads;
  // Along each raised kerb on the ground: the way it runs, and which side the pavement is.
  const kerbs: { ax: number; az: number; bx: number; bz: number; L: number; side: number }[] = [];
  for (const k of S.kerbs) {
    if (k.level !== 'ground' || k.h <= 0) continue;
    for (let i = 1; i < k.pts.length; i++) {
      const [ax, az] = k.pts[i - 1];
      const [bx, bz] = k.pts[i];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const nx = -(bz - az) / L;
      const nz = (bx - ax) / L;
      const side = paves.has(mx + nx * 0.6, mz + nz * 0.6) && !roadsRings.has(mx + nx * 0.6, mz + nz * 0.6) ? 1 : paves.has(mx - nx * 0.6, mz - nz * 0.6) && !roadsRings.has(mx - nx * 0.6, mz - nz * 0.6) ? -1 : 0;
      if (side) kerbs.push({ ax, az, bx, bz, L, side });
    }
  }
  const kerbCells = new Grid<(typeof kerbs)[number]>(20);
  for (const k of kerbs) kerbCells.add(Math.min(k.ax, k.bx), Math.min(k.az, k.bz), Math.max(k.ax, k.bx), Math.max(k.az, k.bz), k);
  // The nearest raised kerb to (x, z) within r: the point on it, its way along and the pavement's side.
  const nearestKerb = (x: number, z: number, r: number) => {
    let best: { x: number; z: number; tx: number; tz: number; nx: number; nz: number; d: number } | null = null;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const k of kerbCells.at(x + a * 20, z + b * 20)) {
          const tx = (k.bx - k.ax) / k.L;
          const tz = (k.bz - k.az) / k.L;
          const s = Math.max(0, Math.min(k.L, (x - k.ax) * tx + (z - k.az) * tz));
          const px = k.ax + tx * s;
          const pz = k.az + tz * s;
          const d = Math.hypot(px - x, pz - z);
          if (d < r && (!best || d < best.d)) best = { x: px, z: pz, tx, tz, nx: -tz * k.side, nz: tx * k.side, d };
        }
      }
    }
    return best;
  };
  const paveTop = (x: number, z: number) => firm(x, z) + wg.raise(x, z);

  // Lamps: on the pavement half a metre behind the kerb, their arms over the road, about one every
  // 30 m down a street, the sides taking turns as they come.
  {
    const posts: THREE.Matrix4[] = [];
    const heads: THREE.Matrix4[] = [];
    const arms: THREE.Matrix4[] = [];
    const placed = new Grid<[number, number]>(30);
    const free = (x: number, z: number) => {
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [px, pz] of placed.at(x + a * 30, z + b * 30)) if (Math.hypot(px - x, pz - z) < 26) return false;
      return true;
    };
    for (const k of kerbs) {
      const tx = (k.bx - k.ax) / k.L;
      const tz = (k.bz - k.az) / k.L;
      const nx = -tz * k.side;
      const nz = tx * k.side;
      for (let s = 2; s < k.L - 1; s += 17) {
        const x = k.ax + tx * s + nx * 0.55;
        const z = k.az + tz * s + nz * 0.55;
        // A pavement wide enough, and nobody's lamp near.
        if (!paves.has(k.ax + tx * s + nx * 1.3, k.az + tz * s + nz * 1.3) || !free(x, z)) continue;
        placed.add(x, z, x, z, [x, z]);
        const y = paveTop(x, z);
        posts.push(new THREE.Matrix4().makeTranslation(x, y + 3.5, z));
        const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.atan2(tz, tx), 0));
        heads.push(new THREE.Matrix4().compose(new THREE.Vector3(x - nx * 1.8, y + 6.9, z - nz * 1.8), turn, new THREE.Vector3(1, 1, 1)));
        arms.push(new THREE.Matrix4().compose(new THREE.Vector3(x - nx * 0.9, y + 6.98, z - nz * 0.9), turn, new THREE.Vector3(1, 1, 1)));
      }
    }
    const steel = new THREE.MeshStandardMaterial({ color: '#2e3a33', metalness: 0.5, roughness: 0.5 });
    const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.14, 7, 8), steel, posts.length);
    posts.forEach((m, k) => post.setMatrixAt(k, m));
    // The arm out over the road from the post's top to the head: by day the head is seen for what it is.
    const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.08, 1.8), steel, arms.length);
    arms.forEach((m, k) => arm.setMatrixAt(k, m));
    // Lit, and glowing, only once the sun is down (look.ts); by day a lamp's a pale grey box.
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.22, 0.45), LIT ? new THREE.MeshBasicMaterial({ color: '#fff4d0', toneMapped: false }) : mat('#cfccc4', { roughness: 0.5 }), heads.length);
    heads.forEach((m, k) => head.setMatrixAt(k, m));
    for (const im of [post, arm, head]) im.computeBoundingSphere();
    group.add(post, arm, head);
    if (LIT) group.add(halos(heads.map((m) => new THREE.Vector3().setFromMatrixPosition(m).add(new THREE.Vector3(0, -0.3, 0))), ['#8a7440'], 4));
    counts.lamps = posts.length;
  }

  // Traffic lights at each stop line: a pole at its kerb end, its lamps towards the cars stopping.
  {
    const metal = mat('#3d4146', { metalness: 0.5, roughness: 0.5 });
    const black = mat('#141516', { roughness: 0.5 });
    const lit = ['#ff3b2f', '#ffb000', '#2fdc6a'].map((c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
    const off = mat('#2a2b2d', { roughness: 0.4 });
    // Each light's pole: where it stands, and which way it faces.
    const lights: THREE.Matrix4[] = [];
    for (const m of S.markings) {
      if (m.kind !== 'stop' || m.pts.length < 2) continue;
      const [ax, az] = m.pts[0];
      const [bx, bz] = m.pts[m.pts.length - 1];
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      // The street it's on: the line it crosses, and the way the cars stopping at it go (on the right
      // of the middle, as Portugal drives).
      const f = frameAt(mx, mz);
      if (f === WORLD) continue;
      const along = (mx - f.ax) * f.tx + (mz - f.az) * f.tz;
      const cx = f.ax + f.tx * along;
      const cz = f.az + f.tz * along;
      let tx = f.tx;
      let tz = f.tz;
      if (-tz * (mx - cx) + tx * (mz - cz) < 0) [tx, tz] = [-tx, -tz];
      const [ex, ez] = Math.hypot(ax - cx, az - cz) > Math.hypot(bx - cx, bz - cz) ? [ax, az] : [bx, bz];
      const x = ex - tz * 0.8;
      const z = ez + tx * 0.8;
      const y = wg.floor(x, z, firm(x, z) + 1).y;
      const pole = new THREE.Group();
      pole.add(box(0.14, 3.2, 0.14, metal, 0, 0, 0));
      pole.add(box(0.3, 1.0, 0.36, black, 0.18, 2.3, 0));
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Mesh(new THREE.CircleGeometry(0.11, 12), off);
        c.position.set(0.335, 3.1 - k * 0.3, 0);
        c.rotation.y = Math.PI / 2;
        pole.add(c);
      }
      // Its +x faces the cars coming.
      pole.position.set(x, y, z);
      pole.rotation.y = -Math.atan2(-tz, -tx);
      things.add(pole);
      pole.updateMatrix();
      lights.push(pole.matrix.clone());
    }
    // The lamps that are lit, all of them one mesh: each light keeps its own time, green, amber, red,
    // its lit lamp moved in front of the one it lights.
    const on = new THREE.InstancedMesh(new THREE.CircleGeometry(0.11, 12), new THREE.MeshBasicMaterial({ toneMapped: false }), Math.max(1, lights.length));
    on.count = lights.length;
    const colors = lit.map((m) => m.color);
    const local = new THREE.Matrix4();
    const turn = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    const m4 = new THREE.Matrix4();
    const show = (t: number) =>
      lights.forEach((pole, k) => {
        const u = (t + k * 7.3) % 20;
        const j = u < 11 ? 2 : u < 13 ? 1 : 0;
        local.makeTranslation(0.34, 3.1 - (2 - j) * 0.3, 0).multiply(turn);
        on.setMatrixAt(k, m4.multiplyMatrices(pole, local));
        on.setColorAt(k, colors[j]);
      });
    show(0);
    on.computeBoundingSphere();
    group.add(on);
    updates.push((t) => {
      show(t);
      on.instanceMatrix.needsUpdate = true;
      if (on.instanceColor) on.instanceColor.needsUpdate = true;
    });
    counts['traffic lights'] = lights.length;
  }

  // Every bus stop in the area (braga-map's task 042), a shelter of glass under a flat roof where the
  // map says it has one and the pavement is wide enough, else just the pole, on the pavement by the
  // kerb nearest it; where no kerb is within 20 m (a road with no pavement), the pole at the edge of
  // the carriageway nearest it.
  {
    // That edge within r: from on the carriageway, the first point off it; from off it, the point
    // itself; and the way out from the road.
    const roadEdge = (x: number, z: number, r: number) => {
      const on = roadsRings.has(x, z);
      for (let d = 0.25; d <= r; d += 0.25) {
        for (let a = 0; a < 16; a++) {
          const ux = Math.cos((a * Math.PI) / 8);
          const uz = Math.sin((a * Math.PI) / 8);
          if (roadsRings.has(x + ux * d, z + uz * d) !== on) return on ? { x: x + ux * d, z: z + uz * d, nx: ux, nz: uz } : { x, z, nx: -ux, nz: -uz };
        }
      }
      return null;
    };
    let n = 0;
    const metal = mat('#3d4146', { metalness: 0.5, roughness: 0.5 });
    const glass = mat('#9fb7c4', { roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35 });
    const sign = new THREE.MeshStandardMaterial({ map: tex.sign('PARAGEM', '', '#ffffff', '#1b3f8b', 256, 128, ''), roughness: 0.5 });
    for (const st of world.stops) {
      if (!world.inOpen(st.x, st.z)) continue;
      const k = nearestKerb(st.x, st.z, 20) ?? roadEdge(st.x, st.z, 15);
      if (!k) continue;
      n++;
      const wide = paves.has(k.x + k.nx * 2.3, k.z + k.nz * 2.3);
      const shelter = st.shelter && wide;
      const back = shelter ? 1.3 : 0.4;
      const x = k.x + k.nx * back;
      const z = k.z + k.nz * back;
      const stop = new THREE.Group();
      if (shelter) {
        stop.add(box(1.5, 0.1, 3.6, metal, 0, 2.4, 0), box(0.04, 2.3, 3.4, glass, -0.7, 0.1, 0));
        for (const zz of [-1.7, 1.7]) stop.add(box(0.08, 2.4, 0.08, metal, -0.7, 0, zz), box(1.3, 2.3, 0.04, glass, 0, 0.1, zz));
        stop.add(box(0.4, 0.45, 2.4, metal, -0.45, 0, 0));
      }
      stop.add(box(0.08, 2.8, 0.08, metal, shelter ? 0.6 : 0, 0, shelter ? 2.2 : 0));
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), sign);
      plate.position.set(shelter ? 0.6 : 0.05, 2.6, shelter ? 2.2 : 0);
      plate.rotation.y = Math.PI / 2;
      stop.add(plate);
      // Its +x faces the road.
      stop.position.set(x, paveTop(x, z), z);
      stop.rotation.y = -Math.atan2(-k.nz, -k.nx);
      things.add(stop);
    }
    counts['bus stops'] = n;
  }

  // Road-works barriers across every street where it leaves the area (braga-map's task 032): a row
  // of red-and-white boards on trestles, kerb to kerb and a metre past, and "Estrada cortada".
  {
    const boards = new THREE.MeshStandardMaterial({ map: tex.roadworks(), roughness: 0.6, side: THREE.DoubleSide });
    const legs = mat('#e9e6df', { roughness: 0.6 });
    const sign = new THREE.MeshStandardMaterial({ map: tex.sign('ESTRADA CORTADA', '', '#c8102e', '#ffffff', 512, 128, '#ffffff'), roughness: 0.5, side: THREE.DoubleSide });
    for (const gt of world.open.gates) {
      const hw = gt.w / 2 + 1;
      const n = Math.max(1, Math.round((2 * hw) / 2));
      const span = (2 * hw) / n;
      const row = new THREE.Group();
      // Local x across the street, z the way it leaves.
      for (let k = 0; k < n; k++) {
        const x = -hw + span * (k + 0.5);
        for (const lx of [-span / 2 + 0.15, span / 2 - 0.15]) row.add(box(0.08, 1.15, 0.6, legs, x + lx, 0, 0));
        for (const y of [0.5, 0.9]) {
          const b = new THREE.Mesh(new THREE.PlaneGeometry(span - 0.1, 0.24), boards);
          b.position.set(x, y + 0.12, 0.05);
          row.add(b);
        }
      }
      // The sign faces into the area, towards whoever's driving up to it.
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), sign);
      plate.position.set(0, 1.45, -0.06);
      plate.rotation.y = Math.PI;
      row.add(plate, box(0.06, 1.7, 0.06, legs, -0.6, 0, 0), box(0.06, 1.7, 0.06, legs, 0.6, 0, 0));
      // On a flight of steps (braga-map's task 050), its tread's.
      const y = gt.level === 'ground' && gt.k !== 13 ? firm(gt.x, gt.z) + LIFT : gt.y;
      row.position.set(gt.x, y, gt.z);
      // Local z along the way out: (cos heading, sin heading).
      row.rotation.y = -gt.heading + Math.PI / 2;
      things.add(row);
    }
    counts.gates = world.open.gates.length;
  }

  group.add(bake(things));
  if (clearedThings.children.length) cleared.add(bake(clearedThings));
  return { group, cleared, update: (t) => updates.forEach((u) => u(t)), counts, kerbNear: nearestKerb, paveTop };
}
