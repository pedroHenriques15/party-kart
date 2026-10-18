# Making changes

Step-by-step guides for the changes that reach across several files. For how it all works, read
[architecture.md](architecture.md).

Whatever you change, finish with:

```sh
npm run check && npm test
```

Then play it with `npm run dev`. Add `?autodrive` and the autopilot drives for you.

## The track

The game races the Volta dos Amigos, `braga-map/tracks/amigos.js`, from the map of Braga the
games share: the `braga-map` package, its own repo
([github.com/pedroHenriques15/braga-map](https://github.com/pedroHenriques15/braga-map), next to
this one at `../braga-map`). It plans the track on the real streets from OpenStreetMap and the
ground from DGT's LiDAR, and makes the city round it. Its README says how a track is planned and what to change.
**Nothing of the track or the city is edited here.** To change them:

1. Change braga-map's scripts (`tools/track.mjs` plans the tracks, `tools/world.mjs` makes the
   city) and run them, as its README says. Planning the Volta dos Amigos needs its waypoints,
   braga-map's `.cache/places.json`: the friends' houses, from the shared map. They're private,
   and git ignores them.
2. Try it here before tagging it: `npm install --install-links ../braga-map` installs your copy
   (run it again after each change there). Run `npm test` and `npm run check`, and look at it with
   `?autodrive`.
3. Commit it in braga-map, tag a new version, and push it with its tags. Then here, change the tag
   in `package.json` (`"braga-map": "github:pedroHenriques15/braga-map#v1.1.0"`), `npm install`,
   and commit `package.json` and `package-lock.json`.

The layout is the usual `Point`s (see the first track, below), one every 8 m, with `lanes` and
`kerbs` for how it's dressed. The track also brings what's along it: the easter eggs, the street
names, the landmarks it passes, the zebra crossings, traffic lights and bus stops, and the box
round it that the game draws. `elev0` is the height above the sea that the game's y = 0 stands
for, the same all over the map.

Other things to know:

- A sample is a metre of road. The lap is about 10.1 km (N ≈ 10080). Nothing in the new scenery uses
  a raw sample index: it's all placed by position, so it moves with the track when that's made
  again.
- **The tests guard the track.** It must be a 7–10.5 km loop with 5 checkpoints, and the autopilot
  must lap it on the world's ground within the race's walls with no respawns, its second lap taking
  170–310 s. The race must be closed (from its line, nothing off braga-map's `road` is reachable),
  and every row of barriers must stop a kart driven at it. Eight bots must all finish a lap, within
  60 s of each other. The race runs on the streets at their real widths (braga-map's decision 019):
  if the autopilot can't get round, the bots and the autopilot change, not the street; the line
  keeps 1.2 m inside the race's road where it rounds a corner (`CLEAR` in braga-map's
  `tools/track.mjs`), or the costs can send the loop another way.
- **A new track needs a new peer id prefix** (`PREFIX` in `src/session.ts`), or old builds join
  rooms that race a different road. So does a new version of braga-map that changes the track's
  points (a change to the city alone doesn't).
- **A road can pass over itself.** `locate` only searches ±40 samples around the car's last sample,
  so the two levels need to be more than about 40 m of road apart.
- To look at one part of the track, open the game with `?autodrive&at=<sample>`: your car starts
  the race there. `?view=x,y,z,tx,ty,tz` holds the camera anywhere, to look at the scenery, and
  `?scenery&view=…` shows the city alone from there, without starting a race. `?stats` shows what
  the game costs in a corner: the frame rate, draw calls, triangles, textures, load time and download.
- The city keeps what's in the open world's area and 300 m round it (`nearBuildings`), and every
  tree in the box (`cityTrees`, near in their photos and far as billboards): the map has the whole
  of Braga in it, for the other games. Every street in the
  area is drawn from the map's surfaces (`streets.ts`); beyond the open world's tiles they're
  painted on the land.

### The first track, for reference

`LAYOUT` in `src/track/layout.ts` is the first track, the cartoon Braga Grand Prix, placed by
hand. Its world (`src/render/world.ts`, `landmarks.ts`, `braga.ts` and `buildTrees` in
`trees.ts`) still compiles, but the game doesn't use it. The tests do use the track: its jump, for
the handling, and its Avenida, where the item tests put their cars.

Each point is `[x, y, z]` in metres, with x east, z south and y up. Its options apply to the
stretch from it to the next point:

- `w` (width), `walls` and `surface` carry on until a later point changes them. `bank` (radians;
  positive lifts the right edge) blends towards the next point's value.
- `tag` marks a place:
  - `start` is the line, and there must be exactly one.
  - `cp` is a checkpoint, passed in order.
  - `items` is a row of five item boxes across the road.
  - `boost` is a 14 m boost pad.
  - `fountain`, `se`, `arch`, `church`, `lip`, `stadium-in` and `stadium-out` are where the first
    track's landmarks and trees go. Its world looks each one up and crashes if it's missing.
- `walls: false` lets cars drive (or fall) off the edge. The jump at `lip` has none.

Its scenery places things at raw sample indices of `LAYOUT` (`SPOTS` and others in `braga.ts`,
the rows of houses in `landmarks.ts`), so moving a point there moves those out of place.

## The handling

The constants at the top of `src/car/car.ts` set the handling: top speed, acceleration, grip, drift
grip, gravity, boost, and the mini-turbo thresholds. `turnRate(speed)` is how tightly the car turns.
The autopilot works out its corner speeds from `turnRate`, so it adapts to changes there. It
doesn't adapt to grip or gravity.

Run `npm test` and read the printed line from "the autopilot laps the track cleanly". It gives the
lap times, respawns, longest airtime, top speed and wall hits. The eight-bot race prints finish
times and hits.

## A new item

Work through the list. The ones in bold fail silently if you miss them.

1. **`src/game/items.ts`**
   - Add the kind to `ItemKind`, and add an `ITEMS` entry: name, an emoji icon, uses, and a one-line
     blurb, in Portuguese like all the UI. The HUD and the "How to play" list read these.
   - Give it a weight in `FRONT`, `MIDDLE` and/or `BACK`. Leaders should get defence and small
     stuff, and the back of the pack the big guns. The "every item turns up somewhere" test fails
     if it has no weight anywhere.
2. **`src/game/racer.ts`, `use()`**: what using it does.
   - If it only affects you (like `gold` or `shield`), set state on the `Racer` and read it in
     `step()`, in the `Mods`, or in `hit()`.
   - If it goes onto the track, `a.emit()` an event. Use `this.nextId()` for its id and
     `owner: this.id`.
   - If it can hit someone, check it in `hits()`. That runs in the victim's browser against the
     item's deterministic position, so the position may only depend on what's in the event and the
     race time.
3. **A new event or projectile kind**
   - Extend `ProjKind` and `LIFE`, or add a variant to `ItemEv`, and handle it in `Arena.apply`
     (`src/game/arena.ts`). If it needs a sound or effect, add it to `ArenaFx` as well.
   - **Add it to `cleanEv` in `src/session.ts`.** The host drops any event kind, and any `proj`
     kind outside `['bola', 'pombo', 'foguete']`, that it doesn't recognise. Clamp every new number
     and set `owner` from the sender.
4. **If other players need to see its effect on a car**, add a status flag. See
   [A new status flag](#a-new-status-flag).
5. **`src/game/bot.ts`**: when the bots use it. By default they use it after holding it for 0.8 s.
6. **Drawing and sound**
   - Anything on the track goes in `src/render/items3d.ts`: build it in `ItemsView.update` and
     position it with `projProgress`.
   - Sounds and screen effects go in `noteForMe` (the `use` and `hit` cases) and `onArenaFx` in
     `src/main.ts`, with new sounds in `sfx` in `src/audio.ts`.
   - A new sound plays into `out()`, on a bus: the effects' for an item, a hit or an egg; the
     jingles' for something the race tells you (it ducks the effects while it plays); the engines'
     or the ambience's for what goes on all the time. If it happens somewhere, anyone's item or an
     egg, it takes that place (`at`) and is heard from there; your own racer's (`noteForMe`) has
     none. Record the takes again (`node scripts/listen.mjs <label>`) to hear it beside the rest.
   - If it hits people, add it to `howName` in `main.ts` for the feed ("X got Y's …").
7. **`README.md`**: add a row to the items table.
8. **`test/race.test.ts`**: add a test in the style of the bola and pombo ones, using
   `at(...)`, `arena(...)`, `tick(...)` and a seeded random.

## A new driver

1. Add an entry to `DRIVERS` in `src/render/drivers.ts`:
   - `id`: short and permanent. It's saved in `localStorage` (`pk-driver`) and sent over the
     network.
   - `body`: one of the existing bodies, or a new case in `buildKart`.
   - `extras`: from `Extra`. New ones are built in `buildDriverFigure`/`buildKart`.
   - `trail`: a key of `STYLE` in `src/render/fx.ts`, or `null`.
   - `horn`: notes in Hz.
   - `color`, `trim`, `alt` (the second paint), `skin`, `outfit`, a `name` and a one-line `tagline` (in Portuguese).
2. The drivers are the friends the Volta dos Amigos goes past, by first name and never a surname
   (braga-map's decision 014), each in a car that's a joke about them. Every face is the shared
   friendly cartoon face, never a likeness.
3. Add them to the drivers in `README.md`.

Order matters a little. `DRIVERS[0]` is the fallback for an unknown id, and the bots take the free
drivers in list order. There are fewer drivers (5) than places on the grid (`MAX_RACERS = 8`), so
past the free ones the bots drive them again in their second paint: `repeatOf(id)` is
`<id>-2`, which `driverById` paints with `alt` and names "<name> II". Players only ever pick the
five (`validDriver`). The start-up warm-up compiles every driver by itself.

## A new status flag

Flags are how one browser shows the others that a car is gold, shielded, spun out, shrunk,
boosting, drifting, charging a turbo, or slipstreaming.

1. Add a bit to `FLAG` in `src/game/arena.ts`, and set it in `Racer.info()` in `src/game/racer.ts`.
2. **Mirror it in `src/render/drivers.ts`.** That file keeps its own `GOLD`/`SHIELD`/… constants.
   Read it in the `KartModel.update` function that `buildKart` returns, and/or in `kartEffects` in
   `main.ts`.
3. `cleanSnap` clamps `fl` to 16 bits, and 9 are in use.

## A new network message

1. Add it to `ToHost` or `ToClient` in `src/session.ts`.
2. Handle it in `HostRoom.receive` or `ClientRoom.receive`. On the host, **validate everything**
   with `num`, `str`, `cleanName` and `validDriver`, or a new `clean…`. Never trust an id in the
   message over the connection's own `c.peer`.
3. The host is a player too, but never sends itself messages. Its own actions go through methods
   instead (`sendLap(ms, id)`, `honk()`, `sendEv()`), so give the host path the same behaviour.
   Those methods also take a bot's id, because the host reports the bots' laps.
4. Add it to the `Room` interface if `main.ts` needs it.
5. Deployed builds and dev builds share rooms while the peer id prefix (`PREFIX`) matches. If an
   old client would misbehave with the new message, change the prefix.

## A new landmark or scenery

A sight that's on the map (a building or a monument the track passes) is easiest in
`src/render/sights.ts`: find its OpenStreetMap id (braga-map's `.cache/osm/*.json`), add it to the
`sights` in braga-map's `tools/world.mjs` with whatever the builder needs (a position, a
footprint's rectangle, a front), make the world again (see "The track"), and add a builder for its
`kind`. The other games get it too. One that stands for a building of the tiles' carries that
building's outline as `covers`, and the city doesn't draw the building (it's still a wall to the
karts). Small ones of a few materials go in `chapels.ts`'s way: built apart, baked together in
`buildSights`, so six chapels cost the draw calls of one. Otherwise:

1. Build it as a function returning a `THREE.Group`, in `src/render/city.ts` or a file of its own,
   from the helpers in `src/render/kit.ts`:
   - `box`, `mesh` and `slab` for the shapes;
   - `mat(color, opts)` for shared materials;
   - textures drawn in `src/render/textures.ts`, since there are no image files.
2. Place it by position, the way the map has it: `distanceToRoad(track, x, z).i` is the nearest
   sample, and `surfacePoint(sample, lateral, up)` a point beside it; or `kerbNear(x, z, r)` (from
   `buildStreets`) the nearest raised kerb, and the way into its pavement. Stand it on
   `ground(x, z)`: the highest of the land, the streets and the decks there.
3. Keep the buildings off it: add its spot to `keepOut` in `buildCity` (a centre and a radius).
4. Add it to `statics` in `buildCity`, which is run through `bake()` to merge its static meshes by
   material. **Anything that moves needs `userData.moves = true`**, and its animation goes in an
   `update(t)` that's called every frame.
5. Watch the cost, against the city's budget in [architecture.md](architecture.md). With
   `?autodrive`, `window.__kart.calls` and `.tris` give the draw calls and triangles, and `?stats`
   shows them on the screen with the frame rate and the textures' memory. The game steps itself
   down a level when a race runs under 35 fps, and phones start on Medium, so check on Low and
   Medium too (the picker is on the first screen). `node scripts/shots.mjs <label>` shoots
   braga-map's viewpoints at High and Low (`--medium` adds Medium), with each one's draw calls,
   triangles, textures' memory and frame time, beside the real photos and the round before.
   `node scripts/download.mjs` gives what the game downloads.

## An easter egg

The eggs are in `src/render/eggs.ts`. Each is a model on a friend's house and an update that
watches your kart (its sample and speed) and returns events: `eggReact` in `main.ts` turns those
into sounds, sparkles and a line in the feed. They react to your own kart only, so nothing goes over
the network. Where they stand comes from the waypoints' `egg` in braga-map's `.cache/places.json`,
through its `tools/track.mjs`: each egg's `x`, `z` is the house's own spot (decision 014), and
`eggSpots` stands the model there, its front to the road, or just far enough from the kerb for
what's in front of it. A new one needs a kind in `FRONT` and `CLEAR`, a builder, and its sounds in
`sfx` (`src/audio.ts`). Vale's clock stands on the roof of the building at its spot
(`roofAt`, from `city.ts`), so it clears nothing. An egg that does something to your own kart for a while (the café's
cigarette and beer) keeps its time in `RaceCtx` in `main.ts`, and passes it to the kart model's
`update`.
