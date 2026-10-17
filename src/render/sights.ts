// The sights a Bracarense steers by. Bom Jesus and the Sameiro on the hills to the east, seen from
// all over the track, and the hills of the horizon behind them; the cross on top of the Picoto;
// and along the way São João da Ponte's chapel (chapel.ts), the route's other chapels, São Lázaro's
// bell tower and two wayside shrines (chapels.ts), the Estádio 1.º de Maio (stadium.ts), the Altice
// Forum's α, Makro and the Tourigalo. At their real places and sizes from the map
// (braga-map's tools/world.mjs), but for Bom Jesus and the Sameiro, twice it, and the Tourigalo,
// five times. Far off, it's their outline against the sky that counts.
import type { Grid, Sight } from 'braga-map';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Track } from '../track/track.ts';
import { saoJoaoChapel } from './chapel.ts';
import { routeChapel, saoLazaroTower, shrine } from './chapels.ts';
import { bake, box, mat, mesh, type Ground } from './kit.ts';
import { stadium } from './stadium.ts';
import * as tex from './textures.ts';

const WHITE = () => mat('#ece7dc', { roughness: 0.75 });
// The sanctuaries on the hills are drawn twice their size: at three or four kilometres a church
// the real size is a few pixels across, and they're what you look for on the skyline.
const FAR_SCALE = 2;
const GRANITE = () => mat('#a49d90', { roughness: 0.85 });
const ROOF = () => mat('#9a4a33', { roughness: 0.8 });

// A sanctuary's length along its face, and across: the footprint's rectangle, turned to the face.
function along(s: { angle: number; L: number; W: number; face: number }): [number, number] {
  return Math.abs(Math.cos(s.angle - s.face)) > 0.7 ? [s.L, s.W] : [s.W, s.L];
}

// A gabled roof the length of x, w wide, rising h.
function gable(len: number, w: number, h: number, m: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  g.rotateY(Math.PI / 2);
  return mesh(g, m);
}

// A bell tower: a square shaft, a cornice, a lantern and a dome.
function tower(side: number, h: number, wall: THREE.Material, trim: THREE.Material, top: THREE.Material): THREE.Group {
  const t = new THREE.Group();
  t.add(box(side, h, side, wall, 0, 0, 0));
  for (const y of [h * 0.45, h * 0.75]) t.add(box(side + 0.6, 0.6, side + 0.6, trim, 0, y, 0));
  t.add(box(side + 0.8, 0.8, side + 0.8, trim, 0, h, 0));
  t.add(box(side * 0.7, side * 0.6, side * 0.7, wall, 0, h + 0.8, 0));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(side * 0.42, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), top);
  dome.position.y = h + 0.8 + side * 0.6;
  t.add(dome);
  t.add(box(0.25, side * 0.6, 0.25, trim, 0, h + 0.8 + side, 0));
  return t;
}

// ---- Bom Jesus do Monte: the basilica, white with granite, its twin towers looking west over the
// city, and the Escadório zigzagging white down the hill below it. ----
function bomJesus(s: Extract<Sight, { kind: 'bomjesus' }>, ground: Ground): THREE.Group {
  const g = new THREE.Group();
  const [half, wide] = along(s);
  const wall = WHITE();
  const trim = GRANITE();
  const church = new THREE.Group();
  // +x is its face, west.
  church.add(box(half * 2, 19, wide * 2, wall, 0, -4, 0));
  church.add(gable(half * 2, wide * 2, 7, ROOF()).translateY(15));
  church.add(box(1.2, 26, wide * 2 - 10, trim, half, -4, 0));
  for (const z of [-1, 1]) church.add(tower(7, 30, wall, trim, trim).translateX(half - 2).translateZ(z * (wide - 3.5)).translateY(-4));
  church.add(box(1.5, 4, 3, trim, half + 0.6, 22, 0));
  church.position.set(s.x, s.y, s.z);
  church.rotation.y = -s.face;
  church.scale.setScalar(FAR_SCALE);
  g.add(church);

  // The Escadório: a white stair between granite walls, straight down the slope from the church's
  // terrace to its foot, the lower flights zigzagging.
  const fx = s.x + Math.cos(s.face) * (half + 12) * FAR_SCALE;
  const fz = s.z + Math.sin(s.face) * (half + 12) * FAR_SCALE;
  const [ex, ez] = s.foot;
  const n = 30;
  const zig = (k: number) => (k > n * 0.55 ? (Math.floor(k / 2) % 2 ? 7 : -7) : 0);
  const at = (k: number): [number, number, number] => {
    const f = k / n;
    const x0 = fx + (ex - fx) * f;
    const z0 = fz + (ez - fz) * f;
    const L = Math.hypot(ex - fx, ez - fz);
    const o = zig(k);
    const x = x0 - ((ez - fz) / L) * o;
    const z = z0 + ((ex - fx) / L) * o;
    return [x, ground(x, z) + 0.6, z];
  };
  for (let k = 0; k < n; k++) {
    const [ax, ay, az] = at(k);
    const [bx, by, bz] = at(k + 1);
    const len = Math.hypot(bx - ax, bz - az);
    const flight = new THREE.Group();
    flight.add(box(len + 1.5, 2, 12, wall, 0, -1.6, 0));
    for (const side of [-1, 1]) flight.add(box(len + 1.5, 1.4, 1.2, trim, 0, 0.2, side * 6.4));
    flight.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    // Along the flight, tipped up the slope.
    flight.rotation.set(0, -Math.atan2(bz - az, bx - ax), Math.atan2(by - ay, len), 'YZX');
    g.add(flight);
  }
  return g;
}

// ---- The Sameiro: the sanctuary in grey granite, its dome high over the nave, two towers at its
// front, and the Virgin on her column in the square before it. ----
function sameiro(s: Extract<Sight, { kind: 'sameiro' }>, ground: Ground): THREE.Group {
  const g = new THREE.Group();
  const [half, wide] = along(s);
  const stone = mat('#bdb7ab', { roughness: 0.85 });
  const dark = mat('#8f897d', { roughness: 0.85 });
  const lead = mat('#7d8a8f', { roughness: 0.5, metalness: 0.3 });
  const church = new THREE.Group();
  church.add(box(half * 2, 24, wide * 2, stone, 0, -4, 0));
  church.add(gable(half * 2, wide * 2, 6, ROOF()).translateY(20));
  // The dome over the crossing, its top 50 m up.
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 10, 24), stone);
  drum.position.set(-half * 0.25, 25, 0);
  church.add(drum);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(9.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), lead);
  dome.position.set(-half * 0.25, 30, 0);
  church.add(dome);
  church.add(box(2.6, 6, 2.6, stone, -half * 0.25, 38.5, 0));
  church.add(box(0.5, 4, 0.5, dark, -half * 0.25, 44.5, 0));
  for (const z of [-1, 1]) church.add(tower(7, 30, stone, dark, lead).translateX(half - 3).translateZ(z * (wide - 3.5)).translateY(-4));
  church.position.set(s.x, s.y, s.z);
  church.rotation.y = -s.face;
  church.scale.setScalar(FAR_SCALE);
  g.add(church);
  // The column, and her on it.
  const [cx, cz] = s.statue;
  const cy = ground(cx, cz);
  const col = new THREE.Group();
  col.add(box(5, 3, 5, dark, 0, -1, 0));
  col.add(mesh(new THREE.CylinderGeometry(0.9, 1.1, 22, 16), stone, 0, 13, 0));
  col.add(box(2.6, 1, 2.6, dark, 0, 24, 0));
  col.add(mesh(new THREE.CylinderGeometry(0.5, 1.0, 3.6, 12), mat('#e9e6df'), 0, 26.8, 0));
  col.add(mesh(new THREE.SphereGeometry(0.45, 12, 8), mat('#e9e6df'), 0, 29, 0));
  col.position.set(cx, cy, cz);
  col.scale.setScalar(FAR_SCALE);
  g.add(col);
  return g;
}

// ---- The Picoto: the cross on its top, as its photo shows it (braga-map's task 021): white steel,
// a ring of rusted steel round where its arms cross, on a block of granite. The survey's vertex
// there is the cross itself. ----
function cruzeiro(s: { x: number; y: number; z: number }): THREE.Group {
  const g = new THREE.Group();
  const white = mat('#f1f0ec', { roughness: 0.5, metalness: 0.2 });
  // Its top 4.8 m over the ground and its arms 3.7, as the LiDAR saw them.
  g.add(mesh(new THREE.CylinderGeometry(0.6, 0.75, 1, 4).rotateY(Math.PI / 4), GRANITE(), 0, 0.5, 0));
  g.add(box(0.2, 3.8, 0.2, white, 0, 1, 0), box(0.2, 0.2, 2.3, white, 0, 3.6, 0));
  const ring = mesh(new THREE.TorusGeometry(0.6, 0.045, 6, 28), mat('#6e4a33', { roughness: 0.7, metalness: 0.3 }), 0, 3.7, 0);
  ring.rotation.y = Math.PI / 2;
  g.add(ring);
  g.position.set(s.x, s.y, s.z);
  return g;
}

// ---- The Tourigalo: the restaurant's mascot, half bull and half rooster (touro + galo), as
// Mapillary's photos show it (2018-2019), but five times its size and exaggerated, on purpose
// (braga-map's decision 015): about 25 m to the top of its comb. A black bull's body, heavy in the
// chest and the haunches, with a hump over its shoulders and a dewlap, on four thick legs with
// cloven hooves, its tail hanging to a tuft, and its testicles hanging huge between its hind legs,
// swinging; from its shoulders a rooster's neck under a mane of hackle feathers, the head crowing
// with its beak open, a big serrated red comb, red wattles, yellow eyes and ear lobes; "Tourigalo" in
// white script round both flanks. It stands straight on the grass, its head to the west. ----
const TOURIGALO_SCALE = 5;

function tourigalo(s: { x: number; y: number; z: number; face: number }, updates: ((t: number) => void)[]): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group(); // built at the statue's own size, then scaled up
  const black = mat('#18191b', { roughness: 0.55 });
  const sheen = mat('#23272b', { roughness: 0.32, metalness: 0.15 });
  const hoof = mat('#0c0c0d', { roughness: 0.4 });
  const red = mat('#a3352a', { roughness: 0.45 });
  const yellow = mat('#e3c22b', { roughness: 0.4 });
  const white = mat('#f4f1e8', { roughness: 0.3 });
  // An ellipsoid at (x, y, z), radius r stretched by (sx, sy, sz); finer when it's big.
  const blob = (m: THREE.Material, x: number, y: number, z: number, r: number, sx: number, sy: number, sz: number, into: THREE.Object3D = body) => {
    const fine = r * Math.max(sx, sy, sz) > 0.3;
    const o = mesh(new THREE.SphereGeometry(r, fine ? 20 : 12, fine ? 12 : 8), m, x, y, z);
    o.scale.set(sx, sy, sz);
    into.add(o);
    return o;
  };
  // A leg's stretch from a to b in the side view, at z: one smooth piece, its radius going from r0
  // to r1, swelling a little in the middle, rounded at both ends.
  const taper = (ax: number, ay: number, bx: number, by: number, z: number, r0: number, r1: number, swell = 0.03) => {
    const len = Math.hypot(bx - ax, by - ay);
    const pts = [new THREE.Vector2(0, -r0 * 0.55), new THREE.Vector2(r0 * 0.75, -r0 * 0.38)];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      pts.push(new THREE.Vector2(r0 + (r1 - r0) * t + swell * Math.sin(Math.PI * t), len * t));
    }
    pts.push(new THREE.Vector2(r1 * 0.75, len + r1 * 0.38), new THREE.Vector2(0, len + r1 * 0.55));
    const o = mesh(new THREE.LatheGeometry(pts, 18), black, ax, ay, z);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(bx - ax, by - ay, 0).normalize());
    body.add(o);
    return o;
  };
  // A body of revolution along x: its radius at each x, smoothed, turned round the axis.
  const outline = (profile: [number, number][]) => new THREE.SplineCurve(profile.map(([x, r]) => new THREE.Vector2(r, x))).getPoints(64);
  const turned = (pts: THREE.Vector2[], segments: number) => new THREE.LatheGeometry(pts, segments).rotateZ(-Math.PI / 2);

  // The bull's body: deep in the chest, slim at the waist, heavy in the haunches.
  const CY = 1.62;
  const DEPTH = 0.82; // the body is narrower across than it's deep
  const torsoLine = outline([[-2.0, 0.05], [-1.9, 0.5], [-1.6, 0.76], [-1.2, 0.82], [-0.6, 0.7], [0.1, 0.72], [0.7, 0.88], [1.2, 0.92], [1.6, 0.74], [1.85, 0.36], [1.9, 0.02]]);
  const torso = mesh(turned(torsoLine, 40), black, 0, CY, 0);
  torso.scale.z = DEPTH;
  body.add(torso);
  // Its radius at x, from the outline.
  const radiusAt = (x: number) => {
    let best = torsoLine[0];
    for (const p of torsoLine) if (Math.abs(p.y - x) < Math.abs(best.y - x)) best = p;
    return best.x;
  };
  blob(black, 0.85, 2.32, 0, 0.62, 1.2, 0.62, 0.74); // the hump over the shoulders
  blob(black, 0.95, 1.22, 0, 0.66, 1.15, 0.85, 0.8); // the brisket
  blob(black, 1.5, 1.0, 0, 0.42, 0.5, 1.05, 0.42); // the dewlap, in two folds
  blob(black, 1.36, 0.78, 0, 0.3, 0.6, 0.8, 0.36);
  blob(black, 0.0, 1.16, 0, 0.6, 1.8, 0.62, 0.86); // the belly
  for (const z of [-1, 1]) blob(black, -1.3, 1.74, z * 0.44, 0.6, 1.0, 1.05, 0.55); // the haunches' muscles
  // The legs: the front ones straight, the back ones bent at the hock and set wide (there's a lot
  // between them), thick down to the fetlocks, each on a cloven hoof.
  const cloven = (x: number, z: number) => {
    for (const side of [-1, 1]) {
      const toe = mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.24, 10), hoof, x + 0.02, 0.06, z + side * 0.105);
      toe.scale.x = 1.35;
      body.add(toe);
    }
  };
  for (const side of [-1, 1]) {
    const zf = side * 0.42;
    taper(1.05, 1.38, 1.1, 0.62, zf, 0.33, 0.22, 0.03);
    taper(1.1, 0.62, 1.13, 0.2, zf, 0.22, 0.17, 0.01);
    cloven(1.13, zf);
    const zr = side * 0.52;
    taper(-1.12, 1.72, -1.5, 0.7, zr, 0.42, 0.21, 0.05);
    taper(-1.5, 0.7, -1.38, 0.2, zr, 0.21, 0.17, 0.01);
    cloven(-1.38, zr);
  }
  // The tail, from the top of the rump down to its tuft by the hocks.
  const tail = new THREE.CatmullRomCurve3([[-1.9, 2.2], [-2.08, 1.95], [-2.16, 1.5], [-2.18, 1.05], [-2.14, 0.7]].map(([x, y]) => new THREE.Vector3(x, y, 0)));
  body.add(mesh(new THREE.TubeGeometry(tail, 28, 0.075, 10), black));
  for (const [dx, dz] of [[0, 0], [-0.05, 0.07], [0.04, -0.07]]) blob(sheen, -2.14 + dx, 0.6, dz, 0.13, 0.75, 1.9, 0.75);

  // The testicles, hanging huge between the hind legs, nearly to the grass, on their own pivot so
  // they swing.
  {
    const parts = [
      new THREE.CapsuleGeometry(0.3, 0.3, 6, 18).translate(0, -0.3, 0), // the neck of the sac
      ...[-1, 1].map((side) => new THREE.SphereGeometry(0.47, 26, 18).scale(0.92, 1.1, 0.86).translate(0.02, -0.6, side * 0.27)),
    ].map((p) => (p.index ? p.toNonIndexed() : p));
    for (const p of parts) for (const a of Object.keys(p.attributes)) if (!['position', 'normal', 'uv'].includes(a)) p.deleteAttribute(a);
    const sac = new THREE.Mesh(mergeGeometries(parts)!, black);
    sac.castShadow = true;
    sac.receiveShadow = true;
    const pivot = new THREE.Group();
    pivot.position.set(-1.55, 1.22, 0);
    pivot.add(sac);
    pivot.userData.moves = true;
    body.add(pivot);
    updates.push((t) => {
      pivot.rotation.x = Math.sin(t * 1.3) * 0.07;
      pivot.rotation.z = Math.sin(t * 0.9 + 1) * 0.06;
    });
  }

  // The rooster: a thick neck rising from the shoulders, leaning a little forward, with its mane of
  // hackle feathers draped down it in rings, tapering up into the head.
  const neck = new THREE.Group();
  neck.position.set(1.32, 1.75, 0);
  neck.rotation.z = -0.16;
  neck.scale.z = 0.86;
  body.add(neck);
  const neckLine = new THREE.SplineCurve([[0.0, -0.2], [0.64, -0.2], [0.7, 0.25], [0.62, 0.9], [0.52, 1.5], [0.47, 1.9], [0.46, 2.1], [0.32, 2.36], [0.0, 2.42]].map(([r, y]) => new THREE.Vector2(r, y))).getPoints(32);
  neck.add(mesh(new THREE.LatheGeometry(neckLine, 32), black));
  const neckR = (y: number) => neckLine.reduce((b, p) => (Math.abs(p.y - y) < Math.abs(b.y - y) ? p : b)).x;
  for (const [y, n, len] of [[1.85, 16, 0.5], [1.5, 18, 0.62], [1.12, 20, 0.7], [0.74, 22, 0.72]] as const) {
    for (let k = 0; k < n; k++) {
      const a = ((k + (y * 3) % 1) / n) * Math.PI * 2;
      const r = neckR(y) + 0.03;
      const feather = mesh(new THREE.ConeGeometry(0.11, len, 6), sheen, Math.cos(a) * r, y - len * 0.42, Math.sin(a) * r);
      feather.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(a) * 0.2, -1, Math.sin(a) * 0.2).normalize());
      feather.scale.set(1, 1, 0.28);
      neck.add(feather);
    }
  }
  // The head.
  const HX = 1.86;
  const HY = 3.76;
  blob(black, HX, HY, 0, 0.5, 1.22, 1.0, 0.9);
  // The comb: big serrated red lobes standing in a row over the head, back to front, the middle
  // ones tallest, on a fleshy base.
  blob(red, HX - 0.12, HY + 0.44, 0, 0.6, 1.1, 0.5, 0.3);
  for (let k = 0; k < 7; k++) {
    const a = ((162 - k * 24) * Math.PI) / 180;
    const big = 1 - Math.abs(k - 3) * 0.1;
    blob(red, HX - 0.1 + Math.cos(a) * 0.62, HY + 0.32 + Math.sin(a) * 0.7, 0, 0.3 * big, 0.9, 1.45, 0.3);
  }
  // The beak open, crowing: the upper half hooked at its tip, the lower dropped.
  const upper = mesh(new THREE.ConeGeometry(0.19, 0.7, 16).rotateZ(-Math.PI / 2 - 0.12), yellow, HX + 0.82, HY - 0.05, 0);
  upper.scale.z = 0.8;
  body.add(upper);
  const hook = mesh(new THREE.ConeGeometry(0.06, 0.16, 8).rotateZ(Math.PI), yellow, HX + 1.12, HY - 0.15, 0);
  body.add(hook);
  const lower = mesh(new THREE.ConeGeometry(0.13, 0.52, 14).rotateZ(-Math.PI / 2 - 0.5), yellow, HX + 0.66, HY - 0.3, 0);
  lower.scale.z = 0.75;
  body.add(lower);
  blob(red, HX + 0.55, HY - 0.18, 0, 0.1, 1, 0.6, 1.1); // the inside of the mouth
  for (const z of [-1, 1]) {
    blob(hoof, HX + 0.72, HY + 0.08, z * 0.07, 0.03, 1.4, 1, 1); // a nostril
    blob(red, HX + 0.4, HY - 0.55, z * 0.1, 0.26, 0.7, 1.55, 0.35); // the wattles
    blob(yellow, HX + 0.24, HY - 0.16, z * 0.42, 0.13, 0.6, 1.05, 0.3); // the ear lobes
    blob(yellow, HX + 0.3, HY + 0.12, z * 0.37, 0.15, 1, 1, 0.45); // the eyes: a ring, the white, the pupil
    blob(white, HX + 0.31, HY + 0.12, z * 0.41, 0.09, 1, 1, 0.5);
    blob(hoof, HX + 0.33, HY + 0.13, z * 0.445, 0.05, 1, 1, 0.5);
  }

  // "Tourigalo" round each flank: the script on a strip that follows the body's own curve.
  const name = new THREE.MeshStandardMaterial({ map: tex.script('Tourigalo', '#f4f4f0'), transparent: true, depthWrite: false, roughness: 0.6, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const [x0, x1, f0, f1, nx, nf] = [-0.72, 0.56, -0.26, 0.26, 16, 4];
    const pos: number[] = [];
    const uv: number[] = [];
    for (let j = 0; j <= nf; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = x0 + ((x1 - x0) * i) / nx;
        const f = f0 + ((f1 - f0) * j) / nf;
        const r = radiusAt(x) + 0.015;
        pos.push(x, CY + r * Math.sin(f), side * DEPTH * r * Math.cos(f));
        uv.push(side > 0 ? i / nx : 1 - i / nx, j / nf);
      }
    }
    const index: number[] = [];
    for (let j = 0; j < nf; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      index.push(a, a + 1, a + nx + 1, a + 1, a + nx + 2, a + nx + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const strip = new THREE.Mesh(geo, name);
    strip.castShadow = false;
    body.add(strip);
  }
  // The stone by its front hoof.
  const stone = mesh(new THREE.DodecahedronGeometry(0.3), mat('#8f8a82', { roughness: 0.95 }), 1.78, 0.08, -0.62);
  stone.scale.set(1.4, 0.6, 1);
  body.add(stone);

  body.scale.setScalar(TOURIGALO_SCALE);
  g.add(body);
  g.position.set(s.x, s.y, s.z);
  g.rotation.y = -s.face;
  return g;
}

// The ground it needs to itself: no tree or building inside it.
export const TOURIGALO_CLEAR = 2.6 * TOURIGALO_SCALE;

// The restaurant behind it: a grey band along the top of its front with "Restaurante" in green
// script, and a red board by the door.
function restaurant(f: { x: number; z: number; face: number; L: number }, ground: Ground): THREE.Group {
  const g = new THREE.Group();
  const top = 5.2;
  g.add(box(0.4, 1.3, 2 * f.L, mat('#b9bec2', { roughness: 0.45, metalness: 0.4 }), 0.2, top - 1.3, 0));
  const word = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.25), new THREE.MeshStandardMaterial({ map: tex.script('Restaurante', '#3f9a4a', '#1f5a28', 1024, 128), transparent: true, depthWrite: false, roughness: 0.5 }));
  word.rotation.y = Math.PI / 2;
  word.position.set(0.42, top - 0.65, -2);
  g.add(word);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.9), new THREE.MeshStandardMaterial({ map: tex.sign('TOURIGALO', 'churrasqueira', '#c8102e', '#ffffff', 512, 136, ''), roughness: 0.5 }));
  board.rotation.y = Math.PI / 2;
  board.position.set(0.04, 3.0, f.L - 4.5);
  g.add(board);
  g.position.set(f.x, ground(f.x, f.z), f.z);
  g.rotation.y = -f.face;
  return g;
}

// ---- A sign along a building's front: Makro's yellow and black. ----
function fascia(s: { x: number; z: number; face: number; L: number }, ground: Ground, text: string, bg: string, fg: string, height: number, top: number): THREE.Group {
  const g = new THREE.Group();
  const width = Math.min(2 * s.L - 2, Math.max(12, text.length * height * 0.62));
  g.add(box(0.5, height + 0.6, width + 0.6, mat(bg), 0.3, top - height - 0.3, 0));
  const board = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: tex.sign(text, '', bg, fg, 1024, Math.round((1024 * height) / width), ''), toneMapped: false }));
  board.rotation.y = Math.PI / 2;
  board.position.set(0.56, top - height / 2, 0);
  g.add(board);
  g.position.set(s.x, ground(s.x, s.z), s.z);
  g.rotation.y = -s.face;
  return g;
}

// ---- The Altice Forum's α, high on its hall's west face, standing a little out from it. ----
function alticeLogo(s: Extract<Sight, { kind: 'altice' }>): THREE.Group {
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshStandardMaterial({ map: tex.alpha(), alphaTest: 0.5, roughness: 0.5, side: THREE.DoubleSide }));
  face.rotation.y = Math.PI / 2;
  face.position.set(0.6, s.h, 0);
  g.add(face);
  g.position.set(s.x, s.y, s.z);
  g.rotation.y = -s.face;
  return g;
}

export function buildSights(list: Sight[], track: Track, ground: Ground, far: Ground): { group: THREE.Group; update: (t: number) => void } {
  const group = Object.assign(new THREE.Group(), { name: 'sights' });
  const updates: ((t: number) => void)[] = [];
  const route = new THREE.Group();
  for (const s of list) {
    let g: THREE.Group | null = null;
    if (s.kind === 'bomjesus') g = bomJesus({ ...s, y: far(s.x, s.z) }, far);
    if (s.kind === 'sameiro') g = sameiro({ ...s, y: far(s.x, s.z) }, far);
    if (s.kind === 'cruzeiro') g = cruzeiro({ ...s, y: ground(s.x, s.z) });
    if (s.kind === 'tourigalo') {
      g = tourigalo({ ...s, y: ground(s.x, s.z) }, updates);
      if (s.sign) group.add(bake(restaurant(s.sign, ground)));
    }
    if (s.kind === 'makro') g = fascia(s, ground, 'makro', '#ffd400', '#111111', 6, 10);
    if (s.kind === 'altice') g = alticeLogo({ ...s, y: ground(s.x, s.z) });
    if (s.kind === 'stadium') g = stadium({ ...s, y: ground(s.x, s.z) }, ground);
    // On the ground at its front, the square it looks to.
    if (s.kind === 'saojoao') g = saoJoaoChapel({ ...s, y: ground(s.x + Math.cos(s.face) * (s.L - 4.8), s.z + Math.sin(s.face) * (s.L - 4.8)) });
    // The route's other chapels, São Lázaro's tower and the shrines, on the ground at their fronts
    // too, baked together: small and of the same few materials, they're a draw call a material so.
    const front = 'L' in s && 'face' in s ? ground(s.x + Math.cos(s.face) * s.L, s.z + Math.sin(s.face) * s.L) : 0;
    if (s.kind === 'chapel') route.add(routeChapel({ ...s, y: front }));
    if (s.kind === 'saolazaro') route.add(saoLazaroTower({ ...s, y: front }));
    if (s.kind === 'shrine') route.add(shrine({ ...s, y: front }));
    if (g) group.add(bake(g));
  }
  if (route.children.length) group.add(bake(route));
  return { group, update: (t) => updates.forEach((u) => u(t)) };
}

// The horizon: the hills 15 km round, every 250 m, from the coarser relief; where the map's own
// far hills are, it stays out of the way underneath them.
export function horizon(h: Grid, inner: Grid): THREE.Mesh {
  const ix1 = inner.x0 + (inner.nx - 1) * inner.step;
  const iz1 = inner.z0 + (inner.nz - 1) * inner.step;
  const inside = (x: number, z: number, m: number) => x > inner.x0 + m && x < ix1 - m && z > inner.z0 + m && z < iz1 - m;
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const low = new THREE.Color('#62764a');
  const high = new THREE.Color('#4a5e3c');
  const town = new THREE.Color('#99958b');
  for (let j = 0; j < h.nz; j++) {
    for (let i = 0; i < h.nx; i++) {
      const x = h.x0 + i * h.step;
      const z = h.z0 + j * h.step;
      let y = h.h[j * h.nx + i];
      if (inside(x, z, 0)) y -= 12;
      pos.push(x, y, z);
      const n = Math.sin(x * 0.0013 + Math.sin(z * 0.0009) * 2) * Math.cos(z * 0.0017 + Math.sin(x * 0.0011) * 2);
      c.copy(low).lerp(high, Math.min(1, Math.max(0, y / 300)) * 0.8 + n * 0.2);
      // Villages and towns in the valleys.
      if (y < 80) c.lerp(town, Math.max(0, n) * 0.5);
      col.push(c.r, c.g, c.b);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < h.nz - 1; j++) {
    for (let i = 0; i < h.nx - 1; i++) {
      if (inside(h.x0 + (i + 0.5) * h.step, h.z0 + (j + 0.5) * h.step, 300)) continue;
      const a = j * h.nx + i;
      idx.push(a, a + h.nx, a + 1, a + 1, a + h.nx, a + h.nx + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
}
