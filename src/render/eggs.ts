// The easter eggs along the Volta dos Amigos, one for each friend whose street it passes: Faísca
// the dog, who chases your kart down the road barking; a dentist's giant tooth that jumps for
// joy; the Contente supermarket, whose trolleys roll out to meet you; and a café, where your
// driver picks up a cigarette and a beer for the next stretch. They stand a little
// way along from the friends' houses, never at the door. Each browser's eggs react to its own
// kart only, so nothing about them goes over the network.
import * as THREE from 'three';
import { distanceToRoad, surfacePoint, type Track } from '../track/track.ts';
import { bake, box, mat, type Ground } from './kit.ts';
import * as tex from './textures.ts';

export type EggKind = 'dog' | 'dentist' | 'supermarket' | 'smoke';

// Where an egg stands: beside sample i, on one side, and the ground it needs kept clear.
export interface EggSpot {
  kind: EggKind;
  i: number;
  side: number;
  clear: { x: number; z: number; r: number };
}

// What just happened, for main.ts to make the sounds and say so.
export interface EggEvent {
  kind: EggKind | 'bark';
  at: THREE.Vector3;
}

export interface Eggs {
  group: THREE.Group;
  // focus: the kart this browser drives (its sample and speed), or null on the menus.
  update: (t: number, dt: number, focus: { idx: number; speed: number } | null) => EggEvent[];
}

const SET_BACK = { dog: 3.5, dentist: 6, supermarket: 13, smoke: 7 };
const CLEAR = { dog: 5, dentist: 7, supermarket: 16, smoke: 10 };

export function eggSpots(track: Track, eggs: { kind: string; x: number; z: number; side: number }[]): EggSpot[] {
  return eggs
    .filter((e): e is { kind: EggKind; x: number; z: number; side: number } => e.kind in SET_BACK)
    .map((e) => {
      const i = Math.max(0, distanceToRoad(track, e.x, e.z).i);
      const s = track.samples[i];
      const p = surfacePoint(s, e.side * (s.w / 2 + SET_BACK[e.kind]), 0);
      return { kind: e.kind, i, side: e.side, clear: { x: p.x, z: p.z, r: CLEAR[e.kind] } };
    });
}

// Is sample idx between `from` and `to` samples past sample i, round the loop? (Negative is before it.)
const within = (N: number, i: number, idx: number, from: number, to: number) => {
  let d = (idx - i + N) % N;
  if (d > N / 2) d -= N;
  return d >= from && d <= to;
};

export function buildEggs(track: Track, ground: Ground, spots: EggSpot[]): Eggs {
  const group = new THREE.Group();
  const N = track.samples.length;
  const updates: ((t: number, dt: number, focus: { idx: number; speed: number } | null, out: EggEvent[]) => void)[] = [];
  // Facing the road from beside sample i: its +x points at the road.
  const place = (obj: THREE.Object3D, i: number, lateral: number) => {
    const s = track.samples[i];
    const p = surfacePoint(s, lateral, 0);
    obj.position.set(p.x, ground(p.x, p.z), p.z);
    obj.rotation.y = -Math.atan2(s.t.z, s.t.x) + (lateral < 0 ? -Math.PI / 2 : Math.PI / 2);
    group.add(obj);
    return obj;
  };

  for (const spot of spots) {
    const s = track.samples[spot.i];
    const lateral = spot.side * (s.w / 2 + SET_BACK[spot.kind]);
    if (spot.kind === 'dog') updates.push(dog(track, ground, place, spot, lateral, group));
    if (spot.kind === 'dentist') updates.push(dentist(place, spot, lateral, N));
    if (spot.kind === 'supermarket') updates.push(supermarket(place, spot, lateral, N));
    if (spot.kind === 'smoke') updates.push(cafe(place, spot, lateral, N));
  }
  return {
    group,
    update: (t, dt, focus) => {
      const out: EggEvent[] = [];
      for (const u of updates) u(t, dt, focus, out);
      return out;
    },
  };
}

type Place = (obj: THREE.Object3D, i: number, lateral: number) => THREE.Object3D;
type Update = (t: number, dt: number, focus: { idx: number; speed: number } | null, out: EggEvent[]) => void;

// ---- Faísca: a tan dog by his kennel. Pass, and he's after you, barking, as fast as a kart. ----
function dog(track: Track, ground: Ground, place: Place, spot: EggSpot, lateral: number, world: THREE.Group): Update {
  const N = track.samples.length;
  const coat = mat('#c98c4f', { roughness: 0.9 });
  const dark = mat('#7a4c2a', { roughness: 0.9 });
  const white = mat('#f1e9dc', { roughness: 0.9 });
  const black = mat('#1b1b1d', { roughness: 0.5 });

  // The kennel he waits by.
  const home = new THREE.Group();
  home.add(box(1.4, 1.1, 1.2, mat('#d9cfbf'), -1.6, 0, 0.6));
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 1.0, 1.5, 4, 1), mat('#a8422c'));
  roof.rotation.set(0, Math.PI / 4, Math.PI / 2);
  roof.scale.set(0.6, 1, 1);
  roof.position.set(-1.6, 1.4, 0.6);
  home.add(roof);
  home.add(box(0.06, 0.6, 0.5, black, -0.88, 0, 0.6));
  place(home, spot.i, lateral);

  // The dog: +x is his nose.
  const d = new THREE.Group();
  const body = box(0.95, 0.42, 0.4, coat, 0, 0.5, 0);
  const chest = box(0.3, 0.36, 0.38, white, 0.36, 0.48, 0);
  const head = new THREE.Group();
  head.add(box(0.34, 0.32, 0.32, coat, 0, 0, 0), box(0.2, 0.15, 0.2, white, 0.24, 0.01, 0), box(0.06, 0.06, 0.08, black, 0.36, 0.1, 0));
  for (const z of [-0.12, 0.12]) head.add(box(0.05, 0.05, 0.05, black, 0.17, 0.18, z), box(0.08, 0.22, 0.05, dark, -0.07, 0.12, z * 1.6));
  bake(head);
  head.position.set(0.55, 0.82, 0);
  const collar = box(0.08, 0.1, 0.36, mat('#c8232c'), 0.42, 0.72, 0);
  const tail = new THREE.Group();
  tail.add(box(0.36, 0.08, 0.08, coat, 0.16, 0, 0));
  tail.position.set(-0.47, 0.7, 0);
  tail.rotation.z = 0.8;
  const legs: THREE.Group[] = [];
  for (const [x, z] of [[0.33, -0.13], [0.33, 0.13], [-0.33, -0.13], [-0.33, 0.13]]) {
    const leg = new THREE.Group();
    leg.add(box(0.1, 0.42, 0.1, coat, 0, -0.42, 0));
    leg.position.set(x, 0.42, z);
    legs.push(leg);
  }
  const torso = new THREE.Group();
  torso.add(body, chest, collar);
  bake(torso);
  d.add(torso, head, tail, ...legs);
  d.userData.moves = true;
  d.scale.setScalar(1.25);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.nameTag('Faísca', '#d4af37'), depthTest: false }));
  tag.scale.set(2.4, 0.6, 1);
  tag.position.set(0, 1.9, 0);
  tag.visible = false;
  d.add(tag);
  world.add(d);

  // At home: sitting by the kennel, facing the road.
  const sit = () => {
    const s = track.samples[spot.i];
    const p = surfacePoint(s, lateral - Math.sign(lateral) * 0.5, 0);
    d.position.set(p.x, ground(p.x, p.z) - 0.12, p.z);
    d.rotation.set(0, -Math.atan2(s.t.z, s.t.x) + (lateral < 0 ? -Math.PI / 2 : Math.PI / 2), 0.35);
    legs.forEach((l, k) => (l.rotation.z = k < 2 ? -0.35 : 0.9));
  };
  sit();
  let mode: 'home' | 'chase' | 'tired' = 'home';
  let at = spot.i; // where he is, in samples round the track
  let clock = 0;
  let lastBark = 0;
  let cool = -1e9;
  return (t, dt, focus, out) => {
    tail.rotation.y = Math.sin(t * (mode === 'home' ? 9 : 18)) * 0.6;
    if (mode === 'home') {
      if (focus && focus.speed > 5 && t - cool > 20 && within(N, spot.i, focus.idx, -2, 18)) {
        mode = 'chase';
        clock = 0;
        at = spot.i;
        tag.visible = true;
        out.push({ kind: 'dog', at: d.position.clone() });
      }
      return;
    }
    clock += dt;
    if (mode === 'chase' && focus) {
      // He runs to a few metres behind the kart, as fast as it goes, for about seven seconds.
      const behind = (focus.idx - 8 - at + N) % N;
      const gap = behind > N / 2 ? behind - N : behind;
      const speed = Math.min(38, Math.max(14, focus.speed + 4));
      if (gap > 0) at = (at + Math.min(gap, speed * dt)) % N;
      if (clock > 7 || gap > 90) {
        mode = 'tired';
        clock = 0;
      }
      if (t - lastBark > 0.45 + Math.random() * 0.4) {
        lastBark = t;
        out.push({ kind: 'bark', at: d.position.clone() });
      }
      const s = track.samples[Math.floor(at) % N];
      const side = Math.sign(lateral) * (s.w / 2 - 2.2);
      const p = surfacePoint(s, side, 0);
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(0, -Math.atan2(s.t.z, s.t.x), 0);
      const run = Math.sin(t * 22);
      legs.forEach((l, k) => (l.rotation.z = (k < 2 ? run : -run) * 0.8));
      head.position.y = 0.82 + Math.abs(run) * 0.05;
      return;
    }
    // Tired: he sits in the road a moment, then he's home again.
    if (mode === 'chase') mode = 'tired';
    legs.forEach((l, k) => (l.rotation.z = k < 2 ? -0.35 : 0.9));
    d.rotation.z = 0.35;
    if (clock > 3) {
      mode = 'home';
      cool = t;
      tag.visible = false;
      sit();
    }
  };
}

// ---- The dentist's: a giant smiling tooth on a plinth, a toothbrush, and the clinic's sign. ----
function dentist(place: Place, spot: EggSpot, lateral: number, N: number): Update {
  const g = new THREE.Group();
  const stone = mat('#e8e3d8', { roughness: 0.6 });
  g.add(box(2.4, 1, 2.4, stone, 0, 0, 0));
  const tooth = new THREE.Group();
  const enamel = mat('#fbfbf6', { roughness: 0.22, metalness: 0.05 });
  tooth.add(box(1.7, 1.2, 1.7, enamel, 0, 0.9, 0));
  for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
    const cusp = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), enamel);
    cusp.position.set(x, 2.15, z);
    tooth.add(cusp);
  }
  for (const z of [-0.45, 0.45]) {
    const root = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 12), enamel);
    root.rotation.z = Math.PI;
    root.position.set(0, 0.35, z);
    tooth.add(root);
  }
  // A face, towards the road.
  const eye = mat('#1b1b1d', { roughness: 0.3 });
  for (const z of [-0.35, 0.35]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), eye);
    e.position.set(0.86, 1.65, z);
    tooth.add(e);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.06, 6, 18, Math.PI), mat('#d23b5a'));
  smile.rotation.set(0, Math.PI / 2, Math.PI);
  smile.position.set(0.87, 1.3, 0);
  tooth.add(smile);
  // The toothbrush, leaning on it.
  const brush = new THREE.Group();
  brush.add(box(0.22, 3.2, 0.22, mat('#2b78d4'), 0, 0, 0), box(0.5, 0.5, 0.3, mat('#ffffff'), 0.22, 2.9, 0));
  brush.position.set(0.2, 0.2, 1.3);
  brush.rotation.x = -0.35;
  tooth.add(brush);
  bake(tooth);
  tooth.position.y = 1;
  tooth.userData.moves = true;
  g.add(tooth);
  // The sign beside it, on two posts.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.4), new THREE.MeshStandardMaterial({ map: tex.sign('CLÍNICA DENTÁRIA', 'Sorria!', '#eaf6fb', '#0f5a7a', 1024, 288), roughness: 0.5 }));
  sign.position.set(0.1, 3.2, -3.4);
  sign.rotation.y = Math.PI / 2;
  g.add(sign, box(0.15, 3.9, 0.15, mat('#9aa0a6'), 0, 0, -5.6), box(0.15, 3.9, 0.15, mat('#9aa0a6'), 0, 0, -1.2));
  place(g, spot.i, lateral);

  let start = -1e9;
  let cool = -1e9;
  return (t, _dt, focus, out) => {
    if (focus && focus.speed > 5 && t - cool > 15 && within(N, spot.i, focus.idx, -10, 12)) {
      start = cool = t;
      out.push({ kind: 'dentist', at: g.position.clone().add(new THREE.Vector3(0, 3, 0)) });
    }
    // A hop and a spin, then a gentle sway while it waits.
    const u = (t - start) / 1.6;
    if (u < 1) {
      tooth.position.y = 1 + Math.sin(u * Math.PI) * 2.6;
      tooth.rotation.y = u * Math.PI * 2;
    } else {
      tooth.position.y = 1;
      tooth.rotation.y = Math.sin(t * 0.8) * 0.15;
    }
  };
}

// ---- Contente: a supermarket with its red sign, and trolleys that roll out as you pass. ----
function supermarket(place: Place, spot: EggSpot, lateral: number, N: number): Update {
  const g = new THREE.Group();
  const wall = mat('#f1ece2', { roughness: 0.8 });
  // The shop: 22 m along the road, 14 deep, glass across the front; +x is the road.
  g.add(box(14, 7, 22, wall, -7, 0, 0));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(16, 3.6), mat('#22303d', { roughness: 0.15, metalness: 0.3 }));
  glass.rotation.y = Math.PI / 2;
  glass.position.set(0.02, 1.9, 0);
  g.add(glass);
  g.add(box(2.4, 0.3, 18, mat('#e2001a'), 1.2, 3.8, 0));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.4), new THREE.MeshBasicMaterial({ map: contenteSign(), toneMapped: false }));
  sign.rotation.y = Math.PI / 2;
  sign.position.set(0.05, 5.5, 0);
  g.add(sign);
  // The trolleys, in a row by the door.
  const trolleys: THREE.Group[] = [];
  const metal = mat('#9aa3ab', { metalness: 0.7, roughness: 0.35 });
  const red = mat('#e2001a');
  for (let k = 0; k < 4; k++) {
    const tr = new THREE.Group();
    tr.add(box(0.9, 0.55, 0.6, metal, 0, 0.35, 0), box(0.06, 0.06, 0.62, red, -0.5, 1.0, 0), box(0.06, 0.6, 0.06, metal, -0.47, 0.45, -0.28), box(0.06, 0.6, 0.06, metal, -0.47, 0.45, 0.28));
    for (const [x, z] of [[0.35, -0.25], [0.35, 0.25], [-0.35, -0.25], [-0.35, 0.25]]) tr.add(box(0.12, 0.12, 0.05, mat('#222'), x, 0, z));
    bake(tr);
    tr.position.set(3, 0, -6 + k * 1.1);
    tr.userData.moves = true;
    trolleys.push(tr);
    g.add(tr);
  }
  place(g, spot.i, lateral);

  let start = -1e9;
  let cool = -1e9;
  return (t, _dt, focus, out) => {
    if (focus && focus.speed > 5 && t - cool > 15 && within(N, spot.i, focus.idx, -40, -12)) {
      start = cool = t;
      out.push({ kind: 'supermarket', at: g.position.clone().add(new THREE.Vector3(0, 4, 0)) });
    }
    // Out towards the road and round, then back to the door.
    const u = Math.min(1, (t - start) / 5);
    trolleys.forEach((tr, k) => {
      const f = Math.sin(Math.min(1, u * 1.4) * Math.PI) * (1 - u * 0.2);
      tr.position.x = 3 + f * (4 + k * 0.8);
      tr.rotation.y = f * (k % 2 ? 1.2 : -1.2);
    });
  };
}

// ---- The café: a terrace on the pavement, and the tobacconist's sign. Pass it, and your driver
// has a cigarette in the mouth and a beer in the hand for a while (main.ts keeps the time). ----
function cafe(place: Place, spot: EggSpot, lateral: number, N: number): Update {
  const g = new THREE.Group();
  // The café itself, 10 m along the road and 7 deep, glass across the front; +x is the road.
  g.add(box(7, 4.2, 10, mat('#f3efe6', { roughness: 0.85 }), -3.5, 0, 0));
  g.add(box(0.4, 0.5, 10.4, mat('#cfc6b6', { roughness: 0.9 }), 0.05, 4.2, 0));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.6), mat('#2a3540', { roughness: 0.15, metalness: 0.3 }));
  glass.rotation.y = Math.PI / 2;
  glass.position.set(0.02, 1.4, 0);
  g.add(glass);
  // The awning, and the sign above it.
  const awning = box(1.8, 0.12, 9.6, mat('#7a1f2b', { roughness: 0.8 }), 0.9, 2.9, 0);
  awning.rotation.z = -0.25;
  g.add(awning);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.1), new THREE.MeshStandardMaterial({ map: tex.sign('CAFÉ · TABACARIA', '', '#1c3b2e', '#f4ead2', 1024, 140), roughness: 0.5 }));
  sign.rotation.y = Math.PI / 2;
  sign.position.set(0.04, 3.6, 0);
  g.add(sign);
  // The terrace: two tables under parasols, and their chairs.
  const metal = mat('#3a3d42', { metalness: 0.6, roughness: 0.4 });
  const cloth = mat('#e9e2d0', { roughness: 0.9 });
  for (const z of [-2.6, 2.6]) {
    g.add(box(0.08, 0.72, 0.08, metal, 2.6, 0, z), box(0.8, 0.04, 0.8, mat('#f6f6f2'), 2.6, 0.72, z));
    for (const dz of [-0.75, 0.75]) g.add(box(0.45, 0.45, 0.45, metal, 2.6, 0, z + dz));
    g.add(box(0.06, 2.4, 0.06, metal, 2.6, 0, z));
    const parasol = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.6, 8), cloth);
    parasol.position.set(2.6, 2.55, z);
    g.add(parasol);
  }
  place(g, spot.i, lateral);

  let cool = -1e9;
  return (t, _dt, focus, out) => {
    if (focus && focus.speed > 5 && t - cool > 20 && within(N, spot.i, focus.idx, -10, 10)) {
      cool = t;
      out.push({ kind: 'smoke', at: g.position.clone().add(new THREE.Vector3(0, 3, 0)) });
    }
  };
}

// The Contente sign: white letters on red, and a smiling "c".
function contenteSign(): THREE.CanvasTexture {
  return tex.drawTexture(
    1024,
    176,
    (g) => {
      g.fillStyle = '#e2001a';
      g.fillRect(0, 0, 1024, 176);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(120, 88, 62, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#e2001a';
      g.font = '900 104px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('c', 120, 80);
      g.fillStyle = '#ffffff';
      g.font = '800 110px system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillText('contente', 214, 84);
    },
    false,
  );
}
