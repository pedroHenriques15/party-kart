// What the power-ups look like: spinning item boxes, the Bola do Braga rolling, the pombo-correio
// flapping to the car ahead, the foguete on its stick with its sparks, the wobbling pudim, and the
// martelinho's ring.
import * as THREE from 'three';
import type { Arena } from '../game/arena.ts';
import { latAt, projProgress, type Proj } from '../game/items.ts';
import { surfacePoint, type Track } from '../track/track.ts';
import * as tex from './textures.ts';

const std = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...o });

// A football in SC Braga's red and white: red patches on white, wrapped round the ball.
let ballTex: THREE.CanvasTexture | null = null;
function bola(): THREE.Object3D {
  ballTex ??= tex.drawTexture(256, 128, (g) => {
    g.fillStyle = '#f7f5f0';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#c8102e';
    const patch = (x: number, y: number, r: number) => {
      g.beginPath();
      for (let k = 0; k < 5; k++) g.lineTo(x + Math.cos((k / 5) * Math.PI * 2 - Math.PI / 2) * r, y + Math.sin((k / 5) * Math.PI * 2 - Math.PI / 2) * r);
      g.fill();
    };
    for (let k = 0; k < 5; k++) {
      patch(k * 51.2 + 12, 30, 15);
      patch(k * 51.2 + 38, 98, 15);
    }
    g.fillRect(0, 0, 256, 6);
    g.fillRect(0, 122, 256, 6);
  });
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 16), std('#ffffff', { map: ballTex, roughness: 0.35 }));
  ball.castShadow = true;
  g.add(ball);
  return g;
}

// A grey pigeon, its neck green and purple, a message rolled on its leg; +x is its beak.
function pombo(): THREE.Object3D {
  const g = new THREE.Group();
  const grey = std('#8d95a3', { roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), grey);
  body.scale.set(1.35, 0.85, 0.85);
  body.castShadow = true;
  g.add(body);
  const neck = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), std('#4f7f6a', { roughness: 0.4, metalness: 0.3, emissive: '#2a1a3a' }));
  neck.position.set(0.38, 0.16, 0);
  g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), grey);
  head.position.set(0.56, 0.3, 0);
  g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 6), std('#3a3438'));
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.74, 0.28, 0);
  g.add(beak);
  for (const z of [-0.1, 0.1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), std('#ff7a1a', { emissive: '#7a2a00' }));
    eye.position.set(0.64, 0.34, z);
    g.add(eye);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.3), std('#5d6470', { roughness: 0.8 }));
  tail.position.set(-0.6, 0.02, 0);
  tail.rotation.z = 0.15;
  g.add(tail);
  const note = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8), std('#f4efe2'));
  note.position.set(0.05, -0.38, 0.1);
  note.rotation.x = Math.PI / 2;
  g.add(note);
  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    const feathers = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.75), std('#a9b0bc', { roughness: 0.8 }));
    feathers.position.set(-0.05, 0, side * 0.38);
    wing.add(feathers);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.3), std('#3d4250', { roughness: 0.8 }));
    tip.position.set(-0.12, 0, side * 0.86);
    wing.add(tip);
    wing.position.set(0, 0.15, side * 0.2);
    wing.name = side < 0 ? 'wingL' : 'wingR';
    g.add(wing);
  }
  return g;
}

// A festival rocket: a red paper tube with a cone, on its long stick, sparks spitting from the back.
function foguete(): THREE.Object3D {
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.3, 16), std('#c8102e', { roughness: 0.7 }));
  tube.rotation.z = -Math.PI / 2;
  tube.castShadow = true;
  g.add(tube);
  for (const x of [-0.45, 0.45]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.08, 16), std('#ffe14d', { roughness: 0.5 }));
    band.rotation.z = -Math.PI / 2;
    band.position.x = x;
    g.add(band);
  }
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 16), std('#f4efe2', { roughness: 0.7 }));
  cone.rotation.z = -Math.PI / 2;
  cone.position.x = 0.9;
  g.add(cone);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 6), std('#b88a52', { roughness: 0.9 }));
  stick.rotation.z = -Math.PI / 2;
  stick.position.set(-1.5, -0.2, 0);
  g.add(stick);
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffd04d', toneMapped: false }));
  spark.position.x = -0.75;
  spark.name = 'flash';
  g.add(spark);
  return g;
}

function pudim(): THREE.Object3D {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.06, 28), std('#ffffff', { roughness: 0.2 })));
  const flan = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.78, 0.6, 28), std('#f2c46b', { roughness: 0.25 }));
  flan.position.y = 0.33;
  flan.castShadow = true;
  flan.name = 'wobble';
  g.add(flan);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.63, 0.62, 0.1, 28), std('#7a3b12', { roughness: 0.1 }));
  top.position.y = 0.66;
  flan.add(top);
  top.position.y = 0.33;
  return g;
}

// The height of what's under a point near a height: the race's floor, which the track's own height can
// be a little off (the stadium's level ground, say).
export type Floor = (x: number, z: number, y: number) => number;

export class ItemsView {
  readonly group = new THREE.Group();
  private track: Track;
  private floor: Floor;
  private boxes: THREE.InstancedMesh;
  private things = new Map<string, THREE.Object3D>();
  private waves: { mesh: THREE.Mesh; t0: number }[] = [];
  private flashes: { mesh: THREE.Mesh; t0: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor(track: Track, arena: Arena | null, floor: Floor = (_x, _z, y) => y) {
    this.track = track;
    this.floor = floor;
    const n = arena?.boxes.length ?? 0;
    this.boxes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.3, 1.3, 1.3),
      new THREE.MeshStandardMaterial({ map: tex.itemBox(), transparent: true, opacity: 0.92, roughness: 0.15, emissive: '#ffffff', emissiveIntensity: 0.25, emissiveMap: tex.itemBox() }),
      Math.max(1, n),
    );
    this.boxes.count = n;
    this.group.add(this.boxes);
  }

  // Positions everything for this moment: boxes (those taken by `taken`'s owner hidden), and the
  // things on the track.
  update(arena: Arena, taken: Map<string, number>, t: number, dt: number): void {
    const time = arena.t;
    arena.boxes.forEach((b, k) => {
      const s = this.track.samples[b.i];
      const p = surfacePoint(s, b.lat, 1.35 + Math.sin(t * 2 + k) * 0.15);
      p.y += this.floor(p.x, p.z, s.p.y) - s.p.y;
      // Taken: gone, growing back in its last 300 ms.
      const back = (taken.get(b.key) ?? -Infinity) - time;
      const sc = back > 0 ? Math.max(0, Math.min(1, 1 - back / 300)) : 1;
      this.q.setFromEuler(new THREE.Euler(0.4, t * 1.6 + k, 0.3));
      this.m.compose(new THREE.Vector3(p.x, p.y, p.z), this.q, new THREE.Vector3(sc, sc, sc));
      this.boxes.setMatrixAt(k, this.m);
    });
    this.boxes.instanceMatrix.needsUpdate = true;

    const live = new Set<string>();
    for (const p of arena.projs.values()) {
      live.add(p.id);
      const o = this.thing(p.id, () => (p.kind === 'bola' ? bola() : p.kind === 'pombo' ? pombo() : foguete()));
      this.placeProj(o, p, time, t, dt);
    }
    for (const h of arena.hazards.values()) {
      live.add(h.id);
      const o = this.thing(h.id, pudim);
      const s = this.track.samples[h.idx];
      const p = surfacePoint(s, h.lat, 0.02);
      o.position.set(p.x, p.y + this.floor(p.x, p.z, s.p.y) - s.p.y, p.z);
      const w = o.getObjectByName('wobble');
      if (w) w.scale.set(1 + Math.sin(t * 9 + h.idx) * 0.06, 1 - Math.sin(t * 9 + h.idx) * 0.08, 1 + Math.cos(t * 9 + h.idx) * 0.06);
    }
    for (const [id, o] of this.things) {
      if (!live.has(id)) {
        this.group.remove(o);
        this.things.delete(id);
      }
    }

    for (const w of [...this.waves]) {
      const age = t - w.t0;
      w.mesh.scale.setScalar(1 + age * 60);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.7 - age * 0.7);
      if (age > 1) {
        this.group.remove(w.mesh);
        this.waves.splice(this.waves.indexOf(w), 1);
      }
    }
    for (const f of [...this.flashes]) {
      const age = t - f.t0;
      f.mesh.scale.setScalar(1 + age * 14);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - age * 3);
      if (age > 0.4) {
        this.group.remove(f.mesh);
        this.flashes.splice(this.flashes.indexOf(f), 1);
      }
    }
  }

  private thing(id: string, make: () => THREE.Object3D): THREE.Object3D {
    let o = this.things.get(id);
    if (!o) {
      o = make();
      this.things.set(id, o);
      this.group.add(o);
    }
    return o;
  }

  private placeProj(o: THREE.Object3D, p: Proj, time: number, t: number, dt: number): void {
    const N = this.track.samples.length;
    const P = projProgress(p, time);
    const i0 = ((Math.floor(P) % N) + N) % N;
    const f = P - Math.floor(P);
    const a = this.track.samples[i0];
    const b = this.track.samples[(i0 + 1) % N];
    const lift = p.kind === 'bola' ? 0.64 : p.kind === 'pombo' ? 2.6 + Math.sin(t * 5) * 0.2 : 5.5 + Math.sin(t * 3) * 0.4;
    const lat = latAt(this.track, P, p.lat);
    const pa = surfacePoint(a, lat, lift);
    const pb = surfacePoint(b, lat, lift);
    const x = pa.x + (pb.x - pa.x) * f;
    const z = pa.z + (pb.z - pa.z) * f;
    const y = a.p.y + (b.p.y - a.p.y) * f;
    o.position.set(x, pa.y + (pb.y - pa.y) * f + this.floor(x, z, y) - y, z);
    const yaw = -Math.atan2(a.t.z, a.t.x) + (p.v < 0 ? Math.PI : 0);
    o.rotation.set(0, yaw, 0);
    if (p.kind === 'bola') o.children[0].rotation.z -= (p.v / 0.62) * dt;
    // The pigeon's wings beat; the rocket's sparks flicker.
    const flap = Math.sin(t * 16) * 0.7;
    const l = o.getObjectByName('wingL');
    const r = o.getObjectByName('wingR');
    if (l && r) {
      l.rotation.x = flap;
      r.rotation.x = -flap;
    }
    const flash = o.getObjectByName('flash');
    if (flash) {
      flash.visible = Math.sin(t * 25) > -0.3;
      flash.scale.setScalar(0.7 + Math.random() * 0.8);
    }
  }

  // The martelinho's ring, from where it was swung.
  wave(at: { x: number; y: number; z: number }, t: number): void {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.25, 8, 48), new THREE.MeshBasicMaterial({ color: '#ffd04d', transparent: true, opacity: 0.7, toneMapped: false, depthWrite: false }));
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(at.x, at.y + 1, at.z);
    this.group.add(mesh);
    this.waves.push({ mesh, t0: t });
  }

  // A flash where something hit, or the rocket burst.
  flash(at: { x: number; y: number; z: number }, t: number, color: string, size = 1): void {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, toneMapped: false, depthWrite: false }));
    mesh.position.set(at.x, at.y + 1, at.z);
    this.group.add(mesh);
    this.flashes.push({ mesh, t0: t });
  }
}
