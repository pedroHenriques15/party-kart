// The static world: terrain shaped around the road, the road itself, its walls, boost pads,
// gates, and Braga (landmarks.ts).
import * as THREE from 'three';
import { distanceToRoad, surfacePoint, type Sample, type Track } from '../track/track.ts';
import { buildLandmarks } from './landmarks.ts';
import * as tex from './textures.ts';

export const X0 = -480;
export const X1 = 900;
export const Z0 = -720;
export const Z1 = 260;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The land without the road: Bom Jesus's hill, and gentle rolls elsewhere.
function natural(x: number, z: number): number {
  const hill = 44 * Math.exp(-(((x - 545) ** 2) / (2 * 115 ** 2) + ((z + 360) ** 2) / (2 * 100 ** 2)));
  const roll = 3 * Math.sin(x / 61) * Math.sin(z / 77) * smooth(150, 400, Math.hypot(x - 100, z + 50));
  const rim = 30 * smooth(300, 650, Math.hypot(x - 200, z + 230)); // hills around the edge
  return hill + roll + rim - 0.6;
}

// The ground's height: the road's own height near it, blending into the land further away.
export function groundHeight(track: Track, x: number, z: number): number {
  const nat = natural(x, z);
  const { d, i } = distanceToRoad(track, x, z);
  if (i < 0) return nat;
  const s = track.samples[i];
  const roadY = s.p.y - Math.abs(s.r.y) * (s.w / 2) - 0.45; // below the lower edge of a banked road
  return roadY + (nat - roadY) * smooth(1.5, 26, d);
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
function runs(track: Track, test: (s: Sample) => boolean): [number, number][] {
  const N = track.samples.length;
  const out: [number, number][] = [];
  let start = -1;
  // Begin where the test changes, so a run that wraps past the start isn't split.
  let off = 0;
  while (off < N && test(track.samples[off]) === test(track.samples[(off - 1 + N) % N])) off++;
  if (off === N) return test(track.samples[0]) ? [[0, N]] : [];
  for (let k = 0; k <= N; k++) {
    const i = (off + k) % N;
    const on = k < N && test(track.samples[i]);
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

  // Sky, fog and light.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {},
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'varying vec3 vP; void main(){ float h = max(vP.y, 0.0); vec3 top = vec3(0.30,0.55,0.92); vec3 hor = vec3(0.86,0.90,0.96); gl_FragColor = vec4(mix(hor, top, pow(h, 0.55)), 1.0); }',
    }),
  );
  group.add(sky);

  // The ground.
  const W = X1 - X0;
  const D = Z1 - Z0;
  const terrain = new THREE.PlaneGeometry(W, D, Math.round(W / 5), Math.round(D / 5));
  terrain.rotateX(-Math.PI / 2);
  terrain.translate(X0 + W / 2, 0, Z0 + D / 2);
  const tp = terrain.attributes.position;
  const colors: number[] = [];
  const c = new THREE.Color();
  for (let k = 0; k < tp.count; k++) {
    const x = tp.getX(k);
    const z = tp.getZ(k);
    const y = groundHeight(track, x, z);
    tp.setY(k, y);
    const { d, i } = distanceToRoad(track, x, z);
    const town = i >= 0 && (i < 480 || i > 2300);
    if (d < 7 && town) c.set('#d9d3c5'); // pavements, in town
    else if (d < 3) c.set('#8a8d80');
    else c.setHSL(0.24 + Math.sin(x * 0.05) * 0.02, 0.35, 0.36 + Math.sin(z * 0.07 + x * 0.03) * 0.04 - Math.max(0, y - 25) * 0.002);
    colors.push(c.r, c.g, c.b);
  }
  terrain.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  terrain.computeVertexNormals();
  const groundTex = tex.ground();
  groundTex.repeat.set(W / 12, D / 12);
  const ground = new THREE.Mesh(terrain, new THREE.MeshLambertMaterial({ vertexColors: true, map: groundTex }));
  ground.receiveShadow = true;
  group.add(ground);

  // The road, a mesh per surface.
  const surfaces = { asphalt: tex.asphalt(), cobble: tex.cobble(), grass: tex.grass() };
  const scaleV = { asphalt: 10, cobble: 6, grass: 16 };
  for (const kind of ['asphalt', 'cobble', 'grass'] as const) {
    const mat = new THREE.MeshStandardMaterial({ map: surfaces[kind], roughness: 0.92, metalness: 0 });
    if (kind === 'cobble') surfaces.cobble.repeat.set(2, 1);
    for (const [a, b] of runs(track, (s) => s.surface === kind)) {
      const m = new THREE.Mesh(
        ribbon(track, a, b, (s) => [-s.w / 2, s.w / 2], 0.02, scaleV[kind]),
        mat,
      );
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // Under the edges, down to the ground, so a raised road doesn't float.
  const skirtMat = new THREE.MeshLambertMaterial({ color: '#5d5a55', side: THREE.DoubleSide });
  for (const side of [-1, 1]) group.add(new THREE.Mesh(wall(track, 0, track.samples.length, (s) => (side * s.w) / 2, -6, 0.02, 20), skirtMat));

  // The walls: white party banners.
  const bannerTex = tex.banner();
  const wallMat = new THREE.MeshStandardMaterial({ map: bannerTex, side: THREE.DoubleSide, roughness: 0.6 });
  for (const [a, b] of runs(track, (s) => s.walls)) {
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(wall(track, a, b, (s) => side * (s.w / 2 + 0.15), 0, 1.15, 8), wallMat);
      m.castShadow = false;
      group.add(m);
    }
  }

  // Boost pads, their arrows running.
  const boostTex = tex.boost();
  const boostMat = new THREE.MeshBasicMaterial({ map: boostTex, transparent: true, opacity: 0.95 });
  for (const [a, b] of runs(track, (s) => s.boost)) group.add(new THREE.Mesh(ribbon(track, a, b, (s) => [-s.w * 0.3, s.w * 0.3], 0.05, 4), boostMat));
  updates.push((t) => (boostTex.offset.y = -t * 2.5));

  // The start line, and gates at the start and the checkpoints.
  const line = new THREE.Mesh(ribbon(track, track.samples.length - 2, 1, (s) => [-s.w / 2, s.w / 2], 0.04, 3), new THREE.MeshBasicMaterial({ map: tex.checker() }));
  group.add(line);
  group.add(gate(track, 0, tex.sign("P. KIDDY'S WHITE PARTY", 'BRAGA GRAND PRIX'), 9));
  for (const i of track.checkpoints) group.add(gate(track, i, tex.sign('CHECKPOINT', '', '#111318', '#ffe14d', 1024, 160), 6.5));

  const lm = buildLandmarks(track, (x, z) => groundHeight(track, x, z));
  group.add(lm.group);
  updates.push(lm.update);

  return { group, update: (t) => updates.forEach((u) => u(t)), ground: (x, z) => groundHeight(track, x, z), stage: lm.stage };
}

// Two pillars and a sign across the road.
function gate(track: Track, i: number, sign: THREE.Texture, height: number): THREE.Group {
  const s = track.samples[i];
  const g = new THREE.Group();
  const pillar = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.5 });
  const gold = new THREE.MeshStandardMaterial({ color: '#d4af37', roughness: 0.3, metalness: 0.8 });
  const span = s.w + 2.4;
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1, height + 1.6, 1), pillar);
    p.position.set(0, (height + 1.6) / 2, (side * span) / 2);
    g.add(p);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 8), gold);
    cap.position.set(0, height + 2.1, (side * span) / 2);
    g.add(cap);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, span + 1), pillar);
  beam.position.set(0, height + 0.6, 0);
  g.add(beam);
  for (const face of [-1, 1]) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(span, 1.7), new THREE.MeshBasicMaterial({ map: sign }));
    board.position.set(face * 0.27, height + 0.6, 0);
    board.rotation.y = face < 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(board);
  }
  const base = surfacePoint(s, 0, 0);
  g.position.set(base.x, base.y, base.z);
  g.rotation.y = -Math.atan2(s.t.z, s.t.x);
  return g;
}
