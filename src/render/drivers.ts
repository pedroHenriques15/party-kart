// The drivers: the five friends the Volta dos Amigos goes past, as cartoon bobbleheads, each in a
// car that's a joke about them. Every face is the same friendly cartoon face.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GunLook } from './arms.ts';
import { buildGun } from './arms.ts';
import * as tex from './textures.ts';
import { windStreak } from './textures.ts';

export type Body = 'kart' | 'trolley' | 'banger' | 'chair';
export type Extra =
  // On the driver.
  | 'hair'
  | 'glasses'
  | 'headset'
  | 'cap'
  | 'capback'
  | 'nightcap'
  | 'watch'
  | 'mask'
  | 'headmirror'
  // On the car.
  | 'laptop'
  | 'antenna'
  | 'neon'
  | 'groceries'
  | 'alarm'
  | 'hourglass'
  | 'clockwheels'
  | 'toothbrush'
  | 'tooth';
export type Trail = 'bits' | 'receipts' | 'smoke' | 'sparkle' | 'foam' | null;

export interface Driver {
  id: string;
  name: string;
  tagline: string;
  body: Body;
  color: string;
  trim: string;
  alt: { color: string; trim: string }; // the second paint, for a bot repeating the driver
  skin: string;
  outfit: string;
  extras: Extra[];
  trail: Trail;
  horn: number[]; // notes, in Hz
}

// In the order the Volta dos Amigos passes their houses.
export const DRIVERS: Driver[] = [
  { id: 'pedro', name: 'Pedro', tagline: 'Já experimentaste desligar e voltar a ligar?', body: 'kart', color: '#16181d', trim: '#22d3ee', alt: { color: '#eef1f5', trim: '#7c3aed' }, skin: '#e2a98a', outfit: '#2b2f36', extras: ['hair', 'glasses', 'headset', 'laptop', 'antenna', 'neon'], trail: 'bits', horn: [988, 1319, 1760] },
  { id: 'joel', name: 'Joel', tagline: 'Abra bem a boca! Não vai doer nada.', body: 'chair', color: '#f4f6f5', trim: '#6fd6c1', alt: { color: '#6fd6c1', trim: '#f4f6f5' }, skin: '#dba383', outfit: '#ffffff', extras: ['hair', 'mask', 'headmirror', 'toothbrush', 'tooth'], trail: 'foam', horn: [2093, 2217, 2093, 2349] },
  { id: 'joelf', name: 'Joel F.', tagline: 'Próximo cliente, faz favor!', body: 'trolley', color: '#00843d', trim: '#f39200', alt: { color: '#f39200', trim: '#00843d' }, skin: '#d99c7c', outfit: '#ffffff', extras: ['cap', 'groceries'], trail: 'receipts', horn: [784, 659, 523] },
  { id: 'capelas', name: 'Capelas', tagline: 'Vende-se para peças. Aceito propostas.', body: 'banger', color: '#9b4a3c', trim: '#8a8f96', alt: { color: '#5f7d8c', trim: '#8a8f96' }, skin: '#d8a07f', outfit: '#3d4a5c', extras: ['capback'], trail: 'smoke', horn: [180, 160, 140, 110] },
  { id: 'vale', name: 'Vale', tagline: 'A cinco minutos daí. Desde sempre.', body: 'kart', color: '#1f3b73', trim: '#e0b94a', alt: { color: '#7a1f2b', trim: '#e0b94a' }, skin: '#e0a585', outfit: '#9fb8e6', extras: ['nightcap', 'watch', 'alarm', 'hourglass', 'clockwheels'], trail: 'sparkle', horn: [1568, 1760, 1568, 1760, 1568, 1760] },
];

// Past five karts, bots drive the same cars again in their second paint: "Pedro II".
export const repeatOf = (id: string) => `${id}-2`;

export function driverById(id: string): Driver {
  const d = DRIVERS.find((x) => x.id === id.replace(/-2$/, '')) ?? DRIVERS[0];
  return id.endsWith('-2') && d.id !== id ? { ...d, id, name: `${d.name} II`, color: d.alt.color, trim: d.alt.trim } : d;
}

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
// Materials with a picture on them, made once and shared.
const pictures = new Map<string, THREE.Material>();
const picture = (key: string, make: () => THREE.Material) => {
  if (!pictures.has(key)) pictures.set(key, make());
  return pictures.get(key)!;
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

  // A flat slab from a to b in the side view (x forward, y up), `w` across and `thick` deep.
  slab(a: [number, number], b: [number, number], w: number, thick: number, mat: THREE.Material, z = 0): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    this.add(new THREE.BoxGeometry(len, thick, w), mat, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z], [0, 0, Math.atan2(b[1] - a[1], b[0] - a[0])]);
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
// Without its arms, for one standing that swings them (buildWalker).
export function buildDriverFigure(d: Driver, hands: THREE.Vector3 = V(0.62, 0.62, 0.26), arms = true): THREE.Group {
  const fig = new THREE.Group();
  const body = new Parts();
  const face = new Parts();
  const skin = std(d.skin, { roughness: 0.7 });
  const skinDark = std(new THREE.Color(d.skin).multiplyScalar(0.82).getStyle(), { roughness: 0.7 });
  const outfit = std(d.outfit, { roughness: 0.75 });
  const black = std('#151515', { roughness: 0.4 });
  const white = std('#ffffff', { roughness: 0.3 });
  const brass = std('#e0b94a', { metalness: 1, roughness: 0.22 });
  const chrome = std('#e8ecf1', { metalness: 1, roughness: 0.15 });
  const mouth = std('#6b1f24', { roughness: 0.6 });

  body.add(new THREE.CapsuleGeometry(0.3, 0.32, 6, 14), outfit, [0, 0.48, 0], [0, 0, 0], [1, 1, 1.15]);
  for (const s of arms ? [-1, 1] : []) {
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

  // A cap: the crown in one colour, the peak in another, pointing forward (or back).
  const cap = (crown: THREE.Material, peak: THREE.Material, back: boolean) => {
    face.add(new THREE.SphereGeometry(0.585, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.3), crown, [0, 0.1, 0]);
    face.add(new THREE.BoxGeometry(0.5, 0.04, 0.62), peak, [back ? -0.62 : 0.62, 0.24, 0], [0, 0, back ? 0.12 : -0.12]);
    face.add(new THREE.SphereGeometry(0.05, 8, 6), peak, [0, 0.69, 0]);
  };
  for (const e of d.extras) {
    switch (e) {
      case 'hair':
        face.add(new THREE.SphereGeometry(0.575, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), std('#3b2a20', { roughness: 0.9 }), [-0.05, 0.08, 0]);
        break;
      case 'glasses':
        // Square frames, a bridge, and the arms back to the ears.
        for (const s of [-1, 1]) {
          face.add(new THREE.TorusGeometry(0.12, 0.022, 6, 4), black, [0.6, 0.1, s * 0.19], [0, Math.PI / 2, Math.PI / 4]);
          face.add(new THREE.BoxGeometry(0.42, 0.025, 0.025), black, [0.38, 0.13, s * 0.33], [0, s * 0.35, 0]);
        }
        face.add(new THREE.BoxGeometry(0.03, 0.025, 0.12), black, [0.62, 0.14, 0]);
        break;
      case 'headset': {
        const dark = std('#25272c', { roughness: 0.45 });
        face.add(new THREE.TorusGeometry(0.6, 0.045, 8, 24, Math.PI), dark, [0, 0.02, 0], [0, Math.PI / 2, 0]);
        for (const s of [-1, 1]) face.add(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 18), dark, [0, 0, s * 0.58], [Math.PI / 2, 0, 0]);
        face.limb(V(0.05, -0.08, -0.62), V(0.5, -0.2, -0.3), 0.022, dark);
        face.add(new THREE.SphereGeometry(0.055, 10, 8), std('#22d3ee', { emissive: '#0b6f80' }), [0.52, -0.2, -0.28]);
        break;
      }
      case 'cap':
        cap(std(d.color, { roughness: 0.8 }), std(d.trim, { roughness: 0.7 }), false);
        break;
      case 'capback':
        cap(std('#5b6168', { roughness: 0.9 }), std('#3d4249', { roughness: 0.9 }), true);
        break;
      case 'nightcap': {
        // Floppy, striped, flopping back, with a bobble on the end.
        const cloth = std(d.outfit, { roughness: 0.95 });
        face.add(new THREE.TorusGeometry(0.52, 0.08, 8, 24), std('#ffffff', { roughness: 0.95 }), [0, 0.22, 0], [Math.PI / 2, 0, 0]);
        face.add(new THREE.ConeGeometry(0.52, 1.1, 18), cloth, [-0.15, 0.68, 0], [0, 0, 0.6]);
        face.add(new THREE.SphereGeometry(0.13, 10, 8), std('#ffffff', { roughness: 0.95 }), [-0.47, 1.12, 0]);
        break;
      }
      case 'watch':
        // A big wristwatch on the right wrist, held where it can be looked at.
        if (!arms) break;
        body.add(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 18), brass, [hands.x - 0.12, hands.y + 0.1, hands.z], [0.3, 0, 0]);
        body.add(new THREE.CylinderGeometry(0.12, 0.12, 0.065, 18), white, [hands.x - 0.12, hands.y + 0.105, hands.z], [0.3, 0, 0]);
        break;
      case 'mask':
        face.add(new THREE.SphereGeometry(0.3, 16, 12), std('#a8d8ea', { roughness: 0.9 }), [0.45, -0.12, 0], [0, 0, 0], [0.4, 0.62, 1.05]);
        for (const s of [-1, 1]) face.add(new THREE.TorusGeometry(0.1, 0.012, 4, 12), std('#e6f3f8'), [0.2, -0.02, s * 0.52], [0, 0, 0]);
        break;
      case 'headmirror':
        // The band round the head, and the round mirror over one eye.
        face.add(new THREE.TorusGeometry(0.565, 0.03, 6, 28), std('#2a2a2e'), [0, 0.28, 0], [Math.PI / 2, 0, 0]);
        face.add(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 22), chrome, [0.55, 0.42, 0.14], [0, 0, Math.PI / 2 - 0.35]);
        face.add(new THREE.CylinderGeometry(0.035, 0.035, 0.035, 10), black, [0.565, 0.425, 0.14], [0, 0, Math.PI / 2 - 0.35]);
        break;
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

// A wheel; `face` puts a picture on its hubs (Vale's clock faces).
function wheel(r: number, w: number, rimMat: THREE.Material, spokes = 5, face?: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const p = new Parts();
  const tyreMat = std('#1b1b1d', { roughness: 0.92 });
  p.add(tyre(r, w), tyreMat, [0, 0, 0]);
  p.add(new THREE.CylinderGeometry(r * 0.6, r * 0.6, w * 0.8, 20), rimMat, [0, 0, 0], [Math.PI / 2, 0, 0]);
  p.add(new THREE.CylinderGeometry(r * 0.16, r * 0.16, w * 0.95, 10), std('#2a2a2e'), [0, 0, 0], [Math.PI / 2, 0, 0]);
  if (face) {
    for (const s of [-1, 1]) p.add(new THREE.CircleGeometry(r * 0.58, 24), face, [0, 0, s * (w * 0.4 + 0.01)], [0, s < 0 ? Math.PI : 0, 0]);
  } else {
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2;
      for (const s of [-1, 1]) p.add(new THREE.BoxGeometry(r * 0.12, r * 0.95, 0.03), std('#2a2a2e'), [Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, (s * w * 0.8) / 2], [0, 0, a - Math.PI / 2]);
    }
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

// A quad through four corners, its picture repeating every `cell` metres (the trolley's wire).
function quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, cell: number): THREE.BufferGeometry {
  const u = a.distanceTo(b) / cell;
  const v = a.distanceTo(d) / cell;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a, b, c, a, c, d].flatMap((p) => p.toArray()), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, u, 0, u, v, 0, 0, u, v, 0, v], 2));
  g.computeVertexNormals();
  return g;
}

// A clock's face, shared by every clock on a car.
const clockFace = () => picture('clock', () => new THREE.MeshStandardMaterial({ map: tex.clockFace(), roughness: 0.4 }));

// A clock's hands, from the middle of its face, turning about z.
function clockHands(size: number, color = '#1b1b1d'): { group: THREE.Group; hour: THREE.Object3D; minute: THREE.Object3D } {
  const group = new THREE.Group();
  const m = std(color, { roughness: 0.4 });
  const hand = (len: number, w: number) => {
    const pivot = new THREE.Group();
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.02, len, w), m);
    h.position.y = len / 2 - 0.02;
    pivot.add(h);
    group.add(pivot);
    return pivot;
  };
  const hour = hand(size * 0.5, size * 0.09);
  const minute = hand(size * 0.8, size * 0.06);
  group.add(new THREE.Mesh(new THREE.SphereGeometry(size * 0.07, 10, 8), std('#c8102e')));
  return { group, hour, minute };
}

export interface KartModel {
  group: THREE.Group;
  driver: Driver;
  figure: THREE.Object3D; // the driver in the seat, hidden while they're out of the car
  exhaust: THREE.Vector3[]; // where the exhausts are, in the kart's frame
  ember: THREE.Object3D; // the cigarette's lit end, where its smoke comes from
  // vice: the café's easter egg is on, a cigarette and a beer for the driver.
  update: (speed: number, steer: number, dt: number, grounded: boolean, flags: number, vice?: boolean) => void;
}

// Where Joel sits in his chair.
const CHAIR_SEAT = V(-0.15, 0.95, 0);

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
  // Capelas's paint is faded and dull; everyone else's is glossy.
  const shell: THREE.MeshStandardMaterial = d.body === 'banger' ? new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.85, metalness: 0.05 }) : paint(d.color, 0.25);
  const trim = sharedPaint(d.trim, 0.4);
  const dark = std('#1d1e22', { roughness: 0.5, metalness: 0.3 });
  const chrome = std('#e8ecf1', { metalness: 1, roughness: 0.15 });
  const brass = std('#e0b94a', { metalness: 1, roughness: 0.2 });
  const lamp = std('#fffbe0', { emissive: '#fff3b0', emissiveIntensity: 1.5 });
  const rim = d.extras.includes('clockwheels') ? brass : chrome;
  // What moves on the car besides the wheels: run every frame with the time and the speed.
  const moving: ((t: number, speed: number) => void)[] = [];

  let front = { x: 1.15, r: 0.36, w: 0.3, z: 0.95 };
  let rear = { x: -1.15, r: 0.42, w: 0.42, z: 1.0 };
  let seat = V(-0.38, 0.5, 0);
  let wheelSpokes = 5;
  let exhaust: THREE.Vector3[] = [V(-1.85, 0.72, -0.25), V(-1.85, 0.72, 0.25)];
  let steeringWheel = true;
  let hold = V(0.62, 0.6, 0.24); // where the hands are, from the seat

  switch (d.body) {
    case 'trolley': {
      // Joel F.'s: a supermarket trolley in Mercadona's green and orange. The basket is wire,
      // wider at the top and the back; he sits in it, on the shopping.
      const wire = picture(`wire${d.color}`, () => {
        const t = tex.drawTexture(32, 32, (g) => {
          g.clearRect(0, 0, 32, 32);
          g.fillStyle = '#ffffff';
          g.fillRect(0, 0, 32, 4);
          g.fillRect(0, 0, 4, 32);
        });
        return new THREE.MeshStandardMaterial({ color: d.color, map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.3 });
      });
      const [bx0, bx1, by, bw] = [-0.95, 1.0, 0.55, 0.48];
      const [tx0, tx1, ty, tw] = [-1.35, 1.35, 1.45, 0.66];
      const c = {
        bl: [V(bx0, by, -bw), V(bx0, by, bw)],
        br: [V(bx1, by, -bw), V(bx1, by, bw)],
        tl: [V(tx0, ty, -tw), V(tx0, ty, tw)],
        tr: [V(tx1, ty, -tw), V(tx1, ty, tw)],
      };
      p.add(quad(c.bl[0], c.br[0], c.tr[0], c.tl[0], 0.13), wire, [0, 0, 0]);
      p.add(quad(c.bl[1], c.br[1], c.tr[1], c.tl[1], 0.13), wire, [0, 0, 0]);
      p.add(quad(c.br[0], c.br[1], c.tr[1], c.tr[0], 0.13), wire, [0, 0, 0]);
      p.add(quad(c.bl[0], c.bl[1], c.tl[1], c.tl[0], 0.13), wire, [0, 0, 0]);
      p.add(quad(c.bl[0], c.br[0], c.br[1], c.bl[1], 0.13), wire, [0, 0, 0]);
      // The frame round the basket's edges, in the trolley's paint (gold under the filigrana).
      for (const [a, b] of [[c.bl[0], c.br[0]], [c.bl[1], c.br[1]], [c.tl[0], c.tr[0]], [c.tl[1], c.tr[1]], [c.tl[0], c.tl[1]], [c.tr[0], c.tr[1]], [c.bl[0], c.tl[0]], [c.bl[1], c.tl[1]], [c.br[0], c.tr[0]], [c.br[1], c.tr[1]]]) p.limb(a, b, 0.035, shell);
      // The chassis: two rails, the rack under the basket, the legs.
      for (const s of [-1, 1]) {
        p.limb(V(-1.2, 0.28, s * 0.42), V(1.05, 0.28, s * 0.42), 0.04, shell);
        p.limb(V(bx0, by, s * bw), V(-1.05, 0.28, s * 0.42), 0.035, shell);
        p.limb(V(bx1, by, s * bw), V(0.95, 0.28, s * 0.42), 0.035, shell);
        // The handle's posts, back from the top.
        p.limb(V(tx0, ty, s * tw), V(-1.62, 1.72, s * 0.6), 0.04, shell);
      }
      p.add(new THREE.BoxGeometry(1.9, 0.03, 0.8), wire, [-0.1, 0.32, 0]);
      p.add(new THREE.CylinderGeometry(0.065, 0.065, 1.32, 14), trim, [-1.64, 1.74, 0], [Math.PI / 2, 0, 0]);
      // Mercadona's name on the front.
      const plate = picture('mercadona', () => new THREE.MeshBasicMaterial({ map: tex.sign('MERCADONA', '', '#ffffff', '#00843d', 512, 112, '#f39200') }));
      p.add(new THREE.PlaneGeometry(0.95, 0.21), plate, [1.29, 1.22, 0], [0, Math.PI / 2, -0.32]);
      front = { x: 0.95, r: 0.2, w: 0.12, z: 0.45 };
      rear = { x: -0.95, r: 0.2, w: 0.12, z: 0.45 };
      seat = V(0.0, 0.6, 0);
      hold = V(0.55, 0.75, 0.42);
      wheelSpokes = 4;
      exhaust = [];
      steeringWheel = false;
      break;
    }
    case 'banger': {
      // Capelas's: a boxy old hatchback ready to be sold for parts. Its roof's already gone; the
      // paint is faded and rusting, a door is in grey primer, the windscreen's cracked, the front
      // bumper hangs off and swings, a headlight's smashed and a rear light taped up.
      p.add(profile(smooth([[1.95, 0.32], [1.98, 0.62], [1.8, 0.8], [0.55, 0.88], [0.4, 0.95], [-1.55, 0.98], [-1.9, 0.92], [-1.95, 0.55], [-1.9, 0.3], [1.7, 0.24]], 3), 1.55, 0.06), shell, [0, 0, 0]);
      const rust = std('#7a3d1c', { roughness: 1 });
      for (const [x, y, w, h, s] of [[1.3, 0.45, 0.35, 0.2, 1], [-1.4, 0.42, 0.42, 0.24, 1], [-0.9, 0.78, 0.3, 0.12, -1], [1.5, 0.6, 0.26, 0.16, -1], [0.2, 0.32, 0.5, 0.1, -1], [-1.75, 0.7, 0.2, 0.3, -1]]) p.add(new THREE.BoxGeometry(w, h, 0.02), rust, [x, y, s * 0.79]);
      p.add(new THREE.BoxGeometry(0.55, 0.02, 0.4), rust, [1.25, 0.86, 0.25], [0, 0, 0.06]);
      // The door from a scrapyard, in primer, and the gaps round it.
      p.add(new THREE.BoxGeometry(1.0, 0.52, 0.02), trim, [-0.25, 0.6, 0.79]);
      p.add(new THREE.BoxGeometry(0.6, 0.025, 0.025), dark, [-1.15, 0.72, -0.79]);
      // The windscreen's frame, and its glass with a crack across it.
      for (const s of [-1, 1]) p.limb(V(0.5, 0.92, s * 0.72), V(0.15, 1.5, s * 0.72), 0.04, dark);
      p.limb(V(0.15, 1.5, -0.72), V(0.15, 1.5, 0.72), 0.04, dark);
      const glass = picture('cracked', () => {
        const t = tex.drawTexture(
          256,
          128,
          (g) => {
            g.fillStyle = 'rgba(190, 220, 235, 0.3)';
            g.fillRect(0, 0, 256, 128);
            g.strokeStyle = 'rgba(255, 255, 255, 0.95)';
            g.lineWidth = 2;
            for (let k = 0; k < 11; k++) {
              const a = (k / 11) * Math.PI * 2 + 0.3;
              g.beginPath();
              g.moveTo(170, 50);
              let [x, y] = [170, 50];
              for (let j = 0; j < 4; j++) {
                x += Math.cos(a + (j % 2 ? 0.25 : -0.2)) * 28;
                y += Math.sin(a + (j % 2 ? 0.25 : -0.2)) * 28;
                g.lineTo(x, y);
              }
              g.stroke();
            }
            g.beginPath();
            g.arc(170, 50, 14, 0, Math.PI * 2);
            g.stroke();
          },
          false,
        );
        return new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.05, side: THREE.DoubleSide });
      });
      p.add(new THREE.PlaneGeometry(1.42, 0.68).rotateY(Math.PI / 2).rotateZ(0.54), glass, [0.33, 1.21, 0]);
      // The grille, one headlight lit and one smashed, the rear lights (one taped), the back bumper.
      p.add(new THREE.BoxGeometry(0.05, 0.22, 0.8), dark, [1.99, 0.5, 0]);
      p.add(new THREE.CircleGeometry(0.12, 14), lamp, [1.99, 0.6, -0.55], [0, Math.PI / 2, 0]);
      p.add(new THREE.CircleGeometry(0.12, 14), std('#3a3a3a', { roughness: 0.3 }), [1.99, 0.6, 0.55], [0, Math.PI / 2, 0]);
      for (const s of [-1, 1]) p.add(new THREE.BoxGeometry(0.03, 0.22, 0.26), std('#a01818', { emissive: '#3a0000' }), [-1.96, 0.7, s * 0.58]);
      for (const a of [-0.7, 0.7]) p.add(new THREE.BoxGeometry(0.03, 0.06, 0.38), std('#c9ccd1', { roughness: 0.6, metalness: 0.4 }), [-1.98, 0.7, 0.58], [a, 0, 0]);
      p.add(new THREE.BoxGeometry(0.16, 0.16, 1.5), dark, [-1.96, 0.3, 0]);
      // "For sale, for parts", on the back and the side, and the spare tyre on the back seat.
      const forSale = picture('forsale', () => new THREE.MeshBasicMaterial({ map: tex.sign('VENDE-SE', 'PARA PEÇAS · 9XX XXX XXX', '#ffffff', '#c8102e', 512, 256, '#c8102e') }));
      p.add(new THREE.PlaneGeometry(0.6, 0.3), forSale, [-1.97, 0.95, -0.2], [0, -Math.PI / 2, 0]);
      p.add(new THREE.PlaneGeometry(0.6, 0.3), forSale, [-1.2, 1.12, 0.79], [0, 0, 0]);
      p.add(new THREE.PlaneGeometry(0.6, 0.3), forSale, [-1.2, 1.12, -0.79], [0, Math.PI, 0]);
      p.add(tyre(0.36, 0.22), std('#1b1b1d', { roughness: 0.92 }), [-1.3, 1.08, 0.3], [Math.PI / 2, 0, 0.15]);
      // The tailpipe, tied up with wire.
      p.add(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), std('#55504a', { roughness: 0.9 }), [-1.85, 0.2, -0.45], [0, 0, Math.PI / 2 - 0.15]);
      // The front bumper, hanging off by one end and swinging as he goes.
      const bumper = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.5), dark);
      bar.position.z = 0.75;
      bar.castShadow = true;
      bumper.add(bar);
      bumper.position.set(2.0, 0.3, -0.75);
      body.add(bumper);
      moving.push((t, speed) => (bumper.rotation.x = 0.22 + Math.sin(t * 9) * 0.07 * Math.min(1, speed / 8)));
      front = { x: 1.25, r: 0.36, w: 0.26, z: 0.78 };
      rear = { x: -1.25, r: 0.36, w: 0.26, z: 0.78 };
      seat = V(-0.35, 0.55, 0);
      exhaust = [V(-2.1, 0.2, -0.45)];
      break;
    }
    case 'chair': {
      // Joel's: his dentist's chair on wheels. The base and the frame are its paint, the cushions
      // the mint upholstery; the lamp on its arm over his head, the spittoon on one side and the
      // tray of instruments on the other.
      const cushion = std(d.trim, { roughness: 0.6 });
      const white = std('#fbfbf8', { roughness: 0.3 });
      p.add(profile([[1.35, 0.25], [1.35, 0.47], [-1.35, 0.47], [-1.35, 0.25]], 1.25, 0.08), shell, [0, 0, 0]);
      p.add(new THREE.CylinderGeometry(0.22, 0.28, 0.4, 18), chrome, [-0.05, 0.65, 0]);
      p.slab([1.35, 0.82], [0.3, 0.95], 0.7, 0.16, cushion);
      p.slab([0.3, 0.95], [-0.38, 0.95], 0.82, 0.22, cushion);
      p.slab([-0.38, 0.95], [-0.95, 1.75], 0.76, 0.18, cushion);
      p.slab([-0.95, 1.75], [-1.08, 2.02], 0.42, 0.14, cushion);
      p.slab([0.35, 0.78], [-0.4, 0.78], 0.86, 0.12, shell);
      for (const s of [-1, 1]) p.add(new THREE.BoxGeometry(0.7, 0.07, 0.12), shell, [0.0, 1.18, s * 0.47]);
      // The lamp: a post at the back, an arm over the top, the light looking down at the patient.
      p.limb(V(-1.25, 0.47, -0.55), V(-1.25, 2.55, -0.55), 0.05, white);
      p.limb(V(-1.25, 2.55, -0.55), V(0.15, 2.65, -0.15), 0.045, white);
      p.add(new THREE.BoxGeometry(0.5, 0.16, 0.32), std('#5b6168', { roughness: 0.4 }), [0.3, 2.55, -0.05], [0, 0, -0.3]);
      p.add(new THREE.PlaneGeometry(0.42, 0.26), lamp, [0.3, 2.465, -0.05], [Math.PI / 2, 0, 0.3]);
      // The spittoon on the left, the tray and its drills on the right.
      p.limb(V(0.6, 0.47, -0.62), V(0.6, 1.05, -0.62), 0.05, white);
      p.add(new THREE.SphereGeometry(0.17, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std('#fbfbf8', { roughness: 0.3, side: THREE.DoubleSide }), [0.6, 1.2, -0.62]);
      p.add(new THREE.CylinderGeometry(0.05, 0.04, 0.12, 10), std('#bff3e6', { roughness: 0.3 }), [0.75, 1.2, -0.75]);
      p.limb(V(0.25, 0.47, 0.64), V(0.25, 1.2, 0.64), 0.04, white);
      p.add(new THREE.BoxGeometry(0.55, 0.04, 0.36), white, [0.45, 1.24, 0.66]);
      for (const z of [0.56, 0.66, 0.76]) p.add(new THREE.CylinderGeometry(0.025, 0.02, 0.32, 8), chrome, [0.48, 1.29, z], [0, 0, Math.PI / 2]);
      // A steering column up from the base: it's a car now.
      p.limb(V(1.0, 0.47, 0), V(CHAIR_SEAT.x + 0.78, CHAIR_SEAT.y + 0.42, 0), 0.04, chrome);
      front = { x: 1.0, r: 0.26, w: 0.16, z: 0.56 };
      rear = { x: -1.0, r: 0.26, w: 0.16, z: 0.56 };
      seat = CHAIR_SEAT.clone();
      wheelSpokes = 6;
      exhaust = [V(-1.4, 0.36, 0.4)];
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
  const has = (e: Extra) => d.extras.includes(e);
  if (has('laptop')) {
    // Pedro's laptop, open on the nose, code on its screen and a glowing logo on its lid.
    const screen = picture('code', () => {
      const t = tex.drawTexture(
        256,
        160,
        (g) => {
          g.fillStyle = '#0d1117';
          g.fillRect(0, 0, 256, 160);
          const colors = ['#79c0ff', '#ff7b72', '#d2a8ff', '#7ee787', '#e6edf3'];
          for (let y = 12, k = 0; y < 150; y += 12, k++) {
            let x = 10 + ((k * 7) % 4) * 12;
            for (let w = 0; w < 3 + (k % 3); w++) {
              const len = 14 + ((k * 13 + w * 29) % 40);
              g.fillStyle = colors[(k + w) % colors.length];
              g.fillRect(x, y, len, 5);
              x += len + 8;
            }
          }
        },
        false,
      );
      return new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
    });
    const alu = std('#9aa3ad', { metalness: 0.8, roughness: 0.3 });
    p.add(new THREE.BoxGeometry(0.5, 0.035, 0.72), alu, [0.92, 0.72, 0], [0, 0, -0.05]);
    p.add(new THREE.BoxGeometry(0.03, 0.46, 0.72), alu, [1.16, 0.95, 0], [0, 0, -0.25]);
    p.add(new THREE.PlaneGeometry(0.64, 0.4).rotateY(-Math.PI / 2).rotateZ(-0.25), screen, [1.14, 0.95, 0]);
    p.add(new THREE.CircleGeometry(0.06, 16), std(d.trim, { emissive: d.trim, emissiveIntensity: 1.2 }), [1.185, 0.96, 0], [0, Math.PI / 2, -0.25]);
  }
  if (has('neon')) {
    // The underglow, and a lit strip along each side.
    const glow = picture(`glow${d.trim}`, () => {
      const t = tex.drawTexture(
        64,
        64,
        (g) => {
          const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
          grad.addColorStop(0, 'rgba(255,255,255,0.9)');
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = grad;
          g.fillRect(0, 0, 64, 64);
        },
        false,
      );
      return new THREE.MeshBasicMaterial({ color: d.trim, map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    });
    const under = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.6).rotateX(-Math.PI / 2), glow);
    under.position.y = 0.04;
    group.add(under);
    for (const s of [-1, 1]) p.add(new THREE.BoxGeometry(1.5, 0.05, 0.03), std(d.trim, { emissive: d.trim, emissiveIntensity: 2 }), [0.05, 0.2, s * 1.0]);
  }
  if (has('antenna')) {
    // A Wi-Fi antenna at the back, its light blinking.
    p.add(new THREE.CylinderGeometry(0.02, 0.03, 1.0, 6), dark, [-1.55, 1.8, -0.6]);
    p.add(new THREE.BoxGeometry(0.3, 0.08, 0.2), dark, [-1.55, 1.35, -0.6]);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: d.trim, toneMapped: false }));
    led.position.set(-1.55, 2.33, -0.6);
    body.add(led);
    moving.push((t) => (led.visible = Math.sin(t * 7) > -0.2));
  }
  if (has('groceries')) {
    // The shopping round him: paper bags, a leek, a baguette, oranges, a pack of water.
    const paper = std('#c79a63', { roughness: 0.95 });
    p.add(new THREE.BoxGeometry(0.42, 0.5, 0.34), paper, [0.72, 0.82, 0.28]);
    p.add(new THREE.BoxGeometry(0.4, 0.46, 0.32), paper, [0.7, 0.8, -0.3], [0, 0.2, 0]);
    p.add(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 10), std('#f2f0e6', { roughness: 0.7 }), [0.9, 1.15, 0.32], [0.2, 0, -0.35]);
    p.add(new THREE.ConeGeometry(0.09, 0.6, 8), std('#3f8f3a', { roughness: 0.8 }), [1.07, 1.62, 0.4], [0.2, 0, -0.35]);
    p.add(new THREE.CapsuleGeometry(0.07, 0.75, 4, 10), std('#d9a35b', { roughness: 0.85 }), [0.62, 1.2, -0.32], [0.3, 0, 0.6]);
    for (const [x, z] of [[-0.75, 0.3], [-0.85, 0.12], [-0.68, 0.1]]) p.add(new THREE.SphereGeometry(0.11, 12, 8), std('#ff8c1a', { roughness: 0.7 }), [x, 0.72, z]);
    p.add(new THREE.BoxGeometry(0.36, 0.36, 0.5), std('#bfe3ff', { roughness: 0.2, transparent: true, opacity: 0.8 }), [-0.75, 0.8, -0.3]);
  }
  if (has('alarm')) {
    // Vale's alarm clock, as big as a wing, on the back where everyone behind him can see it:
    // its hands racing round and its bells shaking. He's late.
    const clock = new THREE.Group();
    const red = std('#c8102e', { roughness: 0.35, metalness: 0.3 });
    const caseMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.32, 32).rotateZ(Math.PI / 2), red);
    caseMesh.castShadow = true;
    clock.add(caseMesh);
    for (const s of [-1, 1]) {
      const faceMesh = new THREE.Mesh(new THREE.CircleGeometry(0.47, 32), clockFace());
      faceMesh.position.x = s * 0.165;
      faceMesh.rotation.y = s * (Math.PI / 2);
      clock.add(faceMesh);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 8, 32).rotateY(Math.PI / 2), brass);
      ring.position.x = s * 0.165;
      clock.add(ring);
    }
    for (const s of [-1, 1]) {
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), brass);
      bell.position.set(0, 0.6, s * 0.3);
      bell.rotation.x = s * 0.6;
      clock.add(bell);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.25, 8), brass);
      leg.position.set(0, -0.58, s * 0.3);
      leg.rotation.x = -s * 0.5;
      clock.add(leg);
    }
    const clapper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.06), brass);
    clapper.position.y = 0.7;
    clock.add(clapper);
    const back = clockHands(0.47);
    back.group.position.x = -0.18;
    back.group.rotation.y = -Math.PI / 2;
    clock.add(back.group);
    const ahead = clockHands(0.47);
    ahead.group.position.x = 0.18;
    ahead.group.rotation.y = Math.PI / 2;
    clock.add(ahead.group);
    clock.position.set(-1.4, 1.95, 0);
    body.add(clock);
    moving.push((t) => {
      for (const h of [back, ahead]) {
        h.minute.rotation.z = -t * 9;
        h.hour.rotation.z = -t * 0.75;
      }
      clock.rotation.x = Math.sin(t * 46) * 0.05;
      clapper.rotation.x = Math.sin(t * 46) * 0.6;
    });
  }
  if (has('hourglass')) {
    // An hourglass on the nose, turning over and over.
    const glassMat = std('#d8eef8', { roughness: 0.05, transparent: true, opacity: 0.45 });
    const sand = std('#e8c36a', { roughness: 0.9 });
    const hg = new THREE.Group();
    for (const s of [-1, 1]) {
      const bulb = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.26, 14), glassMat);
      bulb.position.y = s * 0.13;
      bulb.rotation.x = s > 0 ? Math.PI : 0;
      hg.add(bulb);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 14), std('#6b4a2a', { roughness: 0.7 }));
      cap.position.y = s * 0.28;
      hg.add(cap);
    }
    const heap = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.12, 12), sand);
    heap.position.y = -0.2;
    hg.add(heap);
    hg.position.set(1.25, 0.95, 0);
    body.add(hg);
    moving.push((t) => (hg.rotation.z = Math.floor(t / 2.5) * Math.PI + Math.min(1, (t % 2.5) / 0.4) * Math.PI));
  }
  if (has('toothbrush')) {
    // A giant toothbrush across the back for a spoiler, on two posts, toothpaste on its bristles.
    const handle = std('#2b78d4', { roughness: 0.35 });
    for (const s of [-1, 1]) p.limb(V(-1.3, 0.47, s * 0.45), V(-1.42, 1.15, s * 0.45), 0.04, handle);
    p.add(new THREE.CapsuleGeometry(0.08, 1.8, 4, 10), handle, [-1.42, 1.22, 0], [Math.PI / 2, 0, 0]);
    p.add(new THREE.BoxGeometry(0.2, 0.08, 0.42), handle, [-1.42, 1.3, 0.75]);
    for (let k = 0; k < 6; k++) p.add(new THREE.BoxGeometry(0.16, 0.24, 0.05), std('#ffffff', { roughness: 0.6 }), [-1.42, 1.45, 0.58 + k * 0.07]);
    p.add(new THREE.CapsuleGeometry(0.07, 0.3, 4, 8), std('#7fdcc8', { roughness: 0.5 }), [-1.42, 1.6, 0.76], [Math.PI / 2, 0, 0]);
  }
  if (has('tooth')) {
    // A molar on the nose, smiling.
    const enamel = std('#fbfbf6', { roughness: 0.22, metalness: 0.05 });
    p.add(new THREE.BoxGeometry(0.4, 0.3, 0.42), enamel, [1.18, 0.66, 0]);
    for (const [x, z] of [[-0.1, -0.11], [0.1, -0.11], [-0.1, 0.11], [0.1, 0.11]]) p.add(new THREE.SphereGeometry(0.13, 12, 8), enamel, [1.18 + x, 0.82, z]);
    for (const z of [-0.1, 0.1]) p.add(new THREE.SphereGeometry(0.03, 8, 6), std('#1b1b1d'), [1.385, 0.7, z]);
    p.add(new THREE.TorusGeometry(0.08, 0.015, 6, 12, Math.PI), std('#d23b5a'), [1.385, 0.62, 0], [0, Math.PI / 2, Math.PI]);
  }
  p.into(body);

  const fig = buildDriverFigure(d, hold);
  fig.position.copy(seat);
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

  // The guarda-chuva: open over the driver while it lasts, blue and white like the street plates.
  const umbrella = new THREE.Group();
  {
    const geo = new THREE.ConeGeometry(1.7, 0.6, 8, 1, true).toNonIndexed();
    const pos = geo.getAttribute('position');
    const col: number[] = [];
    const c = new THREE.Color();
    for (let k = 0; k < pos.count; k += 3) {
      const x = (pos.getX(k) + pos.getX(k + 1) + pos.getX(k + 2)) / 3;
      const z = (pos.getZ(k) + pos.getZ(k + 1) + pos.getZ(k + 2)) / 3;
      const panel = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 8);
      c.set(panel % 2 ? '#ffffff' : '#1d4f9c');
      for (let j = 0; j < 3; j++) col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const canopy = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 }));
    canopy.position.y = 0.3;
    canopy.castShadow = true;
    umbrella.add(canopy);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 8), dark);
    stick.position.y = -0.4;
    umbrella.add(stick);
    const crook = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 12, Math.PI), std('#6b3a1f'));
    crook.position.set(0.1, -1.15, 0);
    crook.rotation.z = Math.PI;
    umbrella.add(crook);
  }
  umbrella.position.set(seat.x, seat.y + 2.9, 0);
  umbrella.visible = false;
  body.add(umbrella);

  // The martelinho: a squeaky plastic hammer that bonks the driver on the head as they shrink.
  const hammer = new THREE.Group();
  {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 8), std('#ffd23f', { roughness: 0.4 }));
    handle.position.z = -0.55;
    handle.rotation.x = Math.PI / 2;
    hammer.add(handle);
    const headMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.6, 16), std('#e63946', { roughness: 0.35 }));
    headMesh.position.set(0, 0, -1.1);
    hammer.add(headMesh);
    for (const s of [-1, 1]) {
      const end = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.08, 16), std('#ffd23f', { roughness: 0.4 }));
      end.position.set(0, s * 0.3, -1.1);
      hammer.add(end);
    }
  }
  hammer.position.set(seat.x, seat.y + 1.28 + 0.55 + 0.3, 1.1);
  hammer.visible = false;
  body.add(hammer);

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

  // Wheels: the front ones on pivots to steer. Capelas's front right is the thin grey spare,
  // wobbling, and his back left has lost its hubcap.
  const wheels: THREE.Group[] = [];
  const pivots: THREE.Group[] = [];
  let wobbly: THREE.Group | null = null;
  const faces = has('clockwheels') ? clockFace() : undefined;
  for (const wd of [front, rear]) {
    for (const s of [-1, 1]) {
      const spare = d.body === 'banger' && wd === front && s > 0;
      const bare = d.body === 'banger' && wd === rear && s < 0;
      const pivot = new THREE.Group();
      pivot.position.set(wd.x, wd.r, s * wd.z);
      const w = wheel(spare ? wd.r * 0.92 : wd.r, spare ? wd.w * 0.55 : wd.w, spare ? std('#6b6f75', { roughness: 0.6 }) : bare ? std('#3a3d42', { roughness: 0.7 }) : rim, wheelSpokes, faces);
      if (spare) {
        w.position.y = -wd.r * 0.08;
        wobbly = w;
      }
      pivot.add(w);
      body.add(pivot);
      wheels.push(w);
      if (wd === front) pivots.push(pivot);
    }
  }

  const head = fig.getObjectByName('head')!;

  // The café's easter egg: a long cigarette out of the left corner of the mouth, poking out past
  // the head, and a beer mug raised on the right and swigged now and then. Cartoon-big, and one on
  // each side, so both show from the chase camera behind the driver and the smoke hides neither.
  const cig = new THREE.Group();
  const cigDir = new THREE.Vector3(0.25, 0.05, -0.97).normalize();
  cig.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.72, 8), std('#f4f1ea', { roughness: 0.6 })));
  const filter = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.14, 8), std('#d98a3a', { roughness: 0.7 }));
  filter.position.y = -0.3;
  cig.add(filter);
  const ember = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 8), new THREE.MeshBasicMaterial({ color: '#ff5a1a', toneMapped: false }));
  ember.position.y = 0.38;
  cig.add(ember);
  cig.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), cigDir);
  cig.position.set(0.5, -0.18, -0.15).addScaledVector(cigDir, 0.36);
  cig.name = 'cigarette';
  cig.visible = false;
  head.add(cig);
  const mesh3 = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    return o;
  };
  const beer = new THREE.Group();
  beer.add(mesh3(new THREE.CylinderGeometry(0.16, 0.15, 0.34, 16), std('#efa51c', { roughness: 0.15, emissive: '#5a3300', emissiveIntensity: 0.4 }), 0, 0.17, 0));
  beer.add(mesh3(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 16), std('#fbf8ee', { roughness: 0.9 }), 0, 0.36, 0));
  beer.add(mesh3(new THREE.SphereGeometry(0.15, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), std('#fbf8ee', { roughness: 0.9 }), 0, 0.38, 0));
  const handle = mesh3(new THREE.TorusGeometry(0.09, 0.028, 8, 16), std('#f3d58a', { roughness: 0.2 }), 0, 0.18, 0.17);
  handle.rotation.y = Math.PI / 2;
  beer.add(handle);
  beer.name = 'beer';
  beer.visible = false;
  fig.add(beer);
  // Raised beside the head on the right, and tipped towards the mouth for a swig.
  const raised = { x: 0.25, y: 1.12, z: 0.85, a: -0.15 };
  const swig = { x: 0.5, y: 1.3, z: 0.55, a: -1.1 };

  const baseColor = shell.color.clone();
  const baseMetal = shell.metalness;
  let spin = 0;
  let bob = 0;
  let bobV = 0;
  let lastSpeed = 0;
  let scale = 1;
  let t = 0;
  let bonk = 0; // seconds left of the martelinho's swing
  let wasShrunk = false;
  return {
    group,
    driver: d,
    figure: fig,
    exhaust,
    ember,
    update(speed, steer, dt, grounded, flags, vice = false) {
      t += dt;
      for (const w of wheels) w.rotation.z -= (speed / 0.42) * dt;
      for (const pv of pivots) pv.rotation.y = -steer * 0.45;
      if (wobbly) wobbly.rotation.x = Math.sin(t * 23) * 0.09 * Math.min(1, speed / 5);
      for (const m of moving) m(t, speed);
      // The bobblehead: a spring kicked by acceleration and bumps.
      const acc = (speed - lastSpeed) / Math.max(dt, 1e-3);
      lastSpeed = speed;
      bobV += (-bob * 60 - bobV * 5 - acc * 0.02 + (grounded ? 0 : 0.5)) * dt;
      bob += bobV * dt;
      head.rotation.z = Math.max(-0.5, Math.min(0.5, bob));
      head.rotation.x = -steer * 0.15;
      body.rotation.x = steer * 0.05 * Math.min(1, speed / 20);
      // Capelas's car rattles as it goes.
      if (d.body === 'banger') body.position.y = (Math.random() - 0.5) * 0.04 * Math.min(1, speed / 10);
      // Spinning out: two quick turns.
      if (flags & SPIN) spin += dt * 13;
      else spin = spin % (Math.PI * 2) > 0.05 ? spin + Math.min(dt * 13, Math.PI * 2 - (spin % (Math.PI * 2))) : 0;
      body.rotation.y = spin;
      const shrunk = !!(flags & SHRINK);
      if (shrunk && !wasShrunk) bonk = 0.7;
      wasShrunk = shrunk;
      const want = shrunk ? 0.55 : 1;
      scale += (want - scale) * Math.min(1, dt * 6);
      group.scale.setScalar(scale);
      // The martelinho: up, down on the head (which squashes), and gone.
      bonk = Math.max(0, bonk - dt);
      hammer.visible = bonk > 0;
      if (bonk > 0) {
        const u = 0.7 - bonk;
        hammer.rotation.x = u < 0.15 ? 0.3 + (u / 0.15) * 1.0 : u < 0.3 ? 1.3 * (1 - (u - 0.15) / 0.15) : 0;
        head.scale.set(1, u >= 0.3 && u < 0.5 ? 0.72 : 1, 1);
      } else head.scale.set(1, 1, 1);
      // Gold plating: the filigrana.
      const gold = !!(flags & GOLD);
      shell.color.lerp(gold ? new THREE.Color('#ffd34d') : baseColor, Math.min(1, dt * 8));
      shell.metalness = gold ? 1 : baseMetal;
      shell.emissive.set(gold ? '#5a3c00' : '#000000');
      umbrella.visible = !!(flags & SHIELD);
      if (umbrella.visible) umbrella.rotation.y += dt * 0.8;
      for (const f of flames) {
        f.visible = !!(flags & BOOST);
        if (f.visible) f.scale.set(1, 0.8 + Math.random() * 0.6, 1);
      }
      cig.visible = beer.visible = vice;
      if (vice) {
        // A swig every few seconds: the bottle up to the mouth and tipped, then back down.
        const p = (t % 3.4) / 3.4;
        const w = p < 0.32 ? Math.sin((p / 0.32) * Math.PI) : 0;
        beer.position.set(raised.x + (swig.x - raised.x) * w, raised.y + (swig.y - raised.y) * w, raised.z + (swig.z - raised.z) * w);
        beer.rotation.x = raised.a + (swig.a - raised.a) * w;
        ember.scale.setScalar(0.8 + Math.random() * 0.5);
        // And a tipsy sway of the head.
        head.rotation.x += Math.sin(t * 2.6) * 0.18;
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

export interface WalkerModel {
  group: THREE.Group;
  driver: Driver;
  // Walking or running at speed m/s, looking up by pitch.
  update: (speed: number, dt: number, pitch: number) => void;
  // In a round (braga-map's task 074): the gun in its hands, or none; and how far it has fallen, from
  // 0 standing to 1 down, and faded, from 0 to gone.
  arm: (kit: GunLook | null) => void;
  fall: (down: number, fade: number) => void;
  // Where its gun's muzzle is, in the world, for its shots' flash and tracers.
  muzzle: (out: THREE.Vector3) => THREE.Vector3;
  // Hit by a shot going the way d (in the world), as hard as k from 0 to 1: it jerks away from it.
  hit: (d: { x: number; y: number; z: number }, k: number) => void;
}

// The driver out of their car, standing (braga-map's task 073): the same figure on legs, swinging its
// arms as it walks, leaning into a run, and as tall as a walker is (game/walker.ts), its big head and
// all. Facing +x, its feet on y = 0.
const LEG = 0.72;
const STANDING = 1.75 / (LEG + 1.85);
export function buildWalker(d: Driver): WalkerModel {
  const group = new THREE.Group();
  const body = new THREE.Group(); // leans
  body.scale.setScalar(STANDING);
  group.add(body);
  const fig = buildDriverFigure(d, undefined, false);
  fig.position.y = LEG - 0.04;
  body.add(fig);
  const trousers = std(new THREE.Color(d.outfit).multiplyScalar(0.55).getStyle(), { roughness: 0.85 });
  const shoes = std('#1c1c1f', { roughness: 0.5 });
  const sleeve = std(d.outfit, { roughness: 0.75 });
  const skin = std(d.skin, { roughness: 0.7 });
  // A leg or an arm: a pivot at the hip or the shoulder, swinging forward and back about z.
  const limb = (at: THREE.Vector3, build: (p: Parts) => void) => {
    const pivot = new THREE.Group();
    pivot.position.copy(at);
    const p = new Parts();
    build(p);
    p.into(pivot);
    body.add(pivot);
    return pivot;
  };
  const legs = [-1, 1].map((s) =>
    limb(V(0, LEG, s * 0.15), (p) => {
      p.limb(V(0, 0.05, 0), V(0, -LEG + 0.1, 0), 0.12, trousers);
      p.add(new THREE.BoxGeometry(0.34, 0.12, 0.17), shoes, [0.06, -LEG + 0.06, 0]);
    }),
  );
  const arms = [-1, 1].map((s) =>
    limb(V(0.02, fig.position.y + 0.72, s * 0.36), (p) => {
      p.limb(V(0, 0, 0), V(0.02, -0.52, s * 0.06), 0.09, sleeve);
      p.add(new THREE.SphereGeometry(0.11, 12, 8), skin, [0.02, -0.58, s * 0.07]);
    }),
  );
  const head = fig.getObjectByName('head')!;
  let phase = 0;
  let swing = 0;
  // A shot's jerk, its lean the way the shot went, about its own x and z, dying away.
  const kick = new THREE.Vector2();
  const way = new THREE.Vector3();
  const inv = new THREE.Quaternion();
  // Its gun, held in front of its chest at a person's size whatever the figure's scale, made the
  // first time it holds that kit.
  const guns = new Map<GunLook, ReturnType<typeof buildGun>>();
  let held: ReturnType<typeof buildGun> | null = null;
  // Faded, its meshes wear their own copies of their materials, the shared ones kept to put back.
  const own = new Map<THREE.Mesh, THREE.Material>();
  return {
    group,
    driver: d,
    arm(kit) {
      if (held) held.group.visible = false;
      held = null;
      if (!kit) return;
      let g = guns.get(kit);
      if (!g) {
        g = buildGun(kit);
        g.group.scale.setScalar(1 / STANDING);
        g.group.position.set(0.42, LEG + 0.62, 0.16);
        guns.set(kit, g);
        body.add(g.group);
      }
      g.group.visible = true;
      held = g;
    },
    fall(down, fade) {
      group.rotation.z = (Math.PI / 2) * down * down;
      if (fade > 0 && !own.size) {
        group.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          own.set(o, o.material as THREE.Material);
          o.material = (o.material as THREE.Material).clone();
          Object.assign(o.material, { transparent: true, depthWrite: false });
        });
      }
      if (fade <= 0 && own.size) {
        for (const [m, mat] of own) m.material = mat;
        own.clear();
      }
      for (const m of own.keys()) (m.material as THREE.Material).opacity = 1 - fade;
      group.visible = fade < 1;
    },
    hit(d, k) {
      group.updateMatrixWorld(true);
      group.getWorldQuaternion(inv).invert();
      way.set(d.x, 0, d.z).normalize().applyQuaternion(inv);
      const a = 0.18 + 0.27 * Math.min(1, k);
      kick.set(kick.x + way.z * a, kick.y - way.x * a).clampLength(0, 0.5);
    },
    muzzle(out) {
      if (!held) return group.getWorldPosition(out);
      group.updateMatrixWorld(true);
      return out.copy(held.muzzle).applyMatrix4(held.group.matrixWorld);
    },
    update(speed, dt, pitch) {
      // A stride every 1.4 m walking, longer running; the legs swing further the faster it goes.
      phase += (dt * speed * Math.PI) / (speed > 3 ? 1.1 : 0.7);
      swing += (Math.min(0.9, speed * 0.28) - swing) * Math.min(1, dt * 8);
      if (speed < 0.1) phase += (Math.round(phase / Math.PI) * Math.PI - phase) * Math.min(1, dt * 8);
      const a = Math.sin(phase) * swing;
      legs[0].rotation.z = a;
      legs[1].rotation.z = -a;
      arms[0].rotation.z = -a * 0.8;
      arms[1].rotation.z = a * 0.8;
      kick.multiplyScalar(Math.exp(-dt * 9));
      body.rotation.x = kick.x;
      body.rotation.z = -Math.min(0.25, Math.max(0, speed - 2) * 0.08) + kick.y;
      body.position.y = speed > 3 ? Math.abs(Math.sin(phase)) * 0.05 : 0;
      head.rotation.z = Math.max(-0.6, Math.min(0.6, pitch * 0.6));
      // Holding a gun: both arms out to it, aimed where it looks, the legs still walking.
      if (held) {
        const up = Math.max(-0.9, Math.min(0.9, pitch));
        arms[1].rotation.set(0, 0.35, 1.2 + up);
        arms[0].rotation.set(0, -0.65, 1.45 + up);
        held.group.rotation.z = up;
        held.group.position.y = LEG + 0.62 + Math.sin(up) * 0.25;
      } else {
        arms[0].rotation.x = arms[1].rotation.x = arms[0].rotation.y = arms[1].rotation.y = 0;
      }
    },
  };
}
