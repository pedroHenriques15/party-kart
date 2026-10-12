// The static world: terrain shaped around the road, the Rio Este and its bridges, the road itself,
// its kerbs and walls, boost pads, gates, lights, and Braga (landmarks.ts, braga.ts, trees.ts).
import * as THREE from 'three';
import { RIVER, RIVER_HALF_W, WATER_Y } from '../track/layout.ts';
import { distanceToRoad, surfacePoint, type Sample, type Track } from '../track/track.ts';
import { buildBraga } from './braga.ts';
import { bake } from './kit.ts';
import { buildLandmarks } from './landmarks.ts';
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

// A strip along the road between two lateral offsets, lifted off the surface by `lift`.
function ribbon(track: Track, from: number, to: number, side: (s: Sample) => [number, number], lift: number, vScale: number): THREE.BufferGeometry {
  const N = track.samples.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let v = 0;
  for (let k = 0; k <= (to - from + N) % N; k++) {
    const s = track.samples[(from + k) % N];
    const [a, b] = side(s);
    const L = surfacePoint(s, a, lift);
    const R = surfacePoint(s, b, lift);
    pos.push(L.x, L.y, L.z, R.x, R.y, R.z);
    uv.push(0, v, 1, v);
    v += 1 / vScale;
    if (k > 0) {
      // Wound to face up, out of the surface.
      const q = k * 2;
      idx.push(q - 2, q - 1, q, q - 1, q + 1, q);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A wall standing on the road's edge, from height a to b.
function wall(track: Track, from: number, to: number, lateral: (s: Sample) => number, a: number, b: number, uScale: number): THREE.BufferGeometry {
  const N = track.samples.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= (to - from + N) % N; k++) {
    const s = track.samples[(from + k) % N];
    const lo = surfacePoint(s, lateral(s), a);
    const hi = surfacePoint(s, lateral(s), b);
    pos.push(lo.x, lo.y, lo.z, hi.x, hi.y, hi.z);
    uv.push(k / uScale, 0, k / uScale, 1);
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
  return g;
}

// Runs of consecutive samples where test holds, as [from, to].
function runs(track: Track, test: (s: Sample, i: number) => boolean): [number, number][] {
  const N = track.samples.length;
  const at = (i: number) => test(track.samples[i], i);
  const out: [number, number][] = [];
  let start = -1;
  // Begin where the test changes, so a run that wraps past the start isn't split.
  let off = 0;
  while (off < N && at(off) === at((off - 1 + N) % N)) off++;
  if (off === N) return at(0) ? [[0, N]] : [];
  for (let k = 0; k <= N; k++) {
    const i = (off + k) % N;
    const on = k < N && at(i);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  }
  return out;
}

export interface World {
  group: THREE.Group;
  update: (t: number) => void;
  ground: (x: number, z: number) => number;
  stage: THREE.Vector3; // where the lobby shows your car
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

  // The road, a mesh per surface.
  const surfaces = { asphalt: tex.asphalt(), cobble: tex.cobble(), grass: tex.grass() };
  const scaleV = { asphalt: 10, cobble: 6, grass: 16 };
  for (const kind of ['asphalt', 'cobble', 'grass'] as const) {
    const mat = new THREE.MeshStandardMaterial({ map: surfaces[kind], roughness: kind === 'asphalt' ? 0.82 : 0.9, metalness: 0 });
    if (kind === 'cobble') surfaces.cobble.repeat.set(2, 1);
    for (const [a, b] of runs(track, (s) => s.surface === kind)) {
      const m = new THREE.Mesh(ribbon(track, a, b, (s) => [-s.w / 2, s.w / 2], 0.02, scaleV[kind]), mat);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // Kerbs, red and white, where the road bends.
  {
    const bend = (i: number) => {
      const a = track.samples[(i - 6 + N) % N].t;
      const b = track.samples[(i + 6) % N].t;
      return Math.abs(Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z)) / 12;
    };
    const kerbMat = new THREE.MeshStandardMaterial({ map: tex.kerb(), roughness: 0.7 });
    for (const [a, b] of runs(track, (s, i) => s.surface === 'asphalt' && bend(i) > 0.012)) {
      for (const side of [-1, 1]) {
        const k = new THREE.Mesh(ribbon(track, a, b, (s) => (side < 0 ? [-s.w / 2, -s.w / 2 + 0.9] : [s.w / 2 - 0.9, s.w / 2]), 0.035, 2), kerbMat);
        k.receiveShadow = true;
        group.add(k);
      }
    }
  }

  // Under the edges, down to the ground, so a raised road doesn't float; but not over the river,
  // where the bridges are.
  const skirtMat = new THREE.MeshStandardMaterial({ color: '#77736b', side: THREE.DoubleSide, roughness: 0.9 });
  for (const [a, b] of runs(track, (s) => !onBridge(s))) {
    for (const side of [-1, 1]) group.add(new THREE.Mesh(wall(track, a, b, (s) => (side * s.w) / 2, -6, 0.02, 20), skirtMat));
  }
  for (const [a, b] of runs(track, onBridge)) group.add(bridge(track, a, b));

  // The walls: white party banners.
  const bannerTex = tex.banner();
  const wallMat = new THREE.MeshStandardMaterial({ map: bannerTex, side: THREE.DoubleSide, roughness: 0.6 });
  for (const [a, b] of runs(track, (s) => s.walls)) {
    for (const side of [-1, 1]) group.add(new THREE.Mesh(wall(track, a, b, (s) => side * (s.w / 2 + 0.15), 0, 1.15, 8), wallMat));
  }

  // Boost pads, their arrows running.
  const boostTex = tex.boost();
  const boostMat = new THREE.MeshBasicMaterial({ map: boostTex, transparent: true, opacity: 0.95 });
  for (const [a, b] of runs(track, (s) => s.boost)) group.add(new THREE.Mesh(ribbon(track, a, b, (s) => [-s.w * 0.3, s.w * 0.3], 0.05, 4), boostMat));
  updates.push((t) => (boostTex.offset.y = -t * 2.5));

  // The start line, and gates at the start and the checkpoints.
  const line = new THREE.Mesh(ribbon(track, N - 2, 1, (s) => [-s.w / 2, s.w / 2], 0.04, 3), new THREE.MeshBasicMaterial({ map: tex.checker() }));
  group.add(line);
  group.add(gate(track, 0, tex.sign("P. KIDDY'S WHITE PARTY", 'BRAGA GRAND PRIX'), 9));
  for (const i of track.checkpoints) group.add(gate(track, i, tex.sign('CHECKPOINT', '', '#111318', '#ffe14d', 1024, 160), 6.5));

  group.add(stringLights(track, [[N - 160, N + 285], [292, 470]]));
  group.add(lamps(track, ground));
  group.add(grassTufts(track, ground));

  const lm = buildLandmarks(track, ground);
  group.add(lm.group);
  updates.push(lm.update);
  const braga = buildBraga(track, ground);
  group.add(braga.group);
  updates.push(braga.update);
  group.add(buildTrees(track, ground));

  return { group: bake(group), update: (t) => updates.forEach((u) => u(t)), ground, stage: lm.stage };
}

// A granite bridge under the road where it crosses the river: a block with an arch through it.
function bridge(track: Track, a: number, b: number): THREE.Group {
  const N = track.samples.length;
  const len = (b - a + N) % N;
  const mid = track.samples[(a + Math.floor(len / 2)) % N];
  const half = len / 2 + 2;
  const top = -0.05;
  const bottom = WATER_Y - 1.5 - mid.p.y;
  const shape = new THREE.Shape();
  shape.moveTo(-half, bottom);
  shape.lineTo(half, bottom);
  shape.lineTo(half, top);
  shape.lineTo(-half, top);
  shape.closePath();
  // A flat (segmental) arch over the water, kept well inside the block.
  const r = Math.min(RIVER_HALF_W + 1, half - 2);
  const spring = WATER_Y - mid.p.y;
  const rise = Math.max(1, top - 0.9 - spring);
  const hole = new THREE.Path();
  hole.moveTo(-r, bottom + 0.3);
  hole.lineTo(r, bottom + 0.3);
  hole.lineTo(r, spring);
  hole.absellipse(0, spring, r, rise, 0, Math.PI, false);
  hole.lineTo(-r, bottom + 0.3);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: mid.w + 0.6, bevelEnabled: false });
  geo.translate(0, 0, -(mid.w + 0.6) / 2);
  const stone = new THREE.MeshStandardMaterial({ map: tex.rock(), color: '#cfc6b6', roughness: 0.9 });
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, stone);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  g.position.set(mid.p.x, mid.p.y, mid.p.z);
  g.rotation.y = -Math.atan2(mid.t.z, mid.t.x);
  return g;
}

// Soft halos round lights: a cloud of glowing points, one draw call.
export function halos(points: THREE.Vector3[], colors: string[], size: number): THREE.Points {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const col = new THREE.Color();
  geo.setAttribute('color', new THREE.Float32BufferAttribute(points.flatMap((_, k) => col.set(colors[k % colors.length]).toArray()), 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size, map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
}

// Strings of party lights across the road, pole to pole, on stretches [from, to].
function stringLights(track: Track, stretches: [number, number][]): THREE.Group {
  const g = new THREE.Group();
  const N = track.samples.length;
  const bulbs: THREE.Vector3[] = [];
  const poles: THREE.Matrix4[] = [];
  const wire: THREE.Vector3[] = [];
  for (const [from, to] of stretches) {
    for (let i = from; i < to; i += 24) {
      const s = track.samples[i % N];
      const L = surfacePoint(s, -s.w / 2 - 1.2, 0);
      const R = surfacePoint(s, s.w / 2 + 1.2, 0);
      for (const p of [L, R]) poles.push(new THREE.Matrix4().makeTranslation(p.x, p.y + 3.6, p.z));
      const n = 18;
      let prev: THREE.Vector3 | null = null;
      for (let k = 0; k <= n; k++) {
        const f = k / n;
        const sag = Math.sin(f * Math.PI) * 1.4;
        const p = new THREE.Vector3(L.x + (R.x - L.x) * f, L.y + (R.y - L.y) * f + 7.2 - sag, L.z + (R.z - L.z) * f);
        if (prev) wire.push(prev, p);
        if (k > 0 && k < n) bulbs.push(p.clone().add(new THREE.Vector3(0, -0.15, 0)));
        prev = p;
      }
    }
  }
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 7.2, 8), new THREE.MeshStandardMaterial({ color: '#2b2b30', metalness: 0.6, roughness: 0.4 }), poles.length);
  poles.forEach((m, k) => pole.setMatrixAt(k, m));
  g.add(pole);
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wire), new THREE.LineBasicMaterial({ color: '#333' })));
  const bulb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), bulbs.length);
  const colors = ['#ffd27a', '#ffffff', '#ff8fd8', '#ffe14d'];
  g.add(halos(bulbs, ['#a8843c', '#8a8a8a', '#a34f8a', '#a8962e'], 1.3));
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  bulbs.forEach((p, k) => {
    bulb.setMatrixAt(k, m.makeTranslation(p.x, p.y, p.z));
    bulb.setColorAt(k, c.set(colors[k % colors.length]));
  });
  g.add(bulb);
  return g;
}

// Street lamps, out of town, on alternate sides.
function lamps(track: Track, ground: (x: number, z: number) => number): THREE.Group {
  const g = new THREE.Group();
  const N = track.samples.length;
  const posts: THREE.Matrix4[] = [];
  const heads: THREE.Matrix4[] = [];
  let side = 1;
  for (let i = 480; i < N - 170; i += 34) {
    const s = track.samples[i];
    if (s.surface === 'grass' || !s.walls) continue;
    side = -side;
    const p = surfacePoint(s, side * (s.w / 2 + 1.6), 0);
    const y = Math.max(ground(p.x, p.z), p.y - 1);
    const yaw = -Math.atan2(s.t.z, s.t.x);
    posts.push(new THREE.Matrix4().makeTranslation(p.x, y + 3.5, p.z));
    const arm = surfacePoint(s, side * (s.w / 2 + 0.2), 0);
    heads.push(new THREE.Matrix4().compose(new THREE.Vector3(arm.x, y + 6.9, arm.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)));
  }
  const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.14, 7, 8), new THREE.MeshStandardMaterial({ color: '#2e3a33', metalness: 0.5, roughness: 0.5 }), posts.length);
  posts.forEach((m, k) => post.setMatrixAt(k, m));
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.22, 0.45), new THREE.MeshBasicMaterial({ color: '#fff4d0', toneMapped: false }), heads.length);
  heads.forEach((m, k) => head.setMatrixAt(k, m));
  g.add(post, head);
  g.add(halos(heads.map((m) => new THREE.Vector3().setFromMatrixPosition(m).add(new THREE.Vector3(0, -0.3, 0))), ['#8a7440'], 4));
  return g;
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

const GATE_PILLAR = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.5 });
const GATE_GOLD = new THREE.MeshStandardMaterial({ color: '#d4af37', roughness: 0.25, metalness: 1 });

// Two pillars and a sign across the road.
function gate(track: Track, i: number, sign: THREE.Texture, height: number): THREE.Group {
  const s = track.samples[i];
  const g = new THREE.Group();
  const pillar = GATE_PILLAR;
  const gold = GATE_GOLD;
  const span = s.w + 2.4;
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1, height + 1.6, 1), pillar);
    p.position.set(0, (height + 1.6) / 2, (side * span) / 2);
    p.castShadow = true;
    g.add(p);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 8), gold);
    cap.position.set(0, height + 2.1, (side * span) / 2);
    g.add(cap);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, span + 1), pillar);
  beam.position.set(0, height + 0.6, 0);
  beam.castShadow = true;
  g.add(beam);
  for (const face of [-1, 1]) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(span, 1.7), new THREE.MeshBasicMaterial({ map: sign, toneMapped: false }));
    board.position.set(face * 0.27, height + 0.6, 0);
    board.rotation.y = face < 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(board);
  }
  const base = surfacePoint(s, 0, 0);
  g.position.set(base.x, base.y, base.z);
  g.rotation.y = -Math.atan2(s.t.z, s.t.x);
  return g;
}
