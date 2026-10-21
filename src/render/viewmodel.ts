// Your weapon in first person (braga-map's task 074), held as Counter-Strike holds it: the CC0 model
// (render/models.ts) in gloved hands (render/hands.ts) at the bottom right, drawn over the world so it
// never goes into a wall. Everything it does is keyframed here, eased and sprung: drawn up from below,
// breathing, swaying as you turn and walk, dipping as you land, kicking at a shot (its slide or bolt
// snapping back, its brass flying out, its muzzle flashing), a magazine changed by the left hand, a
// shotgun loaded a shell at a time, a bolt or a pump worked after a shot, looked over (F), the knife's
// slash and stab, a grenade's pin pulled and thrown; and out of the way through a scope.
import * as THREE from 'three';
import { GUNS, isGun, isNade, WEAPON_IDS, type Family, type WeaponId } from '../game/arsenal.ts';
import { buildGun, flashSprite, lookOf } from './guns.ts';
import { LIGHT } from './look.ts';
import { gloveMaterial, handGeometry, sleeveGeometry, sleeveMaterial, WRIST, type GripKind } from './hands.ts';
import { pose, preload, weaponModel, type WeaponModel } from './models.ts';

// What your hands are doing this frame, as the round has it: the weapon (null for none), how far it's
// come out (1 drawn), a reload's progress (a shotgun's: this shell's), how you move, the scope, the
// recoil's kick (degrees), a grenade's pin pulled, looking it over, walking (not running).
export interface HandState {
  hand: WeaponId | null;
  draw: number;
  reload: number | null;
  speed: number;
  grounded: boolean;
  crouch: number;
  scope: number;
  punch: { x: number; y: number };
  pin: boolean;
  inspect: boolean;
  walk: boolean;
}

// The whole of it drawn this many times as big and as far from the eye: the same on the screen.
const S = 1;
// It's drawn with a narrower field of view than the world's, as Counter-Strike draws its own: the
// world's wide one would stretch whatever's near the eye (a rifle's stock, the sleeves) across half
// the screen. The tangent of its half-angle against the world's.
const NARROW = 0.7;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
// 0 before a, 1 after b, eased between.
const seg = (t: number, a: number, b: number) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};
// Up and back down again between a and b.
const hump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin((Math.PI * (t - a)) / (b - a)));

// A spring towards a target: w its stiffness (rad/s), z its damping (1 critical).
class Spring {
  x = 0;
  v = 0;
  step(dt: number, to: number, w: number, z = 0.75): number {
    for (let left = dt; left > 1e-6; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120);
      this.v += (w * w * (to - this.x) - 2 * z * w * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

// ---- How each weapon is held ----

// A hand on a gun, in the gun's frame: its grip's middle, the way the grip runs (to the index finger),
// the way to its wrist, and the grip's size.
interface Frame {
  at: THREE.Vector3;
  axis: THREE.Vector3;
  wrist: THREE.Vector3;
  kind: GripKind;
}
function frameQ(f: { axis: THREE.Vector3; wrist: THREE.Vector3 }, out: THREE.Quaternion): THREE.Quaternion {
  const y = f.axis.clone().normalize();
  const z = f.wrist.clone().addScaledVector(y, -f.wrist.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

interface Hold {
  family: Family | 'knife' | 'nade';
  // Where the gun's anchor (its trigger) sits in the eye's frame, and how it's turned.
  at: THREE.Vector3;
  rot: THREE.Euler;
  right: Frame;
  left: Frame | null;
  // A shot's kick: back (eye units), up (rad), and how much it rolls.
  kick: { z: number; up: number; roll: number };
}

// What's in your hands: the model (or its stand-in), its anchor, its muzzle, its moving parts.
interface Held {
  id: WeaponId;
  root: THREE.Group;
  model: WeaponModel | null;
  anchor: THREE.Vector3;
  muzzle: THREE.Vector3;
  // Where its magazine sits and where the left hand works its action, in its frame.
  mag: THREE.Vector3;
  action: THREE.Vector3;
  // Where its brass leaves it.
  port: THREE.Vector3;
  parts: WeaponModel['parts'];
  hold: Hold;
}

const KICK: Record<Family | 'knife' | 'nade', Hold['kick']> = {
  pistol: { z: 0.03, up: 0.16, roll: 0.05 },
  smg: { z: 0.014, up: 0.035, roll: 0.03 },
  rifle: { z: 0.02, up: 0.045, roll: 0.03 },
  sniper: { z: 0.06, up: 0.16, roll: 0.06 },
  shotgun: { z: 0.06, up: 0.2, roll: 0.05 },
  heavy: { z: 0.012, up: 0.02, roll: 0.02 },
  knife: { z: 0, up: 0, roll: 0 },
  nade: { z: 0, up: 0, roll: 0 },
};

// A few guns held a little differently from their family: the left hand further along a long
// barrel, a bullpup's further back.
const FORE: Partial<Record<WeaponId, number>> = { aug: 0.62, famas: 0.6, p90: 0.55, negev: 0.4, awp: 0.42, ssg08: 0.42, sg553: 0.48, mac10: 0.62, mp9: 0.6 };

function familyOf(w: WeaponId): Hold['family'] {
  if (w === 'knife') return 'knife';
  if (isNade(w)) return 'nade';
  return GUNS[w].family;
}

function holdOf(w: WeaponId, anchor: THREE.Vector3, muzzle: THREE.Vector3, pump: THREE.Vector3 | null): Hold {
  const family = familyOf(w);
  const rake = 0.32;
  const right: Frame = { at: anchor.clone().add(V(0, -0.042, 0.03)), axis: V(0, Math.cos(rake), -Math.sin(rake)), wrist: V(0.12, -0.45, 1), kind: 'pistol' };
  const fore = (f: number): Frame => ({ at: V(0, muzzle.y - 0.03, anchor.z + (muzzle.z - anchor.z) * f), axis: V(0.05, 0.12, -1), wrist: V(-1, -0.55, 0.35), kind: 'fore' });
  switch (family) {
    case 'pistol':
      return { family, at: V(0.12, -0.09, -0.36), rot: new THREE.Euler(0.1, 0.2, 0.03), right, left: { at: right.at.clone().add(V(-0.012, -0.006, -0.004)), axis: right.axis.clone(), wrist: V(-0.9, -0.35, 0.5), kind: 'nade' }, kick: KICK.pistol };
    case 'knife':
      return { family, at: V(0.12, -0.058, -0.3), rot: new THREE.Euler(-1.3, 0.3, 0.45), right: { at: V(0, -0.075, 0), axis: V(0, 1, 0), wrist: V(0, -0.3, 1), kind: 'knife' }, left: null, kick: KICK.knife };
    case 'nade':
      return { family, at: V(0.15, -0.1, -0.4), rot: new THREE.Euler(-0.25, 0.3, 0.15), right: { at: V(0, 0.0, 0), axis: V(0, 1, 0), wrist: V(0.2, -0.6, 1), kind: 'nade' }, left: null, kick: KICK.nade };
    case 'shotgun':
      return { family, at: V(0.17, -0.1, -0.34), rot: new THREE.Euler(0.12, 0.15, 0.04), right, left: pump ? { ...fore(0), at: pump.clone().add(V(0, -0.028, 0)) } : fore(0.5), kick: KICK.shotgun };
    case 'sniper':
      return { family, at: V(0.17, -0.105, -0.36), rot: new THREE.Euler(0.1, 0.13, 0.04), right, left: fore(FORE[w] ?? 0.42), kick: KICK.sniper };
    case 'heavy':
      return { family, at: V(0.18, -0.12, -0.36), rot: new THREE.Euler(0.1, 0.14, 0.04), right, left: fore(FORE[w] ?? 0.4), kick: KICK.heavy };
    default:
      return { family, at: V(0.17, -0.1, family === 'smg' ? -0.31 : -0.34), rot: new THREE.Euler(0.12, 0.15, 0.04), right, left: fore(FORE[w] ?? 0.45), kick: KICK[family] };
  }
}

// The weapon in hand, from its model, or its stand-in made in code until that's in.
function heldOf(w: WeaponId): Held {
  const m = weaponModel(w);
  const root = new THREE.Group();
  if (m) {
    root.add(m.rig);
    const mag = m.parts.mag ? m.parts.mag.bone.getWorldPosition(V(0, 0, 0)) : m.trigger.clone().add(V(0, -0.05, -0.06));
    // The bone's own place is in the rig's frame, which is the gun's while the rig is at its origin.
    const action = m.parts.handle ? m.parts.handle.bone.getWorldPosition(V(0, 0, 0)) : m.parts.bolt ? m.parts.bolt.bone.getWorldPosition(V(0, 0, 0)).add(V(0.02, 0.01, 0)) : m.trigger.clone().add(V(0.02, 0.05, -0.04));
    const pump = m.parts.pump ? m.parts.pump.bone.getWorldPosition(V(0, 0, 0)) : null;
    const port = m.parts.bolt ? m.parts.bolt.bone.getWorldPosition(V(0, 0, 0)).add(V(0.015, 0.012, 0)) : m.trigger.clone().add(V(0.015, 0.04, -0.05));
    return { id: w, root, model: m, anchor: m.trigger.clone(), muzzle: m.muzzle.clone(), mag, action, port, parts: m.parts, hold: holdOf(w, m.trigger, m.muzzle, pump) };
  }
  // The stand-in: its barrel along +x, turned to -z; its hand at its middle.
  const g = buildGun(lookOf(w), false);
  g.group.rotation.y = Math.PI / 2;
  root.add(g.group);
  const muzzle = V(g.muzzle.z, g.muzzle.y, -g.muzzle.x);
  const anchor = isGun(w) ? V(0, 0.01, 0.02) : V(0, 0, 0);
  return { id: w, root, model: null, anchor, muzzle, mag: V(0, -0.05, -0.08), action: V(0.02, 0.06, -0.02), port: V(0.015, 0.05, -0.03), parts: {}, hold: holdOf(w, anchor, muzzle, null) };
}
// ---- The flash and the brass ----

// A flame seen side on, for the flash's plume along the barrel: bright at its root, licking forward.
let flameTex: THREE.CanvasTexture | null = null;
function flameTexture(): THREE.CanvasTexture {
  if (flameTex) return flameTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d')!;
  for (let k = 0; k < 3; k++) {
    const r = g.createRadialGradient(18, 16, 1, 18 + k * 20, 16, 50 - k * 8);
    r.addColorStop(0, 'rgba(255,250,225,1)');
    r.addColorStop(0.3, 'rgba(255,196,90,0.85)');
    r.addColorStop(1, 'rgba(255,110,20,0)');
    g.fillStyle = r;
    g.beginPath();
    g.ellipse(18 + k * 26, 16, 26 + k * 10, 9 - k * 2.5, 0, 0, Math.PI * 2);
    g.fill();
  }
  flameTex = new THREE.CanvasTexture(c);
  flameTex.colorSpace = THREE.SRGBColorSpace;
  return flameTex;
}

// Two crossed planes along -z from the muzzle: the flash's flame seen from behind the gun.
function plume(): THREE.Mesh {
  const a = new THREE.PlaneGeometry(1, 0.25);
  a.translate(0.5, 0, 0);
  a.rotateY(Math.PI / 2);
  const b = a.clone().rotateZ(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  const m = new THREE.Mesh(
    (() => {
      const pos = [...(a.toNonIndexed().attributes.position.array as Float32Array), ...(b.toNonIndexed().attributes.position.array as Float32Array)];
      const uv = [...(a.toNonIndexed().attributes.uv.array as Float32Array), ...(b.toNonIndexed().attributes.uv.array as Float32Array)];
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      return g;
    })(),
    new THREE.MeshBasicMaterial({ map: flameTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, toneMapped: false }),
  );
  m.visible = false;
  m.frustumCulled = false;
  return m;
}

const BRASS = 10;
interface Case {
  p: THREE.Vector3;
  v: THREE.Vector3;
  r: THREE.Euler;
  w: THREE.Vector3;
  life: number;
  shell: boolean;
}

// ---- The viewmodel ----

export class Viewmodel {
  // Drawn after the world, over it, with its own light.
  readonly scene = new THREE.Scene();
  private holder = new THREE.Group(); // the eye
  private rig = new THREE.Group(); // the whole of it, swaying
  private gun = new THREE.Group(); // the weapon, and the hands on it
  private sun: THREE.DirectionalLight;
  private glow = new THREE.PointLight('#ffb35a', 0, 1.6, 2);
  private held: Held | null = null;
  private cache = new Map<WeaponId, Held>();
  private hands: THREE.Mesh[];
  private sleeves: THREE.Mesh[];
  private elbows = [V(0.26, -0.32, -0.06), V(-0.1, -0.32, -0.1)];
  private star = flashSprite(0.09);
  private plume = plume();
  private flashFor = 0;
  private brass: THREE.InstancedMesh;
  private shells: THREE.InstancedMesh;
  private cases: Case[] = [];
  // Springs: the look's lag, the kick, landing, the walk's tilt.
  private lagX = new Spring();
  private lagY = new Spring();
  private kickZ = new Spring();
  private kickUp = new Spring();
  private kickRoll = new Spring();
  private land = new Spring();
  private tilt = new Spring();
  private lift = new Spring();
  private crouch = new Spring();
  // Clocks (s): since the last shot, a bolt or pump's work, looking it over, a throw, the pin.
  private t = 0;
  private shotAt = -9;
  private heavy = false;
  private side = 1;
  private boltAt = -9;
  private inspectAt = -9;
  private throwAt = -9;
  private pinAt = -9;
  private wasInspect = false;
  private wasReload = false;
  private pumpAt = -9;
  private reloadT = 0;
  private reloadFor = 0;
  private grounded = true;
  private phase = 0;
  private lastQ = new THREE.Quaternion();
  private lastP = new THREE.Vector3();
  private first = true;
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private m = new THREE.Matrix4();
  private saved = new THREE.Matrix4();
  private savedInv = new THREE.Matrix4();

  constructor(env: THREE.Texture | null) {
    // Lit as the world is (render/look.ts), a little softer: the sun's half as strong, the sky's
    // light half as strong again, so a gun in your hands is never black in the shade.
    this.scene.environment = env;
    this.scene.environmentIntensity = LIGHT.env * 0.8;
    this.scene.add(new THREE.HemisphereLight('#e4ecf7', '#4a4038', LIGHT.hemi * 1.6));
    this.sun = new THREE.DirectionalLight('#fff3e0', LIGHT.sun * 0.5);
    // A soft light from behind the eye, so the gun's shape shows in any shade.
    const fill = new THREE.DirectionalLight('#cfd8e6', LIGHT.hemi * 0.8);
    fill.position.set(0, 0.3, 1);
    this.holder.add(fill, fill.target);
    this.scene.add(this.sun, this.sun.target, this.holder);
    this.holder.scale.setScalar(S);
    this.holder.add(this.rig);
    this.rig.add(this.gun, this.glow);
    const glove = gloveMaterial();
    this.hands = [0, 1].map((k) => {
      const m = new THREE.Mesh(handGeometry('pistol'), glove);
      m.frustumCulled = false;
      m.morphTargetInfluences = [0];
      if (k) m.scale.x = -1;
      this.gun.add(m);
      return m;
    });
    const sg = sleeveGeometry();
    const sm = sleeveMaterial();
    this.sleeves = [0, 1].map(() => {
      const m = new THREE.Mesh(sg, sm);
      m.frustumCulled = false;
      this.rig.add(m);
      return m;
    });
    this.gun.add(this.star, this.plume);
    const caseGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.022, 8);
    this.brass = new THREE.InstancedMesh(caseGeo, new THREE.MeshStandardMaterial({ color: '#c9a043', metalness: 0.85, roughness: 0.3 }), BRASS);
    this.shells = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.06, 10), new THREE.MeshStandardMaterial({ color: '#a8221c', roughness: 0.5 }), 4);
    for (const i of [this.brass, this.shells]) {
      i.count = 0;
      i.frustumCulled = false;
      this.rig.add(i);
    }
    this.scene.visible = false;
    // Every weapon's model on its way, and the fighters', now a round's begun.
    preload(WEAPON_IDS);
    // Its own projection while it's drawn, the world's put back after.
    this.scene.onBeforeRender = (_r, _s, cam) => {
      const c = cam as THREE.PerspectiveCamera;
      if (!c.isPerspectiveCamera) return;
      this.saved.copy(c.projectionMatrix);
      this.savedInv.copy(c.projectionMatrixInverse);
      const top = 0.01 * Math.tan((c.fov * Math.PI) / 360) * NARROW;
      c.projectionMatrix.makePerspective(-top * c.aspect, top * c.aspect, top, -top, 0.01, 30);
      c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    };
    this.scene.onAfterRender = (_r, _s, cam) => {
      const c = cam as THREE.PerspectiveCamera;
      if (!c.isPerspectiveCamera) return;
      c.projectionMatrix.copy(this.saved);
      c.projectionMatrixInverse.copy(this.savedInv);
    };
  }

  // A shot: it kicks, the slide or bolt snaps back, the muzzle flashes and the brass flies; or the
  // knife cuts (heavy, a stab).
  fired(w: WeaponId, heavy = false): void {
    this.shotAt = this.t;
    this.heavy = heavy;
    if (w === 'knife') {
      this.side = -this.side;
      return;
    }
    if (!isGun(w)) return;
    const g = GUNS[w];
    const h = this.held?.id === w ? this.held.hold : null;
    const k = h?.kick ?? KICK[g.family];
    this.kickZ.v += k.z * 60;
    this.kickUp.v += k.up * 60;
    this.kickRoll.v += k.roll * 60 * (Math.random() - 0.5);
    this.flashFor = g.silenced ? 0.02 : 0.05;
    const r = Math.random();
    this.star.material.rotation = r * Math.PI * 2;
    this.star.scale.setScalar(g.silenced ? 0.03 : (0.07 + 0.04 * r) * (g.family === 'shotgun' || g.family === 'sniper' ? 1.5 : 1));
    this.plume.scale.set(1, 1, g.silenced ? 0.04 : g.family === 'pistol' ? 0.07 + 0.03 * r : 0.1 + 0.07 * r);
    this.plume.rotation.z = r * Math.PI;
    this.glow.intensity = g.silenced ? 0.15 : 1.4;
    // A bolt-action's bolt and a pump gun's pump are worked after the shot, and throw the case; the
    // rest throw theirs now.
    if (g.scope?.bolt || w === 'nova') this.boltAt = this.t + 0.12;
    else this.eject(w === 'xm1014');
  }

  // A grenade thrown: the arm goes forward, and the hand's empty till the next weapon.
  thrown(): void {
    this.throwAt = this.t;
  }

  // Where the bullets leave your gun, in the world, for the tracer: where the muzzle is drawn on the
  // screen, at its distance from the eye, as the world's camera sees it.
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    const h = this.held;
    if (!h) return out.copy(this.holder.position);
    this.holder.updateMatrixWorld(true);
    out.copy(h.muzzle).applyMatrix4(h.root.matrixWorld);
    // Into the eye's frame, out from the middle of the view by the two views' ratio, and back.
    const inv = this.m.copy(this.holder.matrixWorld).invert();
    out.applyMatrix4(inv);
    out.x /= NARROW;
    out.y /= NARROW;
    return out.applyMatrix4(this.holder.matrixWorld);
  }

  // A spent case out of the port, to the right and up, spinning.
  private eject(shell = false): void {
    const h = this.held;
    if (!h) return;
    this.rig.updateMatrixWorld(true);
    const inv = this.m.copy(this.rig.matrixWorld).invert();
    const p = h.port.clone().applyMatrix4(h.root.matrixWorld).applyMatrix4(inv);
    const v = V(0.9 + Math.random() * 0.4, 0.9 + Math.random() * 0.5, 0.15 + Math.random() * 0.2);
    if (this.cases.length >= BRASS) this.cases.shift();
    this.cases.push({ p, v, r: new THREE.Euler(Math.random() * 3, Math.random() * 3, 0), w: V(Math.random() * 20 - 10, Math.random() * 10, 25), life: 0.7, shell });
  }

  private use(w: WeaponId | null): void {
    if (!w) {
      // Put away: out of the hands, or the next one is drawn over it.
      if (this.held) this.gun.remove(this.held.root);
      this.held = null;
      return;
    }
    let h = this.cache.get(w);
    // The stand-in, swapped for the model when that's come in.
    if (h && !h.model && weaponModel(w)) {
      this.gun.remove(h.root);
      h = undefined;
    }
    if (!h) {
      h = heldOf(w);
      this.cache.set(w, h);
    }
    if (this.held !== h) {
      if (this.held) this.gun.remove(this.held.root);
      this.gun.add(h.root);
      this.held = h;
      const r = h.hold.right;
      this.hands[0].geometry = handGeometry(r.kind);
      this.hands[1].geometry = handGeometry(h.hold.left?.kind ?? 'fore');
      this.throwAt = -9;
      this.boltAt = -9;
      this.pumpAt = -9;
      this.inspectAt = -9;
    }
  }

  // With the camera, a frame on.
  update(camera: THREE.Camera, sun: THREE.Vector3, dt: number, s: HandState): void {
    this.t += dt;
    if (s.hand !== this.held?.id || (this.held && !this.held.model)) this.use(s.hand);
    const h = this.held;
    this.scene.visible = !!h && !s.scope;
    this.holder.position.copy(camera.position);
    this.holder.quaternion.copy(camera.quaternion);
    this.sun.position.copy(camera.position).add(sun);
    this.sun.target.position.copy(camera.position);
    if (!h || dt <= 0) {
      this.first = true;
      return;
    }
    const t = this.t;
    const hold = h.hold;
    const fam = hold.family;

    // ---- How you move: the look's lag, the walk's bob and tilt, a jump and its landing ----
    if (this.first) {
      this.lastQ.copy(camera.quaternion);
      this.lastP.copy(camera.position);
      this.first = false;
    }
    this.q.copy(this.lastQ).invert().multiply(camera.quaternion);
    const e = new THREE.Euler().setFromQuaternion(this.q, 'YXZ');
    this.lastQ.copy(camera.quaternion);
    const vel = this.v.copy(camera.position).sub(this.lastP).divideScalar(dt).applyQuaternion(this.q2.copy(camera.quaternion).invert());
    this.lastP.copy(camera.position);
    if (vel.length() > 30) vel.set(0, 0, 0);
    const turnX = Math.max(-1, Math.min(1, e.y / dt / 6));
    const turnY = Math.max(-1, Math.min(1, e.x / dt / 6));
    this.lagX.step(dt, turnX * 0.018, 9, 0.6);
    this.lagY.step(dt, turnY * 0.014, 9, 0.6);
    this.tilt.step(dt, Math.max(-1, Math.min(1, -vel.x / 5)) * 0.06, 8, 0.9);
    if (s.grounded && !this.grounded) this.land.v -= 0.25 + Math.min(0.6, Math.max(0, -vel.y) * 0.05);
    this.grounded = s.grounded;
    this.land.step(dt, 0, 11, 0.55);
    this.lift.step(dt, s.grounded ? 0 : 0.012, 6, 0.9);
    this.crouch.step(dt, s.crouch, 10, 1);
    const pace = s.grounded ? Math.min(1, s.speed / 5) : 0;
    this.phase += dt * (2 + Math.min(s.speed, 6) * 1.25);
    const amp = pace * (s.walk ? 0.0045 : 0.01);
    const bobX = Math.sin(this.phase) * amp;
    const bobY = -Math.abs(Math.cos(this.phase)) * amp * 0.9;
    // Breathing, still.
    const breath = Math.sin(t * 1.6) * 0.0012 * (1 - pace);

    // ---- The springs of a shot ----
    this.kickZ.step(dt, 0, 22, 0.7);
    this.kickUp.step(dt, 0, 20, 0.75);
    this.kickRoll.step(dt, 0, 18, 0.7);

    // The whole: its place in front of the eye.
    const pos = hold.at.clone();
    const rot = hold.rot.clone();
    // Across as far on a wide screen as on a narrow one, in from its edge on a phone held upright.
    const aspect = (camera as THREE.PerspectiveCamera).aspect ?? 1.78;
    pos.x *= Math.min(1.1, Math.max(0.5, aspect / 1.6));
    pos.x += bobX + this.lagX.x + this.crouch.x * -0.006;
    pos.y += bobY + breath + this.land.x * 0.04 + this.lift.x - this.lagY.x - this.crouch.x * 0.008;
    pos.z += this.kickZ.x + this.crouch.x * 0.012;
    rot.x += this.kickUp.x + (s.punch.y * Math.PI) / 180 * 0.3 + this.lagY.x * 2 + this.land.x * 0.08;
    rot.y += this.lagX.x * 2.5 - (s.punch.x * Math.PI) / 180 * 0.3;
    rot.z += this.kickRoll.x + this.tilt.x + bobX * 2;

    // Drawn: up from below, turned, as each family comes out.
    const d = 1 - seg(s.draw, 0, 1);
    if (d > 0) {
      const tw = fam === 'pistol' ? 0.9 : fam === 'knife' ? 2.4 : fam === 'nade' ? 0.6 : 0.5;
      pos.y -= d * 0.17;
      pos.x += d * 0.02;
      rot.x -= d * 0.8;
      rot.z += d * tw;
    }

    // ---- What it's doing ----
    let left = hold.left ? 1 : 0; // the left hand on its hold, 0 off it
    let leftAt: THREE.Vector3 | null = null; // where it is instead, in the gun's frame
    let leftOpen = 0;
    // Turned palm down over the top, as much as this, to work a slide or a charging handle.
    let over = 0;
    let rightOpen = 0;
    const rightAt = hold.right.at.clone();
    const mag = V(0, 0, 0);
    let slide = 0;
    let bolt = 0;
    let boltTurn = 0;
    let pump = 0;
    let shellIn = 0;
    let hideMag = false;
    let hide = false;
    const since = t - this.shotAt;

    // A shot's slide or bolt, back and home.
    if (isGun(h.id) && since < 0.12) {
      const b = Math.sin(Math.PI * clamp01(since / 0.09));
      if (fam === 'pistol') slide = b * 0.022;
      else if (fam !== 'sniper' && h.id !== 'nova') bolt = b * 0.03;
    }
    // Looked over (F): turned to its left side, then rolled over to its right, then back.
    if (s.inspect && !this.wasInspect && s.reload === null) this.inspectAt = t;
    this.wasInspect = s.inspect;
    const ins = t - this.inspectAt;
    if (ins < 2.6 && s.reload === null && since > ins) {
      const u = ins / 2.5;
      if (fam === 'knife') {
        const a = seg(u, 0.05, 0.25) - seg(u, 0.85, 1);
        pos.add(V(-0.05 * a, 0.04 * a, 0.02 * a));
        rot.x += 0.9 * a;
        rot.z += -0.5 * a;
        // A flip of the blade in the fingers, and back.
        rot.y += Math.PI * 2 * seg(u, 0.3, 0.55) + 0.9 * hump(u, 0.6, 0.85);
      } else {
        const a = seg(u, 0.05, 0.3) - seg(u, 0.82, 1);
        const b = seg(u, 0.42, 0.62) - seg(u, 0.82, 1);
        pos.add(V(-0.045 * a, 0.035 * a, 0.03 * a));
        rot.y += 0.75 * a - 1.1 * b;
        rot.z += -0.35 * a + 1.25 * b;
        rot.x += 0.2 * a - 0.15 * b;
      }
    }

    // A reload, with the left hand: each family its own.
    const rl = s.reload;
    if (rl !== null && !this.wasReload) this.reloadFor = 0;
    if (rl !== null) this.reloadFor += dt;
    if (rl === null && this.wasReload && fam === 'shotgun' && h.id === 'nova') this.pumpAt = t;
    this.wasReload = rl !== null;
    this.reloadT += ((rl !== null ? 1 : 0) - this.reloadT) * Math.min(1, dt * 8);
    if (rl !== null && fam !== 'shotgun') {
      const r = rl;
      if (fam === 'pistol') {
        // Tilted to the left, the magazine dropped, a fresh one fetched from below and slapped in,
        // the slide racked.
        const tiltA = seg(r, 0, 0.12) - seg(r, 0.86, 1);
        rot.z += 0.45 * tiltA;
        rot.y += 0.25 * tiltA;
        pos.add(V(-0.02 * tiltA, 0.015 * tiltA, 0));
        const out = seg(r, 0.1, 0.24);
        const back = seg(r, 0.4, 0.62);
        mag.set(0, -0.3 * out * (1 - back) - 0.08 * back * (1 - seg(r, 0.6, 0.68)), 0);
        hideMag = out > 0.6 && back < 0.2;
        const below = h.mag.clone().add(V(-0.01, -0.12, 0.02));
        const at = h.mag.clone().add(V(-0.012, -0.075 + 0.075 * seg(r, 0.6, 0.68), 0.01));
        const rack = h.action.clone().add(V(-0.03, 0.02, 0.03));
        left = 1 - seg(r, 0.12, 0.26) + seg(r, 0.84, 0.98);
        leftAt = new THREE.Vector3().lerpVectors(below.clone().add(V(-0.05, -0.2, 0.1)), below, seg(r, 0.34, 0.5)).lerp(at, seg(r, 0.5, 0.6)).lerp(rack, seg(r, 0.68, 0.74));
        leftOpen = 1 - hump(r, 0.4, 0.66) - hump(r, 0.68, 0.84);
        slide = Math.max(slide, 0.03 * (seg(r, 0.74, 0.78) - seg(r, 0.8, 0.82)));
        over = seg(r, 0.62, 0.7) - seg(r, 0.8, 0.88);
        if (hump(r, 0.6, 0.7) > 0.9) this.kickZ.v -= 0.02;
      } else {
        // Tilted, the left hand to the magazine, out and down with it, back up with a fresh one,
        // seated with a knock, and the action worked.
        const tiltA = seg(r, 0, 0.12) - seg(r, 0.84, 1);
        rot.z += -0.38 * tiltA;
        rot.x += 0.04 * tiltA;
        rot.y += 0.12 * tiltA;
        pos.add(V(-0.03 * tiltA, -0.005 * tiltA, 0.01 * tiltA));
        const out = seg(r, 0.18, 0.26);
        const away = seg(r, 0.27, 0.4) - seg(r, 0.42, 0.56);
        const seat = seg(r, 0.57, 0.64);
        mag.set(0, -0.05 * out * (1 - seat) - 0.3 * away, 0.015 * out * (1 - seat) + 0.08 * away);
        hideMag = away > 0.7;
        left = 1 - seg(r, 0.08, 0.18) + seg(r, 0.84, 0.97);
        const onMag = h.mag.clone().add(V(-0.03, -0.035, 0)).add(mag);
        const atAction = h.action.clone().add(V(-0.035, 0.015, 0.02));
        leftAt = onMag.clone().lerp(atAction, seg(r, 0.66, 0.72));
        leftOpen = 1 - hump(r, 0.15, 0.66) * 0.9 - hump(r, 0.7, 0.82);
        const pull = seg(r, 0.72, 0.76) - seg(r, 0.79, 0.81);
        over = seg(r, 0.62, 0.7) - seg(r, 0.8, 0.88);
        if (fam === 'sniper') {
          boltTurn = seg(r, 0.68, 0.71) - seg(r, 0.82, 0.85);
          bolt = 0.06 * pull;
        } else bolt = 0.045 * pull;
        if (seat > 0.5 && seat < 0.9) rot.x += 0.03 * hump(seat, 0.5, 0.9);
      }
    }
    // A shotgun's shells, one a cycle: the gun rolled to show its port, a shell pushed in.
    if (fam === 'shotgun') {
      const k = this.reloadT;
      rot.z += 0.55 * k;
      rot.x += 0.12 * k;
      pos.add(V(-0.02 * k, 0.03 * k, 0.015 * k));
      if (rl !== null) {
        const r = rl;
        const port = h.mag.clone().add(V(0, -0.05, 0.02));
        left = 1 - seg(this.reloadFor, 0, 0.18);
        leftAt = port.clone().add(V(-0.02, -0.08 * (1 - seg(r, 0.25, 0.55)) - 0.02, 0.06 * (1 - seg(r, 0.55, 0.8))));
        leftOpen = 0.4;
        shellIn = seg(r, 0.55, 0.85);
      }
    }
    // A bolt or a pump, worked after a shot or a reload.
    const bw = t - Math.max(this.boltAt, this.pumpAt);
    if (bw >= 0 && bw < 0.62) {
      const u = bw / (h.id === 'nova' ? 0.42 : 0.6);
      if (h.id === 'nova') {
        pump = 0.085 * (seg(u, 0, 0.45) - seg(u, 0.5, 0.95));
        rot.x += 0.05 * hump(u, 0, 1);
        if (u >= 0.45 && u - dt / 0.42 < 0.45) this.eject(true);
      } else if (u <= 1) {
        boltTurn = seg(u, 0, 0.2) - seg(u, 0.8, 1);
        bolt = 0.07 * (seg(u, 0.2, 0.45) - seg(u, 0.55, 0.8));
        rot.z += -0.18 * hump(u, 0, 1);
        rot.x += 0.06 * hump(u, 0, 1);
        rightOpen = hump(u, 0, 1) * 0.6;
        rightAt.lerp(h.action.clone().add(V(0.035, -0.01, 0.02)), hump(u, 0.02, 0.98));
        if (u >= 0.45 && u - dt / 0.6 < 0.45) this.eject(false);
      }
    }
    // The knife: a slash across, from one side or the other; a stab, drawn back and driven in.
    if (fam === 'knife' && since < 1.1) {
      if (this.heavy) {
        const u = since / 1.0;
        const back = seg(u, 0, 0.25) - seg(u, 0.25, 0.4);
        const go = seg(u, 0.25, 0.4) - seg(u, 0.55, 0.95);
        pos.add(V(-0.04 * go, 0.02 * back + 0.01 * go, 0.05 * back - 0.13 * go));
        rot.x += 0.5 * back + 0.45 * go;
        rot.z += -0.3 * back;
      } else {
        const u = since / 0.45;
        const a = hump(u, 0, 1);
        const sweep = seg(u, 0.05, 0.6) * 2 - 1;
        pos.add(V(-0.07 * a - 0.06 * sweep * a * this.side, 0.04 * a - 0.02 * sweep * a, -0.06 * a));
        rot.z += (1.1 * this.side + 0.6 * sweep) * a;
        rot.y += 0.6 * a * this.side;
        rot.x += 0.5 * a;
      }
    }
    // A grenade: the pin pulled with the left hand, the arm drawn back; thrown, and gone.
    if (fam === 'nade') {
      if (s.pin && this.pinAt < 0) this.pinAt = t;
      if (!s.pin && this.throwAt < 0) this.pinAt = -9;
      const p = this.pinAt > 0 && this.throwAt < 0 ? t - this.pinAt : -1;
      if (p >= 0) {
        const pull = seg(p, 0, 0.18);
        left = 0;
        leftAt = V(-0.02, 0.06 - 0.06 * seg(p, 0.15, 0.3), -0.01 + 0.08 * seg(p, 0.15, 0.3));
        leftOpen = 0.3;
        const cock = seg(p, 0.2, 0.45);
        pos.add(V(0.02 * cock, 0.05 * cock - 0.02 * pull, 0.06 * cock));
        rot.x += 0.6 * cock;
        rot.z += -0.3 * cock;
      }
      const th = t - this.throwAt;
      if (this.throwAt > 0) {
        const u = th / 0.5;
        const go = seg(u, 0, 0.35);
        const fall = seg(u, 0.35, 1);
        pos.add(V(-0.06 * go + 0.1 * fall, 0.05 + 0.04 * go - 0.35 * fall, 0.06 - 0.2 * go + 0.1 * fall));
        rot.x += 0.6 - 1.4 * go;
        rightOpen = seg(u, 0.25, 0.4);
        hide = u > 0.3;
        if (u > 1) this.scene.visible = false;
      }
    }

    // ---- Posed ----
    this.rig.position.set(0, 0, 0);
    this.gun.position.copy(pos);
    this.gun.rotation.copy(rot);
    // The gun's anchor at pos: its root moved so its trigger is the gun group's origin.
    h.root.position.copy(h.anchor).negate();
    h.root.visible = !hide;
    const parts = h.parts;
    pose(parts.mag, mag.x, mag.y, mag.z);
    if (parts.mag && hideMag) parts.mag.bone.scale.setScalar(1e-4);
    else if (parts.mag) parts.mag.bone.scale.setScalar(1);
    pose(parts.slide, 0, 0, slide);
    pose(parts.bolt, 0, 0, bolt, boltTurn * 1.1, Z);
    pose(parts.handle, 0, 0, bolt);
    pose(parts.pump, 0, 0, pump);
    pose(parts.shell, 0, 0.03 * (1 - shellIn), -0.06 * shellIn);

    // The hands: the right on its grip, the left on its hold or where it's working.
    const anchor = h.anchor;
    this.place(this.hands[0], hold.right, rightAt.clone().sub(anchor), false, rightOpen);
    const lf = hold.left ?? { at: V(-0.05, -0.2, 0.1), axis: V(0, 0.2, -1), wrist: V(-1, -0.5, 0.3), kind: 'fore' as GripKind };
    const la = new THREE.Vector3().lerpVectors(leftAt ?? lf.at, lf.at, hold.left ? left : 0).sub(anchor);
    this.place(this.hands[1], lf, la, true, hold.left ? Math.max(leftOpen * (1 - left), 0) : leftOpen);
    if (over > 0) this.hands[1].quaternion.slerp(frameQ(OVER, this.q), over);
    this.hands[1].visible = !!hold.left || !!leftAt;
    this.hands[0].visible = !hide || this.throwAt < 0 || t - this.throwAt < 0.45;

    // The sleeves, from each wrist to its elbow off the bottom of the screen.
    this.rig.updateMatrixWorld(true);
    const inv = this.m.copy(this.rig.matrixWorld).invert();
    for (let k = 0; k < 2; k++) {
      const hand = this.hands[k];
      const sl = this.sleeves[k];
      sl.visible = hand.visible;
      if (!hand.visible) continue;
      const w = WRIST.clone().applyMatrix4(hand.matrixWorld).applyMatrix4(inv);
      // The elbow goes most of the way the hand does, so the forearm keeps its length.
      const rest = k ? (hold.left?.at ?? lf.at).clone().sub(anchor) : hold.right.at.clone().sub(anchor);
      const home = rest.applyEuler(hold.rot).add(hold.at);
      const el = this.elbows[k].clone().addScaledVector(w.clone().sub(home), 0.8);
      const dir = el.clone().sub(w);
      sl.position.copy(w);
      sl.quaternion.setFromUnitVectors(Y, dir.clone().normalize());
      sl.scale.set(1, dir.length(), 1);
    }

    // The flash, at the muzzle, and its light.
    this.flashFor -= dt;
    const on = this.flashFor > 0 && !hide && isGun(h.id);
    this.star.visible = this.plume.visible = on;
    const mz = h.muzzle.clone().sub(anchor);
    this.star.position.copy(mz).add(V(0, 0, -0.012));
    this.plume.position.copy(mz);
    this.glow.position.copy(mz).applyEuler(rot).add(pos);
    this.glow.intensity = Math.max(0, this.glow.intensity - dt * 60);

    // The brass, flying off and falling.
    let nb = 0;
    let ns = 0;
    for (const c of this.cases) {
      c.life -= dt;
      c.v.y -= 6 * dt;
      c.p.addScaledVector(c.v, dt);
      c.r.x += c.w.x * dt;
      c.r.y += c.w.y * dt;
      c.r.z += c.w.z * dt;
      this.m.compose(c.p, this.q.setFromEuler(c.r), ONE);
      if (c.shell) this.shells.setMatrixAt(ns++, this.m);
      else this.brass.setMatrixAt(nb++, this.m);
    }
    this.cases = this.cases.filter((c) => c.life > 0);
    this.brass.count = nb;
    this.shells.count = ns;
    this.brass.instanceMatrix.needsUpdate = true;
    this.shells.instanceMatrix.needsUpdate = true;
  }

  // A hand at `at` (the gun's frame, from its anchor), on its frame's grip, mirrored for the left, as
  // open as `open`.
  private place(hand: THREE.Mesh, f: Frame, at: THREE.Vector3, mirror: boolean, open: number): void {
    hand.position.copy(at);
    frameQ(f, hand.quaternion);
    hand.scale.set(mirror ? -1 : 1, 1, 1);
    hand.morphTargetInfluences![0] = clamp01(open);
  }
}

const Y = new THREE.Vector3(0, 1, 0);
// The left hand over the top of a gun, its fingers forward, its palm down.
const OVER = { axis: new THREE.Vector3(0, 0.1, -1), wrist: new THREE.Vector3(-1, 0.5, 0.2) };
const Z = new THREE.Vector3(0, 0, 1);
const ONE = new THREE.Vector3(1, 1, 1);
