// Downloads what the map of Braga is made of: OpenStreetMap data through the Overpass API, and
// elevation tiles (Terrain Tiles, on AWS Open Data). It keeps them in .cache/ for build.mjs.
//
// node tools/braga-map/fetch.mjs            everything
// node tools/braga-map/fetch.mjs trees      only what's named (base, buildings, admin, pois, trees, dem)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = path.join(here, '.cache');
fs.mkdirSync(path.join(cache, 'osm'), { recursive: true });
fs.mkdirSync(path.join(cache, 'dem'), { recursive: true });

// The box fetched, a little more than the map shows: south, west, north, east.
const S = 41.531, W = -8.442, N = 41.574, E = -8.360;
const BOX = `${S},${W},${N},${E}`;
const UA = 'party-kart-map/1.0';

const QUERIES = {
  // Streets, railways, rivers and what the land is used for.
  base: `[out:json][timeout:180][bbox:${BOX}];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|pedestrian|service|track)$"];
  way["railway"~"^(rail|light_rail|funicular)$"];
  way["waterway"~"^(river|stream|canal)$"];
  way["natural"="water"]; relation["natural"="water"];
  way["landuse"~"^(forest|grass|meadow|recreation_ground|cemetery|farmland|orchard|vineyard|residential|commercial|retail|industrial|construction|brownfield|religious)$"];
  relation["landuse"~"^(forest|grass|meadow|recreation_ground|cemetery|farmland|orchard|vineyard|residential|commercial|retail|industrial)$"];
  way["natural"~"^(wood|scrub|grassland|heath)$"]; relation["natural"~"^(wood|scrub)$"];
  way["leisure"~"^(park|garden|pitch|stadium|sports_centre|golf_course|track)$"]; relation["leisure"~"^(park|garden|stadium)$"];
  way["amenity"~"^(hospital|university|school|college)$"];
);
out geom;`,
  buildings: `[out:json][timeout:180][bbox:${BOX}];
way["building"];
out geom;`,
  // The parishes, and the municipality round them.
  admin: `[out:json][timeout:120];
relation["boundary"="administrative"]["admin_level"~"^(7|8)$"](${BOX});
out geom;`,
  // Single trees and rows of them, for the scenery round the track.
  trees: `[out:json][timeout:120][bbox:${BOX}];
(
  node["natural"="tree"];
  way["natural"="tree_row"];
);
out geom;`,
  // Places with a name that might be landmarks. build.mjs picks its list from these by name.
  pois: `[out:json][timeout:120][bbox:${BOX}];
(
  nwr["wikidata"]["tourism"]; nwr["wikidata"]["historic"]; nwr["wikidata"]["amenity"];
  nwr["wikidata"]["leisure"]; nwr["wikidata"]["building"]; nwr["wikidata"]["man_made"];
  nwr["wikidata"]["shop"]; nwr["wikidata"]["railway"]; nwr["wikidata"]["natural"];
  nwr["wikidata"]["place"="square"]; nwr["wikidata"]["highway"="pedestrian"];
  nwr["tourism"~"^(attraction|museum|viewpoint|artwork)$"]["name"];
  nwr["historic"]["name"];
  nwr["name"~"Sameiro|Bom Jesus|Picoto|Sete Fontes|Theatro Circo|Avenida Central|Praça da República|Santa Bárbara|Biscainhos|Alto da Cividade|Fonte do Ídolo|Altice Forum|1.º de Maio|Parque da Ponte"];
);
out center tags;`,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The public Overpass server is often busy, and then answers with an HTML error page, sometimes
// with status 200, so a reply only counts if it's JSON.
async function overpass(name, query) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });
    const text = await res.text();
    if (res.ok && text.trimStart().startsWith('{')) {
      fs.writeFileSync(path.join(cache, 'osm', name + '.json'), text);
      console.log(`${name}: ${(text.length / 1e6).toFixed(1)} MB`);
      return;
    }
    console.log(`${name}: the server is busy, trying again (${attempt})`);
    await sleep(15000 * attempt);
  }
  throw new Error(`Overpass didn't answer for ${name}. Try again later.`);
}

const only = process.argv.slice(2);
const wanted = (name) => !only.length || only.includes(name);
for (const [name, query] of Object.entries(QUERIES)) {
  if (!wanted(name)) continue;
  await overpass(name, query);
  await sleep(3000);
}

// Terrain tiles at zoom 14 (about 7 m a pixel here) covering the box.
const Z = 14;
const tileX = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const tileY = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z); };
let n = 0;
for (let y = tileY(N); y <= tileY(S) && wanted('dem'); y++) {
  for (let x = tileX(W); x <= tileX(E); x++) {
    const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`Elevation tile ${x}/${y}: ${res.status}`);
    fs.writeFileSync(path.join(cache, 'dem', `${Z}_${x}_${y}.png`), Buffer.from(await res.arrayBuffer()));
    n++;
  }
}
if (n) console.log(`elevation: ${n} tiles`);
