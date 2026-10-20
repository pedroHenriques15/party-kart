// What the race adds to the streets (raceMarks): the start line, the gates at the start and the
// checkpoints, the boost pads and the barriers at the start, laid on the streets as they're drawn
// (streets.ts). And the first track's road (buildRoad), which had no streets under it: its surfaces
// and the lines painted on them, the kerbs and pavements and central reservations beside it, the
// skirts under its edges, bridges, and the lights along it.
import * as THREE from 'three';
import type { V } from '../math.ts';
import { surfacePoint, type Ramp, type Sample, type Track } from '../track/track.ts';
import * as tex from './textures.ts';

// How many samples from `from` to `to`, round the loop; [0, N] is all the way round.
const stretch = (N: number, from: number, to: number) => (to - from === N ? N : (to - from + N) % N);

// The height of what's under a point, where something laid along the road stands on the streets as
// they're drawn rather than on the track's own surface.
export type At = (x: number, z: number) => number;

// A strip along the road between two lateral offsets, lifted off the surface by `lift` (off what
// `at` says is under it, given that). Its texture runs a tile every vScale metres along it, and
// across it from 0 to 1, or a tile every uScale metres when that's given.
export function ribbon(track: Track, from: number, to: number, side: (s: Sample) => [number, number], lift: number, vScale: number, uScale = 0, at?: At): THREE.BufferGeometry {
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
    pos.push(L.x, at ? at(L.x, L.z) + lift : L.y, L.z, R.x, at ? at(R.x, R.z) + lift : R.y, R.z);
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

// A wall standing on the road's edge (or on what `at` says is under it), from height a to b.
export function wall(track: Track, from: number, to: number, lateral: (s: Sample) => number, a: number, b: number, uScale: number, at?: At): THREE.BufferGeometry {
  const N = track.samples.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= stretch(N, from, to); k++) {
    const s = track.samples[(from + k) % N];
    const lo = surfacePoint(s, lateral(s), a);
    const hi = surfacePoint(s, lateral(s), b);
    if (at) {
      const y = at(lo.x, lo.z);
      lo.y = y + a;
      hi.y = y + b;
    }
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
  // The barriers' boards at the start, with the race's name; the first track's are tex.banner()'s.
  banner?: THREE.Texture;
}

// The first track's road and everything on it. `overWater` marks the samples on bridges over
// water, which get no skirt. Its pavements are level with the kerb and a skirt hangs 6 m down from
// every edge, for ground that's been made level with the road.
export function buildRoad(track: Track, overWater: (s: Sample) => boolean, signs: RoadSigns): { group: THREE.Group; update: (t: number) => void } {
  const N = track.samples.length;

  // The road, a mesh per surface.
  const group = new THREE.Group();
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
  // nothing; and a skirt under it. Bridges get a parapet instead.
  {
    const KERB = 0.15;
    const granite = new THREE.MeshStandardMaterial({ map: tex.granite(), roughness: 0.85, side: THREE.DoubleSide });
    const paving = new THREE.MeshStandardMaterial({ map: tex.calcada(), roughness: 0.8 });
    const verge = new THREE.MeshStandardMaterial({ map: tex.ground(), roughness: 0.95 });
    const skirtMat = new THREE.MeshStandardMaterial({ color: '#77736b', side: THREE.DoubleSide, roughness: 0.9 });
    for (const [k, side] of [[0, -1], [1, 1]] as const) {
      const edge = (s: Sample) => (side * s.w) / 2;
      const out = (s: Sample) => side * (s.w / 2 + Math.abs(s.kerbs[k]));
      const span = (s: Sample, a: number, b: number): [number, number] => (side < 0 ? [-(s.w / 2 + b), -(s.w / 2 + a)] : [s.w / 2 + a, s.w / 2 + b]);
      // The kerb, wherever there's something beyond the edge.
      for (const [a, b] of runs(track, (s) => s.kerbs[k] !== 0)) {
        group.add(new THREE.Mesh(wall(track, a, b, edge, 0, KERB, 1), granite));
        group.add(new THREE.Mesh(ribbon(track, a, b, (s) => span(s, 0, 0.25), KERB, 1, 1), granite));
      }
      // Pavements: from the kerb's back to the outer edge, level with it.
      for (const [a, b] of runs(track, (s) => s.kerbs[k] > 0)) {
        const m = new THREE.Mesh(ribbon(track, a, b, (s) => span(s, 0.25, s.kerbs[k]), KERB, 2.5, 2.5), paving);
        m.receiveShadow = true;
        group.add(m);
      }
      // Central reservations: grass when there's room, setts when not, a kerb either side.
      for (const [a, b] of runs(track, (s) => s.kerbs[k] < 0)) {
        group.add(new THREE.Mesh(ribbon(track, a, b, (s) => span(s, 0.25, -s.kerbs[k] - 0.25), KERB, 2, 2), track.samples[a].kerbs[k] < -2 ? verge : paving));
        group.add(new THREE.Mesh(ribbon(track, a, b, (s) => span(s, -s.kerbs[k] - 0.25, -s.kerbs[k]), KERB, 1, 1), granite));
        group.add(new THREE.Mesh(wall(track, a, b, out, -0.6, KERB, 1), granite));
      }
      for (const [a, b] of runs(track, (s) => s.kerbs[k] > 0 && !overWater(s))) group.add(new THREE.Mesh(wall(track, a, b, out, -6, KERB, 20), skirtMat));
      // Nothing beyond: the skirt at the edge itself.
      for (const [a, b] of runs(track, (s) => s.kerbs[k] === 0 && !overWater(s))) group.add(new THREE.Mesh(wall(track, a, b, edge, -6, 0.02, 20), skirtMat));
      // Parapets on the bridges.
      for (const [a, b] of runs(track, overWater)) {
        const outer = (s: Sample) => side * (s.w / 2 + Math.max(0.3, s.kerbs[k]));
        group.add(new THREE.Mesh(wall(track, a, b, outer, -0.5, 1.1, 2), granite));
        group.add(new THREE.Mesh(ribbon(track, a, b, (s) => (side < 0 ? [outer(s) - 0.35, outer(s)] : [outer(s), outer(s) + 0.35]), 1.1, 1, 1), granite));
      }
    }
  }

  const marks = raceMarks(track, signs);
  group.add(marks.group);
  return { group, update: marks.update };
}

// What the race adds to the road: the barriers along the kerbs at the start and in rows across the
// side streets (`rows`, braga-map's closures: each a row along its points, [x, y, z]), the boost
// pads, the start line, the gates at the start and the checkpoints, the ramp, and the road works'
// boards round the corner its road takes in at the ramp's landing (`boards`, rows as `rows`). Given
// `at`, laid on what it says is under them (the streets as they're drawn) rather than on the track's
// own surface.
export function raceMarks(track: Track, signs: RoadSigns, at?: At, rows: [number, number, number][][] = [], boards: [number, number, number][][] = []): { group: THREE.Group; update: (t: number) => void } {
  const group = new THREE.Group();
  const updates: ((t: number) => void)[] = [];
  const N = track.samples.length;

  // The barriers along the kerbs at the start, white and blue with the race's name.
  const wallMat = new THREE.MeshStandardMaterial({ map: signs.banner ?? tex.banner(), side: THREE.DoubleSide, roughness: 0.6 });
  for (const [a, b] of runs(track, (_s, i) => i < 160 || i > N - 160)) {
    for (const side of [-1, 1]) group.add(new THREE.Mesh(wall(track, a, b, (s) => side * (s.w / 2 + 0.4), 0.15, 1.3, 8, at), wallMat));
  }
  // And the same across the side streets, and between a road's carriageways where they're drawn as
  // one, where the race's walls are.
  if (rows.length) group.add(new THREE.Mesh(rowWalls(rows, 0.15, 1.3, 8, at), wallMat));

  // Boost pads, their arrows running.
  const boostTex = tex.boost();
  const boostMat = new THREE.MeshBasicMaterial({ map: boostTex, transparent: true, opacity: 0.95 });
  for (const [a, b] of runs(track, (s) => s.boost)) group.add(new THREE.Mesh(ribbon(track, a, b, (s) => [-s.w * 0.3, s.w * 0.3], 0.05, 4, 0, at), boostMat));
  updates.push((t) => (boostTex.offset.y = -t * 2.5));

  // The start line, and gates at the start and the checkpoints.
  group.add(new THREE.Mesh(ribbon(track, N - 2, 1, (s) => [-s.w / 2, s.w / 2], 0.04, 3, 0, at), new THREE.MeshBasicMaterial({ map: tex.checker() })));
  group.add(gate(track, 0, signs.start, 9, at));
  for (const i of track.checkpoints) group.add(gate(track, i, signs.checkpoint, 6.5, at));

  for (const r of track.ramps) group.add(ramp(track, r, at));
  if (boards.length) group.add(works(boards, at));

  return { group, update: (t) => updates.forEach((u) => u(t)) };
}

// Road-works barriers along rows of points [x, y, z] (braga-map's `boards`, its task 057): two
// red-and-white boards on trestles every 2 m or so, as where a street leaves the open world
// (streets.ts), on what `at` says is under them. The race's wall stands along them already.
function works(rows: [number, number, number][][], at?: At): THREE.Group {
  const g = new THREE.Group();
  const boards = new THREE.MeshStandardMaterial({ map: tex.roadworks(), roughness: 0.6, side: THREE.DoubleSide });
  const legs = new THREE.MeshStandardMaterial({ color: '#e9e6df', roughness: 0.6 });
  const every = rows.map((r) => {
    const pts: [number, number, number][] = [];
    for (let k = 1; k < r.length; k++) {
      const [ax, ay, az] = r[k - 1];
      const [bx, by, bz] = r[k];
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 2));
      for (let i = k === 1 ? 0 : 1; i <= n; i++) pts.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, az + ((bz - az) * i) / n]);
    }
    return pts;
  });
  for (const y of [0.5, 0.9]) g.add(new THREE.Mesh(rowWalls(every, y, y + 0.24, 2, at), boards));
  // A trestle at each point, across the row.
  for (const pts of every) {
    pts.forEach(([x, y, z], k) => {
      const [px, , pz] = pts[Math.max(0, k - 1)];
      const [qx, , qz] = pts[Math.min(pts.length - 1, k + 1)];
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.15, 0.6), legs);
      leg.position.set(x, (at ? at(x, z) : y) + 0.575, z);
      leg.rotation.y = -Math.atan2(qz - pz, qx - px);
      g.add(leg);
    });
  }
  return g;
}

// Panels along rows of points [x, y, z], from height a to b over what `at` says is under each point (or
// its own y), their texture a tile every uScale metres along.
function rowWalls(rows: [number, number, number][][], a: number, b: number, uScale: number, at?: At): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const r of rows) {
    let u = 0;
    r.forEach(([x, y, z], k) => {
      if (k) u += Math.hypot(x - r[k - 1][0], z - r[k - 1][2]) / uScale;
      const g = at ? at(x, z) : y;
      const q = pos.length / 3;
      pos.push(x, g + a, z, x, g + b, z);
      uv.push(u, 0, u, 1);
      if (k) idx.push(q - 2, q, q - 1, q - 1, q, q + 1);
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A ramp the race jumps from (braga-map's task 039, the owner's choice): planks up a pile of rubble
// behind an "obras" sign, as if the city's road works had left it there, with the red-and-white boards
// of the race's road-works barriers along its sides. The planks are where the karts drive (the track's
// samples from its foot to its lip); the rubble is only drawn, down to the street under it (`at`).
// Past the lip there's nothing but what's really there.
function ramp(track: Track, r: Ramp, at?: At): THREE.Group {
  const g = new THREE.Group();
  // On the street at its foot (`at`), rising as braga-map planned it: as the race's ground has it
  // (rampSlope in race.ts).
  const F0 = track.samples[r.foot].p, T0 = track.samples[r.lip].p, y0 = at ? at(F0.x, F0.z) : F0.y;
  const F = { ...F0, y: y0 }, T = { ...T0, y: y0 + T0.y - F0.y };
  const L = Math.hypot(T.x - F.x, T.z - F.z), ux = (T.x - F.x) / L, uz = (T.z - F.z) / L, rx = -uz, rz = ux, hw = r.w / 2;
  const base = (x: number, z: number) => (at ? at(x, z) : F.y);
  const P = (p: V, side: number, y = p.y) => new THREE.Vector3(p.x + rx * side * hw, y, p.z + rz * side * hw);
  const quad = (pts: THREE.Vector3[], uvs: number[]) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(pts.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2]);
    geo.computeVertexNormals();
    return geo;
  };
  const slope = Math.hypot(L, T.y - F.y);
  const plankMap = tex.planks();
  plankMap.repeat.set(r.w / 4, 1);
  // The planks, 2 cm over the track's surface, a board every 25 cm up the slope.
  const up = (p: V, side: number) => P(p, side, p.y + 0.02);
  g.add(new THREE.Mesh(quad([up(F, -1), up(F, 1), up(T, 1), up(T, -1)], [0, 0, 1, 0, 1, slope, 0, slope]), new THREE.MeshStandardMaterial({ map: plankMap, roughness: 0.85, side: THREE.DoubleSide })));
  // The rubble under them: its sides and its face under the lip, down to the street.
  const rubble = new THREE.MeshStandardMaterial({ map: tex.rock(), color: '#b9ab98', roughness: 0.95, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const tl = P(T, side), tb = P(T, side, base(tl.x, tl.z)), fb = P(F, side, base(F.x + rx * side * hw, F.z + rz * side * hw));
    g.add(new THREE.Mesh(quad([fb, tb, tl], [0, 0, L / 3, 0, L / 3, (tl.y - tb.y) / 3]), rubble));
  }
  const tL = P(T, -1), tR = P(T, 1);
  g.add(new THREE.Mesh(quad([P(T, -1, base(tL.x, tL.z)), P(T, 1, base(tR.x, tR.z)), tR, tL], [0, 0, r.w / 3, 0, r.w / 3, 1, 0, 1]), rubble));
  // Lumps of it spilling round its foot and under the lip.
  const lumps = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), rubble, 14);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let k = 0; k < 14; k++) {
    const along = k < 8 ? Math.random() * L : L + 0.3 + Math.random() * 0.8, side = k < 8 ? (k % 2 ? 1 : -1) * (hw + 0.2 + Math.random() * 0.5) : (Math.random() * 2 - 1) * hw;
    const x = F.x + ux * along + rx * side, z = F.z + uz * along + rz * side, s = 0.25 + Math.random() * 0.35;
    m.compose(new THREE.Vector3(x, base(x, z) + s * 0.4, z), q.setFromEuler(e.set(Math.random() * 3, Math.random() * 3, Math.random() * 3)), new THREE.Vector3(s, s * 0.7, s));
    lumps.setMatrixAt(k, m);
  }
  g.add(lumps);
  // The road works' boards along its sides, standing on its edges.
  const boards = new THREE.MeshStandardMaterial({ map: tex.roadworks(), roughness: 0.6, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const a = P(F, side * 1.02), b = P(T, side * 1.02);
    g.add(new THREE.Mesh(quad([a, b, new THREE.Vector3(b.x, b.y + 0.3, b.z), new THREE.Vector3(a.x, a.y + 0.3, a.z)], [0, 0, slope / 2, 0, slope / 2, 1, 0, 1]), boards));
  }
  // "Obras", on two posts by its foot, facing the karts coming up to it.
  const sx = F.x - ux * 2 + rx * (hw + 1.2), sz = F.z - uz * 2 + rz * (hw + 1.2), sy = base(sx, sz);
  const sign = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), new THREE.MeshStandardMaterial({ map: tex.sign('OBRAS', '', '#f2c200', '#111318', 512, 256, '#111318'), roughness: 0.5, side: THREE.DoubleSide }));
  plate.position.y = 1.5;
  const post = new THREE.MeshStandardMaterial({ color: '#e9e6df', roughness: 0.6 });
  for (const lx of [-0.55, 0.55]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.85, 0.06), post);
    p.position.set(lx, 0.92, -0.04);
    sign.add(p);
  }
  sign.add(plate);
  sign.position.set(sx, sy, sz);
  sign.rotation.y = Math.atan2(-ux, -uz);
  g.add(sign);
  for (const o of g.children) o.castShadow = o.receiveShadow = true;
  return g;
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
export function gate(track: Track, i: number, sign: THREE.Texture, height: number, at?: At): THREE.Group {
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
  g.position.set(base.x, at ? at(base.x, base.z) : base.y, base.z);
  g.rotation.y = -Math.atan2(s.t.z, s.t.x);
  return g;
}
