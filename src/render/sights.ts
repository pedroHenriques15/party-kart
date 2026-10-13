// The sights a Bracarense steers by. Bom Jesus and the Sameiro on the hills to the east, seen from
// all over the track, and the hills of the horizon behind them; the cross on top of the Picoto;
// and along the way the Estádio 1.º de Maio, the Altice Forum, Makro and the Tourigalo's bull.
// Simple shapes, at their real places and sizes from the map (tools/braga-map/course.mjs). Far
// off, it's their outline against the sky that counts.
import * as THREE from 'three';
import { distanceToRoad, type Track } from '../track/track.ts';
import { bake, box, mat, mesh, type Ground } from './kit.ts';
import * as tex from './textures.ts';

export type Sight =
  | { kind: 'bomjesus'; x: number; z: number; y: number; angle: number; L: number; W: number; face: number; foot: [number, number]; footY: number }
  | { kind: 'sameiro'; x: number; z: number; y: number; angle: number; L: number; W: number; face: number; statue: [number, number]; statueY: number }
  | { kind: 'cruzeiro' | 'tourigalo'; x: number; z: number; y: number; face?: number }
  | { kind: 'makro' | 'altice'; x: number; z: number; y: number; face: number; L: number }
  | { kind: 'stadium'; x: number; z: number; y: number; angle: number; L: number; W: number };

const WHITE = () => mat('#ece7dc', { roughness: 0.75 });
// The sanctuaries on the hills are drawn twice their size: at three or four kilometres a church
// the real size is a few pixels across, and they're what you look for on the skyline.
const FAR_SCALE = 2;
const GRANITE = () => mat('#a49d90', { roughness: 0.85 });
const ROOF = () => mat('#9a4a33', { roughness: 0.8 });

// A sanctuary's length along its face, and across: the footprint's rectangle, turned to the face.
function along(s: { angle: number; L: number; W: number; face: number }): [number, number] {
  return Math.abs(Math.cos(s.angle - s.face)) > 0.7 ? [s.L, s.W] : [s.W, s.L];
}

// A gabled roof the length of x, w wide, rising h.
function gable(len: number, w: number, h: number, m: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  g.rotateY(Math.PI / 2);
  return mesh(g, m);
}

// A bell tower: a square shaft, a cornice, a lantern and a dome.
function tower(side: number, h: number, wall: THREE.Material, trim: THREE.Material, top: THREE.Material): THREE.Group {
  const t = new THREE.Group();
  t.add(box(side, h, side, wall, 0, 0, 0));
  for (const y of [h * 0.45, h * 0.75]) t.add(box(side + 0.6, 0.6, side + 0.6, trim, 0, y, 0));
  t.add(box(side + 0.8, 0.8, side + 0.8, trim, 0, h, 0));
  t.add(box(side * 0.7, side * 0.6, side * 0.7, wall, 0, h + 0.8, 0));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(side * 0.42, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), top);
  dome.position.y = h + 0.8 + side * 0.6;
  t.add(dome);
  t.add(box(0.25, side * 0.6, 0.25, trim, 0, h + 0.8 + side, 0));
  return t;
}

// ---- Bom Jesus do Monte: the basilica, white with granite, its twin towers looking west over the
// city, and the Escadório zigzagging white down the hill below it. ----
function bomJesus(s: Extract<Sight, { kind: 'bomjesus' }>, ground: Ground): THREE.Group {
  const g = new THREE.Group();
  const [half, wide] = along(s);
  const wall = WHITE();
  const trim = GRANITE();
  const church = new THREE.Group();
  // +x is its face, west.
  church.add(box(half * 2, 19, wide * 2, wall, 0, -4, 0));
  church.add(gable(half * 2, wide * 2, 7, ROOF()).translateY(15));
  church.add(box(1.2, 26, wide * 2 - 10, trim, half, -4, 0));
  for (const z of [-1, 1]) church.add(tower(7, 30, wall, trim, trim).translateX(half - 2).translateZ(z * (wide - 3.5)).translateY(-4));
  church.add(box(1.5, 4, 3, trim, half + 0.6, 22, 0));
  church.position.set(s.x, s.y, s.z);
  church.rotation.y = -s.face;
  church.scale.setScalar(FAR_SCALE);
  g.add(church);

  // The Escadório: a white stair between granite walls, straight down the slope from the church's
  // terrace to its foot, the lower flights zigzagging.
  const fx = s.x + Math.cos(s.face) * (half + 12) * FAR_SCALE;
  const fz = s.z + Math.sin(s.face) * (half + 12) * FAR_SCALE;
  const [ex, ez] = s.foot;
  const n = 30;
  const zig = (k: number) => (k > n * 0.55 ? (Math.floor(k / 2) % 2 ? 7 : -7) : 0);
  const at = (k: number): [number, number, number] => {
    const f = k / n;
    const x0 = fx + (ex - fx) * f;
    const z0 = fz + (ez - fz) * f;
    const L = Math.hypot(ex - fx, ez - fz);
    const o = zig(k);
    const x = x0 - ((ez - fz) / L) * o;
    const z = z0 + ((ex - fx) / L) * o;
    return [x, ground(x, z) + 0.6, z];
  };
  for (let k = 0; k < n; k++) {
    const [ax, ay, az] = at(k);
    const [bx, by, bz] = at(k + 1);
    const len = Math.hypot(bx - ax, bz - az);
    const flight = new THREE.Group();
    flight.add(box(len + 1.5, 2, 12, wall, 0, -1.6, 0));
    for (const side of [-1, 1]) flight.add(box(len + 1.5, 1.4, 1.2, trim, 0, 0.2, side * 6.4));
    flight.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    // Along the flight, tipped up the slope.
    flight.rotation.set(0, -Math.atan2(bz - az, bx - ax), Math.atan2(by - ay, len), 'YZX');
    g.add(flight);
  }
  return g;
}

// ---- The Sameiro: the sanctuary in grey granite, its dome high over the nave, two towers at its
// front, and the Virgin on her column in the square before it. ----
function sameiro(s: Extract<Sight, { kind: 'sameiro' }>, ground: Ground): THREE.Group {
  const g = new THREE.Group();
  const [half, wide] = along(s);
  const stone = mat('#bdb7ab', { roughness: 0.85 });
  const dark = mat('#8f897d', { roughness: 0.85 });
  const lead = mat('#7d8a8f', { roughness: 0.5, metalness: 0.3 });
  const church = new THREE.Group();
  church.add(box(half * 2, 24, wide * 2, stone, 0, -4, 0));
  church.add(gable(half * 2, wide * 2, 6, ROOF()).translateY(20));
  // The dome over the crossing, its top 50 m up.
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 10, 24), stone);
  drum.position.set(-half * 0.25, 25, 0);
  church.add(drum);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(9.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), lead);
  dome.position.set(-half * 0.25, 30, 0);
  church.add(dome);
  church.add(box(2.6, 6, 2.6, stone, -half * 0.25, 38.5, 0));
  church.add(box(0.5, 4, 0.5, dark, -half * 0.25, 44.5, 0));
  for (const z of [-1, 1]) church.add(tower(7, 30, stone, dark, lead).translateX(half - 3).translateZ(z * (wide - 3.5)).translateY(-4));
  church.position.set(s.x, s.y, s.z);
  church.rotation.y = -s.face;
  church.scale.setScalar(FAR_SCALE);
  g.add(church);
  // The column, and her on it.
  const [cx, cz] = s.statue;
  const cy = ground(cx, cz);
  const col = new THREE.Group();
  col.add(box(5, 3, 5, dark, 0, -1, 0));
  col.add(mesh(new THREE.CylinderGeometry(0.9, 1.1, 22, 16), stone, 0, 13, 0));
  col.add(box(2.6, 1, 2.6, dark, 0, 24, 0));
  col.add(mesh(new THREE.CylinderGeometry(0.5, 1.0, 3.6, 12), mat('#e9e6df'), 0, 26.8, 0));
  col.add(mesh(new THREE.SphereGeometry(0.45, 12, 8), mat('#e9e6df'), 0, 29, 0));
  col.position.set(cx, cy, cz);
  col.scale.setScalar(FAR_SCALE);
  g.add(col);
  return g;
}

// ---- The Picoto: the stone cross on its top, and the white survey pillar beside it. ----
function cruzeiro(s: { x: number; y: number; z: number }): THREE.Group {
  const g = new THREE.Group();
  const stone = GRANITE();
  g.add(box(3, 0.5, 3, stone, 0, 0, 0), box(2, 0.5, 2, stone, 0, 0.5, 0), box(0.4, 4.5, 0.4, stone, 0, 1, 0), box(0.4, 0.4, 1.8, stone, 0, 4.2, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.4, 0.45, 2.7, 12), mat('#f2f0ea'), 4, 1.35, 1));
  g.position.set(s.x, s.y, s.z);
  return g;
}

// ---- The Tourigalo's bull: black and glossy on a granite plinth, side-on to the road. ----
function tourigalo(s: { x: number; y: number; z: number; face?: number }): THREE.Group {
  const g = new THREE.Group();
  const hide = mat('#151515', { roughness: 0.3, metalness: 0.35 });
  const horn = mat('#ece2c6', { roughness: 0.4 });
  const bull = new THREE.Group();
  // +x is his nose, along the road.
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 2.0, 8, 16), hide);
  body.rotation.z = Math.PI / 2;
  body.scale.set(1.25, 1, 0.95);
  body.position.set(0, 1.55, 0);
  bull.add(body);
  // The hump over his shoulders, and the neck down to the head.
  bull.add(mesh(new THREE.SphereGeometry(0.62, 16, 12), hide, 0.75, 1.85, 0));
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.9, 12), hide);
  neck.position.set(1.35, 1.6, 0);
  neck.rotation.z = -1.0;
  bull.add(neck);
  const head = new THREE.Group();
  head.add(box(0.7, 0.55, 0.5, hide, 0, -0.3, 0), box(0.35, 0.36, 0.42, hide, 0.42, -0.55, 0));
  for (const z of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.7, 8), horn);
    h.position.set(0, 0.12, z * 0.42);
    h.rotation.set(z * 1.1, 0, -0.6);
    head.add(h);
  }
  head.position.set(1.85, 1.45, 0);
  head.rotation.z = -0.5;
  bull.add(head);
  for (const [x, z] of [[1.0, -0.3], [1.0, 0.3], [-1.0, -0.3], [-1.0, 0.3]]) bull.add(mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.15, 8), hide, x, 0.57, z));
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.2, 6), hide);
  tail.position.set(-1.65, 1.3, 0);
  tail.rotation.z = -0.25;
  bull.add(tail);
  bull.scale.setScalar(1.6);
  bull.rotation.y = -Math.PI / 2;
  bull.position.y = 1.4;
  g.add(bull);
  g.add(box(2.6, 1.4, 5.6, GRANITE(), 0, 0, 0));
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.8), new THREE.MeshStandardMaterial({ map: tex.sign('TOURIGALO', '', '#f1ead6', '#5a1a14', 1024, 186, ''), roughness: 0.5 }));
  plate.rotation.y = Math.PI / 2;
  plate.position.set(1.31, 0.75, 0);
  g.add(plate);
  g.position.set(s.x, s.y, s.z);
  g.rotation.y = -(s.face ?? 0);
  return g;
}

// ---- A sign along a building's front: Makro's yellow and black, the Altice Forum's. ----
function fascia(s: { x: number; z: number; face: number; L: number }, ground: Ground, text: string, bg: string, fg: string, height: number, top: number): THREE.Group {
  const g = new THREE.Group();
  const width = Math.min(2 * s.L - 2, Math.max(12, text.length * height * 0.62));
  g.add(box(0.5, height + 0.6, width + 0.6, mat(bg), 0.3, top - height - 0.3, 0));
  const board = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: tex.sign(text, '', bg, fg, 1024, Math.round((1024 * height) / width), ''), toneMapped: false }));
  board.rotation.y = Math.PI / 2;
  board.position.set(0.56, top - height / 2, 0);
  g.add(board);
  g.position.set(s.x, ground(s.x, s.z), s.z);
  g.rotation.y = -s.face;
  return g;
}

// ---- The Estádio 1.º de Maio: the pitch inside a red running track, terraces all round, a
// covered stand on one side, and floodlights at the corners. ----
function stadium(s: Extract<Sight, { kind: 'stadium' }>, track: Track): THREE.Group {
  const g = new THREE.Group();
  const straight = s.L;
  const r0 = s.W + 6;
  // A stadium's oval at r beyond the pitch: [x, z] round it, in the pitch's frame.
  const oval = (r: number, n = 48): [number, number][] => {
    const out: [number, number][] = [];
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      const c = Math.cos(a);
      out.push([c >= 0 ? straight + Math.cos(a) * r : -straight + Math.cos(a) * r, Math.sin(a) * r]);
    }
    return out;
  };
  // The running track, a flat red ring.
  {
    const inner = oval(r0 - 5);
    const outer = oval(r0 + 4);
    const pos: number[] = [];
    for (let k = 0; k < inner.length - 1; k++) {
      const [a, b, c, d] = [inner[k], outer[k], outer[k + 1], inner[k + 1]];
      pos.push(a[0], 0.08, a[1], c[0], 0.08, c[1], b[0], 0.08, b[1], a[0], 0.08, a[1], d[0], 0.08, d[1], c[0], 0.08, c[1]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    g.add(mesh(geo, mat('#b5523d', { roughness: 0.9 })));
  }
  // Terraces: rows rising outwards all round.
  const concrete = mat('#bdb8ae', { roughness: 0.9 });
  const rows = 8;
  for (let r = 0; r < rows; r++) {
    const ring = oval(r0 + 6 + r * 2.2, 40);
    for (let k = 0; k < ring.length - 1; k++) {
      const [ax, az] = ring[k];
      const [bx, bz] = ring[k + 1];
      const l = Math.hypot(bx - ax, bz - az);
      const step = box(l + 0.3, 1 + r * 1.1, 2.2, concrete, 0, -1, 0);
      step.position.set((ax + bx) / 2, -1 + (1 + r * 1.1) / 2, (az + bz) / 2);
      step.rotation.y = -Math.atan2(bz - az, bx - ax);
      g.add(step);
    }
  }
  // The covered stand, on the long side further from the road.
  const sideAway = (() => {
    const far = (z: number) => {
      const x = s.x - Math.sin(s.angle) * z;
      const zz = s.z + Math.cos(s.angle) * z;
      return distanceToRoad(track, x, zz).d;
    };
    return far(r0 + 15) > far(-(r0 + 15)) ? 1 : -1;
  })();
  const stand = new THREE.Group();
  stand.add(box(straight * 1.6, 14, 18, concrete, 0, -1, 0));
  const roof = box(straight * 1.7, 0.8, 24, mat('#e4e1da', { roughness: 0.6 }), 0, 17, -4);
  stand.add(roof);
  for (const x of [-0.6, -0.2, 0.2, 0.6]) stand.add(box(0.8, 18, 0.8, concrete, x * straight * 1.6, -1, 8));
  stand.position.z = sideAway * (r0 + 22);
  if (sideAway < 0) stand.rotation.y = Math.PI;
  g.add(stand);
  // Floodlights at the four corners, their lamps towards the pitch.
  const steel = mat('#8c9298', { metalness: 0.6, roughness: 0.4 });
  const lamp = new THREE.MeshBasicMaterial({ color: '#fff8e0', toneMapped: false });
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const mast = new THREE.Group();
    mast.add(mesh(new THREE.CylinderGeometry(0.5, 0.9, 34, 8), steel, 0, 17, 0));
    mast.add(box(4.5, 3, 0.6, steel, 0, 33, 0));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.6), lamp);
    face.position.set(0, 34.5, -0.31);
    face.rotation.y = Math.PI;
    mast.add(face);
    mast.position.set(x * (straight + r0 * 0.75), 0, z * (r0 + 14));
    mast.rotation.y = Math.atan2(x * (straight + r0 * 0.75), z * (r0 + 14));
    g.add(mast);
  }
  g.position.set(s.x, s.y, s.z);
  g.rotation.y = -s.angle;
  return g;
}

export function buildSights(list: Sight[], track: Track, ground: Ground, far: Ground): { group: THREE.Group; update: (t: number) => void } {
  const group = new THREE.Group();
  for (const s of list) {
    let g: THREE.Group | null = null;
    if (s.kind === 'bomjesus') g = bomJesus({ ...s, y: far(s.x, s.z) }, far);
    if (s.kind === 'sameiro') g = sameiro({ ...s, y: far(s.x, s.z) }, far);
    if (s.kind === 'cruzeiro') g = cruzeiro({ ...s, y: ground(s.x, s.z) });
    if (s.kind === 'tourigalo') g = tourigalo({ ...s, y: ground(s.x, s.z) });
    if (s.kind === 'makro') g = fascia(s, ground, 'makro', '#ffd400', '#111111', 6, 10);
    if (s.kind === 'altice') g = fascia(s, ground, 'ALTICE FORUM BRAGA', '#f4f4f2', '#1b1d22', 4.5, 14);
    if (s.kind === 'stadium') g = stadium({ ...s, y: ground(s.x, s.z) }, track);
    if (g) group.add(bake(g));
  }
  return { group, update: () => {} };
}

// The horizon: the hills 15 km round, every 250 m, from the coarser relief; where the map's own
// far hills are, it stays out of the way underneath them.
export function horizon(nums: Int16Array, h: { at: number; x0: number; z0: number; step: number; nx: number; nz: number }, inner: { x0: number; z0: number; step: number; nx: number; nz: number }): THREE.Mesh {
  const ix1 = inner.x0 + (inner.nx - 1) * inner.step;
  const iz1 = inner.z0 + (inner.nz - 1) * inner.step;
  const inside = (x: number, z: number, m: number) => x > inner.x0 + m && x < ix1 - m && z > inner.z0 + m && z < iz1 - m;
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const low = new THREE.Color('#62764a');
  const high = new THREE.Color('#4a5e3c');
  const town = new THREE.Color('#99958b');
  for (let j = 0; j < h.nz; j++) {
    for (let i = 0; i < h.nx; i++) {
      const x = h.x0 + i * h.step;
      const z = h.z0 + j * h.step;
      let y = nums[h.at + j * h.nx + i] / 10;
      if (inside(x, z, 0)) y -= 12;
      pos.push(x, y, z);
      const n = Math.sin(x * 0.0013 + Math.sin(z * 0.0009) * 2) * Math.cos(z * 0.0017 + Math.sin(x * 0.0011) * 2);
      c.copy(low).lerp(high, Math.min(1, Math.max(0, y / 300)) * 0.8 + n * 0.2);
      // Villages and towns in the valleys.
      if (y < 80) c.lerp(town, Math.max(0, n) * 0.5);
      col.push(c.r, c.g, c.b);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < h.nz - 1; j++) {
    for (let i = 0; i < h.nx - 1; i++) {
      if (inside(h.x0 + (i + 0.5) * h.step, h.z0 + (j + 0.5) * h.step, 300)) continue;
      const a = j * h.nx + i;
      idx.push(a, a + h.nx, a + 1, a + 1, a + h.nx, a + h.nx + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
}
