// ?stats: what the game costs on this screen, in a corner. The frame rate and the worst second
// (of the race, or of driving round the city since the last race), the graphics level, draw calls, triangles, the textures' memory, how long the city took
// to build and the page to be ready, what it downloaded, and the graphics card. It's for measuring
// the game on a phone, which has no developer tools: a screenshot of the corner is the measurement.
import * as THREE from 'three';
import type { Graphics } from './render/look.ts';

// About how many bytes of the graphics card's memory the scene's textures take, once everything in
// it has been drawn: each texture a material uses, the sky's reflections and the sun's shadows. Four
// bytes a pixel (eight in half floats; one where it's a single channel, as the ground's mask and kinds
// are), every layer of an array, and a third more where there are mipmaps; a compressed one (the map's
// textures, render/cover.ts and trees.ts) what its levels hold, as this graphics card takes them. (The
// ground's grain, added in its shader, isn't counted: it's 256 pixels square.)
export function textureBytes(scene: THREE.Scene): number {
  const seen = new Set<THREE.Texture>();
  const add = (t: unknown) => {
    if ((t as THREE.Texture | null)?.isTexture) seen.add(t as THREE.Texture);
  };
  add(scene.environment);
  add(scene.background);
  let bytes = 0;
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) for (const v of Object.values(x)) add(v);
    const sun = o as THREE.DirectionalLight;
    if (sun.isDirectionalLight && sun.castShadow && sun.shadow.map) bytes += sun.shadow.map.width * sun.shadow.map.height * 4;
  });
  for (const t of seen) {
    if ((t as THREE.CompressedTexture).isCompressedTexture) {
      for (const m of (t as THREE.CompressedTexture).mipmaps ?? []) bytes += (m as { data: ArrayBufferView }).data.byteLength;
      continue;
    }
    const img = t.image as { width?: number; height?: number; depth?: number } | null;
    if (!img?.width || !img.height) continue;
    // A byte a channel (two in half floats, four in floats), and an array's every layer.
    const channels = t.format === THREE.RedFormat ? 1 : t.format === THREE.RGFormat ? 2 : 4;
    const px = channels * (t.type === THREE.HalfFloatType ? 2 : t.type === THREE.FloatType ? 4 : 1);
    const mips = t.generateMipmaps && t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter ? 4 / 3 : 1;
    bytes += img.width * img.height * (img.depth ?? 1) * px * mips;
  }
  return bytes;
}

// What the page downloaded, in bytes, and whether it came from the browser's cache instead.
function downloaded(): { bytes: number; cached: boolean } {
  const all = [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')] as PerformanceResourceTiming[];
  const bytes = all.reduce((n, e) => n + e.transferSize, 0);
  return { bytes, cached: bytes === 0 && all.some((e) => e.decodedBodySize > 0) };
}

// The graphics card's name, without what Chrome wraps round it: "ANGLE (Qualcomm, Adreno (TM) 610,
// OpenGL ES 3.2)" is "Adreno (TM) 610".
function gpuName(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'placa gráfica desconhecida';
  const angle = /^ANGLE \((.*)\)$/.exec(name);
  return (angle ? (angle[1].split(', ')[1] ?? angle[1]) : name).replace(/\s*\(0x[0-9a-f]+\).*$/i, '');
}

const MB = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
const LEVEL: Record<Graphics, string> = { ultra: 'Ultra', high: 'Alta', medium: 'Média', low: 'Baixa' };

export class Stats {
  private el = document.createElement('div');
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private build: string;
  private gpu: string;
  // This second's frames, so far, on a clock of its own: the game's frame time stops at 0.25 s, which
  // would hide a long stall.
  private frames = 0;
  private time = 0;
  private last = performance.now();
  private fps = 0;
  // The slowest whole second since you began driving round the city or the race began, after its
  // first two, and the level it began on.
  private worst = Infinity;
  private skip = 0;
  private from: Graphics | null = null;
  private what: 'roam' | 'walk' | 'fight' | 'race' | null = null;

  // buildMs: how long the city took to build; readyMs: from opening the page until it was built.
  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, buildMs: number, readyMs: number) {
    this.renderer = renderer;
    this.scene = scene;
    const d = downloaded();
    this.build = `cidade em ${(buildMs / 1000).toFixed(1)} s · pronta em ${(readyMs / 1000).toFixed(1)} s · ${d.cached ? 'da cache' : `${MB(d.bytes)} descarregados`}`;
    this.gpu = gpuName(renderer);
    this.el.className = 'stats';
    document.body.append(this.el);
  }

  // Once a frame, after it's drawn, with what you're doing: driving round the city, on foot, racing,
  // or neither.
  frame(quality: Graphics, what: 'roam' | 'walk' | 'fight' | 'race' | null): void {
    if (what !== this.what) {
      this.what = what;
      this.from = what ? quality : null;
      this.worst = Infinity;
      this.skip = 2;
    }
    const now = performance.now();
    this.frames++;
    this.time += (now - this.last) / 1000;
    this.last = now;
    if (this.time < 1) return;
    this.fps = this.frames / this.time;
    if (what && this.skip-- <= 0) this.worst = Math.min(this.worst, this.fps);
    this.frames = 0;
    this.time = 0;
    const r = this.renderer.info.render;
    const px = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.el.textContent = [
      `${what === 'walk' ? 'a pé · ' : what === 'fight' ? 'tiroteio · ' : ''}${Math.round(this.fps)} fps · pior ${Number.isFinite(this.worst) ? Math.round(this.worst) : '–'} · ${LEVEL[quality]}${this.from && this.from !== quality ? ` (era ${LEVEL[this.from]})` : ''}`,
      `${r.calls} chamadas · ${(r.triangles / 1e6).toFixed(2)} M triângulos · texturas ${Math.round(textureBytes(this.scene) / 1048576)} MB`,
      this.build,
      `${this.gpu} · ${px.x}×${px.y}`,
    ].join('\n');
  }
}
