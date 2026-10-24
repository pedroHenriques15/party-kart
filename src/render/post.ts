// Ultra's frame (braga-map's task 090): the sun's shadows out to 2 km in cascades, the scene drawn into
// a buffer as the screen would show it (tone mapped and its haze mixed in after that, as look.ts has
// it), then what a phone can't afford laid over it: the corners, the eaves and the foot of each wall
// darkened as the light reaching them is (ground truth ambient occlusion, from the frame's own depth),
// and the edges smoothed (SMAA). High and below draw straight to the screen with the one sun, as before.
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

const q = new URLSearchParams(globalThis.location?.search);
// How strongly the occlusion darkens (?ao= for tuning, 0 for none), and how far it reaches, in metres.
const AO = q.has('ao') ? Number(q.get('ao')) : 1;
const AO_RADIUS = 1.5;
// It's worked out on no more than this many lines, as the shots see it, and laid over a bigger screen
// smoothed: it changes slowly across a frame, and at 2560 by 1440 it costs a quarter as much.
const AO_LINES = 720;
const aoSize = (w: number, h: number): [number, number] => {
  const k = Math.min(1, AO_LINES / h);
  return [Math.round(w * k), Math.round(h * k)];
};
// The sun's shadows out to this far, in four cascades of 4096 px, finest by the camera: a building's
// shadow falls across a street 500 m off, and the hills' over the valleys. Each cascade ends this far
// off, the first as near as the one sun's 140 m box reached (so its shadows are as sharp as Ultra's
// were, 3 cm a texel), each next about three times as far. That box at 2048 px is 7 cm a texel, and
// the sun's normal bias was set for that; each cascade's grows with its texels.
const SHADOW_FAR = 2000;
const CASCADES = [60, 200, 650, SHADOW_FAR];
const TEXEL = 140 / 2048;
// The cascades' depth, from 400 m on the sun's side of what they cover (a hill's shadow, a tower's) to
// past the far end of the longest; their bias is the one sun's, kept the same in metres.
const LIGHT_FAR = 8000;

// three 0.186's CSM brings its own copy of the lights' chunk, older than three's: in it a standard
// material's light scattered more than once is never worked out (material.dfg), and everything drew
// darker and duller, cascaded or not. So the lit materials take three's own chunk with only its suns'
// loop CSM's, the one choosing each pixel's cascade; a three whose chunks differ fails post.test.ts.
export function cascadedLights(own: string, csm: string): string {
  const suns = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
  const a = own.indexOf(`${suns}\n`), b = own.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )');
  const from = csm.indexOf(`${suns} && defined( USE_CSM )`), to = csm.indexOf(`${suns} && !defined( USE_CSM )`);
  if (a < 0 || b < a || from < 0 || to < from) throw new Error("three's lights chunk or CSM's isn't as post.ts knows it");
  return own.slice(0, a) + csm.slice(from, to) + own.slice(b);
}
// CSM's own uniforms, which its loop reads.
const CASCADE_PARS = `#include <lights_pars_begin>
uniform vec2 CSM_cascades[CSM_CASCADES];
uniform float cameraNear;
uniform float shadowFar;`;

// A buffer holding the frame as the screen shows it: three tone maps and encodes to sRGB only what it
// draws to the screen or to an XR device's buffer, and this one says it is the latter. Half floats, so
// nothing reads it back as sRGB and decodes it again.
function displayBuffer(w: number, h: number, depth: boolean): THREE.WebGLRenderTarget {
  const t = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: depth ? new THREE.DepthTexture(w, h, THREE.FloatType) : null });
  t.texture.colorSpace = THREE.SRGBColorSpace;
  return Object.assign(t, { isXRRenderTarget: true });
}

export class UltraFrame {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private drawn: THREE.WebGLRenderTarget;
  private shaded: THREE.WebGLRenderTarget;
  private gtao: GTAOPass;
  private smaa: SMAAPass;
  private sun: THREE.DirectionalLight;
  private csm: CSM;
  // The lit materials given the cascades, with their own changes to their shaders and their programs'
  // keys, given back when Ultra's off (CSM's own clean-up would drop them).
  private lit = new Map<THREE.Material, { hook: THREE.Material['onBeforeCompile']; key: THREE.Material['customProgramCacheKey'] }>();
  private lights: string;
  // The camera's projection the cascades were last fitted to (its field of view eases as you go).
  private fitted = '';

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, sun: THREE.DirectionalLight) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sun = sun;
    // The cascades in the one sun's place, its colour and strength (its way each frame, in render).
    const own = { begin: THREE.ShaderChunk.lights_fragment_begin, pars: THREE.ShaderChunk.lights_pars_begin };
    const bias = (sun.shadow.bias * (sun.shadow.camera.far - sun.shadow.camera.near)) / (LIGHT_FAR - 1);
    const splits = (_n: number, _near: number, far: number, breaks: number[]) => breaks.push(...CASCADES.map((d) => d / far));
    this.csm = new CSM({ camera, parent: scene, cascades: CASCADES.length, maxFar: SHADOW_FAR, mode: 'custom', customSplitsCallback: splits, shadowMapSize: 4096, shadowBias: bias, lightIntensity: sun.intensity, lightNear: 1, lightFar: LIGHT_FAR, lightMargin: 400 });
    // CSM puts its chunks in three's place, for every material: three's back.
    this.lights = cascadedLights(own.begin, THREE.ShaderChunk.lights_fragment_begin);
    THREE.ShaderChunk.lights_fragment_begin = own.begin;
    THREE.ShaderChunk.lights_pars_begin = own.pars;
    this.csm.fade = true;
    for (const l of this.csm.lights) l.color.copy(sun.color);
    sun.visible = false;
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.drawn = displayBuffer(s.x, s.y, true);
    this.shaded = displayBuffer(s.x, s.y, false);
    // From the depth the frame was drawn with, its normals worked out from that depth: a pass of its own
    // for them would draw the trees' leaf cards whole, dark squares round every crown. (Given a depth at
    // once, three 0.186's pass never makes the buffer it then sizes and disposes of: so after.)
    this.gtao = new GTAOPass(scene, camera, ...aoSize(s.x, s.y));
    this.gtao.setGBuffer(this.drawn.depthTexture!);
    this.gtao.updateGtaoMaterial({ radius: AO_RADIUS, distanceExponent: 1, thickness: 1, scale: 1, samples: 16 });
    this.gtao.blendIntensity = AO;
    if (!AO) this.gtao.output = GTAOPass.OUTPUT.Diffuse;
    this.smaa = new SMAAPass();
    this.smaa.setSize(s.x, s.y);
    this.smaa.renderToScreen = true;
  }

  setSize(w: number, h: number): void {
    this.drawn.setSize(w, h);
    this.shaded.setSize(w, h);
    this.gtao.setSize(...aoSize(w, h));
    this.smaa.setSize(w, h);
  }

  // Every lit material in the scene, as it comes, takes the cascades: its own changes to its shader run
  // first, and its program's key says it has them, so no two materials share a program they shouldn't.
  private takeShadows(): void {
    this.scene.traverse((o) => {
      const ms = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const m of Array.isArray(ms) ? ms : ms ? [ms] : []) {
        const lit = m as THREE.MeshStandardMaterial & THREE.MeshLambertMaterial & THREE.MeshPhongMaterial;
        if (this.lit.has(m) || !(lit.isMeshStandardMaterial || lit.isMeshLambertMaterial || lit.isMeshPhongMaterial)) continue;
        const hook = m.onBeforeCompile;
        const key = m.customProgramCacheKey;
        const own = key.call(m);
        this.csm.setupMaterial(m);
        const theirs = m.onBeforeCompile;
        m.onBeforeCompile = (sh, r) => {
          hook.call(m, sh, r);
          theirs.call(m, sh, r);
          sh.fragmentShader = sh.fragmentShader.replace('#include <lights_pars_begin>', CASCADE_PARS).replace('#include <lights_fragment_begin>', this.lights);
        };
        m.customProgramCacheKey = () => `${own}|csm`;
        m.needsUpdate = true;
        this.lit.set(m, { hook, key });
      }
    });
  }

  render(): void {
    const r = this.renderer;
    // Any new material (a kart's, an item's) before it's first drawn: under the cascades' four suns
    // without their choice of cascade, it would take all four (the scene's 800 objects in 0.1–0.4 ms).
    this.takeShadows();
    const c = this.camera;
    const fit = `${c.fov} ${c.aspect} ${c.near} ${c.far} ${c.zoom}`;
    if (fit !== this.fitted) {
      this.fitted = fit;
      this.csm.updateFrustums();
    }
    c.updateMatrixWorld();
    this.csm.lightDirection.subVectors(this.sun.target.position, this.sun.position).normalize();
    this.csm.update();
    for (const l of this.csm.lights) l.shadow.normalBias = this.sun.shadow.normalBias * ((l.shadow.camera.right - l.shadow.camera.left) / l.shadow.mapSize.x / TEXEL);
    r.setRenderTarget(this.drawn);
    r.clear();
    r.render(this.scene, this.camera);
    this.gtao.render(r, this.shaded, this.drawn, 0, false);
    this.smaa.render(r, this.drawn, this.shaded, 0, false); // to the screen: its write buffer unused
    r.setRenderTarget(null);
  }

  dispose(): void {
    this.csm.remove();
    this.csm.dispose();
    for (const [m, { hook, key }] of this.lit) {
      m.onBeforeCompile = hook;
      m.customProgramCacheKey = key;
      m.needsUpdate = true;
    }
    this.lit.clear();
    this.sun.visible = true;
    this.drawn.dispose();
    this.shaded.dispose();
    this.gtao.dispose();
    this.smaa.dispose();
  }
}
