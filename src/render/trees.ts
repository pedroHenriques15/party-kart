// Trees. The first track's (buildTrees, plantTrees): purple jacarandas and plane trees down the Avenida,
// round trees in the lowlands, pines on the hills, cypresses by the churches; and the city's, the map's
// (cityTrees). Instanced, a few draw calls for thousands of trees.
import type { TreeKind as MapTreeKind, TreeKindOf } from 'braga-map';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RIVER_HALF_W } from '../track/layout.ts';
import { distanceToRoad, surfacePoint, type Track } from '../track/track.ts';
import type { Quality } from './look.ts';
import { LAKE, riverDistance } from './world.ts';

type Ground = (x: number, z: number) => number;
export type TreeKind = 'round' | 'pine' | 'cypress';
type Kind = TreeKind;

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!;
}

// Each kind: a crown and a trunk, about 1 unit to 8 tall. Plain ones have fewer faces, for
// places with thousands of trees; lean ones fewer still, for the Low graphics.
function shapes(kind: Kind, plain: boolean | 'lean' = false): { crown: THREE.BufferGeometry; trunk: THREE.BufferGeometry } {
  if (plain === 'lean' && kind !== 'cypress') {
    // About 20 faces a tree.
    const trunk = new THREE.CylinderGeometry(0.28, 0.4, kind === 'pine' ? 3 : 4, 4, 1, true).translate(0, kind === 'pine' ? 1.5 : 2, 0);
    if (kind === 'pine') return { crown: new THREE.ConeGeometry(2.4, 6, 5).translate(0, 5, 0), trunk };
    return { crown: new THREE.IcosahedronGeometry(2.7, 0).translate(0, 5, 0), trunk };
  }
  if (plain && kind !== 'cypress') {
    // About 50 faces a tree, trunk and all.
    const trunk = new THREE.CylinderGeometry(0.26, 0.4, kind === 'pine' ? 3 : 4, 5, 1, true).translate(0, kind === 'pine' ? 1.5 : 2, 0);
    if (kind === 'pine') return { crown: merge([new THREE.ConeGeometry(2.5, 4.2, 6).translate(0, 4, 0), new THREE.ConeGeometry(1.7, 3.2, 6).translate(0, 6.2, 0)]), trunk };
    return { crown: merge([new THREE.IcosahedronGeometry(2.5, 0).translate(0, 5, 0), new THREE.IcosahedronGeometry(1.8, 0).translate(1.3, 4.5, 0.6)]), trunk };
  }
  if (kind === 'pine') {
    return {
      crown: merge([new THREE.ConeGeometry(2.6, 3.6, 8).translate(0, 3.6, 0), new THREE.ConeGeometry(2.1, 3.2, 8).translate(0, 5.2, 0), new THREE.ConeGeometry(1.4, 2.6, 8).translate(0, 6.8, 0)]),
      trunk: new THREE.CylinderGeometry(0.22, 0.32, 3, 6).translate(0, 1.5, 0),
    };
  }
  if (kind === 'cypress') {
    return {
      crown: new THREE.SphereGeometry(1, 10, 8).scale(1.1, 4.2, 1.1).translate(0, 5, 0),
      trunk: new THREE.CylinderGeometry(0.2, 0.25, 1.5, 6).translate(0, 0.75, 0),
    };
  }
  return {
    crown: merge([
      new THREE.IcosahedronGeometry(2.4, plain ? 0 : 1).translate(0, 5, 0),
      new THREE.IcosahedronGeometry(1.7, 0).translate(1.5, 4.4, 0.5),
      new THREE.IcosahedronGeometry(1.6, 0).translate(-1.3, 4.6, -0.7),
    ]),
    trunk: new THREE.CylinderGeometry(0.28, 0.42, 4, plain ? 5 : 7).translate(0, 2, 0),
  };
}

export interface Tree {
  kind: Kind;
  x: number;
  y: number;
  z: number;
  s: number;
  color: THREE.Color;
}

export function buildTrees(track: Track, ground: Ground): THREE.Group {
  const trees: Tree[] = [];
  const N = track.samples.length;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const c = (h: number, s: number, l: number) => new THREE.Color().setHSL(h, s, l);

  // The Avenida: jacarandas in bloom, plane trees between.
  for (let i = N - 200; i < N + 270; i += 11) {
    const s = track.samples[i % N];
    for (const side of [-1, 1]) {
      const p = surfacePoint(s, side * (s.w / 2 + 3.5), 0);
      const jac = (i / 11) % 2 < 1;
      trees.push({ kind: 'round', x: p.x, y: ground(p.x, p.z), z: p.z, s: 0.85 + rnd() * 0.25, color: jac ? c(0.77 + rnd() * 0.03, 0.55, 0.5) : c(0.28, 0.5, 0.22) });
    }
  }

  // Woods: pines up the hills, round trees lower down; clear of the road, the river, the town,
  // the stadium, the stairway and the lake.
  for (let k = 0; k < 2600 && trees.length < 1700; k++) {
    const x = -540 + rnd() * 1480;
    const z = -740 + rnd() * 980;
    const { d } = distanceToRoad(track, x, z);
    const town = x > -130 && x < 430 && z > -215 && z < 70;
    const stadium = x > -175 && x < 85 && z > -300 && z < -190;
    const stairs = x > 640 && x < 735 && z < -225 && z > -470;
    const lake = Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 14;
    if (d < 9 || town || stadium || stairs || lake || riverDistance(x, z) < RIVER_HALF_W + 5) continue;
    const y = ground(x, z);
    const pine = y > 12 || rnd() < 0.25;
    trees.push({
      kind: pine ? 'pine' : 'round',
      x,
      y,
      z,
      s: 0.8 + rnd() * 0.6,
      color: pine ? c(0.34 + rnd() * 0.04, 0.45, 0.14 + rnd() * 0.05) : c(0.24 + rnd() * 0.06, 0.5, 0.2 + rnd() * 0.07),
    });
  }

  // Cypresses round the sanctuary at the top of Bom Jesus.
  const church = track.tags.find((t) => t.tag === 'church')!.i;
  for (let k = -40; k <= 40; k += 8) {
    for (const side of [1]) {
      const s = track.samples[church + k];
      const p = surfacePoint(s, side * (s.w / 2 + 7), 0);
      trees.push({ kind: 'cypress', x: p.x, y: ground(p.x, p.z), z: p.z, s: 0.9 + rnd() * 0.3, color: c(0.33, 0.45, 0.14) });
    }
  }

  return plantTrees(trees);
}

// Trees in tiles, each its own instanced meshes, so whole tiles out of view are skipped.
export function plantTrees(trees: Tree[], TILE = 300, plain: boolean | 'lean' = false): THREE.Group {
  const group = new THREE.Group();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const tiles = new Map<string, Tree[]>();
  for (const t of trees) {
    const key = `${t.kind}:${Math.floor(t.x / TILE)}:${Math.floor(t.z / TILE)}`;
    const list = tiles.get(key) ?? [];
    list.push(t);
    tiles.set(key, list);
  }
  const geos = { round: shapes('round', plain), pine: shapes('pine', plain), cypress: shapes('cypress', plain) };
  const crownMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5e4630', roughness: 1 });
  for (const [key, list] of tiles) {
    const { crown, trunk } = geos[key.split(':')[0] as Kind];
    const crowns = new THREE.InstancedMesh(crown, crownMat, list.length);
    const trunks = new THREE.InstancedMesh(trunk, trunkMat, list.length);
    list.forEach((t, k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (k * 2.39) % 6.28);
      m.compose(new THREE.Vector3(t.x, t.y - 0.2, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
      crowns.setMatrixAt(k, m);
      trunks.setMatrixAt(k, m);
      crowns.setColorAt(k, t.color);
    });
    for (const im of [crowns, trunks]) {
      im.computeBoundingSphere();
      im.castShadow = true;
    }
    group.add(crowns, trunks);
  }
  return group;
}

// ---- The city's trees (braga-map's task 019) ----
//
// Every tree the map has: as tall as DGT's LiDAR measured it, its crown as wide and its foot as high,
// and of its kind (broadleaf, pine, eucalyptus, cypress or cedar, poplar, palm), each kind in the map's
// photos of its bark and its leaves. Near the camera a tree is a trunk in its bark and a crown of sprays
// of its leaves, cards laid round the crown in its kind's shape, each card the same size in metres
// whatever the crown's (a palm's fronds grow with its crown); further off it's a billboard of its kind,
// made from the near tree when the city is built; and between the two they fade into each other,
// dithered. Its crown is where the map says its leaves are, over its trunk or off it, and no card of
// leaves hangs below its foot (braga-map's task 063). Instanced: near, a crown and a trunk mesh a kind,
// filled with the trees round the camera each time it has gone STEP metres; far, a mesh a kind holding
// every tree, which draws none within the near ones' reach.

export interface CityTree {
  kind: MapTreeKind;
  x: number;
  y: number;
  z: number;
  // Where its crown's middle is: over its trunk (x, z), or off it.
  cx: number;
  cz: number;
  h: number;
  crown: number;
  foot: number;
  trunk: number;
}
const CITY_KINDS: MapTreeKind[] = ['broadleaf', 'pine', 'eucalyptus', 'conifer', 'poplar', 'palm'];

interface Shape {
  // Cards on High (Medium has two thirds, Low half); each card's side as a share of the crown's width,
  // within [min, max] metres; the crown's radius at each height up it (0 its foot, 1 its top) as a share
  // of half its width; how far up the crown its trunk runs (a share of the crown's height); how far its
  // cards lean from upright towards lying flat; and the green its photo of leaves is taken to (sRGB), as
  // Braga's are in summer: the photos' leaves are paler and yellower.
  cards: number;
  card: [number, number, number];
  outline: (v: number) => number;
  into: number;
  tilt: number;
  green: string;
}
const round = (v: number) => Math.sqrt(Math.max(0, 1 - (2 * v - 1) ** 2));
const SHAPES: Record<MapTreeKind, Shape> = {
  // A round crown, fullest in its middle.
  broadleaf: { cards: 56, card: [0.5, 0.9, 4.5], outline: (v) => round(v) * 0.9 + 0.1, into: 0.45, tilt: 0.45, green: '#a3bd86' },
  // A maritime pine's: its needles in a flat-topped, uneven head at the top of a bare trunk.
  pine: { cards: 40, card: [0.55, 1.2, 5], outline: (v) => (v < 0.3 ? 0.55 + v * 1.5 : Math.sqrt(Math.max(0, 1 - ((v - 0.3) / 0.7) ** 3))), into: 0.55, tilt: 0.65, green: '#7e9a6e' },
  // A eucalyptus's: open and uneven, its leaves hanging.
  eucalyptus: { cards: 40, card: [0.5, 1.2, 5], outline: (v) => round(v) * 0.85 + 0.15, into: 0.7, tilt: 0.25, green: '#7c937e' },
  // A cypress's or a cedar's: a cone, dense from near the ground.
  conifer: { cards: 56, card: [0.6, 0.8, 3.4], outline: (v) => Math.max(0.08, 1 - v ** 1.2), into: 0.3, tilt: 0.2, green: '#86a27e' },
  // A poplar's: a narrow column.
  poplar: { cards: 50, card: [0.8, 0.8, 3.2], outline: (v) => round(v) * 0.85 + 0.15, into: 0.6, tilt: 0.15, green: '#b3cc8a' },
  // A palm's fronds (palmCrown), not cards: as many fronds.
  palm: { cards: 14, card: [1, 0, 99], outline: () => 1, into: 0.15, tilt: 0, green: '#a8bf8e' },
};

// A seeded random, so the trees are the same every time (the shots compare).
function seeded(seed: number): () => number {
  let s = Math.max(1, Math.floor(seed) % 2147483646);
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// A crown of cards over the unit crown (x and z from -0.5 to 0.5, y from 0, its foot, to 1, its top):
// each card's corners as offsets from its middle, a card a unit a side (scaled to its size in metres by
// the shader), its middle in `aCentre`; and normals out from the crown's heart, as a crown is lit.
function cardCrown(kind: MapTreeKind, n: number): THREE.BufferGeometry {
  const s = SHAPES[kind], rnd = seeded(11 + CITY_KINDS.indexOf(kind) * 97);
  const pos: number[] = [], cen: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let k = 0; k < n; k++) {
    // Most cards near the crown's skin, a few inside it, more where it's wide.
    let v = 0;
    for (let tries = 0; tries < 20; tries++) {
      v = 0.08 + rnd() * 0.9;
      if (rnd() < s.outline(v)) break;
    }
    const th = rnd() * Math.PI * 2, r = s.outline(v) * (k < n * 0.2 ? 0.25 + 0.4 * rnd() : 0.7 + 0.3 * rnd());
    const cx = 0.5 * r * Math.cos(th), cy = v, cz = 0.5 * r * Math.sin(th);
    // It faces out, turned a little, and leans back towards lying flat as the kind's do.
    const yaw = th + (rnd() - 0.5) * 1.4, pitch = s.tilt * rnd() * (Math.PI / 2);
    const nx = Math.cos(yaw) * Math.cos(pitch), ny = Math.sin(pitch), nz = Math.sin(yaw) * Math.cos(pitch);
    const rx = -Math.sin(yaw), rz = Math.cos(yaw);
    // Up the card: right × normal.
    const ux = -rz * ny, uy = rz * nx - rx * nz, uz = rx * ny;
    const lx = cx, ly = (cy - 0.45) * 0.8, lz = cz, ll = Math.hypot(lx, ly, lz) || 1;
    const mx = (lx / ll) * 0.75 + nx * 0.25, my = (ly / ll) * 0.75 + ny * 0.25 + 0.15, mz = (lz / ll) * 0.75 + nz * 0.25, ml = Math.hypot(mx, my, mz);
    const base = pos.length / 3;
    for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      pos.push(rx * a + ux * b, uy * b, rz * a + uz * b);
      cen.push(cx, cy, cz);
      // The heart's normal, with a little of the card's own.
      nor.push(mx / ml, my / ml, mz / ml);
      uv.push(a + 0.5, 0.5 - b);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return crownGeometry(pos, cen, nor, uv, idx);
}

// A palm's crown over the unit crown: fronds from its top's middle, rising and then arching down to its
// edge, each a strip of quads along its stem, its photo from its foot (the card's bottom row) to its tip.
function palmCrown(n: number): THREE.BufferGeometry {
  const rnd = seeded(5);
  const pos: number[] = [], cen: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const SEG = 4;
  for (let k = 0; k < n; k++) {
    const th = (k / n) * Math.PI * 2 + rnd() * 0.3, rise = 0.5 + rnd() * 0.6, w = 0.2 + rnd() * 0.06;
    const dx = Math.cos(th), dz = Math.sin(th), rx = -dz, rz = dx;
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const f = i / SEG, x = 0.5 * f, y = 0.8 + rise * 0.35 * f - (rise + 0.7) * 0.55 * f * f;
      for (const a of [-0.5, 0.5]) {
        pos.push(dx * x + rx * a * w, y, dz * x + rz * a * w);
        cen.push(0, 0, 0);
        nor.push(dx * 0.3, 0.95, dz * 0.3);
        uv.push(a + 0.5, 1 - f);
      }
      if (i) {
        const q = base + (i - 1) * 2;
        idx.push(q, q + 1, q + 3, q, q + 3, q + 2);
      }
    }
  }
  return crownGeometry(pos, cen, nor, uv, idx);
}

function crownGeometry(pos: number[], cen: number[], nor: number[], uv: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCentre', new THREE.Float32BufferAttribute(cen, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Dithering's threshold at a pixel (interleaved gradient noise): a fade shows a pixel where it's under
// how much of the thing is there.
const DITHER = 'float treeDither() { return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); }';
// How much of a near tree is there: all of it within the near reach, none past it, over the last BAND
// metres between.
const NEARNESS = 'clamp((treeNear.x - distance(cameraPosition.xz, vTreeAt.xz)) / treeNear.y, 0.0, 1.0)';

type Shader = { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string };

// A near crown's vertex: each card scaled to its size in metres (k × the crown's width, within [min,
// max]) round its middle, so a crown stretched to its height and width doesn't stretch its cards (a
// palm's fronds, `fixed` 0, stretch with it); and where its tree stands, for the fade.
function crownVertex(sh: Shader, card: [number, number, number], fixed: number): void {
  sh.uniforms.cardSize = { value: new THREE.Vector3(...card) };
  sh.uniforms.cardFixed = { value: fixed };
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aCentre;\nuniform vec3 cardSize;\nuniform float cardFixed;\nvarying vec3 vTreeAt;').replace(
    '#include <begin_vertex>',
    `vec3 transformed = aCentre + position;
#ifdef USE_INSTANCING
  vec3 iS = max(vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)), vec3(1e-3));
  float cs = clamp(cardSize.x * iS.x, cardSize.y, cardSize.z);
  transformed = mix(aCentre + position, aCentre + position * cs / iS, cardFixed);
  // No card hangs below the crown's foot: one whose lower edge would is lifted till it's there.
  transformed.y += cardFixed * max(0.0, abs(position.y) * cs - aCentre.y * iS.y) / iS.y;
  vTreeAt = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
  vTreeAt = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#endif`,
  );
}

// A near mesh's fragment, faded out past the near reach.
function nearFragment(sh: Shader, near: THREE.IUniform): void {
  sh.uniforms.treeNear = near;
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>\nuniform vec2 treeNear;\nvarying vec3 vTreeAt;\n${DITHER}`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nif (${NEARNESS} <= treeDither()) discard;`);
}

export interface TreeLooks {
  bark: THREE.Texture | null;
  leaves: THREE.Texture | null;
}

// Loads each kind's bark and leaves at the graphics level, as the graphics card takes them; a kind the
// map has no photo for is drawn in a colour alone.
export async function loadTreeLooks(kinds: TreeKindOf[], renderer: THREE.WebGLRenderer, quality: Quality): Promise<Record<string, TreeLooks>> {
  const { ktx2Loader } = await import('./photos.ts');
  const loader = ktx2Loader(renderer);
  const out: Record<string, TreeLooks> = {};
  await Promise.all(
    kinds.map(async (k) => {
      const [bark, leaves] = await Promise.all([k.bark, k.leaves].map((t) => (t ? loader.loadAsync(t.files[quality].url) : Promise.resolve(null))));
      if (bark) {
        bark.wrapS = bark.wrapT = THREE.RepeatWrapping;
        bark.repeat.set(1, 3);
      }
      if (leaves) leaves.anisotropy = 4;
      out[k.kind] = { bark, leaves };
    }),
  );
  loader.dispose();
  return out;
}

// How far near trees reach at each level; the step the camera takes before they're gathered again; the
// band they fade over; and the cells they're gathered by.
const NEAR: Record<Quality, number> = { high: 260, medium: 180, low: 120 };
const STEP = 20;
const BAND = 25;
const CELL_M = 50;
// How far a trunk leans at most: the tangent of its angle from upright (25°).
const LEAN = 0.47;

export function cityTrees(trees: CityTree[], looks: Record<string, TreeLooks>, quality: Quality, renderer: THREE.WebGLRenderer): THREE.Group {
  const group = new THREE.Group();
  const R = NEAR[quality];
  const near = { value: new THREE.Vector2(R, BAND) };
  const cardsOf = (k: MapTreeKind) => Math.round(SHAPES[k].cards * (quality === 'high' ? 1 : quality === 'medium' ? 0.67 : 0.5));
  const sides = quality === 'high' ? 7 : quality === 'medium' ? 5 : 4;
  const trunkGeo = new THREE.CylinderGeometry(0.42, 0.5, 1, sides, 1, true).translate(0, 0.5, 0);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  const none: TreeLooks = { bark: null, leaves: null };

  // Each tree's crown, trunk and billboard matrices and its tint, once: a tree's colour varies a little
  // from its kind's, by where it stands.
  const n = trees.length, crownM = new Float32Array(n * 16), trunkM = new Float32Array(n * 16), farM = new Float32Array(n * 16), tint = new Float32Array(n * 3);
  const shear = new THREE.Matrix4();
  trees.forEach((t, i) => {
    const r = seeded(1 + Math.abs((Math.floor(t.x * 7.3) * 73856093) ^ (Math.floor(t.z * 3.7) * 19349663)));
    r();
    q.setFromAxisAngle(up, r() * Math.PI * 2);
    const ch = Math.max(0.6, t.h - t.foot), th = t.foot + ch * SHAPES[t.kind].into + 0.3;
    m.compose(new THREE.Vector3(t.cx, t.y + t.foot, t.cz), q, new THREE.Vector3(t.crown, ch, t.crown)).toArray(crownM, i * 16);
    // Its trunk leans into its crown where the crown's middle is further off it than half the crown's
    // radius (a crown spread to one side stands on an upright trunk), up to LEAN from upright.
    const dx = t.cx - t.x, dz = t.cz - t.z, d = Math.hypot(dx, dz), k = d > 0 ? Math.min(Math.max(0, d - t.crown / 4), th * LEAN) / d : 0;
    shear.set(1, (dx * k) / th, 0, 0, 0, 1, 0, 0, 0, (dz * k) / th, 1, 0, 0, 0, 0, 1);
    m.compose(new THREE.Vector3(), q, new THREE.Vector3(t.trunk * 1.1, th, t.trunk * 1.1)).premultiply(shear).setPosition(t.x, t.y - 0.3, t.z).toArray(trunkM, i * 16);
    m.compose(new THREE.Vector3(t.cx, t.y, t.cz), new THREE.Quaternion(), new THREE.Vector3(t.crown, t.h, t.crown)).toArray(farM, i * 16);
    col.setRGB(1, 1, 1).multiplyScalar(0.82 + r() * 0.3).offsetHSL((r() - 0.5) * 0.04, 0, 0);
    tint.set([col.r, col.g, col.b], i * 3);
  });

  // The trees by cell, for gathering those near the camera.
  const cells = new Map<number, number[]>();
  const key = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);
  trees.forEach((t, i) => {
    const k = key(Math.floor(t.x / CELL_M), Math.floor(t.z / CELL_M));
    let list = cells.get(k);
    if (!list) cells.set(k, (list = []));
    list.push(i);
  });

  const nearMeshes: { kind: MapTreeKind; crowns: THREE.InstancedMesh; trunks: THREE.InstancedMesh; max: number }[] = [];
  for (const kind of CITY_KINDS) {
    const all = trees.filter((t) => t.kind === kind);
    if (!all.length) continue;
    const look = looks[kind] ?? none, s = SHAPES[kind], fixed = kind === 'palm' ? 0 : 1;
    const geo = kind === 'palm' ? palmCrown(cardsOf(kind)) : cardCrown(kind, cardsOf(kind));
    const crownMat = new THREE.MeshStandardMaterial({ color: look.leaves ? s.green : '#4f6b33', map: look.leaves, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
    crownMat.onBeforeCompile = (sh) => {
      crownVertex(sh, s.card, fixed);
      nearFragment(sh, near);
    };
    crownMat.customProgramCacheKey = () => `crown-${kind}`;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: look.leaves, alphaTest: 0.5, side: THREE.DoubleSide });
    depth.onBeforeCompile = (sh) => crownVertex(sh, s.card, fixed);
    depth.customProgramCacheKey = () => `crown-depth-${kind}`;
    const trunkMat = new THREE.MeshStandardMaterial({ color: look.bark ? '#ffffff' : '#5e4630', map: look.bark, roughness: 1 });
    trunkMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTreeAt;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTreeAt = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;');
      nearFragment(sh, near);
    };
    trunkMat.customProgramCacheKey = () => 'trunk';
    // As many as stand within the near reach at the thickest of them, at most.
    const max = Math.min(all.length, 24000);
    const crowns = new THREE.InstancedMesh(geo, crownMat, max);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, max);
    crowns.customDepthMaterial = depth;
    crowns.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    for (const im of [crowns, trunks]) {
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = true;
      im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(im);
    }
    crowns.name = `trees: ${kind}`;
    nearMeshes.push({ kind, crowns, trunks, max });

    // Far: its billboard, a quad turned to face the camera about the upright, as wide as its tree's crown
    // and as tall as the tree, lit from the sky; none within the near reach but the band they fade over.
    const mat = new THREE.MeshStandardMaterial({ color: look.leaves ? s.green : '#ffffff', map: bakeBillboard(kind, geo, trunkGeo, look, all, renderer), alphaTest: 0.4, roughness: 0.95, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec2 treeNear;\nvarying vec3 vTreeAt;')
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 tAt = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
vec3 toCam = cameraPosition - tAt;
toCam.y = 0.0;
toCam = length(toCam) > 0.0 ? normalize(toCam) : vec3(0.0, 0.0, 1.0);
vec3 objectNormal = normalize(vec3(0.0, 1.0, 0.0) + toCam * 0.35);`,
        )
        .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalize((viewMatrix * vec4(objectNormal, 0.0)).xyz);')
        .replace('#include <begin_vertex>', 'vec3 transformed = position;')
        .replace(
          '#include <project_vertex>',
          `vec3 iS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
vec3 wp = tAt + vec3(toCam.z, 0.0, -toCam.x) * position.x * iS.x + vec3(0.0, position.y * iS.y, 0.0);
vTreeAt = tAt;
vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
gl_Position = projectionMatrix * mvPosition;
if (distance(cameraPosition.xz, tAt.xz) < treeNear.x - treeNear.y - 2.0) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);`,
        )
        .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(wp, 1.0);');
      sh.uniforms.treeNear = near;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform vec2 treeNear;\nvarying vec3 vTreeAt;\n${DITHER}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nif (${NEARNESS} > treeDither()) discard;`);
    };
    mat.customProgramCacheKey = () => 'tree-billboard';
    const list = trees.map((t, i) => (t.kind === kind ? i : -1)).filter((i) => i >= 0);
    const far = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), mat, list.length);
    far.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
    list.forEach((i, k) => {
      (far.instanceMatrix.array as Float32Array).set(farM.subarray(i * 16, i * 16 + 16), k * 16);
      (far.instanceColor!.array as Float32Array).set(tint.subarray(i * 3, i * 3 + 3), k * 3);
    });
    far.frustumCulled = false;
    far.name = `far trees: ${kind}`;
    group.add(far);
  }

  // Each time the camera has gone STEP metres: the trees within the near reach and STEP more, in their
  // kinds' meshes, nearest cells first. What's written now reaches the graphics card at the next frame,
  // so the meshes take their new counts then.
  const last = new THREE.Vector2(Infinity, Infinity);
  let pending: number[] | null = null;
  const gather = (cx: number, cz: number) => {
    const counts = nearMeshes.map(() => 0), slot = new Map(nearMeshes.map((nm, k) => [nm.kind, k]));
    const reach = R + STEP, ci = Math.floor(cx / CELL_M), cj = Math.floor(cz / CELL_M), span = Math.ceil(reach / CELL_M);
    const order: [number, number, number][] = [];
    for (let i = -span; i <= span; i++) for (let j = -span; j <= span; j++) order.push([Math.hypot(i, j), ci + i, cj + j]);
    order.sort((a, b) => a[0] - b[0]);
    for (const [, i, j] of order) {
      for (const t of cells.get(key(i, j)) ?? []) {
        const tr = trees[t];
        if ((tr.x - cx) ** 2 + (tr.z - cz) ** 2 > reach * reach) continue;
        const k = slot.get(tr.kind)!, nm = nearMeshes[k], c = counts[k];
        if (c >= nm.max) continue;
        (nm.crowns.instanceMatrix.array as Float32Array).set(crownM.subarray(t * 16, t * 16 + 16), c * 16);
        (nm.trunks.instanceMatrix.array as Float32Array).set(trunkM.subarray(t * 16, t * 16 + 16), c * 16);
        (nm.crowns.instanceColor!.array as Float32Array).set(tint.subarray(t * 3, t * 3 + 3), c * 3);
        counts[k] = c + 1;
      }
    }
    for (const nm of nearMeshes) {
      nm.crowns.instanceMatrix.needsUpdate = nm.trunks.instanceMatrix.needsUpdate = true;
      nm.crowns.instanceColor!.needsUpdate = true;
    }
    return counts;
  };
  // A mesh with nothing to draw, drawn every frame, which sees where the camera is.
  const watch = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3)), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  watch.frustumCulled = false;
  watch.onBeforeRender = (_r, _s, camera) => {
    if (pending) {
      pending.forEach((c, k) => (nearMeshes[k].crowns.count = nearMeshes[k].trunks.count = c));
      pending = null;
    }
    const p = camera.getWorldPosition(new THREE.Vector3());
    if ((p.x - last.x) ** 2 + (p.z - last.y) ** 2 < STEP * STEP) return;
    last.set(p.x, p.z);
    pending = gather(p.x, p.z);
  };
  watch.name = 'trees: where the camera is';
  group.add(watch);
  return group;
}

// A kind's billboard: a near tree of its kind's usual proportions (the middle of its trees' heights over
// their widths, and feet over heights), drawn from the side into a texture, lit as a crown is (its top
// brighter than its underside), see-through round it.
function bakeBillboard(kind: MapTreeKind, crownGeo: THREE.BufferGeometry, trunkGeo: THREE.BufferGeometry, look: TreeLooks, trees: CityTree[], renderer: THREE.WebGLRenderer): THREE.Texture {
  const mid = (a: number[]) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1] : 0);
  const s = SHAPES[kind];
  const tall = Math.max(1, Math.min(5, mid(trees.map((t) => t.h / t.crown))));
  const footShare = Math.min(0.8, mid(trees.map((t) => t.foot / t.h)));
  const W = Math.min(14, Math.max(4, mid(trees.map((t) => t.crown)))), H = W * tall, foot = H * footShare;
  const px = 128, py = Math.min(512, Math.max(64, Math.round((px * tall) / 4) * 4));
  const rt = new THREE.WebGLRenderTarget(px, py, { colorSpace: THREE.SRGBColorSpace, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, samples: 4 });
  const shade = (sh: Shader) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vShade;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvShade = 0.5 + 0.5 * normal.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vShade;').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 0.55 + 0.45 * vShade;');
  };
  const crownMat = new THREE.MeshBasicMaterial({ color: look.leaves ? '#ffffff' : '#4f6b33', map: look.leaves, alphaTest: 0.5, side: THREE.DoubleSide });
  crownMat.onBeforeCompile = (sh) => {
    crownVertex(sh, s.card, kind === 'palm' ? 0 : 1);
    shade(sh);
  };
  crownMat.customProgramCacheKey = () => `bake-${kind}`;
  const trunkMat = new THREE.MeshBasicMaterial({ color: look.bark ? '#a0a0a0' : '#5e4630', map: look.bark });
  const crown = new THREE.InstancedMesh(crownGeo, crownMat, 1);
  const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, 1);
  const m = new THREE.Matrix4(), dia = Math.max(0.15, 0.012 * H + 0.018 * W) * 1.1;
  crown.setMatrixAt(0, m.compose(new THREE.Vector3(0, foot, 0), new THREE.Quaternion(), new THREE.Vector3(W, H - foot, W)));
  trunk.setMatrixAt(0, m.compose(new THREE.Vector3(0, -0.3, 0), new THREE.Quaternion(), new THREE.Vector3(dia, foot + (H - foot) * s.into + 0.3, dia)));
  const scene = new THREE.Scene().add(crown, trunk);
  const cam = new THREE.OrthographicCamera(-W / 2, W / 2, H, 0, -W * 2, W * 2);
  cam.position.set(0, 0, W);
  cam.lookAt(0, 0, 0);
  const was = renderer.getRenderTarget(), clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  // See-through in the leaves' own colour, so the smaller mipmaps fade to it and not to black.
  renderer.setClearColor(look.leaves ? s.green : '#4f6b33', 0);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(was);
  renderer.setClearColor(clear, alpha);
  crownMat.dispose();
  trunkMat.dispose();
  return rt.texture;
}
