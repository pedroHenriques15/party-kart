// Skid marks: dark streaks where the rear tyres drifted, fading as newer ones replace them.
import * as THREE from 'three';

const MAX = 1600; // segments, for everyone together

export class Skids {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(MAX * 6 * 3);
  private alpha = new Float32Array(MAX * 6);
  private next = 0;
  private last = new Map<string, { l: THREE.Vector3; r: THREE.Vector3 }>();

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.06, 0.06, 0.07, vA * 0.45); }',
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
  }

  // Marks under a car: its rear tyres at left and right, just above the road. Call every frame;
  // drifting false ends the streak.
  mark(id: string, drifting: boolean, left: THREE.Vector3, right: THREE.Vector3): void {
    const prev = this.last.get(id);
    if (!drifting) {
      this.last.delete(id);
      return;
    }
    if (prev && prev.l.distanceTo(left) > 0.4) {
      if (prev.l.distanceTo(left) < 6) {
        this.quad(prev.l, left);
        this.quad(prev.r, right);
      }
      this.last.set(id, { l: left.clone(), r: right.clone() });
    } else if (!prev) {
      this.last.set(id, { l: left.clone(), r: right.clone() });
    }
  }

  private quad(a: THREE.Vector3, b: THREE.Vector3): void {
    const dir = b.clone().sub(a);
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(0.17);
    const v = [a.clone().sub(side), a.clone().add(side), b.clone().add(side), a.clone().sub(side), b.clone().add(side), b.clone().sub(side)];
    const o = this.next * 18;
    v.forEach((p, k) => this.pos.set([p.x, p.y, p.z], o + k * 3));
    this.alpha.fill(1, this.next * 6, this.next * 6 + 6);
    this.next = (this.next + 1) % MAX;
    // Older marks fade: the oldest are about to be reused.
    for (let k = 0; k < 6; k++) this.alpha[((this.next + 40) % MAX) * 6 + k] *= 0.5;
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
  }
}
