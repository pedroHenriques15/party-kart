// The grenades drawn (game/nades.ts): each on its way along its flight, turning over (its CC0 model,
// render/models.ts); the HE grenade's blast, a fireball, sparks and bits flying, a ring of dust and
// smoke rising after; the flash's white burst; the smoke's cloud, puffs that billow out to the
// cloud's size in its first second, turn slowly and thin away at its end, thick enough that no one
// sees through it (and a core that fills the view from inside); and the molotov's fire, flames
// licking up all over its pool, embers, smoke, a glow on the ground and the scorch it leaves; put out
// early when a smoke lands on it. Each cloud and each fire is a draw call or three (instanced
// billboards); one light flickers for the blasts and the fires.
import * as THREE from 'three';
import { along, burning, CLOUD, FIRE, thickness, type Blaze, type Cloud, type Flight, type NadeEv } from '../game/nades.ts';
import { flashSprite } from './guns.ts';
import { mat } from './kit.ts';
import { LIGHT } from './look.ts';
import { weaponModel } from './models.ts';

// ---- Textures, drawn once ----

const textures = new Map<string, THREE.CanvasTexture>();
function canvas(key: string, size: number, draw: (g: CanvasRenderingContext2D, n: number) => void): THREE.CanvasTexture {
  let t = textures.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, t);
  return t;
}

// Seeded, so a cloud looks the same every time it's drawn.
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// A puff of smoke: a soft ball of cloudy blobs, white (tinted by its material).
const puffTex = () =>
  canvas('puff', 128, (g, n) => {
    const r = rng(7);
    for (let k = 0; k < 26; k++) {
      const a = r() * Math.PI * 2;
      const d = r() * n * 0.22;
      const x = n / 2 + Math.cos(a) * d;
      const y = n / 2 + Math.sin(a) * d;
      const s = n * (0.14 + r() * 0.16);
      const grad = g.createRadialGradient(x, y, 0, x, y, s);
      grad.addColorStop(0, `rgba(255,255,255,${0.32 + r() * 0.2})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, n, n);
    }
  });

// A flame seen side on: a teardrop, white at its root through yellow to red at its tip.
const flameTex = () =>
  canvas('flame', 64, (g, n) => {
    const grad = g.createLinearGradient(0, n, 0, 0);
    grad.addColorStop(0, 'rgba(255,240,200,1)');
    grad.addColorStop(0.35, 'rgba(255,190,70,0.95)');
    grad.addColorStop(0.7, 'rgba(240,90,20,0.6)');
    grad.addColorStop(1, 'rgba(150,30,10,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(n / 2, 0);
    g.bezierCurveTo(n * 0.95, n * 0.45, n * 0.9, n * 0.95, n / 2, n);
    g.bezierCurveTo(n * 0.1, n * 0.95, n * 0.05, n * 0.45, n / 2, 0);
    g.fill();
  });

// A soft round glow, for the light a fire throws on the ground and a blast's fireball.
const glowTex = () =>
  canvas('glow', 64, (g, n) => {
    const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, n, n);
  });

// A ring of dust thrown out along the ground.
const ringTex = () =>
  canvas('ring', 128, (g, n) => {
    const grad = g.createRadialGradient(n / 2, n / 2, n * 0.25, n / 2, n / 2, n / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, n, n);
  });

// The burn a fire leaves: black at its heart, ragged at its edge.
const scorchTex = () =>
  canvas('scorch', 128, (g, n) => {
    const r = rng(3);
    for (let k = 0; k < 30; k++) {
      const a = r() * Math.PI * 2;
      const d = r() * n * 0.28;
      const x = n / 2 + Math.cos(a) * d;
      const y = n / 2 + Math.sin(a) * d;
      const s = n * (0.12 + r() * 0.14);
      const grad = g.createRadialGradient(x, y, 0, x, y, s);
      grad.addColorStop(0, 'rgba(12,10,8,0.55)');
      grad.addColorStop(1, 'rgba(12,10,8,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, n, n);
    }
  });

// ---- Billboards: an instanced quad facing the camera, each with its own alpha and shade ----

const VERT = /* glsl */ `
attribute vec3 look; // alpha, shade, turn
varying vec2 vUv;
varying vec2 vLook;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vLook = look.xy;
  vec4 c = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  vec4 mvPosition = modelViewMatrix * c;
  float a = look.z;
  vec2 p = mat2(cos(a), sin(a), -sin(a), cos(a)) * (position.xy * size);
  mvPosition.xy += p;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 color;
uniform vec3 dark;
varying vec2 vUv;
varying vec2 vLook;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, vUv);
  float a = min(1.0, t.a * vLook.x * 1.5);
  if (a < 0.004) discard;
  // Shaded by its height in the cloud, and darker into the puff's middle.
  vec3 c = mix(dark, color, vLook.y) * t.rgb;
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// The smoke isn't lit by the scene's lights, so its colours are scaled to how bright the day's light
// makes a surface of their colour (render/look.ts): a cloud as pale in the sun as a white wall.
const LIT = LIGHT.sun * 0.45 + LIGHT.hemi * 1.2;
function billboardMaterial(map: THREE.Texture, color: string, dark: string, additive: boolean): THREE.ShaderMaterial {
  const k = additive ? 1 : LIT;
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, color: { value: new THREE.Color(color).multiplyScalar(k) }, dark: { value: new THREE.Color(dark).multiplyScalar(k) } }]),
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

let mats: { smoke: THREE.ShaderMaterial; soot: THREE.ShaderMaterial; fire: THREE.ShaderMaterial; fireball: THREE.ShaderMaterial } | null = null;
function materials() {
  if (mats) return mats;
  const m = {
    smoke: billboardMaterial(puffTex(), '#c9cbca', '#7d8183', false),
    soot: billboardMaterial(puffTex(), '#4a4644', '#262422', false),
    fire: billboardMaterial(flameTex(), '#ffffff', '#ffb070', true),
    fireball: billboardMaterial(puffTex(), '#ffd9a0', '#ff6a1a', true),
  };
  for (const k of Object.keys(m) as (keyof typeof m)[]) m[k].uniforms.map.value = k === 'fire' ? flameTex() : puffTex();
  return (mats = m);
}

// A set of n billboards: their places and sizes in its matrices, their alpha, shade and turn in `look`.
class Board {
  mesh: THREE.InstancedMesh;
  look: Float32Array;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private z = new THREE.Vector3();
  constructor(n: number, material: THREE.Material, quad: 'centre' | 'foot' = 'centre') {
    const g = new THREE.PlaneGeometry(1, 1);
    if (quad === 'foot') g.translate(0, 0.5, 0);
    this.look = new Float32Array(n * 3);
    g.setAttribute('look', new THREE.InstancedBufferAttribute(this.look, 3));
    this.mesh = new THREE.InstancedMesh(g, material, n);
    this.mesh.frustumCulled = false;
  }
  set(k: number, p: THREE.Vector3Like, w: number, h: number, alpha: number, shade: number, turn: number): void {
    this.m.compose(this.s.set(p.x, p.y, p.z), this.q, this.z.set(w, h, 1));
    this.mesh.setMatrixAt(k, this.m);
    this.look[k * 3] = alpha;
    this.look[k * 3 + 1] = shade;
    this.look[k * 3 + 2] = turn;
  }
  done(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    (this.mesh.geometry.attributes.look as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}

// ---- Specks: sparks, bits and embers, as points ----

class Specks {
  points: THREE.Points;
  pos: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  constructor(n: number, color: string, size: number, additive: boolean) {
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color, size, map: glowTex(), transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: !additive }),
    );
    this.points.frustumCulled = false;
  }
  // Each a frame on: falling (g, m/s²), slowed by the air; gone ones put far away.
  step(dt: number, g: number, drag = 0.4): void {
    const n = this.life.length;
    for (let k = 0; k < n; k++) {
      this.life[k] -= dt;
      if (this.life[k] <= 0) {
        this.pos[k * 3 + 1] = -1e5;
        continue;
      }
      const f = Math.exp(-drag * dt);
      this.vel[k * 3] *= f;
      this.vel[k * 3 + 1] = this.vel[k * 3 + 1] * f - g * dt;
      this.vel[k * 3 + 2] *= f;
      for (let j = 0; j < 3; j++) this.pos[k * 3 + j] += this.vel[k * 3 + j] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

function decal(tex: THREE.Texture, size: number, additive: boolean): THREE.Mesh {
  const g = new THREE.PlaneGeometry(size, size);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: !additive }),
  );
  m.renderOrder = -2;
  return m;
}

// ---- What's going on ----

interface Flying {
  obj: THREE.Object3D;
  fl: Flight;
  spin: THREE.Vector3;
  flame: THREE.Sprite | null;
}

interface Blast {
  he: boolean;
  p: THREE.Vector3;
  age: number;
  flash: THREE.Sprite;
  ball: Board | null;
  soot: Board | null;
  ring: THREE.Mesh | null;
  sparks: Specks;
  bits: Specks | null;
  seeds: Float32Array;
}

interface Smoke {
  c: Cloud;
  puffs: Board;
  core: THREE.Mesh;
  // Each puff: where it goes (from the cloud's foot), its size, its speed round, its seed.
  at: Float32Array;
  order: Uint16Array;
}

interface Fire {
  b: Blaze;
  flames: Board;
  soot: Board;
  glow: THREE.Mesh;
  scorch: THREE.Mesh;
  embers: Specks;
  // Each flame: where it stands, its age in its life (0..1), how long it lives, how tall.
  f: Float32Array;
  left: number; // seconds the scorch stays once the fire's out
  r: () => number;
}

const PUFFS = 100;
const FLAMES = 44;

export class NadesView {
  readonly group = new THREE.Group();
  private flying: Flying[] = [];
  private blasts: Blast[] = [];
  private smokes: Smoke[] = [];
  private fires: Fire[] = [];
  private light = new THREE.PointLight('#ffa040', 0, 14, 2);
  private flare = 0;
  private flareColour = new THREE.Color();
  private t = 0;
  private cam = new THREE.Vector3();
  private v = new THREE.Vector3();

  constructor() {
    // The one light, always there (a light added or taken away would recompile every material in the
    // city), dark till a blast or a fire.
    this.group.add(this.light);
  }

  // A grenade thrown: drawn along its flight till it goes off, turning over; a molotov's rag alight.
  add(ev: NadeEv, fl: Flight): void {
    const m = weaponModel(ev.w);
    let obj: THREE.Object3D;
    if (m) {
      obj = new THREE.Mesh(m.still, m.material);
    } else {
      const colour = ev.w === 'he' ? '#3d4130' : ev.w === 'flash' ? '#8a9096' : ev.w === 'smoke' ? '#5b6b5a' : '#6b3b1c';
      obj = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), mat(colour, { roughness: 0.6 }));
    }
    obj.castShadow = true;
    const holder = new THREE.Group();
    holder.add(obj);
    let flame: THREE.Sprite | null = null;
    if (ev.w === 'molotov') {
      flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      flame.scale.set(0.14, 0.24, 1);
      this.group.add(flame);
    }
    this.group.add(holder);
    const r = Math.random;
    this.flying.push({ obj: holder, fl, spin: new THREE.Vector3(6 + r() * 6, r() * 4, 3 + r() * 5), flame });
  }

  // The HE grenade's blast or the flash's burst at p.
  boom(w: 'he' | 'flash', p: THREE.Vector3Like): void {
    const he = w === 'he';
    const at = new THREE.Vector3(p.x, p.y + 0.15, p.z);
    const flash = flashSprite(he ? 5 : 7);
    flash.position.copy(at);
    flash.visible = true;
    if (!he) flash.material.color.set('#e8f0ff');
    this.group.add(flash);
    const sparks = new Specks(he ? 70 : 26, he ? '#ffc060' : '#ffffff', he ? 0.09 : 0.07, true);
    const r = Math.random;
    for (let k = 0; k < sparks.life.length; k++) {
      const a = r() * Math.PI * 2;
      const up = he ? 0.2 + r() * 0.9 : r() * 2 - 1;
      const s = he ? 7 + r() * 11 : 2 + r() * 4;
      const h = Math.sqrt(Math.max(0, 1 - up * up));
      sparks.pos.set([at.x, at.y, at.z], k * 3);
      sparks.vel.set([Math.cos(a) * h * s, up * s, Math.sin(a) * h * s], k * 3);
      sparks.life[k] = he ? 0.4 + r() * 0.7 : 0.15 + r() * 0.3;
    }
    this.group.add(sparks.points);
    let ball: Board | null = null;
    let soot: Board | null = null;
    let ring: THREE.Mesh | null = null;
    let bits: Specks | null = null;
    const seeds = new Float32Array(24 * 4);
    for (let k = 0; k < seeds.length; k++) seeds[k] = r();
    if (he) {
      const m = materials();
      ball = new Board(10, m.fireball);
      soot = new Board(14, m.soot);
      this.group.add(soot.mesh, ball.mesh);
      ring = decal(ringTex(), 1, false);
      (ring.material as THREE.MeshBasicMaterial).color.set('#b3a58c');
      ring.position.set(at.x, p.y + 0.03, at.z);
      this.group.add(ring);
      bits = new Specks(26, '#2b2622', 0.07, false);
      for (let k = 0; k < bits.life.length; k++) {
        const a = r() * Math.PI * 2;
        const s = 4 + r() * 7;
        bits.pos.set([at.x, at.y, at.z], k * 3);
        bits.vel.set([Math.cos(a) * s * 0.7, 3 + r() * 6, Math.sin(a) * s * 0.7], k * 3);
        bits.life[k] = 0.8 + r() * 0.8;
      }
      this.group.add(bits.points);
    }
    this.blasts.push({ he, p: at, age: 0, flash, ball, soot, ring, sparks, bits, seeds });
    this.lightUp(at, he ? 60 : 90, he ? '#ffab4a' : '#e6f0ff');
  }

  private lightUp(p: THREE.Vector3, k: number, colour: string): void {
    if (k < this.flare) return;
    this.flare = k;
    this.flareColour.set(colour);
    this.light.position.copy(p).add(new THREE.Vector3(0, 0.8, 0));
  }

  // A smoke grenade's cloud.
  cloud(c: Cloud): void {
    const r = rng(Math.floor(c.x * 131 + c.z * 71 + c.t0));
    const puffs = new Board(PUFFS, materials().smoke);
    const at = new Float32Array(PUFFS * 6);
    for (let k = 0; k < PUFFS; k++) {
      // A place in the cloud's squashed ball, more of them low and towards the middle.
      const a = r() * Math.PI * 2;
      const d = Math.pow(r(), 0.6) * CLOUD.r * 0.86;
      const y = 0.4 + Math.pow(r(), 1.1) * (CLOUD.h - 0.5) * Math.sqrt(Math.max(0.2, 1 - (d / CLOUD.r) ** 2));
      at.set([Math.cos(a) * d, y, Math.sin(a) * d, 1.9 + r() * 1.4, (0.02 + r() * 0.05) * (r() < 0.5 ? -1 : 1), r()], k * 6);
    }
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#a9acab').multiplyScalar(LIT), transparent: true, depthWrite: false, side: THREE.BackSide, fog: true }),
    );
    core.scale.set(CLOUD.r * 0.68, CLOUD.h * 0.42, CLOUD.r * 0.68);
    core.position.set(c.x, c.y + CLOUD.h * 0.45, c.z);
    core.renderOrder = -1;
    this.group.add(core, puffs.mesh);
    this.smokes.push({ c, puffs, core, at, order: new Uint16Array(PUFFS).map((_, k) => k) });
  }

  // A molotov's fire.
  blaze(b: Blaze): void {
    const m = materials();
    const flames = new Board(FLAMES, m.fire, 'foot');
    const soot = new Board(10, m.soot);
    const glow = decal(glowTex(), FIRE.r * 3.2, true);
    (glow.material as THREE.MeshBasicMaterial).color.set('#ff7a2a');
    glow.position.set(b.x, b.y + 0.04, b.z);
    const scorch = decal(scorchTex(), FIRE.r * 2.6, false);
    scorch.position.set(b.x, b.y + 0.03, b.z);
    const embers = new Specks(40, '#ffae4a', 0.05, true);
    this.group.add(scorch, glow, soot.mesh, flames.mesh, embers.points);
    const r = rng(Math.floor(b.x * 97 + b.z * 53 + b.t0));
    const f = new Float32Array(FLAMES * 5);
    for (let k = 0; k < FLAMES; k++) f.set([0, 0, r(), 0.45 + r() * 0.5, 0.5 + r() * 0.7], k * 5);
    for (let k = 0; k < FLAMES; k++) this.place(f, k, b, r);
    this.fires.push({ b, flames, soot, glow, scorch, embers, f, left: 12, r });
  }

  // A flame somewhere new on the pool.
  private place(f: Float32Array, k: number, b: Blaze, r: () => number): void {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * FIRE.r * 0.92;
    f[k * 5] = b.x + Math.cos(a) * d;
    f[k * 5 + 1] = b.z + Math.sin(a) * d;
    // Smaller at the edge.
    f[k * 5 + 4] = (0.7 + r() * 0.9) * (1 - 0.4 * (d / FIRE.r));
  }

  // A frame on, at round ms t.
  update(t: number, dt: number, camera: THREE.Camera): void {
    this.t += dt;
    camera.getWorldPosition(this.cam);
    // The grenades in the air.
    this.flying = this.flying.filter((f) => {
      if (t >= f.fl.at.t) {
        f.obj.removeFromParent();
        f.flame?.removeFromParent();
        return false;
      }
      const p = along(f.fl, t);
      f.obj.position.set(p.x, p.y, p.z);
      f.obj.rotation.x += dt * f.spin.x;
      f.obj.rotation.y += dt * f.spin.y;
      f.obj.rotation.z += dt * f.spin.z;
      if (f.flame) {
        f.flame.position.set(p.x, p.y + 0.12, p.z);
        f.flame.material.rotation = Math.sin(this.t * 20) * 0.3;
      }
      return true;
    });

    // The blasts.
    this.blasts = this.blasts.filter((b) => {
      b.age += dt;
      const a = b.age;
      const k = Math.max(0, 1 - a / (b.he ? 0.22 : 0.16));
      b.flash.visible = k > 0;
      b.flash.material.opacity = k;
      b.flash.scale.setScalar((b.he ? 5 : 7) * (1.1 - 0.5 * k));
      b.sparks.step(dt, b.he ? 9 : 2, b.he ? 1.2 : 3);
      b.bits?.step(dt, 12, 0.6);
      if (b.ball) {
        // The fireball: up to its size in a tenth of a second, burning out by half a second.
        const grow = Math.min(1, a / 0.12);
        const fade = Math.max(0, 1 - a / 0.55);
        for (let i = 0; i < 10; i++) {
          const s = b.seeds;
          this.v.set(b.p.x + (s[i * 4] - 0.5) * 1.6 * grow, b.p.y + 0.3 + s[i * 4 + 1] * 1.2 * grow + a * 1.2, b.p.z + (s[i * 4 + 2] - 0.5) * 1.6 * grow);
          const sz = (1.2 + s[i * 4 + 3] * 1.4) * (0.4 + 0.6 * grow);
          b.ball.set(i, this.v, sz, sz, fade * fade, 0.3 + 0.7 * fade, s[i * 4] * 6);
        }
        b.ball.done();
      }
      if (b.soot) {
        // Its smoke, rising and spreading over three seconds.
        const k2 = Math.min(1, a / 3.2);
        for (let i = 0; i < 14; i++) {
          const s = b.seeds;
          const j = (i + 10) % 24;
          this.v.set(b.p.x + (s[j * 4] - 0.5) * (1.4 + 2.5 * k2), b.p.y + 0.4 + s[j * 4 + 1] * 1.2 + k2 * (1.5 + s[j * 4 + 2] * 2), b.p.z + (s[j * 4 + 2] - 0.5) * (1.4 + 2.5 * k2));
          const sz = 1.4 + 2.2 * k2 + s[j * 4 + 3];
          b.soot.set(i, this.v, sz, sz, 0.75 * Math.min(1, a / 0.25) * (1 - k2), 0.5, s[j * 4] * 6 + a * 0.2);
        }
        b.soot.done();
      }
      if (b.ring) {
        const k3 = Math.min(1, a / 0.7);
        b.ring.scale.setScalar(1 + 11 * (1 - (1 - k3) ** 3));
        (b.ring.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - k3);
      }
      if (a < (b.he ? 3.4 : 0.6)) return true;
      b.flash.removeFromParent();
      b.flash.material.dispose();
      b.sparks.dispose();
      b.bits?.dispose();
      b.ball?.dispose();
      b.soot?.dispose();
      if (b.ring) {
        b.ring.removeFromParent();
        b.ring.geometry.dispose();
        (b.ring.material as THREE.Material).dispose();
      }
      return false;
    });

    // The clouds.
    this.smokes = this.smokes.filter((s) => {
      const age = t - s.c.t0;
      const k = thickness(s.c, t);
      // Billowing out in its first second, a little further as it thins.
      const grow = 1 - Math.pow(1 - Math.min(1, age / (CLOUD.grow * 1.2)), 3);
      const out = 1 + 0.18 * Math.max(0, 1 - (CLOUD.last - age) / CLOUD.thin);
      const sec = age / 1000;
      const n = PUFFS;
      const A = s.at;
      // Back to front from the camera, for blending.
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const sp = A[i * 6 + 4] * sec;
        const c = Math.cos(sp);
        const sn = Math.sin(sp);
        const x = (A[i * 6] * c - A[i * 6 + 2] * sn) * grow * out;
        const z = (A[i * 6] * sn + A[i * 6 + 2] * c) * grow * out;
        const y = 0.3 + (A[i * 6 + 1] - 0.3) * (0.35 + 0.65 * grow) + Math.sin(sec * 0.5 + A[i * 6 + 5] * 6) * 0.08;
        const px = s.c.x + x;
        const py = s.c.y + y;
        const pz = s.c.z + z;
        d[i] = (px - this.cam.x) ** 2 + (py - this.cam.y) ** 2 + (pz - this.cam.z) ** 2;
        // Each puff goes in its own moment as the cloud thins: the cloud breaks up, not just fades.
        const alpha = Math.min(1, Math.max(0, k * 1.6 - A[i * 6 + 5] * 0.6));
        const shade = Math.min(1, 0.45 + y / CLOUD.h);
        const sz = A[i * 6 + 3] * (0.45 + 0.55 * grow) * out;
        this.v.set(px, py, pz);
        s.puffs.set(i, this.v, sz, sz, alpha, shade, A[i * 6 + 5] * 6 + sec * A[i * 6 + 4] * 2);
      }
      // Drawn far to near: the matrices put in that order.
      const order = Array.from(s.order).sort((a, b) => d[b] - d[a]);
      const mats = new Float32Array(s.puffs.mesh.instanceMatrix.array as Float32Array);
      const look = s.puffs.look.slice();
      order.forEach((from, to) => {
        (s.puffs.mesh.instanceMatrix.array as Float32Array).set(mats.subarray(from * 16, from * 16 + 16), to * 16);
        s.puffs.look.set(look.subarray(from * 3, from * 3 + 3), to * 3);
      });
      s.puffs.done();
      (s.core.material as THREE.MeshBasicMaterial).opacity = Math.pow(k, 1.5) * 0.97 * grow;
      s.core.scale.set(CLOUD.r * 0.68 * grow * out, CLOUD.h * 0.42 * (0.4 + 0.6 * grow), CLOUD.r * 0.68 * grow * out);
      if (age < CLOUD.last) return true;
      s.puffs.dispose();
      s.core.removeFromParent();
      s.core.geometry.dispose();
      (s.core.material as THREE.Material).dispose();
      return false;
    });

    // The fires.
    let hot = 0;
    let hotAt: Fire | null = null;
    this.fires = this.fires.filter((f) => {
      const on = burning(f.b, t);
      const end = Math.min(f.b.out, f.b.t0 + FIRE.last);
      // Dying down over its last half second, or put out in a third of one.
      const k = t < f.b.t0 ? 0 : on ? Math.min(1, (t - f.b.t0) / 250, (end - t) / 500) : 0;
      const F = f.f;
      for (let i = 0; i < FLAMES; i++) {
        F[i * 5 + 2] += dt / F[i * 5 + 3];
        if (F[i * 5 + 2] >= 1) {
          F[i * 5 + 2] -= 1;
          this.place(F, i, f.b, f.r);
        }
        const life = F[i * 5 + 2];
        const h = F[i * 5 + 4] * (0.6 + 0.8 * Math.sin(Math.PI * life)) * k;
        const w = h * (0.8 - 0.25 * life);
        this.v.set(F[i * 5], f.b.y + 0.02 + life * 0.25, F[i * 5 + 1]);
        f.flames.set(i, this.v, w, h, Math.sin(Math.PI * life) * k, 0.6 + 0.4 * (1 - life), Math.sin(this.t * 7 + i) * 0.12);
      }
      f.flames.done();
      for (let i = 0; i < 10; i++) {
        const life = (this.t * 0.35 + i / 10) % 1;
        const r0 = (i * 0.618) % 1;
        this.v.set(f.b.x + (r0 - 0.5) * FIRE.r * 0.9, f.b.y + 0.8 + life * 3.5, f.b.z + (((i * 0.382) % 1) - 0.5) * FIRE.r * 0.9);
        const sz = 1 + life * 2.2;
        f.soot.set(i, this.v, sz, sz, 0.45 * Math.sin(Math.PI * life) * k, 0.4, r0 * 6 + this.t * 0.3);
      }
      f.soot.done();
      // Embers: thrown up now and then, drifting.
      for (let i = 0; i < f.embers.life.length; i++) {
        if (f.embers.life[i] > 0 || !on || f.r() > dt * 4) continue;
        const a = f.r() * Math.PI * 2;
        const d = Math.sqrt(f.r()) * FIRE.r * 0.9;
        f.embers.pos.set([f.b.x + Math.cos(a) * d, f.b.y + 0.3, f.b.z + Math.sin(a) * d], i * 3);
        f.embers.vel.set([(f.r() - 0.5) * 0.8, 1.5 + f.r() * 2, (f.r() - 0.5) * 0.8], i * 3);
        f.embers.life[i] = 0.8 + f.r() * 1.2;
      }
      f.embers.step(dt, -0.2, 0.8);
      const flicker = 0.75 + 0.25 * Math.sin(this.t * 17) * Math.sin(this.t * 6.3 + 1);
      (f.glow.material as THREE.MeshBasicMaterial).opacity = 0.55 * k * flicker;
      if (k * flicker > hot) {
        hot = k * flicker;
        hotAt = f;
      }
      if (on || t < f.b.t0) return true;
      // Out: the scorch stays a while, fading.
      f.left -= dt;
      (f.scorch.material as THREE.MeshBasicMaterial).opacity = Math.min(1, f.left / 3);
      if (f.left > 0) return true;
      f.flames.dispose();
      f.soot.dispose();
      f.embers.dispose();
      for (const m of [f.glow, f.scorch]) {
        m.removeFromParent();
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      return false;
    });

    // The light: a blast's flare dying away, else the hottest fire's flicker.
    this.flare = Math.max(0, this.flare - dt * 260);
    if (this.flare > 0) {
      this.light.intensity = this.flare;
      this.light.color.copy(this.flareColour);
      this.light.distance = 18;
    } else if (hotAt) {
      const f = hotAt as Fire;
      this.light.position.set(f.b.x, f.b.y + 1, f.b.z);
      this.light.color.set('#ff8a2a');
      this.light.intensity = 9 * hot;
      this.light.distance = 10;
    } else this.light.intensity = 0;
  }

  clear(): void {
    for (const f of this.flying) {
      f.obj.removeFromParent();
      f.flame?.removeFromParent();
    }
    this.flying = [];
    for (const b of this.blasts) {
      b.flash.removeFromParent();
      b.sparks.dispose();
      b.bits?.dispose();
      b.ball?.dispose();
      b.soot?.dispose();
      b.ring?.removeFromParent();
    }
    this.blasts = [];
    for (const s of this.smokes) {
      s.puffs.dispose();
      s.core.removeFromParent();
    }
    this.smokes = [];
    for (const f of this.fires) {
      f.flames.dispose();
      f.soot.dispose();
      f.embers.dispose();
      f.glow.removeFromParent();
      f.scorch.removeFromParent();
    }
    this.fires = [];
    this.flare = 0;
    this.light.intensity = 0;
  }
}
