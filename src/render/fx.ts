// Particles: each driver's trail (confetti, money, gas, flames…) and the confetti for a lap.
import * as THREE from 'three';
import type { Trail } from './drivers.ts';

const MAX = 3000;

interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  r: number;
  g: number;
  b: number;
  grav: number;
}

const STYLE: Record<Exclude<Trail, null>, { colors: string[]; grav: number; life: number; spread: number; up: number; rate: number }> = {
  confetti: { colors: ['#ffffff', '#d4af37', '#f5e6a8'], grav: -3, life: 1.4, spread: 2, up: 2, rate: 30 },
  money: { colors: ['#3d9a50', '#7ed38d', '#2f7a3f'], grav: -2, life: 1.6, spread: 1.6, up: 2.5, rate: 18 },
  gas: { colors: ['#a5ff3a', '#7bd12a', '#c8ff8a'], grav: 0.6, life: 1.6, spread: 0.6, up: 0.5, rate: 26 },
  flame: { colors: ['#ff7a1a', '#ffd04d', '#ff3d1a'], grav: 1, life: 0.35, spread: 0.5, up: 0.4, rate: 60 },
  bubbles: { colors: ['#d8f1ff', '#ffffff', '#ffd1e8'], grav: 0.8, life: 1.8, spread: 0.8, up: 1, rate: 14 },
  sparkle: { colors: ['#ff4fd8', '#3be8c4', '#ffffff', '#ffe14d'], grav: -1, life: 0.8, spread: 1.2, up: 1.5, rate: 24 },
  smoke: { colors: ['#9a9a9a', '#bdbdbd', '#7a7a7a'], grav: 0.7, life: 1.4, spread: 0.5, up: 0.6, rate: 20 },
};

function dot(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class Particles {
  readonly points: THREE.Points;
  private ps: P[] = [];
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private carry = new Map<string, number>();
  private c = new THREE.Color();

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.55, map: dot(), vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.05 }),
    );
    this.points.frustumCulled = false;
  }

  private add(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: string, grav: number): void {
    if (this.ps.length >= MAX) this.ps.shift();
    this.c.set(color);
    this.ps.push({ x, y, z, vx, vy, vz, life, max: life, r: this.c.r, g: this.c.g, b: this.c.b, grav });
  }

  // A car's trail, from just behind it; key keeps each car's emission smooth from frame to frame.
  trail(key: string, kind: Trail, at: THREE.Vector3, back: THREE.Vector3, speed: number, boosting: boolean, dt: number): void {
    if (!kind) return;
    const s = STYLE[kind];
    if (kind === 'flame' && !boosting && speed < 30) return;
    const rate = s.rate * (kind === 'gas' || kind === 'smoke' ? 0.5 + Math.min(1, speed / 30) : Math.min(1, speed / 15));
    let n = (this.carry.get(key) ?? 0) + rate * dt;
    while (n >= 1) {
      n--;
      const r = () => (Math.random() - 0.5) * s.spread;
      this.add(
        at.x + back.x * 2 + r() * 0.5,
        at.y + 0.8 + Math.random() * 0.4,
        at.z + back.z * 2 + r() * 0.5,
        back.x * (kind === 'flame' ? 8 : 1) + r(),
        s.up * Math.random(),
        back.z * (kind === 'flame' ? 8 : 1) + r(),
        s.life * (0.7 + Math.random() * 0.6),
        s.colors[Math.floor(Math.random() * s.colors.length)],
        s.grav,
      );
    }
    this.carry.set(key, n);
  }

  burst(at: THREE.Vector3, n = 220): void {
    const colors = ['#ffffff', '#d4af37', '#ffe14d', '#ff4fd8', '#3be8c4'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 7;
      this.add(at.x, at.y + 2, at.z, Math.cos(a) * sp, 4 + Math.random() * 8, Math.sin(a) * sp, 1.6 + Math.random(), colors[i % colors.length], -9);
    }
  }

  update(dt: number): void {
    let w = 0;
    for (const p of this.ps) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 0.97;
      p.vz *= 0.97;
      this.ps[w++] = p;
    }
    this.ps.length = w;
    for (let i = 0; i < w; i++) {
      const p = this.ps[i];
      const f = Math.min(1, p.life / (p.max * 0.4));
      this.pos.set([p.x, p.y, p.z], i * 3);
      this.col.set([p.r * f, p.g * f, p.b * f], i * 3);
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, w);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
}
