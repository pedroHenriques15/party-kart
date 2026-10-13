# A map of Braga

The real Braga, for planning tracks: the streets, buildings, rivers and railway from
OpenStreetMap, the relief, and the zones and landmarks chosen for tracks. It isn't part of the
game, and nothing in `src/` reads it yet.

- `index.html` is the map. Run `npm run dev` and open http://localhost:5173/tools/braga-map/.
  Here it's read-only. The shared copy, where the zones and landmarks were voted on and approved,
  is the artifact at https://claude.ai/artifact/UdwdhZYkR76J5xyPcRUHUb.
- `braga.json` is everything the map draws, in metres from the Praça da República with x east and
  z south: the same frame as `LAYOUT` in `src/track/layout.ts`. A point read off the map (hover
  over it) goes straight into a layout.
- `fetch.mjs` downloads the data into `.cache/` (about 20 MB, ignored by git), and `build.mjs`
  turns it into `braga.json`. Neither is part of the game's build.

```sh
node tools/braga-map/fetch.mjs   # OpenStreetMap through Overpass, and elevation tiles; takes a few minutes
node tools/braga-map/build.mjs   # needs Node 22.18 or later, like the tests: it reads the game's track
```

The public Overpass server is often busy. `fetch.mjs` waits and tries again.

## What's on it

- **The area**: from the station to Lamaçães and from the Picoto to the hospital, 4.3 × 4.3 km.
  With Bom Jesus and the Sameiro to the east, 6.4 × 4.3 km in all.
- **Streets** at three levels, counted in the area asked for. All the streets (not service roads
  or dirt tracks) come to 287 km. The main ones (fast roads, primary, secondary, tertiary and
  pedestrian streets) come to 102 km, 65% fewer. Keeping only the fast roads, primary and
  secondary cuts 78%, but loses the Avenida Central and the old town.
- **Relief** every 20 m, from 55 m in the north-west corner to 570 m on the Sameiro.
- **The game's current track**, drawn at its real size with its fountain on the real one in the
  Praça da República. It's 2.5 km round and fits in 851 × 414 m. The real Bom Jesus is 3.9 km from
  that fountain; on the track it's 750 m.
- **Six zones** for tracks, 1 to 2.5 km across: Centro, Estádio, Gualtar, Lamaçães, Picoto, and
  Bom Jesus e Sameiro. They're `ZONES` in `index.html`.
- **32 landmarks**, each marked essential, recommended or optional. They're `LANDMARKS` in
  `build.mjs`, placed by their OpenStreetMap names.

## Decisions

Draft 1 was approved on 13 October 2026: every zone and all 32 landmarks stay, with the main
streets (the 65% cut). `decisions.json` keeps that, by zone and landmark id, and this copy of the
map shows it. The next step is a first track in one of the zones, drawn on the real streets.

## Credits

The data in `braga.json` is © OpenStreetMap contributors, under the Open Database Licence
(ODbL). Keep that credit wherever the map or anything drawn from it is shown. The relief is from
Terrain Tiles on AWS Open Data.
