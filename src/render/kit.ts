// Small helpers for building the landmarks out of simple shapes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surfacePoint, type Track } from '../track/track.ts';

export type Ground = (x: number, z: number) => number;

// Shared by colour and settings, so landmarks merge into few meshes.
const mats = new Map<string, THREE.MeshStandardMaterial>();
export const mat = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial => {
  const key = color + JSON.stringify(o, (_k, v) => (v instanceof THREE.Texture ? v.uuid : v));
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...o });
    mats.set(key, m);
  }
  return m;
};

// A box standing on y (its bottom at y).
export function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y + h / 2, z);
  b.castShadow = true;
  b.receiveShadow = true;
  return b;
}

export function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

// A frame on the track: local x along it, z to its right.
export function at(track: Track, i: number, lateral: number, up = 0): { pos: THREE.Vector3; yaw: number } {
  const N = track.samples.length;
  const s = track.samples[((i % N) + N) % N];
  const p = surfacePoint(s, lateral, up);
  return { pos: new THREE.Vector3(p.x, p.y, p.z), yaw: -Math.atan2(s.t.z, s.t.x) };
}

// Puts obj on the ground beside sample i, `lateral` metres right of the centre line, facing the
// road (its +x towards it) unless turned.
export function beside(track: Track, ground: Ground, obj: THREE.Object3D, i: number, lateral: number, turn = 0): THREE.Object3D {
  const f = at(track, i, lateral);
  obj.position.set(f.pos.x, ground(f.pos.x, f.pos.z), f.pos.z);
  // +x faces the road: from the left side that's the track's right, from the right its left.
  obj.rotation.y = f.yaw + (lateral < 0 ? -Math.PI / 2 : Math.PI / 2) + turn;
  return obj;
}

// A shape with holes, extruded `depth` deep, centred on z.
export function slab(shape: THREE.Shape, depth: number, m: THREE.Material): THREE.Mesh {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return mesh(g, m);
}

// Merges a group's still meshes that share a material into one mesh each, transforms baked in:
// a landmark of eighty boxes becomes a handful of draw calls. Instanced meshes, lines, points,
// meshes with several materials or coloured vertices (the terrain), and anything under an object
// marked userData.moves are left as they are.
export function bake(root: THREE.Group): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; shadow: boolean }>();
  const done: THREE.Mesh[] = [];
  const moving = (o: THREE.Object3D | null): boolean => !!o && o !== root && (o.userData.moves || moving(o.parent));
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || Array.isArray(o.material) || o.material.vertexColors || moving(o)) return;
    let g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    g.clearGroups();
    const entry = byMat.get(o.material) ?? { geos: [], shadow: false };
    entry.geos.push(g);
    entry.shadow ||= o.castShadow;
    byMat.set(o.material, entry);
    done.push(o);
  });
  for (const m of done) m.removeFromParent();
  for (const [material, { geos, shadow }] of byMat) {
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.applyMatrix4(new THREE.Matrix4()); // already in root's frame
    root.add(mesh);
  }
  return root;
}
