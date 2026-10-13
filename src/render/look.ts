// The look: a golden-hour sky and sun, reflections of that sky on everything shiny, haze, and soft
// shadows that follow the action. Three levels of quality, for laptops that can't keep up. (The
// lights' glow is their own halos, in world.ts: a bloom pass can't tell this sky from a light.)
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export type Quality = 'high' | 'medium' | 'low';

// Late afternoon, the sun in the west-south-west.
export const SUN_DIR = new THREE.Vector3(-0.62, 0.46, 0.74).normalize();
const HAZE = new THREE.Color('#e7d6bf');

// The light's settings; ?exp=…&sun=… in the address override them, for tuning.
const q = new URLSearchParams(location.search);
const knob = (k: string, v: number) => (q.has(k) ? Number(q.get(k)) : v);
export const LIGHT = {
  exposure: knob('exp', 0.56),
  sun: knob('sun', 5.2),
  hemi: knob('hemi', 1.2),
  env: knob('env', 0.9),
  fog: knob('fog', 0.00022),
};

export class Look {
  readonly sun: THREE.DirectionalLight;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  quality: Quality = 'high';

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = LIGHT.exposure;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const sky = new Sky();
    sky.scale.setScalar(20000);
    const u = sky.material.uniforms;
    u.turbidity.value = 7;
    u.rayleigh.value = 1.9;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.86;
    u.sunPosition.value.copy(SUN_DIR).multiplyScalar(400000);
    scene.add(sky);

    // Reflections and soft ambient light, from that same sky.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene();
    const skyCopy = new Sky();
    skyCopy.scale.setScalar(20000);
    Object.assign(skyCopy.material.uniforms, THREE.UniformsUtils.clone(sky.material.uniforms));
    skyCopy.material.uniforms.sunPosition.value.copy(SUN_DIR).multiplyScalar(400000);
    skyScene.add(skyCopy);
    scene.environment = pmrem.fromScene(skyScene, 0, 1, 30000).texture;
    scene.environmentIntensity = LIGHT.env;

    scene.fog = new THREE.FogExp2(HAZE, LIGHT.fog);
    scene.add(new THREE.HemisphereLight('#bcd3f5', '#8a7f62', LIGHT.hemi));
    this.sun = new THREE.DirectionalLight('#ffd9a6', LIGHT.sun);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    Object.assign(this.sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
    scene.add(this.sun, this.sun.target);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const r = this.renderer;
    r.setPixelRatio(Math.min(q === 'high' ? 2 : q === 'medium' ? 1.25 : 1, devicePixelRatio));
    r.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
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
  }

  // Keep the sun's shadows around what we're looking at.
  follow(p: { x: number; y: number; z: number }): void {
    this.sun.target.position.set(p.x, p.y, p.z);
    this.sun.position.set(p.x + SUN_DIR.x * 200, p.y + SUN_DIR.y * 200, p.z + SUN_DIR.z * 200);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
