// The Estádio 1.º de Maio (1950), as the LiDAR measured it (braga-map's task 021, its
// tools/sights.mjs): a bowl of concrete terraces round an athletics track, each spoke of the stands
// stepped as they rise, a metre a step; walled outside, granite courses under pale render between
// pilasters with two rows of tall windows, as its photos show it from the streets round it; its main
// stand on the west under a roof; and four floodlights on their masts, at their places and heights.
import type { Sight, Stands } from 'braga-map';
import * as THREE from 'three';
import { box, mat, mesh, type Ground } from './kit.ts';
import * as tex from './textures.ts';

type Stadium = Extract<Sight, { kind: 'stadium' }>;

const PARAPET = 1.0; // the outer wall's parapet, over the top step
const ROOF = 2.5; // a jump this high along a spoke is a roof over the steps, not a step

// Triangles with their own flat normals, and a uv each.
class Faces {
  pos: number[] = [];
  uv: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[], uv?: number[][]): void {
    const [ua, ub, uc, ud] = uv ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    this.uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud);
  }
  mesh(m: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return mesh(g, m);
  }
}

// Each spoke where it starts on the track's oval and the way it runs out, in the map; and the
// boundary halfway to the next one, to which its steps reach.
function frames(s: Stadium, st: Stands) {
  const [ax, az] = [Math.cos(s.angle), Math.sin(s.angle)];
  const [cx, cz] = [-Math.sin(s.angle), Math.cos(s.angle)];
  const { S, R0 } = st;
  const n = st.spokes.length;
  const per = 4 * S + 2 * Math.PI * R0;
  const arc = Math.PI * R0;
  const spoke = st.spokes.map((_, k) => {
    let d = (k / n) * per;
    let p: [number, number, number, number];
    if (d < arc) {
      const th = -Math.PI / 2 + d / R0;
      p = [S + R0 * Math.cos(th), R0 * Math.sin(th), Math.cos(th), Math.sin(th)];
    } else if ((d -= arc) < 2 * S) p = [S - d, R0, 0, 1];
    else if ((d -= 2 * S) < arc) {
      const th = Math.PI / 2 + d / R0;
      p = [-S + R0 * Math.cos(th), R0 * Math.sin(th), Math.cos(th), Math.sin(th)];
    } else p = [-S + (d - arc), -R0, 0, -1];
    const [ps, pt, ns, nt] = p;
    return { x: s.x + ax * ps + cx * pt, z: s.z + az * ps + cz * pt, nx: ax * ns + cx * nt, nz: az * ns + cz * nt };
  });
  // The boundary between spoke k and k + 1: from halfway between their feet, along their ways out.
  const edge = spoke.map((a, k) => {
    const b = spoke[(k + 1) % n];
    const L = Math.hypot(a.nx + b.nx, a.nz + b.nz) || 1;
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, nx: (a.nx + b.nx) / L, nz: (a.nz + b.nz) / L };
  });
  return { spoke, edge };
}

export function stadium(s: Stadium, ground: Ground): THREE.Group {
  const g = new THREE.Group();
  const y0 = s.y;

  // ---- The running track: red, round the pitch, its bends round (±S, 0) on the pitch's axis. ----
  {
    const S = s.stands?.S ?? 42.2;
    const [ax, az] = [Math.cos(s.angle), Math.sin(s.angle)];
    const [cx, cz] = [-Math.sin(s.angle), Math.cos(s.angle)];
    const P = (ps: number, pt: number): [number, number] => [s.x + ax * ps + cx * pt, s.z + az * ps + cz * pt];
    const oval = (r: number, k: number, n: number): [number, number] => {
      const per = 4 * S + 2 * Math.PI * r;
      let d = (k / n) * per;
      const arc = Math.PI * r;
      if (d < arc) return P(S + r * Math.cos(-Math.PI / 2 + d / r), r * Math.sin(-Math.PI / 2 + d / r));
      if ((d -= arc) < 2 * S) return P(S - d, r);
      if ((d -= 2 * S) < arc) return P(-S + r * Math.cos(Math.PI / 2 + d / r), r * Math.sin(Math.PI / 2 + d / r));
      return P(-S + (d - arc), -r);
    };
    const f = new Faces();
    const n = 120;
    for (let k = 0; k < n; k++) {
      const [a, b, c, d] = [oval(36.5, k, n), oval(36.5, k + 1, n), oval(44, k + 1, n), oval(44, k, n)];
      f.quad([a[0], y0 + 0.06, a[1]], [d[0], y0 + 0.06, d[1]], [c[0], y0 + 0.06, c[1]], [b[0], y0 + 0.06, b[1]]);
    }
    g.add(f.mesh(mat('#b4553f', { roughness: 0.9 })));
  }

  // ---- The stands, from the measured spokes. ----
  const st = s.stands;
  if (st) {
    const { spoke, edge } = frames(s, st);
    const n = spoke.length;
    const steps = new Faces();
    const walls = new Faces();
    const roofs = new Faces();
    // A point r metres out along boundary e, at y.
    const at = (e: { x: number; z: number; nx: number; nz: number }, r: number, y: number) => [e.x + e.nx * r, y, e.z + e.nz * r];
    // Each spoke's steps, as drawn: under a roof, the steps go on at the slope they had.
    const drawn = st.spokes.map(({ from, h }) => {
      const steps = [...h];
      let roof: { j: number; y: number } | null = null;
      for (let j = 4; j < h.length; j++) {
        if (h[j] - h[j - 1] < ROOF || !h.slice(j).every((v) => v > h[j - 1] + ROOF * 0.6)) continue;
        const slope = Math.max(0.2, (h[j - 1] - h[j - 4]) / 3);
        roof = { j, y: Math.max(...h.slice(j)) };
        for (let i = j; i < h.length; i++) steps[i] = Math.min(roof.y - 2.6, h[j - 1] + slope * (i - j + 1));
        break;
      }
      return { from, steps, roof };
    });
    const r = (from: number, j: number) => (from + j - 0.5) * st.dr;
    // The outer wall: one ring round the stands, its top running level where the spokes' last steps
    // were measured a little up and down (each the middle of the nine round it, then the mean of five),
    // and at each boundary between two spokes as far out as the further of their ends and as high as
    // the two together.
    const tops = drawn.map((q) => (q.roof ? q.roof.y : q.steps.length ? q.steps[q.steps.length - 1] + PARAPET : 0));
    const around = (list: number[], d: number[], pick: (v: number[]) => number) => list.map((_, k) => pick(d.map((o) => list[(k + o + n) % n]).filter((v) => v > 0)));
    const middle = around(tops, [-4, -3, -2, -1, 0, 1, 2, 3, 4], (v) => [...v].sort((p, q) => p - q)[v.length >> 1]);
    const level = around(middle, [-2, -1, 0, 1, 2], (v) => v.reduce((p, q) => p + q, 0) / v.length);
    const ends = drawn.map((q) => (q.steps.length ? r(q.from, q.steps.length) : 0));
    const ring = edge.map((_, k) => ({ R: Math.max(ends[k], ends[(k + 1) % n]), top: (level[k] + level[(k + 1) % n]) / 2 }));
    let u = 0; // along the outer wall, for its texture
    for (let k = 0; k < n; k++) {
      const { from, steps: h, roof } = drawn[k];
      if (!h.length) continue;
      const a = edge[(k - 1 + n) % n];
      const b = edge[k];
      const end = r(from, h.length);
      // The first step's front, from the track; then each step's tread and the riser up to the next.
      steps.quad(at(a, r(from, 0), y0), at(b, r(from, 0), y0), at(b, r(from, 0), h[0]), at(a, r(from, 0), h[0]));
      for (let j = 0; j < h.length; j++) {
        const [r0, r1] = [r(from, j), r(from, j + 1)];
        steps.quad(at(a, r0, h[j]), at(b, r0, h[j]), at(b, r1, h[j]), at(a, r1, h[j]));
        if (j + 1 < h.length) steps.quad(at(a, r1, h[j]), at(b, r1, h[j]), at(b, r1, h[j + 1]), at(a, r1, h[j + 1]));
      }
      // Where the next spoke's steps stand higher or lower, the step between them.
      const next = drawn[(k + 1) % n];
      for (let j = 0; j < h.length; j++) {
        const rr = (from + j) * st.dr;
        const i = Math.round(rr / st.dr - next.from);
        const other = i >= 0 && i < next.steps.length ? next.steps[i] : null;
        const [px, , pz] = at(b, rr, 0);
        const lo = other ?? ground(px, pz);
        if (Math.abs(h[j] - lo) < 0.05) continue;
        steps.quad(at(b, r(from, j), Math.min(h[j], lo)), at(b, r(from, j + 1), Math.min(h[j], lo)), at(b, r(from, j + 1), Math.max(h[j], lo)), at(b, r(from, j), Math.max(h[j], lo)));
      }
      // Its stretch of the ring: from the boundary before to the one after.
      const [A, B] = [ring[(k - 1 + n) % n], ring[k]];
      const last = h[h.length - 1];
      // Behind its last step, to the wall, at that step's height: a walkway where it stops short.
      steps.quad(at(a, end, last), at(b, end, last), at(b, B.R, last), at(a, A.R, last));
      if (roof) {
        // The roof over the main stand: a slab from where the jump is to the wall, and its front edge.
        const r0 = r(from, roof.j);
        roofs.quad(at(a, r0, A.top), at(b, r0, B.top), at(b, B.R, B.top), at(a, A.R, A.top));
        roofs.quad(at(a, r0, A.top - 0.5), at(a, A.R, A.top - 0.5), at(b, B.R, B.top - 0.5), at(b, r0, B.top - 0.5));
        roofs.quad(at(a, r0, A.top - 0.5), at(b, r0, B.top - 0.5), at(b, r0, B.top), at(a, r0, A.top));
      } else {
        // The parapet: its inside face from the walkway up, and its top.
        steps.quad(at(a, A.R - 0.3, last), at(b, B.R - 0.3, last), at(b, B.R - 0.3, B.top), at(a, A.R - 0.3, A.top));
        steps.quad(at(a, A.R - 0.3, A.top), at(b, B.R - 0.3, B.top), at(b, B.R, B.top), at(a, A.R, A.top));
      }
      // The outer wall, from the ground outside to its top, the texture's top at the wall's.
      const pa = at(a, A.R, 0);
      const pb = at(b, B.R, 0);
      const ga = ground(pa[0], pa[2]) - 0.3;
      const gb = ground(pb[0], pb[2]) - 0.3;
      const L = Math.hypot(pb[0] - pa[0], pb[2] - pa[2]);
      walls.quad([pa[0], ga, pa[2]], [pb[0], gb, pb[2]], [pb[0], B.top, pb[2]], [pa[0], A.top, pa[2]], [[u / 4, 1 - (A.top - ga) / 16], [(u + L) / 4, 1 - (B.top - gb) / 16], [(u + L) / 4, 1], [u / 4, 1]]);
      u += L;
    }
    g.add(steps.mesh(mat('#aba69c', { roughness: 0.95, side: THREE.DoubleSide })));
    g.add(walls.mesh(mat('#ffffff', { map: tex.stadiumWall(), roughness: 0.9, side: THREE.DoubleSide })));
    if (roofs.pos.length) g.add(roofs.mesh(mat('#d6d6d2', { roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide })));
  }

  // ---- The floodlights: a concrete mast to its measured top, and its frame of lamps turned to the
  // pitch's middle. ----
  const concrete = mat('#b6b1a6', { roughness: 0.9 });
  const steel = mat('#5f656b', { metalness: 0.5, roughness: 0.5 });
  const lamp = new THREE.MeshBasicMaterial({ color: '#fff4d6', toneMapped: false });
  for (const [x, z, top] of s.lights ?? []) {
    const foot = ground(x, z);
    const mast = new THREE.Group();
    const h = top - 4.2 - foot;
    mast.add(mesh(new THREE.CylinderGeometry(0.35, 0.65, h, 10), concrete, 0, h / 2, 0));
    // The frame: four lamps by four in a steel cage, 4.5 m across and 4 m high, a walkway under it.
    const yb = h;
    mast.add(box(4.8, 0.2, 1.6, steel, 0, yb - 0.1, -0.4));
    for (const [w, hh, xx, yy] of [[4.6, 0.18, 0, yb + 3.8], [4.6, 0.18, 0, yb], [0.18, 4, -2.3, yb], [0.18, 4, 2.3, yb], [4.6, 0.12, 0, yb + 1.9]] as const) mast.add(box(w, hh, 0.18, steel, xx, yy, 0));
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const lx = -1.65 + i * 1.1;
        const ly = yb + 0.35 + j * 0.9;
        mast.add(box(0.7, 0.6, 0.5, steel, lx, ly, -0.2));
        const face = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.45), lamp);
        face.position.set(lx, ly + 0.3, 0.06);
        mast.add(face);
      }
    }
    mast.position.set(x, foot, z);
    // Its lamps (+z) to the pitch.
    mast.rotation.y = Math.atan2(s.x - x, s.z - z);
    g.add(mast);
  }
  return g;
}
