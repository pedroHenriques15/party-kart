# Making changes

Step-by-step guides for the changes that reach across several files. For how it all works, read
[architecture.md](architecture.md).

Whatever you change, finish with:

```sh
npm run check && npm test
```

Then play it with `npm run dev`. Add `?autodrive` and the autopilot drives for you.

## The track

The game races the Volta dos Amigos. Its layout, `AMIGOS` in `src/track/amigos.ts`, and the
scenery round it, `src/render/amigos-data.ts`, are made by `tools/braga-map/course.mjs` from
OpenStreetMap and the relief. **Don't edit those two files by hand**: change the tool and run it
again.

```sh
node tools/braga-map/fetch.mjs     # once: the map's data, into tools/braga-map/.cache/
node tools/braga-map/build.mjs     # the map page's data (braga.json)
node tools/braga-map/course.mjs    # the track and its scenery
```

`course.mjs` also needs its waypoints, `tools/braga-map/.cache/places.json`: the friends' houses,
from the shared map. They're private, and git ignores them. Without them the tool can't plan the
loop again, but the committed track keeps working. What it does, in order:

1. **The loop.** A graph of the streets, and the cheapest loop through the waypoints. `COST` makes
   bigger roads cheaper and `TURN` prices the turns. The loop never uses a street twice or runs
   within 28 m of itself, and it drives along each waypoint's own street through it. A waypoint's
   street that's a dead end gets a link from its end to the nearest street ahead. It tries every
   order of the waypoints, unless `places.json` gives one (`"order": [ids]`): then only the
   direction through each is chosen. To add a house without reshuffling the loop, put it in the
   order between the two it falls between.
2. **The centre line.** Short jogs at junctions are folded into one corner, and corners are rounded
   to `R_MIN` (12 m, a street corner) where the streets allow. Heights come from the relief,
   smoothed over about 50 m. It prints the corners it had to make tighter, the widths, the
   steepest grade, the sharpest crest, and any place the road comes too close to itself.
3. **The street as it is.** The width, kerb to kerb, is the map's `width`, or its `lanes`, or what
   that kind of street usually is (`carriageway`), never under `W_MIN` (9 m). Lane lines follow
   `lanes` and `lane_markings`; `surface=sett` and the like make granite setts. Beyond each edge
   (`kerbs`) is a pavement as wide as the buildings leave room for (none where `sidewalk` says no,
   or out in the open), a central reservation where a one-way carriageway runs alongside, and a
   gap wherever a side street joins.
4. **Where things go.** The start on the Rua do Fujacal (`START_ON`), on the straightest stretch at
   least 250 m from every waypoint, 5 checkpoints evenly spaced, a row of item boxes every 820 m,
   boost pads 30 m into the longest straights, and the easter eggs 44–50 m past their houses.
5. **The scenery.** The relief, near and far, and the hills 15 km round for the horizon; the
   ground's areas, every street at its width, the railway; every building within 300 m that isn't
   on the road or its kerb, the big ones mapped in parts too, plus infill where the map has none on
   a built-up street; trees; the river; zebra crossings, traffic lights and bus stops; the street
   names and landmarks; and the sights (Bom Jesus, the Sameiro, the cross on the Picoto, the
   stadium, the Altice Forum, Makro, the Tourigalo's bull), picked out of the map by their
   OpenStreetMap ids. Packed into `amigos-data.ts`.

The layout is the usual `Point`s (see the first track, below), one every 8 m, with `lanes` and
`kerbs` for how it's dressed. `ELEV0` is the height above the sea that the game's y = 0 stands
for.

Other things to know:

- A sample is a metre of road. The lap is about 8.1 km (N ≈ 8150). Nothing in the new scenery uses
  a raw sample index: it's all placed by position, so it moves with the track when that's made
  again.
- **The tests guard the track.** It must be a 7–9 km loop with 5 checkpoints, and the autopilot
  must lap it with no respawns, its second lap taking 170–260 s. Eight bots must all finish a lap,
  within 60 s of each other. If the autopilot can't get round, a corner is too tight: raise
  `R_MIN`, or change the costs so the loop goes another way.
- **A new track needs a new peer id prefix** (`PREFIX` in `src/session.ts`), or old builds join
  rooms that race a different road.
- **A road can pass over itself.** `locate` only searches ±40 samples around the car's last sample,
  so the two levels need to be more than about 40 m of road apart.
- To look at one part of the track, open the game with `?autodrive&at=<sample>`: your car starts
  the race there. `?view=x,y,z,tx,ty,tz` holds the camera anywhere, to look at the scenery.
- The map's data comes from `fetch.mjs`: `node tools/braga-map/fetch.mjs street horizon` fetches
  only the crossings, lights and bus stops, and the horizon's relief.

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
     blurb. The HUD and the "How to play" list read these.
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
     kind outside `['disco', 'drone', 'bomb']`, that it doesn't recognise. Clamp every new number
     and set `owner` from the sender.
4. **If other players need to see its effect on a car**, add a status flag. See
   [A new status flag](#a-new-status-flag).
5. **`src/game/bot.ts`**: when the bots use it. By default they use it after holding it for 0.8 s.
6. **Drawing and sound**
   - Anything on the track goes in `src/render/items3d.ts`: build it in `ItemsView.update` and
     position it with `projProgress`.
   - Sounds and screen effects go in `noteForMe` (the `use` and `hit` cases) and `onArenaFx` in
     `src/main.ts`, with new sounds in `sfx` in `src/audio.ts`.
   - If it hits people, add it to `howName` in `main.ts` for the feed ("X got Y's …").
7. **`README.md`**: add a row to the items table.
8. **`test/race.test.ts`**: add a test in the style of the disco ball and drone ones, using
   `at(...)`, `arena(...)`, `tick(...)` and a seeded random.

## A new driver

1. Add an entry to `DRIVERS` in `src/render/drivers.ts`:
   - `id`: short and permanent. It's saved in `localStorage` (`pk-driver`) and sent over the
     network.
   - `body`: one of the existing bodies, or a new case in `buildKart`.
   - `extras`: from `Extra`. New ones are built in `buildDriverFigure`/`buildKart`.
   - `trail`: a key of `STYLE` in `src/render/fx.ts`, or `null`.
   - `horn`: notes in Hz.
   - `color`, `trim`, `skin`, `outfit`, a `name` and a one-line `tagline`.
2. Names are parodies and faces are the shared friendly cartoon face. The README says so, and keep
   it true.
3. Add them to the drivers list in `README.md`.

Order matters a little. `DRIVERS[0]` is the fallback for an unknown id, and the bots take the free
drivers in list order. There are more drivers (9) than places on the grid (`MAX_RACERS = 8`). The
start-up warm-up compiles every driver by itself.

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
`src/render/sights.ts`: find its OpenStreetMap id (`tools/braga-map/.cache/osm/*.json`), add it to
the `sights` in `course.mjs` with whatever the builder needs (a position, a footprint's
rectangle, a front), run `course.mjs`, and add a builder for its `kind`. Otherwise:

1. Build it as a function returning a `THREE.Group`, in `src/render/city.ts` or a file of its own,
   from the helpers in `src/render/kit.ts`:
   - `box`, `mesh` and `slab` for the shapes;
   - `mat(color, opts)` for shared materials;
   - textures drawn in `src/render/textures.ts`, since there are no image files.
2. Place it by position, the way the map has it: `distanceToRoad(track, x, z).i` is the nearest
   sample, and `surfacePoint(sample, lateral, up)` a point beside it. Stand it on `ground(x, z)`.
3. Keep the buildings off it: add its spot to `keepOut` in `buildCity` (a centre and a radius).
4. Add it to `statics` in `buildCity`, which is run through `bake()` to merge its static meshes by
   material. **Anything that moves needs `userData.moves = true`**, and its animation goes in an
   `update(t)` that's called every frame.
5. Watch the cost. With `?autodrive`, `window.__kart.calls` and `.tris` give the draw calls and
   triangles. The game steps itself down a level when a race runs under 35 fps, and phones start on
   Medium, so check on Low and Medium too (the picker is on the first screen).

## An easter egg

The eggs are in `src/render/eggs.ts`. Each is a model by the road and an update that watches your
kart (its sample and speed) and returns events: `eggReact` in `main.ts` turns those into sounds,
sparkles and a line in the feed. They react to your own kart only, so nothing goes over the
network. Where they stand comes from the waypoints' `egg` in `.cache/places.json`, through
`course.mjs`: a new one needs a kind in `SET_BACK` and `CLEAR`, a builder, and its sounds in
`sfx` (`src/audio.ts`). An egg that does something to your own kart for a while (the café's
cigarette and beer) keeps its time in `RaceCtx` in `main.ts`, and passes it to the kart model's
`update`.
