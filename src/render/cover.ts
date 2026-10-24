// What the ground is, from the map (braga-map's task 016, the owner's pick of the ways it tested):
// over every tile it has classed, every 50 cm (on High) asphalt, paving, setts, grass, bare soil,
// gravel, water or a roof, and whether a tree's crown is over it, from DGT's 2025 LiDAR and
// orthophoto; and each kind's own colour there, the orthophoto's without its cars and shadows. The
// land's shader (city.ts) draws each kind with its own texture (a seamless one, made, not photographed:
// braga-map's task 082, tiled at its real size), its colour divided out and the place's put in: the
// texture gives the detail up close, the place the colour. On Ultra (braga-map's task 085) each kind's
// texture is its finest, with its relief, for the sun's grazing light, and how rough it is.
import type { World as Braga } from 'braga-map';
import * as THREE from 'three';
import { anisotropy, levelOf, type Graphics } from './look.ts';
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
  // Each kind's texture (none on Ultra: they're in `ultra`), its mean colour in linear light, and how
  // many times it repeats a metre.
  surfaces: THREE.Texture[];
  mean: THREE.Vector3[];
  scale: number[];
  // On Ultra (braga-map's task 085), each kind's texture at its finest, a layer each in the kinds' order
  // (one array: the land's shader has room for few textures there, as WebGL gives it 16 and the sun's
  // cascades take four), its relief (a normal map a layer, another) and how rough each kind is. null
  // below Ultra, which draws as it did.
  ultra: { surfaces: THREE.CompressedArrayTexture; normals: THREE.CompressedArrayTexture; roughness: number[] } | null;
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

// Textures of one size, format and number of mipmaps, as the KTX2 loader gives them, as one array, a
// layer each in their order, tiled. On Ultra only: below it every object three makes is as it was, so
// the shots' seeded noise (main.ts's ?scenery, which three's uuids draw from too) is drawn as it was.
function stack(ts: THREE.CompressedTexture[]): THREE.CompressedArrayTexture {
  const [a] = ts;
  for (const t of ts) if (t.format !== a.format || t.image.width !== a.image.width || t.image.height !== a.image.height || t.mipmaps.length !== a.mipmaps.length) throw new Error("The ground's textures aren't all of one size and format");
  const mipmaps = a.mipmaps.map((m, i) => {
    const n = m.data.byteLength, data = new Uint8Array(n * ts.length);
    ts.forEach((t, k) => {
      const d = t.mipmaps[i].data;
      data.set(new Uint8Array(d.buffer, d.byteOffset, n), k * n);
    });
    return { data, width: m.width, height: m.height };
  });
  const out = new THREE.CompressedArrayTexture(mipmaps, a.image.width, a.image.height, ts.length, a.format, a.type);
  out.colorSpace = a.colorSpace;
  out.wrapS = out.wrapT = THREE.RepeatWrapping;
  out.minFilter = a.minFilter;
  out.magFilter = a.magFilter;
  out.generateMipmaps = false;
  out.anisotropy = anisotropy();
  out.needsUpdate = true;
  for (const t of ts) t.dispose();
  return out;
}

// Loads what the ground is on every tile loaded that the map has classed, at the graphics level asked
// for, and the kinds' textures; null if it has classed none of them. A tile the open world's area doesn't
// touch is never nearer the player than its edge, so its kinds come at Low (2 m a cell) and are drawn
// at the level's cells all the same: on High that's 23 of the 48 tiles at a seventh of the download.
// Ultra has High's cells and colours, and the kinds' Ultra files: their finest and their relief.
export async function loadCover(map: Braga, renderer: THREE.WebGLRenderer, graphics: Graphics): Promise<Cover | null> {
  const covers = map.groundCover;
  if (!covers.length) return null;
  const quality = levelOf(graphics), ultra = graphics === 'ultra';
  const kinds = map.groundKinds.slice(0, PHOTOGRAPHED).map((k) => {
    if (!k.texture) throw new Error('The map has no texture for some kind of ground');
    return k.texture;
  });
  const open = new Set(map.open.tiles);
  const loader = ktx2Loader(renderer);
  const load = (urls: string[]) => Promise.all(urls.map((u) => loader.loadAsync(u) as Promise<THREE.CompressedTexture>));
  const [tiles, surfaces, normals] = await Promise.all([
    Promise.all(covers.map((c) => Promise.all([readPixels(c.classes[open.has(c.tile) ? quality : 'low'].url), readPixels(c.colour[quality].url)]))),
    load(kinds.map((k) => (ultra ? k.ultra.colour : k.files[quality]).url)),
    ultra ? load(kinds.map((k) => k.ultra.normal.url)) : null,
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
    s.anisotropy = anisotropy();
  }
  const fine = normals ? { surfaces: stack(surfaces), normals: stack(normals), roughness: kinds.map((k) => k.roughness) } : null;
  const own = fine ? [] : surfaces;
  return {
    tile: map.tile,
    i0,
    j0,
    slots,
    cells: n,
    classes,
    colour,
    surfaces: own,
    mean: kinds.map((k) => new THREE.Vector3(...k.mean.map(linear))),
    scale: kinds.map((k) => 1 / k.metres),
    ultra: fine,
    dispose() {
      for (const t of [slots, classes, colour, ...own, ...(fine ? [fine.surfaces, fine.normals] : [])]) t.dispose();
    },
  };
}
