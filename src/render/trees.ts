// Trees. The first track's (buildTrees, plantTrees): purple jacarandas and plane trees down the Avenida,
// round trees in the lowlands, pines on the hills, cypresses by the churches; and the city's, the map's
// (cityTrees). Instanced, a few draw calls for thousands of trees.
import type { TreeKind as MapTreeKind, TreeKindOf, TreeYear } from 'braga-map';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RIVER_HALF_W } from '../track/layout.ts';
import { distanceToRoad, surfacePoint, type Track } from '../track/track.ts';
import { anisotropy, clock, DAY, levelOf, type Graphics } from './look.ts';
import { ktx2Loader } from './ktx2.ts';
import { dithered } from './post.ts';
import { seasonOf } from './season.ts';
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
// and of its kind (broadleaf, pine, eucalyptus, cypress or cedar, poplar, palm, and since braga-map's task
// 061 the plane, the lime and the birch the photos show), each kind in the map's textures of its bark and
// its leaves (made, not photographed: braga-map's task 082). Near the camera a tree is a trunk in its bark and a crown of sprays
// of its leaves, cards laid round the crown in its kind's shape, each card the same size in metres
// whatever the crown's (a palm's fronds grow with its crown); further off it's a billboard of its kind,
// made from the near tree when the city is built; and between the two they fade into each other,
// dithered. Its crown is where the map says its leaves are, over its trunk or off it, and no card of
// leaves hangs below its foot (braga-map's task 063). Instanced: near, a crown and a trunk mesh a kind,
// filled with the trees round the camera each time it has gone STEP metres; far, a mesh a kind holding
// every tree, which draws none within the near ones' reach. On Ultra (braga-map's task 089) the near ones
// sway in the wind, and those of the kinds that drop their leaves have their limbs drawn; and those
// kinds' crowns are in their season, near and far, by the date (task 093: bare twigs in winter).

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
const CITY_KINDS: MapTreeKind[] = ['broadleaf', 'pine', 'eucalyptus', 'conifer', 'poplar', 'palm', 'plane', 'lime', 'birch', 'evergreen-broadleaf'];

interface Shape {
  // Cards on High (Medium has two thirds, Low half); each card's side as a share of the crown's width,
  // within [min, max] metres; the crown's radius at each height up it (0 its foot, 1 its top) as a share
  // of half its width; how far up the crown its trunk runs (a share of the crown's height); how far its
  // cards lean from upright towards lying flat; and the green its texture of leaves is taken to (sRGB), as
  // Braga's are in summer: the texture's leaves, matched to Poly Haven's photos, are paler and yellower.
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
  // braga-map's task 061, the kinds its photos tell apart. A plane's: big and open, its broad leaves in
  // big sprays, the sky through it.
  plane: { cards: 48, card: [0.5, 1.1, 5.5], outline: (v) => round(v) * 0.85 + 0.15, into: 0.55, tilt: 0.4, green: '#9db783' },
  // A lime's: dense and round down to its foot, a ball where it's clipped into one, its leaves small and
  // many, darker than the avenues' broadleaves, as the Parque da Ponte's are in its photos.
  lime: { cards: 72, card: [0.45, 0.8, 3.6], outline: (v) => round(v) * 0.95 + 0.05, into: 0.4, tilt: 0.5, green: '#7a9566' },
  // A birch's: a light oval on a trunk that runs up into it, its sprays hanging.
  birch: { cards: 44, card: [0.6, 0.6, 2.8], outline: (v) => round(v) * 0.8 + 0.2, into: 0.75, tilt: 0.1, green: '#a9c38b' },
  // braga-map's task 093: a broadleaf that keeps its leaves in winter, drawn as the broadleaf is.
  'evergreen-broadleaf': { cards: 56, card: [0.5, 0.9, 4.5], outline: (v) => round(v) * 0.9 + 0.1, into: 0.45, tilt: 0.45, green: '#a3bd86' },
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

// A deciduous crown's limbs over the unit crown: a few, each from its trunk's top (`aTrunkTop`, the tree's
// own, as its trunk stands off its crown's middle and leans) out and up into its leaves (`aCentre`), a
// tube of a few lengths tapering to a twig, and two forks from each, on out and up towards the crown's
// edge, which a bare crown shows (braga-map's task 093). A fork starts `aFrom.w` along its limb, whose end
// is `aFrom.xyz` (a limb's own `aFrom.w` is 0: it starts at the trunk's top), and is `aThick` as thick.
// Round each, `position.xy` the way out from its middle line (the shader turns it to the limb's own way,
// which differs from tree to tree), and how far along it, `aAlong`.
const LIMB_SIDES = 6;
function limbGeometry(kind: MapTreeKind): THREE.BufferGeometry {
  const s = SHAPES[kind], rnd = seeded(29 + CITY_KINDS.indexOf(kind) * 53);
  const pos: number[] = [], end: number[] = [], from: number[] = [], thick: number[] = [], along: number[] = [], uv: number[] = [], idx: number[] = [];
  const LIMBS = 5, FORKS = 2, SEG = 4;
  const tube = (tip: number[], start: number[], k: number) => {
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      for (let j = 0; j < LIMB_SIDES; j++) {
        const a = (j / LIMB_SIDES) * Math.PI * 2;
        pos.push(Math.cos(a), Math.sin(a), 0);
        end.push(...tip);
        from.push(...start);
        thick.push(k);
        along.push(i / SEG);
        uv.push(j / LIMB_SIDES, (i / SEG) * 3);
      }
      if (i)
        for (let j = 0; j < LIMB_SIDES; j++) {
          const a0 = base + (i - 1) * LIMB_SIDES + j, a1 = base + (i - 1) * LIMB_SIDES + ((j + 1) % LIMB_SIDES), b0 = a0 + LIMB_SIDES, b1 = a1 + LIMB_SIDES;
          // Wound to face out, as its normals do (a limb is drawn from both sides, which turns a face's
          // normal round where its back is seen).
          idx.push(a0, a1, b0, a1, b1, b0);
        }
    }
  };
  for (let k = 0; k < LIMBS; k++) {
    const th = (k / LIMBS) * Math.PI * 2 + rnd() * 1.0, y1 = 0.45 + rnd() * 0.2, r1 = 0.5 * s.outline(y1) * (0.35 + 0.25 * rnd());
    const tip = [Math.cos(th) * r1, y1, Math.sin(th) * r1];
    tube(tip, [0, 0, 0, 0], 1);
    for (let f = 0; f < FORKS; f++) {
      const t = th + (f ? 1 : -1) * (0.35 + rnd() * 0.3), y2 = Math.min(0.92, y1 + 0.1 + rnd() * 0.2), r2 = 0.5 * s.outline(y2) * (0.55 + 0.25 * rnd());
      tube([Math.cos(t) * r2, y2, Math.sin(t) * r2], [...tip, 0.5 + rnd() * 0.2], 0.5);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCentre', new THREE.Float32BufferAttribute(end, 3));
  g.setAttribute('aFrom', new THREE.Float32BufferAttribute(from, 4));
  g.setAttribute('aThick', new THREE.Float32BufferAttribute(thick, 1));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// A limb's vertex, in the unit crown: along its line from its tree's trunk top (or, a fork, from along
// its limb) to its end, bowed up a little, round it at its radius in metres (k × the crown's width within
// [min, max], a fork's less, down to a fifth at its end); and lit by the way out from its line, in metres.
function limbVertex(sh: Shader, size: [number, number, number]): void {
  sh.uniforms.cardSize = { value: new THREE.Vector3(...size) };
  sh.uniforms.windTime = clock;
  // Its shape in a function of its own, called for its normal and its place: a shadow's pass works out
  // only the place.
  sh.vertexShader = sh.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute vec3 aCentre;
attribute vec4 aFrom;
attribute float aThick;
attribute float aAlong;
attribute vec3 aTrunkTop;
uniform vec3 cardSize;
varying vec3 vTreeAt;
${WIND}
vec3 limbAt(out vec3 nrm) {
  vec3 iS = max(vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)), vec3(1e-3));
  vec3 from = mix(aTrunkTop, aFrom.xyz, aFrom.w) + vec3(0.0, 0.05 * sin(3.1416 * aFrom.w), 0.0);
  vec3 way = normalize((aCentre - from) * iS);
  vec3 side = cross(way, vec3(0.0, 1.0, 0.0));
  side = length(side) > 1e-3 ? normalize(side) : vec3(1.0, 0.0, 0.0);
  vec3 outward = side * position.x + cross(way, side) * position.y;
  nrm = outward * iS;
  float cs = clamp(cardSize.x * iS.x, cardSize.y, cardSize.z) * aThick * (1.0 - 0.8 * aAlong);
  return mix(from, aCentre, aAlong) + vec3(0.0, 0.05 * sin(3.1416 * aAlong), 0.0) + outward * cs / iS;
}`,
    )
    .replace('#include <beginnormal_vertex>', 'vec3 objectNormal;\nlimbAt(objectNormal);')
    .replace(
      '#include <begin_vertex>',
      `vec3 limbNormal;
vec3 transformed = limbAt(limbNormal);
vTreeAt = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#ifdef TREE_WIND
transformed += windPush(vTreeAt, max(0.0, transformed.y - aTrunkTop.y));
#endif`,
    );
}

// A palm's crown over the unit crown: fronds from its top's middle, rising and then arching down to its
// edge, each a strip of quads along its stem, its texture from its foot (the card's bottom row) to its tip.
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

// The wind on Ultra (braga-map's task 089), where a material has TREE_WIND: how far a tree's top is
// pushed, in metres, at a place and a moment. A breeze from the west-south-west, as the afternoon of the
// photos had, in gusts that cross the city; each tree swaying on its own beat. Nothing at the clock's 0
// (?scenery's still city) and all of it from 4 s on. A crown sways from its foot over a trunk that
// stands still.
const WIND = `uniform float windTime;
vec2 windAt(vec2 xz, float t) {
  float gust = 0.55 + 0.45 * sin(0.21 * t - dot(xz, vec2(0.011, 0.004)));
  float beat = fract(sin(dot(floor(xz * 2.0), vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
  float sway = sin(1.3 * t + beat - dot(xz, vec2(0.05, 0.02)));
  return vec2(0.92, 0.38) * smoothstep(0.0, 4.0, t) * gust * (0.6 * gust + 0.4 * sway) * 0.3;
}
// A point of a tree's pushed, in its instance's own frame: by k, the share of its top's push there.
#ifdef USE_INSTANCING
vec3 windPush(vec3 at, float k) { vec2 w = windAt(at.xz, windTime); return inverse(mat3(instanceMatrix)) * vec3(w.x, 0.0, w.y) * k; }
#endif`;

// A near crown's vertex: each card scaled to its size in metres (k × the crown's width, within [min,
// max]) round its middle, so a crown stretched to its height and width doesn't stretch its cards (a
// palm's fronds, `fixed` 0, stretch with it); and where its tree stands, for the fade.
function crownVertex(sh: Shader, card: [number, number, number], fixed: number): void {
  sh.uniforms.cardSize = { value: new THREE.Vector3(...card) };
  sh.uniforms.cardFixed = { value: fixed };
  sh.uniforms.windTime = clock;
  sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\nattribute vec3 aCentre;\nuniform vec3 cardSize;\nuniform float cardFixed;\nvarying vec3 vTreeAt;\n${WIND}`).replace(
    '#include <begin_vertex>',
    `vec3 transformed = aCentre + position;
#ifdef USE_INSTANCING
  vec3 iS = max(vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)), vec3(1e-3));
  float cs = clamp(cardSize.x * iS.x, cardSize.y, cardSize.z);
  transformed = mix(aCentre + position, aCentre + position * cs / iS, cardFixed);
  // No card hangs below the crown's foot: one whose lower edge would is lifted till it's there.
  transformed.y += cardFixed * max(0.0, abs(position.y) * cs - aCentre.y * iS.y) / iS.y;
  vTreeAt = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#ifdef TREE_WIND
  // The crown swaying from its foot, over a trunk that stands still (in its leaves there), the more
  // the higher up; and each card fluttering on its own.
  float flutter = 0.05 * sin(4.3 * windTime + dot(aCentre, vec3(17.0, 31.0, 23.0))) * smoothstep(0.0, 4.0, windTime);
  transformed += windPush(vTreeAt, max(0.0, transformed.y)) + inverse(mat3(instanceMatrix)) * vec3(flutter, 0.5 * flutter, -flutter);
#endif
#else
  vTreeAt = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#endif
#ifdef TREE_SEASON
  vCard = fract(sin(dot(aCentre * 3.7 + vTreeAt * 0.0173, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
#endif`,
  );
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n#ifdef TREE_SEASON\nvarying float vCard;\n#endif');
}

// The season on Ultra (braga-map's task 093, season.ts), where a crown's material has TREE_SEASON. Each
// card is in leaf or bare twigs by a number of its own (`vCard`, by where it is in its crown and where its
// tree stands), so the crown thins card by card as the year goes on. A card in leaf takes the season's
// colours, each as bright as the leaf's own texel: a spring's paler green, its kind's autumn colour (each
// card turning on its own) and its flowers'. A card of twigs shows its kind's: cut where a twig is as wide
// as a few pixels, and where they're finer see-through by their own share of each pixel, dithered, so a
// bare crown far off is a haze, as one is, not nothing (on a billboard's bake, TREE_BAKE, a plain cut),
// and the dither resolved in Ultra's frame (post.ts's `dithered`), so it's a soft mass and not a stipple;
// the cards in two sets dithered apart, so one set's fill in what the other's leave (task 132: the one
// pattern for all left the same holes in each, too thin a veil once resolved, pink against the sky; one
// each massed a crown near black); taken a little darker, as the leaves are to their green, a card being
// lit as its crown is, from its heart (most of a twig is in its own and its neighbours' shade), and half
// way to its own grey, as the winter photos' twigs are against the sky; and darker still seen against the
// sun (TREE_LIT), as a twig's shaded side is. A twig has no sheen: a card's normal is its crown's, near
// upright, and the sun glancing off it seen from below drew it white (task 132), where a twig is a dark
// line against the sky.
const SEASON = `uniform vec4 season;
uniform vec3 leafGreen;
uniform vec3 leafMean;
uniform vec3 autumnColour;
uniform vec3 freshColour;
uniform vec3 bloomColour;
uniform sampler2D twigMap;
varying float vCard;
float seasonDither() { return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.00583715, 0.06711056)))); }`;
// A spring's new leaves.
const FRESH = '#b8d070';

function seasonFragment(sh: Shader, u: Record<string, THREE.IUniform>): void {
  Object.assign(sh.uniforms, u);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${SEASON}`).replace(
    '#include <map_fragment>',
    `float seasonTwig = step(season.x, vCard), seasonShare = 0.0;
if (vCard >= season.x) {
  vec4 twig = texture2D(twigMap, vMapUv);
#ifdef TREE_BAKE
  if (twig.a < 0.3) discard;
#else
  vec2 tx = dFdx(vMapUv) * vec2(textureSize(twigMap, 0)), ty = dFdy(vMapUv) * vec2(textureSize(twigMap, 0));
  float lod = 0.5 * log2(max(1.0, max(dot(tx, tx), dot(ty, ty))));
  seasonShare = clamp(lod / 3.0, 0.0, 1.0);
  if (twig.a <= mix(0.5, fract(seasonDither() + step(0.5, fract(vCard * 5.17)) * 0.5), seasonShare)) discard;
#endif
  diffuseColor = vec4(mix(vec3(dot(twig.rgb, vec3(0.2126, 0.7152, 0.0722))), twig.rgb, 0.5) * 0.65, 1.0);
#if defined(TREE_LIT) && NUM_DIR_LIGHTS > 0
  diffuseColor.rgb *= mix(1.0, 0.3, smoothstep(0.0, 0.7, -dot(normalize(-vViewPosition), directionalLights[0].direction)));
#endif
} else {
#include <map_fragment>
  float own = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) / max(1e-4, dot(leafGreen * leafMean, vec3(0.2126, 0.7152, 0.0722)));
  diffuseColor.rgb = mix(diffuseColor.rgb, freshColour * own, 0.6 * season.z);
  diffuseColor.rgb = mix(diffuseColor.rgb, autumnColour * own, clamp(season.y * 1.6 - fract(vCard * 7.31) * 0.6, 0.0, 1.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, bloomColour * own, 0.35 * season.w * step(fract(vCard * 3.17), 0.6));
}`,
  ).replace(
    '#include <lights_physical_fragment>',
    `#include <lights_physical_fragment>
material.specularColor *= 1.0 - seasonTwig;
material.specularColorBlended *= 1.0 - seasonTwig;
material.specularF90 *= 1.0 - seasonTwig;`,
  ).replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\nreflectedLight.directDiffuse *= 1.0 - ${(1 - TWIG_SUN).toFixed(2)} * seasonTwig;`);
  dithered(sh, 'seasonShare');
}
// How much of the sun a card of twigs takes of what a card of leaves facing it would: a twig is a thin
// round stick, the sun on one side of it, and what's seen of a crown's against the sky is mostly its
// shaded side, in the sky's light (task 132: in the whole sun a warm brown, it averaged with the sky
// to a pink, as if in flower, and massed to a copper beech's).
const TWIG_SUN = 0.35;

// A deciduous kind's season on a day, as its crowns' shaders take it; null when its crowns are as in
// summer (in full leaf, neither fresh, turning nor in flower), so they draw as they did before task 093.
function seasonUniforms(look: TreeLooks, green: string, day: number): Record<string, THREE.IUniform> | null {
  if (!look.leaves || !look.twigs || look.year?.bud === undefined) return null;
  const s = seasonOf(look.year, day), mean = look.leafMean ?? [128, 128, 128];
  if (s.leaves >= 1 && s.turned === 0 && s.fresh === 0 && s.bloom === 0) return null;
  return {
    season: { value: new THREE.Vector4(s.leaves, s.turned, s.fresh, s.bloom) },
    leafGreen: { value: new THREE.Color(green) },
    leafMean: { value: new THREE.Color().setRGB(mean[0] / 255, mean[1] / 255, mean[2] / 255, THREE.SRGBColorSpace) },
    autumnColour: { value: new THREE.Color(look.year.autumn ?? green) },
    freshColour: { value: new THREE.Color(FRESH) },
    bloomColour: { value: new THREE.Color(look.year.flowers?.colour ?? green) },
    twigMap: { value: look.twigs },
  };
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
  // On Ultra, the bark's relief (a normal map) and its roughness (braga-map's task 085).
  barkRelief?: { normal: THREE.Texture; roughness: THREE.Texture };
  // On Ultra, a deciduous kind's bare twigs, its year and its leaves' mean colour (sRGB bytes), for its
  // season (braga-map's task 093).
  twigs?: THREE.Texture | null;
  year?: TreeYear | null;
  leafMean?: [number, number, number];
}

// Loads each kind's bark and leaves at the graphics level, as the graphics card takes them; a kind the
// map has no texture for is drawn in a colour alone. On Ultra, their finest, and the bark's relief and
// roughness.
export async function loadTreeLooks(kinds: TreeKindOf[], renderer: THREE.WebGLRenderer, graphics: Graphics): Promise<Record<string, TreeLooks>> {
  const loader = ktx2Loader(renderer);
  const quality = levelOf(graphics), ultra = graphics === 'ultra';
  const load = (f: { url: string } | null | undefined) => (f ? loader.loadAsync(f.url) : Promise.resolve(null));
  const out: Record<string, TreeLooks> = {};
  // A kind drawn in another's bark and leaves (the evergreen broadleaf in the broadleaf's, braga-map's
  // task 093) takes that one's, loaded once.
  const look = (k: TreeKindOf) => `${k.bark?.id}|${k.leaves?.id}`, first = new Map<string, string>();
  for (const k of kinds) if (!first.has(look(k))) first.set(look(k), k.kind);
  await Promise.all(
    kinds.filter((k) => first.get(look(k)) === k.kind).map(async (k) => {
      const [bark, leaves, normal, roughness] = await Promise.all([
        ...[k.bark, k.leaves].map((t) => load(t && (ultra ? t.ultra.colour : t.files[quality]))),
        ...(ultra ? [load(k.bark?.ultra.normal), load(k.bark?.ultra.roughness)] : []),
      ]);
      // The bark wrapped round a trunk three times up it, its relief with it.
      for (const t of [bark, normal, roughness]) {
        if (!t) continue;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(1, 3);
      }
      if (leaves) leaves.anisotropy = anisotropy(4);
      // A deciduous kind's twigs, for its season on Ultra.
      const twigs = ultra && SEASONAL.includes(k.kind) && k.twigs && k.year?.bud !== undefined ? await load(k.twigs.ultra.colour) : null;
      if (twigs) twigs.anisotropy = anisotropy(4);
      out[k.kind] = { bark, leaves, ...(normal && roughness ? { barkRelief: { normal, roughness } } : {}), ...(twigs ? { twigs, year: k.year, leafMean: k.leaves?.mean } : {}) };
    }),
  );
  for (const k of kinds) {
    const of = out[first.get(look(k))!];
    if (!out[k.kind] && of) out[k.kind] = { bark: of.bark, leaves: of.leaves, ...(of.barkRelief ? { barkRelief: of.barkRelief } : {}) };
  }
  loader.dispose();
  return out;
}

// How far near trees reach at each level; the step the camera takes before they're gathered again; the
// band they fade over; and the cells they're gathered by. Ultra's is the most whose gathering keeps a
// frame under 16 ms on the owner's PC at 2560 by 1440 (braga-map's task 081): the frame that takes a
// new gather up was 8 ms at 260 m, 12 at 700 and 18 at 1,000; a still frame stays under 5 ms.
const NEAR: Record<Graphics, number> = { ultra: 700, high: 260, medium: 180, low: 120 };
const STEP = 20;
const BAND = 25;
const CELL_M = 50;
// How far a trunk leans at most: the tangent of its angle from upright (25°).
const LEAN = 0.47;
// The kinds that drop their leaves (braga-map's map().treeKinds, decision 051), whose near crowns on Ultra
// have their limbs drawn: the sky through such a crown shows its branches. test/trees.test.ts keeps it
// the map's.
export const DECIDUOUS: MapTreeKind[] = ['broadleaf', 'poplar', 'plane', 'lime', 'birch'];
// The kinds whose crowns are in their season on Ultra (braga-map's task 093): those that drop their
// leaves. The hills' woods, green in the winter photos, are the map's evergreen broadleaves since 093.
export const SEASONAL: MapTreeKind[] = DECIDUOUS;
// A limb's radius at its foot: this share of its crown's width, within [min, max] metres; and how far
// from the camera they're drawn (past it a limb in a crown is a pixel or less).
const LIMB: [number, number, number] = [0.012, 0.05, 0.14];
const LIMB_REACH = 150;

export function cityTrees(trees: CityTree[], looks: Record<string, TreeLooks>, graphics: Graphics, renderer: THREE.WebGLRenderer): THREE.Group {
  // Below Ultra the evergreen broadleaves are drawn as broadleaves, as they were before braga-map's task
  // 093 named them: only Ultra's seasons tell them apart.
  if (graphics !== 'ultra') trees = trees.map((t) => (t.kind === 'evergreen-broadleaf' ? { ...t, kind: 'broadleaf' } : t));
  const group = new THREE.Group();
  const quality = levelOf(graphics);
  const R = NEAR[graphics];
  const near = { value: new THREE.Vector2(R, BAND) };
  const ultra = graphics === 'ultra';
  const cardsOf = (k: MapTreeKind) => Math.round(SHAPES[k].cards * (quality === 'high' ? 1 : quality === 'medium' ? 0.67 : 0.5));
  const sides = quality === 'high' ? 7 : quality === 'medium' ? 5 : 4;
  const trunkGeo = new THREE.CylinderGeometry(0.42, 0.5, 1, sides, 1, true).translate(0, 0.5, 0);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  const none: TreeLooks = { bark: null, leaves: null };

  // Each tree's crown, trunk and billboard matrices and its tint, once: a tree's colour varies a little
  // from its kind's, by where it stands.
  const n = trees.length, crownM = new Float32Array(n * 16), trunkM = new Float32Array(n * 16), farM = new Float32Array(n * 16), tint = new Float32Array(n * 3);
  // And where its trunk's top is in its crown's units, where its limbs start (on Ultra).
  const trunkTop = new Float32Array(n * 3), top = new THREE.Vector3();
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
    top.set(t.x + dx * k - t.cx, t.y - 0.3 + th - (t.y + t.foot), t.z + dz * k - t.cz).applyQuaternion(q.clone().invert()).divide(new THREE.Vector3(t.crown, ch, t.crown));
    trunkTop.set([top.x, top.y, top.z], i * 3);
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

  const nearMeshes: { kind: MapTreeKind; crowns: THREE.InstancedMesh; trunks: THREE.InstancedMesh; limbs: THREE.InstancedMesh | null; max: number }[] = [];
  for (const kind of CITY_KINDS) {
    const all = trees.filter((t) => t.kind === kind);
    if (!all.length) continue;
    const look = looks[kind] ?? none, s = SHAPES[kind], fixed = kind === 'palm' ? 0 : 1;
    const geo = kind === 'palm' ? palmCrown(cardsOf(kind)) : cardCrown(kind, cardsOf(kind));
    const crownMat = new THREE.MeshStandardMaterial({ color: look.leaves ? s.green : '#4f6b33', map: look.leaves, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
    const wind = ultra ? { TREE_WIND: '' } : {};
    // On Ultra a deciduous kind's crowns in their season, and their shadows with them (task 093).
    const season = ultra && SEASONAL.includes(kind) ? seasonUniforms(look, s.green, DAY) : null;
    const seasonal = season ? { TREE_SEASON: '' } : {};
    crownMat.defines = { ...wind, ...seasonal, ...(season ? { TREE_LIT: '' } : {}) };
    crownMat.onBeforeCompile = (sh) => {
      crownVertex(sh, s.card, fixed);
      nearFragment(sh, near);
      if (season) seasonFragment(sh, season);
    };
    crownMat.customProgramCacheKey = () => `crown-${kind}`;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: look.leaves, alphaTest: 0.5, side: THREE.DoubleSide });
    depth.defines = { ...wind, ...seasonal };
    depth.onBeforeCompile = (sh) => {
      crownVertex(sh, s.card, fixed);
      if (season) seasonFragment(sh, season);
    };
    depth.customProgramCacheKey = () => `crown-depth-${kind}`;
    const trunkMat = new THREE.MeshStandardMaterial({ color: look.bark ? '#ffffff' : '#5e4630', map: look.bark, roughness: 1, normalMap: look.barkRelief?.normal ?? null, roughnessMap: look.barkRelief?.roughness ?? null });
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
    // On Ultra a deciduous crown's limbs, in its bark, from up its trunk out into its leaves.
    let limbs: THREE.InstancedMesh | null = null;
    if (ultra && DECIDUOUS.includes(kind)) {
      const limbMat = new THREE.MeshStandardMaterial({ color: look.bark ? '#ffffff' : '#5e4630', map: look.bark, roughness: 1, side: THREE.DoubleSide });
      limbMat.defines = { ...wind };
      limbMat.onBeforeCompile = (sh) => {
        limbVertex(sh, LIMB);
        nearFragment(sh, near);
      };
      limbMat.customProgramCacheKey = () => 'limbs';
      const limbDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
      limbDepth.defines = { ...wind };
      limbDepth.onBeforeCompile = (sh) => limbVertex(sh, LIMB);
      limbDepth.customProgramCacheKey = () => 'limbs-depth';
      const limbGeo = limbGeometry(kind);
      limbGeo.setAttribute('aTrunkTop', new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
      limbs = new THREE.InstancedMesh(limbGeo, limbMat, max);
      limbs.customDepthMaterial = limbDepth;
      limbs.count = 0;
      limbs.frustumCulled = false;
      limbs.castShadow = limbs.receiveShadow = true;
      limbs.instanceMatrix = crowns.instanceMatrix;
      group.add(limbs);
    }
    nearMeshes.push({ kind, crowns, trunks, limbs, max });

    // Far: its billboard, a quad turned to face the camera about the upright, as wide as its tree's crown
    // and as tall as the tree, lit from the sky; none within the near reach but the band they fade over.
    // In its season its colours are baked into it, and it's see-through by its own share of each pixel, as
    // a bare crown's twigs are (task 093).
    const mat = new THREE.MeshStandardMaterial({ color: look.leaves && !season ? s.green : '#ffffff', map: bakeBillboard(kind, geo, trunkGeo, look, all, renderer, season), alphaTest: 0.4, roughness: 0.95, side: THREE.DoubleSide });
    const hashed = season !== null && season.season.value.x < 1;
    if (hashed) mat.defines = { TREE_HASHED: '' };
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
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nif (${NEARNESS} > treeDither()) discard;`)
        .replace('#include <alphatest_fragment>', '#ifdef TREE_HASHED\nfloat hashShare = 1.0 - diffuseColor.a;\nif (diffuseColor.a <= fract(treeDither() * 7.0 + 0.5)) discard;\ndiffuseColor.a = 1.0;\n#endif\n#include <alphatest_fragment>');
      // Its dither resolved in Ultra's frame, by how see-through it is there (task 132).
      if (hashed) dithered(sh, 'hashShare');
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
  let pending: { counts: number[]; limbs: number[] } | null = null;
  const gather = (cx: number, cz: number) => {
    const counts = nearMeshes.map(() => 0), slot = new Map(nearMeshes.map((nm, k) => [nm.kind, k]));
    // The trees with limbs: those gathered before the first cell wholly past LIMB_REACH.
    let limbs: number[] | null = null;
    const reach = R + STEP, ci = Math.floor(cx / CELL_M), cj = Math.floor(cz / CELL_M), span = Math.ceil(reach / CELL_M);
    const order: [number, number, number][] = [];
    for (let i = -span; i <= span; i++) for (let j = -span; j <= span; j++) order.push([Math.hypot(i, j), ci + i, cj + j]);
    order.sort((a, b) => a[0] - b[0]);
    for (const [d, i, j] of order) {
      if (!limbs && (d - Math.SQRT2) * CELL_M > LIMB_REACH) limbs = [...counts];
      for (const t of cells.get(key(i, j)) ?? []) {
        const tr = trees[t];
        if ((tr.x - cx) ** 2 + (tr.z - cz) ** 2 > reach * reach) continue;
        const k = slot.get(tr.kind)!, nm = nearMeshes[k], c = counts[k];
        if (c >= nm.max) continue;
        (nm.crowns.instanceMatrix.array as Float32Array).set(crownM.subarray(t * 16, t * 16 + 16), c * 16);
        (nm.trunks.instanceMatrix.array as Float32Array).set(trunkM.subarray(t * 16, t * 16 + 16), c * 16);
        (nm.crowns.instanceColor!.array as Float32Array).set(tint.subarray(t * 3, t * 3 + 3), c * 3);
        if (nm.limbs) (nm.limbs.geometry.getAttribute('aTrunkTop').array as Float32Array).set(trunkTop.subarray(t * 3, t * 3 + 3), c * 3);
        counts[k] = c + 1;
      }
    }
    for (const nm of nearMeshes) {
      nm.crowns.instanceMatrix.needsUpdate = nm.trunks.instanceMatrix.needsUpdate = true;
      nm.crowns.instanceColor!.needsUpdate = true;
      if (nm.limbs) nm.limbs.geometry.getAttribute('aTrunkTop').needsUpdate = true;
    }
    return { counts, limbs: limbs ?? counts };
  };
  // A mesh with nothing to draw, drawn every frame, which sees where the camera is.
  const watch = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3)), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  watch.frustumCulled = false;
  watch.onBeforeRender = (_r, _s, camera) => {
    if (pending) {
      const { counts, limbs } = pending;
      counts.forEach((c, k) => {
        const nm = nearMeshes[k];
        nm.crowns.count = nm.trunks.count = c;
        if (nm.limbs) nm.limbs.count = limbs[k];
      });
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
function bakeBillboard(kind: MapTreeKind, crownGeo: THREE.BufferGeometry, trunkGeo: THREE.BufferGeometry, look: TreeLooks, trees: CityTree[], renderer: THREE.WebGLRenderer, season: Record<string, THREE.IUniform> | null = null): THREE.Texture {
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
  // In its season (task 093), with its leaves' green and its twigs' own colours baked in.
  const crownMat = new THREE.MeshBasicMaterial({ color: !look.leaves ? '#4f6b33' : season ? s.green : '#ffffff', map: look.leaves, alphaTest: 0.5, side: THREE.DoubleSide });
  if (season) crownMat.defines = { TREE_SEASON: '', TREE_BAKE: '' };
  crownMat.onBeforeCompile = (sh) => {
    crownVertex(sh, s.card, kind === 'palm' ? 0 : 1);
    shade(sh);
    if (season) seasonFragment(sh, season);
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
  // See-through in the leaves' own colour, so the smaller mipmaps fade to it and not to black (in its
  // season, a twig's brown where it's mostly bare).
  renderer.setClearColor(season && season.season.value.x < 0.5 ? '#6b5a48' : look.leaves ? s.green : '#4f6b33', 0);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(was);
  renderer.setClearColor(clear, alpha);
  crownMat.dispose();
  trunkMat.dispose();
  return rt.texture;
}
