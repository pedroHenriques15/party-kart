// Braga, as cartoon: the Praça da República's fountain and the Arcada, the old town's houses, the
// Sé, the Arco da Porta Nova, Bom Jesus's church, stairway and funicular, the quarry stadium with
// its roof cables and the rock at one end. And the party: a stage, a disco ball, balloons.
import * as THREE from 'three';
import type { Tag } from '../track/layout.ts';
import { distanceToRoad, surfacePoint, type Track } from '../track/track.ts';
import { RIVER_HALF_W } from '../track/layout.ts';
import { SPOTS } from './braga.ts';
import { buildDriverFigure, DRIVERS } from './drivers.ts';
import { bake, mat as kitMat } from './kit.ts';
import * as tex from './textures.ts';
import { riverDistance } from './world.ts';

type Ground = (x: number, z: number) => number;

const mat = kitMat;
const WHITE = mat('#f3f0e8');
const STONE = mat('#b9ad98');
const GRANITE = mat('#9c968c');
const ROOF = mat('#b5532f');
const GOLD = mat('#d4af37', { metalness: 0.8, roughness: 0.3 });
const DARK = mat('#26262b');

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y + h / 2, z);
  b.castShadow = false;
  return b;
}

// A frame on the track: local x along it, z to its right.
function at(track: Track, i: number, lateral: number, up = 0): { pos: THREE.Vector3; yaw: number } {
  const N = track.samples.length;
  const s = track.samples[((i % N) + N) % N];
  const p = surfacePoint(s, lateral, up);
  return { pos: new THREE.Vector3(p.x, p.y, p.z), yaw: -Math.atan2(s.t.z, s.t.x) };
}

function place(obj: THREE.Object3D, x: number, y: number, z: number, yaw: number): THREE.Object3D {
  obj.position.set(x, y, z);
  obj.rotation.y = yaw;
  return obj;
}

export function buildLandmarks(track: Track, ground: Ground): { group: THREE.Group; update: (t: number) => void; stage: THREE.Vector3 } {
  const g = new THREE.Group();
  const updates: ((t: number) => void)[] = [];
  const stageSpot = new THREE.Vector3();
  const tag = (t: Tag) => track.tags.find((x) => x.tag === t)!.i;
  const onGround = (obj: THREE.Object3D, i: number, lateral: number, turn = 0) => {
    const f = at(track, i, lateral);
    g.add(place(obj, f.pos.x, ground(f.pos.x, f.pos.z), f.pos.z, f.yaw + turn));
    return obj;
  };

  // ---- The Praça da República: the fountain, the Arcada behind it. ----
  {
    const i = tag('fountain');
    const f = new THREE.Group();
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(10, 10.5, 0.9, 40), GRANITE);
    basin.position.y = 0.45;
    const water = new THREE.Mesh(new THREE.CylinderGeometry(9.4, 9.4, 0.1, 40), mat('#4fa3d9', { transparent: true, opacity: 0.8, roughness: 0.1 }));
    water.position.y = 0.8;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 3, 16), GRANITE);
    column.position.y = 1.5;
    f.add(basin, water, column);
    const jets: THREE.Mesh[] = [];
    const jetMat = mat('#e6f6ff', { transparent: true, opacity: 0.55, roughness: 0.1 });
    for (let k = 0; k < 9; k++) {
      const jet = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1, 8), jetMat);
      const a = (k / 8) * Math.PI * 2;
      jet.userData.moves = true;
      if (k < 8) jet.position.set(Math.cos(a) * 6, 0.8, Math.sin(a) * 6);
      else jet.position.set(0, 3, 0);
      f.add(jet);
      jets.push(jet);
    }
    updates.push((t) =>
      jets.forEach((j, k) => {
        const hgt = k === 8 ? 7 + Math.sin(t * 2) * 1.5 : 3 + Math.sin(t * 3 + k) * 0.8;
        j.scale.set(1, hgt, 1);
        j.position.y = (k === 8 ? 3 : 0.8) + hgt / 2;
      }),
    );
    onGround(f, i, -26);

    // The Arcada: a long arcaded front with a clock tower.
    const arc = new THREE.Group();
    arc.add(box(70, 14, 14, WHITE, 0, 0, 0));
    for (let k = -6; k <= 6; k++) {
      const pil = box(1.2, 6, 1.2, STONE, k * 5.4, 0, 7.4);
      arc.add(pil);
    }
    arc.add(box(72, 1.2, 16, ROOF, 0, 14, 0));
    arc.add(box(10, 8, 10, WHITE, 0, 14, 0));
    const clock = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), mat('#fffbe6'));
    clock.position.set(0, 18.5, 5.05);
    arc.add(clock);
    arc.add(box(11, 1, 11, ROOF, 0, 22, 0));
    onGround(arc, i - 10, -62, Math.PI);
  }

  // ---- The party at the start: the stage, a giant P. Kiddy, a disco ball over the Avenida. ----
  {
    const stage = new THREE.Group();
    stage.add(box(24, 1.6, 12, DARK, 0, 0, 0));
    for (const x of [-10, 10]) {
      stage.add(box(3, 7, 3, mat('#111'), x, 1.6, -2));
      for (const y of [3, 6]) {
        const cone = new THREE.Mesh(new THREE.CircleGeometry(1, 20), mat('#444'));
        cone.position.set(x, 1.6 + y, -0.45);
        stage.add(cone);
      }
    }
    stage.add(box(6, 1.2, 2, mat('#222'), 0, 1.6, -1));
    const big = buildDriverFigure(DRIVERS[0]);
    big.scale.setScalar(4);
    big.position.set(0, 1.6, -3);
    big.rotation.y = Math.PI / 2;
    stage.add(big);
    const signTex = tex.sign("P. KIDDY'S WHITE PARTY", 'all night long · Braga', '#fbfbf8', '#111');
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(22, 4), new THREE.MeshBasicMaterial({ map: signTex }));
    sign.position.set(0, 12, -3.5);
    stage.add(sign);
    onGround(stage, 40, 26, Math.PI);
    // The big P. Kiddy looks at the road; the lobby shows your car at the front of the stage.
    stage.updateMatrixWorld(true);
    big.lookAt(at(track, 40, 0).pos);
    big.rotateY(-Math.PI / 2);
    const front = at(track, 40, 22).pos;
    stageSpot.set(front.x, ground(front.x, front.z) + 1.6, front.z);

    const f = at(track, 90, 0, 14);
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6, 2), mat('#e9eef5', { metalness: 0.9, roughness: 0.12, flatShading: true, emissive: '#3a3f4a' }));
    ball.position.copy(f.pos);
    ball.userData.moves = true;
    g.add(ball);
    const wireMat = new THREE.LineBasicMaterial({ color: '#333' });
    const poleL = at(track, 90, -14);
    const poleR = at(track, 90, 14);
    for (const p of [poleL, poleR]) g.add(place(box(0.5, 18, 0.5, DARK), p.pos.x, p.pos.y, p.pos.z, 0));
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([poleL.pos.clone().setY(18), f.pos.clone().setY(18), poleR.pos.clone().setY(18)]), wireMat));
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([f.pos.clone().setY(18), f.pos]), wireMat));
    updates.push((t) => (ball.rotation.y = t * 0.8));
  }

  // ---- Balloons along the Avenida and at the gates. ----
  {
    const pts: THREE.Vector3[] = [];
    const N = track.samples.length;
    for (let i = N - 120; i < N + 300; i += 14) {
      for (const side of [-1, 1]) {
        const s = track.samples[i % N];
        if (!s.walls) continue;
        for (let k = 0; k < 3; k++) {
          const f = at(track, i, side * (s.w / 2 + 0.3), 1.6 + k * 0.5);
          pts.push(f.pos.add(new THREE.Vector3((k - 1) * 0.5, Math.random() * 0.4, (k % 2) * 0.4)));
        }
      }
    }
    const balloons = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 12, 10), mat('#ffffff', { roughness: 0.25 }), pts.length);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    pts.forEach((p, k) => {
      m.makeScale(1, 1.2, 1).setPosition(p);
      balloons.setMatrixAt(k, m);
      balloons.setColorAt(k, col.set(k % 3 === 0 ? '#d4af37' : k % 3 === 1 ? '#ffffff' : '#f2f2f2'));
    });
    g.add(balloons);
  }

  // ---- The old town: narrow houses with tiled roofs, the Sé, the Arco da Porta Nova. ----
  const se = tag('se');
  const taken = (i: number, side: number) =>
    (side > 0 && Math.abs(i - se) < 30) || Object.values(SPOTS).some((s) => s.side === side && Math.abs(i - s.i) <= s.half);
  houses(g, track, 290, 475, 4, OLD_TOWN, ground, 4, taken);
  houses(g, track, 2330, 2500, 5, AVENIDA, ground, 18, taken);
  {
    const cathedral = new THREE.Group();
    cathedral.add(box(32, 14, 16, STONE, -4, 0, 0));
    cathedral.add(box(33, 1, 17, ROOF, -4, 14, 0));
    for (const z of [-5.5, 5.5]) {
      cathedral.add(box(7, 25, 7, STONE, 14, 0, z));
      const pyr = new THREE.Mesh(new THREE.ConeGeometry(5.2, 6, 4), mat('#6d6a64'));
      pyr.rotation.y = Math.PI / 4;
      pyr.position.set(14, 28, z);
      cathedral.add(pyr);
    }
    cathedral.add(box(4, 9, 6, DARK, 17.6, 0, 0));
    const rose = new THREE.Mesh(new THREE.CircleGeometry(2.4, 24), mat('#3a3f5c'));
    rose.position.set(17.7, 12, 0);
    rose.rotation.y = Math.PI / 2;
    cathedral.add(rose);
    onGround(cathedral, tag('se'), 26, Math.PI / 2); // its front to the road
  }
  {
    const i = tag('arch');
    const s = track.samples[i];
    const span = s.w + 4;
    const shape = new THREE.Shape();
    shape.moveTo(-span / 2 - 3, 0);
    shape.lineTo(span / 2 + 3, 0);
    shape.lineTo(span / 2 + 3, 13);
    shape.lineTo(-span / 2 - 3, 13);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-span / 2, 0);
    hole.lineTo(span / 2, 0);
    hole.lineTo(span / 2, 7.5);
    hole.absarc(0, 7.5, span / 2, 0, Math.PI, false);
    hole.lineTo(-span / 2, 0);
    shape.holes.push(hole);
    const arch = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 3.5, bevelEnabled: false }), WHITE);
    body.position.z = -1.75;
    arch.add(body);
    for (const x of [-span / 2 - 2.2, span / 2 + 0.6]) arch.add(box(1.6, 13, 3.9, GRANITE, x + 0.8, 0, 0));
    arch.add(box(span + 8, 1.2, 4.2, GRANITE, 0, 13, 0));
    const crown = new THREE.Mesh(new THREE.ConeGeometry(3.4, 4, 3), WHITE);
    crown.rotation.x = Math.PI / 2;
    crown.rotation.z = Math.PI;
    crown.scale.set(1.6, 0.25, 1);
    crown.position.set(0, 16, 0);
    arch.add(crown);
    const statue = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 1.6, 4, 8), GRANITE);
    statue.position.set(0, 16.4, 0);
    arch.add(statue);
    const f = at(track, i, 0);
    // The arch spans the road: its face across the direction of travel.
    g.add(place(arch, f.pos.x, f.pos.y - 0.05, f.pos.z, f.yaw + Math.PI / 2));
  }

  // ---- Bom Jesus do Monte: the church at the top, its stairway, the funicular. ----
  {
    const church = new THREE.Group();
    church.add(box(26, 18, 16, WHITE, 0, 0, 0));
    church.add(box(27, 1, 17, GRANITE, 0, 18, 0));
    const ped = new THREE.Shape();
    ped.moveTo(-9, 0);
    ped.lineTo(9, 0);
    ped.lineTo(0, 6);
    ped.closePath();
    const pediment = new THREE.Mesh(new THREE.ExtrudeGeometry(ped, { depth: 1.5, bevelEnabled: false }), WHITE);
    pediment.position.set(0, 19, 7);
    church.add(pediment);
    for (const x of [-11, 11]) {
      church.add(box(6, 30, 6, WHITE, x, 0, 3));
      church.add(box(6.4, 0.8, 6.4, GRANITE, x, 30, 3));
      const dome = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), GRANITE);
      dome.position.set(x, 30.8, 3);
      church.add(dome);
      church.add(box(0.4, 3, 0.4, GOLD, x, 33.6, 3));
      church.add(box(1.6, 0.4, 0.4, GOLD, x, 35.4, 3));
    }
    for (const x of [-6, 0, 6]) church.add(box(1.2, 16, 1.3, GRANITE, x, 0, 8));
    church.add(box(4, 7, 1, DARK, 0, 0, 8.2));
    const rose = new THREE.Mesh(new THREE.CircleGeometry(1.8, 20), mat('#3a3f5c'));
    rose.position.set(0, 12, 8.35);
    church.add(rose);
    // On the hill's top, north of the road, facing it.
    const i = tag('church');
    const f = at(track, i, 0);
    const n = at(track, i, 44);
    g.add(place(church, n.pos.x, ground(n.pos.x, n.pos.z) - 0.5, n.pos.z, f.yaw + Math.PI));

    // The zigzag stairway, down the hill's east flank.
    const stairs = new THREE.Group();
    let x = 690;
    let z = -440;
    const flightMat = mat('#efece4');
    const wallMat = mat('#e0dccf');
    for (let k = 0; k < 9; k++) {
      const dir = k % 2 ? -1 : 1;
      const x2 = x + dir * 26;
      const z2 = z + 20;
      const y1 = ground(x, z) + 0.3;
      const y2 = ground(x2, z2) + 0.3;
      const len = Math.hypot(x2 - x, z2 - z, y2 - y1);
      const flight = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, 5), flightMat);
      flight.position.set((x + x2) / 2, (y1 + y2) / 2, (z + z2) / 2);
      flight.rotation.y = -Math.atan2(z2 - z, x2 - x);
      flight.rotation.z = Math.atan2(y2 - y1, Math.hypot(x2 - x, z2 - z));
      stairs.add(flight);
      for (const side of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2, 0.5), wallMat);
        w.position.copy(flight.position).add(new THREE.Vector3(0, 0.8, 0));
        w.rotation.copy(flight.rotation);
        w.translateZ(side * 2.6);
        stairs.add(w);
      }
      const landing = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.8, 16), flightMat);
      landing.position.set(x2, y2, z2);
      stairs.add(landing);
      const statue = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.4, 4, 8), STONE);
      statue.position.set(x2, y2 + 1.6, z2);
      stairs.add(statue);
      x = x2;
      z = z2;
    }
    g.add(stairs);

    // The funicular: rails down beside the jump, two little cars going up and down.
    const lip = tag('lip');
    const a = at(track, lip - 10, -20);
    const b = at(track, lip + 150, -20);
    const ya = ground(a.pos.x, a.pos.z) + 0.6;
    const yb = ground(b.pos.x, b.pos.z) + 0.6;
    const A = new THREE.Vector3(a.pos.x, ya, a.pos.z);
    const B = new THREE.Vector3(b.pos.x, yb, b.pos.z);
    const dir = B.clone().sub(A);
    const len = dir.length();
    const yaw = -Math.atan2(dir.z, dir.x);
    const pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    for (const off of [-1.2, 1.2]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.2, 0.2), DARK);
      rail.position.copy(A.clone().add(B).multiplyScalar(0.5));
      rail.rotation.set(0, yaw, pitch, 'YZX');
      rail.translateZ(off);
      g.add(rail);
    }
    const cars: THREE.Group[] = [];
    for (const color of ['#2f6fb0', '#e3b33b']) {
      const car = new THREE.Group();
      car.add(box(5, 3, 2.8, mat(color), 0, 0, 0));
      car.add(box(5.2, 0.4, 3, WHITE, 0, 3, 0));
      for (const x of [-1.5, 0, 1.5]) car.add(box(1, 1.2, 2.9, mat('#cfe7ff'), x, 1.5, 0));
      car.rotation.set(0, yaw, pitch, 'YZX');
      car.userData.moves = true;
      g.add(car);
      cars.push(car);
    }
    updates.push((t) => {
      const u = (Math.sin(t * 0.15) + 1) / 2;
      cars[0].position.copy(A.clone().lerp(B, 0.1 + u * 0.8));
      cars[1].position.copy(A.clone().lerp(B, 0.9 - u * 0.8));
    });
  }

  // ---- The quarry stadium: two stands, the roof's cables across, the rock and its tunnel. ----
  {
    const i0 = tag('stadium-in') + 8;
    const i1 = tag('stadium-out') - 4;
    const a = at(track, i0, 0);
    const b = at(track, i1, 0);
    const mid = a.pos.clone().add(b.pos).multiplyScalar(0.5);
    const yaw = -Math.atan2(b.pos.z - a.pos.z, b.pos.x - a.pos.x);
    const len = a.pos.distanceTo(b.pos);
    const stadium = new THREE.Group();
    const crowd = crowdTexture();
    crowd.repeat.set(len / 20, 1);
    const seats = new THREE.MeshLambertMaterial({ map: crowd });
    const concrete = mat('#b7b4ad');
    for (const side of [-1, 1]) {
      for (let k = 0; k < 5; k++) {
        const tier = new THREE.Mesh(new THREE.BoxGeometry(len, 3, 5), [concrete, concrete, concrete, concrete, side > 0 ? concrete : seats, side > 0 ? seats : concrete]);
        tier.position.set(0, 1.5 + k * 3, side * (17 + k * 4.5));
        stadium.add(tier);
      }
      stadium.add(box(len, 24, 2, concrete, 0, 0, side * 40));
      stadium.add(box(len + 6, 0.8, 22, mat('#dcdad4'), 0, 24, side * 30));
    }
    // The cables that hold the roofs up, across the pitch.
    const cable = new THREE.LineBasicMaterial({ color: '#4a4a4a' });
    for (let x = -len / 2 + 4; x < len / 2; x += 8) {
      stadium.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 24.4, -19), new THREE.Vector3(x, 22.5, 0), new THREE.Vector3(x, 24.4, 19)]), cable));
    }
    // A goal at the open end, to drive through.
    const post = mat('#ffffff');
    const goal = new THREE.Group();
    for (const z of [-3.66, 3.66]) goal.add(box(0.15, 2.44, 0.15, post, 0, 0, z));
    goal.add(box(0.15, 0.15, 7.5, post, 0, 2.44, 0));
    goal.position.set(-len / 2 + 6, 0, 0);
    stadium.add(goal);
    const ad = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.4), new THREE.MeshBasicMaterial({ map: tex.sign('BRAGA ♥ P. KIDDY  ·  MAKE KARTING GREAT AGAIN  ·  22 AVERAGE: EXACTLY OK', '', '#c8102e', '#ffffff', 2048, 96) }));
    ad.position.set(0, 0.8, 13.6);
    ad.rotation.y = Math.PI;
    stadium.add(ad);
    g.add(place(stadium, mid.x, mid.y - 1, mid.z, yaw));

    // The rock: a wall across the far end, a tunnel through it.
    const rockMat = new THREE.MeshLambertMaterial({ map: tex.rock() });
    const out = tag('stadium-out');
    const N = track.samples.length;
    for (let k = -2; k < 34; k += 3) {
      const s = track.samples[(out + k) % N];
      const f = at(track, out + k, 0);
      const half = s.w / 2 + 1;
      const thick = k === -2 ? 30 : 6;
      for (const side of [-1, 1]) {
        const block = new THREE.Mesh(new THREE.BoxGeometry(4, 34, thick), rockMat);
        block.position.set(0, 14, side * (half + thick / 2));
        g.add(place(new THREE.Group().add(block), f.pos.x, f.pos.y, f.pos.z, f.yaw));
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(4, 26, half * 2 + 2), rockMat);
      roof.position.set(0, 8 + 13, 0);
      g.add(place(new THREE.Group().add(roof), f.pos.x, f.pos.y, f.pos.z, f.yaw));
    }
    // The tunnel's lights.
    for (let k = 2; k < 32; k += 6) {
      const f = at(track, out + k, 0, 7.6);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 0.5), new THREE.MeshBasicMaterial({ color: '#fff3c4' }));
      g.add(place(lamp, f.pos.x, f.pos.y, f.pos.z, f.yaw));
    }
  }

  // ---- Billboards. ----
  const boards: [number, number, string, string][] = [
    [160, 1, 'MAKE KARTING GREAT AGAIN', 'Donald Trunk 2028'],
    [620, -1, 'LIL PAST', 'Back to the Future Tour'],
    [1000, 1, 'GUCCI PAIN ICE CREAM', 'now melting at Bom Jesus'],
    [1700, -1, '22 AVERAGE', 'the most okay album of the year'],
    [2200, 1, 'LIL BABYFACE', 'nap time is for losers'],
  ];
  for (const [i, side, text, sub] of boards) {
    const bb = new THREE.Group();
    for (const x of [-4, 4]) bb.add(box(0.4, 6, 0.4, DARK, x, 0, 0));
    const board = new THREE.Mesh(new THREE.PlaneGeometry(12, 3.2), new THREE.MeshBasicMaterial({ map: tex.sign(text, sub, '#111318', '#ffffff') }));
    board.position.y = 6.5;
    bb.add(board);
    const s = track.samples[i];
    onGround(bb, i, side * (s.w / 2 + 6), side > 0 ? Math.PI : 0);
    bb.rotation.y += (side > 0 ? -1 : 1) * 0.5 - Math.PI / 2;
  }

  // ---- Mountains far away. ----
  const far = new THREE.MeshStandardMaterial({ color: '#6f8270', roughness: 1, flatShading: true });
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2;
    const r = 1300 + (k % 3) * 120;
    const m = new THREE.Mesh(new THREE.ConeGeometry(260 + (k % 4) * 60, 140 + (k % 5) * 40, 6), far);
    m.position.set(200 + Math.cos(a) * r, 20, -230 + Math.sin(a) * r);
    g.add(m);
  }

  return { group: bake(g), update: (t) => updates.forEach((u) => u(t)), stage: stageSpot };
}

function crowdTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#c8102e';
  x.fillRect(0, 0, 256, 64);
  const colors = ['#fff', '#c8102e', '#ffe14d', '#1d1d1d', '#3b82f6', '#f4c7a1', '#7a4b2a'];
  for (let i = 0; i < 700; i++) {
    x.fillStyle = colors[i % colors.length];
    x.fillRect(Math.random() * 256, Math.random() * 64, 3, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// House fronts: plaster colour and shutters.
const OLD_TOWN: [string, string][] = [
  ['#f2e3c6', '#2f5d3a'],
  ['#e9c9c0', '#5a3a22'],
  ['#f4f0e6', '#2f4f7a'],
  ['#d9e2c8', '#5a3a22'],
  ['#f0d9a8', '#2f5d3a'],
  ['#cfdbe6', '#7a2f2f'],
];
const AVENIDA: [string, string][] = [
  ['#f4f0e6', '#2f4f7a'],
  ['#e8dcc7', '#2f5d3a'],
  ['#efe6d2', '#5a3a22'],
];

// Houses along both sides of a stretch of road, instanced by colour.
function houses(
  g: THREE.Group,
  track: Track,
  from: number,
  to: number,
  floors: number,
  colors: [string, string][],
  ground: Ground,
  setback = 4,
  skip: (i: number, side: number) => boolean = () => false,
): void {
  const byColor = colors.map(() => [] as THREE.Matrix4[]);
  const roofs: THREE.Matrix4[] = [];
  const N = track.samples.length;
  for (let i = from; i < to; i += 9) {
    const s = track.samples[i % N];
    for (const side of [-1, 1]) {
      if (skip(i, side)) continue;
      const depth = 9 + Math.random() * 4;
      const lateral = side * (s.w / 2 + setback + depth / 2);
      const p = surfacePoint(s, lateral, 0);
      if (distanceToRoad(track, p.x, p.z).d < depth / 2 + setback - 0.5) continue;
      if (riverDistance(p.x, p.z) < RIVER_HALF_W + 10) continue;
      const h = floors * 3.2 + Math.random() * 3;
      const yaw = -Math.atan2(s.t.z, s.t.x);
      const y = ground(p.x, p.z);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, y + h / 2, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(8.6, h, depth));
      byColor[Math.floor(Math.random() * colors.length)].push(m);
      roofs.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, y + h + 1.5, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + Math.PI / 4, 0)), new THREE.Vector3(6.9, 3, depth * 0.82)));
    }
  }
  colors.forEach(([color, shutters], k) => {
    const list = byColor[k];
    if (!list.length) return;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: tex.townFacade(color, floors, shutters), roughness: 0.9 }), list.length);
    list.forEach((m, j) => im.setMatrixAt(j, m));
    im.castShadow = true;
    im.receiveShadow = true;
    g.add(im);
  });
  const rm = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 4), ROOF, roofs.length);
  roofs.forEach((m, j) => rm.setMatrixAt(j, m));
  rm.castShadow = true;
  g.add(rm);
}
