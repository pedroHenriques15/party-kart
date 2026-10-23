// What the ground is, from the map (braga-map's task 016, the owner's pick of the ways it tested):
// over every tile it has classed, every 50 cm (on High) asphalt, paving, setts, grass, bare soil,
// gravel, water or a roof, and whether a tree's crown is over it, from DGT's 2025 LiDAR and
// orthophoto; and each kind's own colour there, the orthophoto's without its cars and shadows. The
// land's shader (city.ts) draws each kind with its own texture (a seamless one, made, not photographed:
// braga-map's task 082, tiled at its real size), its colour divided out and the place's put in: the
// texture gives the detail up close, the place the colour.
import type { World as Braga } from 'braga-map';
import * as THREE from 'three';
import type { Quality } from './look.ts';
import { ktx2Loader } from './ktx2.ts';

// The kinds there are (the map's groundKinds), and those with a texture: asphalt, paving, setts, grass,
// soil and gravel. Water and a roof are their colour alone. Each tile's colour has a grid for each kind
// and one for the trees' crowns, last.
export const KINDS = 8;
export const GRIDS = KINDS + 1;
const PHOTOGRAPHED = 6;

export interface Cover {
  // The tiles' grid, in the map's tiles (`tile` metres a side): the first one's (i, j); `slots` has each
  // one's layer + 1 (0 where the map hasn't classed it), read exactly (texelFetch).
  tile: number;
  i0: number;
  j0: number;
  slots: THREE.DataTexture;
  // Cells a tile a side, and each cell's kind (low 3 bits) and crown (8), two cells to a byte, the
  // first in its low half: a layer a tile, cells / 2 wide.
  cells: number;
  classes: THREE.DataArrayTexture;
  // Each kind's colour over each tile, between its squares' middles: layer tile × 9 + kind; and the
  // trees' crowns', seen from above, tile × 9 + 8.
  colour: THREE.DataArrayTexture;
  // Each kind's texture, its mean colour in linear light, and how many times it repeats a metre.
  surfaces: THREE.Texture[];
  mean: THREE.Vector3[];
  scale: number[];
  dispose(): void;
}

// A PNG's pixels as RGBA bytes, decoded by the browser with no colour conversion, so each is the byte
// the map wrote.
async function readPixels(url: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  const bmp = await createImageBitmap(await (await fetch(url)).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  const out = { w: bmp.width, h: bmp.height, data: g.getImageData(0, 0, bmp.width, bmp.height).data };
  bmp.close();
  return out;
}

const linear = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

// Loads what the ground is on every tile loaded that the map has classed, at the graphics level asked
// for, and the kinds' textures; null if it has classed none of them. A tile the open world's area doesn't
// touch is never nearer the player than its edge, so its kinds come at Low (2 m a cell) and are drawn
// at the level's cells all the same: on High that's 23 of the 48 tiles at a seventh of the download.
export async function loadCover(map: Braga, renderer: THREE.WebGLRenderer, quality: Quality): Promise<Cover | null> {
  const covers = map.groundCover;
  if (!covers.length) return null;
  const kinds = map.groundKinds.slice(0, PHOTOGRAPHED);
  if (kinds.some((k) => !k.texture)) throw new Error('The map has no texture for some kind of ground');
  const open = new Set(map.open.tiles);
  const loader = ktx2Loader(renderer);
  const [tiles, surfaces] = await Promise.all([
    Promise.all(covers.map((c) => Promise.all([readPixels(c.classes[open.has(c.tile) ? quality : 'low'].url), readPixels(c.colour[quality].url)]))),
    Promise.all(kinds.map((k) => loader.loadAsync(k.texture!.files[quality].url))),
  ]);
  loader.dispose();

  const n = covers[0].classes[quality].w;
  const sq = covers[0].colour[quality].squares;
  const half = n / 2;
  const cls = new Uint8Array(half * n * covers.length);
  const rgba = new Uint8Array(sq * sq * 4 * GRIDS * covers.length);
  tiles.forEach(([c, col], t) => {
    if (covers[t].classes[quality].w !== n || covers[t].colour[quality].squares !== sq) throw new Error(`${covers[t].tile}: its ground cover isn't the size the others' is`);
    // A coarser tile's cells, each repeated over the level's.
    const o = t * half * n;
    const f = n / c.w;
    const at = (i: number, j: number) => c.data[(Math.floor(j / f) * c.w + Math.floor(i / f)) * 4] & 15;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i += 2) cls[o + j * half + i / 2] = at(i, j) | (at(i + 1, j) << 4);
    // Each kind's grid, out of the padding round it in the file.
    const p = col.w;
    for (let k = 0; k < GRIDS; k++) for (let j = 0; j < sq; j++) rgba.set(col.data.subarray(((k * p + j) * p) * 4, ((k * p + j) * p + sq) * 4), ((t * GRIDS + k) * sq + j) * sq * 4);
  });
  const classes = new THREE.DataArrayTexture(cls, half, n, covers.length);
  classes.format = THREE.RedFormat;
  classes.magFilter = classes.minFilter = THREE.NearestFilter;
  classes.generateMipmaps = false;
  classes.needsUpdate = true;
  const colour = new THREE.DataArrayTexture(rgba, sq, sq, GRIDS * covers.length);
  colour.colorSpace = THREE.SRGBColorSpace;
  colour.magFilter = colour.minFilter = THREE.LinearFilter;
  colour.generateMipmaps = false;
  colour.needsUpdate = true;

  // The grid of tiles, and each one's layer.
  const at = covers.map((c) => [Math.round(c.box.x0 / map.tile), Math.round(c.box.z0 / map.tile)]);
  const i0 = Math.min(...at.map((p) => p[0]));
  const j0 = Math.min(...at.map((p) => p[1]));
  const ni = Math.max(...at.map((p) => p[0])) - i0 + 1;
  const nj = Math.max(...at.map((p) => p[1])) - j0 + 1;
  const ids = new Uint8Array(ni * nj);
  at.forEach(([i, j], t) => (ids[(j - j0) * ni + (i - i0)] = t + 1));
  const slots = new THREE.DataTexture(ids, ni, nj, THREE.RedFormat, THREE.UnsignedByteType);
  slots.magFilter = slots.minFilter = THREE.NearestFilter;
  slots.generateMipmaps = false;
  slots.needsUpdate = true;

  for (const s of surfaces) {
    s.wrapS = s.wrapT = THREE.RepeatWrapping;
    s.anisotropy = 8;
  }
  return {
    tile: map.tile,
    i0,
    j0,
    slots,
    cells: n,
    classes,
    colour,
    surfaces,
    mean: kinds.map((k) => new THREE.Vector3(...k.texture!.mean.map(linear))),
    scale: kinds.map((k) => 1 / k.texture!.metres),
    dispose() {
      for (const t of [slots, classes, colour, ...surfaces]) t.dispose();
    },
  };
}
