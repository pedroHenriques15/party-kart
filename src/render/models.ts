// The deathmatch's CC0 models (src/fight/models, the asset agent's ASSETS.md): every gun, the knife, the
// grenades and the fighters' figure, loaded the first time they're asked for and never waited on: until
// one is in, whoever draws it draws its stand-in made in code (buildGun in arms.ts, buildWalker for a
// fighter). Each model comes in a handful of meshes, one a material; they're merged here into one
// mesh painted with vertex colours, one draw call, keeping the bones a gun's magazine, slide, bolt or
// pump hangs on (the first-person gun moves them) and the figure's skeleton and clips.
//
// How they come: a gun in metres, its barrel along -z and its top up +y, with a `muzzle` and a
// `trigger` marker; a grenade or the knife upright along +y; the figure 1.82 m tall to its helmet's
// top, facing +z, its feet on y = 0.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import type { WeaponId } from '../game/arsenal.ts';

// Vite bundles each from its literal URL.
const URLS: Record<WeaponId | 'fighter', string> = {
  glock: new URL('../fight/models/glock.glb', import.meta.url).href,
  usp: new URL('../fight/models/usp.glb', import.meta.url).href,
  p250: new URL('../fight/models/p250.glb', import.meta.url).href,
  deagle: new URL('../fight/models/deagle.glb', import.meta.url).href,
  mac10: new URL('../fight/models/mac10.glb', import.meta.url).href,
  mp9: new URL('../fight/models/mp9.glb', import.meta.url).href,
  ump: new URL('../fight/models/ump.glb', import.meta.url).href,
  p90: new URL('../fight/models/p90.glb', import.meta.url).href,
  galil: new URL('../fight/models/galil.glb', import.meta.url).href,
  famas: new URL('../fight/models/famas.glb', import.meta.url).href,
  ak47: new URL('../fight/models/ak47.glb', import.meta.url).href,
  m4a4: new URL('../fight/models/m4a4.glb', import.meta.url).href,
  m4a1s: new URL('../fight/models/m4a1s.glb', import.meta.url).href,
  sg553: new URL('../fight/models/sg553.glb', import.meta.url).href,
  aug: new URL('../fight/models/aug.glb', import.meta.url).href,
  ssg08: new URL('../fight/models/ssg08.glb', import.meta.url).href,
  awp: new URL('../fight/models/awp.glb', import.meta.url).href,
  nova: new URL('../fight/models/nova.glb', import.meta.url).href,
  xm1014: new URL('../fight/models/xm1014.glb', import.meta.url).href,
  negev: new URL('../fight/models/negev.glb', import.meta.url).href,
  knife: new URL('../fight/models/knife.glb', import.meta.url).href,
  he: new URL('../fight/models/he.glb', import.meta.url).href,
  flash: new URL('../fight/models/flash.glb', import.meta.url).href,
  smoke: new URL('../fight/models/smoke.glb', import.meta.url).href,
  molotov: new URL('../fight/models/molotov.glb', import.meta.url).href,
  fighter: new URL('../fight/models/fighter.glb', import.meta.url).href,
};

// ---- Merging a model ----

interface Merged {
  geo: THREE.BufferGeometry;
  // Each vertex's source mesh, for painting it (a fighter's in their own colours): its material, its name.
  part: Uint8Array;
  mats: THREE.MeshStandardMaterial[];
  names: string[];
  // The bones its skin attributes count, in its rest pose, or null for a still mesh.
  bones: THREE.Bone[] | null;
  // A material's texture, kept when there's one (the knife's palette): then it isn't painted.
  map: THREE.Texture | null;
}

const _m = new THREE.Matrix4();
const _b = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector4();
const _i = new THREE.Vector4();

// Everything under root as one geometry in root's frame, posed as it stands, with each vertex's
// skin on the bones it hangs from (a mesh hanging from a bone, as a scope does, on that bone);
// root must be at the origin, its world matrices up to date.
function merge(root: THREE.Object3D, skinned: boolean): Merged {
  const geos: THREE.BufferGeometry[] = [];
  const parts: number[] = [];
  const mats: THREE.MeshStandardMaterial[] = [];
  const names: string[] = [];
  const bones: THREE.Bone[] = [];
  let map: THREE.Texture | null = null;
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone && !bones.includes(o as THREE.Bone)) bones.push(o as THREE.Bone);
  });
  const boneOf = (o: THREE.Object3D): number => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if ((p as THREE.Bone).isBone) return bones.indexOf(p as THREE.Bone);
    return -1;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.geometry;
    const pos = src.attributes.position;
    const nor = src.attributes.normal;
    const uv = src.attributes.uv;
    const n = pos.count;
    const P = new Float32Array(n * 3);
    const N = new Float32Array(n * 3);
    const UV = new Float32Array(n * 2);
    const SI = new Uint16Array(n * 4);
    const SW = new Float32Array(n * 4);
    const sk = mesh as THREE.SkinnedMesh;
    const rigid = boneOf(mesh);
    for (let k = 0; k < n; k++) {
      if (sk.isSkinnedMesh) {
        // Its pose as it stands: each bone's move from where the skin was bound, blended.
        _w.fromBufferAttribute(src.attributes.skinWeight as THREE.BufferAttribute, k);
        _i.fromBufferAttribute(src.attributes.skinIndex as THREE.BufferAttribute, k);
        const e = new Array(16).fill(0);
        for (let j = 0; j < 4; j++) {
          const wt = _w.getComponent(j);
          if (!wt) continue;
          const bi = _i.getComponent(j);
          _b.multiplyMatrices(sk.skeleton.bones[bi].matrixWorld, sk.skeleton.boneInverses[bi]);
          for (let q = 0; q < 16; q++) e[q] += _b.elements[q] * wt;
          SI[k * 4 + j] = Math.max(0, bones.indexOf(sk.skeleton.bones[bi]));
          SW[k * 4 + j] = wt;
        }
        _b.fromArray(e);
        _m.copy(sk.matrixWorld).multiply(sk.bindMatrixInverse).multiply(_b).multiply(sk.bindMatrix);
      } else {
        _m.copy(mesh.matrixWorld);
        // On the bone it hangs from, or on the first (which never moves).
        SI[k * 4] = Math.max(0, rigid);
        SW[k * 4] = 1;
      }
      _v.fromBufferAttribute(pos, k).applyMatrix4(_m);
      P.set([_v.x, _v.y, _v.z], k * 3);
      if (nor) {
        _v.fromBufferAttribute(nor, k).applyMatrix3(_n.getNormalMatrix(_m)).normalize();
        N.set([_v.x, _v.y, _v.z], k * 3);
      }
      if (uv) UV.set([uv.getX(k), uv.getY(k)], k * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
    if (skinned) {
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    }
    const idx = src.index ? Array.from(src.index.array) : Array.from({ length: n }, (_, k) => k);
    // A mirrored mesh's triangles wind the other way.
    if (_m.determinant() < 0) for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
    g.setIndex(idx);
    if (!nor) g.computeVertexNormals();
    // A part a mesh: a material may be on several, as the figure's black on its vest and its boots.
    const mt = mesh.material as THREE.MeshStandardMaterial;
    if (mt.map) map = mt.map;
    const mi = mats.push(mt) - 1;
    names.push(mesh.name);
    for (let k = 0; k < n; k++) parts.push(mi);
    geos.push(g);
  });
  const geo = mergeGeometries(geos)!;
  return { geo, part: Uint8Array.from(parts), mats, names, bones: skinned && bones.length ? bones : null, map };
}

// A vertex colour attribute, each vertex its part's colour.
function paint(m: Merged, colours: THREE.Color[]): THREE.BufferAttribute {
  const c = new Float32Array(m.part.length * 3);
  for (let k = 0; k < m.part.length; k++) {
    const x = colours[m.part[k]];
    c[k * 3] = x.r;
    c[k * 3 + 1] = x.g;
    c[k * 3 + 2] = x.b;
  }
  return new THREE.BufferAttribute(c, 3);
}

// ---- The weapons ----

// The bones a gun's moving parts hang on, each with how to move it in the gun's own frame.
export interface Part {
  bone: THREE.Bone;
  rest: THREE.Vector3;
  restQ: THREE.Quaternion;
  // The gun's frame into the bone's parent's (for moving it) and its own (for turning it).
  toParent: THREE.Matrix3;
  toOwn: THREE.Quaternion;
}

export interface WeaponModel {
  id: WeaponId;
  // The one rigged copy, for your hands: a mesh on its bones, under its root.
  rig: THREE.Group;
  // The geometry and material for still copies, in the others' hands.
  still: THREE.BufferGeometry;
  material: THREE.Material;
  muzzle: THREE.Vector3;
  trigger: THREE.Vector3;
  box: THREE.Box3;
  parts: { mag?: Part; slide?: Part; bolt?: Part; pump?: Part; shell?: Part; handle?: Part };
}

// A gun's colours: its file's are nearly black, lifted a little so its shape shows under any light,
// and each grenade's band in its own colour (the file's four share one blue).
function shade(id: WeaponId, mt: THREE.MeshStandardMaterial): THREE.Color {
  const c = mt.color.clone();
  const name = mt.name;
  if (/Glass/.test(name)) return new THREE.Color('#1d3442');
  if (id === 'he' && /Blue/.test(name)) return new THREE.Color('#b59a2c');
  if (id === 'he' && /Black_Lighter/.test(name)) return new THREE.Color('#3b452a');
  if (id === 'flash' && /Blue/.test(name)) return new THREE.Color('#e9e9e4');
  if (id === 'flash' && /Black_Lighter/.test(name)) return new THREE.Color('#8f979c');
  if (id === 'smoke' && /Blue/.test(name)) return new THREE.Color('#6aa84f');
  if (id === 'smoke' && /Black_Lighter/.test(name)) return new THREE.Color('#5c6560');
  c.r = 0.022 + c.r * 0.95;
  c.g = 0.022 + c.g * 0.95;
  c.b = 0.024 + c.b * 0.95;
  return c;
}

const BONES: Record<keyof WeaponModel['parts'], string> = { mag: 'Magazine', slide: 'Slide', bolt: 'Bolt', pump: 'Pump', shell: 'Shell', handle: 'Charging_Handle' };

function partOf(b: THREE.Bone): Part {
  const pq = b.parent!.getWorldQuaternion(new THREE.Quaternion());
  const ps = b.parent!.getWorldScale(new THREE.Vector3());
  const toParent = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(pq.clone().invert()));
  // Its parent's scale too, so a move is in metres.
  toParent.premultiply(new THREE.Matrix3().set(1 / ps.x, 0, 0, 0, 1 / ps.y, 0, 0, 0, 1 / ps.z));
  return { bone: b, rest: b.position.clone(), restQ: b.quaternion.clone(), toParent, toOwn: b.getWorldQuaternion(new THREE.Quaternion()).invert() };
}

// Moves a part by d (metres, in the gun's frame) from where it rests, turned by angle a about the
// gun's axis `axis`.
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
export function pose(p: Part | undefined, dx: number, dy: number, dz: number, a = 0, axis?: THREE.Vector3): void {
  if (!p) return;
  _d.set(dx, dy, dz).applyMatrix3(p.toParent);
  p.bone.position.copy(p.rest).add(_d);
  p.bone.quaternion.copy(p.restQ);
  if (a && axis) p.bone.quaternion.multiply(_q.setFromAxisAngle(_d.copy(axis).applyQuaternion(p.toOwn).normalize(), a));
}

function prepareWeapon(id: WeaponId, scene: THREE.Group): WeaponModel {
  scene.updateMatrixWorld(true);
  const muzzleNode = scene.getObjectByName('muzzle');
  const triggerNode = scene.getObjectByName('trigger');
  const box = new THREE.Box3().setFromObject(scene);
  const muzzle = muzzleNode ? muzzleNode.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, (box.min.y + box.max.y) / 2, box.min.z);
  const trigger = triggerNode ? triggerNode.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
  const m = merge(scene, true);
  const colours = m.mats.map((mt) => shade(id, mt));
  let material: THREE.Material;
  if (m.map) {
    material = new THREE.MeshStandardMaterial({ map: m.map, metalness: 0.3, roughness: 0.5 });
  } else {
    m.geo.setAttribute('color', paint(m, colours));
    material = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.48 });
  }
  // The still copy: no skin.
  const still = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'uv', 'color']) if (m.geo.attributes[k]) still.setAttribute(k, m.geo.attributes[k]);
  still.setIndex(m.geo.index);
  still.computeBoundingSphere();
  // The rigged copy: the file's bones kept under a fresh root, its meshes replaced by the one.
  const rig = new THREE.Group();
  const parts: WeaponModel['parts'] = {};
  if (m.bones) {
    const tops = new Set<THREE.Object3D>();
    for (const b of m.bones) {
      let t: THREE.Object3D = b;
      while (t.parent && t.parent !== scene) t = t.parent;
      tops.add(t);
    }
    for (const t of tops) {
      // Its meshes go: they're in the merged one.
      const drop: THREE.Object3D[] = [];
      t.traverse((o) => (o as THREE.Mesh).isMesh && drop.push(o));
      for (const o of drop) o.removeFromParent();
      rig.add(t);
    }
    rig.updateMatrixWorld(true);
    const skel = new THREE.Skeleton(m.bones);
    skel.calculateInverses();
    const sm = new THREE.SkinnedMesh(m.geo, material);
    sm.bind(skel, new THREE.Matrix4());
    sm.frustumCulled = false;
    rig.add(sm);
    for (const [k, name] of Object.entries(BONES) as [keyof WeaponModel['parts'], string][]) {
      const b = m.bones.find((x) => x.name === name);
      if (b) parts[k] = partOf(b);
    }
  } else {
    const mesh = new THREE.Mesh(still, material);
    mesh.frustumCulled = false;
    rig.add(mesh);
  }
  return { id, rig, still, material, muzzle, trigger, box, parts };
}

// ---- The figure ----

export interface FighterModel {
  // The rigged figure, to be cloned (SkeletonUtils) for each fighter: its root, its one mesh.
  root: THREE.Group;
  geo: THREE.BufferGeometry;
  part: Uint8Array;
  // Its meshes' names (Swat_Body_1 and so on) in the order `part` counts them.
  names: string[];
  clips: THREE.AnimationClip[];
}

function prepareFighter(scene: THREE.Group, clips: THREE.AnimationClip[]): FighterModel {
  scene.updateMatrixWorld(true);
  const m = merge(scene, true);
  const drop: THREE.Object3D[] = [];
  scene.traverse((o) => (o as THREE.Mesh).isMesh && drop.push(o));
  for (const o of drop) o.removeFromParent();
  const root = new THREE.Group();
  root.add(...scene.children.slice());
  root.updateMatrixWorld(true);
  const skel = new THREE.Skeleton(m.bones!);
  skel.calculateInverses();
  const sm = new THREE.SkinnedMesh(m.geo, new THREE.MeshStandardMaterial({ vertexColors: true }));
  sm.name = 'body';
  sm.bind(skel, new THREE.Matrix4());
  root.add(sm);
  return { root, geo: m.geo, part: m.part, names: m.names, clips };
}

// A fighter's own copy: its bones, its mesh sharing the figure's geometry but for its colours, each
// vertex's from its mesh's name and where it is on the figure standing (metres, facing +z).
export type Painter = (name: string, x: number, y: number, z: number) => THREE.Color;
export function cloneFighter(f: FighterModel, paintOf: Painter): { root: THREE.Group; mesh: THREE.SkinnedMesh } {
  const root = cloneRig(f.root) as THREE.Group;
  const mesh = root.getObjectByName('body') as THREE.SkinnedMesh;
  const g = new THREE.BufferGeometry();
  for (const k of Object.keys(f.geo.attributes)) if (k !== 'color') g.setAttribute(k, f.geo.attributes[k]);
  g.setIndex(f.geo.index);
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(f.part.length * 3), 3));
  // Bounds round a person on their feet or down, for culling it off screen.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.4);
  mesh.geometry = g;
  repaint(f, mesh, paintOf);
  return { root, mesh };
}

// A fighter painted again (their team's changed).
export function repaint(f: FighterModel, mesh: THREE.SkinnedMesh, paintOf: Painter): void {
  const pos = f.geo.attributes.position;
  const col = mesh.geometry.attributes.color as THREE.BufferAttribute;
  for (let k = 0; k < f.part.length; k++) {
    const c = paintOf(f.names[f.part[k]], pos.getX(k), pos.getY(k), pos.getZ(k));
    col.setXYZ(k, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}

// ---- Loading ----

const loader = new GLTFLoader();
const weapons = new Map<WeaponId, WeaponModel>();
const asked = new Set<string>();
let fighter: FighterModel | null = null;

function load(id: WeaponId | 'fighter'): void {
  if (asked.has(id)) return;
  asked.add(id);
  loader.load(
    URLS[id],
    (gltf) => {
      try {
        if (id === 'fighter') fighter = prepareFighter(gltf.scene, gltf.animations);
        else weapons.set(id, prepareWeapon(id, gltf.scene));
      } catch (e) {
        console.warn(`model ${id}:`, e);
      }
    },
    undefined,
    (e) => console.warn(`model ${id} didn't load:`, e),
  );
}

// A weapon's model if it's in, else null (and it's on its way).
export function weaponModel(id: WeaponId): WeaponModel | null {
  const m = weapons.get(id);
  if (!m) load(id);
  return m ?? null;
}

// The fighters' figure if it's in, else null (and it's on its way).
export function fighterModel(): FighterModel | null {
  if (!fighter) load('fighter');
  return fighter;
}

// Starts them all loading, one after another as the browser fetches, before a round needs them.
export function preload(ids: readonly WeaponId[]): void {
  fighterModel();
  for (const id of ids) weaponModel(id);
}
