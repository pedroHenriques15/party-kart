// The streets' name plates (braga-map's task 042): at every corner in the area where a named street
// meets a street of another name, its plate, blue and white, on the corner building's wall where one
// stands at the corner, else on a post off the kerb; a post with two names has both, one over the
// other. Each plate is the same empty plate, the names' letters laid over it as quads cut from one
// canvas of every letter the names use, as the shops' signs are (signs.ts): every plate in the area is
// two meshes, and their posts a third.
import type { Plate } from 'braga-map';
import * as THREE from 'three';

const CELL = 64; // a letter's cell, in pixels, square
const FONT = '700 46px Georgia, "Times New Roman", serif';
const INK: [number, number, number] = [0.013, 0.05, 0.24]; // the names' blue, linear (#1f3f86)
const POST = 0.04; // a post's radius: six sides and no ends, as a thousand of them stand round the area

// The empty plate: white glazed tiles in a blue frame, 512 × 128 for a plate four times as wide as it's high.
function emptyPlate(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f7f8fb';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#7da1db';
  g.lineWidth = 2;
  for (let x = 64; x < 512; x += 64) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 128);
    g.stroke();
  }
  g.strokeStyle = '#2f5aa8';
  g.lineWidth = 8;
  g.strokeRect(10, 10, 492, 108);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Every plate, `size` [w, h] metres, its posts' feet at foot(x, z) and a post's plate as high over it as
// the map has it over the ground (height(x, z)); a wall's plate where the map puts it.
export function buildPlates(plates: Plate[], size: [number, number], foot: (x: number, z: number) => number, height: (x: number, z: number) => number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'street plates';
  if (!plates.length) return g;
  const [W, H] = size;

  // Every letter the names use, each in its cell, with its width.
  const chars = [...new Set(plates.flatMap((p) => [...p.name]))].filter((c) => c !== ' ');
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
  atlas.anisotropy = 8;

  const back: number[] = [];
  const backUv: number[] = [];
  const pos: number[] = [];
  const uv: number[] = [];
  // A quad from its corners, counter-clockwise as seen from where it faces, with their uvs.
  const quad = (out: number[], outUv: number[], p: number[][], q: number[][]) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      out.push(...p[i]);
      outUv.push(...q[i]);
    }
  };
  // A plate facing (nx, nz), its middle at (x, y, z): its face, and its name over it, a little out.
  const face = (x: number, y: number, z: number, nx: number, nz: number, name: string) => {
    // Facing it, its right is (nz, -nx).
    const rx = nz;
    const rz = -nx;
    const P = (a: number, b: number, out: number) => [x + rx * a + nx * out, y + b, z + rz * a + nz * out];
    quad(back, backUv, [P(-W / 2, -H / 2, 0), P(W / 2, -H / 2, 0), P(W / 2, H / 2, 0), P(-W / 2, H / 2, 0)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const text = [...name];
    const width = text.reduce((a, ch) => a + (glyph.get(ch)?.w ?? space), 0);
    const em = Math.min(H * 0.62, (W * 0.86 * CELL) / width);
    const px = em / CELL;
    let at = -(width * px) / 2;
    const base = -em * 0.22;
    for (const ch of text) {
      const gl = glyph.get(ch);
      if (!gl) {
        at += space * px;
        continue;
      }
      const w = gl.w * px;
      const u0 = gl.u / c.width;
      const u1 = (gl.u + gl.w) / c.width;
      const v0 = 1 - (gl.v + CELL) / c.height;
      const v1 = 1 - gl.v / c.height;
      quad(pos, uv, [P(at, base - em * 0.25, 0.005), P(at + w, base - em * 0.25, 0.005), P(at + w, base + em * 0.75, 0.005), P(at, base + em * 0.75, 0.005)], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      at += w;
    }
  };

  const posts = new Map<string, { x: number; z: number; y0: number; y1: number }>();
  for (const p of plates) {
    const nx = Math.cos(p.face);
    const nz = Math.sin(p.face);
    if (p.on === 'wall') {
      face(p.x, p.y + H / 2, p.z, nx, nz, p.name);
      continue;
    }
    // On a post: its foot on the pavement as it's drawn, the plate on its side towards its street, and
    // the same on the other side.
    const y0 = foot(p.x, p.z);
    const y = y0 + p.y - height(p.x, p.z) + H / 2;
    face(p.x + nx * (POST + 0.03), y, p.z + nz * (POST + 0.03), nx, nz, p.name);
    face(p.x + nx * (POST + 0.01), y, p.z + nz * (POST + 0.01), -nx, -nz, p.name);
    const key = `${p.x},${p.z}`;
    const post = posts.get(key) ?? { x: p.x, z: p.z, y0, y1: y0 };
    post.y1 = Math.max(post.y1, y + H / 2 + 0.08);
    posts.set(key, post);
  }

  const plateGeo = new THREE.BufferGeometry();
  plateGeo.setAttribute('position', new THREE.Float32BufferAttribute(back, 3));
  plateGeo.setAttribute('uv', new THREE.Float32BufferAttribute(backUv, 2));
  plateGeo.computeVertexNormals();
  const plateMesh = new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({ map: emptyPlate(), roughness: 0.25 }));
  plateMesh.receiveShadow = true;
  g.add(plateMesh);
  const letters = new THREE.BufferGeometry();
  letters.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  letters.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  letters.computeVertexNormals();
  const ink = new THREE.Color().setRGB(...INK, THREE.LinearSRGBColorSpace);
  const lm = new THREE.Mesh(letters, new THREE.MeshStandardMaterial({ color: ink, alphaMap: atlas, alphaTest: 0.4, roughness: 0.25, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  lm.receiveShadow = true;
  g.add(lm);
  if (posts.size) {
    const m = new THREE.InstancedMesh(new THREE.CylinderGeometry(POST, POST, 1, 6, 1, true).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#3a3d42', metalness: 0.5, roughness: 0.5 }), posts.size);
    let i = 0;
    const s = new THREE.Matrix4();
    for (const p of posts.values()) m.setMatrixAt(i++, s.makeScale(1, p.y1 - p.y0, 1).setPosition(p.x, p.y0, p.z));
    m.castShadow = true;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    g.add(m);
  }
  return g;
}
