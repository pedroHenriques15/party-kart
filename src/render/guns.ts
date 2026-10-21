// The weapons drawn in code: a few shapes for the arsenal's families, the stand-ins for the CC0 models
// (render/models.ts) until those are in, and what a fighter holds if one never comes; and a muzzle's
// flash, a sprite.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GUNS, isGun, type WeaponId } from '../game/arsenal.ts';
import { mat } from './kit.ts';

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

// What a weapon looks like: one of a few shapes, the arsenal's families drawn alike.
export type GunLook = 'rifle' | 'shotgun' | 'sniper' | 'pistol' | 'knife' | 'nade';
export const LOOKS: GunLook[] = ['rifle', 'shotgun', 'sniper', 'pistol', 'knife', 'nade'];
export function lookOf(w: WeaponId): GunLook {
  if (w === 'knife') return 'knife';
  if (!isGun(w)) return 'nade';
  const f = GUNS[w].family;
  return f === 'pistol' ? 'pistol' : f === 'shotgun' ? 'shotgun' : f === 'sniper' ? 'sniper' : 'rifle';
}

// A weapon's shape, its barrel along +x, up +y, the hand on its grip at the middle.
export function buildGun(kit: GunLook, shadows = true): Gun {
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
    case 'knife': // a combat knife: its blade, its guard and its grip
      p.box(mat('#c9ccd0', { metalness: 0.85, roughness: 0.25 }), 0.02, 0.2, 0.03, 0.03, 0.006, 0.05);
      p.box(s, -0.005, 0.02, 0.025, 0.06, 0.02);
      p.box(mat('#2a2b2e', { roughness: 0.8 }), -0.11, -0.005, 0.025, 0.028, 0.024);
      muzzle = new THREE.Vector3(0.2, 0.03, 0);
      break;
    case 'nade': // a grenade: its body, its spoon and its ring
      p.tube(olive(), -0.035, 0.035, 0.03, 0.032);
      p.box(s, -0.01, 0.01, 0.075, 0.03, 0.02);
      p.box(s, 0.005, 0.06, 0.07, 0.01, 0.015, -0.6);
      muzzle = new THREE.Vector3(0, 0.03, 0);
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
