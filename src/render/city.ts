// The Volta dos Amigos's world: Braga as it is, from the map the games share (braga-map, made
// from OpenStreetMap and DGT's LiDAR), loaded tile by tile round the track. The land as the ground
// really is, meeting the road as it does, and what's on it painted onto the ground; every building
// near the track on its own ground, with its floors and its roof, and none on the road; trees; the
// Rio Este and its bridges; zebra crossings, traffic lights and bus stops; the street names; the
// granite plinth with Braga's arms at the start; the sights (sights.ts); and the friends' easter
// eggs on their houses (eggs.ts). The road itself is road.ts.
import { heightOn, loadWorld, type Box, type Building as MapBuilding, type Track as Course, type World as Braga } from 'braga-map';
import * as THREE from 'three';
import { distanceToRoad, surfacePoint, type Sample, type Track } from '../track/track.ts';
import { buildEggs, eggSpots, type Eggs } from './eggs.ts';
import { buildSights, horizon } from './sights.ts';
import { bake, box, mat } from './kit.ts';
import type { Quality } from './look.ts';
import { bridge, buildRoad, lamps, ribbon, runs } from './road.ts';
import * as tex from './textures.ts';
import { plantTrees, type Tree } from './trees.ts';
import type { World } from './world.ts';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// How far a point is from the road, roughly (to within 40 m), from a grid of 50 m squares over the
// box: for keeping only what's near the track. Infinity outside the box.
function reach(track: Track, B: Box): (x: number, z: number) => number {
  const C = 50;
  const nx = Math.ceil((B.x1 - B.x0) / C);
  const nz = Math.ceil((B.z1 - B.z0) / C);
  const d = new Float32Array(nx * nz);
  const pts = track.samples.filter((_, i) => i % 10 === 0).map((s) => s.p);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = B.x0 + (i + 0.5) * C;
      const z = B.z0 + (j + 0.5) * C;
      let m = Infinity;
      for (const p of pts) m = Math.min(m, Math.hypot(p.x - x, p.z - z));
      d[j * nx + i] = m;
    }
  }
  return (x, z) => {
    if (x < B.x0 || x >= B.x1 || z < B.z0 || z >= B.z1) return Infinity;
    return d[Math.floor((z - B.z0) / C) * nx + Math.floor((x - B.x0) / C)];
  };
}

// ---- The look of things ----

// What the ground is, painted from the map: these are its colours.
const LAND: Record<string, string> = {
  urban: '#8f8a7e',
  industrial: '#99958d',
  farm: '#8c9757',
  grass: '#6c9146',
  scrub: '#6a7944',
  forest: '#4b6834',
  park: '#628f3e',
  cemetery: '#8d977d',
  hospital: '#a7a196',
  school: '#a7a196',
  sport: '#4f8c3c',
  water: '#3e6f7c',
  plaza: '#b8b2a6',
};
// Street classes as the map numbers them: whether they have pavements. (Each street comes
// with its own width.)
const PAVED = [true, false, true, true, true, true, false, false, false, false];
// Facade colours, which tint the near-white wall textures.
const FACADES = ['#f2ede3', '#ecd7a2', '#e0b874', '#e0ad9c', '#b9cfdb', '#d8c5ab', '#efe0bf', '#bfd3bb'];
const SHOPS = ['#eeeeea', '#dcdcd6', '#e6e0d4', '#cfd4d6'];
const ROOFS = ['#b55a3c', '#a54e35', '#c26942', '#9c4a34'];

// The ground's material: the map painted on it, and a fine grain tiled by world position, so it
// isn't smeared up close.
function groundMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.96 });
  const grain = tex.grain();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.grain = { value: grain };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D grain;\nvarying vec2 vWorldXZ;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= (0.62 + 0.76 * texture2D(grain, vWorldXZ / 5.0).r) * (0.8 + 0.4 * texture2D(grain, vWorldXZ / 41.0).r);');
  };
  return m;
}

// ---- The world ----

export async function buildCity(track: Track, course: Course, quality: Quality): Promise<World & { eggs: Eggs }> {
  const map = await loadWorld(course.box);
  const B = course.box;
  const group = new THREE.Group();
  const updates: ((t: number) => void)[] = [];
  const N = track.samples.length;
  const nat = map.height;
  const far = (x: number, z: number) => heightOn(map.far, x, z);
  const near = reach(track, B);

  // The Rio Este: its line, and its water level along it, well below the road where the road
  // crosses it.
  const river: { ax: number; az: number; bx: number; bz: number; ya: number; yb: number }[] = [];
  for (const r of map.rivers) {
    const pts = r.pts
      .filter(([x, z]) => x > B.x0 - 100 && x < B.x1 + 100 && z > B.z0 - 100 && z < B.z1 + 100)
      .map(([x, z, y]) => {
        const { d, i } = distanceToRoad(track, x, z);
        const s = track.samples[i];
        return [x, z, i >= 0 && d + s.w / 2 < 30 ? Math.min(y, s.p.y - 4.5) : y];
      });
    for (let k = 1; k < pts.length; k++) river.push({ ax: pts[k - 1][0], az: pts[k - 1][1], bx: pts[k][0], bz: pts[k][1], ya: pts[k - 1][2], yb: pts[k][2] });
  }
  const HW = map.riverHalfWidth;
  // Metres to the river's middle, and the water's height there.
  const riverAt = (x: number, z: number) => {
    let best = Infinity;
    let y = 0;
    for (const s of river) {
      if (Math.abs(x - s.ax) > 80 && Math.abs(x - s.bx) > 80) continue;
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(x - s.ax - dx * t, z - s.az - dz * t);
      if (d < best) {
        best = d;
        y = s.ya + (s.yb - s.ya) * t;
      }
    }
    return { d: best, y };
  };

  // The ground as it is, from the map (the LiDAR's, every 2 m near the route), with the river's
  // bed cut through it. The stadium's ground is level, its pitch and stands in a bowl cut into the
  // slope.
  const pads = map.sights.flatMap((s) => (s.kind === 'stadium' ? [{ x: s.x, z: s.z, c: Math.cos(s.angle), s: Math.sin(s.angle), rx: s.L + s.W + 30, rz: s.W + 36, y: nat(s.x, s.z) }] : []));
  const land = (x: number, z: number): number => {
    let h = nat(x, z);
    for (const p of pads) {
      const dx = x - p.x;
      const dz = z - p.z;
      const e = Math.hypot((dx * p.c + dz * p.s) / p.rx, (-dx * p.s + dz * p.c) / p.rz);
      if (e < 1.3) h = p.y + (h - p.y) * smooth(0.9, 1.3, e);
    }
    const r = riverAt(x, z);
    if (r.d < HW + 12) {
      const bed = r.y - 1.6;
      h = Math.min(h, bed + (h - bed) * smooth(HW - 2, HW + 12, r.d));
    }
    return h;
  };
  const overWater = (s: Sample) => riverAt(s.p.x, s.p.z).d < HW + 8;
  const bridged = (s: Sample) => s.bridge || overWater(s);

  // What's at the back of each side of the road, for road.ts. A pavement slopes from the kerb's top
  // to meet the ground at its back, as real ones do on a hill, as steeply as 12% up or 5% down;
  // past that, a wall or a skirt makes up the difference. A reservation's far kerb is level with
  // its near one. With neither, the road's own edge.
  const KERB = 0.15;
  const backs = new Map<number, { y: number; ground: number }>();
  const edges = (s: Sample, k: 0 | 1) => {
    let e = backs.get(s.d * 2 + k);
    if (!e) {
      const side = k ? 1 : -1;
      const kb = s.kerbs[k];
      const o = surfacePoint(s, side * (s.w / 2 + Math.abs(kb)), 0);
      const g = land(o.x, o.z);
      const top = surfacePoint(s, side * (s.w / 2 + 0.25), KERB).y;
      const y = kb > 0 ? top + Math.max(-0.05 * kb, Math.min(0.12 * kb, g - top)) : kb < 0 ? surfacePoint(s, side * (s.w / 2 - kb), KERB).y : o.y + 0.02;
      e = { y, ground: g };
      backs.set(s.d * 2 + k, e);
    }
    return e;
  };
  // Where (x, z) is by the road: its nearest sample, how far right of the centre line, which side,
  // and how far past the road's edge (negative on the road).
  const beside = (x: number, z: number) => {
    const { d, i } = distanceToRoad(track, x, z);
    if (i < 0) return null;
    const s = track.samples[i];
    const lat = (x - s.p.x) * s.r.x + (z - s.p.z) * s.r.z;
    return { s, lat, d, k: (lat > 0 ? 1 : 0) as 0 | 1 };
  };
  // The ground things stand on: the road's surface, the pavement's, and the land beyond.
  const ground = (x: number, z: number): number => {
    const b = beside(x, z);
    if (b) {
      const { s, lat, d, k } = b;
      if (d < 0) return surfacePoint(s, lat, 0).y;
      if (s.kerbs[k] > 0 && d < s.kerbs[k]) {
        const top = surfacePoint(s, Math.sign(lat) * (s.w / 2 + 0.25), KERB).y;
        return top + (edges(s, k).y - top) * Math.max(0, (d - 0.25) / (s.kerbs[k] - 0.25));
      }
      if (s.kerbs[k] < 0 && d < -s.kerbs[k]) return surfacePoint(s, lat, KERB).y;
    }
    return land(x, z);
  };
  // The land's mesh is made of cells of C metres, each split into small ones of F metres where it
  // needs them (below). It keeps under the road and its pavements, and DEEP metres past them (a
  // small cell, corner to corner, so no cell that reaches over the pavement rises through it),
  // where the verges (below) cover the step down to it, VERGE metres wide. `top` is as high as it
  // may be there and still be hidden: under the road (whose surface is drawn 2 cm up), under a
  // pavement, or no more than 5 cm over the ground under a verge, which is drawn over it where they
  // meet.
  const C = quality === 'low' ? 20 : 10;
  const F = quality === 'low' ? 4 : 2;
  const DEEP = F * 1.42 + 0.1;
  const VERGE = 2 * DEEP + 0.4;
  const meshAt = (x: number, z: number): { y: number; top: number; d: number } => {
    const h = land(x, z);
    const b = beside(x, z);
    if (!b) return { y: h, top: Infinity, d: Infinity };
    const back = Math.abs(b.s.kerbs[b.k]);
    const road = surfacePoint(b.s, b.lat, 0).y;
    if (b.d < back + DEEP) return { y: Math.min(h, road) - 0.35, top: b.d < 0 ? road : b.d < back ? road + 0.12 : bridged(b.s) ? Infinity : h + 0.05, d: b.d };
    return { y: h, top: b.d < back + VERGE && !bridged(b.s) ? h + 0.05 : Infinity, d: b.d };
  };
  const paint = paintGround(map, B, track, quality);
  const uvAt = (x: number, z: number): [number, number] => [(x - B.x0) / (B.x1 - B.x0), 1 - (z - B.z0) / (B.z1 - B.z0)];

  // ---- The land near the track, the map painted on it: cells of 10 m, split into cells of 2 m
  // where they need them (on Low, 20 m and 4 m), as the data has the ground every 2 m near the
  // route. A cell is split where its two triangles would rise through the road or a verge, or, near
  // the road, miss the ground by more than a little: a bank, a terrace, a cutting. Where a big cell
  // meets small ones, the small ones' points along their shared side are set on its edge, so the
  // land has no cracks. ----
  {
    const r = C / F;
    const band = quality === 'high' ? 20 : quality === 'medium' ? 10 : 0;
    const tol = quality === 'high' ? 0.5 : 0.8;
    const nx = Math.floor((B.x1 - B.x0) / C);
    const nz = Math.floor((B.z1 - B.z0) / C);
    const cornerY = new Float32Array((nx + 1) * (nz + 1));
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) cornerY[j * (nx + 1) + i] = meshAt(B.x0 + i * C, B.z0 + j * C).y;
    const fine = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        if (distanceToRoad(track, B.x0 + (i + 0.5) * C, B.z0 + (j + 0.5) * C).d > Math.max(band, C * 0.71 + 10)) continue;
        const y00 = cornerY[j * (nx + 1) + i];
        const y10 = cornerY[j * (nx + 1) + i + 1];
        const y01 = cornerY[(j + 1) * (nx + 1) + i];
        const y11 = cornerY[(j + 1) * (nx + 1) + i + 1];
        test: for (let b = 0; b <= r; b++) {
          for (let a = 0; a <= r; a++) {
            const u = a / r;
            const v = b / r;
            // The cell's two triangles, split from (i + 1, j) to (i, j + 1).
            const flat = u + v <= 1 ? y00 + (y10 - y00) * u + (y01 - y00) * v : y11 + (y01 - y11) * (1 - u) + (y10 - y11) * (1 - v);
            const m = meshAt(B.x0 + i * C + a * F, B.z0 + j * C + b * F);
            const e = m.y - flat;
            if (flat > m.top || (m.top === Infinity && m.d < band && Math.abs(e) > tol)) {
              fine[j * nx + i] = 1;
              break test;
            }
          }
        }
      }
    }
    const isFine = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < nz && fine[j * nx + i] === 1;
    const coarse = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < nz && fine[j * nx + i] === 0;
    const W = nx * r + 1;
    const ids = new Map<number, number>();
    const pos: number[] = [];
    const uv: number[] = [];
    const cornerAt = (i: number, j: number) => cornerY[j * (nx + 1) + i];
    // A point of the 2 m lattice, made once.
    const vertex = (ix: number, iz: number): number => {
      const key = iz * W + ix;
      let v = ids.get(key);
      if (v !== undefined) return v;
      const x = B.x0 + ix * F;
      const z = B.z0 + iz * F;
      const ci = Math.floor(ix / r);
      const cj = Math.floor(iz / r);
      let y: number;
      if (ix % r === 0 && iz % r === 0) y = cornerAt(ix / r, iz / r);
      else if (ix % r === 0 && (coarse(ix / r - 1, cj) || coarse(ix / r, cj))) y = cornerAt(ix / r, cj) + (cornerAt(ix / r, cj + 1) - cornerAt(ix / r, cj)) * ((iz % r) / r);
      else if (iz % r === 0 && (coarse(ci, iz / r - 1) || coarse(ci, iz / r))) y = cornerAt(ci, iz / r) + (cornerAt(ci + 1, iz / r) - cornerAt(ci, iz / r)) * ((ix % r) / r);
      else y = meshAt(x, z).y;
      v = pos.length / 3;
      pos.push(x, y, z);
      uv.push(...uvAt(x, z));
      ids.set(key, v);
      return v;
    };
    const idx: number[] = [];
    const cell = (a: number, b: number, c: number, d: number) => idx.push(a, c, b, b, c, d); // corners (i, j), (i + 1, j), (i, j + 1), (i + 1, j + 1)
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        if (!isFine(i, j)) {
          cell(vertex(i * r, j * r), vertex((i + 1) * r, j * r), vertex(i * r, (j + 1) * r), vertex((i + 1) * r, (j + 1) * r));
          continue;
        }
        for (let b = 0; b < r; b++) for (let a = 0; a < r; a++) cell(vertex(i * r + a, j * r + b), vertex(i * r + a + 1, j * r + b), vertex(i * r + a, j * r + b + 1), vertex(i * r + a + 1, j * r + b + 1));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, groundMaterial(paint));
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---- The verges: the land beside the road, from the back of each side VERGE metres out, at
  // the ground's own height, over the land's mesh where it keeps down out of the road's way.
  // Narrower on the inside of a bend, and stopping short of another stretch of the road. ----
  {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const OUT = [0, 0.4, 1, 2, 3.2, 4.4].map((o) => (o * VERGE) / 4.4);
    const every = F;
    for (const k of [0, 1] as const) {
      const side = k ? 1 : -1;
      for (const [a, b] of runs(track, (s) => !bridged(s))) {
        let prev: number[] | null = null;
        const len = b - a === N ? N : (b - a + N) % N;
        for (let m = 0; m <= len; m += every) {
          const i = (a + Math.min(m, len)) % N;
          const s = track.samples[i];
          const t0 = track.samples[(i - 4 + N) % N].t;
          const t1 = track.samples[(i + 4) % N].t;
          // The bend's radius, on the side it turns to.
          const turn = (t0.x * t1.z - t0.z * t1.x) / 8;
          const room = Math.sign(turn) === side ? 1 / Math.abs(turn) - 0.5 - (s.w / 2 + Math.abs(s.kerbs[k])) : Infinity;
          const back = s.w / 2 + Math.abs(s.kerbs[k]);
          const row: number[] = [];
          for (const o of OUT) {
            if (o > room) break;
            const p = surfacePoint(s, side * (back + o), 0);
            const near = distanceToRoad(track, p.x, p.z);
            if (o > 0 && near.d < 1 && Math.abs(((near.i - i + N + N / 2) % N) - N / 2) > 30) break;
            const y = o === 0 ? (s.kerbs[k] === 0 ? edges(s, k).y : edges(s, k).ground) : land(p.x, p.z);
            row.push(pos.length / 3);
            pos.push(p.x, y, p.z);
            uv.push(...uvAt(p.x, p.z));
          }
          if (prev && prev.length > 1 && row.length > 1) {
            for (let q = 0; q + 1 < Math.min(prev.length, row.length); q++) {
              // Wound to face up on either side.
              if (side > 0) idx.push(prev[q], prev[q + 1], row[q], prev[q + 1], row[q + 1], row[q]);
              else idx.push(prev[q], row[q], prev[q + 1], prev[q + 1], row[q], row[q + 1]);
            }
          }
          prev = row;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = groundMaterial(paint);
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -2;
    const verges = new THREE.Mesh(geo, m);
    verges.receiveShadow = true;
    group.add(verges);
  }

  // ---- The hills further off: the whole map every 50 m, under the near land where they meet. ----
  {
    const g = map.far;
    const inner = (x: number, z: number, m: number) => x > B.x0 + m && x < B.x1 - m && z > B.z0 + m && z < B.z1 - m;
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    const green = new THREE.Color('#62763f');
    const wood = new THREE.Color('#344a2a');
    const town = new THREE.Color('#9b968a');
    const cover = (i: number, j: number) => map.cover[j * g.nx + i];
    for (let j = 0; j < g.nz; j++) {
      for (let i = 0; i < g.nx; i++) {
        const x = g.x0 + i * g.step;
        const z = g.z0 + j * g.step;
        let y = far(x, z);
        if (inner(x, z, 0)) y -= 4; // tucked under the near land
        pos.push(x, y, z);
        // Woods, town and fields, as the map has them, mottled.
        const n = Math.sin(x * 0.011 + Math.sin(z * 0.007) * 2) * Math.cos(z * 0.013 + Math.sin(x * 0.009) * 2);
        const k = cover(i, j);
        c.copy(k === 1 ? wood : k === 2 ? town : green).lerp(wood, k ? n * 0.12 : smooth(60, 300, y) * 0.5 + n * 0.15);
        col.push(c.r, c.g, c.b);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < g.nz - 1; j++) {
      for (let i = 0; i < g.nx - 1; i++) {
        const x = g.x0 + (i + 0.5) * g.step;
        const z = g.z0 + (j + 0.5) * g.step;
        if (inner(x, z, 80)) continue;
        const a = j * g.nx + i;
        idx.push(a, a + g.nx, a + 1, a + 1, a + g.nx, a + g.nx + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const hills = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    hills.receiveShadow = true;
    group.add(hills);
  }

  // ---- The horizon: the hills 15 km round, under the far ones where they meet. ----
  group.add(horizon(map.horizon, map.far));

  // ---- The Rio Este: water down its course, rippling. ----
  {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let v = 0;
    for (const s of river) {
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const l = Math.hypot(dx, dz) || 1;
      const sx = (-dz / l) * (HW + 3);
      const sz = (dx / l) * (HW + 3);
      const q = pos.length / 3;
      pos.push(s.ax - sx, s.ya, s.az - sz, s.ax + sx, s.ya, s.az + sz, s.bx - sx, s.yb, s.bz - sz, s.bx + sx, s.yb, s.bz + sz);
      uv.push(0, v, 1, v, 0, v + l / 12, 1, v + l / 12);
      v += l / 12;
      idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const normal = tex.ripples();
    const water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#2f6a78', roughness: 0.06, metalness: 0.1, normalMap: normal, normalScale: new THREE.Vector2(0.6, 0.6), side: THREE.DoubleSide }));
    water.receiveShadow = true;
    group.add(water);
    updates.push((t) => normal.offset.set(t * 0.02, -t * 0.12));
  }

  // ---- The road, its bridges, the lamps along it: baked together at the end, being many small
  // meshes. (The land, the hills and the buildings are a mesh each already.) ----
  const statics = new THREE.Group();
  const road = buildRoad(track, overWater, { start: tex.sign('VOLTA DOS AMIGOS', 'BRAGA', '#fbfbf8', '#1d4f9c', 1024, 192, '#1d4f9c'), checkpoint: tex.sign('PONTO DE CONTROLO', '', '#111318', '#ffe14d', 1024, 160) }, edges);
  statics.add(road.group);
  updates.push(road.update);
  for (const [a, b] of runs(track, overWater)) {
    const mid = track.samples[(a + Math.floor(((b - a + N) % N) / 2)) % N];
    statics.add(bridge(track, a, b, riverAt(mid.p.x, mid.p.z).y, HW));
  }
  group.add(lamps(track, ground, (s) => !bridged(s), 34));

  // ---- The plinth at the start, where the lobby shows your car; and the eggs. ----
  const all = nearBuildings(map, track, near);
  const buildingsNear = (x: number, z: number, r: number) => {
    let n = 0;
    for (const b of all) if (Math.abs(b.cx - x) < r + 30 && Math.abs(b.cz - z) < r + 30 && b.pts.some(([px, pz]) => Math.hypot(px - x, pz - z) < r)) n++;
    return n;
  };
  const plinth = startPlinth(track, ground, buildingsNear);
  statics.add(plinth.group);
  // The top of the building at (x, z), or of the nearest one within 12 m, with its roof.
  const roofAt = (x: number, z: number) => {
    let best: { x: number; y: number; z: number } | null = null;
    let bd = 12;
    for (const b of all) {
      if (Math.abs(b.cx - x) > 60 || Math.abs(b.cz - z) > 60) continue;
      const d = inside(b.pts, x, z) ? 0 : Math.min(...b.pts.map(([px, pz], k) => segDist(x, z, px, pz, ...b.pts[(k + 1) % b.pts.length])));
      if (d >= bd) continue;
      bd = d;
      const r = rectangle(b.pts);
      const ridge = b.roof !== 0 && r.fill > 0.72 && r.W > 2 ? (r.W + 0.4) * 0.52 : 0;
      best = { x: b.cx, y: b.y + b.h + ridge, z: b.cz };
    }
    return best;
  };
  const spots = eggSpots(track, course.eggs);
  const eggs = buildEggs(track, ground, spots, roofAt);
  group.add(bake(eggs.group));

  // ---- Buildings, clear of the plinth and the eggs. ----
  const keepOut = [plinth.clear, ...spots.map((s) => s.clear)];
  const list = all.filter((b) => !keepOut.some((k) => b.pts.some(([x, z]) => Math.hypot(x - k.x, z - k.z) < k.r) || Math.hypot(b.cx - k.x, b.cz - k.z) < k.r));
  group.add(buildBuildings(list));

  // ---- Trees, from the map and filling its parks and woods: the map's own anywhere in the box,
  // those filled in within 230 m of the road, and none within 11 m of it. ----
  {
    const trees: Tree[] = [];
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const every = quality === 'low' ? 3 : quality === 'medium' ? 2 : 1;
    let k = 0;
    for (const { x, z, pine, filled } of map.trees) {
      const r = near(x, z);
      if (r === Infinity || (filled && r > 230)) continue;
      if (r < 80) {
        const { d, i } = distanceToRoad(track, x, z);
        if (i >= 0 && d + track.samples[i].w / 2 < 11) continue;
      }
      if (k++ % every) continue;
      if (riverAt(x, z).d < HW + 3) continue;
      // None on the plinth or in the eggs' ground.
      if (keepOut.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) continue;
      trees.push({
        kind: pine ? 'pine' : 'round',
        x,
        y: ground(x, z),
        z,
        s: 0.75 + rnd() * 0.55,
        color: pine ? new THREE.Color().setHSL(0.34 + rnd() * 0.04, 0.42, 0.14 + rnd() * 0.05) : new THREE.Color().setHSL(0.22 + rnd() * 0.08, 0.45, 0.19 + rnd() * 0.08),
      });
    }
    // Big tiles and plain crowns: there are thousands of them.
    group.add(plantTrees(trees, 800, true));
  }

  // ---- Along the road: zebra crossings, traffic lights, bus stops. ----
  const furniture = streetFurniture(track, ground, course);
  statics.add(furniture.group);
  updates.push(furniture.update);

  // ---- The sights: Bom Jesus and the Sameiro on the hills, the cross on the Picoto, the stadium,
  // the Altice Forum, Makro and the Tourigalo. ----
  const sights = buildSights(map.sights, track, ground, far);
  group.add(sights.group);
  updates.push(sights.update);

  // ---- Names: a plate as the road enters each street, brown signs to the landmarks. ----
  statics.add(streetPlates(track, ground, course.streets));
  for (const l of course.landmarks) statics.add(landmarkSign(track, ground, l));
  group.add(bake(statics));

  return {
    group,
    update: (t) => updates.forEach((u) => u(t)),
    ground,
    stage: plinth.stage,
    stageAt: plinth.at,
    eggs,
  };
}

// ---- The ground's map ----

// Paints what the ground is onto one big canvas over the scenery's box: the land, the parks and
// woods, water, squares, every other street with its pavements, the railway, and pavements along
// the track.
function paintGround(map: Braga, B: Box, track: Track, quality: Quality): THREE.CanvasTexture {
  const res = quality === 'high' ? 1 : quality === 'medium' ? 1.4 : 2; // metres a pixel
  const W = Math.min(4096, Math.round((B.x1 - B.x0) / res));
  const H = Math.min(4096, Math.round((B.z1 - B.z0) / res));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.setTransform(W / (B.x1 - B.x0), 0, 0, H / (B.z1 - B.z0), (-B.x0 * W) / (B.x1 - B.x0), (-B.z0 * H) / (B.z1 - B.z0));
  g.fillStyle = '#76844f';
  g.fillRect(B.x0, B.z0, B.x1 - B.x0, B.z1 - B.z0);

  for (const { kind, pts } of map.areas) {
    g.fillStyle = LAND[kind] ?? LAND.urban;
    g.beginPath();
    pts.forEach(([x, z], k) => (k ? g.lineTo(x, z) : g.moveTo(x, z)));
    g.closePath();
    g.fill();
    // Pitches get their white lines, roughly.
    if (kind === 'sport') {
      g.strokeStyle = 'rgba(240,240,235,0.55)';
      g.lineWidth = 0.35;
      g.stroke();
    }
  }

  // Every other street: pavement first, then asphalt; the small ones, then the big ones.
  const lines = map.lines.map(({ kind, w, pts }) => ({ k: kind, w, pts }));
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const stroke = (pts: [number, number][], width: number, color: string) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    pts.forEach(([x, z], k) => (k ? g.lineTo(x, z) : g.moveTo(x, z)));
    g.stroke();
  };
  for (const { k, w, pts } of lines) if (k < 9 && PAVED[k]) stroke(pts, w + 5, '#948f86');
  for (const { k, w, pts } of lines) stroke(pts, w, k === 9 ? '#5d5249' : k === 6 ? '#d6d1c6' : k >= 7 ? '#77746c' : '#47494d');
  // A dashed centre line on the big roads.
  g.setLineDash([3, 4]);
  for (const { k, pts } of lines) if (k <= 3) stroke(pts, 0.15, 'rgba(240,240,232,0.8)');
  g.setLineDash([]);

  // Under the track and its pavements, as wide as each is.
  const s = track.samples;
  for (const pass of [0, 1]) {
    for (let i = 0; i < s.length; i += 2) {
      const a = s[i];
      const b = s[(i + 2) % s.length];
      const out = Math.max(0, a.kerbs[0], a.kerbs[1]);
      stroke(
        [
          [a.p.x, a.p.z],
          [b.p.x, b.p.z],
        ],
        pass ? a.w : a.w + 2 * out + (out ? 1 : 0),
        pass ? '#47494d' : '#948f86',
      );
    }
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---- Buildings ----

interface Building {
  pts: [number, number][];
  kind: number; // 0 house, 1 flats, 2 shop, 3 church, 4 civic
  roof: number; // 0 flat, 1 hipped, 2 gabled
  color: number;
  y: number; // the ground at its lowest corner
  h: number; // from there
  cx: number;
  cz: number;
}

// The map's buildings in the box within 300 m of the road, but none on the road or its kerb: the
// road is wider than the streets were. Nor, for the houses the map filled in, on its pavement.
function nearBuildings(map: Braga, track: Track, near: (x: number, z: number) => number): Building[] {
  const onRoad = (b: MapBuilding, x: number, z: number) => {
    const { d, i } = distanceToRoad(track, x, z);
    if (i < 0) return false;
    if (d < 1) return true;
    const s = track.samples[i];
    return b.filled && d < s.kerbs[(x - s.p.x) * s.r.x + (z - s.p.z) * s.r.z > 0 ? 1 : 0];
  };
  const out: Building[] = [];
  for (const b of map.buildings) {
    const n = b.pts.length;
    const cx = b.pts.reduce((a, p) => a + p[0], 0) / n;
    const cz = b.pts.reduce((a, p) => a + p[1], 0) / n;
    const r = near(cx, cz);
    if (r > 300) continue;
    const size = Math.max(...b.pts.map(([x, z]) => Math.hypot(x - cx, z - cz)));
    if (r - size < 80) {
      const edges = b.pts.some(([ax, az], k) => {
        const [bx, bz] = b.pts[(k + 1) % n];
        for (let f = 0; f <= 1; f += 0.25) if (onRoad(b, ax + (bx - ax) * f, az + (bz - az) * f)) return true;
        return false;
      });
      if (edges || onRoad(b, cx, cz)) continue;
    }
    out.push({ pts: b.pts, kind: b.kind, roof: b.roof, color: b.color, y: b.y, h: b.h, cx, cz });
  }
  return out;
}

// Is (x, z) inside the outline?
function inside(pts: [number, number][], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[j];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) c = !c;
  }
  return c;
}

// How far (x, z) is from the segment from (ax, az) to (bx, bz).
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}

// Geometry being gathered for one material: positions, normals, uvs and colours.
class Batch {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ua: [number, number], ub: [number, number], uc: [number, number], color: THREE.Color): void {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const [p, u] of [[a, ua], [b, ub], [c, uc]] as const) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(u[0], u[1]);
      this.col.push(color.r, color.g, color.b);
    }
  }
  // A triangle facing up, whichever way round its corners come.
  up(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ua: [number, number], ub: [number, number], uc: [number, number], color: THREE.Color): void {
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if (ny >= 0) this.tri(a, b, c, ua, ub, uc, color);
    else this.tri(a, c, b, ua, uc, ub, color);
  }
  // A quad a, b, c, d (counter-clockwise seen from the side it faces).
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, ua: [number, number], ub: [number, number], uc: [number, number], ud: [number, number], color: THREE.Color): void {
    this.tri(a, b, c, ua, ub, uc, color);
    this.tri(a, c, d, ua, uc, ud, color);
  }
  mesh(material: THREE.Material): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

// The smallest rectangle round a footprint, lined up with one of its edges: centre, axes along
// and across it, half-lengths (long first), and how much of it the footprint fills.
function rectangle(pts: [number, number][]): { cx: number; cz: number; ux: number; uz: number; L: number; W: number; fill: number } {
  let best = { cx: 0, cz: 0, ux: 1, uz: 0, L: 0, W: 0, area: Infinity };
  for (let k = 0; k < pts.length; k++) {
    const [ax, az] = pts[k];
    const [bx, bz] = pts[(k + 1) % pts.length];
    const l = Math.hypot(bx - ax, bz - az);
    if (l < 0.5) continue;
    const ux = (bx - ax) / l;
    const uz = (bz - az) / l;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of pts) {
      const a = x * ux + z * uz;
      const b = -x * uz + z * ux;
      a0 = Math.min(a0, a);
      a1 = Math.max(a1, a);
      b0 = Math.min(b0, b);
      b1 = Math.max(b1, b);
    }
    const area = (a1 - a0) * (b1 - b0);
    if (area < best.area) {
      const am = (a0 + a1) / 2;
      const bm = (b0 + b1) / 2;
      const along = (a1 - a0) / 2;
      const across = (b1 - b0) / 2;
      const long = along >= across;
      best = {
        cx: am * ux - bm * uz,
        cz: am * uz + bm * ux,
        ux: long ? ux : -uz,
        uz: long ? uz : ux,
        L: Math.max(along, across),
        W: Math.min(along, across),
        area,
      };
    }
  }
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return { ...best, fill: Math.abs(area / 2) / best.area };
}

// Each building stands on the ground at its lowest corner, from the map, its walls going a little
// below it, so a row of houses steps down a hill as the real ones do; its height is from there.
function buildBuildings(list: Building[]): THREE.Group {
  const walls = { flats: new Batch(), ground: new Batch(), house: new Batch(), shop: new Batch(), church: new Batch() };
  const tiles = new Batch();
  const flat = new Batch();
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const col = new THREE.Color();
  const roofCol = new THREE.Color();

  for (const b of list) {
    // Counter-clockwise seen from above (x east, z south), so the walls face out.
    let pts = b.pts;
    let area = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
    if (area < 0) pts = [...pts].reverse();
    const base = b.y - 0.6;
    const foot = b.y;
    const top = b.y + b.h;
    const church = b.kind === 3;
    col.set(church ? '#f6f4ef' : b.kind === 2 || b.kind === 4 ? SHOPS[b.color % SHOPS.length] : FACADES[b.color % FACADES.length]);
    roofCol.set(ROOFS[b.color % ROOFS.length]);

    // Walls: flats get a ground floor of doors and shops, the rest one texture all the way up.
    const upper = church ? walls.church : b.kind === 0 ? walls.house : b.kind === 1 ? walls.flats : walls.shop;
    const split = b.kind === 1 && b.h > 6 ? foot + 3 : base;
    let u = 0;
    for (let k = 0; k < pts.length; k++) {
      const [ax, az] = pts[k];
      const [bx, bz] = pts[(k + 1) % pts.length];
      const l = Math.hypot(bx - ax, bz - az);
      const u0 = u / 6;
      const u1 = (u + l) / 6;
      if (split > base) walls.ground.quad(V(ax, base, az), V(ax, split, az), V(bx, split, bz), V(bx, base, bz), [u0, (base - foot) / 3], [u0, 1], [u1, 1], [u1, (base - foot) / 3], col);
      const v0 = split > base ? 0 : (base - foot) / 3;
      const lift = split > base ? foot + 3 : foot;
      upper.quad(V(ax, split, az), V(ax, top, az), V(bx, top, bz), V(bx, split, bz), [u0, v0], [u0, (top - lift) / 3], [u1, (top - lift) / 3], [u1, v0], col);
      u += l;
    }

    // The roof: hipped or gabled over the footprint's rectangle where it nearly fills it,
    // otherwise flat.
    const r = rectangle(pts);
    const pitched = b.roof !== 0 && r.fill > 0.72 && r.W > 2;
    if (!pitched) {
      const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
        const P = (n: number) => V(pts[n][0], top, pts[n][1]);
        const U = (n: number): [number, number] => [pts[n][0] / 6, pts[n][1] / 6];
        flat.up(P(i), P(j), P(k), U(i), U(j), U(k), col);
      }
      continue;
    }
    const o = 0.4;
    const L = r.L + o;
    const W = r.W + o;
    const H = W * 0.52;
    const ux = r.ux;
    const uz = r.uz;
    const vx = -uz;
    const vz = ux;
    const C = (a: number, bb: number, y: number) => V(r.cx + ux * a + vx * bb, y, r.cz + uz * a + vz * bb);
    const hip = b.roof === 1 ? Math.min(W, L) : 0;
    const A0 = C(-L, -W, top);
    const A1 = C(L, -W, top);
    const B1 = C(L, W, top);
    const B0 = C(-L, W, top);
    const R0 = C(-L + hip, 0, top + H);
    const R1 = C(L - hip, 0, top + H);
    const slope = Math.hypot(W, H) / 3;
    // The two long slopes.
    tiles.quad(A0, R0, R1, A1, [0, 0], [hip / 3, slope], [(2 * L - hip) / 3, slope], [(2 * L) / 3, 0], roofCol);
    tiles.quad(B1, R1, R0, B0, [0, 0], [hip / 3, slope], [(2 * L - hip) / 3, slope], [(2 * L) / 3, 0], roofCol);
    if (hip > 0) {
      // Hipped: the ends slope too.
      tiles.tri(B0, R0, A0, [0, 0], [W / 3, slope], [(2 * W) / 3, 0], roofCol);
      tiles.tri(A1, R1, B1, [0, 0], [W / 3, slope], [(2 * W) / 3, 0], roofCol);
    } else {
      // Gabled: the ends are wall, up to the ridge.
      upper.tri(B0, R0, A0, [0, 0], [W / 6, H / 3], [(2 * W) / 6, 0], col);
      upper.tri(A1, R1, B1, [0, 0], [W / 6, H / 3], [(2 * W) / 6, 0], col);
    }
    // A church gets its bell tower at one end.
    if (church) {
      const tw = Math.min(2.6, r.W * 0.9);
      const tc = C(-r.L + tw, 0, 0);
      const ty = top + 9;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, bb]) => [tc.x + (ux * a + vx * bb) * tw, tc.z + (uz * a + vz * bb) * tw]);
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k];
        const [bx, bz] = corners[(k + 1) % 4];
        walls.church.quad(V(ax, base, az), V(ax, ty, az), V(bx, ty, bz), V(bx, base, bz), [0, 0], [0, (ty - base) / 3], [(2 * tw) / 6, (ty - base) / 3], [(2 * tw) / 6, 0], col);
      }
      const apex = V(tc.x, ty + 4, tc.z);
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k];
        const [bx, bz] = corners[(k + 1) % 4];
        tiles.up(V(bx, ty, bz), apex, V(ax, ty, az), [0, 0], [0.5, 1], [1, 0], roofCol);
      }
    }
  }

  const g = new THREE.Group();
  const add = (batch: Batch, m: THREE.Material) => {
    const mesh = batch.mesh(m);
    if (mesh) g.add(mesh);
  };
  const wallMat = (map: THREE.Texture) => new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.88 });
  add(walls.flats, wallMat(tex.flatsFloor()));
  add(walls.ground, wallMat(tex.groundFloor()));
  add(walls.house, wallMat(tex.houseWall()));
  add(walls.shop, wallMat(tex.shopWall()));
  add(walls.church, wallMat(tex.churchWall()));
  add(tiles, new THREE.MeshStandardMaterial({ map: tex.roofTiles(), vertexColors: true, roughness: 0.75 }));
  // Flat roofs are their own grey, whatever the walls' colour.
  add(flat, new THREE.MeshStandardMaterial({ map: tex.flatRoof(), roughness: 0.95 }));
  return g;
}

// ---- The start ----

// A granite plinth beside the road just past the line, on whichever side has room, where the lobby
// shows your car; behind it a granite wall with Braga's arms and the race's name on azulejos.
// `crowded` counts the buildings near a spot.
function startPlinth(track: Track, ground: (x: number, z: number) => number, crowded: (x: number, z: number, r: number) => number) {
  let best = { i: 40, side: 1, score: Infinity };
  for (let i = 25; i < 140; i += 15) {
    for (const side of [-1, 1]) {
      const s = track.samples[i];
      const p = surfacePoint(s, side * (s.w / 2 + 10), 0);
      let lo = Infinity;
      let hi = -Infinity;
      for (const [a, b] of [[-10, -4], [10, -4], [-10, 4], [10, 4], [0, 0]]) {
        const q = surfacePoint(s, side * (s.w / 2 + 10 + b), 0);
        const y = ground(q.x + s.t.x * a, q.z + s.t.z * a);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      const score = crowded(p.x, p.z, 14) * 10 + (hi - lo) * 3 + Math.abs(i - 40) * 0.05;
      if (score < best.score) best = { i, side, score };
    }
  }
  const s = track.samples[best.i];
  const lateral = best.side * (s.w / 2 + 10);
  const g = new THREE.Group();
  const granite = mat('#a49d90', { roughness: 0.85 });
  const dark = mat('#8c857a', { roughness: 0.9 });
  const plinth = new THREE.Group();
  // Two steps up to the plinth's top, 1.2 m up, where the car stands at the front.
  plinth.add(box(16, 0.6, 11, dark, 0, -0.6, 0), box(14, 1.2, 9, granite, 0, 0, 0), box(14.4, 0.12, 9.4, dark, 0, 1.1, 0));
  // The wall at the back, its cornice, and the finials on its ends.
  plinth.add(box(13, 7, 1, granite, 0, 1.2, -4), box(13.6, 0.4, 1.3, dark, 0, 8.2, -4));
  for (const x of [-6.3, 6.3]) {
    plinth.add(box(0.9, 0.9, 0.9, dark, x, 8.6, -4));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), granite);
    ball.position.set(x, 9.95, -4);
    plinth.add(ball);
  }
  const arms = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.25), new THREE.MeshStandardMaterial({ map: tex.bragaArms(), transparent: true, roughness: 0.6 }));
  arms.position.set(0, 5.6, -3.49);
  plinth.add(arms);
  const name = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.6), new THREE.MeshStandardMaterial({ map: tex.sign('VOLTA DOS AMIGOS', 'Braga', '#f4f7fb', '#1d4f9c', 1024, 164, '#1d4f9c'), roughness: 0.3 }));
  name.position.set(0, 2.35, -3.49);
  plinth.add(name);
  // Its front (+z) faces the road.
  const at = surfacePoint(s, lateral, 0);
  plinth.position.set(at.x, ground(at.x, at.z), at.z);
  plinth.rotation.y = -Math.atan2(s.t.z, s.t.x) + (best.side > 0 ? Math.PI : 0);
  g.add(plinth);
  const front = surfacePoint(s, best.side * (s.w / 2 + 7), 0);
  const spot = new THREE.Vector3(front.x, ground(at.x, at.z) + 1.2, front.z);
  return {
    group: g,
    stage: spot,
    at: best.i,
    clear: { x: at.x, z: at.z, r: 16 },
  };
}

// ---- Names ----

// A blue-and-white plate on a post as the road turns into each street, facing the karts coming.
function streetPlates(track: Track, ground: (x: number, z: number) => number, streets: { name: string; x: number; z: number }[]): THREE.Group {
  const g = new THREE.Group();
  if (!streets.length) return g;
  const atlas = tex.streetPlates(streets.map((s) => s.name));
  const pos: number[] = [];
  const uv: number[] = [];
  const posts: THREE.Matrix4[] = [];
  streets.forEach((st, k) => {
    const i = distanceToRoad(track, st.x, st.z).i;
    if (i < 0) return;
    const s = track.samples[i];
    const p = surfacePoint(s, s.w / 2 + (s.kerbs[1] > 1.2 ? s.kerbs[1] - 0.5 : 1.4), 0);
    const y = s.kerbs[1] > 0 ? p.y + 0.15 : ground(p.x, p.z);
    posts.push(new THREE.Matrix4().makeTranslation(p.x, y + 1.3, p.z));
    // The plate spans across the road's direction, its face towards the karts coming.
    const hw = 1.1;
    const ax = p.x - s.r.x * hw;
    const az = p.z - s.r.z * hw;
    const bx = p.x + s.r.x * hw;
    const bz = p.z + s.r.z * hw;
    const lo = y + 2.2;
    const hi = y + 2.68;
    const n = streets.length;
    const v0 = 1 - (k + 1) / n;
    const v1 = 1 - k / n;
    pos.push(ax, lo, az, bx, lo, bz, bx, hi, bz, ax, lo, az, bx, hi, bz, ax, hi, az);
    uv.push(0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.4, side: THREE.DoubleSide })));
  const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), mat('#3a3d42', { metalness: 0.5 }), posts.length);
  posts.forEach((m, k) => post.setMatrixAt(k, m));
  post.computeBoundingSphere();
  g.add(post);
  return g;
}

// ---- Along the road ----

// Zebra crossings across the road where the map has them, traffic lights at the kerb before the
// junctions, and the bus stops, a shelter or a pole, on the pavement.
function streetFurniture(track: Track, ground: (x: number, z: number) => number, meta: Course): { group: THREE.Group; update: (t: number) => void } {
  const g = new THREE.Group();
  const N = track.samples.length;
  const zebra = new THREE.MeshStandardMaterial({ map: tex.zebra(), transparent: true, alphaTest: 0.4, roughness: 0.6 });
  for (const [x, z] of meta.crossings) {
    const { d, i } = distanceToRoad(track, x, z);
    if (i < 0 || d > 2) continue;
    g.add(new THREE.Mesh(ribbon(track, (i - 2 + N) % N, (i + 2) % N, (s) => [-s.w / 2 + 0.4, s.w / 2 - 0.4], 0.035, 4, 1), zebra));
  }

  // Traffic lights: a pole at the right-hand kerb 10 m before, its lamps towards the karts coming.
  const metal = mat('#3d4146', { metalness: 0.5, roughness: 0.5 });
  const black = mat('#141516', { roughness: 0.5 });
  const lit = ['#ff3b2f', '#ffb000', '#2fdc6a'].map((c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
  const off = mat('#2a2b2d', { roughness: 0.4 });
  const lights: THREE.Mesh[] = [];
  for (const [x, z] of meta.signals) {
    const { d, i: at } = distanceToRoad(track, x, z);
    if (at < 0 || d > 6) continue;
    const i = (at - 10 + N) % N;
    const s = track.samples[i];
    const p = surfacePoint(s, s.w / 2 + 0.5, 0);
    const y = s.kerbs[1] !== 0 ? p.y + 0.15 : ground(p.x, p.z);
    const pole = new THREE.Group();
    pole.add(box(0.14, 3.2, 0.14, metal, 0, 0, 0));
    pole.add(box(0.3, 1.0, 0.36, black, 0.18, 2.3, 0));
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.11, 12), off);
      m.position.set(0.335, 3.1 - k * 0.3, 0);
      m.rotation.y = Math.PI / 2;
      pole.add(m);
    }
    // The one that's lit, moved to its place in front of the others.
    const on = new THREE.Mesh(new THREE.CircleGeometry(0.11, 12), lit[2]);
    on.rotation.y = Math.PI / 2;
    on.userData.moves = true;
    pole.add(on);
    // Its +x faces the karts coming: back along the road.
    pole.position.set(p.x, y, p.z);
    pole.rotation.y = -Math.atan2(-s.t.z, -s.t.x);
    g.add(pole);
    lights.push(on);
  }
  // Each light keeps its own time: green, amber, red.
  const update = (t: number) =>
    lights.forEach((m, k) => {
      const u = (t + k * 7.3) % 20;
      const j = u < 11 ? 2 : u < 13 ? 1 : 0;
      m.material = lit[j];
      m.position.set(0.34, 3.1 - (2 - j) * 0.3, 0);
    });

  // Bus stops: a shelter of glass under a flat roof, or just the pole, beside the road.
  const glass = mat('#9fb7c4', { roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35 });
  const sign = new THREE.MeshStandardMaterial({ map: tex.sign('PARAGEM', '', '#ffffff', '#1b3f8b', 256, 128, ''), roughness: 0.5 });
  for (const st of meta.stops) {
    const { i } = distanceToRoad(track, st.x, st.z);
    if (i < 0) continue;
    const s = track.samples[i];
    const side = Math.sign((st.x - s.p.x) * s.r.x + (st.z - s.p.z) * s.r.z) || 1;
    const k = side < 0 ? 0 : 1;
    const pave = s.kerbs[k] > 0 ? s.kerbs[k] : 0;
    const p = surfacePoint(s, side * (s.w / 2 + (pave > 2.4 ? pave - 1.1 : pave + 1.2)), 0);
    const y = pave > 2.4 ? p.y + 0.15 : ground(p.x, p.z);
    const stop = new THREE.Group();
    if (st.shelter) {
      stop.add(box(1.5, 0.1, 3.6, metal, 0, 2.4, 0), box(0.04, 2.3, 3.4, glass, -0.7, 0.1, 0));
      for (const zz of [-1.7, 1.7]) stop.add(box(0.08, 2.4, 0.08, metal, -0.7, 0, zz), box(1.3, 2.3, 0.04, glass, 0, 0.1, zz));
      stop.add(box(0.4, 0.45, 2.4, metal, -0.45, 0, 0));
    }
    stop.add(box(0.08, 2.8, 0.08, metal, 0.6, 0, st.shelter ? 2.2 : 0));
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), sign);
    plate.position.set(0.6, 2.6, st.shelter ? 2.2 : 0);
    plate.rotation.y = Math.PI / 2;
    stop.add(plate);
    // Its +x faces the road.
    stop.position.set(p.x, y, p.z);
    stop.rotation.y = -Math.atan2(s.t.z, s.t.x) + (side < 0 ? -Math.PI / 2 : Math.PI / 2);
    g.add(stop);
  }
  return { group: g, update };
}

// A brown sign on two posts by the road, pointing out a landmark on that side.
function landmarkSign(track: Track, ground: (x: number, z: number) => number, l: { name: string; x: number; z: number }): THREE.Group {
  const g = new THREE.Group();
  const { i } = distanceToRoad(track, l.x, l.z);
  if (i < 0) return g;
  // A little before the landmark, so it's read on the way.
  const N = track.samples.length;
  const s = track.samples[(i - 40 + N) % N];
  const side = Math.sign((l.x - s.p.x) * s.r.x + (l.z - s.p.z) * s.r.z) || 1;
  const p = surfacePoint(s, side * (s.w / 2 + 2.2), 0);
  const y = ground(p.x, p.z);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshStandardMaterial({ map: tex.brownSign(l.name), roughness: 0.5, side: THREE.DoubleSide }));
  board.position.set(p.x, y + 2.4, p.z);
  board.rotation.y = -Math.atan2(s.t.z, s.t.x) - Math.PI / 2;
  g.add(board);
  for (const d of [-1.5, 1.5]) g.add(box(0.1, 2.9, 0.1, mat('#5b5f63'), p.x + s.r.x * d, y, p.z + s.r.z * d));
  return g;
}
