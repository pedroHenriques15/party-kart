// The GPS's arrows on the street ahead (braga-map's task 107): chevrons laid on the route's surface for
// the next 100 m or so, pointing the way it goes, all in one draw call.
import * as THREE from 'three';
import type { Route } from '../world/route.ts';

// How far ahead they're laid, how far apart, and the first how far from you (m).
const AHEAD = 100;
const EVERY = 8;
const FIRST = 10;
const N = Math.floor((AHEAD - FIRST) / EVERY) + 1;

export class GpsArrows {
  readonly mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  constructor() {
    // A chevron 2.4 m across and 1.8 m long, flat on the ground, pointing along +x.
    const s = new THREE.Shape();
    s.moveTo(0.9, 0);
    s.lineTo(-0.9, 1.2);
    s.lineTo(-0.9, 0.55);
    s.lineTo(0.1, 0);
    s.lineTo(-0.9, -0.55);
    s.lineTo(-0.9, -1.2);
    s.closePath();
    const geo = new THREE.ShapeGeometry(s);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x3da5ff, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.InstancedMesh(geo, mat, N);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  // Laid from `along` metres on along the route, each on the surface at its point: `floor(x, z, y)`,
  // the surface there near height y, from the one before it on (you're at y), so a route under a deck
  // stays under it.
  update(route: Route, along: number, y: number, floor: (x: number, z: number, y: number) => number): void {
    const a = route.along;
    let n = 0;
    let k = 1;
    for (let d = along + FIRST; d < Math.min(route.length - 2, along + AHEAD) && n < N; d += EVERY) {
      while (k < a.length - 1 && a[k] < d) k++;
      const [ax, az] = route.pts[k - 1];
      const [bx, bz] = route.pts[k];
      const t = a[k] > a[k - 1] ? (d - a[k - 1]) / (a[k] - a[k - 1]) : 0;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      y = floor(x, z, y);
      this.q.setFromAxisAngle(this.up, -Math.atan2(bz - az, bx - ax));
      this.p.set(x, y + 0.06, z);
      this.mesh.setMatrixAt(n++, this.m.compose(this.p, this.q, this.one));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = n > 0;
  }
}
