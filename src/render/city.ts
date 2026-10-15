// The Volta dos Amigos's world: Braga as it is, from the map the games share (braga-map, made from
// OpenStreetMap and DGT's LiDAR), loaded tile by tile round the track. The land as the ground really
// is, and what's on it painted onto it; every street in the open world's area as it is (streets.ts),
// laid on the ground the karts drive on (src/world/ground.ts); every building in the area and round
// it on its own ground, with its floors and its roof, cut back at the kerb where it stands on a
// carriageway; trees; the Rio Este and its bridges; the decks and tunnels (levels.ts); the granite
// plinth with Braga's arms at the start; the sights (sights.ts); and the friends' easter eggs on their
// houses (eggs.ts). What only the race adds to the streets is road.ts.
import { heightOn, loadWorld, type Box, type Building as MapBuilding, type Track as Course, type World as Braga } from 'braga-map';
import * as THREE from 'three';
import { distanceToRoad, surfacePoint, type Track } from '../track/track.ts';
import { Rings, trimmed, worldGround, type WorldGround } from '../world/ground.ts';
import { smooth } from '../world/land.ts';
import { raceGround } from '../world/race.ts';
import { buildEggs, eggSpots, type Eggs } from './eggs.ts';
import { buildSights, horizon, TOURIGALO_CLEAR } from './sights.ts';
import { bake, box, mat } from './kit.ts';
import { Lattice, Surface } from './lattice.ts';
import { buildLevels, isDeck, nearLevels } from './levels.ts';
import type { Quality } from './look.ts';
import type { Photos } from './photos.ts';
import { raceMarks } from './road.ts';
import { clipConvex, convexPieces, faces, shapeOf, wallTop } from './roofs.ts';
import { buildStreets, groundPaths, streetEdges, type Built } from './streets.ts';
import * as tex from './textures.ts';
import { plantTrees, type Tree } from './trees.ts';
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
};
// Street classes as the map numbers them: whether they have pavements. (Each street comes
// with its own width.)
const PAVED = [true, false, true, true, true, true, false, false, false, false];
// Facade colours, which tint the near-white wall textures.
const FACADES = ['#f2ede3', '#ecd7a2', '#e0b874', '#e0ad9c', '#b9cfdb', '#d8c5ab', '#efe0bf', '#bfd3bb'];
const SHOPS = ['#eeeeea', '#dcdcd6', '#e6e0d4', '#cfd4d6'];
const ROOFS = ['#b55a3c', '#a54e35', '#c26942', '#9c4a34'];

// The ground's material: the map painted on it, and a fine grain tiled by world position, so it
// isn't smeared up close. Where the painting is clear, there's a street over it (streets.ts) and the
// land isn't drawn, whatever its height. The canvas leaves a clear pixel black, so a pixel's colour
// is taken back out of its share of what's clear. With ?photos, over the tile the map has its
// orthophoto for, the photo instead (photos.ts), faded into the painting over its last 15 m.
function groundMaterial(map: THREE.Texture, photo: Photos['ground']): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.96, alphaTest: 0.5 });
  // The photo on the material as well as in its shader, so the textures' memory counts it (stats.ts).
  if (photo) Object.assign(m, { photo: photo.map });
  const grain = tex.grain();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.grain = { value: grain };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    if (photo) {
      sh.uniforms.photo = { value: photo.map };
      sh.uniforms.photoBox = { value: new THREE.Vector4(photo.box.x0, photo.box.z0, photo.box.x1, photo.box.z1) };
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D grain;\nvarying vec2 vWorldXZ;' + (photo ? '\nuniform sampler2D photo;\nuniform vec4 photoBox;' : ''))
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\ndiffuseColor.rgb /= max(diffuseColor.a, 0.01);\ndiffuseColor.rgb *= (0.62 + 0.76 * texture2D(grain, vWorldXZ / 5.0).r) * (0.8 + 0.4 * texture2D(grain, vWorldXZ / 41.0).r);' +
          (photo
            ? '\nvec2 pq = (vWorldXZ - photoBox.xy) / (photoBox.zw - photoBox.xy);\nfloat pin = clamp(min(min(pq.x, 1.0 - pq.x), min(pq.y, 1.0 - pq.y)) * (photoBox.z - photoBox.x) / 15.0, 0.0, 1.0);\nif (pin > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(photo, pq).rgb, pin);'
            : ''),
      )
      .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\ndiffuseColor.a = 1.0;');
  };
  return m;
}

// ---- The world ----

// Besides the city, the world as the karts' ground (ground.ts), built for it and kept for driving on.
// Given a renderer (?photos), the map's photo textures too (photos.ts), as its graphics card takes them.
export async function buildCity(track: Track, course: Course, quality: Quality, photosFor: THREE.WebGLRenderer | null = null): Promise<World & { eggs: Eggs; drive: WorldGround; race: WorldGround; stageYaw: number; marks: THREE.Object3D }> {
  const map = await loadWorld(course.box);
  // Fetched, and turned for the graphics card in workers, while the land is worked out. Only then is
  // photos.ts (and three.js's KTX2Loader) downloaded at all. If they can't be had, the city goes
  // without them.
  const photosLoading = photosFor
    ? import('./photos.ts')
        .then((m) => m.loadPhotos(map.photos, photosFor, quality))
        .catch((e: unknown) => (console.warn('The photo textures failed to load:', e), null))
    : null;
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
  const paint = paintGround(map, B, quality, inOpenTiles, outline, onGround);

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
  const landMesh = new Surface(lat, land);
  const photos = await photosLoading;
  {
    const r = lat.r;
    const W = lat.nx * r + 1;
    const material = groundMaterial(paint, photos?.ground ?? null);
    const lands = new THREE.Group();
    lands.name = 'land';
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
        const cell = (a: number, b: number, c: number, d: number) => idx.push(a, c, b, b, c, d); // corners (i, j), (i + 1, j), (i, j + 1), (i + 1, j + 1)
        for (let j = tj; j < Math.min(lat.nz, tj + T); j++) {
          for (let i = ti; i < Math.min(lat.nx, ti + T); i++) {
            if (!lat.isFine(i, j)) {
              cell(vertex(i * r, j * r), vertex((i + 1) * r, j * r), vertex(i * r, (j + 1) * r), vertex((i + 1) * r, (j + 1) * r));
              continue;
            }
            for (let b = 0; b < r; b++) for (let a = 0; a < r; a++) cell(vertex(i * r + a, j * r + b), vertex(i * r + a + 1, j * r + b), vertex(i * r + a, j * r + b + 1), vertex(i * r + a + 1, j * r + b + 1));
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
  const streets = buildStreets(map, wg, landMesh, (x, z) => houses.has(x, z), quality, track, course);
  streets.group.name = 'streets';
  group.add(streets.group);
  updates.push(streets.update);

  // ---- What only the race adds to the streets: the start line, the gates, the boost pads, the
  // barriers at the start and across every side street it passes, the ramp. Up only while a race is
  // on (main.ts): round the city the streets are as they are. Its ground is the world's, with its
  // walls and ramp (race.ts). Each laid on the street at the route's level there: on a deck, the
  // deck. ----
  const raced = raceGround(wg, track, course);
  const onRoute = (x: number, z: number) => wg.floor(x, z, track.samples[distanceToRoad(track, x, z).i].p.y + 1.5).y;
  const road = raceMarks(track, { start: tex.sign('VOLTA DOS AMIGOS', 'BRAGA', '#fbfbf8', '#1d4f9c', 1024, 192, '#1d4f9c'), checkpoint: tex.sign('PONTO DE CONTROLO', '', '#111318', '#ffe14d', 1024, 160) }, onRoute, raced.rows);
  const marks = Object.assign(bake(road.group), { name: 'race marks', visible: false });
  group.add(marks);
  updates.push(road.update);

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
  const plinth = startPlinth(track, ground, buildingsNear);
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
  // Those left out aren't walls for the karts either.
  const kept = new Set(list);
  for (const b of all) if (!kept.has(b)) wg.unwall(b.pts);
  group.add(Object.assign(buildBuildings(list), { name: 'buildings' }));
  if (photos) group.add(photos.facades);

  // ---- Trees, from the map and filling its parks and woods. In the area every one the karts can
  // hit (all but those on a carriageway, ground.ts); round it the map's own anywhere in the box and
  // those filled in within 230 m, fewer on Medium and Low. ----
  {
    const trees: Tree[] = [];
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const every = quality === 'low' ? 3 : quality === 'medium' ? 2 : 1;
    let k = 0;
    for (const { x, z, pine, filled } of map.trees) {
      const r = near(x, z);
      if (r === Infinity || (filled && r > 230)) continue;
      if (wg.d.roads.has(x, z)) continue;
      if (r > 0 && k++ % every) continue;
      if (riverAt(x, z).d < HW + 3) continue;
      // None on the plinth or in the eggs' ground.
      if (keepOut.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) continue;
      trees.push({
        kind: pine ? 'pine' : 'round',
        x,
        y: ground(x, z),
        z,
        s: 0.75 + rnd() * 0.55,
        color: pine ? new THREE.Color().setHSL(0.34 + rnd() * 0.04, 0.42, 0.14 + rnd() * 0.05) : new THREE.Color().setHSL(0.22 + rnd() * 0.08, 0.45, 0.19 + rnd() * 0.08),
      });
    }
    // Big tiles and plain crowns: there are thousands of them.
    group.add(Object.assign(plantTrees(trees, 800, quality === 'low' ? 'lean' : true), { name: 'trees' }));
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

  return {
    group,
    update: (t) => updates.forEach((u) => u(t)),
    ground,
    stage: plinth.stage,
    stageAt: plinth.at,
    stageYaw: plinth.yaw,
    marks,
    eggs,
    drive: wg,
    race: raced.ground,
  };
}

// ---- The ground's map ----

// Paints what the ground is onto one big canvas over the scenery's box: the land, the parks and
// woods, water, squares, and beyond the open world's tiles, the streets with their pavements and
// the railway. Where a street or a path is drawn (streets.ts), the canvas is left clear, so the land
// under it isn't drawn (groundMaterial): every street and path on the ground in the area (`onGround`),
// but a little in from its edge, where the land meets it.
function paintGround(map: Braga, B: Box, quality: Quality, inOpenTiles: (x: number, z: number) => boolean, outline: [number, number, number, number][], onGround: { rings: [number, number][][] }[]): THREE.CanvasTexture {
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

  for (const { kind, pts } of map.areas) {
    g.fillStyle = LAND[kind] ?? LAND.urban;
    g.beginPath();
    pts.forEach(([x, z], k) => (k ? g.lineTo(x, z) : g.moveTo(x, z)));
    g.closePath();
    g.fill();
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

  // Taken as the canvas holds it, each colour already times its share of what's clear, so a pixel at
  // a street's edge is blended rightly with its neighbours (groundMaterial takes the share back out).
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.premultiplyAlpha = true;
  t.anisotropy = 8;
  return t;
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

// Each building stands on the ground at its lowest corner, from the map, its walls going a little
// below it, so a row of houses steps down a hill as the real ones do. Its walls rise to its eaves,
// and under a gable to its roof, which is as the map measured it (roofs.ts): its shape, the way it
// runs, its pitch, its ridge's height and its colour, tiles or sheets or flat. The walls' windows
// are its storeys. A wall another building stands against, as high as it or higher, isn't drawn.
function buildBuildings(list: Building[]): THREE.Group {
  // The batches a kilometre square at a time, so whole squares out of view are skipped, and the sun's
  // shadows (drawn only 70 m round the camera) draw only those near it.
  const batches = () => ({ walls: { flats: new Batch(), house: new Batch(), shop: new Batch(), church: new Batch() }, tiles: new Batch(), flat: new Batch() });
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
    // A building cut back at the kerb keeps the whole one's roof.
    return { b, pts, shape: shapeOf({ ...b, pts: b.whole ?? pts }) };
  });
  const side = (a: [number, number], c: [number, number]) => `${a[0]},${a[1]}>${c[0]},${c[1]}`;
  const sides = new Map<string, (typeof all)[number]>();
  for (const it of all) for (let k = 0; k < it.pts.length; k++) sides.set(side(it.pts[k], it.pts[(k + 1) % it.pts.length]), it);

  for (const { b, pts, shape } of all) {
    const { walls, tiles, flat } = setOf(b);
    const base = b.y - 0.6;
    const foot = b.y;
    const church = b.kind === 3;
    col.set(church ? '#f6f4ef' : b.kind === 2 || b.kind === 4 ? SHOPS[b.color % SHOPS.length] : FACADES[b.color % FACADES.length]);
    if (b.roofColor) roofCol.setRGB(...seenUpClose(b.roofColor), THREE.SRGBColorSpace);
    else roofCol.set(b.material === 0 ? ROOFS[b.color % ROOFS.length] : b.material === 1 ? '#8b8e90' : '#8f8c86');

    // Walls: one texture all the way up, a window's row to each storey; flats with a ground floor
    // of doors and shops (their material draws it below the first storey's line, v = 1).
    const storey = Math.max(2.4, (b.h - 0.4) / Math.max(1, b.floors));
    const upper = church ? walls.church : b.kind === 0 ? walls.house : b.kind === 1 ? walls.flats : walls.shop;
    const v = (y: number) => (y - foot) / storey;
    let u = 0;
    for (let k = 0; k < pts.length; k++) {
      const top = wallTop(shape, pts[k], pts[(k + 1) % pts.length]);
      // Hidden by the building behind it: no lower, and standing no higher.
      const o = sides.get(side(pts[(k + 1) % pts.length], pts[k]));
      const hidden = o && o.b.y <= b.y + 0.05 && top.every(([x, z, h]) => o.b.y + o.shape.height(x, z) >= foot + h - 0.05);
      // One polygon, its top the roof over it: convex, as the roof is the lowest of its planes, so a
      // fan from its first corner's foot.
      const [x0, z0] = top[0];
      const along = (x: number, z: number) => (u + Math.hypot(x - x0, z - z0)) / 6;
      if (!hidden) {
        const [x1, z1] = top[top.length - 1];
        const foot0 = V(x0, base, z0);
        const corners = top.map(([x, z, h]) => ({ p: V(x, foot + h, z), uv: [along(x, z), v(foot + h)] as [number, number] }));
        corners.push({ p: V(x1, base, z1), uv: [along(x1, z1), v(base)] });
        for (let q = 0; q + 1 < corners.length; q++) upper.tri(foot0, corners[q].p, corners[q + 1].p, [along(x0, z0), v(base)], corners[q].uv, corners[q + 1].uv, col);
      }
      u += Math.hypot(top[top.length - 1][0] - x0, top[top.length - 1][1] - z0);
    }

    // The roof. Flat: the footprint at the eaves.
    if (b.roof === 0) {
      const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
      const top = foot + b.h;
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
        const P = (n: number) => V(pts[n][0], top, pts[n][1]);
        const U = (n: number): [number, number] => [pts[n][0] / 6, pts[n][1] / 6];
        flat.up(P(i), P(j), P(k), U(i), U(j), U(k), roofCol);
      }
    } else {
      // Pitched: each face, its tiles (or sheets, grey) in rows along its eaves. Over the footprint's
      // rectangle, overhanging the walls, where the footprint nearly fills it; else cut to the
      // footprint.
      const batch = tiles;
      const lay = (poly: [number, number][], g: { gx: number; gz: number }) => {
        const k = Math.hypot(g.gx, g.gz) || 1;
        const ax = -g.gz / k;
        const az = g.gx / k;
        const sin = Math.sin(Math.atan(k));
        const P = (p: [number, number]) => V(p[0], foot + shape.height(p[0], p[1]), p[1]);
        const U = (p: [number, number]): [number, number] => [(p[0] * ax + p[1] * az) / 3, (foot + shape.height(p[0], p[1])) / (3 * (sin || 1))];
        for (let i = 1; i + 1 < poly.length; i++) batch.up(P(poly[0]), P(poly[i]), P(poly[i + 1]), U(poly[0]), U(poly[i]), U(poly[i + 1]), roofCol);
      };
      if (shape.fill > 0.9 && !b.whole) for (const f of faces(shape, 0.4)) lay(f.pts, f.plane);
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
    }

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
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k];
        const [bx, bz] = corners[(k + 1) % 4];
        walls.church.quad(V(ax, base, az), V(ax, ty, az), V(bx, ty, bz), V(bx, base, bz), [0, 0], [0, (ty - base) / 3], [(2 * tw) / 6, (ty - base) / 3], [(2 * tw) / 6, 0], col);
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
  // The walls' textures as the layers of one (the flats' floors, their ground floor of doors and
  // shops, below the first storey, the houses', the shops' and the churches'), and the roofs' as
  // another (tiles, flat): a square kilometre's walls are one mesh, and its roofs another.
  const wallArt = [tex.flatsFloor(), tex.groundFloor(), tex.houseWall(), tex.shopWall(), tex.churchWall()];
  const roofArt = [tex.roofTiles(), tex.flatRoof()];
  const walled = layeredMaterial(tex.layered(wallArt.map((t) => t.image as HTMLCanvasElement), 256, 128), 0.88, true);
  const roofed = layeredMaterial(tex.layered(roofArt.map((t) => t.image as HTMLCanvasElement), 256, 256), 0.85);
  for (const t of [...wallArt, ...roofArt]) t.dispose();
  for (const { walls, tiles, flat } of sets.values()) {
    for (const mesh of [
      merged([[walls.flats, 0], [walls.house, 2], [walls.shop, 3], [walls.church, 4]], walled),
      merged([[tiles, 0], [flat, 1]], roofed),
    ]) {
      if (mesh) g.add(mesh);
    }
  }
  return g;
}

// ---- The start ----

// A granite plinth beside the road just past the line, on whichever side has room, where the lobby
// shows your car; behind it a granite wall with Braga's arms and the race's name on azulejos.
// `crowded` counts the buildings near a spot.
function startPlinth(track: Track, ground: (x: number, z: number) => number, crowded: (x: number, z: number, r: number) => number) {
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
  const name = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.6), new THREE.MeshStandardMaterial({ map: tex.sign('VOLTA DOS AMIGOS', 'Braga', '#f4f7fb', '#1d4f9c', 1024, 164, '#1d4f9c'), roughness: 0.3 }));
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
