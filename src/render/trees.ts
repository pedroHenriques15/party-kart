// Trees: purple jacarandas and plane trees down the Avenida, round trees in the lowlands, pines
// on the hills, cypresses by the churches. Instanced, a few draw calls for thousands of trees.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RIVER_HALF_W } from '../track/layout.ts';
import { distanceToRoad, surfacePoint, type Track } from '../track/track.ts';
import { LAKE, riverDistance } from './world.ts';

type Ground = (x: number, z: number) => number;
export type TreeKind = 'round' | 'pine' | 'cypress';
type Kind = TreeKind;

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!;
}

// Each kind: a crown and a trunk, about 1 unit to 8 tall. Plain ones have fewer faces, for
// places with thousands of trees.
function shapes(kind: Kind, plain = false): { crown: THREE.BufferGeometry; trunk: THREE.BufferGeometry } {
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
export function plantTrees(trees: Tree[], TILE = 300, plain = false): THREE.Group {
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
