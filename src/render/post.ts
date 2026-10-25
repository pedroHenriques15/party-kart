// Ultra's frame (braga-map's task 090): the sun's shadows out to 2 km in cascades, the scene drawn into
// a buffer as the screen would show it (tone mapped and its haze mixed in after that, as look.ts has
// it), then what a phone can't afford laid over it: the corners, the eaves and the foot of each wall
// darkened as the light reaching them is (ground truth ambient occlusion, from the frame's own depth),
// what's dithered averaged with the pixels round it (task 132), and the edges smoothed (SMAA). High
// and below draw straight to the screen with the one sun, as before.
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

const q = new URLSearchParams(globalThis.location?.search);
// How strongly the occlusion darkens (?ao= for tuning, 0 for none), and how far it reaches, in metres.
// Its deepest eased (AO_CURVE) and its noise smoothed only close by: worked out from the depth alone, it
// finds a crease between two walls too dark, and the smoothing spread that over the whole of a narrow
// face beside it, a speckled band down a wall (alvaro-carneiro's), where the eaves and steps wanted it.
const AO = q.has('ao') ? Number(q.get('ao')) : 0.7;
const AO_RADIUS = 1.5;
const AO_CURVE = 0.6;
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

// What's drawn as a share of each pixel by a dither, with no blending to give the rest of the pixel to
// what's behind (a bare crown's finer twigs far off, its billboard's, trees.ts's: braga-map's task 132),
// says so in the frame's alpha, which nothing else reads: below 0, to -1, by how much of it is dithered
// (`share`, GLSL; none, and it's 1 as everything else is). The resolve averages it with the pixels round
// it, so a bare crown far off is a soft mass, as one is, where the dither alone left a stipple. Called
// from a material's onBeforeCompile; on a material not drawn into Ultra's frame it does nothing.
export function dithered(sh: { fragmentShader: string }, share: string): void {
  sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>\nif (${share} > 0.0) gl_FragColor.a = -min(${share}, 1.0);`);
}
// The resolve: a pixel dithered, or seen through one within a pixel of it (no nearer than it), mixed by
// the most dithered there with the mean of those of the nine round it that are dithered or behind it, so
// the dither's dots, spread evenly as its pattern spreads them, become their share of each pixel. What
// stands in front of a dithered crown (a sign, a lamp post, a wall's edge) and everything away from
// one is left as it was.
const RESOLVE = `uniform sampler2D frame;
uniform sampler2D depth;
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy), most = textureSize(frame, 0) - 1;
  vec4 own = texelFetch(frame, at, 0);
  // The nearest dithered pixel round this one, and how dithered the most is.
  float near = 1.0, share = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 p = clamp(at + ivec2(x, y), ivec2(0), most);
    float a = texelFetch(frame, p, 0).a;
    if (a < 0.0) {
      near = min(near, texelFetch(depth, p, 0).r);
      share = max(share, -a);
    }
  }
  if (share <= 0.0 || (own.a >= 0.0 && texelFetch(depth, at, 0).r < near)) {
    gl_FragColor = vec4(own.rgb, 1.0);
    return;
  }
  vec3 sum = vec3(0.0);
  float n = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 p = clamp(at + ivec2(x, y), ivec2(0), most);
    vec4 c = texelFetch(frame, p, 0);
    if (c.a < 0.0 || texelFetch(depth, p, 0).r >= near) {
      sum += c.rgb;
      n += 1.0;
    }
  }
  gl_FragColor = vec4(mix(own.rgb, sum / n, share), 1.0);
}`;
function resolve(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { frame: { value: null }, depth: { value: null } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: RESOLVE,
    depthTest: false,
    depthWrite: false,
  });
}

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
  private resolved: THREE.WebGLRenderTarget;
  private resolving: FullScreenQuad;
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
    this.resolved = displayBuffer(s.x, s.y, false);
    this.resolving = new FullScreenQuad(resolve());
    // From the depth the frame was drawn with, its normals worked out from that depth: a pass of its own
    // for them would draw the trees' leaf cards whole, dark squares round every crown. (Given a depth at
    // once, three 0.186's pass never makes the buffer it then sizes and disposes of: so after.)
    this.gtao = new GTAOPass(scene, camera, ...aoSize(s.x, s.y));
    this.gtao.setGBuffer(this.drawn.depthTexture!);
    this.gtao.updateGtaoMaterial({ radius: AO_RADIUS, distanceExponent: 1, thickness: 1, scale: AO_CURVE, samples: 24 });
    this.gtao.updatePdMaterial({ radius: 4 });
    this.gtao.blendIntensity = AO;
    if (!AO) this.gtao.output = GTAOPass.OUTPUT.Diffuse;
    this.smaa = new SMAAPass();
    this.smaa.setSize(s.x, s.y);
    this.smaa.renderToScreen = true;
  }

  setSize(w: number, h: number): void {
    this.drawn.setSize(w, h);
    this.shaded.setSize(w, h);
    this.resolved.setSize(w, h);
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
    const u = (this.resolving.material as THREE.ShaderMaterial).uniforms;
    u.frame.value = this.shaded.texture;
    u.depth.value = this.drawn.depthTexture;
    r.setRenderTarget(this.resolved);
    this.resolving.render(r);
    this.smaa.render(r, this.drawn, this.resolved, 0, false); // to the screen: its write buffer unused
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
    this.resolved.dispose();
    this.resolving.material.dispose();
    this.resolving.dispose();
    this.gtao.dispose();
    this.smaa.dispose();
  }
}
