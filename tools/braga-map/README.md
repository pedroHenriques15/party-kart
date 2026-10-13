# A map of Braga

The real Braga, for planning tracks: the streets, buildings, rivers and railway from
OpenStreetMap, the relief, the zones and landmarks chosen for tracks, and the game's track, the
Volta dos Amigos. The scripts here also make that track and the city round it for the game.

- `index.html` is the map. Run `npm run dev` and open http://localhost:5173/tools/braga-map/.
  Here it's read-only. The shared copy, where the zones and landmarks were voted on and approved,
  is the artifact at https://claude.ai/artifact/UdwdhZYkR76J5xyPcRUHUb.
- In the shared copy you can also click the map to add places: your houses, landmarks and other
  spots, each with an idea for an easter egg. They live only in that artifact's database, readable
  by those who can edit it. Don't copy them into this repo, which is public, and when a house goes
  into the game, put it near the real one, never at the right door.
- `braga.json` is everything the map draws, in metres from the Praça da República with x east and
  z south: the same frame as the game's tracks. A point read off the map (hover over it) goes
  straight into a layout.
- `course.json` is the Volta dos Amigos for the map's "Pista nova" layer: its centre line, start,
  checkpoints, item rows, boost pads and easter eggs.

## The scripts

None of them is part of the game's build.

```sh
node tools/braga-map/fetch.mjs    # the data, into .cache/ (about 20 MB, ignored by git); a few minutes
node tools/braga-map/build.mjs    # the map's braga.json
node tools/braga-map/course.mjs   # the track and its scenery: src/track/amigos.ts, src/render/amigos-data.ts, course.json
```

- `fetch.mjs` gets OpenStreetMap through Overpass (streets and land, buildings, parishes,
  landmarks, trees, and the crossings, traffic lights and bus stops) and elevation tiles, plus
  coarser ones 16 km round for the horizon. The public Overpass server is often busy: it waits and
  tries again. `node fetch.mjs trees` fetches only what's named (`base`, `buildings`, `admin`,
  `pois`, `trees`, `street`, `dem`, `horizon`).
- `build.mjs` and `course.mjs` read the game's own track code, so they need Node 22.18 or later,
  like the tests. `geo.mjs` is what they share: the projection and the relief.
- `course.mjs` also needs the waypoints, `.cache/places.json`: the houses from the shared map's
  database, as `{ "places": [{ "id", "egg", "x", "z", "rows"? }], "order"?: [ids] }`. They're
  private, so they stay in the ignored folder. `order`, when it's there, keeps the loop going
  round the houses in that order. `egg` is the easter egg by that house (`dog`, `dentist`, `supermarket` or
  null), and `rows: true` lines that street with houses on both sides. How it plans the track, and
  what to change, is in "The track" in `docs/making-changes.md`.

## What's on it

- **The area**: from the station to Lamaçães and from the Picoto to the hospital, 4.3 × 4.3 km.
  With Bom Jesus and the Sameiro to the east, 6.4 × 4.3 km in all.
- **Streets** at three levels, counted in the area asked for. All the streets (not service roads
  or dirt tracks) come to 287 km. The main ones (fast roads, primary, secondary, tertiary and
  pedestrian streets) come to 102 km, 65% fewer. Keeping only the fast roads, primary and
  secondary cuts 78%, but loses the Avenida Central and the old town.
- **Relief** every 20 m, from 55 m in the north-west corner to 570 m on the Sameiro.
- **The Volta dos Amigos** ("Pista nova"), the game's track: 8.1 km round, through five friends'
  neighbourhoods.
- **The first track** ("Pista antiga"), drawn at its real size with its fountain on the real one
  in the Praça da República. It's 2.5 km round and fits in 851 × 414 m. The real Bom Jesus is
  3.9 km from that fountain; on the track it's 750 m.
- **Six zones** for tracks, 1 to 2.5 km across: Centro, Estádio, Gualtar, Lamaçães, Picoto, and
  Bom Jesus e Sameiro. They're `ZONES` in `index.html`.
- **32 landmarks**, each marked essential, recommended or optional. They're `LANDMARKS` in
  `build.mjs`, placed by their OpenStreetMap names.

## Decisions

Draft 1 was approved on 13 October 2026: every zone and all 32 landmarks stay, with the main
streets (the 65% cut). `decisions.json` keeps that, by zone and landmark id, and this copy of the
map shows it. The first track made from the map is the Volta dos Amigos, through the four houses
added on the shared map, and a fifth added after; the first, cartoon track is kept in the code for
reference.

## Credits

The data in `braga.json`, `course.json` and the game's `src/render/amigos-data.ts` is
© OpenStreetMap contributors, under the Open Database Licence (ODbL). Keep that credit wherever
the map or anything drawn from it is shown (the game says so in How to play, and in the README).
The relief is from Terrain Tiles on AWS Open Data.
