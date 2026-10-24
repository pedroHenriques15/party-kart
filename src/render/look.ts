// The look: Braga's sky and sun at a moment of the day (braga-map's task 022), reflections of that sky
// on everything shiny, the haze, and soft shadows that follow the action. Three levels of quality, for
// laptops and phones that can't keep up, and Ultra above them on a PC. (The street lamps' glow is their
// own halos, in streets.ts, lit once the sun is down: a bloom pass can't tell this sky from a light.)
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { braga, sunAt, sunDir } from '../sun.ts';
import { UltraFrame } from './post.ts';

// The three levels the city is built at, a phone's and a laptop's; and the graphics a player picks,
// which has Ultra above them, for a PC only (braga-map's task 081): everything past what a phone holds
// goes there. Ultra builds the city at High's level but where a task gives it its own.
export type Quality = 'high' | 'medium' | 'low';
export type Graphics = 'ultra' | Quality;
export const GRAPHICS: Graphics[] = ['ultra', 'high', 'medium', 'low'];
export const levelOf = (g: Graphics): Quality => (g === 'ultra' ? 'high' : g);

// Whether a device is offered Ultra: not one played by touch first (a phone, a tablet), and with a
// graphics card to hold it: one that takes textures 16,384 pixels wide, or a discrete one by its name.
export function ultraOffered(renderer: THREE.WebGLRenderer, touchFirst: boolean): boolean {
  if (touchFirst) return false;
  const gl = renderer.getContext();
  if (gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 16384) return true;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return !!info && /nvidia|geforce|quadro|radeon rx|radeon pro|intel.*arc/i.test(String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)));
}

const q = new URLSearchParams(location.search);
const knob = (k: string, v: number) => (q.has(k) ? Number(q.get(k)) : v);

// The moment the light is for, in Braga's clock; ?time=2026-10-13T17:30 sets another. By default a clear
// afternoon in March, when the five photos of the Rua do Fujacal and the Conselheiro Lobato were taken
// (2019-03-13, 15:08 to 15:19): the sun 34° up, in the south-west.
export const DEFAULT_TIME = '2026-03-13T15:15';
const when = braga(q.get('time') ?? '') ?? braga(DEFAULT_TIME)!;
export const SUN = sunAt(when);
const toSun = sunDir(when);
export const SUN_DIR = new THREE.Vector3(toSun.x, toSun.y, toSun.z).normalize();
// The street lamps are on once the sun is this low.
export const LIT = SUN.el < 4;
// ?weather=grey: a grey Minho day, the sky overcast, the shadows faint and the streets wet; ?weather=rain,
// the same in the rain.
export const RAIN = q.get('weather') === 'rain';
export const GREY = RAIN || q.get('weather') === 'grey';
export const WET = GREY;
const day = <T>(clear: T, grey: T): T => (GREY ? grey : clear);

// The light's settings, matched to the photos (braga-map's task 022): a sun much brighter than the sky's
// light, as a shadow in the photos is a quarter as bright as the sunlit ground beside it. ?exp=…&sun=…
// in the address override them, for tuning, and ?clouds= the sky's cover on a clear day (0 to 1).
export const LIGHT = {
  exposure: knob('exp', day(0.4, 0.5)),
  sun: knob('sun', day(8.5, 1.2)),
  hemi: knob('hemi', day(0.42, 1.1)),
  env: knob('env', day(0.36, 0.7)),
  fog: knob('fog', day(0.00017, 0.0004)),
  clouds: GREY ? 0 : knob('clouds', 0.38),
};
// The air: clear enough for the photos' deep blue overhead, paling to a white haze at the horizon.
const TURBIDITY = 2;
const RAYLEIGH_K = 0.9;
const MIE = 0.003;
// The haze's colour, the horizon's under a clear sky or a grey one. It's mixed in after the tone mapping
// (three's fog is), so it's the colour as the screen shows it.
const HAZE = day('#b8c8d4', '#a9b1b8');
// The light from the sky, and back off the ground.
const SKY_LIGHT = day('#c4d4ea', '#c8ccd0');
const GROUND_LIGHT = '#8a7f62';
// An overcast sky's brightness at the horizon, where it's brightest.
const OVERCAST = 0.9;

// The sun's light after the air it comes through: Preetham's extinction, as the sky's shader has it,
// for the sun's elevation, taken relative to the sun's at 60° up, as a camera's daylight white balance
// would. The afternoon's sun is a warm white; low in the sky it reddens.
const LAMBDA = [680e-9, 550e-9, 450e-9];
const RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_K = [0.686, 0.678, 0.666];
function through(el: number): number[] {
  const z = Math.min(90, 90 - el);
  const inv = 1 / (Math.cos((z * Math.PI) / 180) + 0.15 * Math.pow(93.885 - z, -1.253));
  const c = 0.2 * TURBIDITY * 10e-18;
  return LAMBDA.map((l, k) => {
    const mie = 0.434 * c * Math.PI * Math.pow((2 * Math.PI) / l, 2) * MIE_K[k] * MIE;
    return Math.exp(-(RAYLEIGH[k] * RAYLEIGH_K * 8.4e3 + mie * 1.25e3) * inv);
  });
}
function sunlight(el: number): { colour: THREE.Color; k: number } {
  const t = through(Math.max(el, 0));
  const w = through(60);
  const rgb = t.map((v, k) => v / w[k]);
  const top = Math.max(...rgb);
  // Its strength: what reaches the ground of it, against the high sun's, and none below the horizon.
  const k = Math.min(1, top) * THREE.MathUtils.smoothstep(el, -1, 4);
  return { colour: new THREE.Color(rgb[0] / top, rgb[1] / top, rgb[2] / top), k };
}

// The haze thickens with the distance, not with its square as three's FogExp2 has it: the air between
// you and a hill 4 km off hides about half of it, and one 400 m off only a little, as the photos show.
// Every material's fog is this chunk, so it's changed once, before any is compiled.
THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace('exp( - fogDensity * fogDensity * vFogDepth * vFogDepth )', 'exp( - fogDensity * vFogDepth )');

// three's sky (Preetham's, with its clouds) as Braga's: the clouds a fair day's cumulus, crisper and
// finer than three's own (six octaves of noise, not four, and a sharper edge); and on a grey day, an
// overcast all over, palest at the horizon, in faint bands.
function skyShader(m: THREE.ShaderMaterial): void {
  m.fragmentShader = m.fragmentShader.replace('i < 4; i ++', 'i < 6; i ++').replace('threshold + 0.3,', 'threshold + 0.15,');
  if (GREY)
    m.fragmentShader = m.fragmentShader.replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      `float bands = fbm( direction.xz / max( direction.y, 0.08 ) * 0.5, 0.0 ) * 0.5 + 0.5;
			texColor = ${OVERCAST.toFixed(3)} * mix( vec3( 1.0 ), vec3( 0.66, 0.69, 0.74 ), sqrt( max( direction.y, 0.0 ) ) ) * ( 0.88 + 0.24 * bands );
			gl_FragColor = vec4( texColor, 1.0 );`,
    );
  const u = m.uniforms;
  u.turbidity.value = TURBIDITY;
  u.rayleigh.value = RAYLEIGH_K;
  u.mieCoefficient.value = MIE;
  u.mieDirectionalG.value = 0.86;
  u.cloudCoverage.value = LIGHT.clouds;
  u.cloudDensity.value = 1.5;
  u.cloudScale.value = 0.0006;
  u.cloudElevation.value = 0.6;
  // About as fast across the sky as a cumulus a kilometre and a half up, in a breeze of 10 m/s.
  u.cloudSpeed.value = 0.000012;
  u.sunPosition.value.copy(SUN_DIR).multiplyScalar(400000);
}

// The rain: streaks falling past the camera, in a box 40 m across that goes with it, each drop wrapping
// round to the top as it leaves the bottom. Where each is is worked out on the graphics card from the
// clock, so it costs one draw call and nothing a frame here.
const RAIN_BOX = new THREE.Vector3(40, 20, 40);
const DROPS = 10000;
function rain(): THREE.LineSegments {
  const seed = new Float32Array(DROPS * 6);
  const end = new Float32Array(DROPS * 2);
  for (let k = 0; k < DROPS; k++) {
    const x = Math.random(), y = Math.random(), z = Math.random();
    seed.set([x, y, z, x, y, z], k * 6);
    end.set([0, 1], k * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(seed, 3));
  g.setAttribute('end', new THREE.BufferAttribute(end, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, eye: { value: new THREE.Vector3() }, box: { value: RAIN_BOX } },
    vertexShader: `
      uniform float time;
      uniform vec3 eye;
      uniform vec3 box;
      attribute float end;
      varying float vFade;
      // Falling at 8 m/s, blown a little east by the wind; a streak is as far as it falls in a fifteenth of a second, as an eye sees it.
      const vec3 FALL = vec3(0.9, -8.0, 0.3);
      void main() {
        vec3 p = position * box + FALL * time;
        p = mod(p - eye + box * 0.5, box) - box * 0.5 + eye;
        p += FALL * 0.065 * end;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFade = 1.0 - smoothstep(4.0, 20.0, length(mv.xyz));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vFade;
      void main() { gl_FragColor = vec4(0.82, 0.85, 0.9, 0.5 * vFade); }`,
    transparent: true,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(g, m);
  lines.frustumCulled = false;
  return lines;
}

export class Look {
  readonly sun: THREE.DirectionalLight;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  // A box 20 km across, which goes with the camera: the flying camera goes further than 10 km from
  // the map's middle, and the sky's colour is only the way you look.
  private sky: Sky;
  private rain: THREE.LineSegments | null = null;
  quality: Graphics = 'high';
  // The resolution, as a share of what the quality draws (the settings'): lower, quicker.
  scale = 1;
  // Drawn over the world once it's drawn, its depth cleared: your gun in first person (render/arms.ts,
  // braga-map's task 074), which never goes into a wall however close you stand to it.
  overlay: THREE.Scene | null = null;
  // Ultra's frame, drawn through a buffer for what's laid over it (post.ts); made once Ultra is on.
  private ultra: UltraFrame | null = null;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = LIGHT.exposure;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const sky = (this.sky = new Sky());
    sky.scale.setScalar(20000);
    skyShader(sky.material);
    scene.add(sky);

    // Reflections and soft ambient light, from that same sky.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene();
    const skyCopy = new Sky();
    skyCopy.scale.setScalar(20000);
    skyShader(skyCopy.material);
    skyScene.add(skyCopy);
    scene.environment = pmrem.fromScene(skyScene, 0, 1, 30000).texture;
    scene.environmentIntensity = LIGHT.env;

    scene.fog = new THREE.FogExp2(HAZE, LIGHT.fog);
    scene.add(new THREE.HemisphereLight(SKY_LIGHT, GROUND_LIGHT, LIGHT.hemi));
    const s = sunlight(SUN.el);
    this.sun = new THREE.DirectionalLight(s.colour, LIGHT.sun * s.k);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    Object.assign(this.sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
    scene.add(this.sun, this.sun.target);
    if (RAIN) scene.add((this.rain = rain()));
  }

  // Ultra draws at the screen's every pixel (no cap at 2), its sun's shadows at 4096.
  setQuality(q: Graphics): void {
    this.quality = q;
    const r = this.renderer;
    r.setPixelRatio(Math.min(q === 'ultra' ? Infinity : q === 'high' ? 2 : q === 'medium' ? 1.25 : 1, devicePixelRatio) * this.scale);
    r.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    const size = q === 'ultra' ? 4096 : q === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (q !== 'ultra') {
      this.ultra?.dispose();
      this.ultra = null;
    }
    // Materials compile differently with and without shadows.
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  resize(): void {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.ultra?.setSize(s.x, s.y);
  }

  // Keep the sun's shadows around what we're looking at.
  follow(p: { x: number; y: number; z: number }): void {
    this.sun.target.position.set(p.x, p.y, p.z);
    this.sun.position.set(p.x + SUN_DIR.x * 200, p.y + SUN_DIR.y * 200, p.z + SUN_DIR.z * 200);
  }

  // t: the game's clock in seconds, which the clouds drift by; ?scenery's still city is drawn at 0.
  render(t = 0): void {
    this.sky.position.copy(this.camera.position);
    this.sky.material.uniforms.time.value = t;
    if (this.rain) {
      const u = (this.rain.material as THREE.ShaderMaterial).uniforms;
      u.time.value = t;
      u.eye.value.copy(this.camera.position);
    }
    // What a frame costs counts both, the world and what's over it (?stats, ?scenery's __kart).
    const r = this.renderer;
    r.info.autoReset = false;
    r.info.reset();
    if (this.quality === 'ultra') (this.ultra ??= new UltraFrame(r, this.scene, this.camera, this.sun)).render();
    else r.render(this.scene, this.camera);
    if (this.overlay?.visible) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.overlay, this.camera);
      r.autoClear = true;
    }
  }
}
