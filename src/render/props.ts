// A round's cover drawn (world/cover.ts): the cars parked in the arena and the road works' things, each
// as the ground has it, made of boxes and cylinders with canvas textures as the rest of the game is,
// baked together by material. Where the CC0 models a round's things can be drawn with are in
// src/fight/models (prop-<kind>.glb: prop-car.glb, prop-skip.glb, ...), each kind that has one is drawn
// with it instead once it's loaded, fitted to the thing's size, a car's paint tinted its colour.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Field } from '../game/field.ts';
import { SIZE, type Prop, type PropKind } from '../world/cover.ts';
import { bake, box, mat, mesh } from './kit.ts';
import * as tex from './textures.ts';

// The models there are (src/fight/ASSETS.md), and which each kind is drawn with: a car one of three, by
// its number; the kinds with none (or whose own shape matters more, a scaffold's platform, a hoarding's
// sign) as they're made here.
const MODELS = import.meta.glob('../fight/models/prop-*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const FILES: Partial<Record<PropKind, string[]>> = {
  car: ['car-sedan', 'car-hatchback', 'car-suv'],
  van: ['car-van'],
  skip: ['skip'],
  crate: ['crate'],
  box: ['crate'],
  drum: ['drum'],
  toilet: ['portaloo'],
  sandbags: ['sandbags'],
  jersey: ['jersey-barrier'],
  bricks: ['pallet-bricks'],
};
const modelsOf = (kind: PropKind): string[] => (FILES[kind] ?? []).map((n) => MODELS[`../fight/models/prop-${n}.glb`]).filter((u): u is string => !!u);

// Cars' paints, as Braga's streets have them: mostly greys, white and black, a few colours.
const PAINTS = ['#e8e8e6', '#c9ccce', '#8d9196', '#4a4e54', '#1c1e21', '#1d2f55', '#7a1c1c', '#2f4a3a', '#b8b0a0', '#d9d4c8', '#5a6b7c', '#9a2a20'];

// The things' textures, drawn once.
let T: ReturnType<typeof textures> | null = null;
function textures() {
  const draw = tex.drawTexture;
  const noise = (g: CanvasRenderingContext2D, w: number, h: number, n: number, a: number) => {
    for (let i = 0; i < n; i++) {
      const v = Math.floor(Math.random() * 255);
      g.fillStyle = `rgba(${v},${v},${v},${a})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  };
  return {
    planks: tex.planks(),
    mesh: tex.chainLink(),
    // A skip's steel, painted yellow and knocked about.
    skip: draw(128, 128, (g) => {
      g.fillStyle = '#d9a514';
      g.fillRect(0, 0, 128, 128);
      for (let x = 0; x < 128; x += 32) {
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(x, 0, 4, 128);
      }
      for (let i = 0; i < 30; i++) {
        g.fillStyle = `rgba(110,60,20,${0.1 + Math.random() * 0.25})`;
        g.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 10, 1 + Math.random() * 4);
      }
      noise(g, 128, 128, 1500, 0.08);
    }),
    // Plywood, for a hoarding's panel and a scaffold's boards.
    ply: draw(128, 128, (g) => {
      g.fillStyle = '#c9a877';
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 40; i++) {
        g.strokeStyle = `rgba(120,85,45,${0.08 + Math.random() * 0.12})`;
        g.beginPath();
        const y = Math.random() * 128;
        g.moveTo(0, y);
        g.bezierCurveTo(40, y + Math.random() * 8 - 4, 80, y + Math.random() * 8 - 4, 128, y);
        g.stroke();
      }
      noise(g, 128, 128, 800, 0.06);
    }),
    // A hoarding's sign: road works.
    sign: tex.sign('OBRAS', 'PROIBIDA A ENTRADA', '#f2c200', '#111111', 512, 256, '#111111'),
    // Bricks on a pallet, and cement in paper bags.
    bricks: draw(128, 128, (g) => {
      g.fillStyle = '#d8cfc2';
      g.fillRect(0, 0, 128, 128);
      for (let r = 0; r < 8; r++) {
        for (let c = -1; c < 5; c++) {
          const l = 150 + Math.random() * 30;
          g.fillStyle = `rgb(${l},${l * 0.45},${l * 0.3})`;
          g.fillRect(c * 32 + (r % 2) * 16 + 1, r * 16 + 1, 30, 14);
        }
      }
    }),
    bags: draw(128, 128, (g) => {
      g.fillStyle = '#cdbf9c';
      g.fillRect(0, 0, 128, 128);
      for (let r = 0; r < 4; r++) {
        g.fillStyle = 'rgba(80,60,30,0.35)';
        g.fillRect(0, r * 32, 128, 2);
        g.fillStyle = '#9b2a1e';
        g.font = 'bold 13px sans-serif';
        g.fillText('CIMENTO', 30 + (r % 2) * 20, r * 32 + 20);
      }
      noise(g, 128, 128, 800, 0.06);
    }),
    // Sandbags' sacking.
    sack: draw(64, 64, (g) => {
      g.fillStyle = '#a99368';
      g.fillRect(0, 0, 64, 64);
      for (let k = 0; k < 64; k += 3) {
        g.fillStyle = 'rgba(60,45,20,0.18)';
        g.fillRect(k, 0, 1, 64);
        g.fillRect(0, k, 64, 1);
      }
    }),
    // A site office's corrugated steel.
    tin: draw(64, 64, (g) => {
      g.fillStyle = '#e6e8e8';
      g.fillRect(0, 0, 64, 64);
      for (let x = 0; x < 64; x += 8) {
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(x, 0, 3, 64);
      }
      noise(g, 64, 64, 300, 0.05);
    }),
    // Concrete.
    concrete: draw(64, 64, (g) => {
      g.fillStyle = '#a7a6a1';
      g.fillRect(0, 0, 64, 64);
      noise(g, 64, 64, 1500, 0.12);
    }),
  };
}

// The materials, shared by everything a round draws of its cover.
function materials() {
  T ??= textures();
  return {
    paint: PAINTS.map((c) => mat(c, { roughness: 0.35, metalness: 0.3 })),
    glass: mat('#1d2630', { roughness: 0.15, metalness: 0.5 }),
    tyre: mat('#1a1a1a', { roughness: 0.9 }),
    chrome: mat('#9aa0a6', { roughness: 0.3, metalness: 0.8 }),
    white: mat('#eeeeea', { roughness: 0.5 }),
    orange: mat('#ff8a1c', { roughness: 0.4, emissive: '#5a2800' }),
    steel: mat('#7d8388', { roughness: 0.45, metalness: 0.6 }),
    skip: mat('#ffffff', { map: T.skip, roughness: 0.6, metalness: 0.3 }),
    rubble: mat('#6e665c', { roughness: 1 }),
    wood: mat('#ffffff', { map: T.planks, roughness: 0.85 }),
    ply: mat('#ffffff', { map: T.ply, roughness: 0.8 }),
    sign: mat('#ffffff', { map: T.sign, roughness: 0.6 }),
    bricks: mat('#ffffff', { map: T.bricks, roughness: 0.9 }),
    bags: mat('#ffffff', { map: T.bags, roughness: 0.9 }),
    sack: mat('#ffffff', { map: T.sack, roughness: 1 }),
    tin: mat('#ffffff', { map: T.tin, roughness: 0.5, metalness: 0.4 }),
    concrete: mat('#ffffff', { map: T.concrete, roughness: 0.95 }),
    blue: mat('#2a62b8', { roughness: 0.5 }),
    red: mat('#c0281e', { roughness: 0.5 }),
    mesh: new THREE.MeshStandardMaterial({ map: T.mesh, color: '#c9cfd4', alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.45 }),
  };
}
type Mats = ReturnType<typeof materials>;

// A cylinder lying along z (a wheel, a reel's rim), r round and w wide, its middle at (x, y, z).
function wheel(r: number, w: number, m: THREE.Material, x: number, y: number, z: number, n = 12): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r, r, w, n);
  g.rotateX(Math.PI / 2);
  return mesh(g, m, x, y, z);
}

// A thing of a kind drawn standing on the ground at its origin, its length along x and its width along z,
// at its kind's own size (a car's stretched to its own).
function draw(p: Prop, M: Mats): THREE.Group {
  const o = new THREE.Group();
  const { L, W, H } = p;
  const at = (m: THREE.Object3D) => o.add(m);
  switch (p.kind) {
    case 'car': {
      const paint = M.paint[Math.floor(p.tint * PAINTS.length) % PAINTS.length];
      const r = 0.31;
      at(box(L, 0.6, W, paint, 0, 0.3, 0));
      at(box(L * 0.98, 0.08, W * 0.92, M.tyre, 0, 0.24, 0));
      // The cabin: its glass, and its roof.
      const cx = -0.06 * L;
      at(box(0.5 * L, 0.5, W - 0.16, M.glass, cx, 0.9, 0));
      at(box(0.46 * L, 0.06, W - 0.2, paint, cx, 1.4, 0));
      at(box(0.62 * L, 0.06, W - 0.06, paint, cx, 0.88, 0));
      for (const sx of [1, -1]) for (const sz of [1, -1]) at(wheel(r, 0.22, M.tyre, sx * L * 0.33, r, sz * (W / 2 - 0.12)));
      // Lights: white in front, red behind.
      for (const sz of [1, -1]) {
        at(box(0.04, 0.12, 0.3, M.white, L / 2, 0.68, sz * (W / 2 - 0.25)));
        at(box(0.04, 0.12, 0.3, M.red, -L / 2, 0.68, sz * (W / 2 - 0.25)));
      }
      break;
    }
    case 'van': {
      const r = 0.36;
      at(box(L - 1, H - 0.35, W, M.white, -0.5, 0.35, 0));
      at(box(1, 0.75, W, M.white, (L - 1) / 2, 0.35, 0));
      at(box(0.5, 0.55, W - 0.1, M.glass, L / 2 - 1.2, 1.05, 0));
      at(box(0.06, 0.25, W * 0.6, M.orange, -0.5, H, 0));
      at(box(L - 1.1, 0.25, 0.02, M.orange, -0.5, 0.9, W / 2 + 0.01));
      at(box(L - 1.1, 0.25, 0.02, M.orange, -0.5, 0.9, -W / 2 - 0.01));
      for (const sx of [1, -1]) for (const sz of [1, -1]) at(wheel(r, 0.25, M.tyre, sx * L * 0.32, r, sz * (W / 2 - 0.14)));
      break;
    }
    case 'office': {
      at(box(L, H - 0.1, W, M.tin, 0, 0.1, 0));
      at(box(L + 0.06, 0.12, W + 0.06, M.steel, 0, 0, 0));
      at(box(L + 0.06, 0.1, W + 0.06, M.steel, 0, H - 0.1, 0));
      // Its door and windows on its long side.
      at(box(0.9, 2.0, 0.04, M.blue, L / 2 - 1, 0.15, W / 2));
      for (const x of [-1.8, 0.2]) at(box(1.2, 0.8, 0.04, M.glass, x, 1.2, W / 2));
      break;
    }
    case 'skip': {
      // Its sloping ends: a trapezoid along its length, across its width.
      const s = new THREE.Shape();
      s.moveTo(-L / 2 + 0.45, 0);
      s.lineTo(L / 2 - 0.45, 0);
      s.lineTo(L / 2, H);
      s.lineTo(-L / 2, H);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: false });
      g.translate(0, 0, -W / 2);
      at(mesh(g, M.skip));
      at(box(L - 0.2, 0.1, W - 0.2, M.rubble, 0, H - 0.25, 0));
      for (const x of [-L / 4, L / 4]) at(box(0.12, 0.12, W + 0.1, M.steel, x, H - 0.4, 0));
      break;
    }
    case 'bricks':
    case 'bags': {
      at(box(L, 0.14, W, M.wood, 0, 0, 0));
      at(box(L - 0.04, H - 0.14, W - 0.04, p.kind === 'bricks' ? M.bricks : M.bags, 0, 0.14, 0));
      break;
    }
    case 'sandbags': {
      const rows = 4;
      const h = H / rows;
      for (let k = 0; k < rows; k++) {
        const n = 4;
        const off = (k % 2) * (L / n / 2);
        for (let i = 0; i < n; i++) {
          const x = -L / 2 + off + (i + 0.5) * (L / n) - (k % 2 ? L / n / 2 : 0);
          at(box(L / n - 0.04, h - 0.02, W - (k % 2) * 0.08, M.sack, Math.max(-L / 2 + L / n / 2, Math.min(L / 2 - L / n / 2, x)), k * h, 0));
        }
      }
      break;
    }
    case 'jersey': {
      const s = new THREE.Shape();
      s.moveTo(-W / 2, 0);
      s.lineTo(W / 2, 0);
      s.lineTo(W / 2 - 0.05, 0.25);
      s.lineTo(0.1, H * 0.55);
      s.lineTo(0.08, H);
      s.lineTo(-0.08, H);
      s.lineTo(-0.1, H * 0.55);
      s.lineTo(-W / 2 + 0.05, 0.25);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: L, bevelEnabled: false });
      g.translate(0, 0, -L / 2);
      g.rotateY(Math.PI / 2);
      at(mesh(g, M.concrete));
      break;
    }
    case 'crate':
    case 'box': {
      at(box(L, H, W, M.wood, 0, 0, 0));
      const e = 0.05;
      for (const sx of [1, -1]) for (const sz of [1, -1]) at(box(e, H + 0.01, e, M.ply, sx * (L / 2 - e / 2 + 0.005), 0, sz * (W / 2 - e / 2 + 0.005)));
      break;
    }
    case 'fence':
    case 'hoarding': {
      for (const x of [-L / 2 + 0.1, L / 2 - 0.1]) {
        at(box(0.6, 0.14, 0.22, M.concrete, x, 0, 0));
        at(box(0.05, H, 0.05, M.steel, x, 0.1, 0));
      }
      at(box(L, 0.04, 0.04, M.steel, 0, H, 0));
      at(box(L, 0.04, 0.04, M.steel, 0, 0.15, 0));
      if (p.kind === 'fence') {
        const g = new THREE.PlaneGeometry(L - 0.1, H - 0.2);
        const u = g.attributes.uv;
        for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * (L / 2), u.getY(i) * ((H - 0.2) / 2));
        const m = new THREE.Mesh(g, M.mesh);
        m.position.set(0, H / 2 + 0.05, 0);
        m.castShadow = true;
        at(m);
      } else {
        at(box(L - 0.1, H - 0.2, 0.03, M.ply, 0, 0.18, 0));
        const g = new THREE.PlaneGeometry(1.2, 0.6);
        for (const sz of [1, -1]) {
          const s = new THREE.Mesh(g, M.sign);
          s.position.set(0, 1.25, sz * 0.02);
          if (sz < 0) s.rotation.y = Math.PI;
          at(s);
        }
      }
      break;
    }
    case 'scaffold': {
      const top = 1.9;
      for (const sx of [1, -1]) for (const sz of [1, -1]) at(box(0.05, top + 1.05, 0.05, M.steel, sx * (L / 2 - 0.03), 0, sz * (W / 2 - 0.03)));
      // Its lower lift boarded, its platform and the guard rails round it.
      at(box(L - 0.08, top - 0.15, W - 0.08, M.ply, 0, 0.05, 0));
      at(box(L, 0.06, W, M.wood, 0, top - 0.06, 0));
      for (const y of [top + 0.5, top + 1]) {
        for (const sz of [1, -1]) at(box(L, 0.04, 0.04, M.orange, 0, y, sz * (W / 2 - 0.03)));
        for (const sx of [1, -1]) at(box(0.04, 0.04, W, M.orange, sx * (L / 2 - 0.03), y, 0));
      }
      for (const sz of [1, -1]) at(box(L, 0.15, 0.02, M.wood, 0, top, sz * (W / 2 - 0.02)));
      break;
    }
    case 'toilet': {
      at(box(L, H - 0.15, W, M.blue, 0, 0, 0));
      at(box(L + 0.06, 0.15, W + 0.06, M.white, 0, H - 0.15, 0));
      at(box(0.04, H - 0.4, W * 0.7, M.white, L / 2, 0.1, 0));
      break;
    }
    case 'reel': {
      const r = H / 2;
      for (const sz of [1, -1]) at(wheel(r, 0.05, M.wood, 0, r, sz * (W / 2 - 0.025), 16));
      at(wheel(r * 0.75, W - 0.1, M.tyre, 0, r, 0, 16));
      break;
    }
    case 'drum': {
      const m = p.tint < 0.4 ? M.blue : p.tint < 0.7 ? M.red : M.steel;
      const g = new THREE.CylinderGeometry(L / 2, L / 2, H, 14);
      at(mesh(g, m, 0, H / 2, 0));
      for (const y of [H * 0.33, H * 0.66]) at(mesh(new THREE.CylinderGeometry(L / 2 + 0.01, L / 2 + 0.01, 0.03, 14), M.steel, 0, y, 0));
      break;
    }
  }
  return o;
}

// Where a thing stands and which way it's turned: its length along (cos yaw, sin yaw).
function place(o: THREE.Object3D, p: Prop): void {
  o.position.set(p.x, p.y, p.z);
  o.rotation.y = -p.yaw;
}

// The round's cover, hidden until a round shows it: one group, its meshes baked by material.
export function buildProps(f: Field): THREE.Group {
  const M = materials();
  const root = new THREE.Group();
  const kinds = new Map<PropKind, THREE.Group>();
  for (const p of f.props) {
    let g = kinds.get(p.kind);
    if (!g) kinds.set(p.kind, (g = new THREE.Group()));
    const o = draw(p, M);
    place(o, p);
    g.add(o);
  }
  // Each kind baked on its own, so a model for it can take its place.
  for (const [kind, g] of kinds) {
    g.name = kind;
    root.add(bake(g));
  }
  root.visible = false;
  void models(f, root, [...kinds.keys()]);
  return root;
}

// The kinds that have a model, drawn with it once it's loaded: fitted to each thing's length, width
// and height (turned so its longest side is its length), standing on its foot, in place of what was
// drawn for it; a car's paint (its material named for it, or its largest) tinted the car's colour.
async function models(f: Field, root: THREE.Group, kinds: PropKind[]): Promise<void> {
  const loader = new GLTFLoader();
  for (const kind of kinds) {
    const urls = modelsOf(kind);
    if (!urls.length) continue;
    const all = f.props.filter((p) => p.kind === kind);
    const out = new THREE.Group();
    let ok = true;
    for (let v = 0; v < urls.length && ok; v++) {
      const props = all.filter((p) => Math.floor(p.tint * 997) % urls.length === v);
      if (!props.length) continue;
      try {
        out.add(await variant(urls[v], kind, props, loader));
      } catch {
        ok = false;
      }
    }
    // Drawn as it was unless every model of it came in.
    if (!ok) continue;
    out.name = kind;
    const old = root.children.find((c) => c.name === kind);
    if (old) root.remove(old);
    root.add(out);
  }
}

// One model drawn for each of the things given: instanced, fitted to each.
async function variant(url: string, kind: PropKind, props: Prop[], loader: GLTFLoader): Promise<THREE.Group> {
  const gltf = await loader.loadAsync(url);
  const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    const g = floats(o.geometry as THREE.BufferGeometry).applyMatrix4(o.matrixWorld);
    if (ms.length === 1) parts.set(ms[0], [...(parts.get(ms[0]) ?? []), g]);
    else for (const grp of g.groups) parts.set(ms[grp.materialIndex ?? 0], [...(parts.get(ms[grp.materialIndex ?? 0]) ?? []), g]);
  });
  if (!parts.size) throw new Error('empty');
  // Its size, and its longest side along x.
  const bb = new THREE.Box3().setFromObject(gltf.scene);
  const size = bb.getSize(new THREE.Vector3());
  const turn = size.z > size.x ? Math.PI / 2 : 0;
  const sx = turn ? size.z : size.x;
  const sz = turn ? size.x : size.z;
  const centre = bb.getCenter(new THREE.Vector3());
  const fix = new THREE.Matrix4().makeRotationY(turn).multiply(new THREE.Matrix4().makeTranslation(-centre.x, -bb.min.y, -centre.z));
  const geos = [...parts].map(
    ([m, gs]) =>
      [
        m,
        mergeGeometries(
          gs.map((g) => {
            const q = g.index ? g.toNonIndexed() : g;
            for (const n of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(n)) q.deleteAttribute(n);
            return q.applyMatrix4(fix);
          }),
        ),
      ] as const,
  );
  const paint = kind === 'car' ? (geos.find(([m]) => /paint|body|car/i.test(m.name))?.[0] ?? geos.reduce((a, b) => ((b[1]?.attributes.position.count ?? 0) > (a[1]?.attributes.position.count ?? 0) ? b : a))[0]) : null;
  const out = new THREE.Group();
  const m4 = new THREE.Matrix4();
  for (const [m, g] of geos) {
    if (!g) continue;
    const im = new THREE.InstancedMesh(g, m === paint ? (m as THREE.MeshStandardMaterial).clone() : m, props.length);
    if (m === paint) (im.material as THREE.MeshStandardMaterial).color.set('#ffffff');
    props.forEach((p, i) => {
      m4.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -p.yaw), new THREE.Vector3(p.L / sx, (kind === 'car' ? SIZE.car.H : p.H) / size.y, p.W / sz));
      im.setMatrixAt(i, m4);
      if (m === paint) im.setColorAt(i, new THREE.Color(PAINTS[Math.floor(p.tint * PAINTS.length) % PAINTS.length]));
    });
    im.castShadow = true;
    im.receiveShadow = true;
    out.add(im);
  }
  return out;
}

// A model's geometry with every attribute in plain floats: its files keep them as small integers
// (quantized), which moving them in place would ruin.
function floats(g0: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = g0.clone();
  for (const n of Object.keys(g.attributes)) {
    const a = g.attributes[n] as THREE.BufferAttribute;
    if (a.array instanceof Float32Array && !a.normalized) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(n, new THREE.BufferAttribute(out, a.itemSize));
  }
  return g;
}
