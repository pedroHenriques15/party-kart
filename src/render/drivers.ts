// The drivers: cartoon bobbleheads, known by their props, their hair and their cars. Parody names;
// every face is the same friendly cartoon face.
import * as THREE from 'three';

export type Body = 'kart' | 'limo' | 'stroller' | 'vintage' | 'van';
export type Extra =
  | 'shades'
  | 'chain'
  | 'disco'
  | 'swoop'
  | 'tie'
  | 'flag'
  | 'cone'
  | 'gem'
  | 'spikes'
  | 'braids'
  | 'cactus'
  | 'dagger'
  | 'teacup'
  | 'beanie'
  | 'bonnet'
  | 'pacifier'
  | 'tophat'
  | 'monocle'
  | 'mustache'
  | 'cape'
  | 'fangs';
export type Trail = 'confetti' | 'money' | 'gas' | 'flame' | 'bubbles' | 'sparkle' | 'smoke' | null;

export interface Driver {
  id: string;
  name: string;
  tagline: string;
  body: Body;
  color: string;
  trim: string;
  skin: string;
  outfit: string;
  extras: Extra[];
  trail: Trail;
  horn: number[]; // notes, in Hz
}

export const DRIVERS: Driver[] = [
  { id: 'kiddy', name: 'P. Kiddy', tagline: 'Host of the White Party', body: 'kart', color: '#f7f7f4', trim: '#d4af37', skin: '#7a4b2a', outfit: '#ffffff', extras: ['shades', 'chain', 'disco'], trail: 'confetti', horn: [523, 659, 784, 1047] },
  { id: 'trunk', name: 'Donald Trunk', tagline: 'Makes karting great again', body: 'limo', color: '#d4af37', trim: '#b22234', skin: '#f2b48a', outfit: '#1f2a4d', extras: ['swoop', 'tie', 'flag'], trail: 'money', horn: [392, 392, 523] },
  { id: 'gucci', name: 'Gucci Pain', tagline: 'Ice cold, slightly melting', body: 'kart', color: '#1e5b3a', trim: '#b3202a', skin: '#5a3825', outfit: '#151515', extras: ['cone', 'chain', 'shades'], trail: 'sparkle', horn: [330, 440, 330] },
  { id: 'woozy', name: 'Lil Woozy Vert', tagline: 'Bought a planet, lost the keys', body: 'kart', color: '#7b2ff7', trim: '#ff4fd8', skin: '#6b4228', outfit: '#ff4fd8', extras: ['gem', 'spikes', 'chain'], trail: 'sparkle', horn: [880, 1175, 880, 1175] },
  { id: 'trav', name: 'Trav Scotch', tagline: 'Straight up from the cactus', body: 'kart', color: '#4f7d3a', trim: '#c2a26b', skin: '#5c3b24', outfit: '#6b5b45', extras: ['braids', 'cactus'], trail: 'flame', horn: [220, 277, 330] },
  { id: 'average', name: '22 Average', tagline: 'Exactly one more than 21', body: 'van', color: '#cbbd9b', trim: '#8a8a8a', skin: '#3d2618', outfit: '#2b2b2b', extras: ['dagger', 'teacup', 'beanie'], trail: null, horn: [440, 440] },
  { id: 'baby', name: 'Lil Babyface', tagline: 'Nap time is for losers', body: 'stroller', color: '#9fd3ff', trim: '#ffffff', skin: '#6a4329', outfit: '#ffd1e8', extras: ['bonnet', 'pacifier'], trail: 'bubbles', horn: [1047, 1319, 1568] },
  { id: 'past', name: 'Lil Past', tagline: 'Was fast. Once.', body: 'vintage', color: '#6b4f2a', trim: '#e8dcc0', skin: '#4e3220', outfit: '#2a2a2a', extras: ['tophat', 'monocle', 'mustache'], trail: 'smoke', horn: [196, 247, 196] },
  { id: 'farty', name: 'Playboi Farty', tagline: 'Leaves a trail', body: 'kart', color: '#141414', trim: '#a5ff3a', skin: '#5b3a24', outfit: '#3b0d0d', extras: ['cape', 'fangs'], trail: 'gas', horn: [110, 98, 82] },
];

export const driverById = (id: string) => DRIVERS.find((d) => d.id === id) ?? DRIVERS[0];

const std = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...o });

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

// The figure: torso, arms and a big head, facing +x. The head is its own group, to bob.
export function buildDriverFigure(d: Driver): THREE.Group {
  const fig = new THREE.Group();
  const skin = std(d.skin);
  const outfit = std(d.outfit);
  const black = std('#111');
  const white = std('#fff');
  const gold = std('#d4af37', { metalness: 0.9, roughness: 0.25 });

  fig.add(mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.75, 14), outfit, 0, 0.38, 0));
  for (const z of [-0.36, 0.36]) {
    const arm = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 8), outfit, 0.25, 0.45, z);
    arm.rotation.z = -1.1;
    fig.add(arm);
    fig.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), skin, 0.5, 0.33, z));
  }

  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, 1.25, 0);
  fig.add(mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 8), skin, 0, 0.85, 0));
  head.add(mesh(new THREE.SphereGeometry(0.55, 24, 18), skin));
  for (const z of [-0.2, 0.2]) {
    head.add(mesh(new THREE.SphereGeometry(0.11, 12, 10), white, 0.46, 0.1, z));
    head.add(mesh(new THREE.SphereGeometry(0.055, 8, 6), black, 0.56, 0.1, z));
    head.add(mesh(new THREE.SphereGeometry(0.12, 10, 8), skin, 0, 0, z * 2.7)); // ears
  }
  const smile = mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 16, Math.PI), std('#5a1f1f'), 0.5, -0.17, 0);
  smile.rotation.set(Math.PI / 2, Math.PI / 2, Math.PI);
  smile.rotation.order = 'YXZ';
  smile.rotation.set(0, Math.PI / 2, Math.PI);
  head.add(smile);

  for (const e of d.extras) {
    switch (e) {
      case 'shades': {
        head.add(mesh(new THREE.BoxGeometry(0.08, 0.17, 0.62), black, 0.53, 0.12, 0));
        break;
      }
      case 'chain': {
        const c = mesh(new THREE.TorusGeometry(0.33, 0.045, 8, 24), gold, 0.05, 0.62, 0);
        c.rotation.x = Math.PI / 2;
        c.rotation.y = 0.45;
        fig.add(c);
        fig.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 16), gold, 0.33, 0.48, 0).rotateZ(Math.PI / 2));
        break;
      }
      case 'swoop': {
        const hair = mesh(new THREE.SphereGeometry(0.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2.2), std('#f3d36b', { roughness: 0.9 }), -0.05, 0.12, 0);
        hair.scale.set(1.15, 0.75, 1.08);
        head.add(hair);
        const flick = mesh(new THREE.SphereGeometry(0.28, 12, 8), std('#f3d36b', { roughness: 0.9 }), 0.42, 0.42, 0.12);
        flick.scale.set(1.4, 0.5, 1.5);
        head.add(flick);
        break;
      }
      case 'tie': {
        fig.add(mesh(new THREE.BoxGeometry(0.04, 0.62, 0.13), std('#c8102e'), 0.36, 0.38, 0));
        break;
      }
      case 'cone': {
        const cone = mesh(new THREE.ConeGeometry(0.06, 0.16, 8), std('#d9a066'), 0.48, -0.1, 0.33);
        cone.rotation.z = Math.PI;
        head.add(cone, mesh(new THREE.SphereGeometry(0.06, 8, 6), std('#9be7ff'), 0.48, 0.0, 0.33));
        break;
      }
      case 'gem': {
        head.add(mesh(new THREE.OctahedronGeometry(0.09), std('#ff4fd8', { metalness: 0.6, roughness: 0.1 }), 0.53, 0.32, 0));
        break;
      }
      case 'spikes': {
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2;
          const sp = mesh(new THREE.ConeGeometry(0.09, 0.55, 6), std(k % 2 ? '#ff4fd8' : '#3be8c4'), Math.cos(a) * 0.32 - 0.05, 0.55, Math.sin(a) * 0.32);
          sp.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
          head.add(sp);
        }
        break;
      }
      case 'braids': {
        for (let k = 0; k < 10; k++) {
          const a = Math.PI * 0.55 + (k / 9) * Math.PI * 0.9;
          const br = mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.7, 6), std('#2a1a10'), Math.cos(a) * 0.5, -0.15, Math.sin(a) * 0.5);
          head.add(br);
        }
        head.add(mesh(new THREE.SphereGeometry(0.56, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.5), std('#2a1a10'), -0.04, 0.06, 0));
        break;
      }
      case 'dagger': {
        const dg = mesh(new THREE.BoxGeometry(0.02, 0.2, 0.035), std('#2b2b2b'), 0.55, 0.32, 0.05);
        head.add(dg);
        break;
      }
      case 'beanie': {
        head.add(mesh(new THREE.SphereGeometry(0.57, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), std('#5f6b3a'), 0, 0.12, 0));
        break;
      }
      case 'bonnet': {
        const b = mesh(new THREE.SphereGeometry(0.62, 18, 12, 0, Math.PI, 0, Math.PI), std('#bfe3ff'), -0.08, 0.05, 0);
        b.rotation.y = Math.PI / 2;
        head.add(b);
        break;
      }
      case 'pacifier': {
        const p = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 16), std('#ff8fc7'), 0.56, -0.17, 0);
        p.rotation.z = Math.PI / 2;
        head.add(p);
        const ring = mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 12), std('#ff8fc7'), 0.6, -0.17, 0);
        ring.rotation.y = Math.PI / 2;
        head.add(ring);
        break;
      }
      case 'tophat': {
        head.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 20), black, 0, 0.42, 0));
        head.add(mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.6, 20), black, 0, 0.73, 0));
        break;
      }
      case 'monocle': {
        const m = mesh(new THREE.TorusGeometry(0.09, 0.015, 6, 16), gold, 0.58, 0.1, 0.2);
        m.rotation.y = Math.PI / 2;
        head.add(m);
        break;
      }
      case 'mustache': {
        for (const z of [-0.1, 0.1]) {
          const m = mesh(new THREE.SphereGeometry(0.1, 10, 6), std('#1d1d1d'), 0.53, -0.07, z);
          m.scale.set(0.6, 0.45, 1.3);
          head.add(m);
        }
        break;
      }
      case 'fangs': {
        for (const z of [-0.06, 0.06]) {
          const f = mesh(new THREE.ConeGeometry(0.025, 0.08, 6), white, 0.55, -0.24, z);
          f.rotation.z = Math.PI;
          head.add(f);
        }
        head.add(mesh(new THREE.SphereGeometry(0.56, 16, 10, 0, Math.PI * 2, 0, Math.PI / 3), std('#111'), -0.03, 0.1, 0));
        break;
      }
      case 'cape': {
        const c = mesh(new THREE.ConeGeometry(0.55, 1.1, 12, 1, true), std('#5c0b12', { side: THREE.DoubleSide }), -0.25, 0.45, 0);
        fig.add(c);
        const collar = mesh(new THREE.CylinderGeometry(0.45, 0.3, 0.35, 12, 1, true), std('#5c0b12', { side: THREE.DoubleSide }), -0.05, 0.92, 0);
        fig.add(collar);
        break;
      }
      default:
        break;
    }
  }
  fig.add(head);
  return fig;
}

export interface KartModel {
  group: THREE.Group;
  update: (speed: number, steer: number, dt: number, grounded: boolean) => void;
  driver: Driver;
}

// The car around the figure. Forward is +x, right is +z; the wheels sit on y = 0.
export function buildKart(d: Driver): KartModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const paint = std(d.color, { metalness: d.body === 'limo' ? 0.85 : 0.3, roughness: d.body === 'limo' ? 0.25 : 0.45 });
  const trim = std(d.trim, { metalness: 0.5, roughness: 0.35 });
  const dark = std('#1a1a1d');
  const chrome = std('#dfe3e8', { metalness: 1, roughness: 0.2 });

  let wheelR = 0.42;
  let seatX = -0.35;
  let wheelBase = 1.25;
  let track = 0.95;
  switch (d.body) {
    case 'limo': {
      wheelBase = 1.7;
      body.add(mesh(new THREE.BoxGeometry(4.6, 0.55, 1.9), paint, 0, 0.6, 0));
      body.add(mesh(new THREE.BoxGeometry(1.2, 0.45, 1.7), paint, 1.6, 1.05, 0));
      body.add(mesh(new THREE.BoxGeometry(0.1, 0.2, 1.95), trim, 2.3, 0.6, 0));
      body.add(mesh(new THREE.BoxGeometry(4.62, 0.08, 1.92), trim, 0, 0.88, 0));
      break;
    }
    case 'van': {
      wheelBase = 1.4;
      body.add(mesh(new THREE.BoxGeometry(3.6, 0.6, 1.95), paint, 0, 0.62, 0));
      // A low back, so the driver shows over it from behind.
      body.add(mesh(new THREE.BoxGeometry(1.6, 0.65, 1.95), paint, -1.0, 1.2, 0));
      body.add(mesh(new THREE.BoxGeometry(1.62, 0.25, 1.97), std('#2f3e52'), -1.0, 1.35, 0));
      seatX = 0.35;
      break;
    }
    case 'stroller': {
      wheelR = 0.55;
      track = 0.85;
      const basket = mesh(new THREE.CylinderGeometry(0.85, 0.7, 1.7, 20, 1, true), std(d.color, { side: THREE.DoubleSide }), 0, 1.05, 0);
      basket.rotation.x = Math.PI / 2;
      basket.scale.set(1.35, 1, 0.85);
      body.add(basket);
      const hood = mesh(new THREE.SphereGeometry(0.95, 18, 10, 0, Math.PI, 0, Math.PI / 2), std('#ffffff', { side: THREE.DoubleSide }), -0.55, 1.15, 0);
      hood.rotation.y = -Math.PI / 2;
      hood.rotation.z = 0.35;
      body.add(hood);
      const handle = mesh(new THREE.TorusGeometry(0.5, 0.05, 6, 16, Math.PI), chrome, -1.45, 1.6, 0);
      handle.rotation.y = Math.PI / 2;
      body.add(handle);
      body.add(mesh(new THREE.BoxGeometry(2.6, 0.08, 0.08), chrome, 0, 0.55, 0.65), mesh(new THREE.BoxGeometry(2.6, 0.08, 0.08), chrome, 0, 0.55, -0.65));
      seatX = -0.05;
      break;
    }
    case 'vintage': {
      wheelR = 0.5;
      body.add(mesh(new THREE.BoxGeometry(3.3, 0.55, 1.4), paint, 0, 0.75, 0));
      body.add(mesh(new THREE.BoxGeometry(1.2, 0.6, 1.2), paint, 1.1, 1.2, 0));
      for (const z of [-0.95, 0.95]) {
        const fender = mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.45, 16, 1, false, 0, Math.PI), paint, 1.25, 0.55, z);
        fender.rotation.x = Math.PI / 2;
        body.add(fender);
        const rear = fender.clone();
        rear.position.x = -1.25;
        body.add(rear);
        body.add(mesh(new THREE.SphereGeometry(0.18, 12, 8), std('#fff8d0', { emissive: '#fff3a0', emissiveIntensity: 0.6 }), 1.75, 1.1, z * 0.6));
      }
      body.add(mesh(new THREE.BoxGeometry(0.1, 0.5, 1.0), chrome, 1.72, 1.15, 0));
      break;
    }
    default: {
      body.add(mesh(new THREE.BoxGeometry(3.2, 0.45, 1.6), paint, 0, 0.5, 0));
      const nose = mesh(new THREE.BoxGeometry(0.9, 0.4, 1.3), paint, 1.55, 0.5, 0);
      nose.scale.set(1, 0.8, 1);
      body.add(nose);
      body.add(mesh(new THREE.BoxGeometry(3.25, 0.1, 1.65), trim, 0, 0.74, 0));
      body.add(mesh(new THREE.BoxGeometry(0.5, 0.1, 2.0), trim, 1.95, 0.35, 0));
      const spoiler = mesh(new THREE.BoxGeometry(0.4, 0.08, 1.9), trim, -1.65, 1.15, 0);
      body.add(spoiler);
      for (const z of [-0.7, 0.7]) body.add(mesh(new THREE.BoxGeometry(0.08, 0.45, 0.08), dark, -1.6, 0.9, z));
      body.add(mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.4, 10), chrome, -1.7, 0.55, 0.35).rotateZ(Math.PI / 2));
    }
  }

  const fig = buildDriverFigure(d);
  fig.position.set(seatX, d.body === 'stroller' ? 0.55 : d.body === 'van' ? 0.8 : 0.72, 0);
  fig.scale.setScalar(d.body === 'stroller' ? 0.95 : 1);
  body.add(fig);
  if (d.body !== 'stroller' && d.body !== 'van') {
    const sw = mesh(new THREE.TorusGeometry(0.22, 0.04, 8, 18), dark, seatX + 0.6, 1.15, 0);
    sw.rotation.y = Math.PI / 2;
    sw.rotation.z = 0.5;
    body.add(sw);
  }

  // Props on the car.
  if (d.extras.includes('disco')) {
    body.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 4), chrome, -1.4, 1.5, 0.6));
    body.add(mesh(new THREE.IcosahedronGeometry(0.22, 1), std('#e9eef5', { metalness: 1, roughness: 0.1, flatShading: true }), -1.4, 2.15, 0.6));
  }
  if (d.extras.includes('flag')) {
    body.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4), chrome, -1.9, 1.5, 0.6));
    const flag = new THREE.Group();
    flag.position.set(-2.2, 2.0, 0.6);
    for (let k = 0; k < 5; k++) flag.add(mesh(new THREE.BoxGeometry(0.6, 0.08, 0.02), std(k % 2 ? '#ffffff' : '#c8102e'), 0, -k * 0.08, 0));
    flag.add(mesh(new THREE.BoxGeometry(0.25, 0.2, 0.025), std('#1f3a8a'), 0.17, -0.06, 0));
    body.add(flag);
  }
  if (d.extras.includes('cactus')) {
    const g = std('#3f8f3a');
    body.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.9, 10), g, 1.4, 1.1, 0));
    const arm = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.4, 8), g, 1.4, 1.25, 0.25);
    arm.rotation.x = 0.9;
    body.add(arm);
  }
  if (d.extras.includes('teacup')) {
    body.add(mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.18, 14), std('#ffffff'), 1.0, 1.0, 0.55));
    const h = mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 10), std('#ffffff'), 1.0, 1.0, 0.73);
    body.add(h);
  }

  // Wheels: the front ones on pivots to steer.
  const tire = std('#161616', { roughness: 0.9 });
  const hub = d.extras.includes('chain') || d.body === 'limo' ? std('#d4af37', { metalness: 0.9, roughness: 0.2 }) : chrome;
  const wheels: THREE.Group[] = [];
  const pivots: THREE.Group[] = [];
  for (const x of [wheelBase, -wheelBase]) {
    for (const z of [-track, track]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, wheelR, z);
      const w = new THREE.Group();
      const t = mesh(new THREE.CylinderGeometry(wheelR, wheelR, d.body === 'stroller' ? 0.12 : 0.36, 18), tire);
      t.rotation.x = Math.PI / 2;
      const h = mesh(new THREE.CylinderGeometry(wheelR * 0.55, wheelR * 0.55, d.body === 'stroller' ? 0.14 : 0.38, 6), hub);
      h.rotation.x = Math.PI / 2;
      w.add(t, h);
      pivot.add(w);
      group.add(pivot);
      wheels.push(w);
      if (x > 0) pivots.push(pivot);
    }
  }

  const head = fig.getObjectByName('head')!;
  let spin = 0;
  let bob = 0;
  let bobV = 0;
  let lastSpeed = 0;
  return {
    group,
    driver: d,
    update(speed, steer, dt, grounded) {
      spin += (speed / wheelR) * dt;
      for (const w of wheels) w.rotation.z = -spin;
      for (const p of pivots) p.rotation.y = -steer * 0.45;
      // The bobblehead: a spring kicked by acceleration and bumps.
      const acc = (speed - lastSpeed) / Math.max(dt, 1e-3);
      lastSpeed = speed;
      bobV += (-bob * 60 - bobV * 5 - acc * 0.02 + (grounded ? 0 : 0.5)) * dt;
      bob += bobV * dt;
      head.rotation.z = Math.max(-0.5, Math.min(0.5, bob));
      head.rotation.x = -steer * 0.15;
      body.rotation.x = steer * 0.05 * Math.min(1, speed / 20);
    },
  };
}
