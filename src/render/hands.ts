// Your hands in first person (render/arms.ts's Viewmodel): gloved hands made in code, each wrapped round
// a grip, its fingers curled about it and its thumb over it, opening as a morph target (a hand letting
// go to fetch a magazine), on a cuff; and the sleeves, a tapered tube from the wrist to an elbow off the
// bottom of the screen. No CC0 arms fit the guns, so they're made to fit any of them.
//
// A hand's frame: the grip it holds runs along its y (the index finger at the top), its palm on the
// grip's +x side and its wrist to +z; the fingers wrap round the grip's front (-z) to its -x side, the
// thumb round its back. That's a right hand on a pistol grip as the gun's own frame has it (barrel -z,
// up +y); a left hand is the same mirrored (scale.x = -1).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// The grip a hand closes on: half its width (x) and half its depth (z), metres.
export interface Grip {
  a: number;
  b: number;
  // How far the index finger curls (1 round the grip, 0.3 along a trigger).
  index: number;
}

export const GRIPS = {
  pistol: { a: 0.014, b: 0.022, index: 0.38 },
  fore: { a: 0.021, b: 0.022, index: 1 },
  knife: { a: 0.012, b: 0.016, index: 1 },
  nade: { a: 0.028, b: 0.028, index: 1 },
} as const satisfies Record<string, Grip>;
export type GripKind = keyof typeof GRIPS;

// Where the wrist is in a hand's frame: the sleeve starts there.
export const WRIST = new THREE.Vector3(0.026, -0.012, 0.07);

const FR = 0.0092; // a finger's radius
const SEG = 10;
const RAD = 7;

// Points along a finger from its knuckle, curled round the grip's ellipse by `c` (0 straight, 1 round).
function fingerPath(g: Grip, y: number, L: number, c: number, k0: THREE.Vector3): THREE.Vector3[] {
  const Rx = g.a + FR + 0.001;
  const Rz = g.b + FR + 0.001;
  const at = (f: number) => new THREE.Vector3(Rx * Math.cos(f), y, -Rz * Math.sin(f));
  // Round the ellipse from the front-right, as far as its length reaches.
  const wrap: THREE.Vector3[] = [k0.clone()];
  let f = Math.atan2(-k0.z / Rz, k0.x / Rx) + 0.25;
  let s = 0;
  let prev = k0.clone();
  const step = 0.02;
  while (wrap.length < SEG + 1) {
    const p = at(f);
    const d = p.distanceTo(prev);
    if (s + d >= (L * wrap.length) / SEG) {
      wrap.push(p);
    }
    s += d;
    prev = p;
    f += step;
    if (f > 9) break;
  }
  while (wrap.length < SEG + 1) wrap.push(wrap[wrap.length - 1].clone());
  // Straight, the way it leaves the knuckle, drooping a little.
  const dir = wrap[1].clone().sub(k0).normalize();
  const straight = wrap.map((_, i) => {
    const t = i / SEG;
    return k0.clone().addScaledVector(dir, L * t).add(new THREE.Vector3(0.006 * t * t, 0, 0.012 * t * t));
  });
  return wrap.map((p, i) => straight[i].clone().lerp(p, c));
}

function tube(points: THREE.Vector3[], r: number, r1 = r): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, SEG, r, RAD, false);
  // Tapered to its tip.
  const pos = g.attributes.position;
  const centre = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    curve.getPointAt(t, centre);
    const k = (r + (r1 - r) * t) / r;
    for (let j = 0; j <= RAD; j++) {
      const n = i * (RAD + 1) + j;
      v.fromBufferAttribute(pos, n).sub(centre).multiplyScalar(k).add(centre);
      pos.setXYZ(n, v.x, v.y, v.z);
    }
  }
  const tip = new THREE.SphereGeometry(r1, RAD, 4);
  tip.translate(points[points.length - 1].x, points[points.length - 1].y, points[points.length - 1].z);
  const base = new THREE.SphereGeometry(r, RAD, 4);
  base.translate(points[0].x, points[0].y, points[0].z);
  return mergeGeometries([g, tip, base].map(clean))!;
}

function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  return g;
}

function coloured(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) a.set([c.r, c.g, c.b], k * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

const GLOVE = new THREE.Color('#2f302d');
const PAD = new THREE.Color('#44463f');
const CUFF = new THREE.Color('#23241f');

// The hand's pieces, closed by `c` (1 gripping, 0 open).
function handParts(g: Grip, c: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  // Four fingers, index to little, stacked down the grip from its top: knuckles along the palm's front.
  const fingers = [
    { y: 0.028, L: 0.074, r: FR, curl: g.index },
    { y: 0.008, L: 0.08, r: FR * 1.04, curl: 1 },
    { y: -0.012, L: 0.075, r: FR, curl: 1 },
    { y: -0.03, L: 0.06, r: FR * 0.9, curl: 1 },
  ];
  for (const f of fingers) {
    const k0 = new THREE.Vector3(g.a + 0.012, f.y, -g.b - 0.004);
    out.push(coloured(tube(fingerPath(g, f.y, f.L, f.curl * c + 0.15 * (1 - c), k0), f.r, f.r * 0.9), GLOVE));
  }
  // The palm and the back of the hand: a rounded block on the grip's side, from the knuckles to the heel.
  const palm = new RoundedBoxGeometry(0.03, 0.086, 0.086, 2, 0.012);
  palm.rotateY(0.18 * c);
  palm.translate(g.a + 0.017, -0.002, 0.016);
  out.push(coloured(clean(palm), GLOVE));
  // The knuckle guard on its back.
  const guard = new RoundedBoxGeometry(0.008, 0.07, 0.03, 1, 0.003);
  guard.translate(g.a + 0.033, 0.0, -0.012);
  out.push(coloured(clean(guard), PAD));
  // The thumb, from the web over the grip's back to its far side, pointing forward; and its root.
  const t = [
    new THREE.Vector3(g.a + 0.012, 0.026, 0.044),
    new THREE.Vector3(g.a * 0.4, 0.032, g.b + 0.02),
    new THREE.Vector3(-g.a - 0.004, 0.033, g.b * 0.35),
    new THREE.Vector3(-g.a - FR, 0.031, -g.b * 0.45),
  ];
  const open = [
    t[0],
    new THREE.Vector3(g.a + 0.004, 0.045, 0.03),
    new THREE.Vector3(g.a - 0.008, 0.058, 0.008),
    new THREE.Vector3(g.a - 0.014, 0.068, -0.014),
  ];
  out.push(coloured(tube(t.map((p, i) => open[i].clone().lerp(p, c)), FR * 1.15, FR * 1.0), GLOVE));
  const mound = new THREE.SphereGeometry(0.02, 8, 6);
  mound.scale(0.8, 1, 1.1);
  mound.translate(g.a + 0.01, 0.01, 0.036);
  out.push(coloured(clean(mound), GLOVE));
  // The cuff round the wrist.
  const cuff = new THREE.CylinderGeometry(0.03, 0.032, 0.055, 10, 1, false);
  cuff.rotateX(Math.PI / 2 - 0.2);
  cuff.translate(WRIST.x - 0.002, WRIST.y, WRIST.z - 0.012);
  out.push(coloured(clean(cuff), CUFF));
  return out;
}

const hands = new Map<GripKind, THREE.BufferGeometry>();

// A hand's geometry closed on a grip, its open pose as its first morph target.
export function handGeometry(kind: GripKind): THREE.BufferGeometry {
  let g = hands.get(kind);
  if (g) return g;
  const grip = GRIPS[kind];
  g = mergeGeometries(handParts(grip, 1))!;
  const open = mergeGeometries(handParts(grip, 0))!;
  g.morphAttributes.position = [open.attributes.position];
  g.morphAttributes.normal = [open.attributes.normal];
  hands.set(kind, g);
  return g;
}

export const gloveMaterial = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05 });

// A sleeve: a tube from y = 0 (the wrist) to y = 1 (the elbow), scaled along y to its length: its cuff
// turned back at the wrist, a fold or two in the cloth, darker towards the elbow (into the shade).
export function sleeveGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.032, 0.04, 1, 12, 8, true);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  const cloth = new THREE.Color('#4f5a68');
  const cuff = new THREE.Color('#3a434e');
  const deep = new THREE.Color('#2c333c');
  const x = new THREE.Color();
  for (let k = 0; k < p.count; k++) {
    const y = p.getY(k);
    const a = Math.atan2(p.getZ(k), p.getX(k));
    const band = y < 0.06;
    const s = (band ? 1.12 : 1) * (1 + 0.06 * Math.sin(y * 18 + a * 2) * Math.min(1, y * 4));
    p.setXYZ(k, p.getX(k) * s, y, p.getZ(k) * s);
    x.copy(band ? cuff : cloth).lerp(deep, Math.min(1, y * 1.4));
    c.set([x.r, x.g, x.b], k * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}
export const sleeveMaterial = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
