// What the power-ups look like: spinning item boxes, the disco ball rolling, the paparazzi drone
// with its flashing camera, the party bomb with its lit fuse, the wobbling pudim, and the bass
// drop's shockwave.
import * as THREE from 'three';
import type { Arena } from '../game/arena.ts';
import { projProgress, type Proj } from '../game/items.ts';
import { surfacePoint, type Track } from '../track/track.ts';
import * as tex from './textures.ts';

const std = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...o });

function discoBall(): THREE.Object3D {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 2), std('#eef2f8', { metalness: 1, roughness: 0.08, flatShading: true, emissive: '#3a3f4a' }));
  ball.castShadow = true;
  g.add(ball);
  return g;
}

function drone(): THREE.Object3D {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.7), std('#1d1e22', { metalness: 0.4 })));
  for (const [x, z] of [
    [0.55, 0.55],
    [-0.55, 0.55],
    [0.55, -0.55],
    [-0.55, -0.55],
  ]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.08), std('#2a2a2e'));
    arm.position.set(x / 2, 0, z / 2);
    arm.rotation.y = Math.atan2(-z, x);
    g.add(arm);
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.02, 16), std('#9aa3ad', { transparent: true, opacity: 0.45 }));
    rotor.position.set(x, 0.1, z);
    rotor.name = 'rotor';
    g.add(rotor);
  }
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.25, 14), std('#111'));
  lens.rotation.z = Math.PI / 2;
  lens.position.set(0.4, -0.15, 0);
  g.add(lens);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
  flash.position.set(0.5, 0.05, 0.2);
  flash.name = 'flash';
  g.add(flash);
  return g;
}

function bomb(): THREE.Object3D {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 14), std('#ff4fd8', { roughness: 0.3, emissive: '#3a0a30' }));
  b.castShadow = true;
  g.add(b);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 8, 28), std('#ffe14d', { metalness: 0.8, roughness: 0.3 }));
  band.rotation.x = Math.PI / 2;
  g.add(band);
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), std('#5a4630'));
  fuse.position.y = 1.05;
  g.add(fuse);
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffd04d', toneMapped: false }));
  spark.position.y = 1.35;
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

export class ItemsView {
  readonly group = new THREE.Group();
  private track: Track;
  private boxes: THREE.InstancedMesh;
  private things = new Map<string, THREE.Object3D>();
  private waves: { mesh: THREE.Mesh; t0: number }[] = [];
  private flashes: { mesh: THREE.Mesh; t0: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor(track: Track, arena: Arena | null) {
    this.track = track;
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
      const o = this.thing(p.id, () => (p.kind === 'disco' ? discoBall() : p.kind === 'drone' ? drone() : bomb()));
      this.placeProj(o, p, time, t, dt);
    }
    for (const h of arena.hazards.values()) {
      live.add(h.id);
      const o = this.thing(h.id, pudim);
      const s = this.track.samples[h.idx];
      const p = surfacePoint(s, h.lat, 0.02);
      o.position.set(p.x, p.y, p.z);
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
    const lift = p.kind === 'disco' ? 0.64 : p.kind === 'drone' ? 2.6 + Math.sin(t * 5) * 0.2 : 5.5 + Math.sin(t * 3) * 0.4;
    const pa = surfacePoint(a, p.lat, lift);
    const pb = surfacePoint(b, p.lat, lift);
    o.position.set(pa.x + (pb.x - pa.x) * f, pa.y + (pb.y - pa.y) * f, pa.z + (pb.z - pa.z) * f);
    const yaw = -Math.atan2(a.t.z, a.t.x) + (p.v < 0 ? Math.PI : 0);
    if (p.kind === 'disco') {
      o.rotation.set(0, yaw, 0);
      o.children[0].rotation.z -= (p.v / 0.62) * dt;
    } else {
      o.rotation.set(0, yaw, 0);
      o.traverse((c) => {
        if (c.name === 'rotor') c.rotation.y += dt * 40;
      });
    }
    const flash = o.getObjectByName('flash');
    if (flash) flash.visible = Math.sin(t * (p.kind === 'drone' ? 9 : 25)) > 0;
  }

  // The bass drop's ring, from where it was dropped.
  wave(at: { x: number; y: number; z: number }, t: number): void {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.25, 8, 48), new THREE.MeshBasicMaterial({ color: '#b26bff', transparent: true, opacity: 0.7, toneMapped: false, depthWrite: false }));
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(at.x, at.y + 1, at.z);
    this.group.add(mesh);
    this.waves.push({ mesh, t0: t });
  }

  // A flash where something hit, or the party bomb went off.
  flash(at: { x: number; y: number; z: number }, t: number, color: string, size = 1): void {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, toneMapped: false, depthWrite: false }));
    mesh.position.set(at.x, at.y + 1, at.z);
    this.group.add(mesh);
    this.flashes.push({ mesh, t0: t });
  }
}
