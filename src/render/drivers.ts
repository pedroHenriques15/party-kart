// The drivers: cartoon bobbleheads, known by their props, their hair and their cars. Parody names;
// every face is the same friendly cartoon face.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { windStreak } from './textures.ts';

export type Body = 'kart' | 'limo' | 'stroller' | 'vintage' | 'van';
export type Extra =
  | 'shades'
  | 'chain'
  | 'disco'
  | 'swoop'
  | 'tie'
  | 'flag'
  | 'cone'
  | 'gem'
  | 'spikes'
  | 'braids'
  | 'cactus'
  | 'dagger'
  | 'teacup'
  | 'beanie'
  | 'bonnet'
  | 'pacifier'
  | 'tophat'
  | 'monocle'
  | 'mustache'
  | 'cape'
  | 'fangs';
export type Trail = 'confetti' | 'money' | 'gas' | 'flame' | 'bubbles' | 'sparkle' | 'smoke' | null;

export interface Driver {
  id: string;
  name: string;
  tagline: string;
  body: Body;
  color: string;
  trim: string;
  skin: string;
  outfit: string;
  extras: Extra[];
  trail: Trail;
  horn: number[]; // notes, in Hz
}

export const DRIVERS: Driver[] = [
  { id: 'kiddy', name: 'P. Kiddy', tagline: 'Host of the White Party', body: 'kart', color: '#f7f7f4', trim: '#d4af37', skin: '#7a4b2a', outfit: '#ffffff', extras: ['shades', 'chain', 'disco'], trail: 'confetti', horn: [523, 659, 784, 1047] },
  { id: 'trunk', name: 'Donald Trunk', tagline: 'Makes karting great again', body: 'limo', color: '#d4af37', trim: '#b22234', skin: '#f2b48a', outfit: '#1f2a4d', extras: ['swoop', 'tie', 'flag'], trail: 'money', horn: [392, 392, 523] },
  { id: 'gucci', name: 'Gucci Pain', tagline: 'Ice cold, slightly melting', body: 'kart', color: '#1e5b3a', trim: '#b3202a', skin: '#5a3825', outfit: '#151515', extras: ['cone', 'chain', 'shades'], trail: 'sparkle', horn: [330, 440, 330] },
  { id: 'woozy', name: 'Lil Woozy Vert', tagline: 'Bought a planet, lost the keys', body: 'kart', color: '#7b2ff7', trim: '#ff4fd8', skin: '#6b4228', outfit: '#ff4fd8', extras: ['gem', 'spikes', 'chain'], trail: 'sparkle', horn: [880, 1175, 880, 1175] },
  { id: 'trav', name: 'Trav Scotch', tagline: 'Straight up from the cactus', body: 'kart', color: '#4f7d3a', trim: '#c2a26b', skin: '#5c3b24', outfit: '#6b5b45', extras: ['braids', 'cactus'], trail: 'flame', horn: [220, 277, 330] },
  { id: 'average', name: '22 Average', tagline: 'Exactly one more than 21', body: 'van', color: '#cbbd9b', trim: '#8a8a8a', skin: '#3d2618', outfit: '#2b2b2b', extras: ['dagger', 'teacup', 'beanie'], trail: null, horn: [440, 440] },
  { id: 'baby', name: 'Lil Babyface', tagline: 'Nap time is for losers', body: 'stroller', color: '#9fd3ff', trim: '#ffffff', skin: '#6a4329', outfit: '#ffd1e8', extras: ['bonnet', 'pacifier'], trail: 'bubbles', horn: [1047, 1319, 1568] },
  { id: 'past', name: 'Lil Past', tagline: 'Was fast. Once.', body: 'vintage', color: '#6b4f2a', trim: '#e8dcc0', skin: '#4e3220', outfit: '#2a2a2a', extras: ['tophat', 'monocle', 'mustache'], trail: 'smoke', horn: [196, 247, 196] },
  { id: 'farty', name: 'Playboi Farty', tagline: 'Leaves a trail', body: 'kart', color: '#141414', trim: '#a5ff3a', skin: '#5b3a24', outfit: '#3b0d0d', extras: ['cape', 'fangs'], trail: 'gas', horn: [110, 98, 82] },
];

export const driverById = (id: string) => DRIVERS.find((d) => d.id === id) ?? DRIVERS[0];

// Materials are shared between parts and karts (same colour and settings, same material), so
// parts merge into few meshes. The body's paint is each kart's own: gold plating changes it.
const mats = new Map<string, THREE.MeshStandardMaterial>();
const std = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
  const key = color + JSON.stringify(o);
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...o });
    mats.set(key, m);
  }
  return m;
};
const paint = (color: string, metal = 0.25) =>
  new THREE.MeshPhysicalMaterial({ color, metalness: metal, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
const paints = new Map<string, THREE.MeshPhysicalMaterial>();
const sharedPaint = (color: string, metal: number) => {
  const key = `${color}${metal}`;
  if (!paints.has(key)) paints.set(key, paint(color, metal));
  return paints.get(key)!;
};

// Collects shapes and merges those sharing a material into one mesh: a kart is a handful of draw
// calls, not a hundred.
class Parts {
  private byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  add(geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): void {
    this.q.setFromEuler(this.e.set(...rot));
    this.put(geo, mat, this.m.compose(new THREE.Vector3(...pos), this.q, new THREE.Vector3(...scale)));
  }

  // A rounded limb from a to b.
  limb(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): void {
    const dir = b.clone().sub(a);
    const len = Math.max(0.01, dir.length() - 2 * r);
    this.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.put(new THREE.CapsuleGeometry(r, len, 4, 10), mat, this.m.compose(a.clone().add(b).multiplyScalar(0.5), this.q, new THREE.Vector3(1, 1, 1)));
  }

  private put(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4): void {
    let g = geo.clone().applyMatrix4(m);
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    g.clearGroups();
    const list = this.byMat.get(mat) ?? [];
    list.push(g);
    this.byMat.set(mat, list);
  }

  into(group: THREE.Group, shadows = true): void {
    for (const [mat, list] of this.byMat) {
      const merged = mergeGeometries(list);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadows;
      group.add(mesh);
    }
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// The figure: torso, arms reaching forward, a big head. Facing +x; the head is its own group, to bob.
export function buildDriverFigure(d: Driver, hands: THREE.Vector3 = V(0.62, 0.62, 0.26)): THREE.Group {
  const fig = new THREE.Group();
  const body = new Parts();
  const face = new Parts();
  const skin = std(d.skin, { roughness: 0.7 });
  const skinDark = std(new THREE.Color(d.skin).multiplyScalar(0.82).getStyle(), { roughness: 0.7 });
  const outfit = std(d.outfit, { roughness: 0.75 });
  const black = std('#151515', { roughness: 0.4 });
  const white = std('#ffffff', { roughness: 0.3 });
  const gold = std('#e0b94a', { metalness: 1, roughness: 0.22 });
  const mouth = std('#6b1f24', { roughness: 0.6 });

  body.add(new THREE.CapsuleGeometry(0.3, 0.32, 6, 14), outfit, [0, 0.48, 0], [0, 0, 0], [1, 1, 1.15]);
  for (const s of [-1, 1]) {
    const shoulder = V(0.02, 0.72, s * 0.34);
    const hand = V(hands.x, hands.y, s * hands.z);
    body.limb(shoulder, hand, 0.09, outfit);
    body.add(new THREE.SphereGeometry(0.11, 12, 8), skin, [hand.x, hand.y, hand.z]);
  }
  body.add(new THREE.CylinderGeometry(0.11, 0.13, 0.25, 10), skin, [0, 0.86, 0]);

  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, 1.28, 0);
  face.add(new THREE.SphereGeometry(0.55, 28, 20), skin, [0, 0, 0]);
  for (const s of [-1, 1]) {
    face.add(new THREE.SphereGeometry(0.12, 14, 10), white, [0.45, 0.1, s * 0.19], [0, 0, 0], [0.6, 1, 0.85]);
    face.add(new THREE.SphereGeometry(0.06, 10, 8), black, [0.53, 0.1, s * 0.18]);
    face.add(new THREE.SphereGeometry(0.022, 6, 4), white, [0.585, 0.135, s * 0.165]);
    face.add(new THREE.BoxGeometry(0.04, 0.035, 0.17), black, [0.5, 0.27, s * 0.19], [s * 0.15, 0, 0]);
    face.add(new THREE.SphereGeometry(0.12, 12, 8), skin, [0, 0, s * 0.54], [0, 0, 0], [0.8, 1, 0.6]);
  }
  face.add(new THREE.SphereGeometry(0.085, 12, 8), skinDark, [0.56, -0.03, 0]);
  face.add(new THREE.TorusGeometry(0.15, 0.032, 8, 20, Math.PI), mouth, [0.5, -0.17, 0], [0, Math.PI / 2, Math.PI]);

  for (const e of d.extras) {
    switch (e) {
      case 'shades':
        face.add(new THREE.BoxGeometry(0.08, 0.17, 0.64), std('#0b0b0d', { metalness: 0.6, roughness: 0.12 }), [0.53, 0.12, 0]);
        break;
      case 'chain':
        body.add(new THREE.TorusGeometry(0.32, 0.05, 10, 28), gold, [0.05, 0.66, 0], [Math.PI / 2, 0.45, 0]);
        body.add(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 18), gold, [0.34, 0.5, 0], [0, 0, Math.PI / 2]);
        break;
      case 'swoop': {
        const hair = std('#f3d36b', { roughness: 0.85 });
        face.add(new THREE.SphereGeometry(0.6, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2.2), hair, [-0.05, 0.12, 0], [0, 0, 0], [1.15, 0.75, 1.08]);
        face.add(new THREE.SphereGeometry(0.28, 14, 8), hair, [0.42, 0.42, 0.12], [0, 0, 0], [1.4, 0.5, 1.5]);
        break;
      }
      case 'tie':
        body.add(new THREE.BoxGeometry(0.04, 0.55, 0.13), std('#c8102e'), [0.31, 0.42, 0], [0, 0, 0.12]);
        break;
      case 'cone':
        face.add(new THREE.ConeGeometry(0.06, 0.16, 8), std('#d9a066'), [0.48, -0.1, 0.33], [0, 0, Math.PI]);
        face.add(new THREE.SphereGeometry(0.06, 8, 6), std('#9be7ff'), [0.48, 0, 0.33]);
        break;
      case 'gem':
        face.add(new THREE.OctahedronGeometry(0.09), std('#ff4fd8', { metalness: 0.6, roughness: 0.05, emissive: '#7a1f68' }), [0.53, 0.33, 0]);
        break;
      case 'spikes':
        for (let k = 0; k < 11; k++) {
          const a = (k / 11) * Math.PI * 2;
          face.add(new THREE.ConeGeometry(0.09, 0.6, 7), std(k % 2 ? '#ff4fd8' : '#3be8c4'), [Math.cos(a) * 0.3 - 0.05, 0.55, Math.sin(a) * 0.3], [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]);
        }
        break;
      case 'braids': {
        const hair = std('#2a1a10', { roughness: 0.9 });
        face.add(new THREE.SphereGeometry(0.57, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2.5), hair, [-0.04, 0.06, 0]);
        for (let k = 0; k < 12; k++) {
          const a = Math.PI * 0.5 + (k / 11) * Math.PI;
          face.add(new THREE.CapsuleGeometry(0.045, 0.62, 3, 6), hair, [Math.cos(a) * 0.5, -0.12, Math.sin(a) * 0.5]);
        }
        break;
      }
      case 'dagger':
        face.add(new THREE.BoxGeometry(0.02, 0.2, 0.035), std('#2b2b2b'), [0.55, 0.36, 0.05]);
        break;
      case 'beanie':
        face.add(new THREE.SphereGeometry(0.58, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), std('#5f6b3a', { roughness: 0.95 }), [0, 0.12, 0]);
        face.add(new THREE.TorusGeometry(0.5, 0.06, 8, 24), std('#4d5730', { roughness: 0.95 }), [0, 0.2, 0], [Math.PI / 2, 0, 0]);
        break;
      case 'bonnet':
        face.add(new THREE.SphereGeometry(0.63, 20, 12, 0, Math.PI, 0, Math.PI), std('#bfe3ff'), [-0.08, 0.05, 0], [0, Math.PI / 2, 0]);
        break;
      case 'pacifier':
        face.add(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 18), std('#ff8fc7'), [0.57, -0.17, 0], [0, 0, Math.PI / 2]);
        face.add(new THREE.TorusGeometry(0.07, 0.02, 6, 14), std('#ff8fc7'), [0.61, -0.17, 0], [0, Math.PI / 2, 0]);
        break;
      case 'tophat':
        face.add(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 22), black, [0, 0.42, 0]);
        face.add(new THREE.CylinderGeometry(0.32, 0.32, 0.62, 22), black, [0, 0.74, 0]);
        face.add(new THREE.CylinderGeometry(0.325, 0.325, 0.1, 22), std('#7a1f1f'), [0, 0.5, 0]);
        break;
      case 'monocle':
        face.add(new THREE.TorusGeometry(0.09, 0.015, 6, 16), gold, [0.58, 0.1, 0.19], [0, Math.PI / 2, 0]);
        break;
      case 'mustache':
        for (const s of [-1, 1]) face.add(new THREE.SphereGeometry(0.1, 10, 6), std('#1d1d1d'), [0.53, -0.08, s * 0.1], [0, 0, 0], [0.6, 0.45, 1.3]);
        break;
      case 'fangs':
        for (const s of [-1, 1]) face.add(new THREE.ConeGeometry(0.025, 0.08, 6), white, [0.55, -0.24, s * 0.06], [0, 0, Math.PI]);
        face.add(new THREE.SphereGeometry(0.565, 18, 10, 0, Math.PI * 2, 0, Math.PI / 3), black, [-0.03, 0.1, 0]);
        break;
      case 'cape': {
        const cape = std('#5c0b12', { side: THREE.DoubleSide });
        body.add(new THREE.ConeGeometry(0.58, 1.05, 14, 1, true), cape, [-0.25, 0.42, 0]);
        body.add(new THREE.CylinderGeometry(0.46, 0.3, 0.35, 14, 1, true), cape, [-0.05, 0.92, 0]);
        break;
      }
      default:
        break;
    }
  }
  body.into(fig);
  face.into(head);
  fig.add(head);
  return fig;
}

// A tyre, rounded at the shoulders, its axle along z.
function tyre(r: number, w: number): THREE.BufferGeometry {
  const pts = [
    [0.6 * r, -w / 2],
    [0.93 * r, -w / 2],
    [r, -w / 2 + 0.07],
    [r, w / 2 - 0.07],
    [0.93 * r, w / 2],
    [0.6 * r, w / 2],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 24).rotateX(Math.PI / 2);
}

function wheel(r: number, w: number, rimMat: THREE.Material, spokes = 5): THREE.Group {
  const g = new THREE.Group();
  const p = new Parts();
  const tyreMat = std('#1b1b1d', { roughness: 0.92 });
  p.add(tyre(r, w), tyreMat, [0, 0, 0]);
  p.add(new THREE.CylinderGeometry(r * 0.6, r * 0.6, w * 0.8, 20), rimMat, [0, 0, 0], [Math.PI / 2, 0, 0]);
  p.add(new THREE.CylinderGeometry(r * 0.16, r * 0.16, w * 0.95, 10), std('#2a2a2e'), [0, 0, 0], [Math.PI / 2, 0, 0]);
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    for (const s of [-1, 1]) p.add(new THREE.BoxGeometry(r * 0.12, r * 0.95, 0.03), std('#2a2a2e'), [Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, (s * w * 0.8) / 2], [0, 0, a - Math.PI / 2]);
  }
  p.into(g);
  return g;
}

// A body's side profile, extruded across its width.
function profile(pts: [number, number][], width: number, bevel = 0.08): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(...pts[0]);
  for (let i = 1; i < pts.length; i++) s.lineTo(...pts[i]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  return g;
}

// A smooth outline through rough points (for the profiles).
function smooth(pts: [number, number][], n = 6): [number, number][] {
  const curve = new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  return curve.getPoints(pts.length * n).map((p) => [p.x, p.y]);
}

export interface KartModel {
  group: THREE.Group;
  driver: Driver;
  exhaust: THREE.Vector3[]; // where the exhausts are, in the kart's frame
  ember: THREE.Object3D; // the cigarette's lit end, where its smoke comes from
  // vice: the café's easter egg is on, a cigarette and a beer for the driver.
  update: (speed: number, steer: number, dt: number, grounded: boolean, flags: number, vice?: boolean) => void;
}

const GOLD = 1;
const SHIELD = 2;
const SPIN = 4;
const SHRINK = 8;
const BOOST = 16;
const SLIP = 256;

let windTex: THREE.CanvasTexture | null = null;

// The car around the figure. Forward is +x, right is +z; the wheels sit on y = 0.
export function buildKart(d: Driver): KartModel {
  const group = new THREE.Group();
  const body = new THREE.Group(); // tilts and spins
  group.add(body);
  const p = new Parts();
  const isGold = d.body === 'limo';
  const shell = paint(d.color, isGold ? 0.95 : 0.25);
  const trim = sharedPaint(d.trim, 0.4);
  const dark = std('#1d1e22', { roughness: 0.5, metalness: 0.3 });
  const chrome = std('#e8ecf1', { metalness: 1, roughness: 0.15 });
  const lamp = std('#fffbe0', { emissive: '#fff3b0', emissiveIntensity: 1.5 });
  const rim = isGold || d.extras.includes('chain') ? std('#e0b94a', { metalness: 1, roughness: 0.2 }) : chrome;

  let front = { x: 1.15, r: 0.36, w: 0.3, z: 0.95 };
  let rear = { x: -1.15, r: 0.42, w: 0.42, z: 1.0 };
  let seat = V(-0.38, 0.5, 0);
  let wheelSpokes = 5;
  let exhaust: THREE.Vector3[] = [V(-1.85, 0.72, -0.25), V(-1.85, 0.72, 0.25)];
  let steeringWheel = true;

  switch (d.body) {
    case 'limo': {
      p.add(profile(smooth([[2.4, 0.3], [2.35, 0.6], [1.0, 0.74], [0.8, 0.62], [-1.9, 0.62], [-2.3, 0.78], [-2.45, 0.45], [-2.3, 0.24], [2.3, 0.22]]), 1.6), shell, [0, 0, 0]);
      p.add(new THREE.BoxGeometry(4.7, 0.05, 1.66), chrome, [0, 0.5, 0]);
      p.add(new THREE.ConeGeometry(0.08, 0.25, 8), chrome, [2.15, 0.85, 0]);
      p.add(new THREE.BoxGeometry(0.6, 0.45, 1.3), std('#5a1414', { roughness: 0.8 }), [-0.95, 0.75, 0]);
      for (const s of [-1, 1]) p.add(new THREE.CircleGeometry(0.13, 16), lamp, [2.42, 0.45, s * 0.5], [0, Math.PI / 2, 0]);
      front = { x: 1.65, r: 0.4, w: 0.34, z: 0.95 };
      rear = { x: -1.6, r: 0.4, w: 0.36, z: 0.95 };
      seat = V(-0.35, 0.55, 0);
      exhaust = [V(-2.45, 0.35, 0.5)];
      wheelSpokes = 7;
      break;
    }
    case 'van': {
      p.add(profile(smooth([[1.65, 0.3], [1.65, 0.95], [1.3, 1.08], [-1.5, 1.08], [-1.68, 0.9], [-1.68, 0.3], [-1.5, 0.22], [1.5, 0.22]], 4), 1.9, 0.1), shell, [0, 0, 0]);
      p.add(new THREE.BoxGeometry(3.4, 0.12, 1.96), std('#8c8370'), [0, 0.45, 0]);
      // A windscreen frame, the glass faint blue.
      p.add(new THREE.BoxGeometry(0.06, 0.55, 1.8), std('#bfe3ff', { transparent: true, opacity: 0.35, roughness: 0.05 }), [0.75, 1.35, 0]);
      for (const s of [-1, 1]) p.add(new THREE.BoxGeometry(0.08, 0.6, 0.08), dark, [0.75, 1.36, s * 0.92]);
      for (const s of [-1, 1]) p.add(new THREE.CircleGeometry(0.15, 16), lamp, [1.71, 0.7, s * 0.65], [0, Math.PI / 2, 0]);
      front = { x: 1.1, r: 0.4, w: 0.34, z: 0.98 };
      rear = { x: -1.1, r: 0.4, w: 0.34, z: 0.98 };
      seat = V(0.05, 0.62, -0.42);
      exhaust = [V(-1.75, 0.3, 0.6)];
      steeringWheel = false;
      break;
    }
    case 'stroller': {
      const pram = std(d.color, { roughness: 0.6, side: THREE.DoubleSide });
      p.add(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), pram, [0, 1.1, 0], [0, 0, 0], [1.45, 0.75, 0.88]);
      p.add(new THREE.TorusGeometry(1, 0.06, 8, 32), std('#ffffff'), [0, 1.1, 0], [Math.PI / 2, 0, 0], [1.45, 0.88, 1]);
      p.add(new THREE.SphereGeometry(0.95, 22, 12, Math.PI, Math.PI, 0, Math.PI / 2), std('#ffffff', { side: THREE.DoubleSide }), [-0.4, 1.1, 0], [0, 0, 0], [0.9, 0.95, 0.92]);
      for (const s of [-1, 1]) {
        p.add(new THREE.BoxGeometry(2.6, 0.06, 0.06), chrome, [0, 0.55, s * 0.68]);
        p.limb(V(-1.2, 0.6, s * 0.6), V(-1.65, 1.75, s * 0.6), 0.04, chrome);
      }
      p.add(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 10), chrome, [-1.65, 1.75, 0], [Math.PI / 2, 0, 0]);
      front = { x: 1.05, r: 0.55, w: 0.12, z: 0.85 };
      rear = { x: -1.0, r: 0.6, w: 0.12, z: 0.85 };
      seat = V(0.1, 0.62, 0);
      wheelSpokes = 10;
      exhaust = [];
      steeringWheel = false;
      break;
    }
    case 'vintage': {
      p.add(profile(smooth([[1.95, 0.55], [1.95, 1.12], [1.75, 1.22], [0.55, 1.22], [0.35, 0.9], [-1.1, 0.9], [-1.55, 0.95], [-1.65, 0.7], [-1.6, 0.55]], 5), 1.15), shell, [0, 0, 0]);
      p.add(new THREE.BoxGeometry(0.08, 0.62, 0.9), chrome, [1.97, 0.88, 0]);
      for (let k = -3; k <= 3; k++) p.add(new THREE.BoxGeometry(0.1, 0.55, 0.03), dark, [1.98, 0.88, k * 0.11]);
      for (const s of [-1, 1]) {
        p.add(new THREE.CylinderGeometry(0.62, 0.62, 0.42, 20, 1, false, 0, Math.PI), std('#1a1a1a', { side: THREE.DoubleSide }), [1.25, 0.5, s * 0.85], [Math.PI / 2, 0, 0]);
        p.add(new THREE.CylinderGeometry(0.62, 0.62, 0.42, 20, 1, false, 0, Math.PI), std('#1a1a1a', { side: THREE.DoubleSide }), [-1.2, 0.5, s * 0.85], [Math.PI / 2, 0, 0]);
        p.add(new THREE.BoxGeometry(1.4, 0.05, 0.35), std('#1a1a1a'), [0.02, 0.48, s * 0.82]);
        p.add(new THREE.SphereGeometry(0.17, 14, 10), lamp, [1.9, 1.25, s * 0.55]);
        p.add(new THREE.CylinderGeometry(0.19, 0.19, 0.12, 14), chrome, [1.85, 1.25, s * 0.55], [0, 0, Math.PI / 2]);
      }
      p.add(new THREE.TorusGeometry(0.42, 0.13, 10, 22), std('#1b1b1d'), [-1.85, 0.95, 0], [0, Math.PI / 2, 0]);
      front = { x: 1.25, r: 0.5, w: 0.2, z: 0.85 };
      rear = { x: -1.2, r: 0.5, w: 0.2, z: 0.85 };
      seat = V(-0.35, 0.82, 0);
      wheelSpokes = 12;
      exhaust = [V(-1.75, 0.45, -0.45)];
      break;
    }
    default: {
      p.add(
        profile(smooth([[1.75, 0.3], [1.62, 0.56], [0.6, 0.7], [0.3, 0.55], [-0.6, 0.55], [-0.95, 0.88], [-1.65, 0.88], [-1.75, 0.5], [-1.62, 0.24], [1.55, 0.22]], 6), 1.3),
        shell,
        [0, 0, 0],
      );
      for (const s of [-1, 1]) {
        p.add(new THREE.CapsuleGeometry(0.2, 1.45, 6, 12), trim, [0.05, 0.38, s * 0.8], [0, 0, Math.PI / 2]);
        p.add(new THREE.BoxGeometry(0.42, 0.24, 0.04), trim, [1.78, 0.3, s * 0.97]);
        p.add(new THREE.BoxGeometry(0.06, 0.42, 0.06), dark, [-1.48, 1.07, s * 0.45]);
        p.add(new THREE.BoxGeometry(0.55, 0.32, 0.04), trim, [-1.55, 1.3, s * 0.9]);
        p.add(new THREE.CircleGeometry(0.1, 14), lamp, [1.7, 0.44, s * 0.4], [0, Math.PI / 2, 0]);
        p.add(new THREE.CylinderGeometry(0.075, 0.09, 0.5, 12), chrome, [-1.7, 0.72, s * 0.25], [0, 0, Math.PI / 2 + 0.25]);
      }
      p.add(new THREE.BoxGeometry(0.32, 0.05, 1.95), trim, [1.78, 0.2, 0]);
      p.add(new THREE.BoxGeometry(0.5, 0.06, 1.8), trim, [-1.55, 1.3, 0]);
      p.add(new THREE.BoxGeometry(0.55, 0.32, 0.65), dark, [-1.2, 1.0, 0]);
      p.add(new THREE.BoxGeometry(0.42, 0.55, 0.75), std('#26272b', { roughness: 0.8 }), [-0.6, 0.78, 0], [0, 0, 0.25]);
    }
  }
  if (steeringWheel) {
    p.add(new THREE.TorusGeometry(0.2, 0.035, 8, 20), dark, [seat.x + 0.62, seat.y + 0.55, 0], [0, Math.PI / 2, 0.45]);
    p.add(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), dark, [seat.x + 0.78, seat.y + 0.42, 0], [0, 0, 1.0]);
  }

  // Props on the car.
  if (d.extras.includes('disco')) {
    p.add(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 4), chrome, [-1.45, 1.6, 0.6]);
    p.add(new THREE.IcosahedronGeometry(0.22, 1), std('#e9eef5', { metalness: 1, roughness: 0.08, flatShading: true }), [-1.45, 2.25, 0.6]);
  }
  if (d.extras.includes('flag')) {
    p.add(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4), chrome, [-2.1, 1.3, 0.6]);
    for (let k = 0; k < 5; k++) p.add(new THREE.BoxGeometry(0.6, 0.08, 0.02), std(k % 2 ? '#ffffff' : '#c8102e'), [-2.4, 1.95 - k * 0.08, 0.6]);
    p.add(new THREE.BoxGeometry(0.25, 0.2, 0.025), std('#1f3a8a'), [-2.23, 1.89, 0.6]);
  }
  if (d.extras.includes('cactus')) {
    const g = std('#3f8f3a', { roughness: 0.8 });
    p.add(new THREE.CapsuleGeometry(0.16, 0.7, 6, 10), g, [1.25, 1.1, 0]);
    p.limb(V(1.25, 1.15, 0.05), V(1.25, 1.45, 0.38), 0.08, g);
    p.limb(V(1.25, 1.0, -0.05), V(1.25, 1.3, -0.35), 0.08, g);
  }
  if (d.extras.includes('teacup')) {
    p.add(new THREE.CylinderGeometry(0.16, 0.12, 0.18, 16), std('#ffffff'), [1.0, 1.17, 0.55]);
    p.add(new THREE.TorusGeometry(0.07, 0.02, 6, 12), std('#ffffff'), [1.0, 1.17, 0.73]);
  }
  p.into(body);

  const fig = buildDriverFigure(d, V(steeringWheel ? 0.62 : 0.45, steeringWheel ? 0.6 : 0.5, 0.24));
  fig.position.copy(seat);
  fig.scale.setScalar(d.body === 'stroller' ? 0.95 : 1);
  body.add(fig);

  // Exhaust flames, shown when boosting.
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const flames = exhaust.map((e) => {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.9, 10), flameMat);
    f.rotation.z = Math.PI / 2;
    f.position.copy(e).add(V(-0.45, 0, 0));
    f.visible = false;
    body.add(f);
    return f;
  });

  // The bodyguard's bubble.
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(2.3, 28, 18),
    new THREE.MeshStandardMaterial({ color: '#7fd4ff', emissive: '#2a8fd9', emissiveIntensity: 0.6, transparent: true, opacity: 0.18, depthWrite: false, roughness: 0.1 }),
  );
  bubble.position.y = 1.1;
  bubble.visible = false;
  group.add(bubble);

  // The slipstream's wind: streaks of air running back past the kart, round its sides and over it.
  windTex ??= windStreak();
  const windGeo = new THREE.BoxGeometry(3.2, 0.06, 0.06);
  const winds = [
    [0.4, -1.3],
    [0.9, -1.2],
    [1.4, -0.9],
    [0.4, 1.3],
    [0.9, 1.2],
    [1.4, 0.9],
    [1.8, -0.35],
    [1.8, 0.35],
  ].map(([y, z], k) => {
    const m = new THREE.Mesh(windGeo, new THREE.MeshBasicMaterial({ color: '#e4f6ff', map: windTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(0, y, z);
    m.visible = false;
    group.add(m);
    return { m, phase: (k * 3) / 8 + Math.random() * 0.1 };
  });
  let wind = 0;

  // Wheels: the front ones on pivots to steer.
  const wheels: THREE.Group[] = [];
  const pivots: THREE.Group[] = [];
  for (const wd of [front, rear]) {
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(wd.x, wd.r, s * wd.z);
      const w = wheel(wd.r, wd.w, rim, wheelSpokes);
      pivot.add(w);
      body.add(pivot);
      wheels.push(w);
      if (wd === front) pivots.push(pivot);
    }
  }

  const head = fig.getObjectByName('head')!;

  // The café's easter egg: a cigarette in the corner of the mouth, and a beer swigged now and then.
  const cig = new THREE.Group();
  cig.add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.24, 6), std('#f4f1ea', { roughness: 0.6 })));
  const ember = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 6), new THREE.MeshBasicMaterial({ color: '#ff5a1a', toneMapped: false }));
  ember.position.y = 0.13;
  cig.add(ember);
  cig.rotation.z = -Math.PI / 2 - 0.2;
  cig.position.set(0.6, -0.19, 0.12);
  cig.visible = false;
  head.add(cig);
  const beer = new THREE.Group();
  const bottle = std('#4a6e22', { roughness: 0.15, metalness: 0.1 });
  beer.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.24, 10), bottle));
  beer.add(new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.09, 10), std('#f2e6c4')));
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.06, 0.13, 8), bottle);
  neck.position.y = 0.18;
  beer.add(neck);
  beer.children.forEach((m) => (m.position.y += 0.12));
  beer.scale.setScalar(1.6);
  beer.visible = false;
  fig.add(beer);
  // Held out to the right, and tipped up to the corner of the mouth: big, so it shows from the
  // chase camera behind the head.
  const hold = { x: 0.35, y: 0.85, z: 0.8, a: 0.25 };
  const swig = { x: 0.7, y: 1.62, z: 0.62, a: 2.25 };

  const baseColor = shell.color.clone();
  const baseMetal = shell.metalness;
  let spin = 0;
  let bob = 0;
  let bobV = 0;
  let lastSpeed = 0;
  let scale = 1;
  let t = 0;
  return {
    group,
    driver: d,
    exhaust,
    ember,
    update(speed, steer, dt, grounded, flags, vice = false) {
      t += dt;
      for (const w of wheels) w.rotation.z -= (speed / 0.42) * dt;
      for (const pv of pivots) pv.rotation.y = -steer * 0.45;
      // The bobblehead: a spring kicked by acceleration and bumps.
      const acc = (speed - lastSpeed) / Math.max(dt, 1e-3);
      lastSpeed = speed;
      bobV += (-bob * 60 - bobV * 5 - acc * 0.02 + (grounded ? 0 : 0.5)) * dt;
      bob += bobV * dt;
      head.rotation.z = Math.max(-0.5, Math.min(0.5, bob));
      head.rotation.x = -steer * 0.15;
      body.rotation.x = steer * 0.05 * Math.min(1, speed / 20);
      // Spinning out: two quick turns.
      if (flags & SPIN) spin += dt * 13;
      else spin = spin % (Math.PI * 2) > 0.05 ? spin + Math.min(dt * 13, Math.PI * 2 - (spin % (Math.PI * 2))) : 0;
      body.rotation.y = spin;
      const want = flags & SHRINK ? 0.55 : 1;
      scale += (want - scale) * Math.min(1, dt * 6);
      group.scale.setScalar(scale);
      // Gold plating.
      const gold = !!(flags & GOLD);
      shell.color.lerp(gold ? new THREE.Color('#ffd34d') : baseColor, Math.min(1, dt * 8));
      shell.metalness = gold ? 1 : baseMetal;
      shell.emissive.set(gold ? '#5a3c00' : '#000000');
      bubble.visible = !!(flags & SHIELD);
      if (bubble.visible) bubble.scale.setScalar(1 + Math.sin(t * 6) * 0.03);
      for (const f of flames) {
        f.visible = !!(flags & BOOST);
        if (f.visible) f.scale.set(1, 0.8 + Math.random() * 0.6, 1);
      }
      cig.visible = beer.visible = vice;
      if (vice) {
        // A swig every few seconds: the bottle up to the mouth and tipped, then back down.
        const p = (t % 3.4) / 3.4;
        const w = p < 0.32 ? Math.sin((p / 0.32) * Math.PI) : 0;
        beer.position.set(hold.x + (swig.x - hold.x) * w, hold.y + (swig.y - hold.y) * w, hold.z + (swig.z - hold.z) * w);
        beer.rotation.z = hold.a + (swig.a - hold.a) * w;
        ember.scale.setScalar(0.8 + Math.random() * 0.5);
      }
      wind += ((flags & SLIP ? 1 : 0) - wind) * Math.min(1, dt * 5);
      for (const w of winds) {
        w.m.visible = wind > 0.02;
        if (!w.m.visible) continue;
        w.phase = (w.phase + dt * 2.2) % 1;
        w.m.position.x = 2.2 - w.phase * 5;
        (w.m.material as THREE.MeshBasicMaterial).opacity = wind * 0.9 * Math.sin(Math.PI * w.phase);
      }
    },
  };
}
