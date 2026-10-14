// What's on two levels (braga-map's task 012). Each bridge the map has stands on pillars and
// abutments clear of what passes under; in the open world's tiles its deck's road, its parapets and
// its underside are the streets' (streets.ts), and beyond them it's a deck at its height along its
// line, with its parapets. Where a street goes under the ground, its tunnel's mouth is a wall with
// the dark opening in it.
import type { Line, World as Braga } from 'braga-map';
import * as THREE from 'three';
import { mouthShape, THROAT, type Mouth } from '../world/land.ts';
import { mat } from './kit.ts';

export type Land = (x: number, z: number) => number;

const DEEP = 1.2; // a deck's depth, under the road
const PARAPET = 1.0; // a parapet's height, over it
const CLEAR = 3; // the least room under a deck for a pillar to stand in
const SPAN = 24; // how far apart the pillars stand

// Is the line a deck: a bridge the map has whose deck stands clear of the land somewhere along it?
// One whose deck the LiDAR took for the ground is a street on it.
export function isDeck(l: Line, land: Land): boolean {
  if (l.level !== 'bridge' || !l.heights || l.pts.length < 2) return false;
  return l.pts.some(([x, z], k) => l.heights![k] - land(x, z) > 1.5);
}

// Is (x, z) within 25 m of a tunnel's mouth or under a deck: where the land's mesh needs its small
// cells (city.ts), so a cutting keeps its floor and its sides, and a mouth isn't buried?
export function nearLevels(openings: Mouth[], decks: Set<Line>): (x: number, z: number) => boolean {
  const C = 10;
  const cells = new Set<string>();
  const mark = (x: number, z: number) => {
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) cells.add(`${Math.floor(x / C) + a},${Math.floor(z / C) + b}`);
  };
  for (const m of openings) mark(m.x, m.z);
  for (const l of decks) {
    for (let k = 1; k < l.pts.length; k++) {
      const [ax, az] = l.pts[k - 1];
      const [bx, bz] = l.pts[k];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 5);
      for (let f = 0; f <= n; f++) mark(ax + ((bx - ax) * f) / n, az + ((bz - az) * f) / n);
    }
  }
  return (x, z) => cells.has(`${Math.floor(x / C)},${Math.floor(z / C)}`);
}

// Triangles for one material, each with its own flat normal.
class Faces {
  pos: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  // A quad a, b, c, d, in order round it. (The materials are seen from both sides.)
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  // A box from its eight corners: the bottom four counter-clockwise from above, then the top four.
  box(c: THREE.Vector3[]): void {
    const [a, b, d, e, f, g, h, i] = c;
    this.quad(f, g, h, i); // top
    this.quad(a, e, d, b); // bottom
    this.quad(a, b, g, f);
    this.quad(b, d, h, g);
    this.quad(d, e, i, h);
    this.quad(e, a, f, i);
  }
  mesh(m: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.computeVertexNormals();
    const o = new THREE.Mesh(g, m);
    o.castShadow = true;
    o.receiveShadow = true;
    return o;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// An upright block at (x, z), `along` × `across` metres, turned to (ux, uz), from y0 to y1.
function pillar(f: Faces, x: number, z: number, ux: number, uz: number, along: number, across: number, y0: number, y1: number): void {
  const rx = -uz;
  const rz = ux;
  const corner = (a: number, b: number, y: number) => V(x + ux * a + rx * b, y, z + uz * a + rz * b);
  const ring = (y: number) => [corner(-along / 2, -across / 2, y), corner(along / 2, -across / 2, y), corner(along / 2, across / 2, y), corner(-along / 2, across / 2, y)];
  f.box([...ring(y0), ...ring(y1)]);
}

// The decks, their pillars and abutments, and the tunnels' mouths. `drawn` says where the streets are
// drawn as surfaces (the open world's tiles), so a deck there is only its pillars and abutments; and
// `under` how high a mouth's concrete may stand at a point, so it keeps under a street or a deck
// over the tunnel.
export function buildLevels(map: Braga, land: Land, decks: Set<Line>, openings: Mouth[], drawn: (x: number, z: number) => boolean, under: (x: number, z: number) => number = () => Infinity): THREE.Group {
  const group = new THREE.Group();
  const concrete = new Faces();
  const asphalt = new Faces();
  const dark = new Faces();

  // The streets that pass under, on the ground: a pillar keeps off their carriageways.
  const below = map.lines.filter((l) => l.level === 'ground' || l.level === 'under');
  const clearOf = (x: number, z: number, r: number) => {
    for (const l of below) {
      for (let k = 1; k < l.pts.length; k++) {
        const [ax, az] = l.pts[k - 1];
        const [bx, bz] = l.pts[k];
        if (Math.min(ax, bx) - x > 30 || x - Math.max(ax, bx) > 30 || Math.min(az, bz) - z > 30 || z - Math.max(az, bz) > 30) continue;
        const dx = bx - ax;
        const dz = bz - az;
        const L = dx * dx + dz * dz;
        const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
        if (Math.hypot(ax + dx * t - x, az + dz * t - z) < l.w / 2 + r + 1) return false;
      }
    }
    return true;
  };
  // Pillars under a deck at (x, z), its top at y, turned to (ux, uz) and hw wide either side: one in
  // the middle of a narrow deck, two under a wide one, wherever there's room under it and they stand
  // clear of what passes. Moved along a little, either way, before giving up.
  const pillarsUnder = (x: number, z: number, ux: number, uz: number, y: number, hw: number) => {
    for (const shift of [0, 4, -4, 8, -8]) {
      const px = x + ux * shift;
      const pz = z + uz * shift;
      const at = hw > 5 ? [-hw * 0.55, hw * 0.55] : [0];
      const spots = at.map((b) => ({ x: px - uz * b, z: pz + ux * b }));
      if (spots.every((p) => y - DEEP - land(p.x, p.z) > CLEAR && clearOf(p.x, p.z, 0.6))) {
        for (const p of spots) pillar(concrete, p.x, p.z, ux, uz, 1.2, 1.2, land(p.x, p.z) - 0.5, y - DEEP + 0.05);
        return;
      }
    }
  };

  // ---- The bridges: each a deck along its line, at its heights (the streets' own where they're
  // drawn), on pillars. ----
  for (const l of decks) {
    const n = l.pts.length;
    const h = l.heights!;
    const hw = l.w / 2 + 1.5; // its carriageway and a pavement either side
    const own = !l.pts.some(([x, z]) => drawn(x, z));
    // The way it runs at each point, and to its right.
    const dirs = l.pts.map((_, k) => {
      const [ax, az] = l.pts[Math.max(0, k - 1)];
      const [bx, bz] = l.pts[Math.min(n - 1, k + 1)];
      const L = Math.hypot(bx - ax, bz - az) || 1;
      return { ux: (bx - ax) / L, uz: (bz - az) / L };
    });
    const side = (k: number, off: number, y: number) => {
      const [x, z] = l.pts[k];
      const { ux, uz } = dirs[k];
      return V(x - uz * off, y, z + ux * off);
    };
    for (let k = 1; k < n && own; k++) {
      const [a, b] = [k - 1, k];
      // The road on top, the underside, and the sides.
      asphalt.quad(side(a, -hw, h[a] + 0.03), side(a, hw, h[a] + 0.03), side(b, hw, h[b] + 0.03), side(b, -hw, h[b] + 0.03));
      concrete.quad(side(a, -hw - 0.3, h[a] - DEEP), side(b, -hw - 0.3, h[b] - DEEP), side(b, hw + 0.3, h[b] - DEEP), side(a, hw + 0.3, h[a] - DEEP));
      for (const s of [-1, 1]) {
        // The side of the deck, and the parapet on it: its outer face, its top and its inner face.
        const o = s * (hw + 0.3);
        const i = s * hw;
        concrete.quad(side(a, o, h[a] - DEEP), side(b, o, h[b] - DEEP), side(b, o, h[b] + PARAPET), side(a, o, h[a] + PARAPET));
        concrete.quad(side(a, o, h[a] + PARAPET), side(b, o, h[b] + PARAPET), side(b, i, h[b] + PARAPET), side(a, i, h[a] + PARAPET));
        concrete.quad(side(a, i, h[a]), side(b, i, h[b]), side(b, i, h[b] + PARAPET), side(a, i, h[a] + PARAPET));
      }
    }
    // Abutments: where an end stands over the land, a wall under it down to the ground.
    for (const k of [0, n - 1]) {
      const [x, z] = l.pts[k];
      const g = land(x, z);
      if (h[k] - DEEP - g < 0.3) continue;
      concrete.quad(side(k, -hw - 0.3, g - 0.5), side(k, hw + 0.3, g - 0.5), side(k, hw + 0.3, h[k] - DEEP), side(k, -hw - 0.3, h[k] - DEEP));
    }
    // Pillars, a span apart.
    let run = SPAN / 2;
    for (let k = 1; k < n; k++) {
      const [ax, az] = l.pts[k - 1];
      const [bx, bz] = l.pts[k];
      const L = Math.hypot(bx - ax, bz - az);
      while (run < L) {
        const f = run / L;
        pillarsUnder(ax + (bx - ax) * f, az + (bz - az) * f, (bx - ax) / L, (bz - az) / L, h[k - 1] + (h[k] - h[k - 1]) * f, hw);
        run += SPAN;
      }
      run -= L;
    }
  }

  // ---- The tunnels' mouths: where a tunnel's end meets a street that isn't in one, a wall across
  // it from its road up to the ground over the tunnel, with the opening in it: the first few metres
  // of the tunnel lined in concrete (the land in it held down at the road: city.ts), then dark. ----
  for (const m of openings) {
    const { x, z, y, ux, uz } = m;
    const { open, half } = mouthShape(m, land);
    const at = (b: number, along: number, yy: number) => V(x - uz * b + ux * along, yy, z + ux * b + uz * along);
    // Up to the land over the tunnel, but under a street or a deck there.
    let top = mouthShape(m, land).top;
    for (const b of [-half, 0, half]) for (const a of [-THROAT, -THROAT / 2, 0]) top = Math.min(top, under(at(b, a, 0).x, at(b, a, 0).z));
    top = Math.max(top, y + 5.2);
    // The two sides and the roof, THROAT deep, their faces out of the tunnel.
    for (const [b0, b1, y0, y1] of [[-half, -open / 2, y - 0.4, top], [open / 2, half, y - 0.4, top], [-open / 2, open / 2, y + 5, top]]) {
      concrete.box([at(b0, -THROAT, y0), at(b1, -THROAT, y0), at(b1, 0, y0), at(b0, 0, y0), at(b0, -THROAT, y1), at(b1, -THROAT, y1), at(b1, 0, y1), at(b0, 0, y1)]);
    }
    // Then dark, as far as can be seen.
    dark.quad(at(-open / 2, -THROAT + 0.2, y - 0.3), at(open / 2, -THROAT + 0.2, y - 0.3), at(open / 2, -THROAT + 0.2, y + 5), at(-open / 2, -THROAT + 0.2, y + 5));
  }

  if (concrete.pos.length) group.add(concrete.mesh(mat('#bcb7ae', { roughness: 0.9, side: THREE.DoubleSide })));
  if (asphalt.pos.length) group.add(asphalt.mesh(mat('#47494d', { roughness: 0.85, side: THREE.DoubleSide })));
  if (dark.pos.length) group.add(dark.mesh(new THREE.MeshBasicMaterial({ color: '#0d0e10', side: THREE.DoubleSide })));
  return group;
}
