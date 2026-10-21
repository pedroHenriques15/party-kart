// The deathmatch drawn (braga-map's task 074): your weapon in your hands in first person
// (render/viewmodel.ts, the CC0 models in render/models.ts, their stand-ins made in code in
// render/guns.ts); the marks bullets leave on the walls and the ground, their tracers and the others'
// muzzle flashes; and the round's edge, a railing where you could walk up to it and road-works
// barriers across its streets, up only while a round is on.
import * as THREE from 'three';
import type { Field } from '../game/field.ts';
import { flashSprite } from './guns.ts';
import { bake, box, mat } from './kit.ts';
import * as tex from './textures.ts';

export { buildGun, flashSprite, lookOf, LOOKS, type Gun, type GunLook } from './guns.ts';
export { Viewmodel, type HandState } from './viewmodel.ts';

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
