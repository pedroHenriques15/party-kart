# Making changes

Step-by-step guides for the changes that reach across several files. For how it all works, read
[architecture.md](architecture.md).

Whatever you change, finish with:

```sh
npm run check && npm test
```

Then play it with `npm run dev`. Add `?autodrive` and the autopilot drives for you.

## The track

The track is `LAYOUT` in `src/track/layout.ts`. Each point is `[x, y, z]` in metres, with x east,
z south and y up. Its options apply to the stretch from it to the next point:

- `w` (width), `walls` and `surface` carry on until a later point changes them. `bank` (radians;
  positive lifts the right edge) blends towards the next point's value.
- `tag` marks a place:
  - `start` is the line, and there must be exactly one.
  - `cp` is a checkpoint. The tests expect **5**, and they are passed in order.
  - `items` is a row of five item boxes across the road.
  - `boost` is a 14 m boost pad.
  - `fountain`, `se`, `arch`, `church`, `lip`, `stadium-in` and `stadium-out` are where the
    landmarks and trees go. The code looks each one up and **crashes if it's missing**.
  - `kicker` only names a point. Nothing looks it up.
- `walls: false` lets cars drive (or fall) off the edge. The jump at `lip` has none.

The road is a spline through the points, resampled every metre from `start`. So **adding, moving
or removing a point shifts the index of every sample after it.** Tags move with the track by
themselves, but these places in the scenery use raw sample indices:

| Where | What |
|---|---|
| `src/render/braga.ts` | `SPOTS` (the Câmara, the Coimbras chapel, Santa Bárbara, the Palácio do Raio, the Theatro Circo), the Roman ruins at `1700` and their sign at `1690`, the Torre de Menagem at `N - 45`, the BRAGA letters at `N - 22` |
| `src/render/landmarks.ts` | The rows of houses: old town `290–475`, the Avenida `2330–2500` |
| `src/main.ts` | Where the menu cars start (`k * 37 + 2300`), the showroom camera's angle (`samples[40]`) |

`SPOTS` also keeps the old town's houses off those landmarks, so check both together. To see where
everything landed, print the tags' sample indices:

```sh
node -e "import('./src/track/track.ts').then(async (t) => { const { LAYOUT } = await import('./src/track/layout.ts'); const tr = t.buildTrack(LAYOUT); console.log('N', tr.samples.length, 'checkpoints', tr.checkpoints.join(',')); console.log(tr.tags.map((x) => x.tag + '@' + x.i).join(' ')); })"
```

Other things to know:

- **The terrain** (`natural()` in `src/render/world.ts`) puts hills at fixed places. Bom Jesus is
  centred on (545, −360). Near the road the ground follows the road's own height and blends into
  the hills within 26 m. If you move the switchbacks far, move the hill too.
- **The river** is `RIVER` in `layout.ts`. A bridge appears wherever the road crosses it.
- **A road can pass over itself.** `locate` only searches ±40 samples around the car's last sample,
  so the two levels need to be more than about 40 m of road apart.
- **The tests guard the track.** It must be a 1.8–2.8 km loop, and the autopilot must lap it with
  no respawns, with a second lap of 45–100 s. The jump must fly for over a second and land at 60,
  100, 130 and 158 km/h. Eight bots must all finish. If the autopilot can't get round, a corner is
  probably too tight for its speed, or a crest throws the car off.

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

1. Build it as a function returning a `THREE.Group`, in `src/render/braga.ts` or `landmarks.ts`,
   from the helpers in `src/render/kit.ts`:
   - `box`, `mesh` and `slab` for the shapes;
   - `mat(color, opts)` for shared materials;
   - textures drawn in `src/render/textures.ts`, since there are no image files.
2. Place it:
   - `beside(track, ground, obj, i, lateral)` stands it on the ground beside sample `i`, facing the
     road.
   - `at(track, i, lateral, up)` gives a frame on the track.
   - Prefer a `tag`-relative index over a raw one where you can.
3. Run the group through `bake()`, which merges its static meshes by material. **Anything that moves
   needs `userData.moves = true`**, and its animation goes in an `update(t)` that's called every
   frame.
4. If it stands in the old town, reserve its spot in `SPOTS` so no house is put on top of it.
5. Watch the cost. With `?autodrive`, `window.__kart.calls` and `.tris` give the draw calls and
   triangles. The game steps itself down a level when a race runs under 35 fps, and phones start on
   Medium, so check on Low and Medium too (the picker is on the first screen).
