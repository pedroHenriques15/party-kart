// The shops' signs (braga-map's task 017): each shop, café, bank or office the map names, its name as
// plain text over its ground floor, on a fascia in the sign's colour; no logos. The letters are quads
// cut from one canvas of every letter the signs use, so all the signs are two meshes.
import type { Sign } from 'braga-map';
import * as THREE from 'three';
import { anisotropy } from './look.ts';
import { linearOf } from './facades.ts';

const CELL = 64; // a letter's cell, in pixels, square
const FONT = '600 46px "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const DEPTH = 0.1; // how far a fascia stands out from its wall

export function buildSigns(signs: Sign[], colours: Record<string, [number, number, number]>): THREE.Group {
  const g = new THREE.Group();
  g.name = 'signs';
  if (!signs.length) return g;
  // Every letter the signs use, each in its cell, with its width.
  const chars = [...new Set(signs.flatMap((s) => [...s.text]))].filter((c) => c !== ' ');
  const cols = 16;
  const rows = Math.ceil(chars.length / cols);
  const c = document.createElement('canvas');
  c.width = cols * CELL;
  c.height = Math.max(1, rows) * CELL;
  const k = c.getContext('2d')!;
  k.font = FONT;
  k.fillStyle = '#fff';
  k.textBaseline = 'alphabetic';
  const glyph = new Map<string, { u: number; v: number; w: number }>();
  chars.forEach((ch, i) => {
    const x = (i % cols) * CELL;
    const y = Math.floor(i / cols) * CELL;
    const w = Math.min(CELL - 4, k.measureText(ch).width);
    k.fillText(ch, x + 2, y + 48, CELL - 4);
    glyph.set(ch, { u: x + 2, v: y, w });
  });
  const space = k.measureText(' ').width;
  const atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = anisotropy();

  const box: number[] = [];
  const boxN: number[] = [];
  const boxC: number[] = [];
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  // A quad facing n, its corners round its edge either way; each corner's index into p, as laid, for
  // its uvs.
  const quad = (out: number[], ns: number[] | null, p: number[][], n: number[]): number[] => {
    const e1 = [0, 1, 2].map((i) => p[1][i] - p[0][i]);
    const e2 = [0, 1, 2].map((i) => p[2][i] - p[0][i]);
    const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const order = c[0] * n[0] + c[1] * n[1] + c[2] * n[2] >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const i of order) {
      out.push(...p[i]);
      if (ns) ns.push(...n);
    }
    return order;
  };
  for (const s of signs) {
    const [x0, z0] = s.from;
    const [x1, z1] = s.to;
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 0.5) continue;
    const dx = (x1 - x0) / L;
    const dz = (z1 - z0) / L;
    // It faces (dz, -dx), out from its wall.
    const nx = dz;
    const nz = -dx;
    const y0 = s.y;
    const y1 = s.y + s.h;
    const P = (along: number, y: number, out: number) => [x0 + dx * along + nx * out, y, z0 + dz * along + nz * out];
    const bg = linearOf(colours[s.colour] ?? [70, 70, 70]);
    // The fascia: its front, top, bottom and ends.
    const f = DEPTH - 0.05;
    const faces: [number[][], number[]][] = [
      [[P(0, y0, f), P(L, y0, f), P(L, y1, f), P(0, y1, f)], [nx, 0, nz]],
      [[P(0, y1, f), P(L, y1, f), P(L, y1, -0.05), P(0, y1, -0.05)], [0, 1, 0]],
      [[P(0, y0, -0.05), P(L, y0, -0.05), P(L, y0, f), P(0, y0, f)], [0, -1, 0]],
      [[P(0, y0, -0.05), P(0, y0, f), P(0, y1, f), P(0, y1, -0.05)], [-dx, 0, -dz]],
      [[P(L, y0, f), P(L, y0, -0.05), P(L, y1, -0.05), P(L, y1, f)], [dx, 0, dz]],
    ];
    for (const [p, n] of faces) {
      quad(box, boxN, p, n);
      for (let i = 0; i < 6; i++) boxC.push(...bg);
    }
    // Its name, as wide as the fascia lets it be, a little in front of it: white on a dark sign, near
    // black on a light one.
    const text = [...s.text];
    const width = text.reduce((a, ch) => a + (glyph.get(ch)?.w ?? space), 0);
    const lum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
    const ink = lum > 0.35 ? [0.02, 0.02, 0.02] : [0.92, 0.92, 0.9];
    const em = Math.min(s.h * 0.62, ((L - 0.3) * CELL) / width);
    const px = em / CELL;
    let at = (L - width * px) / 2;
    const base = y0 + (s.h - em) / 2 - em * 0.08;
    // Facing it, `to` is on its left: the name runs from there.
    const Q = (a: number, y: number) => P(L - a, y, f + 0.01);
    for (const ch of text) {
      const gl = glyph.get(ch);
      if (!gl) {
        at += space * px;
        continue;
      }
      const w = gl.w * px;
      const order = quad(pos, null, [Q(at, base), Q(at + w, base), Q(at + w, base + em), Q(at, base + em)], [nx, 0, nz]);
      const u0 = gl.u / c.width;
      const u1 = (gl.u + gl.w) / c.width;
      const v0 = 1 - (gl.v + CELL) / c.height;
      const v1 = 1 - gl.v / c.height;
      const corner = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      for (const i of order) uv.push(...corner[i]);
      for (let i = 0; i < 6; i++) col.push(...ink);
      at += w;
    }
  }
  const fascia = new THREE.BufferGeometry();
  fascia.setAttribute('position', new THREE.Float32BufferAttribute(box, 3));
  fascia.setAttribute('normal', new THREE.Float32BufferAttribute(boxN, 3));
  fascia.setAttribute('color', new THREE.Float32BufferAttribute(boxC, 3));
  const fm = new THREE.Mesh(fascia, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
  fm.castShadow = true;
  fm.receiveShadow = true;
  g.add(fm);
  const letters = new THREE.BufferGeometry();
  letters.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  letters.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  letters.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  letters.computeVertexNormals();
  const lm = new THREE.Mesh(letters, new THREE.MeshStandardMaterial({ vertexColors: true, alphaMap: atlas, alphaTest: 0.4, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  lm.receiveShadow = true;
  g.add(lm);
  return g;
}
