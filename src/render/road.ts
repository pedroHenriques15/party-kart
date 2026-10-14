// The road itself, whatever the track: its surfaces and the lines painted on it, the kerbs and
// pavements and central reservations beside it, the skirts under its edges, the barriers
// at the start, boost pads, the start line and gates, bridges, and the lights along it.
import * as THREE from 'three';
import { surfacePoint, type Sample, type Track } from '../track/track.ts';
import * as tex from './textures.ts';

// How many samples from `from` to `to`, round the loop; [0, N] is all the way round.
const stretch = (N: number, from: number, to: number) => (to - from === N ? N : (to - from + N) % N);

// A strip along the road between two lateral offsets, lifted off the surface by `lift`. Its
// texture runs a tile every vScale metres along it, and across it from 0 to 1, or a tile every
// uScale metres when that's given.
export function ribbon(track: Track, from: number, to: number, side: (s: Sample) => [number, number], lift: number, vScale: number, uScale = 0): THREE.BufferGeometry {
  const N = track.samples.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let v = 0;
  for (let k = 0; k <= stretch(N, from, to); k++) {
    const s = track.samples[(from + k) % N];
    const [a, b] = side(s);
    const L = surfacePoint(s, a, lift);
    const R = surfacePoint(s, b, lift);
    pos.push(L.x, L.y, L.z, R.x, R.y, R.z);
    if (uScale) uv.push(a / uScale, v, b / uScale, v);
    else uv.push(0, v, 1, v);
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

// A strip along the road between two lateral offsets, each at a height of its own (in the world,
// not off the surface): edge(s) gives [left offset, its height, right offset, its height]. Its
// texture runs across a tile every uScale metres and along a tile every vScale metres.
export function band(track: Track, from: number, to: number, edge: (s: Sample) => [number, number, number, number], vScale: number, uScale: number): THREE.BufferGeometry {
  const N = track.samples.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let v = 0;
  for (let k = 0; k <= stretch(N, from, to); k++) {
    const s = track.samples[(from + k) % N];
    const [a, ya, b, yb] = edge(s);
    const L = surfacePoint(s, a, 0);
    const R = surfacePoint(s, b, 0);
    pos.push(L.x, ya, L.z, R.x, yb, R.z);
    uv.push(a / uScale, v, b / uScale, v);
    v += 1 / vScale;
    if (k > 0) {
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

// A wall at a lateral offset from the road's centre, between two heights in the world that
// heights(s) gives, its texture a tile every uScale metres along and up.
export function wallBetween(track: Track, from: number, to: number, lateral: (s: Sample) => number, heights: (s: Sample) => [number, number], uScale: number): THREE.BufferGeometry {
  const N = track.samples.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= stretch(N, from, to); k++) {
    const s = track.samples[(from + k) % N];
    const p = surfacePoint(s, lateral(s), 0);
    const [lo, hi] = heights(s);
    pos.push(p.x, lo, p.z, p.x, hi, p.z);
    uv.push(k / uScale, lo / uScale, k / uScale, hi / uScale);
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

// A wall standing on the road's edge, from height a to b.
export function wall(track: Track, from: number, to: number, lateral: (s: Sample) => number, a: number, b: number, uScale: number): THREE.BufferGeometry {
  const N = track.samples.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= stretch(N, from, to); k++) {
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
export function runs(track: Track, test: (s: Sample, i: number) => boolean): [number, number][] {
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

export interface RoadSigns {
  start: THREE.Texture;
  checkpoint: THREE.Texture;
}

// What's at the back of one side of the road at a sample (k: 0 left, 1 right): the height its
// paving ends at, beyond the pavement or the reservation (or at the road's edge, with neither), and
// the height of the ground just beyond.
export type Edges = (s: Sample, k: 0 | 1) => { y: number; ground: number };

// The road and everything on it. `overWater` marks the samples on bridges over water, which get no
// skirt. With `edges`, each pavement slopes to meet the ground at its back, as a real one does,
// and the road's sides meet the ground: a retaining wall up to it where it's higher, a skirt down
// to it where it's lower, and on a bridge a deck. Without, the pavements are level with the kerb
// and a skirt hangs 6 m down from every edge, for ground that's been made level with the road.
export function buildRoad(track: Track, overWater: (s: Sample) => boolean, signs: RoadSigns, edges?: Edges): { group: THREE.Group; update: (t: number) => void } {
  const group = new THREE.Group();
  const updates: ((t: number) => void)[] = [];
  const N = track.samples.length;

  // The road, a mesh per surface.
  const surfaces = { asphalt: tex.asphalt(), cobble: tex.setts(), grass: tex.grass() };
  for (const kind of ['asphalt', 'cobble', 'grass'] as const) {
    const mat = new THREE.MeshStandardMaterial({ map: surfaces[kind], roughness: kind === 'asphalt' ? 0.82 : 0.9, metalness: 0 });
    for (const [a, b] of runs(track, (s) => s.surface === kind)) {
      const m = new THREE.Mesh(kind === 'asphalt' ? ribbon(track, a, b, (s) => [-s.w / 2, s.w / 2], 0.02, 10) : ribbon(track, a, b, (s) => [-s.w / 2, s.w / 2], 0.02, 2, 2), mat);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // The lines painted on it, white, as the street has them: lanes dashed, and a solid line down
  // the middle of a two-way road of four lanes or more.
  {
    const dashed = new THREE.MeshStandardMaterial({ map: tex.dash(), transparent: true, alphaTest: 0.4, roughness: 0.6 });
    const solid = new THREE.MeshStandardMaterial({ color: '#efefe8', roughness: 0.6 });
    for (const [a, b] of runs(track, (s) => s.lanes !== 0 && s.lanes !== 1 && s.lanes !== -1)) {
      // A run with the same lanes all along it.
      let from = a;
      const len = stretch(N, a, b);
      for (let k = 1; k <= len; k++) {
        const i = (a + k) % N;
        if (k < len && track.samples[i].lanes === track.samples[from].lanes) continue;
        const lanes = track.samples[from].lanes;
        const n = Math.abs(lanes);
        for (let j = 1; j < n; j++) {
          const middle = lanes > 0 && n >= 4 && j === n / 2;
          const at = (s: Sample): [number, number] => {
            const x = -s.w / 2 + (s.w * j) / n;
            return [x - 0.07, x + 0.07];
          };
          group.add(new THREE.Mesh(ribbon(track, from, i, at, 0.03, 7), middle ? solid : dashed));
        }
        from = i;
      }
    }
  }

  // Beyond each edge: a pavement of calçada behind a granite kerb, a central reservation, or
  // nothing; then what meets the ground beyond, as `edges` has it (see above). Bridges get a
  // parapet instead.
  {
    const KERB = 0.15;
    const graniteTex = tex.granite();
    const granite = new THREE.MeshStandardMaterial({ map: graniteTex, roughness: 0.85, side: THREE.DoubleSide });
    const paving = new THREE.MeshStandardMaterial({ map: tex.calcada(), roughness: 0.8 });
    const verge = new THREE.MeshStandardMaterial({ map: tex.ground(), roughness: 0.95 });
    const skirtMat = new THREE.MeshStandardMaterial({ color: '#77736b', side: THREE.DoubleSide, roughness: 0.9 });
    const bridged = (s: Sample) => overWater(s) || s.bridge;
    for (const [k, side] of [[0, -1], [1, 1]] as const) {
      const edge = (s: Sample) => (side * s.w) / 2;
      const out = (s: Sample) => side * (s.w / 2 + Math.abs(s.kerbs[k]));
      const span = (s: Sample, a: number, b: number): [number, number] => (side < 0 ? [-(s.w / 2 + b), -(s.w / 2 + a)] : [s.w / 2 + a, s.w / 2 + b]);
      // The kerb, wherever there's something beyond the edge.
      for (const [a, b] of runs(track, (s) => s.kerbs[k] !== 0)) {
        group.add(new THREE.Mesh(wall(track, a, b, edge, 0, KERB, 1), granite));
        group.add(new THREE.Mesh(ribbon(track, a, b, (s) => span(s, 0, 0.25), KERB, 1, 1), granite));
      }
      // Pavements: from the kerb's back to the outer edge, at the height `edges` gives there.
      for (const [a, b] of runs(track, (s) => s.kerbs[k] > 0)) {
        const back = (s: Sample): [number, number, number, number] => {
          const inner = surfacePoint(s, side * (s.w / 2 + 0.25), KERB).y;
          const outer = edges && !bridged(s) ? edges(s, k).y : surfacePoint(s, side * (s.w / 2 + s.kerbs[k]), KERB).y;
          return side < 0 ? [-(s.w / 2 + s.kerbs[k]), outer, -(s.w / 2 + 0.25), inner] : [s.w / 2 + 0.25, inner, s.w / 2 + s.kerbs[k], outer];
        };
        const m = new THREE.Mesh(band(track, a, b, back, 2.5, 2.5), paving);
        m.receiveShadow = true;
        group.add(m);
      }
      // Central reservations: grass when there's room, setts when not, a kerb either side.
      for (const [a, b] of runs(track, (s) => s.kerbs[k] < 0)) {
        group.add(new THREE.Mesh(ribbon(track, a, b, (s) => span(s, 0.25, -s.kerbs[k] - 0.25), KERB, 2, 2), track.samples[a].kerbs[k] < -2 ? verge : paving));
        group.add(new THREE.Mesh(ribbon(track, a, b, (s) => span(s, -s.kerbs[k] - 0.25, -s.kerbs[k]), KERB, 1, 1), granite));
        if (!edges) group.add(new THREE.Mesh(wall(track, a, b, out, -0.6, KERB, 1), granite));
      }
      if (edges) {
        // Where the side meets the ground: a retaining wall of granite up to it where the ground is
        // higher, a skirt down to it where it's lower.
        const at = (s: Sample) => (s.kerbs[k] === 0 ? edge(s) : out(s));
        const higher = (s: Sample) => edges(s, k).ground > edges(s, k).y + 0.15;
        const span2 = (s: Sample): [number, number] => {
          const e = edges(s, k);
          return [Math.min(e.y, e.ground) - 0.4, Math.max(e.y, e.ground)];
        };
        for (const [a, b] of runs(track, (s) => !bridged(s) && higher(s))) group.add(new THREE.Mesh(wallBetween(track, a, b, at, span2, 1.6), granite));
        for (const [a, b] of runs(track, (s) => !bridged(s) && !higher(s))) group.add(new THREE.Mesh(wallBetween(track, a, b, at, span2, 20), skirtMat));
        // A bridge over a road: its deck, a metre and more deep, under the road and the pavements.
        for (const [a, b] of runs(track, (s) => s.bridge && !overWater(s))) {
          const outer = (s: Sample) => side * (s.w / 2 + Math.max(0.3, s.kerbs[k]));
          group.add(new THREE.Mesh(wall(track, a, b, outer, -1.3, KERB, 20), skirtMat));
          if (k === 0) group.add(new THREE.Mesh(ribbon(track, a, b, (s) => [s.w / 2 + Math.max(0.3, s.kerbs[1]), -(s.w / 2 + Math.max(0.3, s.kerbs[0]))], -1.3, 20, 20), skirtMat));
        }
      } else {
        for (const [a, b] of runs(track, (s) => s.kerbs[k] > 0 && !overWater(s))) group.add(new THREE.Mesh(wall(track, a, b, out, -6, KERB, 20), skirtMat));
        // Nothing beyond: the skirt at the edge itself.
        for (const [a, b] of runs(track, (s) => s.kerbs[k] === 0 && !overWater(s))) group.add(new THREE.Mesh(wall(track, a, b, edge, -6, 0.02, 20), skirtMat));
      }
      // Parapets on the bridges.
      for (const [a, b] of runs(track, (s) => (edges ? bridged(s) : overWater(s)))) {
        const outer = (s: Sample) => side * (s.w / 2 + Math.max(0.3, s.kerbs[k]));
        group.add(new THREE.Mesh(wall(track, a, b, outer, -0.5, 1.1, 2), granite));
        group.add(new THREE.Mesh(ribbon(track, a, b, (s) => (side < 0 ? [outer(s) - 0.35, outer(s)] : [outer(s), outer(s) + 0.35]), 1.1, 1, 1), granite));
      }
    }
  }

  // The barriers along the kerbs at the start, white and blue with the race's name.
  const wallMat = new THREE.MeshStandardMaterial({ map: tex.banner(), side: THREE.DoubleSide, roughness: 0.6 });
  for (const [a, b] of runs(track, (_s, i) => i < 160 || i > N - 160)) {
    for (const side of [-1, 1]) group.add(new THREE.Mesh(wall(track, a, b, (s) => side * (s.w / 2 + 0.4), 0.15, 1.3, 8), wallMat));
  }

  // Boost pads, their arrows running.
  const boostTex = tex.boost();
  const boostMat = new THREE.MeshBasicMaterial({ map: boostTex, transparent: true, opacity: 0.95 });
  for (const [a, b] of runs(track, (s) => s.boost)) group.add(new THREE.Mesh(ribbon(track, a, b, (s) => [-s.w * 0.3, s.w * 0.3], 0.05, 4), boostMat));
  updates.push((t) => (boostTex.offset.y = -t * 2.5));

  // The start line, and gates at the start and the checkpoints.
  group.add(new THREE.Mesh(ribbon(track, N - 2, 1, (s) => [-s.w / 2, s.w / 2], 0.04, 3), new THREE.MeshBasicMaterial({ map: tex.checker() })));
  group.add(gate(track, 0, signs.start, 9));
  for (const i of track.checkpoints) group.add(gate(track, i, signs.checkpoint, 6.5));

  return { group, update: (t) => updates.forEach((u) => u(t)) };
}

// A granite bridge under the road where it crosses water: a block with an arch through it.
export function bridge(track: Track, a: number, b: number, waterY: number, halfW: number): THREE.Group {
  const N = track.samples.length;
  const len = (b - a + N) % N;
  const mid = track.samples[(a + Math.floor(len / 2)) % N];
  const half = len / 2 + 2;
  const top = -0.05;
  const bottom = waterY - 1.5 - mid.p.y;
  const shape = new THREE.Shape();
  shape.moveTo(-half, bottom);
  shape.lineTo(half, bottom);
  shape.lineTo(half, top);
  shape.lineTo(-half, top);
  shape.closePath();
  // A flat (segmental) arch over the water, kept well inside the block.
  const r = Math.min(halfW + 1, half - 2);
  const spring = waterY - mid.p.y;
  const rise = Math.max(1, top - 0.9 - spring);
  const hole = new THREE.Path();
  hole.moveTo(-r, bottom + 0.3);
  hole.lineTo(r, bottom + 0.3);
  hole.lineTo(r, spring);
  hole.absellipse(0, spring, r, rise, 0, Math.PI, false);
  hole.lineTo(-r, bottom + 0.3);
  shape.holes.push(hole);
  const width = mid.w + Math.max(0.3, mid.kerbs[0]) + Math.max(0.3, mid.kerbs[1]) + 0.6;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geo.translate(0, 0, -width / 2 + (Math.max(0.3, mid.kerbs[1]) - Math.max(0.3, mid.kerbs[0])) / 2);
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

// Strings of lights across the road, pole to pole, on stretches [from, to].
export function stringLights(track: Track, stretches: [number, number][]): THREE.Group {
  const g = new THREE.Group();
  const N = track.samples.length;
  const bulbs: THREE.Vector3[] = [];
  const poles: THREE.Matrix4[] = [];
  const wire: THREE.Vector3[] = [];
  for (const [from, to] of stretches) {
    for (let i = from; i < to; i += 24) {
      const s = track.samples[((i % N) + N) % N];
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

// Street lamps on alternate sides, every `every` samples where `where` says so.
export function lamps(track: Track, ground: (x: number, z: number) => number, where: (s: Sample, i: number) => boolean, every = 34): THREE.Group {
  const g = new THREE.Group();
  const N = track.samples.length;
  const posts: THREE.Matrix4[] = [];
  const heads: THREE.Matrix4[] = [];
  let side = 1;
  for (let i = 0; i < N; i += every) {
    const s = track.samples[i];
    if (!where(s, i)) continue;
    side = -side;
    const k = side < 0 ? 0 : 1;
    const off = s.kerbs[k] > 0.8 ? 0.55 : s.kerbs[k] < -1 ? -s.kerbs[k] / 2 : 1.4;
    const p = surfacePoint(s, side * (s.w / 2 + off), 0);
    const y = s.kerbs[k] !== 0 ? p.y + 0.15 : Math.max(ground(p.x, p.z), p.y - 1);
    const yaw = -Math.atan2(s.t.z, s.t.x);
    posts.push(new THREE.Matrix4().makeTranslation(p.x, y + 3.5, p.z));
    const arm = surfacePoint(s, side * (s.w / 2 + off - 1.8), 0);
    heads.push(new THREE.Matrix4().compose(new THREE.Vector3(arm.x, y + 6.9, arm.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)));
  }
  const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.14, 7, 8), new THREE.MeshStandardMaterial({ color: '#2e3a33', metalness: 0.5, roughness: 0.5 }), posts.length);
  posts.forEach((m, k) => post.setMatrixAt(k, m));
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.22, 0.45), new THREE.MeshBasicMaterial({ color: '#fff4d0', toneMapped: false }), heads.length);
  heads.forEach((m, k) => head.setMatrixAt(k, m));
  for (const im of [post, head]) im.computeBoundingSphere();
  g.add(post, head);
  g.add(halos(heads.map((m) => new THREE.Vector3().setFromMatrixPosition(m).add(new THREE.Vector3(0, -0.3, 0))), ['#8a7440'], 4));
  return g;
}

const GATE_PILLAR = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.5 });
const GATE_FINIAL = new THREE.MeshStandardMaterial({ color: '#a49d90', roughness: 0.85 });

// Two pillars and a sign across the road.
export function gate(track: Track, i: number, sign: THREE.Texture, height: number): THREE.Group {
  const s = track.samples[i];
  const g = new THREE.Group();
  const span = s.w + 2.4;
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1, height + 1.6, 1), GATE_PILLAR);
    p.position.set(0, (height + 1.6) / 2, (side * span) / 2);
    p.castShadow = true;
    g.add(p);
    // A granite ball on top, as on Braga's gateposts.
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 8), GATE_FINIAL);
    cap.position.set(0, height + 2.1, (side * span) / 2);
    g.add(cap);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, span + 1), GATE_PILLAR);
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
