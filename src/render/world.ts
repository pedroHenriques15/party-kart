// The first track's world, the cartoon Braga Grand Prix, kept for reference (the game now races
// the Volta dos Amigos, in city.ts): terrain shaped around the road, the Rio Este and its bridges,
// the road (road.ts), lights, and Braga (landmarks.ts, braga.ts, trees.ts).
import * as THREE from 'three';
import { RIVER, RIVER_HALF_W, WATER_Y } from '../track/layout.ts';
import { distanceToRoad, surfacePoint, type Sample, type Track } from '../track/track.ts';
import { buildBraga } from './braga.ts';
import { bake } from './kit.ts';
import { buildLandmarks } from './landmarks.ts';
import { bridge, buildRoad, lamps, runs as runsOf, stringLights } from './road.ts';
import * as tex from './textures.ts';
import { buildTrees } from './trees.ts';

export const X0 = -560;
export const X1 = 960;
export const Z0 = -760;
export const Z1 = 260;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The land without the road: Bom Jesus's hill, the Sameiro's beside it, Tibães's to the west, a
// flat top by Bom Jesus for its lake, and gentle rolls elsewhere.
export const LAKE = { x: 488, z: -478, r: 16 };
function natural(x: number, z: number): number {
  const bump = (cx: number, cz: number, h: number, sx: number, sz: number) =>
    h * Math.exp(-(((x - cx) ** 2) / (2 * sx ** 2) + ((z - cz) ** 2) / (2 * sz ** 2)));
  let h = bump(545, -360, 44, 115, 100) + bump(800, -610, 72, 95, 90) + bump(-380, -500, 30, 120, 110);
  h += 3 * Math.sin(x / 61) * Math.sin(z / 77) * smooth(150, 400, Math.hypot(x - 100, z + 50));
  h += 30 * smooth(320, 680, Math.hypot(x - 200, z + 230)); // hills around the edge
  const lake = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (lake < LAKE.r + 30) h += (38 - h) * (1 - smooth(LAKE.r + 4, LAKE.r + 30, lake)) - (lake < LAKE.r ? 1.6 : 0);
  return h - 0.6;
}

// Metres from (x, z) to the river's middle.
export function riverDistance(x: number, z: number): number {
  let best = Infinity;
  for (let k = 0; k < RIVER.length - 1; k++) {
    const [ax, az] = RIVER[k];
    const [bx, bz] = RIVER[k + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

// The ground's height: the road's own height near it, blending into the land further away; and
// the river's bed cut through all of it.
export function groundHeight(track: Track, x: number, z: number): number {
  const nat = natural(x, z);
  const { d, i } = distanceToRoad(track, x, z);
  let h = nat;
  if (i >= 0) {
    const s = track.samples[i];
    const roadY = s.p.y - Math.abs(s.r.y) * (s.w / 2) - 0.45; // below the lower edge of a banked road
    h = roadY + (nat - roadY) * smooth(1.5, 26, d);
  }
  const rd = riverDistance(x, z);
  if (rd < RIVER_HALF_W + 16) {
    const bed = WATER_Y - 1.8;
    h = Math.min(h, bed + (h - bed) * smooth(RIVER_HALF_W - 3, RIVER_HALF_W + 16, rd));
  }
  return h;
}

export interface World {
  group: THREE.Group;
  update: (t: number) => void;
  ground: (x: number, z: number) => number;
  stage: THREE.Vector3; // where the lobby shows your car
  stageAt: number; // the sample the lobby's camera lines up with
}

export function buildWorld(track: Track): World {
  const group = new THREE.Group();
  const updates: ((t: number) => void)[] = [];
  const ground = (x: number, z: number) => groundHeight(track, x, z);
  const N = track.samples.length;
  const onBridge = (s: Sample) => riverDistance(s.p.x, s.p.z) < RIVER_HALF_W + 9;

  // The ground: grass, earth on the steep bits, pavements in town, mud by the river.
  const W = X1 - X0;
  const D = Z1 - Z0;
  const terrain = new THREE.PlaneGeometry(W, D, Math.round(W / 5), Math.round(D / 5));
  terrain.rotateX(-Math.PI / 2);
  terrain.translate(X0 + W / 2, 0, Z0 + D / 2);
  const tp = terrain.attributes.position;
  for (let k = 0; k < tp.count; k++) tp.setY(k, ground(tp.getX(k), tp.getZ(k)));
  terrain.computeVertexNormals();
  const tn = terrain.attributes.normal;
  const colors: number[] = [];
  const c = new THREE.Color();
  const earth = new THREE.Color('#8a7a5e');
  const noise = (x: number, z: number) => Math.sin(x * 0.043 + Math.sin(z * 0.031) * 2) * Math.cos(z * 0.052 + Math.sin(x * 0.027) * 2);
  for (let k = 0; k < tp.count; k++) {
    const x = tp.getX(k);
    const z = tp.getZ(k);
    const y = tp.getY(k);
    const steep = 1 - tn.getY(k);
    const { d, i } = distanceToRoad(track, x, z);
    const town = i >= 0 && (i < 480 || i > 2300);
    const rd = riverDistance(x, z);
    const n = noise(x, z);
    if (d < 7 && town) c.set('#d8d2c3');
    else if (d < 2.5) c.set('#7d7b72');
    else if (rd < RIVER_HALF_W + 4) c.set('#7a6e55');
    else {
      c.setHSL(0.22 + n * 0.035, 0.42 + n * 0.08, 0.33 + n * 0.05 - Math.max(0, y - 30) * 0.0015);
      if (steep > 0.12) c.lerp(earth, Math.min(1, (steep - 0.12) * 4));
    }
    colors.push(c.r, c.g, c.b);
  }
  terrain.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const groundTex = tex.ground();
  groundTex.repeat.set(W / 10, D / 10);
  const land = new THREE.Mesh(terrain, new THREE.MeshStandardMaterial({ vertexColors: true, map: groundTex, roughness: 0.95 }));
  land.receiveShadow = true;
  group.add(land);

  // The Rio Este: a ribbon of water down its course, rippling.
  {
    const curve = new THREE.CatmullRomCurve3(RIVER.map(([x, z]) => new THREE.Vector3(x, WATER_Y, z)));
    const n = 300;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let k = 0; k <= n; k++) {
      const p = curve.getPointAt(k / n);
      const t = curve.getTangentAt(k / n);
      const side = new THREE.Vector3(-t.z, 0, t.x).normalize().multiplyScalar(RIVER_HALF_W + 4);
      pos.push(p.x - side.x, WATER_Y, p.z - side.z, p.x + side.x, WATER_Y, p.z + side.z);
      uv.push(0, k * 0.35, 1, k * 0.35);
      if (k > 0) {
        const q = k * 2;
        idx.push(q - 2, q, q - 1, q - 1, q, q + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const normal = tex.ripples();
    normal.repeat.set(2, 1);
    const water = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({ color: '#2f6a78', roughness: 0.06, metalness: 0.1, normalMap: normal, normalScale: new THREE.Vector2(0.6, 0.6), side: THREE.DoubleSide }),
    );
    water.receiveShadow = true;
    group.add(water);
    updates.push((t) => normal.offset.set(t * 0.02, -t * 0.12));
  }

  const road = buildRoad(track, onBridge, { start: tex.sign("P. KIDDY'S WHITE PARTY", 'BRAGA GRAND PRIX'), checkpoint: tex.sign('CHECKPOINT', '', '#111318', '#ffe14d', 1024, 160) });
  group.add(road.group);
  updates.push(road.update);
  for (const [a, b] of runsOf(track, onBridge)) group.add(bridge(track, a, b, WATER_Y, RIVER_HALF_W));
  group.add(stringLights(track, [[N - 160, N + 285], [292, 470]]));
  group.add(lamps(track, ground, (s, i) => i >= 480 && i < N - 170 && s.surface !== 'grass' && s.walls));
  group.add(grassTufts(track, ground));

  const lm = buildLandmarks(track, ground);
  group.add(lm.group);
  updates.push(lm.update);
  const braga = buildBraga(track, ground);
  group.add(braga.group);
  updates.push(braga.update);
  group.add(buildTrees(track, ground));

  return { group: bake(group), update: (t) => updates.forEach((u) => u(t)), ground, stage: lm.stage, stageAt: 40 };
}

// Tufts of grass by the road, out of town: thousands of them, instanced.
function grassTufts(track: Track, ground: (x: number, z: number) => number): THREE.InstancedMesh {
  const a = new THREE.PlaneGeometry(1.1, 0.7).translate(0, 0.35, 0).toNonIndexed();
  const b = a.clone().rotateY(Math.PI / 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a.attributes.position.array, ...b.attributes.position.array]), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([...a.attributes.uv.array, ...b.attributes.uv.array]), 2));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  const mat = new THREE.MeshStandardMaterial({ map: tex.grassBlade(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  const N = track.samples.length;
  const mats: THREE.Matrix4[] = [];
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 9000; k++) {
    const i = Math.floor(rnd() * N);
    const s = track.samples[i];
    if (s.surface !== 'asphalt' || i < 480 || i > 2300) continue;
    const side = rnd() < 0.5 ? -1 : 1;
    const p = surfacePoint(s, side * (s.w / 2 + 1.5 + rnd() * 22), 0);
    if (distanceToRoad(track, p.x, p.z).d < 1.2 || riverDistance(p.x, p.z) < RIVER_HALF_W + 3) continue;
    const sc = 0.7 + rnd() * 0.8;
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, ground(p.x, p.z) - 0.05, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 3.14, 0)), new THREE.Vector3(sc, sc, sc)));
  }
  const im = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((m, k) => im.setMatrixAt(k, m));
  return im;
}
