// The map's photo textures (braga-map's task 007, its decision 030): photos of facades straightened onto
// their walls, drawn only with ?photos until braga-map's task 017 rolls them out; and the kinds of
// ground's (its task 016), which cover.ts loads with this file's ktx2Loader. They're KTX2 files,
// compressed with Basis Universal's ETC1S, which three.js's KTX2Loader turns into what this graphics
// card takes (ETC1 on a phone, BC7 on a PC) in its workers, and which stays compressed on the card:
// on a phone an eighth of the memory a WebP or a canvas takes. Basis's transcoder is fetched once, the first
// time (about 0.6 MB, 0.26 gzipped), from the game's own assets.
import type { FacadePhoto, PhotoTexture } from 'braga-map';
import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import transcoderJs from 'three/addons/libs/basis/basis_transcoder.js?url';
import transcoderWasm from 'three/addons/libs/basis/basis_transcoder.wasm?url';
import type { Quality } from './look.ts';

// How far in front of its wall a facade stands, so it never fights the wall for the same pixels.
const PROUD = 0.04;

export interface Photos {
  // The facades, a mesh each.
  facades: THREE.Group;
  dispose(): void;
}

// A loader of the map's KTX2 files, as this graphics card takes them (cover.ts uses it too). Dispose of
// it once they're loaded: it keeps its workers.
export function ktx2Loader(renderer: THREE.WebGLRenderer): KTX2Loader {
  // KTX2Loader asks for the transcoder by name; the bundler has given each file a name of its own.
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => (url.endsWith('basis_transcoder.js') ? transcoderJs : url.endsWith('basis_transcoder.wasm') ? transcoderWasm : url));
  return new KTX2Loader(manager).setTranscoderPath('').detectSupport(renderer);
}

// Loads the photo textures on the tiles loaded, at the graphics level asked for, and makes their
// facades. dispose frees them, for when a tile goes (braga-map's task 038: none does yet).
export async function loadPhotos(photos: PhotoTexture[], renderer: THREE.WebGLRenderer, quality: Quality): Promise<Photos> {
  const loader = ktx2Loader(renderer);
  const textures: THREE.Texture[] = [];
  const load = async (p: PhotoTexture) => {
    const t = await loader.loadAsync(p.files[quality].url);
    t.anisotropy = 8;
    textures.push(t);
    return t;
  };
  const walls = await Promise.all(photos.filter((p): p is FacadePhoto => p.kind === 'facade').map(async (p) => ({ p, map: await load(p) })));
  loader.dispose();
  const facades = new THREE.Group();
  facades.name = 'photo facades';
  for (const { p, map } of walls) facades.add(facade(p, map));
  return {
    facades,
    dispose() {
      for (const t of textures) t.dispose();
      facades.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
    },
  };
}

// A facade's quads: each step of its wall that faces the photo, its part of the texture across it
// (by where it falls along the wall's chord), from the photo's bottom to its top, a little proud.
function facade(p: FacadePhoto, map: THREE.Texture): THREE.Mesh {
  const [ax, az] = p.wall[0];
  const [bx, bz] = p.wall[p.wall.length - 1];
  const L = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / L;
  const dz = (bz - az) / L;
  const [s0, s1] = p.s;
  const [y0, y1] = p.y;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k + 1 < p.wall.length; k++) {
    const [px, pz] = p.wall[k];
    const [qx, qz] = p.wall[k + 1];
    const l = Math.hypot(qx - px, qz - pz);
    // Its own front, which faces the photo's as the wall's does.
    const nx = -(qz - pz) / l;
    const nz = (qx - px) / l;
    if (l < 0.05 || nx * -dz + nz * dx < 0.3) continue;
    // Where its ends fall along the chord (facing the photo, it runs left to right along it),
    // clipped to what the photo spans.
    const sp = (px - ax) * dx + (pz - az) * dz;
    const sq = (qx - ax) * dx + (qz - az) * dz;
    const a = Math.max(s0, sp);
    const b = Math.min(s1, sq);
    if (b - a < 0.05) continue;
    const at = (s: number): [number, number] => {
      const f = (s - sp) / (sq - sp);
      return [px + (qx - px) * f + nx * PROUD, pz + (qz - pz) * f + nz * PROUD];
    };
    const [ex, ez] = at(a);
    const [fx, fz] = at(b);
    // Row 0 of a KTX2 file is the photo's top: KTX2Loader doesn't flip it, so v = 0 is up.
    const v = pos.length / 3;
    pos.push(ex, y0, ez, fx, y0, fz, fx, y1, fz, ex, y1, ez);
    uv.push((a - s0) / (s1 - s0), 1, (b - s0) / (s1 - s0), 1, (b - s0) / (s1 - s0), 0, (a - s0) / (s1 - s0), 0);
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, roughness: 0.9, side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  mesh.name = p.id;
  mesh.receiveShadow = true;
  return mesh;
}
