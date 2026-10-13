// Turns what fetch.mjs downloaded (OpenStreetMap data and elevation tiles), and the game's current
// track, into braga.json for the map page. Everything ends up in metres from the Praça da
// República, x east and z south, the same frame as LAYOUT in src/track/layout.ts.
//
// node tools/braga-map/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KX, KZ, LAT0, LON0, P, relief } from './geo.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '.cache'), repo = path.resolve(here, '../..'), outFile = path.join(here, 'braga.json');
if (!fs.existsSync(path.join(dir, 'osm', 'base.json'))) throw new Error('No data yet: run fetch.mjs first.');
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, 'osm', f), 'utf8'));
const base = read('base.json'), bld = read('buildings.json'), admin = read('admin.json'), pois = read('pois.json');


// The whole map, and the area Vale asked for inside it.
const EXT = { x0: -1600, x1: 4900, z0: -2450, z1: 2150 };
const CORE = { x0: -1500, x1: 2830, z0: -2300, z1: 2010 };
const inBox = (b, x, z, m = 0) => x >= b.x0 - m && x <= b.x1 + m && z >= b.z0 - m && z <= b.z1 + m;

function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a], [bx, bz] = pts[b];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, pz] = pts[i];
      let t = L2 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - ax - t * dx, pz - az - t * dz);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Flat, delta-coded integer metres: [x0, z0, dx1, dz1, …].
function pack(pts) {
  const out = [];
  let px = 0, pz = 0;
  pts.forEach(([x, z], i) => {
    const rx = Math.round(x), rz = Math.round(z);
    if (i && rx === px && rz === pz) return;
    out.push(i ? rx - px : rx, i ? rz - pz : rz);
    px = rx; pz = rz;
  });
  return out;
}

const touches = (pts, m = 50) => pts.some(([x, z]) => inBox(EXT, x, z, m));
const area = (pts) => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return Math.abs(a / 2); };

// Joins a relation's member ways into closed rings.
function rings(members, role) {
  const ways = members.filter((m) => m.type === 'way' && m.geometry && (role == null || m.role === role || (role === 'outer' && m.role === ''))).map((m) => m.geometry.filter(Boolean));
  const key = (g) => g.lat.toFixed(7) + ',' + g.lon.toFixed(7);
  const used = new Array(ways.length).fill(false);
  const out = [];
  for (let i = 0; i < ways.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const ring = ways[i].slice();
    for (let guard = 0; guard < ways.length && key(ring[0]) !== key(ring[ring.length - 1]); guard++) {
      const end = key(ring[ring.length - 1]);
      let found = false;
      for (let j = 0; j < ways.length; j++) {
        if (used[j]) continue;
        const w = ways[j];
        if (key(w[0]) === end) { ring.push(...w.slice(1)); used[j] = found = true; break; }
        if (key(w[w.length - 1]) === end) { ring.push(...w.slice(0, -1).reverse()); used[j] = found = true; break; }
      }
      if (!found) break;
    }
    out.push(ring.map(P));
  }
  return out;
}

// ---- Roads ----
// Classes, in drawing order from the least to the most important.
const ROAD = {
  track: 8, residential: 5, unclassified: 5, living_street: 5, pedestrian: 6,
  tertiary: 4, tertiary_link: 4, secondary: 3, secondary_link: 3, primary: 2, primary_link: 2,
  trunk_link: 1, motorway_link: 1, trunk: 0, motorway: 0,
};
const names = [], nameIdx = new Map();
const nameOf = (n) => { if (!n) return -1; if (!nameIdx.has(n)) { nameIdx.set(n, names.length); names.push(n); } return nameIdx.get(n); };

const roads = [], areas = [], water = [], rail = [];
const lenCore = {}, lenExt = {};
const segLen = (pts, box) => { let L = 0; for (let i = 1; i < pts.length; i++) { const [ax, az] = pts[i - 1], [bx, bz] = pts[i]; if (inBox(box, (ax + bx) / 2, (az + bz) / 2)) L += Math.hypot(bx - ax, bz - az); } return L; };

const AREA_CLASS = (t) => {
  if (t.natural === 'water') return 'water';
  if (t.landuse === 'forest' || t.natural === 'wood') return 'forest';
  if (t.natural === 'scrub' || t.natural === 'heath') return 'scrub';
  if (t.landuse === 'cemetery') return 'cemetery';
  if (t.leisure === 'pitch' || t.leisure === 'stadium' || t.leisure === 'track' || t.leisure === 'sports_centre' || t.leisure === 'golf_course') return 'sport';
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (t.landuse === 'grass' || t.landuse === 'recreation_ground' || t.natural === 'grassland' || t.natural === 'grass' || t.natural === 'shrubbery') return 'grass';
  if (t.landuse === 'farmland' || t.landuse === 'meadow' || t.landuse === 'orchard' || t.landuse === 'vineyard') return 'farm';
  if (t.landuse === 'industrial') return 'industrial';
  if (t.amenity === 'hospital') return 'hospital';
  if (t.amenity === 'university' || t.amenity === 'school' || t.amenity === 'college') return 'school';
  if (t.landuse) return 'urban';
  return null;
};

for (const e of base.elements) {
  const t = e.tags || {};
  if (e.type === 'way' && t.highway && t.highway !== 'service') {
    const pts = e.geometry.map(P);
    if (!touches(pts)) continue;
    if (t.highway === 'pedestrian' && (t.area === 'yes' || (pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] && t.area !== 'no'))) {
      areas.push({ c: 'plaza', r: [pack(dp(pts, 0.8))] });
      continue;
    }
    const k = ROAD[t.highway];
    if (k == null) continue;
    lenCore[k] = (lenCore[k] || 0) + segLen(pts, CORE);
    lenExt[k] = (lenExt[k] || 0) + segLen(pts, EXT);
    roads.push({ k, n: nameOf(t.name), b: t.bridge && t.bridge !== 'no' ? 1 : 0, t: t.tunnel && t.tunnel !== 'no' ? 1 : 0, o: t.junction === 'roundabout' ? 1 : 0, p: pack(dp(pts, 1)) });
  } else if (e.type === 'way' && t.railway) {
    const pts = e.geometry.map(P);
    if (!touches(pts)) continue;
    rail.push({ k: t.railway === 'funicular' ? 1 : t.service ? 2 : 0, t: t.tunnel && t.tunnel !== 'no' ? 1 : 0, p: pack(dp(pts, 1)) });
  } else if (e.type === 'way' && t.waterway) {
    const pts = e.geometry.map(P);
    if (!touches(pts)) continue;
    water.push({ k: t.waterway === 'river' ? 0 : t.waterway === 'canal' ? 1 : 2, n: nameOf(t.name), t: t.tunnel && t.tunnel !== 'no' ? 1 : 0, p: pack(dp(pts, 1)) });
  } else {
    const c = AREA_CLASS(t);
    if (!c) continue;
    let rs;
    if (e.type === 'way') rs = [e.geometry.map(P)];
    else rs = [...rings(e.members, 'outer'), ...rings(e.members, 'inner')];
    rs = rs.filter((r) => r.length > 3 && touches(r, 400));
    if (!rs.length) continue;
    const a = area(rs[0]);
    areas.push({ c, a: Math.round(a), r: rs.map((r) => pack(dp(r, c === 'forest' || c === 'farm' ? 2 : 1))) });
  }
}

// Big fields first, so smaller ones inside them draw on top.
const AREA_ORDER = ['urban', 'industrial', 'farm', 'grass', 'scrub', 'forest', 'park', 'cemetery', 'hospital', 'school', 'sport', 'water', 'plaza'];
areas.sort((p, q) => AREA_ORDER.indexOf(p.c) - AREA_ORDER.indexOf(q.c) || (q.a || 0) - (p.a || 0));
areas.forEach((x) => delete x.a);
roads.sort((p, q) => q.k - p.k);

// ---- Buildings ----
const buildings = [];
const CHURCH = new Set(['church', 'cathedral', 'chapel', 'basilica', 'religious', 'monastery', 'convent']);
const BIG = new Set(['industrial', 'warehouse', 'commercial', 'retail', 'apartments', 'office', 'hospital', 'university', 'school', 'college', 'public', 'civic', 'train_station', 'stadium', 'sports_hall', 'hotel', 'parking', 'supermarket']);
for (const e of bld.elements) {
  if (e.type !== 'way' || !e.geometry) continue;
  const pts = e.geometry.map(P);
  if (!touches(pts, 0)) continue;
  const a = area(pts);
  if (a < 8) continue;
  const b = e.tags.building;
  const k = CHURCH.has(b) ? 2 : BIG.has(b) || a > 450 ? 1 : 0;
  const s = dp(pts, 0.6);
  if (s.length < 4) continue;
  buildings.push({ k, p: pack(s) });
}

// ---- Parishes ----
const parishLines = new Map(), parishes = [];
for (const e of admin.elements) {
  if (e.tags.admin_level !== '8') continue;
  for (const m of e.members) {
    if (m.type !== 'way' || !m.geometry || parishLines.has(m.ref)) continue;
    const pts = m.geometry.map(P);
    if (touches(pts, 200)) parishLines.set(m.ref, pack(dp(pts, 3)));
  }
  const rs = rings(e.members, 'outer');
  const inside = (x, z) => rs.some((r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; });
  const hits = [];
  for (let x = EXT.x0 + 150; x < EXT.x1; x += 100) for (let z = EXT.z0 + 150; z < EXT.z1; z += 100) if (inside(x, z)) hits.push([x, z]);
  if (hits.length < 6) continue;
  const mx = hits.reduce((s, h) => s + h[0], 0) / hits.length, mz = hits.reduce((s, h) => s + h[1], 0) / hits.length;
  const best = hits.reduce((b, h) => (Math.hypot(h[0] - mx, h[1] - mz) < Math.hypot(b[0] - mx, b[1] - mz) ? h : b));
  parishes.push({ name: e.tags.name.replace(/^Braga \((.*)\)$/, '$1'), full: e.tags.name, x: best[0], z: best[1] });
}

// ---- Landmarks ----
// Looked up by their OSM names so the positions are the real ones.
const poiAt = new Map();
for (const e of pois.elements) {
  const t = e.tags || {};
  const c = e.center || (e.lat != null ? e : null);
  if (t.name && c && !poiAt.has(t.name)) poiAt.set(t.name, P(c));
}
// Street names repeat across parishes (there is more than one Rua do Souto), so only the old town counts.
const roadMid = (name) => {
  let best = null, bestL = 0;
  for (const e of base.elements) {
    if (e.type !== 'way' || !e.tags || e.tags.name !== name || !e.tags.highway) continue;
    const pts = e.geometry.map(P), mid = pts[Math.floor(pts.length / 2)];
    const L = segLen(pts, EXT);
    if (Math.hypot(mid[0] + 300, mid[1] - 100) < 700 && L > bestL) { bestL = L; best = mid; }
  }
  return best;
};
const LANDMARKS = [
  // zone, tier (1 essential, 2 good, 3 optional), id, name, the OSM name it sits on, a line about it
  ['centro', 1, 'estacao', 'Estação de Braga', 'Estação Ferroviária de Braga', 'A estação de comboios, à entrada oeste do centro.'],
  ['centro', 1, 'arco', 'Arco da Porta Nova', 'Arco da Porta Nova', 'A porta da cidade, à entrada do centro histórico. Já está na pista atual.'],
  ['centro', 1, 'se', 'Sé de Braga', 'Sé Catedral de Santa Maria Maior', 'A catedral, a mais antiga de Portugal.'],
  ['centro', 1, 'republica', 'Praça da República e Arcada', 'Arcada', 'A fonte, a Arcada e o início da Avenida Central. A meta da pista atual.'],
  ['centro', 1, 'theatro', 'Theatro Circo', 'Theatro Circo', 'O teatro da Avenida da Liberdade.'],
  ['centro', 1, 'barbara', 'Jardim de Santa Bárbara', 'Jardim de Santa Bárbara', 'O jardim de flores encostado ao antigo Paço Episcopal.'],
  ['centro', 2, 'torre', 'Torre de Menagem', 'Torre de Menagem do Castelo Medieval de Braga', 'O que resta do castelo medieval, junto à Arcada.'],
  ['centro', 2, 'camara', 'Câmara e Fonte do Pelicano', 'Câmara Municipal de Braga', 'A Praça do Município, com a fonte do pelicano.'],
  ['centro', 2, 'raio', 'Palácio do Raio', 'Palácio do Raio', 'A fachada barroca de azulejo azul.'],
  ['centro', 2, 'coimbras', 'Capela dos Coimbras', 'Casa dos Coimbras', 'A capela manuelina do Largo Carlos Amarante.'],
  ['centro', 2, 'souto', 'Rua do Souto', '@Rua do Souto', 'A rua pedonal principal do centro histórico, em calçada.'],
  ['centro', 2, 'cividade', 'Termas romanas da Cividade', 'Termas Romanas do Alto da Cividade', 'Ruínas de Bracara Augusta, a Braga romana.'],
  ['centro', 3, 'ddiogo', 'Museu D. Diogo de Sousa', 'Museu de Arqueologia Dom Diogo de Sousa', 'O museu de arqueologia da Braga romana.'],
  ['centro', 3, 'idolo', 'Fonte do Ídolo', 'Fonte do Ídolo', 'Um santuário romano esculpido na rocha.'],
  ['centro', 3, 'biscainhos', 'Palácio dos Biscainhos', 'Museu dos Biscainhos', 'Palácio barroco com jardins.'],
  ['centro', 3, 'mercado', 'Mercado Municipal', 'Mercado Municipal de Braga', 'O mercado, ao lado do gnration.'],
  ['centro', 3, 'congregados', 'Igreja dos Congregados', 'Igreja dos Congregados', 'A igreja barroca da Avenida Central.'],
  ['centro', 3, 'hortas', 'Campo das Hortas', 'Campo das Hortas', 'A praça logo a seguir ao Arco, com a sua fonte.'],
  ['estadio', 1, 'municipal', 'Estádio Municipal (a Pedreira)', 'Estádio Municipal de Braga', 'O estádio cavado numa pedreira. Já está na pista atual.'],
  ['gualtar', 1, 'hospital', 'Hospital de Braga', 'Hospital de Braga', 'O hospital, a nordeste.'],
  ['gualtar', 2, 'uminho', 'Universidade do Minho (Gualtar)', 'Universidade do Minho - Campus de Gualtar, Braga', 'O campus da universidade, logo abaixo do hospital.'],
  ['gualtar', 2, 'setefontes', 'Sete Fontes', 'Sete Fontes', 'As casas de água do antigo sistema de abastecimento da cidade.'],
  ['gualtar', 3, 'bragaparque', 'Braga Parque', 'Braga Parque', 'O centro comercial, a caminho de Gualtar.'],
  ['lamacaes', 2, 'lamacaes', 'Igreja de Lamaçães', 'Igreja de Lamaçães', 'O centro da antiga freguesia de Lamaçães.'],
  ['picoto', 1, 'picoto', 'Monte e miradouro do Picoto', 'Miradouro do Picoto', 'O monte com o parque e a vista sobre a cidade.'],
  ['picoto', 2, 'ponte', 'Parque da Ponte', 'Parque da Ponte', 'O parque junto ao rio Este, com o lago.'],
  ['picoto', 2, 'primeiromaio', 'Estádio 1.º de Maio', 'Estádio 1º de Maio', 'O estádio antigo, ao lado do Parque da Ponte.'],
  ['picoto', 3, 'altice', 'Altice Forum Braga', 'Altice Forum', 'O pavilhão de feiras e concertos.'],
  ['picoto', 3, 'adventure', 'Picoto Adventure Park', 'Picoto Adventure Park', 'O parque de aventura e o baloiço do Picoto.'],
  ['bomjesus', 1, 'bomjesus', 'Bom Jesus do Monte', 'Basílica do Bom Jesus', 'O santuário e o escadório. Património Mundial.'],
  ['bomjesus', 2, 'elevador', 'Elevador do Bom Jesus', 'Elevador do Bom Jesus do Monte', 'O elevador movido a água, ao lado do escadório.'],
  ['bomjesus', 2, 'sameiro', 'Santuário do Sameiro', 'Santuário de Nossa Senhora da Conceição do Sameiro', 'O santuário no alto do monte vizinho.'],
];
const landmarks = [];
for (const [zone, tier, id, name, osm, blurb] of LANDMARKS) {
  const at = osm.startsWith('@') ? roadMid(osm.slice(1)) : poiAt.get(osm);
  if (!at) { console.error('missing landmark', id, osm); continue; }
  landmarks.push({ id, zone, tier, name, blurb, x: Math.round(at[0]), z: Math.round(at[1]) });
}

// ---- Elevation ----
const elev = relief(path.join(dir, 'dem'));
const STEP = 20, nx = (EXT.x1 - EXT.x0) / STEP + 1, nz = (EXT.z1 - EXT.z0) / STEP + 1;
const H = new Uint16Array(nx * nz);
let hmin = Infinity, hmax = -Infinity;
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
  const e = elev(EXT.x0 + i * STEP, EXT.z0 + j * STEP);
  H[j * nx + i] = Math.max(0, Math.round(e * 4));
  hmin = Math.min(hmin, e); hmax = Math.max(hmax, e);
}

// ---- The game's track, at its real size, for comparison ----
const { buildTrack } = await import(pathToFileURL(path.join(repo, 'src/track/track.ts')).href);
const { LAYOUT } = await import(pathToFileURL(path.join(repo, 'src/track/layout.ts')).href);
const tr = buildTrack(LAYOUT);
const S = tr.samples.map((s) => (Array.isArray(s.p) ? [s.p[0], s.p[2]] : [s.p.x, s.p.z]));
// The game's fountain point stands on the real fountain in the Praça da República, and the
// game's x and z already point east and south, so the overlay only needs shifting.
const fountain = LAYOUT.find((q) => q.tag === 'fountain').p, real = poiAt.get('Chafariz da Praça da República');
const game = { n: S.length, dx: Math.round(real[0] - fountain[0]), dz: Math.round(real[1] - fountain[2]), p: pack(dp([...S, S[0]], 0.5)) };
let gx0 = Infinity, gx1 = -Infinity, gz0 = Infinity, gz1 = -Infinity;
for (const [x, z] of S) { gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x); gz0 = Math.min(gz0, z); gz1 = Math.max(gz1, z); }
let gl = 0;
for (let i = 0; i < S.length; i++) { const a = S[i], b = S[(i + 1) % S.length]; gl += Math.hypot(b[0] - a[0], b[1] - a[1]); }
Object.assign(game, { w: Math.round(gx1 - gx0), h: Math.round(gz1 - gz0), len: Math.round(gl) });

// ---- Stats ----
const km = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));

const data = {
  credit: '© OpenStreetMap contributors (ODbL). Relevo: Terrain Tiles (AWS Open Data).',
  osmTime: base.osm3s.timestamp_osm_base,
  origin: { lat: LAT0, lon: LON0, kx: KX, kz: KZ },
  ext: EXT, core: CORE,
  names, roads, areas, water, rail, buildings,
  parishLines: [...parishLines.values()], parishes,
  landmarks,
  height: { x0: EXT.x0, z0: EXT.z0, step: STEP, nx, nz, scale: 4, b64: Buffer.from(H.buffer).toString('base64') },
  game,
  len: { core: km(lenCore), ext: km(lenExt) },
};
fs.writeFileSync(outFile, JSON.stringify(data));
console.log('roads', roads.length, 'areas', areas.length, 'water', water.length, 'rail', rail.length, 'buildings', buildings.length, 'parish lines', parishLines.size, 'parishes', parishes.map((p) => p.name).join(' | '));
console.log('landmarks', landmarks.length, 'height', nx, 'x', nz, 'min', hmin.toFixed(0), 'max', hmax.toFixed(0), 'game samples', S.length);
console.log('km core', JSON.stringify(km(lenCore)), 'ext', JSON.stringify(km(lenExt)));
console.log('size', (fs.statSync(outFile).size / 1024).toFixed(0), 'KB');
