// The deathmatch drawn (braga-map's task 074): the four kits' guns, made in code as the rest of the
// game is; yours in your hands in first person, drawn over the world so it never goes into a wall; the
// muzzle's flash; the marks bullets leave on the walls and the ground, and their tracers; and the
// round's edge, a railing where you could walk up to it and road-works barriers across its streets,
// up only while a round is on.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KITS, type Field, type KitId } from '../game/fight.ts';
import { bake, box, mat } from './kit.ts';
import * as tex from './textures.ts';

// ---- The guns ----

// Pieces of a gun, merged by material: a mesh or two a gun.
class Pieces {
  private by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  // A box from x0 to x1 along the barrel, h high and w wide, its middle at height y; tilted by `tilt`
  // about z (its front up).
  box(m: THREE.Material, x0: number, x1: number, y: number, h: number, w: number, tilt = 0, z = 0): void {
    this.put(new THREE.BoxGeometry(x1 - x0, h, w), m, (x0 + x1) / 2, y, z, new THREE.Euler(0, 0, tilt));
  }
  // A tube along the barrel from x0 to x1, r round, its axis at height y.
  tube(m: THREE.Material, x0: number, x1: number, y: number, r: number, z = 0, r1 = r): void {
    this.put(new THREE.CylinderGeometry(r1, r, x1 - x0, 14), m, (x0 + x1) / 2, y, z, new THREE.Euler(0, 0, -Math.PI / 2));
  }
  private put(g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, e: THREE.Euler): void {
    this.q.setFromEuler(e);
    g.applyMatrix4(this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(1, 1, 1)));
    const geo = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    const list = this.by.get(m) ?? [];
    list.push(geo);
    this.by.set(m, list);
  }
  into(group: THREE.Group, shadows: boolean): void {
    for (const [m, list] of this.by) {
      const mesh = new THREE.Mesh(mergeGeometries(list)!, m);
      mesh.castShadow = shadows;
      group.add(mesh);
    }
  }
}

export interface Gun {
  group: THREE.Group;
  // Where the bullets leave it, in its own frame.
  muzzle: THREE.Vector3;
}

const steel = () => mat('#1e2023', { metalness: 0.65, roughness: 0.42 });
const olive = () => mat('#3d4130', { roughness: 0.85 });
const walnut = () => mat('#6b4123', { roughness: 0.6 });
const glass = () => mat('#0d1a24', { metalness: 0.9, roughness: 0.1 });

// A kit's gun, its barrel along +x, up +y, the hand on its grip at the middle.
export function buildGun(kit: KitId, shadows = true): Gun {
  const p = new Pieces();
  const s = steel();
  let muzzle: THREE.Vector3;
  switch (kit) {
    case 'rifle': // a carbine: a receiver, a ribbed handguard, a curved magazine and a folding stock
      p.box(s, -0.06, 0.24, 0.045, 0.07, 0.05);
      p.box(olive(), 0.2, 0.46, 0.04, 0.062, 0.056);
      p.tube(s, 0.46, 0.63, 0.055, 0.011);
      p.tube(s, 0.6, 0.65, 0.055, 0.015);
      p.box(s, 0.57, 0.59, 0.1, 0.06, 0.012);
      p.box(s, 0.0, 0.05, 0.095, 0.03, 0.03);
      p.box(s, 0.1, 0.15, -0.04, 0.16, 0.028, 0.3);
      p.box(olive(), -0.04, 0.0, -0.045, 0.1, 0.032, -0.35);
      p.box(olive(), -0.34, -0.06, 0.03, 0.07, 0.04, 0.04);
      p.box(olive(), -0.36, -0.32, 0.015, 0.11, 0.045);
      muzzle = new THREE.Vector3(0.66, 0.055, 0);
      break;
    case 'shotgun': // a pump gun: a long barrel over its magazine tube, a wooden pump and stock
      p.box(s, -0.07, 0.17, 0.035, 0.075, 0.046);
      p.tube(s, 0.17, 0.74, 0.065, 0.015);
      p.tube(s, 0.17, 0.64, 0.028, 0.012);
      p.box(walnut(), 0.3, 0.52, 0.03, 0.052, 0.054);
      p.box(walnut(), -0.06, 0.0, -0.035, 0.1, 0.034, -0.45);
      p.box(walnut(), -0.42, -0.06, 0.0, 0.075, 0.042, 0.1);
      p.box(s, 0.72, 0.735, 0.085, 0.012, 0.01);
      muzzle = new THREE.Vector3(0.75, 0.065, 0);
      break;
    case 'sniper': // a bolt-action rifle with a scope on its mounts, a long barrel and a heavy stock
      p.box(s, -0.06, 0.24, 0.045, 0.06, 0.05);
      p.tube(s, 0.24, 0.94, 0.05, 0.012, 0, 0.016);
      p.tube(s, 0.9, 0.96, 0.05, 0.018);
      p.tube(s, -0.02, 0.22, 0.12, 0.021);
      p.tube(s, 0.18, 0.26, 0.12, 0.021, 0, 0.028);
      p.tube(s, -0.06, -0.02, 0.12, 0.026, 0, 0.021);
      p.tube(glass(), 0.26, 0.262, 0.12, 0.026);
      p.box(s, 0.02, 0.04, 0.09, 0.04, 0.025);
      p.box(s, 0.16, 0.18, 0.09, 0.04, 0.025);
      p.tube(s, 0.02, 0.06, 0.06, 0.007, 0.045);
      p.box(olive(), 0.2, 0.62, 0.025, 0.05, 0.055);
      p.box(olive(), -0.05, 0.0, -0.035, 0.1, 0.034, -0.4);
      p.box(olive(), -0.44, -0.05, 0.005, 0.1, 0.045, 0.05);
      p.box(olive(), -0.3, -0.12, 0.065, 0.035, 0.04);
      muzzle = new THREE.Vector3(0.97, 0.05, 0);
      break;
    default: // a pistol: its slide over its frame, the grip raked back
      p.box(s, -0.045, 0.15, 0.04, 0.034, 0.028);
      p.box(mat('#2a2b2e', { roughness: 0.7 }), -0.035, 0.13, 0.014, 0.024, 0.026);
      p.box(mat('#2a2b2e', { roughness: 0.7 }), -0.045, -0.005, -0.04, 0.11, 0.03, -0.25);
      p.box(s, 0.135, 0.145, 0.062, 0.01, 0.006);
      muzzle = new THREE.Vector3(0.155, 0.04, 0);
  }
  const group = new THREE.Group();
  p.into(group, shadows);
  return { group, muzzle };
}

// A muzzle's flash: a star of light, added to what's behind it.
let flashTex: THREE.CanvasTexture | null = null;
function flashTexture(): THREE.CanvasTexture {
  if (flashTex) return flashTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,250,220,1)');
  r.addColorStop(0.25, 'rgba(255,200,90,0.9)');
  r.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = r;
  g.beginPath();
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const l = k % 2 ? 12 : 32;
    g.lineTo(32 + Math.cos(a) * l, 32 + Math.sin(a) * l);
  }
  g.fill();
  flashTex = new THREE.CanvasTexture(c);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  return flashTex;
}
export function flashSprite(size: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  s.scale.setScalar(size);
  s.visible = false;
  return s;
}

// ---- Yours, in first person ----

// Where each gun is held in front of the eye, in the camera's frame (x right, y up, z back), and how
// far back a shot kicks it.
const HELD: Record<KitId, { at: [number, number, number]; kick: number }> = {
  rifle: { at: [0.15, -0.17, -0.36], kick: 0.025 },
  shotgun: { at: [0.15, -0.175, -0.36], kick: 0.07 },
  sniper: { at: [0.15, -0.175, -0.34], kick: 0.08 },
  pistol: { at: [0.13, -0.14, -0.36], kick: 0.04 },
};
// Drawn smaller than it is, as it's nearer the eye than a gun at the shoulder would be: else it
// fills half the screen.
const SMALL = 0.62;

export class Viewmodel {
  // Drawn after the world, over it, with its own light.
  readonly scene = new THREE.Scene();
  private holder = new THREE.Group();
  private guns = new Map<KitId, Gun>();
  private kit: KitId | null = null;
  private flash = flashSprite(0.16);
  private flashFor = 0;
  private kick = 0;
  private phase = 0;
  private sway = new THREE.Vector2();
  private dip = 0;
  private sun: THREE.DirectionalLight;

  constructor(env: THREE.Texture | null) {
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.5;
    this.scene.add(new THREE.HemisphereLight('#dfe8f5', '#4a4038', 1.3));
    this.sun = new THREE.DirectionalLight('#fff3e0', 1.6);
    this.scene.add(this.sun, this.sun.target, this.holder);
    for (const k of Object.keys(KITS) as KitId[]) {
      const g = buildGun(k, false);
      g.group.scale.setScalar(SMALL);
      g.group.visible = false;
      this.holder.add(g.group);
      this.guns.set(k, g);
    }
    this.holder.add(this.flash);
    this.scene.visible = false;
  }

  // The gun in your hands, or none.
  show(kit: KitId | null): void {
    this.kit = kit;
    for (const [k, g] of this.guns) g.group.visible = k === kit;
    this.scene.visible = !!kit;
  }

  // A shot: it kicks, and the muzzle flashes.
  fired(): void {
    if (!this.kit) return;
    this.kick = 1;
    this.flashFor = 0.045;
    this.flash.material.rotation = Math.random() * Math.PI;
  }

  // With the camera, a frame on: swaying as you walk, kicked back by a shot and settling, down while
  // reloading (`reload` from 0 to 1 over it, or null), out of the way through a scope.
  update(camera: THREE.Camera, sun: THREE.Vector3, dt: number, speed: number, reload: number | null, scoped: boolean): void {
    if (!this.kit) return;
    const g = this.guns.get(this.kit)!;
    const h = HELD[this.kit];
    this.holder.position.copy(camera.position);
    this.holder.quaternion.copy(camera.quaternion);
    this.sun.position.copy(camera.position).add(sun);
    this.sun.target.position.copy(camera.position);
    this.phase += dt * Math.min(speed, 6) * 2.2;
    const amp = Math.min(1, speed / 5) * 0.012;
    this.sway.set(Math.sin(this.phase) * amp, -Math.abs(Math.cos(this.phase)) * amp);
    this.kick = Math.max(0, this.kick - dt * 9);
    const want = reload === null ? 0 : Math.sin(Math.PI * Math.min(1, reload));
    this.dip += (want - this.dip) * Math.min(1, dt * 12);
    const k = this.kick * this.kick;
    // The barrel along -z, as the camera looks.
    g.group.position.set(h.at[0] + this.sway.x, h.at[1] + this.sway.y - this.dip * 0.12, h.at[2] + k * h.kick);
    g.group.rotation.set(-this.dip * 0.6, Math.PI / 2, k * 0.12 + this.dip * 0.5);
    g.group.visible = !scoped;
    this.flashFor -= dt;
    this.flash.visible = this.flashFor > 0 && !scoped;
    if (this.flash.visible) this.flash.position.copy(g.muzzle).multiplyScalar(SMALL).applyEuler(g.group.rotation).add(g.group.position);
  }

  // Where the bullets leave your gun, in the world, for the tracer.
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    const g = this.kit ? this.guns.get(this.kit)! : null;
    if (!g) return out.copy(this.holder.position);
    this.holder.updateMatrixWorld(true);
    return out.copy(g.muzzle).applyMatrix4(g.group.matrixWorld);
  }
}

// ---- What a shot leaves ----

// A bullet's hole: dark, with chipped edges.
function holeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  r.addColorStop(0, 'rgba(10,10,10,1)');
  r.addColorStop(0.25, 'rgba(25,23,20,0.95)');
  r.addColorStop(0.5, 'rgba(90,85,78,0.5)');
  r.addColorStop(1, 'rgba(120,115,105,0)');
  g.fillStyle = r;
  g.beginPath();
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * Math.PI * 2;
    const l = 18 + Math.random() * 12;
    g.lineTo(32 + Math.cos(a) * l, 32 + Math.sin(a) * l);
  }
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MARKS = 160;
const TRACERS = 24;
const FLASHES = 8;

export class ShotsView {
  readonly group = new THREE.Group();
  private marks: THREE.InstancedMesh;
  private next = 0;
  private lines: THREE.LineSegments;
  private ends: Float32Array;
  private life = new Float32Array(TRACERS);
  private nextLine = 0;
  private flashes: { s: THREE.Sprite; life: number }[] = [];
  private nextFlash = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private z = new THREE.Vector3(0, 0, 1);

  constructor() {
    const hole = new THREE.MeshStandardMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 });
    this.marks = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.11, 0.11), hole, MARKS);
    this.marks.count = 0;
    this.marks.frustumCulled = false;
    this.marks.receiveShadow = true;
    this.ends = new Float32Array(TRACERS * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.ends, 3));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#ffd98a', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.lines.frustumCulled = false;
    for (let k = 0; k < FLASHES; k++) {
      const s = flashSprite(0.45);
      this.flashes.push({ s, life: 0 });
      this.group.add(s);
    }
    this.group.add(this.marks, this.lines);
  }

  // A bullet's mark at p on a surface facing n.
  mark(p: { x: number; y: number; z: number }, n: { x: number; y: number; z: number }): void {
    const nn = new THREE.Vector3(n.x, n.y, n.z);
    if (nn.lengthSq() < 0.5) return;
    this.q.setFromUnitVectors(this.z, nn.normalize());
    this.q.multiply(new THREE.Quaternion().setFromAxisAngle(this.z, Math.random() * Math.PI * 2));
    const s = 0.7 + Math.random() * 0.6;
    this.m.compose(new THREE.Vector3(p.x + nn.x * 0.01, p.y + nn.y * 0.01, p.z + nn.z * 0.01), this.q, new THREE.Vector3(s, s, s));
    this.marks.setMatrixAt(this.next, this.m);
    this.next = (this.next + 1) % MARKS;
    this.marks.count = Math.min(MARKS, this.marks.count + 1);
    this.marks.instanceMatrix.needsUpdate = true;
  }

  // A tracer from a to b, for a moment.
  tracer(a: THREE.Vector3, b: { x: number; y: number; z: number }): void {
    const k = this.nextLine;
    this.nextLine = (k + 1) % TRACERS;
    // A bullet's streak: the stretch of its way nearest the gun, not the whole of it.
    const d = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
    const L = d.length();
    const from = a.clone().addScaledVector(d, Math.min(0.5, 2 / Math.max(L, 1e-3)) * Math.random());
    const to = a.clone().addScaledVector(d, Math.min(1, (Math.min(L, 40) + 2) / Math.max(L, 1e-3)));
    this.ends.set([from.x, from.y, from.z, to.x, to.y, to.z], k * 6);
    this.life[k] = 0.05;
    this.lines.geometry.attributes.position.needsUpdate = true;
  }

  // A muzzle's flash at p, someone else's.
  flash(p: THREE.Vector3): void {
    const f = this.flashes[this.nextFlash];
    this.nextFlash = (this.nextFlash + 1) % FLASHES;
    f.s.position.copy(p);
    f.s.material.rotation = Math.random() * Math.PI;
    f.life = 0.05;
    f.s.visible = true;
  }

  update(dt: number): void {
    let moved = false;
    for (let k = 0; k < TRACERS; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      if (this.life[k] <= 0) {
        this.ends.fill(0, k * 6, k * 6 + 6);
        moved = true;
      }
    }
    if (moved) this.lines.geometry.attributes.position.needsUpdate = true;
    for (const f of this.flashes) {
      f.life -= dt;
      f.s.visible = f.life > 0;
    }
  }

  // The marks gone, for a new round.
  clear(): void {
    this.marks.count = 0;
    this.next = 0;
  }
}

// ---- The round's edge ----

// A railing along each stretch of the edge someone on foot can walk up to (Field.rails), 1.1 m of a
// pedestrian railing's bars on posts every 2 m; and a row of road-works barriers across each street
// and path crossing it, as at the open world's edge (braga-map's decision 019), with "Estrada
// cortada".
export function buildEdge(f: Field): THREE.Group {
  const root = new THREE.Group();
  const posts = mat('#8d949a', { metalness: 0.6, roughness: 0.4 });
  const pos: number[] = [];
  const uv: number[] = [];
  for (const run of f.rails) {
    let u = 0;
    for (let k = 1; k < run.length; k++) {
      const a = run[k - 1];
      const b = run[k];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, b.x, b.y + 1.1, b.z, a.x, a.y, a.z, b.x, b.y + 1.1, b.z, a.x, a.y + 1.1, a.z);
      uv.push(u / 2, 0, (u + L) / 2, 0, (u + L) / 2, 1, u / 2, 0, (u + L) / 2, 1, u / 2, 1);
      u += L;
      if (k % 2 === 0 || k === run.length - 1) root.add(box(0.05, 1.12, 0.05, posts, b.x, b.y, b.z));
    }
    root.add(box(0.05, 1.12, 0.05, posts, run[0].x, run[0].y, run[0].z));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const bars = tex.bars();
  const rail = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: bars, color: '#c9cfd4', alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.45 }));
  rail.castShadow = true;

  const boards = new THREE.MeshStandardMaterial({ map: tex.roadworks(), roughness: 0.6, side: THREE.DoubleSide });
  const legs = mat('#e9e6df', { roughness: 0.6 });
  const sign = new THREE.MeshStandardMaterial({ map: tex.sign('ESTRADA CORTADA', '', '#c8102e', '#ffffff', 512, 128, '#ffffff'), roughness: 0.5, side: THREE.DoubleSide });
  for (const gt of f.gates) {
    const hw = gt.w / 2 + 1;
    const n = Math.max(1, Math.round((2 * hw) / 2));
    const span = (2 * hw) / n;
    const row = new THREE.Group();
    // Local x across the street, z the way it leaves.
    for (let k = 0; k < n; k++) {
      const x = -hw + span * (k + 0.5);
      for (const lx of [-span / 2 + 0.15, span / 2 - 0.15]) row.add(box(0.08, 1.15, 0.6, legs, x + lx, 0, 0));
      for (const y of [0.5, 0.9]) {
        const b = new THREE.Mesh(new THREE.PlaneGeometry(span - 0.1, 0.24), boards);
        b.position.set(x, y + 0.12, 0.05);
        row.add(b);
      }
    }
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), sign);
    plate.position.set(0, 1.45, -0.06);
    plate.rotation.y = Math.PI;
    row.add(plate, box(0.06, 1.7, 0.06, legs, -0.6, 0, 0), box(0.06, 1.7, 0.06, legs, 0.6, 0, 0));
    row.position.set(gt.x, gt.y, gt.z);
    row.rotation.y = -gt.heading + Math.PI / 2;
    root.add(row);
  }
  const out = bake(root);
  out.add(rail);
  out.visible = false;
  return out;
}
