// São João da Ponte's chapel (1616), in the park by the Largo, as its photos show it (braga-map's
// task 021): white render framed in dressed granite. Its front looks to the square before it: on
// the left, seen from there, a two-storey bell block under a bell gable with two bells in arches, a
// curved pediment and three finials, an iron cross on the middle one; on the right the nave's gable
// with a stone cross and a pinnacle at each corner, and before its door a porch of granite columns
// on a low wall under a hipped tile roof. Three windows high and two low along its side, and on its
// back a carved granite altar. Its size and heights are the map's, as the LiDAR measured its parts.
import type { Sight } from 'braga-map';
import * as THREE from 'three';
import { box, mat, mesh, slab } from './kit.ts';
import * as tex from './textures.ts';

type Chapel = Extract<Sight, { kind: 'saojoao' }>;

// Its materials, made once: a texture drawn anew would be a material of its own, and a draw call.
let stoneMat: THREE.Material | null = null;
let tilesMat: THREE.Material | null = null;
const RENDER = () => mat('#f1eee6', { roughness: 0.9 });
export const STONE = () => (stoneMat ??= mat('#d6d0c3', { map: tex.granite(), roughness: 0.9 }));
const DARK = () => mat('#262a2e', { roughness: 0.5 });
const DOOR = () => mat('#2f5b3d', { roughness: 0.6 });
export const TILES = () => (tilesMat ??= mat('#6c3424', { map: tex.roofTiles(), roughness: 0.8 }));
const BRONZE = () => mat('#6b5a3a', { roughness: 0.4, metalness: 0.6 });
const IRON = () => mat('#1d1f22', { roughness: 0.5, metalness: 0.4 });

// The porch's depth, out from the front wall, and its width, along it from the chapel's left side
// (the west, seen from outside); the bell block's depth, back from the front wall.
const PORCH = 4.8;
const PORCH_W = 5.8;
const BLOCK = 5;

// A hipped roof w along x and d along z, h high, its eaves at y.
export function hipped(w: number, d: number, h: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).scale(w, h, d);
  return mesh(g, m, x, y + h / 2, z);
}

// A window or a door in a wall facing +x (or -x, out = -1) at (x, z), its sill at y: the dark pane
// a little out from the wall, a frame of dressed granite round it.
export function opening(g: THREE.Group, x: number, z: number, y: number, w: number, h: number, out: 1 | -1, pane: THREE.Material, frame = 0.16): void {
  g.add(box(0.06, h, w, pane, x + out * 0.03, y, z));
  const fx = x + out * 0.06;
  g.add(box(0.1, frame, w + 2 * frame, STONE(), fx, y - frame, z), box(0.1, frame, w + 2 * frame, STONE(), fx, y + h, z));
  for (const s of [-1, 1]) g.add(box(0.1, h, frame, STONE(), fx, y, z + s * (w / 2 + frame / 2)));
}

// The same in a wall facing +z (out = 1) or -z.
export function sideOpening(g: THREE.Group, x: number, z: number, y: number, w: number, h: number, out: 1 | -1, pane: THREE.Material, frame = 0.16): void {
  g.add(box(w, h, 0.06, pane, x, y, z + out * 0.03));
  const fz = z + out * 0.06;
  g.add(box(w + 2 * frame, frame, 0.1, STONE(), x, y - frame, fz), box(w + 2 * frame, frame, 0.1, STONE(), x, y + h, fz));
  for (const s of [-1, 1]) g.add(box(frame, h, 0.1, STONE(), x + s * (w / 2 + frame / 2), y, fz));
}

// A finial: an urn on a block.
export function finial(g: THREE.Group, x: number, y: number, z: number, s = 1): void {
  g.add(box(0.4 * s, 0.25 * s, 0.4 * s, STONE(), x, y, z));
  g.add(mesh(new THREE.SphereGeometry(0.2 * s, 10, 8), STONE(), x, y + 0.42 * s, z));
  g.add(mesh(new THREE.ConeGeometry(0.08 * s, 0.3 * s, 8), STONE(), x, y + 0.72 * s, z));
}

// A pinnacle: a granite pyramid on a block.
export function pinnacle(g: THREE.Group, x: number, y: number, z: number): void {
  g.add(box(0.5, 0.35, 0.5, STONE(), x, y, z));
  g.add(mesh(new THREE.ConeGeometry(0.22, 0.9, 4).rotateY(Math.PI / 4), STONE(), x, y + 0.8, z));
}

export function saoJoaoChapel(s: Chapel): THREE.Group {
  const g = new THREE.Group();
  const { L, W } = s;
  const E = s.eaves; // the nave's eaves and ridge
  const R = Math.max(s.ridge, E + 1.2);
  const C = Math.max(E + 1.2, s.top - 3); // the bell block's cornice, the bell gable over it
  const T = s.top;
  const front = L - PORCH; // the front wall, x
  const back = -L;
  const split = -W + PORCH_W; // the nave's front, then the bell block's, along z
  const wall = RENDER();
  const stone = STONE();

  // ---- The nave: its walls to the eaves, its gable at the back, its roof. ----
  g.add(box(front - back, E, 2 * W, wall, (front + back) / 2, 0, 0));
  {
    const tri = new THREE.Shape();
    tri.moveTo(-W, 0);
    tri.lineTo(W, 0);
    tri.lineTo(0, R - E);
    tri.closePath();
    const gableEnd = slab(tri, 0.4, wall);
    gableEnd.rotation.y = Math.PI / 2;
    gableEnd.position.set(back + 0.2, E, 0);
    g.add(gableEnd);
  }
  {
    // Each slope from the ridge to 35 cm past the eaves.
    const out = W + 0.35;
    const drop = R + 0.15 - (E - 0.05);
    const pitch = Math.atan2(drop, out);
    // From 35 cm past the back to behind the front's gable and bell block.
    const [x0, x1] = [back - 0.35, front - 0.7];
    for (const side of [-1, 1]) {
      const plane = box(x1 - x0, 0.12, Math.hypot(out, drop), TILES(), 0, 0, 0);
      plane.geometry.translate(0, -0.06, 0);
      plane.position.set((x0 + x1) / 2, R + 0.15 - drop / 2, (side * out) / 2);
      plane.rotation.x = side * pitch;
      g.add(plane);
    }
  }
  // The plinth, down into the ground where it falls away, the cornice along the eaves, and the
  // corners' pilasters.
  g.add(box(front - back + 0.16, 1.45, 2 * W + 0.16, stone, (front + back) / 2, -1, 0));
  for (const side of [-1, 1]) g.add(box(front - back + 0.2, 0.25, 0.3, stone, (front + back) / 2, E - 0.25, side * W));
  for (const [x, z] of [[back, -W], [back, W], [front, -W], [front, W], [front, split]]) g.add(box(0.55, E, 0.55, stone, x, 0, z));

  // ---- Its sides: three windows high and two low along the east, as on its photo; two high and a
  // door along the west. ----
  const span = front - back;
  for (const f of [0.28, 0.55, 0.82]) sideOpening(g, back + span * f, W, 3.2, 0.95, 1.45, 1, DARK());
  for (const f of [0.28, 0.55]) sideOpening(g, back + span * f, W, 0.9, 0.55, 0.45, 1, DARK());
  for (const f of [0.3, 0.6]) sideOpening(g, back + span * f, -W, 3.2, 0.95, 1.45, -1, DARK());
  sideOpening(g, back + span * 0.82, -W, 0, 1.1, 2.3, -1, DOOR());

  // ---- The carved altar on its back, under a granite frame between twisted columns. ----
  {
    const ax = back - 0.05;
    g.add(box(0.5, 1.3, 2.6, stone, ax - 0.2, 0, 0));
    g.add(box(0.12, 3.2, 1.5, DARK(), ax - 0.05, 1.3, 0));
    for (const z of [-1, 1]) {
      const col = mesh(new THREE.CylinderGeometry(0.16, 0.18, 3.2, 10), stone, ax - 0.25, 2.9, z * 0.95);
      g.add(col);
    }
    g.add(box(0.45, 0.45, 2.6, stone, ax - 0.2, 4.5, 0));
    g.add(box(0.3, 0.5, 1.2, stone, ax - 0.2, 4.95, 0));
  }

  // ---- The nave's front: a gable wall over the porch, a window in it, a pinnacle at each corner and
  // a stone cross on top. ----
  {
    const mid = (-W + split) / 2;
    const top = C + 1.4;
    const shape = new THREE.Shape();
    shape.moveTo(-W, 0);
    shape.lineTo(split, 0);
    shape.lineTo(split, C);
    shape.lineTo(mid, top);
    shape.lineTo(-W, C);
    shape.closePath();
    const face = slab(shape, 0.6, wall);
    face.rotation.y = -Math.PI / 2;
    face.position.set(front - 0.3, 0, 0);
    g.add(face);
    // Its coping, granite along both slopes.
    const slope = Math.hypot(mid + W, top - C);
    for (const [z0, z1] of [[-W, mid], [split, mid]]) {
      const c = box(0.75, 0.22, slope + 0.2, stone, front - 0.3, 0, (z0 + z1) / 2);
      c.position.y = (C + top) / 2 - 0.05;
      // Its high end at the apex.
      c.rotation.x = -Math.sign(z1 - z0) * Math.atan2(top - C, Math.abs(z1 - z0));
      g.add(c);
    }
    pinnacle(g, front, C, -W);
    pinnacle(g, front, C, split);
    // The cross.
    g.add(box(0.3, 0.3, 0.3, stone, front - 0.3, top - 0.05, mid));
    g.add(box(0.16, 1.3, 0.16, stone, front - 0.3, top + 0.2, mid), box(0.16, 0.16, 0.8, stone, front - 0.3, top + 1.0, mid));
    opening(g, front, mid, C - 2.0, 0.8, 1.0, 1, DARK());
  }

  // ---- The bell block: two storeys, two windows over a small one and a green door, a cornice;
  // over it the bell gable, two bells in arches, its curved pediment and three finials, an iron
  // cross on the middle one. ----
  {
    const z0 = split;
    const z1 = W;
    const zm = (z0 + z1) / 2;
    const w = z1 - z0;
    g.add(box(BLOCK, C, w, wall, front - BLOCK / 2, 0, zm));
    g.add(hipped(BLOCK + 0.4, w + 0.4, 0.9, TILES(), front - BLOCK / 2 - 0.4, C, zm));
    g.add(box(BLOCK + 0.2, 0.3, w + 0.2, stone, front - BLOCK / 2, C - 0.3, zm));
    g.add(box(0.55, C, 0.55, stone, front, 0, z1), box(0.55, C, 0.55, stone, front - BLOCK, 0, z1));
    g.add(box(0.15, 0.25, w, stone, front + 0.05, C * 0.5, zm));
    for (const f of [0.3, 0.7]) opening(g, front, z0 + w * f, C * 0.5 + 0.6, 1.0, 1.45, 1, DARK());
    opening(g, front, z0 + w * 0.72, 1.5, 0.6, 0.5, 1, DARK());
    opening(g, front, z0 + w * 0.3, 0.05, 1.05, 2.3, 1, DOOR());
    // The bell gable, its front flush with the block's.
    const bw = w - 1.2;
    const bh = T - C - 0.6;
    const shape = new THREE.Shape();
    shape.moveTo(-bw / 2, 0);
    shape.lineTo(bw / 2, 0);
    shape.lineTo(bw / 2, bh);
    shape.quadraticCurveTo(bw * 0.25, bh + 0.15, 0, bh + 0.6);
    shape.quadraticCurveTo(-bw * 0.25, bh + 0.15, -bw / 2, bh);
    shape.closePath();
    for (const c of [-0.24, 0.24]) {
      const hole = new THREE.Path();
      const hw = bw * 0.16;
      hole.moveTo(c * bw - hw, bh * 0.25);
      hole.lineTo(c * bw + hw, bh * 0.25);
      hole.lineTo(c * bw + hw, bh * 0.68);
      hole.absarc(c * bw, bh * 0.68, hw, 0, Math.PI, false);
      hole.lineTo(c * bw - hw, bh * 0.25);
      shape.holes.push(hole);
    }
    const bell = slab(shape, 0.7, wall);
    bell.rotation.y = -Math.PI / 2;
    bell.position.set(front - 0.35, C, zm);
    g.add(bell);
    // Its granite: the sill, the cornice under the pediment, the arches' frames.
    g.add(box(0.85, 0.25, bw + 0.3, stone, front - 0.35, C, zm), box(0.85, 0.22, bw + 0.3, stone, front - 0.35, C + bh - 0.1, zm));
    for (const c of [-0.24, 0.24]) {
      g.add(box(0.8, bh * 0.45, 0.12, stone, front - 0.35, C + bh * 0.25, zm + c * bw - bw * 0.16 - 0.06));
      g.add(box(0.8, bh * 0.45, 0.12, stone, front - 0.35, C + bh * 0.25, zm + c * bw + bw * 0.16 + 0.06));
      // The bell, hanging in its arch.
      g.add(mesh(new THREE.CylinderGeometry(0.16, 0.34, 0.55, 12, 1, true), BRONZE(), front - 0.35, C + bh * 0.42, zm + c * bw));
      g.add(mesh(new THREE.SphereGeometry(0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), BRONZE(), front - 0.35, C + bh * 0.42 + 0.27, zm + c * bw));
    }
    for (const z of [zm - bw / 2, zm + bw / 2]) finial(g, front - 0.35, C + bh, z, 1);
    finial(g, front - 0.35, C + bh + 0.55, zm, 1.2);
    // The iron cross over the middle finial.
    const cy = C + bh + 0.55 + 1.0;
    g.add(box(0.05, 0.9, 0.05, IRON(), front - 0.35, cy, zm), box(0.05, 0.05, 0.5, IRON(), front - 0.35, cy + 0.6, zm));
  }

  // ---- The porch: a low granite wall, open before the door, granite columns on it, a hipped tile
  // roof on a timber frame. ----
  {
    const x0 = front;
    const x1 = front + PORCH;
    const z0 = -W;
    const z1 = -W + PORCH_W;
    const zm = (z0 + z1) / 2;
    const low = 0.75;
    const gap = 1.7;
    g.add(box(0.4, low, (PORCH_W - gap) / 2, stone, x1 - 0.2, 0, z0 + (PORCH_W - gap) / 4));
    g.add(box(0.4, low, (PORCH_W - gap) / 2, stone, x1 - 0.2, 0, z1 - (PORCH_W - gap) / 4));
    for (const z of [z0 + 0.2, z1 - 0.2]) g.add(box(PORCH, low, 0.4, stone, (x0 + x1) / 2, 0, z));
    g.add(box(PORCH, 0.12, PORCH_W, stone, (x0 + x1) / 2, 0, zm));
    const eaves = Math.max(2.8, s.porch - 0.4);
    const columns: [number, number][] = [
      [x1 - 0.2, z0 + 0.2],
      [x1 - 0.2, zm - gap / 2 - 0.2],
      [x1 - 0.2, zm + gap / 2 + 0.2],
      [x1 - 0.2, z1 - 0.2],
      [(x0 + x1) / 2, z0 + 0.2],
      [(x0 + x1) / 2, z1 - 0.2],
    ];
    for (const [x, z] of columns) {
      // Each stands on the low wall.
      const base = low;
      g.add(mesh(new THREE.CylinderGeometry(0.15, 0.18, eaves - base - 0.3, 12), stone, x, base + (eaves - base - 0.3) / 2, z));
      g.add(box(0.36, 0.14, 0.36, stone, x, eaves - 0.3, z));
    }
    // The frame round its top, and the roof.
    g.add(box(PORCH, 0.22, 0.25, mat('#5a4635'), (x0 + x1) / 2, eaves - 0.18, z0 + 0.2), box(PORCH, 0.22, 0.25, mat('#5a4635'), (x0 + x1) / 2, eaves - 0.18, z1 - 0.2));
    g.add(box(0.25, 0.22, PORCH_W, mat('#5a4635'), x1 - 0.2, eaves - 0.18, zm));
    g.add(hipped(PORCH + 0.8, PORCH_W + 0.8, 1.3, TILES(), (x0 + x1) / 2 + 0.2, eaves, zm));
    // The door under it, a window either side.
    opening(g, front, zm, 0.05, 1.5, 2.8, 1, mat('#1e1a17'));
    for (const z of [zm - 1.7, zm + 1.7]) opening(g, front, z, 1.0, 0.65, 0.95, 1, DARK());
  }

  g.position.set(s.x, s.y, s.z);
  g.rotation.y = -s.face;
  return g;
}
