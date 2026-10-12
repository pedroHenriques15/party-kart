// More of Braga, cartoon-sized: the Theatro Circo on the Avenida, the Torre de Menagem and the
// BRAGA letters by the Praça; in the old town the Câmara Municipal with the Pelican fountain, the
// Capela dos Coimbras, the Jardim de Santa Bárbara with its medieval arches and the azulejo-clad
// Palácio do Raio; the lake at Bom Jesus with its rowing boats; the Sameiro sanctuary on its hill;
// the Roman ruins of Bracara Augusta; and the monastery of Tibães away to the west.
import * as THREE from 'three';
import type { Track } from '../track/track.ts';
import { at, bake, beside, box, mat, mesh, slab, type Ground } from './kit.ts';
import * as tex from './textures.ts';
import { LAKE } from './world.ts';

// Where the old town's landmarks stand, so no house is put there: sample, side (-1 left, 1
// right of the road), and how many samples either way they take.
export const SPOTS = {
  camara: { i: 318, side: -1, half: 18 },
  coimbras: { i: 343, side: -1, half: 8 },
  garden: { i: 391, side: -1, half: 12 },
  raio: { i: 433, side: 1, half: 12 },
  theatro: { i: 150, side: -1, half: 20 },
} as const;

const WHITE = mat('#f2eee4');
const CREAM = mat('#efe3c8');
const GRANITE = mat('#a7a091', { roughness: 0.9 });
const DARK = mat('#26262b');
const ROOF = mat('#b5532f');
const SLATE = mat('#4a5560', { roughness: 0.6, metalness: 0.2 });
const GOLD = mat('#e0b94a', { metalness: 1, roughness: 0.25 });
const GLASS = mat('#2c3b52', { roughness: 0.2, metalness: 0.3 });

function tri(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  return s;
}

// A front with arched openings: width w, height h, n arches of the given width and height.
function arcade(w: number, h: number, n: number, aw: number, ah: number, pointed = false): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h);
  s.lineTo(-w / 2, h);
  s.closePath();
  const gap = w / n;
  for (let k = 0; k < n; k++) {
    const cx = -w / 2 + gap * (k + 0.5);
    const p = new THREE.Path();
    p.moveTo(cx - aw / 2, 0.01);
    p.lineTo(cx + aw / 2, 0.01);
    p.lineTo(cx + aw / 2, ah - aw / 2);
    if (pointed) p.quadraticCurveTo(cx + aw / 2, ah, cx, ah + aw * 0.25);
    else p.absarc(cx, ah - aw / 2, aw / 2, 0, Math.PI, false);
    if (pointed) p.quadraticCurveTo(cx - aw / 2, ah, cx - aw / 2, ah - aw / 2);
    p.lineTo(cx - aw / 2, 0.01);
    s.holes.push(p);
  }
  return s;
}

function theatroCirco(): THREE.Group {
  const g = new THREE.Group();
  const front = tex.drawTexture(
    512,
    320,
    (c) => {
      c.fillStyle = '#efe3c8';
      c.fillRect(0, 0, 512, 320);
      // Ground floor: five arched doors.
      for (let k = 0; k < 5; k++) {
        const x = 46 + k * 94;
        c.fillStyle = '#c9b48f';
        c.fillRect(x - 6, 200, 64, 120);
        c.fillStyle = '#3a2a1e';
        c.beginPath();
        c.moveTo(x, 320);
        c.lineTo(x, 240);
        c.arc(x + 26, 240, 26, Math.PI, 0);
        c.lineTo(x + 52, 320);
        c.fill();
      }
      // First floor: tall windows between columns, the name above.
      for (let k = 0; k < 5; k++) {
        const x = 52 + k * 94;
        c.fillStyle = '#d8c7a3';
        c.fillRect(x - 18, 90, 6, 100);
        c.fillStyle = '#26354b';
        c.fillRect(x, 100, 40, 80);
        c.fillStyle = 'rgba(255,230,170,0.35)';
        c.fillRect(x + 4, 104, 14, 34);
      }
      c.fillStyle = '#d8c7a3';
      c.fillRect(0, 188, 512, 10);
      c.fillRect(0, 40, 512, 12);
      c.fillStyle = '#5a4630';
      c.font = '900 34px Georgia, serif';
      c.textAlign = 'center';
      c.fillText('THEATRO CIRCO', 256, 80);
    },
    false,
  );
  g.add(box(16, 22, 34, CREAM, 0, 0, 0));
  const face = mesh(new THREE.PlaneGeometry(34, 21), new THREE.MeshStandardMaterial({ map: front, roughness: 0.8 }), 8.02, 10.5, 0);
  face.rotation.y = Math.PI / 2;
  g.add(face);
  for (const z of [-17, 17]) {
    g.add(box(9, 26, 8, CREAM, 0, 0, z));
    const dome = mesh(new THREE.SphereGeometry(4.4, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), SLATE, 0, 26, z);
    dome.scale.set(1, 1.3, 0.95);
    g.add(dome);
    g.add(mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.4, 8), GOLD, 0, 32.6, z));
  }
  g.add(box(17, 1.2, 36, GRANITE, 0, 22, 0));
  for (let z = -14; z <= 14; z += 2) g.add(box(0.5, 1.4, 0.5, WHITE, 8, 23.2, z));
  g.add(mesh(new THREE.SphereGeometry(5, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), SLATE, -2, 23.2, 0));
  return g;
}

function torreDeMenagem(): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ map: tex.rock(), color: '#d8cfbd', roughness: 0.95 });
  g.add(box(11, 28, 11, stone));
  for (let k = 0; k < 4; k++) {
    for (let j = -2; j <= 2; j++) {
      const a = (k * Math.PI) / 2;
      const off = j * 2.2;
      g.add(box(1.3, 1.6, 1.3, stone, Math.cos(a) * 5.2 - Math.sin(a) * off, 28, Math.sin(a) * 5.2 + Math.cos(a) * off));
    }
  }
  for (const y of [8, 15, 22]) {
    g.add(box(0.2, 2.4, 0.7, DARK, 5.55, y, 0));
    g.add(box(0.7, 2.4, 0.2, DARK, 0, y, 5.55));
  }
  g.add(box(0.3, 3.4, 2.2, mat('#4a3424'), 5.55, 0, 0));
  // A bit of the old wall running off it.
  g.add(box(4, 9, 22, stone, 0, 0, -16));
  for (let z = -26; z < -6; z += 2.5) g.add(box(4.2, 1.2, 1.2, stone, 0, 9, z));
  return g;
}

// BRAGA in big red letters, voxel by voxel.
const FONT: Record<string, string[]> = {
  B: ['1111.', '1...1', '1...1', '1111.', '1...1', '1...1', '1111.'],
  R: ['1111.', '1...1', '1...1', '1111.', '1.1..', '1..1.', '1...1'],
  A: ['.111.', '1...1', '1...1', '11111', '1...1', '1...1', '1...1'],
  G: ['.111.', '1...1', '1....', '1.111', '1...1', '1...1', '.111.'],
};
function bragaLetters(): THREE.Group {
  const g = new THREE.Group();
  const cell = 0.62;
  const cubes: THREE.Matrix4[] = [];
  [...'BRAGA'].forEach((ch, n) => {
    FONT[ch].forEach((row, r) => {
      [...row].forEach((on, col) => {
        if (on === '1') cubes.push(new THREE.Matrix4().makeTranslation(0, (6 - r) * cell + cell / 2, (n * 6 + col - 14.5) * cell));
      });
    });
  });
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(cell * 1.6, cell * 0.98, cell * 0.98), mat('#d11f2c', { roughness: 0.35 }), cubes.length);
  cubes.forEach((m, k) => im.setMatrixAt(k, m));
  im.castShadow = true;
  g.add(im);
  g.add(box(2.4, 0.3, 20, GRANITE, 0, -0.3, 0));
  return g;
}

function palacioDoRaio(): THREE.Group {
  const g = new THREE.Group();
  const tiles = new THREE.MeshStandardMaterial({ map: tex.azulejo(3), roughness: 0.3 });
  const tilesSide = new THREE.MeshStandardMaterial({ map: tex.azulejo(3), roughness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(11, 14, 22), [tiles, tilesSide, ROOF, GRANITE, tilesSide, tilesSide]);
  body.position.set(0, 7, 0);
  body.castShadow = true;
  g.add(body);
  for (const z of [-11, 11]) g.add(box(0.8, 14.5, 1.2, GRANITE, 5.4, 0, z));
  g.add(box(1, 0.8, 23, GRANITE, 5.3, 14, 0));
  // The curved baroque top in the middle.
  const top = new THREE.Shape();
  top.moveTo(-5, 0);
  top.quadraticCurveTo(-5, 2.6, -2.2, 3.4);
  top.quadraticCurveTo(0, 5.6, 2.2, 3.4);
  top.quadraticCurveTo(5, 2.6, 5, 0);
  top.closePath();
  const crest = slab(top, 0.9, GRANITE);
  crest.rotation.y = Math.PI / 2;
  crest.position.set(5.3, 14.8, 0);
  g.add(crest);
  g.add(mesh(new THREE.SphereGeometry(0.5, 12, 8), GOLD, 5.3, 20.6, 0));
  const roof = mesh(new THREE.CylinderGeometry(0.1, 8, 4, 4), ROOF, 0, 16, 0);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 2);
  g.add(roof);
  return g;
}

function pelicanFountain(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(4.2, 4.5, 0.9, 28), GRANITE, 0, 0.45, 0));
  g.add(mesh(new THREE.CylinderGeometry(3.8, 3.8, 0.1, 28), mat('#4fa3d9', { roughness: 0.1 }), 0, 0.82, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.9, 3, 12), GRANITE, 0, 2.2, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.6, 1.2, 0.5, 18), GRANITE, 0, 3.8, 0));
  // The pelican.
  const bird = mat('#c8c3b8');
  g.add(mesh(new THREE.SphereGeometry(0.75, 14, 10).scale(1.3, 1, 1), bird, 0, 4.7, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.22, 1, 8), bird, 0.6, 5.4, 0).rotateZ(-0.4));
  g.add(mesh(new THREE.SphereGeometry(0.28, 10, 8), bird, 0.85, 5.95, 0));
  g.add(mesh(new THREE.ConeGeometry(0.12, 1, 8), mat('#d99a3a'), 1.35, 5.85, 0).rotateZ(-Math.PI / 2 + 0.2));
  for (const z of [-0.55, 0.55]) g.add(mesh(new THREE.SphereGeometry(0.5, 10, 8).scale(1.3, 0.35, 0.9), bird, -0.2, 5.0, z));
  return g;
}

function camaraMunicipal(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(14, 13, 32, WHITE));
  for (let z = -15; z <= 15; z += 5) g.add(box(0.6, 13, 0.9, GRANITE, 7.1, 0, z));
  g.add(box(1, 0.9, 33, GRANITE, 7, 13, 0));
  for (const y of [1.2, 7.2]) {
    for (let z = -12.5; z <= 12.5; z += 5) {
      g.add(box(0.2, 3.6, 2, GRANITE, 7.1, y, z));
      g.add(box(0.2, 3, 1.4, GLASS, 7.2, y + 0.3, z));
    }
  }
  g.add(box(0.4, 4.6, 3, mat('#4a3424'), 7.2, 0, 0));
  g.add(box(1.6, 0.3, 6, GRANITE, 7.6, 6.6, 0));
  for (let z = -2.8; z <= 2.8; z += 0.7) g.add(box(0.06, 1, 0.06, DARK, 8.3, 6.9, z));
  const ped = slab(tri(12, 4.2), 1.2, WHITE);
  ped.rotation.y = Math.PI / 2;
  ped.position.set(6.6, 13.9, 0);
  g.add(ped);
  g.add(mesh(new THREE.CircleGeometry(1, 20), GOLD, 7.25, 15.3, 0).rotateY(Math.PI / 2));
  const roof = mesh(new THREE.CylinderGeometry(0.1, 10, 4, 4), ROOF, -0.5, 15.9, 0);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 2.3);
  g.add(roof);
  const f = pelicanFountain();
  f.position.set(15, 0, 0);
  g.add(f);
  return g;
}

function capelaDosCoimbras(): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ map: tex.rock(), color: '#ddd3c0', roughness: 0.95 });
  g.add(box(8, 7, 12, stone, -2, 0, 3));
  const roof = mesh(new THREE.CylinderGeometry(0.1, 6, 3, 4), ROOF, -2, 8.5, 3);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 1.5);
  g.add(roof);
  g.add(box(6, 16, 6, stone, 0, 0, -6));
  for (let k = -1; k <= 1; k++) for (const s of [-1, 1]) g.add(box(1.1, 1.3, 1.1, stone, s * 2.5, 16, -6 + k * 2.4), box(1.1, 1.3, 1.1, stone, k * 2.4, 16, -6 + s * 2.5));
  g.add(box(0.2, 3.6, 1.6, mat('#4a3424'), 3.05, 0, -6));
  g.add(box(0.2, 2, 1.2, DARK, 3.05, 9, -6));
  g.add(mesh(new THREE.CircleGeometry(1.1, 18), mat('#3a3f5c'), 2.05, 5, 3).rotateY(Math.PI / 2));
  return g;
}

function santaBarbara(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(18, 0.1, 26, mat('#cdbf9f'), 0, 0, 0));
  const hedge = mat('#2f5d2a', { roughness: 0.95 });
  // Flower beds in a pattern, edged with box hedges.
  const beds: [number, number, number, number][] = [
    [-4, -7, 6, 8],
    [4, -7, 6, 8],
    [-4, 7, 6, 8],
    [4, 7, 6, 8],
  ];
  const flowers: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const palette = ['#e63946', '#ff8fc7', '#ffd166', '#ffffff', '#9b5de5', '#f77f00'];
  let seed = 5;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [x, z, w, d] of beds) {
    for (const s of [-1, 1]) {
      g.add(box(w, 0.6, 0.5, hedge, x, 0, z + (s * d) / 2));
      g.add(box(0.5, 0.6, d, hedge, x + (s * w) / 2, 0, z));
    }
    for (let k = 0; k < 70; k++) {
      flowers.push(new THREE.Matrix4().makeTranslation(x + (rnd() - 0.5) * (w - 1), 0.35 + rnd() * 0.2, z + (rnd() - 0.5) * (d - 1)));
      colors.push(new THREE.Color(palette[k % palette.length]));
    }
  }
  const fl = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), mat('#ffffff', { roughness: 0.6 }), flowers.length);
  flowers.forEach((m, k) => {
    fl.setMatrixAt(k, m);
    fl.setColorAt(k, colors[k]);
  });
  g.add(fl);
  for (const [x, z] of [
    [0, 0],
    [-7.5, 0],
    [7.5, 0],
  ]) {
    g.add(mesh(new THREE.ConeGeometry(0.9, 3, 10), hedge, x, 1.5, z));
  }
  // The medieval arcade at the back: pointed arches in granite.
  const stone = new THREE.MeshStandardMaterial({ map: tex.rock(), color: '#d4cab8', roughness: 0.95 });
  const wall = slab(arcade(26, 8, 5, 3.2, 6, true), 1.2, stone);
  wall.rotation.y = Math.PI / 2;
  wall.position.set(-9.5, 0, 0);
  g.add(wall);
  return g;
}

function bomJesusLake(ground: Ground): { group: THREE.Group; update: (t: number) => void } {
  const g = new THREE.Group();
  const y = ground(LAKE.x, LAKE.z) + 1.0;
  const normal = tex.ripples();
  const water = mesh(new THREE.CircleGeometry(LAKE.r + 1, 40), new THREE.MeshStandardMaterial({ color: '#2f6a78', roughness: 0.05, metalness: 0.1, normalMap: normal, normalScale: new THREE.Vector2(0.5, 0.5) }), LAKE.x, y, LAKE.z);
  water.rotation.x = -Math.PI / 2;
  g.add(water);
  const boats: THREE.Group[] = [];
  const hulls = ['#c8102e', '#2f6fb0', '#e3b33b'];
  for (let k = 0; k < 3; k++) {
    const b = new THREE.Group();
    b.add(mesh(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1.8, 0.6, 0.8), mat(hulls[k], { side: THREE.DoubleSide }), 0, 0.3, 0));
    b.add(box(0.3, 0.1, 1.4, mat('#8a6a48'), 0, 0.25, 0));
    b.userData.moves = true;
    g.add(b);
    boats.push(b);
  }
  return {
    group: g,
    update: (t) => {
      normal.offset.set(t * 0.02, t * 0.03);
      boats.forEach((b, k) => {
        const a = t * 0.08 + (k * Math.PI * 2) / 3;
        const r = LAKE.r * 0.55;
        b.position.set(LAKE.x + Math.cos(a) * r, y + Math.sin(t * 1.5 + k) * 0.06, LAKE.z + Math.sin(a) * r);
        b.rotation.y = -a;
      });
    },
  };
}

function sameiro(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(22, 20, 44, WHITE, 0, 0, 0));
  g.add(box(23, 1.2, 45, GRANITE, 0, 20, 0));
  const drum = mesh(new THREE.CylinderGeometry(7, 7, 8, 24), WHITE, 0, 25, -4);
  g.add(drum);
  g.add(mesh(new THREE.SphereGeometry(7.2, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), SLATE, 0, 29, -4));
  g.add(mesh(new THREE.CylinderGeometry(1.2, 1.4, 4, 10), WHITE, 0, 38, -4));
  g.add(mesh(new THREE.ConeGeometry(1.4, 2.5, 10), SLATE, 0, 41.2, -4));
  for (const x of [-8, 8]) {
    g.add(box(6, 32, 6, WHITE, x, 0, 20));
    g.add(mesh(new THREE.ConeGeometry(3.6, 6, 4), SLATE, x, 35, 20).rotateY(Math.PI / 4));
  }
  g.add(box(10, 14, 1, GRANITE, 0, 0, 22.5));
  g.add(box(4, 7, 0.4, mat('#4a3424'), 0, 0, 23.1));
  // The monumental stairs, and the column with the Virgin before them.
  for (let k = 0; k < 8; k++) g.add(box(30 - k * 1.5, 0.5, 3, GRANITE, 0, -4 + k * 0.5, 26 + (7 - k) * 3));
  g.add(mesh(new THREE.CylinderGeometry(0.9, 1.2, 26, 14), WHITE, 0, 13, 58));
  g.add(box(4, 3, 4, GRANITE, 0, 0, 58));
  g.add(mesh(new THREE.CapsuleGeometry(0.8, 2.2, 4, 10), GOLD, 0, 28, 58));
  return g;
}

function romanRuins(): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ map: tex.rock(), color: '#cfc4ad', roughness: 0.95 });
  const mosaic = tex.drawTexture(
    256,
    256,
    (c) => {
      c.fillStyle = '#d9c9a8';
      c.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 256; y += 8) {
        for (let x = 0; x < 256; x += 8) {
          const d = Math.hypot(x - 128, y - 128);
          const ring = Math.floor(d / 22) % 2;
          c.fillStyle = d < 40 ? '#8c2f1e' : ring ? '#2f4f6b' : '#e8dcc0';
          if ((x / 8 + y / 8) % 7 === 0) c.fillStyle = '#c99a3a';
          c.fillRect(x + 1, y + 1, 6, 6);
        }
      }
    },
    false,
  );
  const floor = mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ map: mosaic, roughness: 0.9 }), 0, 0.05, 0);
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [x, z, w, d] of [
    [-12, 0, 0.8, 26],
    [12, 0, 0.8, 26],
    [0, -13, 24, 0.8],
    [0, 13, 10, 0.8],
    [-5, 7, 0.8, 12],
  ]) {
    g.add(box(w, 0.6 + rnd() * 1.4, d, stone, x, 0, z));
  }
  for (let k = 0; k < 6; k++) {
    const h = k % 3 === 0 ? 5 : 0.8 + rnd() * 1.5;
    const x = -9 + k * 3.6;
    g.add(mesh(new THREE.CylinderGeometry(0.45, 0.5, h, 12), stone, x, h / 2, -10));
    if (h > 4) g.add(box(1.4, 0.5, 1.4, stone, x, h, -10));
  }
  return g;
}

function tibaes(): THREE.Group {
  const g = new THREE.Group();
  for (const [x, z, w, d] of [
    [0, 0, 60, 14],
    [-23, 22, 14, 44],
    [23, 22, 14, 44],
  ]) {
    g.add(box(w, 12, d, WHITE, x, 0, z));
    const roof = mesh(new THREE.CylinderGeometry(0.1, 1, 4, 4), ROOF, x, 14, z);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(w * 0.72, 1, d * 0.72);
    g.add(roof);
  }
  g.add(box(18, 20, 16, WHITE, 0, 0, -14));
  for (const x of [-7, 7]) {
    g.add(box(5, 28, 5, WHITE, x, 0, -21));
    g.add(mesh(new THREE.ConeGeometry(3, 5, 4), SLATE, x, 30.5, -21).rotateY(Math.PI / 4));
  }
  return g;
}

export function buildBraga(track: Track, ground: Ground): { group: THREE.Group; update: (t: number) => void } {
  const g = new THREE.Group();
  const N = track.samples.length;
  const w = (i: number) => track.samples[((i % N) + N) % N].w;
  const put = (obj: THREE.Object3D, i: number, side: number, setback: number) => g.add(beside(track, ground, obj, i, side * (w(i) / 2 + setback)));

  put(theatroCirco(), SPOTS.theatro.i, SPOTS.theatro.side, 14);
  put(torreDeMenagem(), N - 45, 1, 20);
  put(bragaLetters(), N - 22, -1, 6);
  put(camaraMunicipal(), SPOTS.camara.i, SPOTS.camara.side, 24);
  put(capelaDosCoimbras(), SPOTS.coimbras.i, SPOTS.coimbras.side, 9);
  put(santaBarbara(), SPOTS.garden.i, SPOTS.garden.side, 10);
  put(palacioDoRaio(), SPOTS.raio.i, SPOTS.raio.side, 9);
  put(romanRuins(), 1700, 1, 16);

  const lake = bomJesusLake(ground);
  g.add(lake.group);

  const sam = sameiro();
  sam.position.set(800, ground(800, -610) - 0.5, -610);
  sam.rotation.y = Math.atan2(-(545 - 800), -(-360 + 610)) + Math.PI; // facing Bom Jesus
  g.add(sam);

  const tib = tibaes();
  tib.position.set(-380, ground(-380, -500) - 0.5, -500);
  tib.rotation.y = 0.4;
  g.add(tib);

  // A sign for the Roman ruins.
  const sign = mesh(new THREE.PlaneGeometry(8, 1.6), new THREE.MeshBasicMaterial({ map: tex.sign('BRACARA AUGUSTA', 'Roman Braga, 16 BC', '#3a2c1c', '#f3e3c0', 1024, 200) }), 0, 0, 0);
  const f = at(track, 1690, w(1690) / 2 + 3, 2.2);
  sign.position.copy(f.pos);
  sign.rotation.y = f.yaw + Math.PI;
  g.add(sign);

  return { group: bake(g), update: lake.update };
}
