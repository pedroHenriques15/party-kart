// What a competitive match (game/comp.ts) puts in the arena: each bomb site's edge painted on the
// ground and its letter over it, the bomb where it lies or ticks (its light blinking faster as it
// nears the end), and the guns on the ground where they fell.
import * as THREE from 'three';
import type { CompState, Site } from '../game/comp.ts';
import { lookOf } from './guns.ts';
import { buildGun } from './guns.ts';
import { mat } from './kit.ts';

// A site's letter, a sprite that faces you, seen through the walls, as a marker on the screen.
function letter(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(10,12,18,0.55)';
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#ffd34a';
  g.stroke();
  g.fillStyle = '#ffd34a';
  g.font = '800 72px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // The same size on the screen however far off: a twentieth of its height.
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, opacity: 0.85, sizeAttenuation: false }));
  s.scale.setScalar(0.05);
  s.renderOrder = 10;
  return s;
}

// A site's edge on the ground: a ring of paint, dashed, on the ground under it.
function ring(s: Site): THREE.Mesh {
  const g = new THREE.RingGeometry(s.r - 0.12, s.r, 64, 1);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshBasicMaterial({ color: '#ffd34a', transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(s.x, s.y + 0.04, s.z);
  return mesh;
}

// The bomb: a block of charges taped together with a keypad, and its red light.
function bomb(): { group: THREE.Group; light: THREE.Mesh } {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.22), mat('#5d5a3c', { roughness: 0.8 }));
  body.position.y = 0.06;
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.12), mat('#202224', { roughness: 0.5 }));
  pad.position.set(0.04, 0.135, 0);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.125, 0.04), mat('#2b2b2b', { roughness: 0.9 }));
  tape.position.set(0, 0.06, -0.06);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff2a1a', toneMapped: false }));
  light.position.set(-0.1, 0.14, 0.05);
  for (const m of [body, pad, tape]) m.castShadow = true;
  group.add(body, pad, tape, light);
  return { group, light };
}

// The ring under a gun on the ground.
let ringGeo: THREE.BufferGeometry | null = null;
const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
function dropRing(): THREE.Mesh {
  if (!ringGeo) {
    ringGeo = new THREE.RingGeometry(0.42, 0.5, 32, 1);
    ringGeo.rotateX(-Math.PI / 2);
  }
  const m = new THREE.Mesh(ringGeo, ringMat);
  m.position.y = 0.04;
  return m;
}

export class CompView {
  readonly group = new THREE.Group();
  private sites: THREE.Object3D[] = [];
  private bomb = bomb();
  private drops = new Map<string, THREE.Group>();
  private map: CompState['map'] | null = null;

  constructor() {
    this.group.add(this.bomb.group);
    this.bomb.group.visible = false;
  }

  // The match as it is: the sites (once), the bomb where it is and how long it has, the guns down.
  // tick: ms the planted bomb has left.
  update(s: CompState, tick: number, now: number): void {
    if (this.map !== s.map) {
      this.map = s.map;
      for (const o of this.sites) this.group.remove(o);
      this.sites = s.map.sites.flatMap((site) => {
        const l = letter(site.id);
        l.position.set(site.x, site.y + 2.6, site.z);
        return [ring(site), l];
      });
      this.group.add(...this.sites);
    }
    const b = s.bomb;
    const shown = b.at === 'dropped' || b.at === 'planted' || b.at === 'defused';
    this.bomb.group.visible = shown;
    if (shown) {
      this.bomb.group.position.set(b.x, b.y + 0.01, b.z);
      // It blinks once a second, then faster and faster.
      const every = b.at === 'planted' ? Math.max(120, Math.min(1000, tick / 40)) : 1e9;
      this.bomb.light.visible = b.at === 'planted' && now % every < every * 0.35;
    }
    const want = new Set(s.drops.map((d) => d.id));
    for (const [id, g] of this.drops) {
      if (want.has(id)) continue;
      this.group.remove(g);
      this.drops.delete(id);
    }
    for (const d of s.drops) {
      if (this.drops.has(d.id) || d.w === 'c4') continue;
      // Lying on its side, a little bigger than in a hand, over a faint ring so it's found on any
      // ground.
      const gun = buildGun(lookOf(d.w), false);
      const g = new THREE.Group();
      gun.group.rotation.set(Math.PI / 2, 0, 0);
      gun.group.scale.setScalar(1.5);
      const spin = new THREE.Group();
      spin.rotation.y = (d.x * 7.3) % (Math.PI * 2);
      spin.position.y = 0.1;
      spin.add(gun.group);
      g.add(spin, dropRing());
      g.position.set(d.x, d.y, d.z);
      this.group.add(g);
      this.drops.set(d.id, g);
    }
  }

  clear(): void {
    for (const g of this.drops.values()) this.group.remove(g);
    this.drops.clear();
    this.bomb.group.visible = false;
  }
}
