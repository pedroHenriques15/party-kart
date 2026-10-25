// The open world: Braga as it is, from the map the games share (braga-map, made from OpenStreetMap
// and DGT's LiDAR), loaded tile by tile round the home track (the Volta dos Amigos, tracks.ts). The land as the ground really
// is, and what's on it painted onto it; every street in the open world's area as it is (streets.ts),
// laid on the ground the karts drive on (src/world/ground.ts); every building in the area and round
// it on its own ground, with its floors and its roof, cut back at the kerb where it stands on a
// carriageway; trees; the Rio Este and its bridges; the decks and tunnels (levels.ts); the granite
// plinth with Braga's arms at the start; the sights (sights.ts); and the friends' easter eggs on their
// houses (eggs.ts). What only a race adds to the streets is road.ts, built for each track (raceOn).
import { heightOn, loadWorld, type Box, type Building as MapBuilding, type FacadeProportions, type RoofBlock, type Track as Course, type World as Braga } from 'braga-map';
import * as THREE from 'three';
import { onGrid, type Bound } from '../game/flyer.ts';
import { distanceToRoad, surfacePoint, type Track } from '../track/track.ts';
import { Rings, trimmed, worldGround, type WorldGround } from '../world/ground.ts';
import { retainingStretches, smooth, wallFootprints } from '../world/land.ts';
import { raceGround } from '../world/race.ts';
import { buildEggs, eggSpots, type Eggs } from './eggs.ts';
import { buildSights, horizon, TOURIGALO_CLEAR } from './sights.ts';
import { bake, box, mat } from './kit.ts';
import { Holes, Lattice, Surface } from './lattice.ts';
import { buildLevels, isDeck, nearLevels } from './levels.ts';
import { anisotropy, levelOf, type Graphics, type Quality } from './look.ts';
import { GRIDS, KINDS, loadCover, type Cover } from './cover.ts';
import { raceMarks } from './road.ts';
import { clipConvex, convexPieces, faces, shapeOf, wallTop, type Shape } from './roofs.ts';
import { buildStreets, groundPaths, streetEdges, type Built } from './streets.ts';
import { baysOf, facadeKit, laidOut, layerOfGround, layerOfType, linearOf, MATERIALS, storeys, Walls, type Kit, type WallLayout } from './facades.ts';
import { buildInteriors } from './interiors.ts';
import type { Room } from '../world/interiors.ts';
import { streetFront } from '../world/storeys.ts';
import * as tex from './textures.ts';
import { buildSigns } from './signs.ts';
import { buildPlates } from './plates.ts';
import { cityTrees, loadTreeLooks, type CityTree } from './trees.ts';
import type { World } from './world.ts';

// How far a point is from the open world's area (0 inside it), roughly (to within 40 m), from a grid
// of 50 m squares over the box: for keeping what's in the area and round it. Infinity outside the box.
function reach(map: Braga, B: Box): (x: number, z: number) => number {
  const C = 50;
  const nx = Math.ceil((B.x1 - B.x0) / C);
  const nz = Math.ceil((B.z1 - B.z0) / C);
  const d = new Float32Array(nx * nz);
  const e = map.open.pts;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = B.x0 + (i + 0.5) * C;
      const z = B.z0 + (j + 0.5) * C;
      if (map.inOpen(x, z)) continue;
      let m = Infinity;
      for (let k = 0; k < e.length; k++) m = Math.min(m, segDist(x, z, ...e[k], ...e[(k + 1) % e.length]));
      d[j * nx + i] = m;
    }
  }
  return (x, z) => {
    if (x < B.x0 || x >= B.x1 || z < B.z0 || z >= B.z1) return Infinity;
    return d[Math.floor((z - B.z0) / C) * nx + Math.floor((x - B.x0) / C)];
  };
}

// ---- The look of things ----

// What the ground is, painted from the map: these are its colours.
const LAND: Record<string, string> = {
  urban: '#8f8a7e',
  industrial: '#99958d',
  farm: '#8c9757',
  grass: '#6c9146',
  scrub: '#6a7944',
  forest: '#4b6834',
  park: '#628f3e',
  cemetery: '#8d977d',
  hospital: '#a7a196',
  school: '#a7a196',
  sport: '#4f8c3c',
  water: '#3e6f7c',
  plaza: '#b8b2a6',
  parking: '#8a8781',
};
// Street classes as the map numbers them: whether they have pavements. (Each street comes
// with its own width.)
const PAVED = [true, false, true, true, true, true, false, false, false, false];
const ROOFS = ['#b55a3c', '#a54e35', '#c26942', '#9c4a34'];

// The ground's material. Where the map has classed the ground (cover.ts, braga-map's task 016), each
// kind of ground with its own texture in the place's colour; elsewhere, the map painted on it with a fine
// grain tiled by world position, so it isn't smeared up close. Where the painting is clear, there's a
// street over it (streets.ts) and the land isn't drawn, whatever its height: with the cover on every
// tile under the land, the painting is only that, a mask (paintGround). The canvas leaves a clear pixel
// black, so a painted pixel's colour is taken back out of its share of what's clear.
function groundMaterial(map: THREE.Texture, cover: Cover | null, mask: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.96, alphaTest: 0.5 });
  // The cover's textures on the material as well as in its shader, so the textures' memory counts them
  // (stats.ts).
  if (cover) Object.assign(m, { coverSlots: cover.slots, coverClasses: cover.classes, coverColour: cover.colour, coverSurfaces: cover.ultra?.surfaces ?? null, coverNormals: cover.ultra?.normals ?? null }, Object.fromEntries(cover.surfaces.map((t, k) => [`surf${k}`, t])));
  const grain = tex.grain();
  const cs = cover ? coverShader(cover) : null;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.grain = { value: grain };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    if (cs) Object.assign(sh.uniforms, cs.uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D grain;\nvarying vec2 vWorldXZ;' + (cs ? cs.head : ''))
      .replace(
        '#include <map_fragment>',
        (mask
          ? 'diffuseColor.a = texture2D(map, vMapUv).r;'
          : '#include <map_fragment>\ndiffuseColor.rgb /= max(diffuseColor.a, 0.01);\ndiffuseColor.rgb *= (0.62 + 0.76 * texture2D(grain, vWorldXZ / 5.0).r) * (0.8 + 0.4 * texture2D(grain, vWorldXZ / 41.0).r);') +
          (cs ? `${cs.body}\ndiffuseColor.rgb = mix(diffuseColor.rgb, coverRgb, coverIn);` : ''),
      )
      .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\ndiffuseColor.a = 1.0;');
    if (cs) sh.fragmentShader = cs.light(sh.fragmentShader);
  };
  return m;
}

// What the ground is and nothing else, as the land has it where the map has classed it (cover.ts): for
// what a street lays over the ground but is the ground's, a roundabout's island (braga-map's task 014),
// its grass, its flower beds and its paving at the kerb's height. Grass where the map hasn't classed it.
// Its grass is LAWN, a watered lawn's green in the orthophoto (the stadium's pitch, the Rua Cidade do
// Porto's island): the summer of 2025 dried some of the islands' lawns, which every photo of them, and
// the game's March, has green (the owner's answer, 2026-10-18).
const GRASS = 3;
const LAWN = new THREE.Color().setRGB(100 / 255, 118 / 255, 106 / 255, THREE.SRGBColorSpace);
function coverMaterial(cover: Cover): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#5b7038', roughness: 0.96 });
  const cs = coverShader(cover, LAWN);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, cs.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;' + cs.head)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${cs.body}\ndiffuseColor.rgb = mix(diffuseColor.rgb, coverRgb, coverIn);`);
    sh.fragmentShader = cs.light(sh.fragmentShader);
  };
  return m;
}

// The orthophoto's colours are made bright to look at, the light ones most: its sunlit asphalt is a light
// grey (134 of 255), where worn asphalt reflects about 15% of the light, while its woods and lawns are
// about as dark as they are. As it comes, it reads almost white under the game's light (braga-map's
// task 016's test). So each colour is taken down by its brightness in linear light, L: times
// 1 / (1 + TONE × L), which takes asphalt to 62%, paving to under half, a lawn to 75% and a wood to 87%.
const TONE = 2.55;
// A wood's canopy from afar: the middle of the broadleaves' greens (trees.ts), in linear light.
const CANOPY = new THREE.Color().setHSL(0.27, 0.5, 0.235);

// The land's shader's part for the cover: its uniforms, and GLSL that sets `coverIn` (1 on a tile the
// map has classed, 0 elsewhere) and `coverRgb`, the ground there. Each fragment takes the kinds of the
// four cells round it, weighed by how near (a 50 cm cell's edge softened over half its width, so a
// kind's edge isn't a staircase); each kind present, its texture tiled at its size (sampled with the
// fragment's own gradients, taken where every fragment runs, as a texture's are only right there),
// divided by its mean and times that kind's colour there.
// On Ultra (braga-map's task 085), each kind's finest texture from one array, and its relief and roughness
// too, weighed as its colour is; `light` puts them in the land's light: the normal map's tangents the
// world's x and z (the textures' u and v), square to the land's own normal. Below Ultra it's as it was.
// `lawn`, where it's given, is the colour of every grass there in place of the texture's.
function coverShader(c: Cover, lawn?: THREE.Color): { uniforms: Record<string, THREE.IUniform>; head: string; body: string; light: (fragment: string) => string } {
  const textured = c.mean.length, relief = c.ultra;
  const uniforms: Record<string, THREE.IUniform> = {
    coverLawn: { value: lawn ?? new THREE.Color() },
    coverSlots: { value: c.slots },
    coverClasses: { value: c.classes },
    coverColour: { value: c.colour },
    coverGrid: { value: new THREE.Vector3(c.tile, c.i0, c.j0) },
    coverCells: { value: c.cells },
    surfMean: { value: c.mean },
    surfScale: { value: c.scale },
    ...(relief ? { coverSurfaces: { value: relief.surfaces }, coverNormals: { value: relief.normals }, surfRough: { value: relief.roughness } } : {}),
  };
  c.surfaces.forEach((t, k) => (uniforms[`surf${k}`] = { value: t }));
  const head = `
precision highp sampler2DArray;
uniform sampler2D coverSlots;
uniform sampler2DArray coverClasses;
uniform sampler2DArray coverColour;
uniform vec3 coverGrid;
uniform vec3 coverLawn;
uniform float coverCells;
uniform vec3 surfMean[${textured}];
uniform float surfScale[${textured}];
${relief ? 'uniform sampler2DArray coverSurfaces;\nuniform sampler2DArray coverNormals;\nuniform float surfRough[' + textured + '];' : c.surfaces.map((_, k) => `uniform sampler2D surf${k};`).join('\n')}`;
  const kinds = Array.from({ length: KINDS }, (_, k) => k);
  // Each kind's part where it's there: its colour times its texture's detail; on Ultra its relief (flat
  // for water and a roof) and its roughness (theirs the material's).
  const at = (k: number) => `vec3(vWorldXZ * surfScale[${k}], ${k}.0), gx * surfScale[${k}], gy * surfScale[${k}]`;
  const detail = (k: number) => (relief ? `textureGrad(coverSurfaces, ${at(k)})` : `textureGrad(surf${k}, vWorldXZ * surfScale[${k}], gx * surfScale[${k}], gy * surfScale[${k}])`);
  const kind = (k: number) => {
    const rgb = `coverRgb += w[${k}] * ${lawn && k === GRASS ? 'coverLawn' : `texture(coverColour, vec3(cq, float(slot * ${GRIDS} + ${k}))).rgb`}${k < textured ? ` * ${detail(k)}.rgb / surfMean[${k}]` : ''};`;
    if (!relief) return `  if (w[${k}] > 0.0) ${rgb}`;
    const lit = k < textured ? ` coverN += w[${k}] * (textureGrad(coverNormals, ${at(k)}).xyz * 2.0 - 1.0); coverRough += w[${k}] * surfRough[${k}];` : ` coverN.z += w[${k}]; coverRough += w[${k}] * roughness;`;
    return `  if (w[${k}] > 0.0) { ${rgb}${lit} }`;
  };
  const body = `
const vec3 HAZE = vec3(0.0130, 0.0284, 0.0513);
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec3 CANOPY = vec3(${[CANOPY.r, CANOPY.g, CANOPY.b].map((v) => v.toFixed(4)).join(', ')});
vec2 gx = dFdx(vWorldXZ), gy = dFdy(vWorldXZ);
vec2 tq = floor(vWorldXZ / coverGrid.x);
ivec2 ts = ivec2(tq - coverGrid.yz), tn = textureSize(coverSlots, 0);
int slot = all(greaterThanEqual(ts, ivec2(0))) && all(lessThan(ts, tn)) ? int(texelFetch(coverSlots, ts, 0).r * 255.0 + 0.5) - 1 : -1;
float coverIn = slot >= 0 ? 1.0 : 0.0;
vec3 coverRgb = vec3(0.0);${relief ? '\nvec3 coverN = vec3(0.0);\nfloat coverRough = 0.0;' : ''}
if (slot >= 0) {
  vec2 cq = vWorldXZ / coverGrid.x - tq;
  vec2 p = cq * coverCells - 0.5;
  ivec2 c0 = ivec2(floor(p));
  vec2 f = smoothstep(0.25, 0.75, fract(p));
  float w[${KINDS}];
  for (int k = 0; k < ${KINDS}; k++) w[k] = 0.0;
  float crown = 0.0;
  int last = int(coverCells) - 1;
  for (int t = 0; t < 4; t++) {
    ivec2 o = ivec2(t & 1, t >> 1);
    ivec2 cc = clamp(c0 + o, ivec2(0), ivec2(last));
    int b = int(texelFetch(coverClasses, ivec3(cc.x >> 1, cc.y, slot), 0).r * 255.0 + 0.5);
    int v = (cc.x & 1) == 0 ? b & 15 : b >> 4;
    float wt = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
    w[v & 7] += wt;
    crown += wt * float(v >> 3);
  }
${kinds.map(kind).join('\n')}
  // Under a crown the sky is hidden: its shadow is the sun's (look.ts), this is the rest.
  coverRgb *= 1.0 - 0.15 * crown;
  // The photo's colour as the ground's: the haze over the city taken out (DGT's photo is never darker
  // than this, its deepest shadows), and toned down (TONE).
  coverRgb = max(coverRgb - HAZE, 0.0) / (1.0 - HAZE);
  coverRgb /= 1.0 + ${TONE.toFixed(2)} * dot(coverRgb, LUMA);
  // From 40 m off to 160 m, a crown's ground turns into the crown itself: the city draws fewer trees than
  // stand there, and from a distance a wood is its canopy, not the ground under it. In the green of the
  // trees it draws (trees.ts), lighter or darker as the photo's canopy is there against a wood's usual.
  float away = smoothstep(40.0, 160.0, distance(cameraPosition.xz, vWorldXZ));
  float leaves = dot(texture(coverColour, vec3(cq, float(slot * ${GRIDS} + ${KINDS}))).rgb, LUMA) / 0.08;
  coverRgb = mix(coverRgb, CANOPY * clamp(leaves, 0.6, 1.4), crown * away);
}`;
  const light = (fragment: string) =>
    !relief
      ? fragment
      : fragment.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (slot >= 0) roughnessFactor = coverRough;').replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
if (slot >= 0) {
  vec3 coverT = mat3(viewMatrix) * vec3(1.0, 0.0, 0.0);
  coverT = normalize(coverT - normal * dot(normal, coverT));
  normal = normalize(mat3(coverT, cross(coverT, normal), normal) * coverN);
}`,
        );
  return { uniforms, head, body, light };
}

// ---- The world ----

// Besides the city, the world as the karts' ground (ground.ts), built for it and kept for driving on.
// What the map says the ground is, each kind with its texture (cover.ts), as the renderer's graphics card
// takes them.
// The city is built round `track`, the home track (tracks.ts): its plinth, eggs and landmarks' signs, and
// the world's walls its race takes down drawn apart (`cleared`). raceOn() adds a race on any track.
export async function buildCity(track: Track, course: Course, graphics: Graphics, renderer: THREE.WebGLRenderer): Promise<World & { eggs: Eggs; drive: WorldGround; stageYaw: number; raceOn: (track: Track, course: Course) => RaceWorld; cleared: THREE.Object3D; above: (x: number, z: number) => number; horizon: Bound }> {
  const quality = levelOf(graphics); // Ultra builds at High's level (braga-map's task 081)
  const map = await loadWorld(course.box);
  // Fetched, and turned for the graphics card in workers, while the land is worked out. If they can't be
  // had, the city goes without them: the ground painted from the map, as it was before task 016.
  const coverLoading = loadCover(map, renderer, graphics).catch((e: unknown) => (console.warn('What the ground is failed to load:', e), null));
  // The trees' bark and leaves (braga-map's task 019); without them, each kind in a colour.
  const treesLoading = loadTreeLooks(map.treeKinds, renderer, graphics).catch((e: unknown) => (console.warn("The trees' textures failed to load:", e), {}));
  const B = course.box;
  const group = new THREE.Group();
  const updates: ((t: number) => void)[] = [];
  const far = (x: number, z: number) => heightOn(map.far, x, z);
  const near = reach(map, B);

  // The world as the karts have it (ground.ts): the land as it's drawn and driven on (land.ts:
  // braga-map's ground, the LiDAR's, held down at the tunnels' mouths, the stadium level in its bowl,
  // and the Rio Este's bed cut through it), every street at its level, and what stands on them.
  const wg = worldGround(map);
  const { land, firm, river, riverAt, HW, openings } = wg.d.land;
  // The ground things stand on: the highest of the land, the streets on it and the decks over it.
  const ground = (x: number, z: number): number => wg.floor(x, z, 1e4).y;

  // The bridges the map has drawn as decks (levels.ts); and the streets' outline, and the paths'
  // (braga-map's task 050), where they meet the land.
  const decks = new Set(map.lines.filter((l) => isDeck(l, land)));
  const nearLv = nearLevels(openings, decks);
  const edges = streetEdges(map.streets);
  const outline: [number, number, number, number][] = [];
  const onGround = [...map.streets.carriageways.filter((p) => p.level === 'ground'), ...map.streets.pavements.filter((p) => p.level === 'ground'), ...groundPaths(map.streets)];
  for (const p of onGround) {
    for (const r of p.rings) {
      for (let k = 0; k < r.length; k++) {
        const [ax, az] = r[k];
        const [bx, bz] = r[(k + 1) % r.length];
        if (!edges.has(`${bx},${bz},${ax},${az}`)) outline.push([ax, az, bx, bz]);
      }
    }
  }
  const openTiles = new Set(map.open.tiles);
  const inOpenTiles = (x: number, z: number) => openTiles.has(map.tileAt(x, z));
  // With the map's ground cover on every tile under the land, the painting is only a mask (cover.ts
  // draws the colours); if the cover fails to load, the land is painted after all.
  const covered = new Set(map.groundCover.map((c) => c.tile));
  const masked = map.tiles.every((t) => covered.has(t));
  let paint = paintGround(map, B, quality, inOpenTiles, outline, onGround, masked);

  // ---- The land, the map painted on it: cells of 10 m, split into cells of 2 m where they need
  // them (on Low, 20 m and 4 m), as the data has the ground every 2 m in the area. A cell is split
  // near a tunnel's mouth or under a deck (levels.ts), and where the land shows beside a street and
  // its two triangles would miss the ground there by more than a little: so a bank, a terrace or a
  // cutting meets the street as it does. (Under a street or a building it doesn't show.) Where a big
  // cell meets small ones, the small ones' points along their shared side are set on its edge, so
  // the land has no cracks. ----
  const C = quality === 'low' ? 20 : 10;
  const F = quality === 'low' ? 4 : 2;
  const lat = new Lattice(B, C, F);
  // The map's retaining walls' footprints, which the land's triangles are cut along so it steps under
  // each wall (braga-map's task 111, land.ts's heldAtWalls). A cell one meets is split only as any is,
  // where the land shows beside a street and its triangles would miss it: splitting them all, round
  // the 80 km of the map's retaining walls, cost a fifth more triangles at every viewpoint. And the
  // strips along a pavement's back where the land behind is higher than braga-map lays it (its task
  // 044, ground.ts's backs): the land steps there, up the pavement's granite face, and each cell one
  // meets is split, or the land would slope up over the pavement across it.
  const walls = new Holes([...wallFootprints(retainingStretches(map)), ...wg.backs()]);
  const backs = new Holes(wg.backs());
  {
    const r = lat.r;
    const tol = quality === 'high' ? 0.8 : quality === 'medium' ? 1 : 1.2;
    // The small cells' points under a street or a building, where the land doesn't show.
    const W = lat.nx * r + 1;
    const H = lat.nz * r + 1;
    const raster = (polys: [number, number][][][], inset: number, v: number, m: Uint8Array) => {
      for (const rings of polys) {
        let z0 = Infinity;
        let z1 = -Infinity;
        for (const ring of rings) for (const [, z] of ring) [z0, z1] = [Math.min(z0, z), Math.max(z1, z)];
        for (let iz = Math.max(0, Math.ceil((z0 - B.z0) / F)); iz <= Math.min(H - 1, Math.floor((z1 - B.z0) / F)); iz++) {
          const z = B.z0 + iz * F;
          const xs: number[] = [];
          for (const ring of rings) {
            for (let k = 0; k < ring.length; k++) {
              const [ax, az] = ring[k];
              const [bx, bz] = ring[(k + 1) % ring.length];
              if (az > z !== bz > z) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
            }
          }
          xs.sort((a, b) => a - b);
          for (let k = 0; k + 1 < xs.length; k += 2) for (let ix = Math.max(0, Math.ceil((xs[k] + inset - B.x0) / F)); ix <= Math.min(W - 1, Math.floor((xs[k + 1] - inset - B.x0) / F)); ix++) m[iz * W + ix] |= v;
        }
      }
    };
    const hidden = new Uint8Array(W * H);
    raster(onGround.map((p) => p.rings), 0.6, 1, hidden);
    raster(map.buildings.filter((b) => near(b.pts[0][0], b.pts[0][1]) < 300).map((b) => [b.pts]), 0.3, 2, hidden);
    // The cells where the land shows next to a street.
    const touch = new Uint8Array(lat.nx * lat.nz);
    for (let iz = 1; iz < H - 1; iz++) {
      for (let ix = 1; ix < W - 1; ix++) {
        const k = iz * W + ix;
        if (hidden[k] || !(hidden[k - 1] & 1 || hidden[k + 1] & 1 || hidden[k - W] & 1 || hidden[k + W] & 1)) continue;
        touch[Math.min(lat.nz - 1, Math.floor(iz / r)) * lat.nx + Math.min(lat.nx - 1, Math.floor(ix / r))] = 1;
      }
    }
    const corner = new Float32Array((lat.nx + 1) * (lat.nz + 1));
    for (let j = 0; j <= lat.nz; j++) for (let i = 0; i <= lat.nx; i++) corner[j * (lat.nx + 1) + i] = land(B.x0 + i * C, B.z0 + j * C);
    for (let j = 0; j < lat.nz; j++) {
      for (let i = 0; i < lat.nx; i++) {
        if (backs.touches(B.x0 + i * C, B.z0 + j * C, B.x0 + (i + 1) * C, B.z0 + (j + 1) * C)) {
          lat.fine[j * lat.nx + i] = 1;
          continue;
        }
        const lv = nearLv(B.x0 + (i + 0.5) * C, B.z0 + (j + 0.5) * C);
        if (!lv && !touch[j * lat.nx + i]) continue;
        const y00 = corner[j * (lat.nx + 1) + i];
        const y10 = corner[j * (lat.nx + 1) + i + 1];
        const y01 = corner[(j + 1) * (lat.nx + 1) + i];
        const y11 = corner[(j + 1) * (lat.nx + 1) + i + 1];
        test: for (let b = 0; b <= r; b++) {
          for (let a = 0; a <= r; a++) {
            if (!lv && hidden[(j * r + b) * W + i * r + a]) continue;
            const u = a / r;
            const v = b / r;
            // The cell's two triangles, split from (i + 1, j) to (i, j + 1).
            const flat = u + v <= 1 ? y00 + (y10 - y00) * u + (y01 - y00) * v : y11 + (y01 - y11) * (1 - u) + (y10 - y11) * (1 - v);
            if (Math.abs(land(B.x0 + i * C + a * F, B.z0 + j * C + b * F) - flat) > (lv ? (quality === 'high' ? 0.5 : 0.8) : tol)) {
              lat.fine[j * lat.nx + i] = 1;
              break test;
            }
          }
        }
      }
    }
  }
  const landMesh = new Surface(lat, land, walls);
  const [cover, treeLooks] = await Promise.all([coverLoading, treesLoading]);
  if (masked && !cover) paint = paintGround(map, B, quality, inOpenTiles, outline, onGround);
  // The land isn't drawn inside a room (braga-map's task 079, world/interiors.ts): its floors stand
  // for it, and where the ground rises under the building it would stand up through them. Each
  // triangle a room's outline meets is cut to what's outside it, the land outside just as it was; what
  // was inside is kept by the room, to be drawn after all if the city leaves its building out.
  const holes = new Holes(wg.d.rooms.map((r) => r.pts));
  const holed = wg.d.rooms.slice();
  const landUnder = new Map<number, { pos: number[]; nor: number[]; uv: number[] }>();
  const lands = new THREE.Group();
  lands.name = 'land';
  const material = groundMaterial(paint, cover, masked && !!cover);
  {
    const r = lat.r;
    const W = lat.nx * r + 1;
    // A tile of the land at a time, a kilometre square, so whole tiles out of view are skipped. Its
    // normals are the land's own over a small cell either way, so they agree where tiles meet.
    const T = Math.round(1000 / C);
    for (let tj = 0; tj < lat.nz; tj += T) {
      for (let ti = 0; ti < lat.nx; ti += T) {
        const ids = new Map<number, number>();
        const pos: number[] = [];
        const nor: number[] = [];
        const uv: number[] = [];
        // A point of the small cells' lattice, made once.
        const vertex = (ix: number, iz: number): number => {
          const key = iz * W + ix;
          let v = ids.get(key);
          if (v !== undefined) return v;
          const x = B.x0 + ix * F;
          const z = B.z0 + iz * F;
          v = pos.length / 3;
          pos.push(x, landMesh.at(ix, iz), z);
          const gx = (landMesh.y(x + F, z) - landMesh.y(x - F, z)) / (2 * F);
          const gz = (landMesh.y(x, z + F) - landMesh.y(x, z - F)) / (2 * F);
          const l = Math.hypot(gx, 1, gz);
          nor.push(-gx / l, 1 / l, -gz / l);
          uv.push((x - B.x0) / (B.x1 - B.x0), 1 - (z - B.z0) / (B.z1 - B.z0));
          ids.set(key, v);
          return v;
        };
        const idx: number[] = [];
        // A point of a triangle of the lattice's (a, b, c), on its plane: its height and its normal
        // weighed between theirs, for the pieces of one a room's outline cuts.
        const P = (v: number): [number, number] => [pos[v * 3], pos[v * 3 + 2]];
        const onTri = (a: number, b: number, c: number, into: { pos: number[]; nor: number[]; uv: number[] }) => {
          const [ax, az] = P(a);
          const [bx, bz] = P(b);
          const [cx, cz] = P(c);
          const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
          return ([x, z]: [number, number]) => {
            const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
            const wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
            const wc = 1 - wa - wb;
            const k = into.pos.length / 3;
            into.pos.push(x, wa * pos[a * 3 + 1] + wb * pos[b * 3 + 1] + wc * pos[c * 3 + 1], z);
            const n = [0, 1, 2].map((q) => wa * nor[a * 3 + q] + wb * nor[b * 3 + q] + wc * nor[c * 3 + q]);
            const l = Math.hypot(n[0], n[1], n[2]) || 1;
            into.nor.push(n[0] / l, n[1] / l, n[2] / l);
            into.uv.push((x - B.x0) / (B.x1 - B.x0), 1 - (z - B.z0) / (B.z1 - B.z0));
            return k;
          };
        };
        const here = { pos, nor, uv };
        const tri = (a: number, b: number, c: number) => {
          const cut = holes.cut([P(a), P(b), P(c)]);
          if (!cut) return void idx.push(a, b, c);
          const at = onTri(a, b, c, here);
          for (const piece of cut.out) {
            const ks = piece.map(at);
            for (let q = 1; q + 1 < ks.length; q++) idx.push(ks[0], ks[q], ks[q + 1]);
          }
          for (const piece of cut.in) {
            let u = landUnder.get(piece.ring);
            if (!u) landUnder.set(piece.ring, (u = { pos: [], nor: [], uv: [] }));
            const put = onTri(a, b, c, u);
            for (let q = 1; q + 1 < piece.pts.length; q++) [piece.pts[0], piece.pts[q], piece.pts[q + 1]].forEach(put);
          }
        };
        // A point a wall's cut makes (braga-map's task 111), at the land's height there, made once; its
        // normal the land's over 5 cm, which stays on its side of the wall.
        const cuts = new Map<string, number>();
        const extra = ([x, y, z]: [number, number, number]): number => {
          const key = `${x},${z}`;
          let v = cuts.get(key);
          if (v !== undefined) return v;
          v = pos.length / 3;
          pos.push(x, y, z);
          const e = 0.05;
          const gx = (land(x + e, z) - land(x - e, z)) / (2 * e);
          const gz = (land(x, z + e) - land(x, z - e)) / (2 * e);
          const l = Math.hypot(gx, 1, gz);
          nor.push(-gx / l, 1 / l, -gz / l);
          uv.push((x - B.x0) / (B.x1 - B.x0), 1 - (z - B.z0) / (B.z1 - B.z0));
          cuts.set(key, v);
          return v;
        };
        // A triangle of the lattice, or where a retaining wall's footprint meets one of a small cell, the
        // pieces it's cut into, each a fan; each cut where a room's outline may meet it.
        const piece = (a: number, b: number, c: number, cut: boolean, small: boolean) => {
          const corners = [a, b, c];
          const ps = small ? landMesh.cut(corners.map((v): [number, number, number] => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]])) : null;
          if (!ps) return cut ? tri(a, b, c) : void idx.push(a, b, c);
          for (const p of ps) {
            const ks = p.map((q) => corners.find((v) => pos[v * 3] === q[0] && pos[v * 3 + 2] === q[2]) ?? extra(q));
            for (let k = 1; k + 1 < ks.length; k++) {
              if (cut) tri(ks[0], ks[k], ks[k + 1]);
              else idx.push(ks[0], ks[k], ks[k + 1]);
            }
          }
        };
        // Corners (i, j), (i + 1, j), (i, j + 1), (i + 1, j + 1); cut where a room's outline may meet it.
        const cell = (a: number, b: number, c: number, d: number, cut: boolean, small: boolean) => {
          piece(a, c, b, cut, small);
          piece(b, c, d, cut, small);
        };
        for (let j = tj; j < Math.min(lat.nz, tj + T); j++) {
          for (let i = ti; i < Math.min(lat.nx, ti + T); i++) {
            const cut = holes.touches(B.x0 + i * C, B.z0 + j * C, B.x0 + (i + 1) * C, B.z0 + (j + 1) * C);
            if (!lat.isFine(i, j)) {
              cell(vertex(i * r, j * r), vertex((i + 1) * r, j * r), vertex(i * r, (j + 1) * r), vertex((i + 1) * r, (j + 1) * r), cut, false);
              continue;
            }
            for (let b = 0; b < r; b++) for (let a = 0; a < r; a++) cell(vertex(i * r + a, j * r + b), vertex(i * r + a + 1, j * r + b), vertex(i * r + a, j * r + b + 1), vertex(i * r + a + 1, j * r + b + 1), cut, true);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        lands.add(mesh);
      }
    }
    group.add(lands);
  }

  // ---- The hills further off: the whole map every 50 m, under the near land where they meet. ----
  {
    const g = map.far;
    const inner = (x: number, z: number, m: number) => x > B.x0 + m && x < B.x1 - m && z > B.z0 + m && z < B.z1 - m;
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    const green = new THREE.Color('#62763f');
    const wood = new THREE.Color('#344a2a');
    const town = new THREE.Color('#9b968a');
    const cover = (i: number, j: number) => map.cover[j * g.nx + i];
    for (let j = 0; j < g.nz; j++) {
      for (let i = 0; i < g.nx; i++) {
        const x = g.x0 + i * g.step;
        const z = g.z0 + j * g.step;
        let y = far(x, z);
        if (inner(x, z, 0)) y -= 4; // tucked under the near land
        pos.push(x, y, z);
        // Woods, town and fields, as the map has them, mottled.
        const n = Math.sin(x * 0.011 + Math.sin(z * 0.007) * 2) * Math.cos(z * 0.013 + Math.sin(x * 0.009) * 2);
        const k = cover(i, j);
        c.copy(k === 1 ? wood : k === 2 ? town : green).lerp(wood, k ? n * 0.12 : smooth(60, 300, y) * 0.5 + n * 0.15);
        col.push(c.r, c.g, c.b);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < g.nz - 1; j++) {
      for (let i = 0; i < g.nx - 1; i++) {
        const x = g.x0 + (i + 0.5) * g.step;
        const z = g.z0 + (j + 0.5) * g.step;
        if (inner(x, z, 80)) continue;
        const a = j * g.nx + i;
        idx.push(a, a + g.nx, a + 1, a + 1, a + g.nx, a + g.nx + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const hills = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    hills.receiveShadow = true;
    group.add(hills);
  }

  // ---- The horizon: the hills 15 km round, under the far ones where they meet. ----
  group.add(horizon(map.horizon, map.far));

  // ---- The Rio Este: water down its course, rippling. ----
  {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let v = 0;
    for (const s of river) {
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const l = Math.hypot(dx, dz) || 1;
      const sx = (-dz / l) * (HW + 3);
      const sz = (dx / l) * (HW + 3);
      const q = pos.length / 3;
      pos.push(s.ax - sx, s.ya, s.az - sz, s.ax + sx, s.ya, s.az + sz, s.bx - sx, s.yb, s.bz - sz, s.bx + sx, s.yb, s.bz + sz);
      uv.push(0, v, 1, v, 0, v + l / 12, 1, v + l / 12);
      v += l / 12;
      idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const normal = tex.ripples();
    const water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#2f6a78', roughness: 0.06, metalness: 0.1, normalMap: normal, normalScale: new THREE.Vector2(0.6, 0.6), side: THREE.DoubleSide }));
    water.receiveShadow = true;
    group.add(water);
    updates.push((t) => normal.offset.set(t * 0.02, -t * 0.12));
  }

  // ---- Every street in the area (streets.ts), and what stands along them. ----
  // The buildings' footprints, where nothing meeting the land shows.
  const houses = new Rings(map.buildings.filter((b) => near(b.pts[0][0], b.pts[0][1]) < 100).map((b) => b.pts));
  const streets = buildStreets(map, wg, landMesh, (x, z) => houses.has(x, z), graphics, course, cover ? coverMaterial(cover) : null);
  streets.group.name = 'streets';
  group.add(streets.group);
  // The world's walls a race takes down while it runs (braga-map's `cleared`): up round the city,
  // hidden while a race is on (main.ts).
  streets.cleared.name = 'cleared walls';
  group.add(streets.cleared);
  updates.push(streets.update);

  // ---- The Rio Este's stone bridges under the streets crossing it; the decks, their pillars and
  // the tunnels' mouths (levels.ts). Baked together at the end, being many small meshes. ----
  const statics = new THREE.Group();
  statics.add(riverBridges(map, firm, riverAt, HW));
  // A mouth's concrete keeps under a street over its tunnel, and under a deck's underside.
  const under = (x: number, z: number) => {
    const f = wg.floor(x, z, 1e4);
    return f.kind === 'deck' ? f.y - 1.25 : f.kind === 'road' || f.kind === 'pavement' || f.kind === 'path' || f.kind === 'steps' ? f.y - 0.05 : Infinity;
  };
  statics.add(buildLevels(map, land, decks, openings, inOpenTiles, under));

  // ---- The plinth at the start, where the lobby shows your car; and the eggs. ----
  const all = nearBuildings(map, near, wg);
  const buildingsNear = (x: number, z: number, r: number) => {
    let n = 0;
    for (const b of all) if (Math.abs(b.cx - x) < r + 30 && Math.abs(b.cz - z) < r + 30 && b.pts.some(([px, pz]) => Math.hypot(px - x, pz - z) < r)) n++;
    return n;
  };
  const plinth = startPlinth(track, course.name, ground, buildingsNear);
  statics.add(plinth.group);
  // The top of the building at (x, z), or of the nearest one within 12 m, with its roof.
  const roofAt = (x: number, z: number) => {
    let best: { x: number; y: number; z: number } | null = null;
    let bd = 12;
    for (const b of all) {
      if (Math.abs(b.cx - x) > 60 || Math.abs(b.cz - z) > 60) continue;
      const d = inside(b.pts, x, z) ? 0 : Math.min(...b.pts.map(([px, pz], k) => segDist(x, z, px, pz, ...b.pts[(k + 1) % b.pts.length])));
      if (d >= bd) continue;
      bd = d;
      best = { x: b.cx, y: b.y + b.ridge, z: b.cz };
    }
    return best;
  };
  const spots = eggSpots(track, course.eggs);
  const eggs = buildEggs(track, ground, spots, roofAt);
  group.add(bake(eggs.group));

  // ---- Buildings, clear of the plinth, the eggs and the Tourigalo. ----
  const keepOut = [plinth.clear, ...spots.map((s) => s.clear), ...map.sights.filter((s) => s.kind === 'tourigalo').map((s) => ({ x: s.x, z: s.z, r: TOURIGALO_CLEAR }))];
  const list = all.filter((b) => !keepOut.some((k) => b.pts.some(([x, z]) => Math.hypot(x - k.x, z - k.z) < k.r) || Math.hypot(b.cx - k.x, b.cz - k.z) < k.r));
  // Those left out aren't walls for the karts either, nor rooms (braga-map's task 079).
  const kept = new Set(list);
  for (const b of all) {
    if (kept.has(b)) continue;
    wg.unroom(b.pts);
    wg.unwall(b.pts);
  }
  // The land under a room whose building that leaves out, drawn after all.
  {
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    holed.forEach((r, k) => {
      const u = landUnder.get(k);
      if (!u || wg.d.rooms.includes(r)) return;
      pos.push(...u.pos);
      nor.push(...u.nor);
      uv.push(...u.uv);
    });
    if (pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      lands.add(mesh);
    }
  }
  // A sight drawn in a building's place (São João da Ponte's chapel, the route's other chapels, São
  // Lázaro's bell tower) stands for it: the building is a wall to the karts still, but isn't drawn.
  const covers = map.sights.flatMap((s) => ('covers' in s ? [s.covers] : []));
  const drawn = list.filter((b) => !covers.some((r) => inside(r, b.cx, b.cz)));
  const rooms = new Map(wg.d.rooms.map((r) => [r.b.pts, r] as const));
  group.add(Object.assign(buildBuildings(drawn, map, facadeKit(map.facadeTypes, quality, graphics === 'ultra'), quality, rooms, graphics === 'ultra'), { name: 'buildings' }));
  // The rooms' insides: the walls' inside faces, the floors, the stairs, the roof's parapet and hut.
  group.add(Object.assign(buildInteriors(wg.d.rooms, map), { name: 'interiors' }));
  // The shops' signs, on the buildings drawn.
  group.add(buildSigns(map.signs.filter((s) => near(s.from[0], s.from[1]) <= 300 && !keepOut.some((k) => Math.hypot(s.from[0] - k.x, s.from[1] - k.z) < k.r)), map.facadeColours));
  // The streets' name plates (braga-map's task 042, plates.ts): a wall's on a building drawn (one the
  // plinth, an egg or a sight stands in place of takes its plates with it), a post's on the pavement.
  {
    const walls = new Rings(drawn.map((b) => b.pts));
    const onWall = (p: (typeof map.plates)[number]) => walls.has(p.x - Math.cos(p.face) * 0.3, p.z - Math.sin(p.face) * 0.3);
    const plates = map.plates.filter((p) => (p.on === 'post' || onWall(p)) && !keepOut.some((k) => Math.hypot(p.x - k.x, p.z - k.z) < k.r));
    group.add(buildPlates(plates, map.plateSize, streets.paveTop, map.height));
  }

  // ---- Trees: every one the map has in the box, as DGT's LiDAR measured it and of its kind (braga-map's
  // task 019), near the camera in their bark and leaves, further off as their kinds' billboards
  // (trees.ts); in the area every one the karts can hit (but those on a carriageway, ground.ts). None on
  // a carriageway, in the river, on the plinth or in the eggs' ground. ----
  {
    const trees: CityTree[] = [];
    for (const t of map.trees) {
      if (near(t.x, t.z) === Infinity || wg.d.roads.has(t.x, t.z) || riverAt(t.x, t.z).d < HW + 3) continue;
      if (keepOut.some((c) => Math.hypot(t.x - c.x, t.z - c.z) < c.r)) continue;
      trees.push({ kind: t.kind, x: t.x, y: ground(t.x, t.z), z: t.z, cx: t.cx, cz: t.cz, h: t.h, crown: t.crown, foot: t.foot, trunk: t.trunk });
    }
    group.add(Object.assign(cityTrees(trees, treeLooks, graphics, renderer), { name: 'trees' }));
  }

  // ---- The sights: Bom Jesus and the Sameiro on the hills, the cross on the Picoto, the stadium,
  // the Altice Forum, Makro and the Tourigalo. ----
  const sights = buildSights(map.sights, track, ground, far);
  group.add(sights.group);
  updates.push(sights.update);

  // ---- Brown signs to the landmarks the route passes. ----
  for (const l of course.landmarks) statics.add(landmarkSign(track, ground, streets.kerbNear, l));
  group.add(Object.assign(bake(statics), { name: 'statics' }));

  // The plinth as the karts find it, once everything is built on the ground without it: free roam
  // starts on its top, and drives off it.
  wg.stand(plinth.top, plinth.y);
  for (let k = 0; k < 4; k++) {
    const [ax, az] = plinth.back[k];
    const [bx, bz] = plinth.back[(k + 1) % 4];
    wg.wall({ ax, az, bx, bz, y0: plinth.y - 0.5, y1: plinth.y + 7 });
  }

  // What's drawn at (x, z), anywhere the horizon reaches: the city's ground in the box, the hills every
  // 50 m round it and the horizon's every 250 m past them, each the height of its triangles, tucked
  // under the nearer ones as they're drawn above. For the flying camera (main.ts), which keeps over it.
  const fg = map.far;
  const hz = map.horizon;
  const inBox = (x: number, z: number, m: number) => x > B.x0 + m && x < B.x1 - m && z > B.z0 + m && z < B.z1 - m;
  const inFar = (x: number, z: number, m: number) => x > fg.x0 + m && x < fg.x0 + (fg.nx - 1) * fg.step - m && z > fg.z0 + m && z < fg.z0 + (fg.nz - 1) * fg.step - m;
  const hillsAt = (x: number, z: number) =>
    onGrid(
      fg,
      x,
      z,
      (i, j) => fg.h[j * fg.nx + i] - (inBox(fg.x0 + i * fg.step, fg.z0 + j * fg.step, 0) ? 4 : 0),
      (i, j) => !inBox(fg.x0 + (i + 0.5) * fg.step, fg.z0 + (j + 0.5) * fg.step, 80),
    );
  const horizonAt = (x: number, z: number) =>
    onGrid(
      hz,
      x,
      z,
      (i, j) => hz.h[j * hz.nx + i] - (inFar(hz.x0 + i * hz.step, hz.z0 + j * hz.step, 0) ? 12 : 0),
      (i, j) => !inFar(hz.x0 + (i + 0.5) * hz.step, hz.z0 + (j + 0.5) * hz.step, 300),
    );
  const above = (x: number, z: number): number => Math.max(inBox(x, z, 0) ? ground(x, z) : -Infinity, hillsAt(x, z) ?? -Infinity, horizonAt(x, z) ?? -Infinity, -100);

  return {
    group,
    update: (t) => updates.forEach((u) => u(t)),
    ground,
    above,
    horizon: { x0: hz.x0, x1: hz.x0 + (hz.nx - 1) * hz.step, z0: hz.z0, z1: hz.z0 + (hz.nz - 1) * hz.step },
    stage: plinth.stage,
    stageAt: plinth.at,
    stageYaw: plinth.yaw,
    cleared: streets.cleared,
    eggs,
    drive: wg,
    raceOn: (t, c) => raceOn(group, wg, t, c, c.id === course.id),
  };
}

// A race on a track, besides the city: its ground, the world's with the race's walls and ramp (race.ts);
// and what only the race adds to the streets: the start line, the gates, the boost pads, the barriers
// at the start and across every side street it passes, the ramp, and the road works' boards round the
// corner it takes in at the ramp's landing, each laid on the street at the route's level there (on a
// deck, the deck). Its marks are up only while it's raced (main.ts): round the city the streets are as
// they are. `clears` says whether the world's walls it takes down are the city's `cleared`, drawn
// apart to be hidden while it runs: only the home track's are (a test keeps every other track's
// `cleared` empty).
export interface RaceWorld {
  ground: WorldGround;
  marks: THREE.Object3D;
  update: (t: number) => void;
  clears: boolean;
}

function raceOn(city: THREE.Group, wg: WorldGround, track: Track, course: Course, home: boolean): RaceWorld {
  const raced = raceGround(wg, track, course);
  const onRoute = (x: number, z: number) => wg.floor(x, z, track.samples[distanceToRoad(track, x, z).i].p.y + 1.5).y;
  const name = course.name.toUpperCase();
  const road = raceMarks(track, { start: tex.sign(name, 'BRAGA', '#fbfbf8', '#1d4f9c', 1024, 192, '#1d4f9c'), checkpoint: tex.sign('PONTO DE CONTROLO', '', '#111318', '#ffe14d', 1024, 160), banner: tex.banner(name) }, onRoute, raced.rows, course.boards ?? []);
  const marks = Object.assign(bake(road.group), { name: `race marks: ${course.id}`, visible: false });
  city.add(marks);
  return { ground: raced.ground, marks, update: road.update, clears: home };
}

// ---- The ground's map ----

// Paints what the ground is onto one big canvas over the scenery's box: the land, the parks and
// woods, water, squares, and beyond the open world's tiles, the streets with their pavements and
// the railway. Where a street or a path is drawn (streets.ts), the canvas is left clear, so the land
// under it isn't drawn (groundMaterial): every street and path on the ground in the area (`onGround`),
// but a little in from its edge, where the land meets it.
//
// With `mask`, where the map has classed every tile under it (cover.ts draws the ground's colours),
// only where it's clear: a byte a pixel, a quarter of the canvas's memory, and nothing painted.
function paintGround(map: Braga, B: Box, quality: Quality, inOpenTiles: (x: number, z: number) => boolean, outline: [number, number, number, number][], onGround: { rings: [number, number][][] }[], mask = false): THREE.Texture {
  const res = quality === 'high' ? 1 : quality === 'medium' ? 1.4 : 2; // metres a pixel
  const W = Math.min(4096, Math.round((B.x1 - B.x0) / res));
  const H = Math.min(4096, Math.round((B.z1 - B.z0) / res));
  const toPx: [number, number, number, number, number, number] = [W / (B.x1 - B.x0), 0, 0, H / (B.z1 - B.z0), (-B.x0 * W) / (B.x1 - B.x0), (-B.z0 * H) / (B.z1 - B.z0)];
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.setTransform(...toPx);
  g.fillStyle = '#76844f';
  g.fillRect(B.x0, B.z0, B.x1 - B.x0, B.z1 - B.z0);

  if (!mask) paintLand(g, map, B, inOpenTiles);

  // Where the streets are drawn: every piece on the ground, on a canvas of its own, less a band along
  // their outline, so the land is left only where it meets them; then cleared from the painting.
  const m = document.createElement('canvas');
  m.width = W;
  m.height = H;
  const mg = m.getContext('2d')!;
  mg.setTransform(...toPx);
  mg.fillStyle = '#000';
  for (const p of onGround) {
    mg.beginPath();
    for (const r of p.rings) r.forEach(([x, z], k) => (k ? mg.lineTo(x, z) : mg.moveTo(x, z)));
    mg.fill('evenodd');
  }
  mg.globalCompositeOperation = 'destination-out';
  mg.lineWidth = 2 * res * 0.6;
  mg.lineCap = 'round';
  mg.beginPath();
  for (const [ax, az, bx, bz] of outline) {
    mg.moveTo(ax, az);
    mg.lineTo(bx, bz);
  }
  mg.stroke();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(m, 0, 0);
  g.globalCompositeOperation = 'source-over';

  if (mask) {
    // How much of each pixel isn't clear, a byte each; its rows bottom up, as the canvas's are
    // uploaded (the land's v is 1 at the box's north edge).
    const rgba = g.getImageData(0, 0, W, H).data;
    const a = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) a[(H - 1 - j) * W + i] = rgba[(j * W + i) * 4 + 3];
    const t = new THREE.DataTexture(a, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    t.flipY = false;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy();
    t.needsUpdate = true;
    return t;
  }
  // Taken as the canvas holds it, each colour already times its share of what's clear, so a pixel at
  // a street's edge is blended rightly with its neighbours (groundMaterial takes the share back out).
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.premultiplyAlpha = true;
  t.anisotropy = anisotropy();
  return t;
}

// The land painted from the map, for paintGround: the parks and woods, water and squares; and beyond
// the open world's tiles, the streets with their pavements, and the railway.
function paintLand(g: CanvasRenderingContext2D, map: Braga, B: Box, inOpenTiles: (x: number, z: number) => boolean): void {
  for (const { kind, pts, holes } of map.areas) {
    g.fillStyle = LAND[kind] ?? LAND.urban;
    g.beginPath();
    // Its outline, less its holes (a clearing in a wood, braga-map's task 016).
    for (const r of [pts, ...holes]) {
      r.forEach(([x, z], k) => (k ? g.lineTo(x, z) : g.moveTo(x, z)));
      g.closePath();
    }
    g.fill('evenodd');
    // Pitches get their white lines, roughly.
    if (kind === 'sport') {
      g.strokeStyle = 'rgba(240,240,235,0.55)';
      g.lineWidth = 0.35;
      g.stroke();
    }
  }

  // The streets beyond the open world's tiles: pavement first, then asphalt; the small ones, then the
  // big ones. (In them, every street is drawn: streets.ts.)
  g.save();
  g.beginPath();
  g.rect(B.x0, B.z0, B.x1 - B.x0, B.z1 - B.z0);
  for (const t of map.open.tiles) {
    const [i, j] = t.match(/-?\d+/g)!.map(Number);
    g.rect(i * map.tile, j * map.tile, map.tile, map.tile);
  }
  g.clip('evenodd');
  const lines = map.lines.filter((l) => l.level !== 'tunnel' && !l.pts.every(([x, z]) => inOpenTiles(x, z))).map(({ kind, w, pts }) => ({ k: kind, w, pts }));
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const stroke = (pts: [number, number][], width: number, color: string) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    pts.forEach(([x, z], k) => (k ? g.lineTo(x, z) : g.moveTo(x, z)));
    g.stroke();
  };
  for (const { k, w, pts } of lines) if (k < 9 && PAVED[k]) stroke(pts, w + 5, '#948f86');
  for (const { k, w, pts } of lines) stroke(pts, w, k === 9 ? '#5d5249' : k === 6 ? '#d6d1c6' : k >= 7 ? '#77746c' : '#47494d');
  // A dashed centre line on the big roads.
  g.setLineDash([3, 4]);
  for (const { k, pts } of lines) if (k <= 3) stroke(pts, 0.15, 'rgba(240,240,232,0.8)');
  g.setLineDash([]);
  g.restore();
}

// ---- The Rio Este's bridges ----

// A granite bridge under each street that crosses the river at the ground's level (the street on the
// land without the river's bed cut into it, as the karts drive it): a block with an arch through it
// over the water.
function riverBridges(map: Braga, firm: (x: number, z: number) => number, riverAt: (x: number, z: number) => { d: number; y: number }, halfW: number): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ map: tex.rock(), color: '#cfc6b6', roughness: 0.9 });
  const done: [number, number][] = [];
  for (const l of map.lines) {
    if (l.kind > 8 || (l.level !== 'ground' && l.level !== 'under')) continue;
    for (let k = 1; k < l.pts.length; k++) {
      const [ax, az] = l.pts[k - 1];
      const [bx, bz] = l.pts[k];
      const L = Math.hypot(bx - ax, bz - az);
      // Where it's nearest the river's middle, if it's over the water there.
      let best = { d: Infinity, t: 0 };
      for (let t = 0; t <= 1; t += 1 / Math.max(1, Math.ceil(L))) {
        const d = riverAt(ax + (bx - ax) * t, az + (bz - az) * t).d;
        if (d < best.d) best = { d, t };
      }
      if (best.d > halfW * 0.5) continue;
      const x = ax + (bx - ax) * best.t;
      const z = az + (bz - az) * best.t;
      if (done.some(([px, pz]) => Math.hypot(px - x, pz - z) < 10)) continue;
      done.push([x, z]);
      const ux = (bx - ax) / L;
      const uz = (bz - az) / L;
      const top = firm(x, z) - 0.05;
      const water = riverAt(x, z).y;
      const half = halfW + 4;
      const bottom = water - 1.5 - top;
      const shape = new THREE.Shape();
      shape.moveTo(-half, bottom);
      shape.lineTo(half, bottom);
      shape.lineTo(half, 0);
      shape.lineTo(-half, 0);
      shape.closePath();
      // A flat (segmental) arch over the water, kept well inside the block.
      const r = Math.min(halfW + 1, half - 2);
      const spring = water - top;
      const rise = Math.max(1, -0.9 - spring);
      const hole = new THREE.Path();
      hole.moveTo(-r, bottom + 0.3);
      hole.lineTo(r, bottom + 0.3);
      hole.lineTo(r, spring);
      hole.absellipse(0, spring, r, rise, 0, Math.PI, false);
      hole.lineTo(-r, bottom + 0.3);
      shape.holes.push(hole);
      const width = l.w + 7;
      const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
      geo.translate(0, 0, -width / 2);
      const m = new THREE.Mesh(geo, stone);
      m.castShadow = true;
      m.receiveShadow = true;
      m.position.set(x, top, z);
      m.rotation.y = -Math.atan2(uz, ux);
      g.add(m);
    }
  }
  return g;
}

// ---- Buildings ----

// A building as the map has it (its height and roof measured from the LiDAR, mostly), its middle,
// and how far that is from the open world's area (to within 40 m). One cut back at the kerb is one or
// more of these, each its own part of the footprint, with the whole one's roof (`whole`).
type Building = MapBuilding & { cx: number; cz: number; road: number; whole?: [number, number][] };

// The map's buildings in the area and within 300 m of it, in the box. One that stands on a carriageway
// is cut back at the kerb (braga-map's decision 021), as the karts find it (ground.ts): solid only off
// the carriageway, a passage through one left open; and so at a path's passage under one (its task
// 050).
function nearBuildings(map: Braga, near: (x: number, z: number) => number, wg: WorldGround): Building[] {
  const out: Building[] = [];
  for (const b of map.buildings) {
    const n = b.pts.length;
    const cx = b.pts.reduce((a, p) => a + p[0], 0) / n;
    const cz = b.pts.reduce((a, p) => a + p[1], 0) / n;
    const r = near(cx, cz);
    if (r > 300) continue;
    if (r > 60) {
      out.push({ ...b, cx, cz, road: r });
      continue;
    }
    const { segs, cut } = trimmed(b.pts, wg.d.cuts);
    if (!cut) {
      out.push({ ...b, cx, cz, road: r });
      continue;
    }
    for (const pts of loops(segs)) {
      const m = pts.length;
      out.push({ ...b, pts, cx: pts.reduce((a, p) => a + p[0], 0) / m, cz: pts.reduce((a, p) => a + p[1], 0) / m, road: r, whole: b.pts });
    }
  }
  return out;
}

// Segments that close into rings (what's left of a footprint cut at the kerb) joined into them, end
// to end, either way round. Pieces that don't close are left out.
function loops(segs: [number, number, number, number][]): [number, number][][] {
  const id = (x: number, z: number) => `${Math.round(x * 100)},${Math.round(z * 100)}`;
  const at = new Map<string, number[]>();
  segs.forEach(([ax, az, bx, bz], k) => {
    for (const p of [id(ax, az), id(bx, bz)]) at.set(p, [...(at.get(p) ?? []), k]);
  });
  const used = new Set<number>();
  const out: [number, number][][] = [];
  for (let s = 0; s < segs.length; s++) {
    if (used.has(s)) continue;
    used.add(s);
    const ring: [number, number][] = [[segs[s][0], segs[s][1]]];
    let [x, z] = [segs[s][2], segs[s][3]];
    const start = id(segs[s][0], segs[s][1]);
    let closed = false;
    for (let guard = 0; guard < segs.length; guard++) {
      if (id(x, z) === start) {
        closed = true;
        break;
      }
      ring.push([x, z]);
      const next = (at.get(id(x, z)) ?? []).find((k) => !used.has(k));
      if (next === undefined) break;
      used.add(next);
      const [ax, az, bx, bz] = segs[next];
      [x, z] = id(ax, az) === id(x, z) ? [bx, bz] : [ax, az];
    }
    if (closed && ring.length >= 3) out.push(ring);
  }
  return out;
}

// Is (x, z) inside the outline?
function inside(pts: [number, number][], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[j];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) c = !c;
  }
  return c;
}

// How far (x, z) is from the segment from (ax, az) to (bx, bz).
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}

// Geometry being gathered for one material: positions, normals, uvs and colours.
class Batch {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ua: [number, number], ub: [number, number], uc: [number, number], color: THREE.Color): void {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const [p, u] of [[a, ua], [b, ub], [c, uc]] as const) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(u[0], u[1]);
      this.col.push(color.r, color.g, color.b);
    }
  }
  // A triangle facing up, whichever way round its corners come.
  up(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ua: [number, number], ub: [number, number], uc: [number, number], color: THREE.Color): void {
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if (ny >= 0) this.tri(a, b, c, ua, ub, uc, color);
    else this.tri(a, c, b, ua, uc, ub, color);
  }
  // A quad a, b, c, d (counter-clockwise seen from the side it faces).
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, ua: [number, number], ub: [number, number], uc: [number, number], ud: [number, number], color: THREE.Color): void {
    this.tri(a, b, c, ua, ub, uc, color);
    this.tri(a, c, d, ua, uc, ud, color);
  }
}

// Batches as one mesh, each its layer of the material's textures: the vertices' uv and layer in
// `wuv`.
function merged(parts: [Batch, number][], material: THREE.Material): THREE.Mesh | null {
  const n = parts.reduce((a, [b]) => a + b.pos.length / 3, 0);
  if (!n) return null;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const wuv = new Float32Array(n * 3);
  let o = 0;
  for (const [b, layer] of parts) {
    pos.set(b.pos, o * 3);
    nor.set(b.nor, o * 3);
    col.set(b.col, o * 3);
    for (let k = 0; k < b.uv.length / 2; k++) wuv.set([b.uv[k * 2], b.uv[k * 2 + 1], layer], (o + k) * 3);
    o += b.pos.length / 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('wuv', new THREE.BufferAttribute(wuv, 3));
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// The material of a mesh whose vertices each take a layer of `array` (merged): tinted by their
// colours. With `ground`, layer 0 (the flats' floors) takes layer 1 (doors and shops) below v = 1.
function layeredMaterial(array: THREE.DataArrayTexture, roughness: number, ground = false): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.layers = { value: array };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 wuv;\nvarying vec3 vWuv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWuv = wuv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray layers;\nvarying vec3 vWuv;')
      .replace('#include <map_fragment>', ground ? 'diffuseColor *= texture(layers, vec3(vWuv.xy, vWuv.z < 0.5 && vWuv.y <= 1.0 ? 1.0 : vWuv.z));' : 'diffuseColor *= texture(layers, vWuv);');
  };
  return m;
}

// A roof's colour as the aerial photo has it, as it looks from the street: the photo sees it through
// 5 km of haze, paler and bluer than it is. Terracotta (warm) gets three times its colour back, and
// slate (cool, the haze's blue) loses half of what it seems to have; all a little darker.
function seenUpClose([r, g, b]: [number, number, number]): [number, number, number] {
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  const k = r >= b ? 3 : 0.5;
  return [r, g, b].map((c) => Math.max(0, Math.min(255, 0.85 * (l + (c - l) * k))) / 255) as [number, number, number];
}

// A quad into a batch, facing n whichever way round its corners come.
function faceQuad(batch: Batch, p: THREE.Vector3[], uv: [number, number][], n: [number, number, number], color: THREE.Color): void {
  const c = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
  if (c.x * n[0] + c.y * n[1] + c.z * n[2] >= 0) batch.quad(p[0], p[1], p[2], p[3], uv[0], uv[1], uv[2], uv[3], color);
  else batch.quad(p[0], p[3], p[2], p[1], uv[0], uv[3], uv[2], uv[1], color);
}

// What stands on a roof as the LiDAR's points have it (braga-map's task 087): a chimney, a dormer, a lift's
// machine room, a water tank, each a box from the roof under it up to its top, its sides in the walls'
// colour and its top the roof's (into the flat roofs' batch, whose texture is concrete's grain).
function roofBlocks(blocks: RoofBlock[], shape: Shape, foot: number, into: Batch, side: THREE.Color, top: THREE.Color): void {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  for (const q of blocks) {
    const vx = -q.uz;
    const vz = q.ux;
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]): [number, number] => [q.x + q.ux * q.l * a + vx * q.w * b, q.z + q.uz * q.l * a + vz * q.w * b]);
    // From a little under the roof where it's lowest under the box, so it never stands clear of it.
    const low = foot + Math.min(...c.map(([x, z]) => shape.height(x, z))) - 0.05;
    const high = foot + q.top;
    if (high < low + 0.2) continue;
    for (let k = 0; k < 4; k++) {
      const [ax, az] = c[k];
      const [bx, bz] = c[(k + 1) % 4];
      const l = Math.hypot(bx - ax, bz - az);
      const mx = (ax + bx) / 2 - q.x;
      const mz = (az + bz) / 2 - q.z;
      const m = Math.hypot(mx, mz) || 1;
      faceQuad(into, [V(ax, low, az), V(bx, low, bz), V(bx, high, bz), V(ax, high, az)], [[0, low / 3], [l / 3, low / 3], [l / 3, high / 3], [0, high / 3]], [mx / m, 0, mz / m], side);
    }
    faceQuad(into, c.map(([x, z]) => V(x, high, z)), c.map(([x, z]): [number, number] => [x / 3, z / 3]), [0, 1, 0], top);
  }
}

// A wall's balconies, as its facade says they are (braga-map's task 017), on each storey over the
// ground floor: projecting, a slab under every other bay's window (every bay's on a wall of two or
// fewer) with a railing round it; continuous, a slab the wall's length; enclosed, a slab glazed in
// up to the next floor; French, a railing across the window. Slabs in the walls' colour (into the
// flat roofs' batch, whose texture is concrete's grain), railings dark on an old house and a house,
// light aluminium on a block. Where the wall's layout read a storey (`spans`: each storey's balconies'
// doors, from and to along the wall), a balcony at each of its doors, as wide as its window's would be.
function balconiesOn(f: MapBuilding['facade'], P: FacadeProportions, w: WallLayout, a: [number, number], d: [number, number], n: [number, number], L: number, foot: number, into: { flat: Batch; rails: Batch }, colour: [number, number, number], spans?: ([number, number][] | null)[]): void {
  const kind = f.balconies;
  if (kind === 'none' || kind === 'recessed' || !w.bays) return;
  const wallCol = new THREE.Color().setRGB(colour[0] / 255, colour[1] / 255, colour[2] / 255, THREE.SRGBColorSpace);
  const rail = new THREE.Color(f.type === 'old-house' || f.type === 'house' ? '#2a2a2a' : '#d6d6d2');
  const glass = new THREE.Color('#4c5d6b');
  const V = (s: number, out: number, y: number) => new THREE.Vector3(a[0] + d[0] * s + n[0] * out, y, a[1] + d[1] * s + n[1] * out);
  const nOut: [number, number, number] = [n[0], 0, n[1]];
  const along: [number, number, number] = [d[0], 0, d[1]];
  const back: [number, number, number] = [-d[0], 0, -d[1]];
  // A slab from s0 to s1 along the wall, out to `depth`, from y0 to y1, as it's seen from the street: its
  // front and its underside (its top, behind the railing, and its thin ends aren't drawn); with `box`,
  // its ends too (a glazed balcony's).
  const slab = (s0: number, s1: number, depth: number, y0: number, y1: number, col: THREE.Color, batch: Batch, box = false) => {
    const uv = (x: number, y: number): [number, number] => [x / 3, y / 3];
    faceQuad(batch, [V(s0, 0, y0), V(s1, 0, y0), V(s1, depth, y0), V(s0, depth, y0)], [uv(s0, 0), uv(s1, 0), uv(s1, depth), uv(s0, depth)], [0, -1, 0], col);
    faceQuad(batch, [V(s0, depth, y0), V(s1, depth, y0), V(s1, depth, y1), V(s0, depth, y1)], [uv(s0, y0), uv(s1, y0), uv(s1, y1), uv(s0, y1)], nOut, col);
    if (!box) return;
    faceQuad(batch, [V(s0, 0, y0), V(s0, depth, y0), V(s0, depth, y1), V(s0, 0, y1)], [uv(0, y0), uv(depth, y0), uv(depth, y1), uv(0, y1)], back, col);
    faceQuad(batch, [V(s1, 0, y0), V(s1, depth, y0), V(s1, depth, y1), V(s1, 0, y1)], [uv(0, y0), uv(depth, y0), uv(depth, y1), uv(0, y1)], along, col);
  };
  // A railing 1 m high round a slab's front and ends (or across a window, 10 cm out).
  const railing = (s0: number, s1: number, depth: number, y: number, ends: boolean) => {
    const uv = (x: number, h: number): [number, number] => [x / 1, h];
    faceQuad(into.rails, [V(s0, depth, y), V(s1, depth, y), V(s1, depth, y + 1), V(s0, depth, y + 1)], [uv(0, 0), uv(s1 - s0, 0), uv(s1 - s0, 1), uv(0, 1)], nOut, rail);
    if (!ends) return;
    for (const s of [s0, s1]) faceQuad(into.rails, [V(s, 0.05, y), V(s, depth, y), V(s, depth, y + 1), V(s, 0.05, y + 1)], [uv(0, 0), uv(depth, 0), uv(depth, 1), uv(0, 1)], s === s0 ? back : along, rail);
  };
  const D = Math.max(0.6, P.balcony || 1.2);
  for (let i = 1; i < w.floors; i++) {
    const y = foot + w.G + (i - 1) * w.S;
    const read = spans?.[i];
    if (kind === 'continuous') {
      // None on a storey read with no balcony's door.
      if (read && !read.length) continue;
      slab(w.margin, L - w.margin, D, y - 0.18, y, wallCol, into.flat);
      railing(w.margin, L - w.margin, D, y, true);
      continue;
    }
    if (read) {
      for (const [s0, s1] of read) {
        const mid = (s0 + s1) / 2;
        if (kind === 'french') {
          railing(s0 - 0.1, s1 + 0.1, 0.12, y, false);
          continue;
        }
        const half = (s1 - s0) / 2 + 0.45;
        if (kind === 'projecting') {
          slab(Math.max(0, mid - half), Math.min(L, mid + half), D, y - 0.18, y, wallCol, into.flat);
          railing(Math.max(0, mid - half), Math.min(L, mid + half), D, y, true);
        } else if (kind === 'enclosed') {
          slab(Math.max(0, mid - half), Math.min(L, mid + half), D, y - 0.18, y + 0.9, wallCol, into.flat, true);
          slab(Math.max(0, mid - half), Math.min(L, mid + half), D, y + 0.9, y + Math.min(w.S - 0.25, 2.4), glass, into.flat, true);
        }
      }
      continue;
    }
    for (let k = 0; k < w.bays; k++) {
      const mid = w.margin + (k + 0.5) * w.bayW;
      if (kind === 'french') {
        const half = Math.min(w.bayW / 2 - 0.1, P.win[0] / 2 + 0.1);
        railing(mid - half, mid + half, 0.12, y, false);
        continue;
      }
      if (w.bays > 2 && k % 2 === 0) continue;
      const half = Math.min(w.bayW / 2 - 0.15, P.win[0] / 2 + 0.45);
      if (kind === 'projecting') {
        slab(mid - half, mid + half, D, y - 0.18, y, wallCol, into.flat);
        railing(mid - half, mid + half, D, y, true);
      } else if (kind === 'enclosed') {
        slab(mid - half, mid + half, D, y - 0.18, y + 0.9, wallCol, into.flat, true);
        slab(mid - half, mid + half, D, y + 0.9, y + Math.min(w.S - 0.25, 2.4), glass, into.flat, true);
      }
    }
  }
}

// Each building stands on the ground at its lowest corner, from the map, its walls going a little
// below it, so a row of houses steps down a hill as the real ones do. Its walls rise to its eaves,
// and under a gable to its roof, which is as the map measured it (roofs.ts): its shape, the way it
// runs, its pitch, its ridge's height and its colour, tiles or sheets or flat. Its walls are its
// facade as the map says it is (facades.ts, braga-map's task 017): its kind's windows, in its storeys,
// its material and colours, and along a street its ground floor as it is. A wall another building
// stands against, as high as it or higher, isn't drawn.
function buildBuildings(list: Building[], map: Braga, kit: Kit, quality: Quality, rooms: Map<[number, number][], Room>, ultra = false): THREE.Group {
  // Balconies on the buildings in the open world or by it (High: within 60 m of its edge; Medium: in it).
  const balconyReach = quality === 'high' ? 60 : quality === 'medium' ? 0 : -1;
  const front = streetFront(map.lines);
  // The batches a kilometre square at a time, so whole squares out of view are skipped, and the sun's
  // shadows (drawn only 70 m round the camera) draw only those near it.
  const batches = () => ({ walls: new Walls(), tiles: new Batch(), flat: new Batch(), rails: new Batch() });
  const sets = new Map<string, ReturnType<typeof batches>>();
  const setOf = (b: Building) => {
    const k = `${Math.floor(b.cx / 1000)},${Math.floor(b.cz / 1000)}`;
    let s = sets.get(k);
    if (!s) sets.set(k, (s = batches()));
    return s;
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const col = new THREE.Color();
  const roofCol = new THREE.Color();

  // Each footprint counter-clockwise seen from above (x east, z south), so the walls face out, and
  // its roof's shape; and each wall by its two corners, to find the one behind it.
  const all = list.map((b) => {
    let pts = b.pts;
    let area = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
    if (area < 0) pts = [...pts].reverse();
    // A building cut back at the kerb keeps the whole one's roof; on Ultra, the roof's own planes where
    // the map has them (braga-map's task 087), but over a room's stairs.
    return { b, pts, shape: shapeOf({ ...b, pts: b.whole ?? pts }, ultra && !rooms.has(b.pts)), rev: area < 0 };
  });
  const side = (a: [number, number], c: [number, number]) => `${a[0]},${a[1]}>${c[0]},${c[1]}`;
  const sides = new Map<string, (typeof all)[number]>();
  for (const it of all) for (let k = 0; k < it.pts.length; k++) sides.set(side(it.pts[k], it.pts[(k + 1) % it.pts.length]), it);

  for (const { b, pts, shape, rev } of all) {
    const { walls, tiles, flat, rails } = setOf(b);
    const base = b.y - 0.6;
    const foot = b.y;
    const church = b.kind === 3;
    if (b.roofColor) roofCol.setRGB(...seenUpClose(b.roofColor), THREE.SRGBColorSpace);
    else roofCol.set(b.material === 0 ? ROOFS[b.color % ROOFS.length] : b.material === 1 ? '#8b8e90' : '#8f8c86');

    // Walls: the facade's kind's bays along each wall and its storeys up it, the ground floor below
    // the first storey's line (v = 1) as it is along a street, else as its storeys are (or plain wall,
    // behind a building with shops or garages); its material and colours.
    const f = b.facade;
    const P = map.facadeTypes[f.type];
    const { G, S, floors } = storeys(P, b.h, b.floors, b.roof === 0);
    const wallRgb = linearOf(map.facadeColours[f.colour]);
    const baseRgb = f.base ? linearOf(map.facadeColours[f.base.colour]) : wallRgb;
    const shutRgb = linearOf(f.shutters ? map.facadeColours[f.shutters] : [216, 213, 206]);
    const storeyLayer = layerOfType(f.type);
    const wallMat = MATERIALS.indexOf(f.material);
    const baseMat = f.base ? MATERIALS.indexOf(f.base.material) : wallMat;
    const homes = f.type === 'house' || f.type === 'old-house' || f.type.startsWith('block');
    // A room's doors and windows, open (braga-map's task 079, world/interiors.ts).
    const room = rooms.get(b.pts);
    // Its front door: in the middle of its longest wall along a street, where its ground floor is homes.
    let doorWall = -1;
    if (homes && f.ground === 'housing' && !room) {
      let best = 0;
      for (let k = 0; k < pts.length; k++) {
        const [ax, az] = pts[k];
        const [bx, bz] = pts[(k + 1) % pts.length];
        const l = Math.hypot(bx - ax, bz - az);
        if (l > best && l > 2 && front(ax, az, bx, bz, (bz - az) / l, -(bx - ax) / l)) {
          best = l;
          doorWall = k;
        }
      }
    }
    // Where its doors and windows are on each side, as a photo showed them (braga-map's task 086): the map's
    // side for this one, run the other way where the footprint was turned round.
    const layoutOf = (k: number, L: number) => {
      const n = pts.length;
      const st = f.layout?.[rev ? (2 * n - 2 - k) % n : k];
      return st && (rev ? st.map((o) => o && o.map((q) => ({ ...q, at: L - q.at - q.w })).reverse()) : st);
    };
    let u = 0;
    for (let k = 0; k < pts.length; k++) {
      const top = wallTop(shape, pts[k], pts[(k + 1) % pts.length]);
      // Hidden by the building behind it: no lower, and standing no higher.
      const o = sides.get(side(pts[(k + 1) % pts.length], pts[k]));
      const hidden = o && o.b.y <= b.y + 0.05 && top.every(([x, z, h]) => o.b.y + o.shape.height(x, z) >= foot + h - 0.05);
      // One polygon, its top the roof over it: convex, as the roof is the lowest of its planes, so a
      // fan from its first corner's foot.
      const [x0, z0] = top[0];
      const [x1, z1] = top[top.length - 1];
      const L = Math.hypot(x1 - x0, z1 - z0);
      if (!hidden && L > 0.01) {
        // The footprint runs counter-clockwise seen from above, so out is to the right of the way round.
        const nx = (z1 - z0) / L;
        const nz = -(x1 - x0) / L;
        const onStreet = front(x0, z0, x1, z1, nx, nz);
        const groundLayer = onStreet ? (f.ground === 'housing' ? storeyLayer : layerOfGround(f.ground)) : homes && (f.ground === 'housing' || f.type === 'house' || f.type === 'old-house') ? storeyLayer : -1;
        const bays = baysOf(P, L, f.type);
        const side = room?.sides[k];
        const door = side ? side.door : k === doorWall && bays.bays ? Math.floor(bays.bays / 2) : -1;
        const layout: WallLayout = { G, S, floors, ...bays, s0: u, kit: [storeyLayer, groundLayer, wallMat, baseMat], wall: wallRgb, base: baseRgb, shut: shutRgb, door };
        const at = (x: number, z: number, y: number) => [x, y, z, Math.hypot(x - x0, z - z0), y - foot];
        const laid = side?.open.length ? null : layoutOf(k, L);
        if (side?.open.length) {
          // With its openings: the wall's outline along it and up it (s, h) with a hole for each.
          const V2 = (s: number, h: number) => new THREE.Vector2(s, h);
          const contour = [V2(0, base - foot), V2(L, base - foot), ...top.slice().reverse().map(([x, z, h]) => V2(Math.hypot(x - x0, z - z0), h))];
          const holes = side.open.map((o) => [V2(o.s0, o.y0 - foot), V2(o.s0, o.y1 - foot), V2(o.s1, o.y1 - foot), V2(o.s1, o.y0 - foot)]);
          const pts2 = [...contour, ...holes.flat()];
          const P3 = (v: THREE.Vector2) => at(x0 + ((x1 - x0) * v.x) / L, z0 + ((z1 - z0) * v.x) / L, foot + v.y);
          for (const [i, j, q] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
            const [a, c, d] = [P3(pts2[i]), P3(pts2[j]), P3(pts2[q])];
            // Facing out, whichever way round the triangulation gave it: its normal's x and z.
            const ex = (c[1] - a[1]) * (d[2] - a[2]) - (c[2] - a[2]) * (d[1] - a[1]);
            const ez = (c[0] - a[0]) * (d[1] - a[1]) - (c[1] - a[1]) * (d[0] - a[0]);
            if (ex * nx + ez * nz < 0) walls.tri(a, d, c, layout);
            else walls.tri(a, c, d, layout);
          }
        } else if (!(laid && laidOut(walls, layout, laid, P, L, base - foot, top.map(([x, z, h]) => [Math.hypot(x - x0, z - z0), h]), (s, h) => at(x0 + ((x1 - x0) * s) / L, z0 + ((z1 - z0) * s) / L, foot + h)))) {
          const foot0 = at(x0, z0, base);
          const corners = top.map(([x, z, h]) => at(x, z, foot + h));
          corners.push(at(x1, z1, base));
          for (let q = 0; q + 1 < corners.length; q++) walls.tri(foot0, corners[q], corners[q + 1], layout);
        }
        // Its balconies, along a street, in the open world or by it: where its layout has them, at its
        // balconies' doors.
        const spans = laid?.map((st) => st && st.filter((o) => o.kind === 'balcony').map((o): [number, number] => [o.at, o.at + o.w]));
        if (onStreet && b.road <= balconyReach && floors > 1) balconiesOn(f, P, layout, [x0, z0], [(x1 - x0) / L, (z1 - z0) / L], [nx, nz], L, foot, { flat, rails }, map.facadeColours[f.colour], spans);
      }
      u += L;
    }

    // The roof. Flat: the footprint at the eaves; a tower's open over its stairs.
    if (b.roof === 0 && !shape.groups) {
      const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
      const hole = room?.stair ? [room.stair.hole.map(([x, z]) => new THREE.Vector2(x, z))] : [];
      const ring = [...pts, ...(room?.stair ? room.stair.hole : [])];
      const top = foot + b.h;
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, hole)) {
        const P = (n: number) => V(ring[n][0], top, ring[n][1]);
        const U = (n: number): [number, number] => [ring[n][0] / 6, ring[n][1] / 6];
        flat.up(P(i), P(j), P(k), U(i), U(j), U(k), roofCol);
      }
    } else {
      // Pitched, or of its own planes (braga-map's task 087): each face, its tiles (or sheets, grey) in
      // rows along its eaves, a flat roof's its own. Over the footprint's rectangle, overhanging the
      // walls (a pitched roof of its own planes as far as the points say), where the footprint nearly
      // fills it; else cut to the footprint.
      const level = b.roof === 0;
      const batch = level ? flat : tiles;
      const lay = (poly: [number, number][], g: { gx: number; gz: number }) => {
        const k = Math.hypot(g.gx, g.gz) || 1;
        const ax = -g.gz / k;
        const az = g.gx / k;
        const sin = Math.sin(Math.atan(k));
        const P = (p: [number, number]) => V(p[0], foot + shape.height(p[0], p[1]), p[1]);
        const U = (p: [number, number]): [number, number] => (level ? [p[0] / 6, p[1] / 6] : [(p[0] * ax + p[1] * az) / 3, (foot + shape.height(p[0], p[1])) / (3 * (sin || 1))]);
        for (let i = 1; i + 1 < poly.length; i++) batch.up(P(poly[0]), P(poly[i]), P(poly[i + 1]), U(poly[0]), U(poly[i]), U(poly[i + 1]), roofCol);
      };
      const over = level ? 0 : shape.groups && b.overhang != null ? b.overhang : 0.4;
      if (shape.fill > 0.9 && !b.whole) for (const f of faces(shape, over)) lay(f.pts, f.plane);
      else {
        const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
        const fs = faces(shape, 0);
        for (const part of convexPieces(pts, THREE.ShapeUtils.triangulateShape(contour, []))) {
          for (const f of fs) {
            const piece = clipConvex(f.pts, part.map((n) => pts[n]));
            if (piece.length >= 3) lay(piece, f.plane);
          }
        }
      }
      // Where the walls stand over a roof of its own planes (a flat roof's parapet round its deck): their
      // inside, in the roof's colour.
      if (shape.eaves !== undefined) {
        for (let k = 0; k < pts.length; k++) {
          const top = wallTop(shape, pts[k], pts[(k + 1) % pts.length]);
          for (let q = 0; q + 1 < top.length; q++) {
            const [ax, az, ah] = top[q];
            const [cx, cz, ch] = top[q + 1];
            const ra = shape.height(ax, az);
            const rc = shape.height(cx, cz);
            if (ah - ra < 0.05 && ch - rc < 0.05) continue;
            const l = Math.hypot(cx - ax, cz - az) || 1;
            faceQuad(flat, [V(ax, foot + ra, az), V(cx, foot + rc, cz), V(cx, foot + ch, cz), V(ax, foot + ah, az)], [[0, ra / 3], [l / 3, rc / 3], [l / 3, ch / 3], [0, ah / 3]], [-(cz - az) / l, 0, (cx - ax) / l], roofCol);
          }
        }
      }
    }
    // What stands on the roof, on Ultra (braga-map's task 087).
    if (ultra && b.blocks && shape.planes.length) roofBlocks(b.blocks, shape, foot, flat, new THREE.Color().setRGB(...(map.facadeColours[f.colour].map((v) => v / 255) as [number, number, number]), THREE.SRGBColorSpace), roofCol);

    // A church the LiDAR didn't see gets a bell tower at one end. (One it saw has its own, as a part
    // of it.)
    if (church && !b.measured) {
      const vx = -shape.uz;
      const vz = shape.ux;
      const tw = Math.min(2.6, shape.W * 0.9);
      const tx = shape.cx - shape.ux * (shape.L - tw);
      const tz = shape.cz - shape.uz * (shape.L - tw);
      const ty = foot + b.h + 9;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, bb]) => [tx + (shape.ux * a + vx * bb) * tw, tz + (shape.uz * a + vz * bb) * tw]);
      const tower: WallLayout = { ...storeys(P, ty - foot, 1, false), ...baysOf(P, 2 * tw, f.type), s0: 0, kit: [storeyLayer, storeyLayer, wallMat, baseMat], wall: wallRgb, base: baseRgb, shut: shutRgb, door: -1 };
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k];
        const [bx, bz] = corners[(k + 1) % 4];
        const l = Math.hypot(bx - ax, bz - az);
        walls.tri([ax, base, az, 0, base - foot], [ax, ty, az, 0, ty - foot], [bx, ty, bz, l, ty - foot], tower);
        walls.tri([ax, base, az, 0, base - foot], [bx, ty, bz, l, ty - foot], [bx, base, bz, l, base - foot], tower);
      }
      const apex = V(tx, ty + 4, tz);
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k];
        const [bx, bz] = corners[(k + 1) % 4];
        tiles.up(V(bx, ty, bz), apex, V(ax, ty, az), [0, 0], [0.5, 1], [1, 0], roofCol);
      }
    }
  }

  const g = new THREE.Group();
  // The walls in the kit's material (facades.ts), and the roofs' textures as the layers of one (tiles,
  // flat): a square kilometre's walls are one mesh, and its roofs another.
  const roofArt = [tex.roofTiles(), tex.flatRoof()];
  const roofed = layeredMaterial(tex.layered(roofArt.map((t) => t.image as HTMLCanvasElement), 256, 256), 0.85);
  for (const t of roofArt) t.dispose();
  // The balconies' railings: bars, in their colour, seen from both sides.
  const railed = layeredMaterial(tex.layered([tex.railing().image as HTMLCanvasElement], 128, 128), 0.6);
  railed.side = THREE.DoubleSide;
  railed.alphaTest = 0.5;
  for (const { walls, tiles, flat, rails } of sets.values()) {
    for (const mesh of [walls.mesh(kit.material), merged([[tiles, 0], [flat, 1]], roofed), merged([[rails, 0]], railed)]) {
      if (mesh) g.add(mesh);
    }
  }
  return g;
}

// ---- The start ----

// A granite plinth beside the road just past the line, on whichever side has room, where the lobby
// shows your car; behind it a granite wall with Braga's arms and the track's name (`title`) on azulejos.
// `crowded` counts the buildings near a spot.
function startPlinth(track: Track, title: string, ground: (x: number, z: number) => number, crowded: (x: number, z: number, r: number) => number) {
  let best = { i: 40, side: 1, score: Infinity };
  for (let i = 25; i < 140; i += 15) {
    for (const side of [-1, 1]) {
      const s = track.samples[i];
      const p = surfacePoint(s, side * (s.w / 2 + 10), 0);
      let lo = Infinity;
      let hi = -Infinity;
      for (const [a, b] of [[-10, -4], [10, -4], [-10, 4], [10, 4], [0, 0]]) {
        const q = surfacePoint(s, side * (s.w / 2 + 10 + b), 0);
        const y = ground(q.x + s.t.x * a, q.z + s.t.z * a);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      const score = crowded(p.x, p.z, 14) * 10 + (hi - lo) * 3 + Math.abs(i - 40) * 0.05;
      if (score < best.score) best = { i, side, score };
    }
  }
  const s = track.samples[best.i];
  const lateral = best.side * (s.w / 2 + 10);
  const g = new THREE.Group();
  const granite = mat('#a49d90', { roughness: 0.85 });
  const dark = mat('#8c857a', { roughness: 0.9 });
  const plinth = new THREE.Group();
  // Two steps up to the plinth's top, 1.2 m up, where the car stands at the front.
  plinth.add(box(16, 0.6, 11, dark, 0, -0.6, 0), box(14, 1.2, 9, granite, 0, 0, 0), box(14.4, 0.12, 9.4, dark, 0, 1.1, 0));
  // The wall at the back, its cornice, and the finials on its ends.
  plinth.add(box(13, 7, 1, granite, 0, 1.2, -4), box(13.6, 0.4, 1.3, dark, 0, 8.2, -4));
  for (const x of [-6.3, 6.3]) {
    plinth.add(box(0.9, 0.9, 0.9, dark, x, 8.6, -4));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), granite);
    ball.position.set(x, 9.95, -4);
    plinth.add(ball);
  }
  const arms = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.25), new THREE.MeshStandardMaterial({ map: tex.bragaArms(), transparent: true, roughness: 0.6 }));
  arms.position.set(0, 5.6, -3.49);
  plinth.add(arms);
  const name = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.6), new THREE.MeshStandardMaterial({ map: tex.sign(title.toUpperCase(), 'Braga', '#f4f7fb', '#1d4f9c', 1024, 164, '#1d4f9c'), roughness: 0.3 }));
  name.position.set(0, 2.35, -3.49);
  plinth.add(name);
  // Its front (+z) faces the road.
  const at = surfacePoint(s, lateral, 0);
  plinth.position.set(at.x, ground(at.x, at.z), at.z);
  plinth.rotation.y = -Math.atan2(s.t.z, s.t.x) + (best.side > 0 ? Math.PI : 0);
  g.add(plinth);
  const front = surfacePoint(s, best.side * (s.w / 2 + 7), 0);
  const spot = new THREE.Vector3(front.x, ground(at.x, at.z) + 1.2, front.z);
  // Its top and the wall at its back, on the ground, for the karts (ground.ts).
  const corner = (x: number, z: number): [number, number] => {
    const v = new THREE.Vector3(x, 0, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), plinth.rotation.y);
    return [at.x + v.x, at.z + v.z];
  };
  return {
    group: g,
    stage: spot,
    at: best.i,
    // Facing the road, for a kart to drive off it.
    yaw: Math.atan2(s.p.z - spot.z, s.p.x - spot.x),
    top: [corner(-7.2, -4.7), corner(7.2, -4.7), corner(7.2, 4.7), corner(-7.2, 4.7)],
    y: ground(at.x, at.z) + 1.22,
    back: [corner(-6.8, -4.65), corner(6.8, -4.65), corner(6.8, -3.35), corner(-6.8, -3.35)],
    clear: { x: at.x, z: at.z, r: 16 },
  };
}

// ---- Names ----

// A brown sign on two posts on the pavement, pointing out a landmark the route passes on that side:
// at the kerb nearest a point 40 m before it, so it's read on the way.
function landmarkSign(track: Track, ground: (x: number, z: number) => number, kerbNear: Built['kerbNear'], l: { name: string; x: number; z: number }): THREE.Group {
  const g = new THREE.Group();
  const { i } = distanceToRoad(track, l.x, l.z);
  if (i < 0) return g;
  const N = track.samples.length;
  const s = track.samples[(i - 40 + N) % N];
  const side = Math.sign((l.x - s.p.x) * s.r.x + (l.z - s.p.z) * s.r.z) || 1;
  const want = surfacePoint(s, side * (s.w / 2 + 2.2), 0);
  const k = kerbNear(want.x, want.z, 12);
  const p = k ? { x: k.x + k.nx * 0.8, z: k.z + k.nz * 0.8 } : want;
  const y = ground(p.x, p.z);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshStandardMaterial({ map: tex.brownSign(l.name), roughness: 0.5, side: THREE.DoubleSide }));
  board.position.set(p.x, y + 2.4, p.z);
  board.rotation.y = -Math.atan2(s.t.z, s.t.x) - Math.PI / 2;
  g.add(board);
  for (const d of [-1.5, 1.5]) g.add(box(0.1, 2.9, 0.1, mat('#5b5f63'), p.x + s.r.x * d, y, p.z + s.r.z * d));
  return g;
}
