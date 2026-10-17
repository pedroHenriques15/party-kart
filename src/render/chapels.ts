// The route's other chapels, São Lázaro's bell tower and two wayside shrines (braga-map's task 056),
// each as its photos show it, at the size and heights the map and the LiDAR give it: the Capela de
// Santa Justa on the Rua Monsenhor Airosa, the Capela de Santo Adrião up its bank over the road to the
// Picoto, the Capela de Santa Tecla in its quinta, the bell tower of the Igreja de São Lázaro, and the
// shrines of the Senhor do Bonfim and the Senhor da Boa Morte. Each is built in its own frame: +x out
// of its front, z across it (+z on the left, seen from before it), y up from the ground at its front.
import type { Sight } from 'braga-map';
import * as THREE from 'three';
import { opening, sideOpening, STONE, TILES } from './chapel.ts';
import { box, mat, mesh, slab } from './kit.ts';
import * as tex from './textures.ts';

type Chapel = Extract<Sight, { kind: 'chapel' }>;
type Tower = Extract<Sight, { kind: 'saolazaro' }>;
type Shrine = Extract<Sight, { kind: 'shrine' }>;

// Their materials, made once and few: they're baked together, a draw call a material (sights.ts).
let ashlarTex: THREE.Texture | null = null;
let rubbleTex: THREE.Texture | null = null;
const ASHLAR = () => mat('#cdbf9f', { map: (ashlarTex ??= tex.ashlar()), roughness: 0.9 });
const RUBBLE = () => mat('#d3c9b4', { map: (rubbleTex ??= tex.rubble()), roughness: 0.95 });
const RENDER = () => mat('#f1eee6', { roughness: 0.9 });
const CREAM = () => mat('#e9e0cc', { roughness: 0.9 });
const WOOD = () => mat('#3b2a1f', { roughness: 0.7 });
const GREEN = () => mat('#22352b', { roughness: 0.6 });
const DARK = () => mat('#262a2e', { roughness: 0.5 });
// The iron of the crosses, the bells' frames and the grilles, and the glass: as dark as the openings.
const IRON = () => DARK();
const GLASS = () => DARK();
const BRONZE = () => mat('#6b5a3a', { roughness: 0.4, metalness: 0.6 });
const TIMBER = () => WOOD();

// Its texture laid on in metres, `size` to a repeat, as each face looks: a wall facing x across z
// and up, one facing z across x and up, a roof or a floor across x and z. In the chapel's frame, so
// the mesh must be the chapel group's own child, placed.
function metres<T extends THREE.Mesh>(m: T, size = 2): T {
  m.updateMatrix();
  const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const nm = new THREE.Matrix3().getNormalMatrix(m.matrix);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(m.matrix);
    n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
    const [u, v] = Math.abs(n.y) > 0.7 ? [p.x, p.z] : Math.abs(n.x) > Math.abs(n.z) ? [p.z, p.y] : [p.x, p.y];
    uv[2 * i] = u / size;
    uv[2 * i + 1] = v / size;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  m.geometry = g;
  return m;
}

// A tiled roof: its eaves at the four corners given ([x, z], the front's left and right, then the
// back's right and left), at y = e, its ridge from p (the front's end) to q (the back's) at y = r. A
// slope either side, and between the eaves and the ridge's ends a hip, or nothing where the ridge
// reaches the eaves' line (a gable, or a lean-to's high side). Both ways round, so it shows from
// under its eaves too.
function roof(c: [number, number][], p: [number, number], q: [number, number], e: number, r: number, m: THREE.Material): THREE.Mesh {
  const [a, b, d, f] = c.map(([x, z]) => [x, e, z]);
  const P = [p[0], r, p[1]];
  const Q = [q[0], r, q[1]];
  // Whether the ridge's end is on the eaves' line between two corners.
  const on = (t: [number, number], u: number[], v: number[]) => {
    const dx = v[0] - u[0];
    const dz = v[2] - u[2];
    const k = Math.max(0, Math.min(1, ((t[0] - u[0]) * dx + (t[1] - u[2]) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(t[0] - u[0] - k * dx, t[1] - u[2] - k * dz) < 0.05;
  };
  const tris = [a, f, Q, a, Q, P, b, P, Q, b, Q, d, ...(on(p, a, b) ? [] : [a, P, b]), ...(on(q, f, d) ? [] : [f, d, Q])];
  const both = [...tris, ...tris.flatMap((_, k) => (k % 3 === 0 ? [tris[k + 2], tris[k + 1], tris[k]] : []))];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(both.flat(), 3));
  geo.computeVertexNormals();
  return metres(mesh(geo, m), 4);
}

// A box from (y0) to (y1) along the line from (z0, y0) to (z1, y1) in the wall facing +x at x: a
// gable's coping, a raking cornice.
function rake(g: THREE.Group, x: number, z0: number, y0: number, z1: number, y1: number, w: number, h: number, m: THREE.Material): void {
  const len = Math.hypot(z1 - z0, y1 - y0);
  const b = box(w, h, len + 0.1, m, x, 0, (z0 + z1) / 2);
  b.geometry.translate(0, -h / 2, 0);
  b.position.y = (y0 + y1) / 2;
  b.rotation.x = -Math.atan2(y1 - y0, z1 - z0);
  g.add(b);
}

// A gable wall facing +x, its front at x and `d` deep: from y0 up to the eaves e across z0..z1,
// its apex r over z = (z0 + z1) / 2.
function gable(x: number, d: number, z0: number, z1: number, y0: number, e: number, r: number, m: THREE.Material): THREE.Mesh {
  const s = new THREE.Shape();
  s.moveTo(z0, y0);
  s.lineTo(z1, y0);
  s.lineTo(z1, e);
  s.lineTo((z0 + z1) / 2, r);
  s.lineTo(z0, e);
  s.closePath();
  const w = slab(s, d, m);
  w.rotation.y = -Math.PI / 2;
  w.position.set(x - d / 2, 0, 0);
  return w;
}

// A bell, hanging at (x, y, z), its mouth `r` across.
function bell(g: THREE.Group, x: number, y: number, z: number, r = 0.3): void {
  g.add(mesh(new THREE.CylinderGeometry(r * 0.5, r, r * 1.6, 12, 1, true), BRONZE(), x, y, z));
  g.add(mesh(new THREE.SphereGeometry(r * 0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), BRONZE(), x, y + r * 0.8, z));
}

// A bell gable facing +x, its front at x, standing on y over z: two piers and an arch, its top
// rounded over the arch, `h` high and `w` wide, a bell in it.
function bellGable(g: THREE.Group, x: number, y: number, z: number, w: number, h: number, m: THREE.Material): void {
  const r = w / 2;
  const hole = r * 0.52;
  const s = new THREE.Shape();
  s.moveTo(-r, 0);
  s.lineTo(r, 0);
  s.lineTo(r, h - r);
  s.absarc(0, h - r, r, 0, Math.PI, false);
  s.lineTo(-r, 0);
  const a = new THREE.Path();
  a.moveTo(-hole, h * 0.14);
  a.lineTo(hole, h * 0.14);
  a.lineTo(hole, h - r);
  a.absarc(0, h - r, hole, 0, Math.PI, false);
  a.lineTo(-hole, h * 0.14);
  s.holes.push(a);
  const d = 0.55;
  const b = slab(s, d, m);
  b.rotation.y = -Math.PI / 2;
  b.position.set(x - d / 2, y, z);
  g.add(metres(b));
  bell(g, x - d / 2, y + h * 0.42, z, hole * 0.75);
}

// An iron cross, `h` high, on (x, y, z).
function ironCross(g: THREE.Group, x: number, y: number, z: number, h = 0.8): void {
  g.add(box(0.05, h, 0.05, IRON(), x, y, z), box(0.05, 0.05, h * 0.55, IRON(), x, y + h * 0.68, z));
}

// A stone cross, `h` high, on (x, y, z).
function stoneCross(g: THREE.Group, x: number, y: number, z: number, h: number, m: THREE.Material): void {
  const t = h * 0.13;
  g.add(box(t, h, t, m, x, y, z), box(t, t, h * 0.6, m, x, y + h * 0.66, z));
}

// The saint in her tiles: a small arched panel, blue and ochre on white (Santa Justa's, by her door).
let azulejoTex: THREE.Texture | null = null;
function azulejo(): THREE.Material {
  azulejoTex ??= tex.drawTexture(
    64,
    96,
    (g) => {
      g.fillStyle = '#2f6b3a';
      g.fillRect(0, 0, 64, 96);
      g.fillStyle = '#f2ede0';
      g.beginPath();
      g.roundRect(5, 5, 54, 86, [27, 27, 2, 2]);
      g.fill();
      g.fillStyle = '#7fa6c9';
      g.fillRect(8, 22, 48, 24);
      g.fillStyle = '#c99a4a';
      g.beginPath();
      g.ellipse(32, 30, 9, 8, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#b5683d';
      g.fillRect(22, 52, 20, 32);
      g.fillStyle = '#e6c9a8';
      g.beginPath();
      g.arc(32, 48, 5, 0, Math.PI * 2);
      g.fill();
    },
    false,
  );
  return mat('#ffffff', { map: azulejoTex, roughness: 0.3 });
}

// ---- The Capela de Santa Justa (1618): its front all dressed granite, a gable with a stone cross on
// a little curved pediment, a tall wooden double door in a granite frame under the inscription and a
// cornice, the saint's tiles beside it. On its right, seen from the street, a white block with the bell
// gable on it, one bell in its arch and a small one in an iron frame beside it, an iron cross and a
// vane on top; along its sides white render, a dark door on the north; its roof tiled, hipped at the
// back. Its outline is wider than its granite front: the white block is the rest of it. ----
const JUSTA_BLOCK = 1.9; // the white block's width, from the photo
const JUSTA_BLOCK_DEPTH = 2.6;

function santaJusta(s: Chapel): THREE.Group {
  const g = new THREE.Group();
  const { L, W } = s;
  const E = s.eaves;
  const R = Math.max(s.ridge, E + 1.2);
  const T = Math.max(s.top, R + 0.5); // the bell gable's top
  const zr = -W + JUSTA_BLOCK; // the granite front's right edge
  const zm = (zr + W) / 2; // the nave's middle across
  const half = (W - zr) / 2;
  const F = L; // the front wall, x
  const stone = STONE();

  // ---- The nave: its walls, the granite front, the roof. ----
  g.add(box(2 * L - 0.6, E + 2, 2 * half, RENDER(), -0.3, -2, zm));
  g.add(box(0.7, 2.35, 2 * half + 0.04, RENDER(), F - 0.35, -2, zm));
  g.add(metres(gable(F, 0.6, zr, W, 0.35, E, R, ASHLAR())));
  // The roof's eaves over the gable, a white board under them.
  for (const [z0, z1] of [[zr - 0.3, zm], [W + 0.3, zm]]) rake(g, F + 0.12, z0, E - 0.12, z1, R + 0.05, 0.1, 0.22, RENDER());
  g.add(roof([[F + 0.15, W + 0.3], [F + 0.15, zr - 0.05], [-L - 0.3, zr - 0.05], [-L - 0.3, W + 0.3]], [F + 0.15, zm], [-L - 0.3 + half, zm], E - 0.1, R + 0.1, TILES()));
  // The little curved pediment on the apex, and the cross on it.
  {
    const p = new THREE.Shape();
    p.moveTo(-0.75, 0);
    p.absarc(0, 0, 0.75, 0, Math.PI, false);
    p.lineTo(-0.75, 0);
    const o = new THREE.Path();
    o.absarc(0, 0.05, 0.28, 0, Math.PI, false);
    o.lineTo(-0.28, 0.05);
    p.holes.push(o);
    const ped = slab(p, 0.5, stone);
    ped.rotation.y = -Math.PI / 2;
    ped.position.set(F - 0.25, R - 0.3, zm);
    g.add(ped, box(0.12, 0.3, 0.6, DARK(), F - 0.35, R - 0.25, zm));
    stoneCross(g, F - 0.25, R + 0.4, zm, 1.0, stone);
  }
  // The door, its frame, the inscription over it and the cornice over that; the step before it.
  opening(g, F, zm, 0.35, 1.75, 3.2, 1, WOOD(), 0.35);
  g.add(box(0.1, 3.2, 0.05, DARK(), F + 0.07, 0.35, zm));
  for (const z of [-0.45, 0.45]) g.add(box(0.1, 0.8, 0.4, IRON(), F + 0.07, 2.3, zm + z));
  g.add(box(0.14, 0.42, 2.6, stone, F + 0.07, 3.9, zm), box(0.45, 0.2, 3.0, stone, F + 0.2, 4.32, zm));
  g.add(box(0.7, 0.2, 2.4, stone, F + 0.35, 0.15, zm));
  // The saint's tiles, right of the door.
  {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.95), azulejo());
    panel.rotation.y = Math.PI / 2;
    panel.castShadow = false;
    panel.position.set(F + 0.02, 1.85, zm - 1.75);
    g.add(panel);
  }
  // The north side: the door near the back.
  sideOpening(g, -L + 2.2, W, 0, 1.15, 2.4, 1, DARK(), 0.18);

  // ---- The white block on the right, the bell gable on it; behind it the rest, under a lean-to roof. ----
  const C = T - 1.75; // the block's cornice
  const zb = -W + JUSTA_BLOCK / 2;
  g.add(box(JUSTA_BLOCK_DEPTH, C + 2, JUSTA_BLOCK, RENDER(), F - JUSTA_BLOCK_DEPTH / 2, -2, zb));
  // Granite on its corners, and its cornice.
  for (const z of [zr - 0.12, -W + 0.12]) g.add(box(0.12, C - 0.3, 0.3, stone, F + 0.02, 0.35, z));
  g.add(box(JUSTA_BLOCK_DEPTH + 0.2, 0.28, JUSTA_BLOCK + 0.2, stone, F - JUSTA_BLOCK_DEPTH / 2, C - 0.28, zb));
  bellGable(g, F - 0.05, C, zb, 1.3, T - C, ASHLAR());
  ironCross(g, F - 0.32, T, zb, 0.7);
  // The vane on the cross: a flag of thin iron.
  g.add(box(0.02, 0.18, 0.32, IRON(), F - 0.32, T + 0.38, zb + 0.18));
  // The small bell in its iron frame, on the gable's left.
  {
    const z = zb + 0.95;
    g.add(box(0.04, 0.9, 0.04, IRON(), F - 0.32, C, z - 0.2), box(0.04, 0.9, 0.04, IRON(), F - 0.32, C, z + 0.2), box(0.04, 0.04, 0.44, IRON(), F - 0.32, C + 0.9, z));
    bell(g, F - 0.32, C + 0.55, z, 0.13);
    ironCross(g, F - 0.32, C + 0.92, z, 0.35);
  }
  // Its high side and its front end a little into the nave's wall and the block's.
  const x0 = -L;
  const x1 = F - JUSTA_BLOCK_DEPTH;
  g.add(box(x1 - x0, E - 0.4 + 2, JUSTA_BLOCK, RENDER(), (x0 + x1) / 2, -2, zb));
  g.add(roof([[x1 + 0.05, zr + 0.05], [x1 + 0.05, -W - 0.3], [x0 - 0.3, -W - 0.3], [x0 - 0.3, zr + 0.05]], [x1 + 0.05, zr + 0.05], [x0 - 0.3, zr + 0.05], E - 0.9, E - 0.3, TILES()));

  g.position.set(s.x, s.y, s.z);
  g.rotation.y = -s.face;
  return g;
}

// ---- The Capela de Santo Adrião (1576): rubble granite, low and long under a tiled roof, up its bank
// over the road. Before its front a porch on granite columns, on low rubble walls open in the middle,
// under a hipped roof on timber; under the porch the round-arched door, the inscription on its
// keystone, a small barred window either side; on the front's apex a small bell gable with its bell
// and an iron cross; a small window in each side. ----
function santoAdriao(s: Chapel): THREE.Group {
  const g = new THREE.Group();
  const { L, W } = s;
  const E = s.eaves;
  const R = Math.max(s.ridge, E + 0.8);
  const P = Math.max(3, s.porch); // the porch's depth
  const F = L;
  const stone = STONE();
  const rubble = RUBBLE();

  // ---- The nave: its walls and gables, its roof, the cornice of its eaves. ----
  g.add(metres(box(2 * L, E + 2, 2 * W, rubble, 0, -2, 0)));
  g.add(metres(gable(F, 0.3, -W, W, E - 0.05, E, R, rubble)), metres(gable(-L + 0.3, 0.3, -W, W, E - 0.05, E, R, rubble)));
  g.add(roof([[F + 0.3, W + 0.35], [F + 0.3, -W - 0.35], [-L - 0.3, -W - 0.35], [-L - 0.3, W + 0.35]], [F + 0.3, 0], [-L - 0.3, 0], E - 0.1, R + 0.05, TILES()));
  for (const z of [-W, W]) g.add(box(2 * L + 0.3, 0.18, 0.25, stone, 0, E - 0.2, z));
  // A small window in each side, as its photos show the south one.
  sideOpening(g, -0.8, W, 1.7, 0.42, 0.5, 1, DARK(), 0.18);
  sideOpening(g, 1.2, -W, 1.7, 0.42, 0.5, -1, DARK(), 0.18);
  // The bell gable on the front's apex: a bell in its arch, an iron cross on it.
  bellGable(g, F, R - 0.35, 0, 0.95, 1.35, stone);
  ironCross(g, F - 0.27, R + 1.0, 0, 0.6);

  // ---- Under the porch: the arched door and its voussoirs, two barred windows. ----
  {
    const dw = 1.15;
    const dh = 1.75; // to where the arch springs
    g.add(box(0.06, dh, dw, WOOD(), F + 0.03, 0, 0));
    const leaf = mesh(new THREE.CylinderGeometry(dw / 2, dw / 2, 0.06, 16, 1, false, 0, Math.PI), WOOD(), F + 0.03, dh, 0);
    leaf.rotation.set(0, 0, Math.PI / 2);
    g.add(leaf);
    const ring = new THREE.Shape();
    ring.moveTo(dw / 2 + 0.3, 0);
    ring.absarc(0, 0, dw / 2 + 0.3, 0, Math.PI, false);
    ring.lineTo(-dw / 2, 0);
    ring.absarc(0, 0, dw / 2, Math.PI, 0, true);
    ring.lineTo(dw / 2 + 0.3, 0);
    const arch = slab(ring, 0.12, stone);
    arch.rotation.y = -Math.PI / 2;
    arch.position.set(F + 0.06, dh, 0);
    g.add(arch);
    for (const z of [-1, 1]) g.add(box(0.12, dh, 0.3, stone, F + 0.06, 0, z * (dw / 2 + 0.15)));
    for (const z of [-1.55, 1.55]) {
      opening(g, F, z, 0.95, 0.42, 0.5, 1, DARK(), 0.16);
      for (const k of [-1, 0, 1]) g.add(box(0.03, 0.5, 0.03, IRON(), F + 0.1, 0.95, z + k * 0.13));
    }
  }

  // ---- The porch: low rubble walls, open before the door, its floor; granite columns on the walls,
  // square at its corners; a timber frame and a hipped roof. ----
  {
    const x0 = F;
    const x1 = F + P;
    const low = 0.8;
    const gap = 1.4;
    const side = (2 * W - gap) / 2;
    g.add(metres(box(0.45, low + 2, side, rubble, x1 - 0.22, -2, -W + side / 2)), metres(box(0.45, low + 2, side, rubble, x1 - 0.22, -2, W - side / 2)));
    for (const z of [-W + 0.22, W - 0.22]) g.add(metres(box(P, low + 2, 0.45, rubble, (x0 + x1) / 2, -2, z)));
    g.add(box(P, 0.1, 2 * W, stone, (x0 + x1) / 2, 0, 0));
    const eaves = Math.min(E - 0.9, 2.75);
    const top = eaves - 0.3;
    // Square pillars at the outer corners, round columns between them, each on the low wall.
    for (const z of [-W + 0.22, W - 0.22]) g.add(box(0.42, top - low, 0.42, stone, x1 - 0.22, low, z));
    for (const [x, z] of [[x1 - 0.22, -gap / 2 - 0.2], [x1 - 0.22, gap / 2 + 0.2], [x0 + P * 0.45, -W + 0.22], [x0 + P * 0.45, W - 0.22]]) {
      g.add(mesh(new THREE.CylinderGeometry(0.15, 0.18, top - low - 0.2, 12), stone, x, low + (top - low - 0.2) / 2, z));
      g.add(box(0.36, 0.2, 0.36, stone, x, top - 0.2, z));
    }
    for (const z of [-W + 0.22, W - 0.22]) g.add(box(P, 0.25, 0.28, TIMBER(), (x0 + x1) / 2, top, z));
    g.add(box(0.28, 0.25, 2 * W, TIMBER(), x1 - 0.22, top, 0));
    const hw = W + 0.35;
    g.add(roof([[x1 + 0.35, hw], [x1 + 0.35, -hw], [x0, -hw], [x0, hw]], [x1 + 0.35 - hw * 0.8, 0], [x0, 0], eaves, eaves + 0.95, TILES()));
  }

  g.position.set(s.x, s.y, s.z);
  g.rotation.y = -s.face;
  return g;
}

// ---- The Capela de Santa Tecla (1729): white render framed in granite, a gable front over a full
// cornice, a pinnacle on each of its ends, the saint in a niche in the pediment and a great stone
// cross on a scrolled block at its apex; a dark green double door under the inscription and a
// cornice, a small barred window either side, granite steps up to it. Its front is narrower than its
// outline on the map: 6.2 m, as its photo shows it, the rest of the outline the quinta's. ----
const TECLA_FRONT = 3.1; // its front's half-width

function santaTecla(s: Chapel): THREE.Group {
  const g = new THREE.Group();
  const L = s.L;
  const W = Math.min(s.W, TECLA_FRONT);
  const T = s.top; // the cross's top
  const C = Math.max(s.eaves, T - 4.1); // the front's cornice, from its photo's proportions
  const A = T - 1.6; // the pediment's apex
  const E = s.eaves;
  const R = Math.max(s.ridge, E + 1);
  const F = L;
  const stone = STONE();

  // ---- The nave, white, its roof gabled; granite at its corners. ----
  g.add(box(2 * L - 0.5, E + 2, 2 * W, RENDER(), -0.25, -2, 0));
  g.add(gable(-L + 0.3, 0.3, -W, W, E - 0.05, E, R, RENDER()));
  g.add(roof([[F - 0.4, W + 0.3], [F - 0.4, -W - 0.3], [-L - 0.3, -W - 0.3], [-L - 0.3, W + 0.3]], [F - 0.4, 0], [-L - 0.3, 0], E - 0.1, R + 0.05, TILES()));
  for (const z of [-W, W]) g.add(box(0.5, E, 0.5, stone, -L + 0.25, 0, z));

  // ---- The front: its wall to the cornice, the pediment over it, all white render in granite. ----
  g.add(box(0.5, C + 2, 2 * W, RENDER(), F - 0.25, -2, 0));
  g.add(gable(F, 0.45, -W + 0.3, W - 0.3, C, C, A, RENDER()));
  // The pilasters at its corners, the frieze and the cornice over it, the pediment's raking cornices.
  for (const z of [-W + 0.33, W - 0.33]) g.add(box(0.62, C + 2, 0.66, stone, F - 0.2, -2, z));
  g.add(box(0.6, 0.38, 2 * W + 0.1, stone, F - 0.15, C - 0.75, 0), box(0.85, 0.32, 2 * W + 0.5, stone, F - 0.1, C - 0.32, 0));
  for (const [z0, z1] of [[-W - 0.15, 0], [W + 0.15, 0]]) rake(g, F - 0.05, z0, C + 0.25, z1, A + 0.2, 0.75, 0.3, stone);
  // The pinnacles: an obelisk on a block, a ball on it, at each end of the cornice.
  for (const z of [-W + 0.15, W - 0.15]) {
    g.add(box(0.5, 0.4, 0.5, stone, F - 0.2, C, z));
    g.add(mesh(new THREE.ConeGeometry(0.24, 1.2, 4).rotateY(Math.PI / 4), stone, F - 0.2, C + 1.0, z));
    g.add(mesh(new THREE.SphereGeometry(0.13, 10, 8), stone, F - 0.2, C + 1.68, z));
  }
  // The niche in the pediment, the saint in it, the corbel under it.
  {
    const nw = 0.36;
    const ny = C + 0.15;
    const nh = 1.25;
    g.add(box(0.1, nh, 2 * nw + 0.3, stone, F + 0.02, ny, 0));
    g.add(box(0.12, nh - 0.35, 2 * nw, DARK(), F + 0.05, ny + 0.08, 0));
    const top = mesh(new THREE.CylinderGeometry(nw, nw, 0.12, 12, 1, false, 0, Math.PI), DARK(), F + 0.05, ny + nh - 0.27, 0);
    top.rotation.set(0, 0, Math.PI / 2);
    g.add(top);
    g.add(mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.75, 10), stone, F + 0.18, ny + 0.45, 0), mesh(new THREE.SphereGeometry(0.1, 10, 8), stone, F + 0.18, ny + 0.92, 0));
    g.add(box(0.3, 0.45, 0.4, stone, F + 0.1, C - 1.1, 0));
  }
  // The cross on its scrolled block.
  g.add(box(0.35, 0.5, 0.55, stone, F - 0.2, A + 0.05, 0));
  stoneCross(g, F - 0.2, A + 0.5, 0, T - A - 0.5, stone);

  // ---- The door under its inscription and cornice, the windows, the steps. ----
  const sill = 0.5;
  opening(g, F, 0, sill, 1.55, 2.6, 1, GREEN(), 0.28);
  g.add(box(0.1, 2.6, 0.04, DARK(), F + 0.07, sill, 0));
  g.add(box(0.12, 0.5, 2.15, stone, F + 0.06, sill + 2.85, 0), box(0.3, 0.15, 2.5, stone, F + 0.12, sill + 3.35, 0));
  for (const z of [-1.95, 1.95]) {
    opening(g, F, z, 1.5, 0.48, 0.72, 1, DARK(), 0.24);
    for (const k of [-1, 1]) g.add(box(0.03, 0.72, 0.03, IRON(), F + 0.1, 1.5, z + k * 0.12));
  }
  for (const [k, w] of [[0, 2.2], [1, 2.6], [2, 3.0]]) g.add(box(0.35, sill - k * 0.17, w, stone, F + 0.18 + k * 0.35, 0, 0));

  g.position.set(s.x, s.y, s.z);
  g.rotation.y = -s.face;
  return g;
}

// ---- São Lázaro's bell tower (1969): two slabs of granite in courses, its full height, a slot
// between them where its two bells hang one over the other, an iron grille across the slot's foot.
// Where the LiDAR's outline of it dips, at its front to the street: the slot. ----
function saoLazaro(s: Tower): THREE.Group {
  const g = new THREE.Group();
  const { L, W } = s;
  const T = s.top;
  const z0 = -W + 0.45 * W; // the slot, across
  const z1 = z0 + 0.8;
  const m = ASHLAR();
  g.add(metres(box(2 * L, T + 2, z0 + W, m, 0, -2, (-W + z0) / 2), 2.5));
  g.add(metres(box(2 * L, T + 2, W - z1, m, 0, -2, (z1 + W) / 2), 2.5));
  // The slot's back, dark, a little way in; the bells near its front, a grille below them.
  const zm = (z0 + z1) / 2;
  g.add(box(0.2, T + 2, z1 - z0, DARK(), L - 1.6, -2, zm));
  bell(g, L - 0.7, T - 1.6, zm, 0.34);
  bell(g, L - 0.7, T - 3.4, zm, 0.38);
  g.add(box(0.06, 0.06, z1 - z0, IRON(), L - 0.7, T - 0.9, zm), box(0.06, 0.06, z1 - z0, IRON(), L - 0.7, T - 2.7, zm));
  for (let k = 0; k < 6; k++) g.add(box(0.04, 3.2, 0.04, IRON(), L - 0.3, 0, z0 + 0.07 + k * ((z1 - z0 - 0.14) / 5)));
  g.position.set(s.x, s.y, s.z);
  g.rotation.y = -s.face;
  return g;
}

// ---- The wayside shrines. ----

// The Senhor do Bonfim: a small square house in cream render, pilasters at its corners, a glazed
// double door in its front, panels below and small panes above, painted a pale blue-grey; a
// pyramidal roof of dark tiles; a granite step before it.
function bonfim(s: Shrine): THREE.Group {
  const g = new THREE.Group();
  const { L, W } = s;
  const top = s.top;
  const E = top - 1.0;
  const stone = STONE();
  const blue = mat('#a9b8c2', { roughness: 0.6 });
  g.add(box(2 * L, E + 1.5, 2 * W, CREAM(), 0, -1.5, 0));
  for (const z of [-W, W]) for (const x of [-L, L]) g.add(box(0.3, E + 1.5, 0.3, CREAM(), x - Math.sign(x) * 0.1, -1.5, z - Math.sign(z) * 0.1));
  g.add(box(2 * L + 0.2, 0.2, 2 * W + 0.2, CREAM(), 0, E - 0.2, 0));
  // The door: two leaves, the lower third panels, the rest glass in small panes.
  const dw = 2 * W - 0.6;
  const dh = E - 0.55;
  g.add(box(0.08, dh, dw, blue, L + 0.02, 0.25, 0));
  g.add(box(0.06, dh * 0.62, dw - 0.2, GLASS(), L + 0.05, 0.25 + dh * 0.33, 0));
  for (let k = 0; k <= 4; k++) g.add(box(0.05, dh * 0.62, 0.04, blue, L + 0.08, 0.25 + dh * 0.33, -dw / 2 + 0.1 + (k * (dw - 0.2)) / 4));
  for (let k = 0; k <= 4; k++) g.add(box(0.05, 0.04, dw - 0.2, blue, L + 0.08, 0.25 + dh * 0.33 + (k * dh * 0.62) / 4, 0));
  // The roof, its eaves a little out.
  const o = 0.28;
  const cone = mesh(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).scale(2 * L + 2 * o, top - E, 2 * W + 2 * o), TILES(), 0, E + (top - E) / 2, 0);
  g.add(cone, box(2 * L + 2 * o, 0.12, 2 * W + 2 * o, WOOD(), 0, E - 0.08, 0));
  g.add(box(1.0, 0.25, 2 * W + 0.4, stone, L + 0.5, 0, 0));
  g.position.set(s.x, s.y, s.z);
  g.rotation.y = -s.face;
  return g;
}

// The Senhor da Boa Morte: an open shrine, its front on two granite columns between square pillars,
// a white frieze with its name in dark letters, a hipped roof of tiles; its back and sides glazed,
// white curtains behind the glass, an altar under a white cloth inside; on a low granite base.
let boaMorteTex: THREE.Texture | null = null;
function boaMorte(s: Shrine): THREE.Group {
  const g = new THREE.Group();
  const { L, W } = s;
  const top = s.top;
  const E = top - 0.8;
  const stone = STONE();
  const base = 0.3;
  g.add(box(2 * L + 0.2, base + 1, 2 * W + 0.2, stone, 0, -1, 0));
  // The back and the sides: glass over white curtains.
  const pale = RENDER();
  g.add(box(0.1, E - base - 0.45, 2 * W - 0.2, pale, -L + 0.1, base, 0));
  for (const z of [-W + 0.1, W - 0.1]) g.add(box(2 * L - 0.3, E - base - 0.45, 0.1, pale, 0.1, base, z));
  // The pillars at its corners, the two columns in its front.
  for (const x of [-L + 0.15, L - 0.15]) for (const z of [-W + 0.15, W - 0.15]) g.add(box(0.3, E - base - 0.45, 0.3, stone, x, base, z));
  for (const z of [-W * 0.45, W * 0.45]) g.add(mesh(new THREE.CylinderGeometry(0.11, 0.13, E - base - 0.45, 10), stone, L - 0.15, base + (E - base - 0.45) / 2, z));
  // The frieze, its name on the front.
  g.add(box(2 * L + 0.05, 0.45, 2 * W + 0.05, RENDER(), 0, E - 0.45, 0));
  boaMorteTex ??= tex.drawTexture(
    512,
    64,
    (c) => {
      c.fillStyle = '#efece4';
      c.fillRect(0, 0, 512, 64);
      c.fillStyle = '#3a3a3a';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = '600 34px Georgia, serif';
      c.fillText('Senhor da Boa Morte', 256, 34);
    },
    false,
  );
  const name = new THREE.Mesh(new THREE.PlaneGeometry(2 * W - 0.1, (2 * W - 0.1) / 8), mat('#ffffff', { map: boaMorteTex, roughness: 0.8 }));
  name.rotation.y = Math.PI / 2;
  name.castShadow = false;
  name.position.set(L + 0.04, E - 0.22, 0);
  g.add(name);
  // The altar and its cloth.
  g.add(box(0.6, 0.85, 1.2, RENDER(), -L + 0.6, base, 0));
  // The roof.
  const o = 0.3;
  g.add(roof([[L + o, W + o], [L + o, -W - o], [-L - o, -W - o], [-L - o, W + o]], [L + o - (W + o) * 0.8, 0], [-L - o + (W + o) * 0.8, 0], E, top, TILES()));
  g.position.set(s.x, s.y, s.z);
  g.rotation.y = -s.face;
  return g;
}

export function routeChapel(s: Chapel): THREE.Group {
  if (s.id === 'santa-justa') return santaJusta(s);
  if (s.id === 'santo-adriao') return santoAdriao(s);
  return santaTecla(s);
}

export const saoLazaroTower = saoLazaro;

export function shrine(s: Shrine): THREE.Group {
  return s.id === 'bonfim' ? bonfim(s) : boaMorte(s);
}
