// Particles: each driver's trail (bits, receipts, smoke, foam…), confetti for a lap, drift
// sparks, tyre smoke, dust, and the bits that fly when something's hit. A few pools, each one
// draw call: a normal one, a glowing one for sparks, a big soft one for smoke.
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
  bits: { colors: ['#22d3ee', '#4ade80', '#a5f3fc'], grav: 0, life: 0.9, spread: 0.8, up: 0.6, rate: 30 },
  receipts: { colors: ['#fbfaf5', '#f1efe6', '#e6e2d4'], grav: -1.5, life: 1.6, spread: 1.4, up: 2, rate: 12 },
  smoke: { colors: ['#2b2b2b', '#3d3d3d', '#1f1f1f'], grav: 0.7, life: 1.6, spread: 0.5, up: 0.6, rate: 26 },
  sparkle: { colors: ['#e0b94a', '#fff3c4', '#ffffff'], grav: -1, life: 0.8, spread: 1.2, up: 1.5, rate: 24 },
  foam: { colors: ['#ffffff', '#bff3e6', '#7fdcc8'], grav: 0.8, life: 1.8, spread: 0.8, up: 1, rate: 14 },
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

  constructor(size = 0.55, glow = false) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size,
        map: dot(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        alphaTest: glow ? 0 : 0.05,
        blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
        toneMapped: !glow,
      }),
    );
    this.points.frustumCulled = false;
  }

  // A spray of n particles from a point: spread is how fast they fly out, up how fast they rise.
  spray(at: { x: number; y: number; z: number }, n: number, colors: string[], spread: number, up: number, life: number, grav = -9): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = spread * (0.3 + Math.random() * 0.7);
      this.add(at.x, at.y, at.z, Math.cos(a) * sp, up * (0.4 + Math.random() * 0.6), Math.sin(a) * sp, life * (0.6 + Math.random() * 0.6), colors[i % colors.length], grav);
    }
  }

  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: string, grav: number): void {
    if (this.ps.length >= MAX) this.ps.shift();
    this.c.set(color);
    this.ps.push({ x, y, z, vx, vy, vz, life, max: life, r: this.c.r, g: this.c.g, b: this.c.b, grav });
  }

  // A car's trail, from just behind it; key keeps each car's emission smooth from frame to frame.
  trail(key: string, kind: Trail, at: THREE.Vector3, back: THREE.Vector3, speed: number, boosting: boolean, dt: number): void {
    if (!kind) return;
    const s = STYLE[kind];
    const rate = s.rate * (kind === 'smoke' ? 0.5 + Math.min(1, speed / 30) : Math.min(1, speed / 15)) * (boosting ? 1.6 : 1);
    let n = (this.carry.get(key) ?? 0) + rate * dt;
    while (n >= 1) {
      n--;
      const r = () => (Math.random() - 0.5) * s.spread;
      this.add(
        at.x + back.x * 2 + r() * 0.5,
        at.y + 0.8 + Math.random() * 0.4,
        at.z + back.z * 2 + r() * 0.5,
        back.x + r(),
        s.up * Math.random(),
        back.z + r(),
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
