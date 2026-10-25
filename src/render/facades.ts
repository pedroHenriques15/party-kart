// The buildings' facades (braga-map's task 017): each building drawn as the map says it is, its kind's
// windows in their real proportions (map().facadeTypes), its walls of their material in their colour,
// its ground floor along a street as it is (shops, garages, an arcade), its shutters' colour, and its
// balconies. Every texture is drawn here on a canvas, in metres, and the walls take them in one
// shader: a kind's bay (a window and the wall round it, one storey high) repeated along each wall and
// up it, over its material's surface tiled at its real size, each part tinted with the building's own
// colours (the walls', the ground floor's, the shutters').
import type { Facade, FacadeMaterial, FacadeOpening, FacadeProportions, FacadeType } from 'braga-map';
import * as THREE from 'three';
import { anisotropy, type Quality } from './look.ts';
import { fillBox, fillHalfDisc, normalsOf } from './relief.ts';

// How a building's walls are laid out, shared with the simulation (the rooms' openings).
export { baysOf, storeys } from '../world/storeys.ts';
import { layoutPieces } from '../world/storeys.ts';

export const TYPES: FacadeType[] = ['old-house', 'house', 'block-1950s', 'block-1970s-90s', 'block-2000s', 'glass-office', 'civic', 'church', 'commercial', 'warehouse', 'annex'];
export const MATERIALS: FacadeMaterial[] = ['render', 'tiles', 'mosaic', 'azulejo', 'granite', 'stone', 'brick', 'concrete', 'block', 'glass', 'metal', 'panels'];
// The ground floors drawn as their own (the rest are their kind's storeys, or plain wall).
const GROUNDS: Facade['ground'][] = ['shops', 'garages', 'arcade', 'glazed'];
// A layer of the openings: each kind's storey, then each ground floor's.
export const layerOfType = (t: FacadeType) => TYPES.indexOf(t);
export const layerOfGround = (g: Facade['ground']) => (GROUNDS.includes(g) ? TYPES.length + GROUNDS.indexOf(g) : -1);
const DOOR = TYPES.length + GROUNDS.length;
// How many metres each material's surface spans before it repeats.
const SPAN: Record<FacadeMaterial, number> = { render: 3, tiles: 1.2, mosaic: 0.8, azulejo: 0.84, granite: 2.4, stone: 2.4, brick: 1, concrete: 3, block: 1.6, glass: 3, metal: 2, panels: 2.4 };

// Each bay's and each surface's pixels a side: 256, 512 on Ultra (braga-map's task 123), or 128 on Low;
// and on Ultra the bays in relief too (facadeKit sets them).
let N = 256;
let RELIEF = false;

// How far a bay's parts stand out of its wall (into it, negative), in metres, for its relief on Ultra: a
// window's frame set in its reveal and its glass behind, a sill and a stone frame standing out.
const FRAME = -0.1;
const GLASS = -0.14;
const STONE = 0.04;
const SILL = 0.06;

// A drawing of one bay, w × h metres, as two canvases: its colours, and what each pixel is (black the
// wall, which shows the material in the building's colour; grey a shutter, its slats in the shutters'
// colour; white anything else, as drawn: a pane of glass too). On Ultra, how far each pixel stands out of
// the wall, for its relief (relief.ts; a part drawn without a depth leaves it as it was), and where its
// panes are (1), for a pane's reflections (task 117).
class Bay {
  c = document.createElement('canvas');
  m = document.createElement('canvas');
  z: Float32Array | null = RELIEF ? new Float32Array(N * N) : null;
  q: Float32Array | null = RELIEF ? new Float32Array(N * N) : null;
  g: CanvasRenderingContext2D;
  k: CanvasRenderingContext2D;
  w: number;
  h: number;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    for (const c of [this.c, this.m]) c.width = c.height = N;
    this.g = this.c.getContext('2d', { willReadFrequently: true })!;
    this.k = this.m.getContext('2d', { willReadFrequently: true })!;
    this.k.fillStyle = '#000';
    this.k.fillRect(0, 0, N, N);
  }
  // A box x0..x0 + w across and y0..y0 + h up from the floor, in metres.
  px(x: number, y: number, w: number, h: number): [number, number, number, number] {
    const sx = N / this.w;
    const sy = N / this.h;
    return [x * sx, N - (y + h) * sy, w * sx, h * sy];
  }
  rect(x: number, y: number, w: number, h: number, colour: string, what: 'open' | 'glass' | 'shutter' | 'wall' = 'open', depth?: number): void {
    const r = this.px(x, y, w, h);
    this.g.fillStyle = colour;
    this.g.fillRect(...r);
    this.k.fillStyle = what === 'open' || what === 'glass' ? '#fff' : what === 'shutter' ? '#808080' : '#000';
    this.k.fillRect(...r);
    if (this.z && depth !== undefined) fillBox(this.z, N, ...r, depth);
    if (this.q) fillBox(this.q, N, ...r, what === 'glass' ? 1 : 0);
  }
  // A half disc r metres across over (x, y), as drawn (an arch's head).
  arch(x: number, y: number, r: number, colour: string, what: 'open' | 'glass' = 'open', depth?: number): void {
    const sx = N / this.w;
    const sy = N / this.h;
    for (const [g, c] of [[this.g, colour], [this.k, '#fff']] as const) {
      g.fillStyle = c;
      g.beginPath();
      g.ellipse(x * sx, N - y * sy, r * sx, r * sy, 0, Math.PI, 0);
      g.fill();
    }
    if (this.z && depth !== undefined) fillHalfDisc(this.z, N, x * sx, N - y * sy, r * sx, r * sy, depth);
    if (this.q) fillHalfDisc(this.q, N, x * sx, N - y * sy, r * sx, r * sy, what === 'glass' ? 1 : 0);
  }
  // Lines of a colour over what's there, not changing what it is; with a depth, standing as a frame's (no
  // pane there).
  lines(x: number, y: number, w: number, h: number, colour: string, n: number, across: boolean, width = 0.03, depth?: number): void {
    this.g.fillStyle = colour;
    for (let i = 1; i < n; i++) {
      const r = across ? this.px(x, y + (h * i) / n - width / 2, w, width) : this.px(x + (w * i) / n - width / 2, y, width, h);
      this.g.fillRect(...r);
      if (this.z && depth !== undefined) fillBox(this.z, N, ...r, depth);
      if (this.q && depth !== undefined) fillBox(this.q, N, ...r, 0);
    }
  }
  // A window w × h, its sill at y, in the middle of the bay: its frame and glass, a box over it for a
  // roller shutter (`box`), and that shutter down `down` of the way. In relief, the frame set in its
  // reveal, the glass behind it, a stone frame standing out, the shutter's slats.
  window(w: number, h: number, y: number, o: { frame?: string; box?: boolean; down?: number; leaves?: number; stone?: number; glass?: string } = {}): void {
    const x = (this.w - w) / 2;
    const frame = o.frame ?? '#e8e6e0';
    if (o.stone) this.rect(x - o.stone, y - o.stone, w + 2 * o.stone, h + 2 * o.stone + (o.box ? 0.22 : 0), '#bdb5a6', 'open', STONE);
    this.rect(x, y, w, h, frame, 'open', FRAME);
    this.rect(x + 0.05, y + 0.05, w - 0.1, h - 0.1, o.glass ?? '#2c3846', 'glass', GLASS);
    // The sky in the glass, lighter at its top.
    const r = this.px(x + 0.05, y + 0.05, w - 0.1, h - 0.1);
    const grad = this.g.createLinearGradient(0, r[1], 0, r[1] + r[3]);
    grad.addColorStop(0, 'rgba(170,190,210,0.35)');
    grad.addColorStop(0.6, 'rgba(120,140,160,0.08)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    this.g.fillStyle = grad;
    this.g.fillRect(...r);
    if (o.leaves) this.lines(x, y, w, h, frame, o.leaves, false, 0.05, FRAME);
    if (o.box) this.rect(x - 0.03, y + h, w + 0.06, 0.22, '#d8d5ce', 'shutter', -0.01);
    if (o.down) {
      const d = h * o.down;
      this.rect(x + 0.04, y + h - d, w - 0.08, d, '#d8d5ce', 'shutter', FRAME + 0.02);
      this.lines(x + 0.04, y + h - d, w - 0.08, d, 'rgba(0,0,0,0.18)', Math.round(d / 0.06), true, 0.012, FRAME + 0.01);
    }
  }
  // Its relief as normals (relief.ts), its edges softened over 3 cm (a reveal's side as it's seen at an
  // angle, so it reads past a pixel or two 20 m off), its panes in their alpha, as rgba() lays the bay out.
  normals(): Uint8Array {
    return normalsOf(this.z!, N, this.w / N, this.h / N, 0.03, this.q!);
  }
  // The bay as RGBA, row 0 its bottom (as a texture's v runs up), the alpha what each pixel is.
  rgba(): Uint8Array {
    const c = this.g.getImageData(0, 0, N, N).data;
    const m = this.k.getImageData(0, 0, N, N).data;
    const out = new Uint8Array(N * N * 4);
    for (let r = 0; r < N; r++) {
      for (let i = 0; i < N; i++) {
        const s = (r * N + i) * 4;
        const d = ((N - 1 - r) * N + i) * 4;
        out[d] = c[s];
        out[d + 1] = c[s + 1];
        out[d + 2] = c[s + 2];
        out[d + 3] = m[s];
      }
    }
    return out;
  }
}

// Each kind's storey, one bay of it, in its proportions.
function storeyOf(type: FacadeType, p: FacadeProportions): Bay {
  const b = new Bay(p.bay, p.storey);
  const [w, h] = p.win;
  switch (type) {
    case 'old-house':
      // A tall window in a frame of dressed granite, a lintel over it, two wooden leaves.
      b.window(w, h, p.sill, { frame: '#efece4', leaves: 2, stone: 0.18 });
      b.rect((p.bay - w) / 2 - 0.28, p.sill + h + 0.18, w + 0.56, 0.12, '#aea595', 'open', SILL);
      break;
    case 'house':
      b.rect((p.bay - w) / 2 - 0.06, p.sill - 0.06, w + 0.12, 0.06, '#c9c3b6', 'open', SILL);
      b.window(w, h, p.sill, { box: true, down: 0.35, leaves: 2 });
      break;
    case 'block-1950s':
      b.window(w, h, p.sill, { box: true, down: 0.3, leaves: 2, frame: '#dedbd3' });
      b.rect((p.bay - w) / 2 - 0.05, p.sill - 0.07, w + 0.1, 0.07, '#bdb6a8', 'open', SILL);
      break;
    case 'block-1970s-90s':
      b.window(w, h, p.sill, { box: true, down: 0.4, leaves: 2, frame: '#e6e6e2' });
      b.rect((p.bay - w) / 2 - 0.05, p.sill - 0.06, w + 0.1, 0.06, '#c4beb2', 'open', SILL);
      break;
    case 'block-2000s':
      // Floor to ceiling, a thin dark frame, a slab's edge under it.
      b.window(w, h, p.sill, { frame: '#3c3f44', leaves: 3, glass: '#34404c' });
      break;
    case 'glass-office': {
      // All glass: the floor's spandrel darker and set back, mullions every bay standing out.
      b.rect(0, 0, p.bay, p.storey, '#3f5568', 'glass', 0);
      b.rect(0, 0, p.bay, 0.45, '#2b3a47', 'open', -0.02);
      b.rect(0, 0, 0.06, p.storey, '#8d96a0', 'open', 0.05);
      b.lines(0, 0, p.bay, p.storey, 'rgba(200,215,230,0.12)', 3, true, 0.4);
      break;
    }
    case 'civic':
      b.window(w, h, p.sill, { frame: '#d9d7d2', leaves: 3 });
      break;
    case 'church': {
      // A tall window with a round head, in a frame of dressed granite, deep in the wall.
      const x = (p.bay - w) / 2;
      const spring = p.sill + h - w / 2;
      b.rect(x - 0.2, p.sill - 0.2, w + 0.4, h - w / 2 + 0.2, '#b4ac9c', 'open', STONE);
      b.arch(p.bay / 2, spring, w / 2 + 0.2, '#b4ac9c', 'open', STONE);
      b.rect(x, p.sill, w, h - w / 2, '#2a3240', 'glass', -0.25);
      b.arch(p.bay / 2, spring, w / 2, '#2a3240', 'glass', -0.25);
      break;
    }
    case 'commercial':
      // Mostly blank: a band of high windows.
      b.window(w, 0.9, p.storey - 1.5, { frame: '#9aa0a6', leaves: 2 });
      break;
    case 'warehouse':
      b.window(w, h, p.sill, { frame: '#8f959b', leaves: 3, glass: '#4a5560' });
      break;
    case 'annex':
      b.window(w, h, p.sill, { frame: '#d8d5ce' });
      break;
  }
  return b;
}

// The ground floors along a street, for a bay 3.4 m wide and a floor 3.6 m high; and a front door, in
// a frame of stone, with a fanlight over it.
function groundOf(g: Facade['ground'] | 'door'): Bay {
  const W = 3.4;
  const H = 3.6;
  const b = new Bay(W, H);
  const pillar = 0.45;
  switch (g) {
    case 'door':
      b.rect(W / 2 - 0.75, 0, 1.5, 2.75, '#b9b2a4', 'open', STONE);
      b.rect(W / 2 - 0.6, 0, 1.2, 2.25, '#4a3a2c', 'open', -0.18);
      b.rect(W / 2 - 0.52, 0.08, 0.46, 2.1, '#5a4634', 'open', -0.15);
      b.rect(W / 2 + 0.06, 0.08, 0.46, 2.1, '#5a4634', 'open', -0.15);
      b.rect(W / 2 - 0.6, 2.3, 1.2, 0.38, '#2c3846', 'glass', -0.2);
      break;
    case 'shops': {
      // A shop window from a low sill to a fascia, a door at one side, between pillars of the base.
      b.rect(pillar, 0.25, W - 2 * pillar, 2.55, '#5d6670', 'open', -0.06);
      b.rect(pillar + 0.06, 0.31, W - 2 * pillar - 0.12, 2.43, '#27303a', 'glass', -0.1);
      const r = b.px(pillar + 0.06, 0.31, W - 2 * pillar - 0.12, 2.43);
      const grad = b.g.createLinearGradient(0, r[1], 0, r[1] + r[3]);
      grad.addColorStop(0, 'rgba(190,205,220,0.35)');
      grad.addColorStop(1, 'rgba(255,230,190,0.12)');
      b.g.fillStyle = grad;
      b.g.fillRect(...r);
      b.lines(pillar, 0.25, W - 2 * pillar, 2.55, '#5d6670', 3, false, 0.06, -0.06);
      b.rect(pillar, 0, 0.95, 0.25, '#5d6670', 'open', -0.06);
      break;
    }
    case 'garages':
      b.rect(0.4, 0, W - 0.8, 2.4, '#d0ccc4', 'shutter', -0.12);
      b.lines(0.4, 0, W - 0.8, 2.4, 'rgba(0,0,0,0.2)', 14, true, 0.02, -0.13);
      break;
    case 'arcade':
      // Set back behind pillars: the shade under the floor above, a shop's glass in it.
      b.rect(pillar, 0, W - 2 * pillar, H - 0.35, '#3a3d40', 'open', -0.8);
      b.rect(pillar + 0.3, 0.2, W - 2 * pillar - 0.6, 2.3, '#252c34', 'glass', -0.9);
      break;
    case 'glazed':
      b.rect(0, 0, W, H - 0.3, '#4a5a68', 'open', -0.04);
      b.rect(0.05, 0.05, W - 0.1, H - 0.4, '#2c3946', 'glass', -0.08);
      b.lines(0, 0, W, H - 0.3, '#4a5a68', 2, false, 0.06, -0.04);
      break;
  }
  return b;
}

// Each material's surface, near white, to be tinted: tileable, `SPAN` metres a side.
function surfaceOf(m: FacadeMaterial): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const s = N / SPAN[m];
  // Its marks drawn a pixel or two across (a speckle, a joint) as big in metres at Ultra's 512 as at 256.
  const K = Math.max(1, N / 256);
  let seed = MATERIALS.indexOf(m) * 7919 + 13;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const speckle = (n: number, a: number, size = 2) => {
    for (let i = 0; i < n; i++) {
      const v = Math.floor(rnd() * 255);
      g.fillStyle = `rgba(${v},${v},${v},${a})`;
      g.fillRect(rnd() * N, rnd() * N, size * K, size * K);
    }
  };
  const grid = (w: number, h: number, joint: string, jw: number, offset = 0) => {
    g.fillStyle = joint;
    for (let y = 0; y < N; y += h * s) g.fillRect(0, y, N, jw * K);
    let row = 0;
    for (let y = 0; y < N; y += h * s, row++) for (let x = (row % 2) * offset * s; x < N + w * s; x += w * s) g.fillRect(x % N, y, jw * K, h * s);
  };
  g.fillStyle = '#f6f5f2';
  g.fillRect(0, 0, N, N);
  switch (m) {
    case 'render':
      speckle(2600, 0.05);
      for (let i = 0; i < 8; i++) {
        g.fillStyle = `rgba(90,90,80,${0.02 + rnd() * 0.03})`;
        g.fillRect(rnd() * N, rnd() * N, (10 + rnd() * 60) * K, (30 + rnd() * 80) * K);
      }
      break;
    case 'tiles':
      for (let y = 0; y < N; y += 0.1 * s) for (let x = 0; x < N; x += 0.2 * s) {
        const v = 240 + Math.floor(rnd() * 14);
        g.fillStyle = `rgb(${v},${v},${v - 2})`;
        g.fillRect(x, y, 0.2 * s, 0.1 * s);
      }
      grid(0.2, 0.1, 'rgba(120,115,105,0.45)', 1.2);
      break;
    case 'mosaic':
      for (let y = 0; y < N; y += 0.025 * s) for (let x = 0; x < N; x += 0.025 * s) {
        const v = 215 + Math.floor(rnd() * 40);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x, y, 0.025 * s - K, 0.025 * s - K);
      }
      break;
    case 'azulejo': {
      // Six tiles of 14 cm a side: a motif of four leaves and a ring, in the tile's own colour.
      const t = 0.14 * s;
      for (let y = 0; y < N; y += t) for (let x = 0; x < N; x += t) {
        g.fillStyle = 'rgb(120,120,120)';
        for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          g.beginPath();
          g.ellipse(x + a * t, y + b * t, t * 0.32, t * 0.14, Math.PI / 4 + (a ^ b) * (Math.PI / 2), 0, Math.PI * 2);
          g.fill();
        }
        g.strokeStyle = 'rgb(140,140,140)';
        g.lineWidth = t * 0.06;
        g.beginPath();
        g.arc(x + t / 2, y + t / 2, t * 0.2, 0, Math.PI * 2);
        g.stroke();
      }
      grid(0.14, 0.14, 'rgba(200,200,200,0.8)', 1);
      break;
    }
    case 'granite':
      g.fillStyle = '#ecebe6';
      g.fillRect(0, 0, N, N);
      speckle(9000, 0.16, 1.5);
      grid(0.8, 0.4, 'rgba(70,65,60,0.35)', 2, 0.4);
      break;
    case 'stone':
      speckle(3000, 0.07, 1.5);
      grid(0.6, 1.2, 'rgba(80,75,70,0.35)', 1.5);
      break;
    case 'brick':
      for (let y = 0, row = 0; y < N; y += 0.075 * s, row++) for (let x = (row % 2) * 0.125 * s - 0.25 * s; x < N; x += 0.25 * s) {
        const v = 225 + Math.floor(rnd() * 30);
        g.fillStyle = `rgb(${v},${v - 8},${v - 12})`;
        g.fillRect(x, y, 0.24 * s, 0.065 * s);
      }
      break;
    case 'concrete':
      speckle(5000, 0.07, 2);
      g.fillStyle = 'rgba(80,80,80,0.12)';
      for (let y = 0; y < N; y += s) g.fillRect(0, y, N, 1.2 * K);
      break;
    case 'block':
      speckle(4000, 0.08, 2);
      grid(0.4, 0.2, 'rgba(90,90,90,0.35)', 1.5, 0.2);
      break;
    case 'glass': {
      const grad = g.createLinearGradient(0, 0, 0, N);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.5, '#d9dde2');
      grad.addColorStop(1, '#f0f2f4');
      g.fillStyle = grad;
      g.fillRect(0, 0, N, N);
      grid(1.5, 1.5, 'rgba(60,70,80,0.5)', 2);
      break;
    }
    case 'metal':
      for (let x = 0; x < N; x += 0.2 * s) {
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(x, 0, 0.05 * s, N);
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.fillRect(x + 0.07 * s, 0, 0.03 * s, N);
      }
      break;
    case 'panels':
      speckle(1500, 0.04, 2);
      grid(1.2, 0.6, 'rgba(70,70,70,0.4)', 2);
      break;
  }
  return c;
}

// How much of the sky's reflections (look.ts's environment) a wall takes, of what everything else
// takes. A wall is lit by the sky already (the hemisphere light), and the reflections' sky on top of it
// washes every colour towards a bluish white: a teal block's tiles (58, 118, 118) came out (189, 228,
// 229). At a third a wall is its colour in the game's light, as a photo shows it (braga-map's task
// 017). three.js gives every material the scene's environment at the scene's intensity, whatever the
// material's own says, so the shader scales what it adds.
export const WALL_SKY = 1 / 3;
export function lessSky(sh: { fragmentShader: string }, k = WALL_SKY): void {
  sh.fragmentShader = sh.fragmentShader.replace(
    '#include <lights_fragment_maps>',
    `#include <lights_fragment_maps>
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV ) && defined( RE_IndirectDiffuse )
iblIrradiance *= ${k.toFixed(3)};
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
radiance *= ${k.toFixed(3)};
#endif`,
  );
}

// A facade's colours as the walls' shader takes them, in linear light, by their names in the map.
export type Rgb = [number, number, number];
export const linearOf = (c: [number, number, number]): Rgb => c.map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as Rgb;

// Walls being gathered for the kit's material: each vertex's place, its normal, where it is in its
// wall's bays and storeys (bay: u, v, the wall's bays, the building's storeys), in metres along the wall
// and up it (surf), its layers and materials (kit), and its colours.
export class Walls {
  pos: number[] = [];
  nor: number[] = [];
  bay: number[] = [];
  surf: number[] = [];
  kit: number[] = [];
  wall: number[] = [];
  base: number[] = [];
  shut: number[] = [];
  door: number[] = [];
  // A triangle of a wall, each corner [x, y, z, s, h]: its place, and its metres along the wall and up
  // it from the building's foot; `w` says how the wall is laid out and coloured.
  tri(a: number[], b: number[], c: number[], w: WallLayout): void {
    const n = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).cross(new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])).normalize();
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n.x, n.y, n.z);
      const [s, h] = [p[3], p[4]];
      this.bay.push((s - w.margin) / w.bayW, h < w.G ? h / w.G : 1 + (h - w.G) / w.S, w.bays, w.floors);
      this.surf.push(s + w.s0, h);
      this.kit.push(...w.kit);
      this.wall.push(...w.wall);
      this.base.push(...w.base);
      this.shut.push(...w.shut);
      this.door.push(w.door);
    }
  }
  mesh(material: THREE.Material): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('bay', new THREE.Float32BufferAttribute(this.bay, 4));
    g.setAttribute('surf', new THREE.Float32BufferAttribute(this.surf, 2));
    g.setAttribute('kit', new THREE.Float32BufferAttribute(this.kit, 4));
    g.setAttribute('wall', new THREE.Float32BufferAttribute(this.wall, 3));
    g.setAttribute('base', new THREE.Float32BufferAttribute(this.base, 3));
    g.setAttribute('shut', new THREE.Float32BufferAttribute(this.shut, 3));
    g.setAttribute('door', new THREE.Float32BufferAttribute(this.door, 1));
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

// How one wall of a building is laid out: its ground floor G metres high and its storeys S over it,
// `floors` of them in all; its bays, `bays` of them bayW metres wide from `margin` along it; where its
// surface starts (s0, so it runs on round the corner); its layers, materials and colours; and which bay
// of its ground floor is the building's front door (-1 for none).
export interface WallLayout {
  G: number;
  S: number;
  floors: number;
  bays: number;
  bayW: number;
  margin: number;
  s0: number;
  kit: [number, number, number, number];
  wall: Rgb;
  base: Rgb;
  shut: Rgb;
  door: number;
}

// A wall laid out as its photo has it (braga-map's task 086): its pieces (world/storeys.ts's
// layoutPieces), each storey read its openings where they are, each its kind's drawing cut from its bay
// and stretched to its width (a window of the building's kind, a door, a garage's door, a shop's front, a
// balcony's door as the 2000s block's floor-to-ceiling window), the wall plain between them, each storey
// not read in its kind's rhythm; and over the top storey, up to the roof, plain wall. `point(s, h)` is the
// wall's corner [x, y, z, s, h] s metres along it and h up from its foot; `top`, its top (s, h) along it
// from end to end; `low`, how far below its foot it starts. False (and nothing drawn) where its top falls
// below its storeys anywhere: it's drawn as before.
export function laidOut(walls: Walls, w: WallLayout, storeys: (FacadeOpening[] | null)[], p: FacadeProportions, L: number, low: number, top: [number, number][], point: (s: number, h: number) => number[]): boolean {
  const eaves = w.G + (w.floors - 1) * w.S;
  if (top.some(([, h]) => h < eaves - 0.05)) return false;
  const plain: WallLayout = { ...w, kit: [-1, -1, w.kit[2], w.kit[3]], door: -1 };
  const layerOf = (kind: FacadeOpening['kind'], storey: number) =>
    kind === 'window' ? w.kit[0] : kind === 'door' && !storey ? DOOR : kind === 'door' || kind === 'balcony' ? layerOfType('block-2000s') : layerOfGround(kind === 'garage' ? 'garages' : 'shops');
  // Two triangles, up it then along, as a whole wall's fan is, so they face out.
  const quad = (s0: number, s1: number, h0: number, h1: number, h2: number, l: WallLayout) => {
    const [a, b, c, d] = [point(s0, h0), point(s1, h0), point(s1, h2), point(s0, h1)];
    walls.tri(a, d, c, l);
    walls.tri(a, c, b, l);
  };
  for (const q of layoutPieces(storeys, p, w.G, w.S, w.floors, L, low)) {
    if (q.what === 'rhythm') quad(q.s0, q.s1, q.h0, q.h1, q.h1, w);
    else if (q.what === 'plain') quad(q.s0, q.s1, q.h0, q.h1, q.h1, plain);
    else {
      // Its bay's drawing across it: u0 at s0, u1 at s1.
      const [u0, u1] = q.u!;
      const bayW = (q.s1 - q.s0) / (u1 - u0);
      const layer = layerOf(q.what, q.storey);
      quad(q.s0, q.s1, q.h0, q.h1, q.h1, { ...w, kit: [layer, layer, w.kit[2], w.kit[3]], door: -1, bays: 1, bayW, margin: q.s0 - u0 * bayW });
    }
  }
  // Up to the roof: under each stretch of its top, plain.
  for (let q = 0; q + 1 < top.length; q++) if (top[q + 1][0] - top[q][0] > 0.005) quad(top[q][0], top[q + 1][0], eaves, top[q][1], top[q + 1][1], plain);
  return true;
}

export interface Kit {
  openings: THREE.DataArrayTexture;
  surfaces: THREE.DataArrayTexture;
  // On Ultra, the bays' relief as normals, a layer each as `openings` has them.
  reliefs: THREE.DataArrayTexture | null;
  material: THREE.MeshStandardMaterial;
  dispose(): void;
}

// The kit: every kind's storey and every ground floor as the layers of one texture, every material's
// surface as another, and the walls' material that puts them together. On Ultra (braga-map's task 123),
// all drawn at twice High's size, and the bays in relief.
export function facadeKit(types: Record<FacadeType, FacadeProportions>, quality: Quality, ultra = false): Kit {
  N = quality === 'low' ? 128 : ultra ? 512 : 256;
  RELIEF = ultra;
  const bays = [...TYPES.map((t) => storeyOf(t, types[t])), ...GROUNDS.map(groundOf), groundOf('door')];
  const data = new Uint8Array(N * N * 4 * bays.length);
  bays.forEach((b, k) => data.set(b.rgba(), k * N * N * 4));
  const openings = new THREE.DataArrayTexture(data, N, N, bays.length);
  const surf = new Uint8Array(N * N * 4 * MATERIALS.length);
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  MATERIALS.forEach((m, k) => {
    g.drawImage(surfaceOf(m), 0, 0);
    surf.set(g.getImageData(0, 0, N, N).data, k * N * N * 4);
  });
  const surfaces = new THREE.DataArrayTexture(surf, N, N, MATERIALS.length);
  let reliefs: THREE.DataArrayTexture | null = null;
  if (ultra) {
    const nor = new Uint8Array(N * N * 4 * bays.length);
    bays.forEach((b, k) => nor.set(b.normals(), k * N * N * 4));
    reliefs = new THREE.DataArrayTexture(nor, N, N, bays.length);
  }
  for (const t of reliefs ? [openings, surfaces, reliefs] : [openings, surfaces]) {
    t.colorSpace = t === reliefs ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy();
    t.needsUpdate = true;
  }
  const material = new THREE.MeshStandardMaterial({ roughness: 0.88 });
  // So the textures' memory counts them (stats.ts).
  Object.assign(material, { facadeOpenings: openings, facadeSurfaces: surfaces }, reliefs ? { facadeReliefs: reliefs } : {});
  material.onBeforeCompile = (sh) => {
    lessSky(sh);
    sh.uniforms.openings = { value: openings };
    sh.uniforms.surfaces = { value: surfaces };
    if (reliefs) sh.uniforms.reliefs = { value: reliefs };
    sh.uniforms.span = { value: MATERIALS.map((m) => 1 / SPAN[m]) };
    const vary = 'vec4 vBay;\nvarying vec2 vSurf;\nvarying vec4 vKit;\nvarying vec3 vWall;\nvarying vec3 vBase;\nvarying vec3 vShut;\nvarying float vDoor;';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 bay;\nattribute vec2 surf;\nattribute vec4 kit;\nattribute vec3 wall;\nattribute vec3 base;\nattribute vec3 shut;\nattribute float door;\nvarying ${vary}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBay = bay;\nvSurf = surf;\nvKit = kit;\nvWall = wall;\nvBase = base;\nvShut = shut;\nvDoor = door;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray openings;
uniform sampler2DArray surfaces;
uniform float span[${MATERIALS.length}];
varying ${vary}`)
      .replace(
        '#include <map_fragment>',
        `// vBay: u in bays along the wall (from its first bay's start), v in storeys up it (the ground floor
// 0 to 1), how many bays it has and how many storeys. vSurf: metres along the wall and up it, for its
// surface. vKit: the storey's layer, the ground floor's (-1: none, plain wall), the walls' material, the
// ground floor's.
float u = vBay.x, v = vBay.y;
bool ground = v < 1.0;
float layer = ground ? (vDoor >= 0.0 && abs(floor(u) - vDoor) < 0.5 ? ${DOOR.toFixed(1)} : vKit.y) : vKit.x;
// Sampled with the gradients of u and v as they run on, not of their fractions, which jump at each bay's
// edge and would take the smallest mipmap there.
vec2 du = dFdx(vec2(u, v)), dv = dFdy(vec2(u, v));
vec4 o = vec4(0.0);
if (u >= 0.0 && u <= vBay.z && v >= 0.0 && v <= vBay.w && layer >= -0.5) o = textureGrad(openings, vec3(fract(u), fract(v), layer), du, dv);
float mat = ground ? vKit.w : vKit.z;
vec3 wallRgb = texture(surfaces, vec3(vSurf * span[int(mat + 0.5)], mat)).rgb * (ground ? vBase : vWall);
// The bay's alpha says what each pixel is: the wall (0), a shutter (0.5), anything else as drawn (1).
float isWall = clamp(1.0 - 2.0 * o.a, 0.0, 1.0), isOpen = clamp(2.0 * o.a - 1.0, 0.0, 1.0), isShut = 1.0 - isWall - isOpen;
diffuseColor.rgb = wallRgb * isWall + o.rgb * (isOpen + vShut * isShut);`,
      );
    // On Ultra, the bay's relief: its normal tilted as the bay's drawing has it, in the wall's frame
    // (along it as vSurf.x runs, up it as vSurf.y does), as three.js tilts a normal map's.
    if (reliefs) {
      sh.fragmentShader = sh.fragmentShader.replace('uniform sampler2DArray surfaces;', 'uniform sampler2DArray surfaces;\nuniform sampler2DArray reliefs;').replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
if (u >= 0.0 && u <= vBay.z && v >= 0.0 && v <= vBay.w && layer >= -0.5) {
  vec3 rn = textureGrad(reliefs, vec3(fract(u), fract(v), layer), du, dv).xyz * 2.0 - 1.0;
  vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
  vec2 st0 = dFdx(vSurf), st1 = dFdy(vSurf);
  vec3 q1perp = cross(q1, normal), q0perp = cross(normal, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x, B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float sc = det == 0.0 ? 0.0 : faceDirection * inversesqrt(det);
  normal = normalize(T * (rn.x * sc) + B * (rn.y * sc) + rn.z * normal);
}`,
      );
    }
  };
  return {
    openings,
    surfaces,
    reliefs,
    material,
    dispose() {
      openings.dispose();
      surfaces.dispose();
      reliefs?.dispose();
      material.dispose();
    },
  };
}
