# CLAUDE.md

Party Kart is a kart game played in the browser, for driving round Braga's real streets with friends
and racing them there. It is
TypeScript, three.js and PeerJS (WebRTC), built with Vite and served from GitHub Pages. There is no
server and no accounts, and hardly an asset file of its own: every texture the game makes is drawn
on a canvas, and every sound is synthesized but the city's round the track, eight short CC0
recordings in `src/sounds/` (braga-map's decision 016 allows recordings for the engines and the
city), and the deathmatch's CC0 models and recordings in `src/fight/` (its decision 060: the guns, the
fighters, the cover's props and their sounds, each on record in `src/fight/ASSETS.md`). No photograph is drawn in the game (braga-map's decision 061, the owner's rule): photos are
references only. The city's textures belong to the place, so they live in braga-map with the world,
made, not photographed, by its `tools/textures.mjs` as KTX2 files that stay compressed on the
graphics card (its decision 030), and `render/ktx2.ts` loads them. The ground is drawn as braga-map
says it is (its task 016, decision 034): each kind in its own texture tinted with the place's colour, by `render/cover.ts` and the land's
shader in `render/city.ts`. They spend from the city's budget (`docs/architecture.md`), as anything else does. The
track and the city round it come from the map of Braga the games share: the `braga-map` package
(https://github.com/pedroHenriques15/braga-map, a sibling repo at `../braga-map`), data made from
OpenStreetMap and DGT's LiDAR, pinned to a version tag in `package.json`. The README promises "nothing to maintain", so treat that as a design constraint:
don't add a backend, a build step or a dependency without a strong reason.

- `README.md`: the game as a player sees it (controls, items, the track).
- `docs/architecture.md`: how it fits together: the simulation, the frame loop, the network.
- `docs/making-changes.md`: step-by-step guides for changes that touch several files (the tracks,
  an item, a driver, a status flag, a message, scenery, an easter egg).
- braga-map's `README.md` (`node_modules/braga-map/README.md`): the map the games share, its
  sections, its tracks, how a track is planned, and the scripts that make them.
- `docs/releasing.md`: shipping a change to the live site.

## Commands

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # node --test over test/*.test.ts, a few seconds (the bots' rounds)
npm run check        # tsc; the only type check the tests get
npm run build        # tsc && vite build, into dist/
npm run deploy       # tests, builds, force-pushes dist/ to gh-pages: it publishes the game
```

- Run one test with `node --test --test-name-pattern="bola" test/race.test.ts`.
- Node runs the `.ts` tests directly by stripping the types, so it needs Node 22.18 or later, and it
  does **not** type-check them. Run `npm run check` as well as `npm test`.
- `npm run deploy` publishes to the public site. Only run it when asked. It needs bash (Git Bash on
  Windows).
- To ship a change: check it, commit it to `main`, `git push origin main`, `npm run deploy`, then
  confirm the live page at https://pedrohenriques15.github.io/party-kart/ serves the new build. The
  deploy publishes the working tree, so commit first. The details are in `docs/releasing.md`.
- Some tests print a summary line, such as lap times, airtime, finish spread and hits. Read it when
  tuning the handling, the track or the items.

### Trying it in a browser

- The game opens driving round the city (free roam), alone, where you last were (`localStorage`'s
  `pk-where`; clear it to start on the plinth). Esc opens the menu over the world.
- `?autodrive` lets the autopilot drive your car in a race and use its items. It also exposes
  `window.__kart` and `window.__scene`, for checking a change with Playwright: round the city
  `mode: 'roam'`, where you are, the room, its members and the others where you see them, whether
  you're flying (`fly`), the camera (`cam`: its x, y, z, yaw and pitch), whether the full map is up
  (`map`, M: braga-map's task 106, `FullMap` in `hud.ts`; in a race too), the sound off (`muted`), and
  the GPS (`gps`, braga-map's task 107: its waypoint, its route's length, how far along it you are, its
  next turn), whose waypoint `__mark(x, z)` puts (`__mark()` takes it away); in a race
  `mode: 'race'`, where you are, lap, place, item, draw calls, triangles. Add `&at=<sample>` and your car starts
  the race there, to look at one part of the track without driving a lap to it.
- To race alone, the menu's "🏁 Corrida": it opens a room of your own, and the empty places on the
  grid fill with bots. To test with other players, "Convidar amigos" and open the invite link
  (`?room=<code>`) in a second browser, or a Playwright context of its own (a second tab shares the
  first's `localStorage`, its name and driver). Rooms go through PeerJS's public server, so this needs
  internet access.
- The light is Braga's at a moment of the day (braga-map's task 022, `src/render/look.ts`): by default a clear afternoon
  in March, as the photos of the Rua do Fujacal have it. `?time=2026-10-13T17:30` (Braga's clock) puts the sun where it
  was then (`src/sun.ts`); `?weather=grey` makes it a grey Minho day (an overcast sky, faint shadows, wet streets), and
  `?weather=rain` the same in the rain. `?clouds=` sets a clear day's cover (0 to 1), and `?exp= ?sun= ?hemi= ?env=
  ?fog=` override the lighting, for tuning; `?ao=` Ultra's occlusion (`src/render/post.ts`, its shadows in cascades,
  occlusion and SMAA: braga-map's task 090), 0 for none. Night isn't made yet: past sunset the street lamps light, but
  the city is dark.
- V, or the menu's "🎥 Voar pela cidade", flies the camera round the city from wherever it is, your
  kart waiting (braga-map's task 054, `src/game/flyer.ts`): WASD, E and Q, Shift faster, the mouse
  dragged to look; on a touch screen a stick on the left half, a drag on the right, ▲ Subir and
  ▼ Descer. V again puts your kart on the street under the camera. To look at a place without
  driving there, or at the city from the air; `?view=` is still the way to frame a still shot.
- F, or the menu's "🚶 A pé", gets you out of your kart to walk in first person, your kart waiting
  empty (braga-map's task 073, `src/game/walker.ts`): WASD, the mouse with the pointer locked (Esc
  lets it go and opens the menu; a click on the world takes it back), Shift runs, Space jumps; on a
  touch screen twin sticks and Saltar. F again is back in your kart where it waited. To look at the
  city at walking distance, as the shooter is played (braga-map's SHOOTER-AREA.md). On foot you're
  armed (`startFree`: a `FightCtx` with `free`): what you last bought, B the buy menu with unlimited
  money, your shots and grenades seen and heard by the others on foot, nobody hurt. Under
  `?autodrive`, `__kart.walk` says where you are on foot, and `__walk(x, z, tx, ty, tz, y)` puts you at
  (x, z) looking at (tx, ty, tz), on the floor at height y if it's given (a tower's upper floors).
- The menu's "🎯 Tiroteio" is the deathmatch (braga-map's task 074, after Counter-Strike 2's since its
  decision 060: `src/game/arsenal.ts`, `fight.ts`, `nades.ts`, `field.ts`): the host
  starts a round, as a race, in the arena it chose (braga-map's task 079: one of three, about 80 m
  across, `world.arenas`), everyone for themselves or in two teams, and everyone in the room is on
  foot there with what they bought (the buy menu, B, open till the start), the empty places
  filled with bots on foot (braga-map's task 075, `src/game/footbot.ts`, run by the host) at the
  level the host chose. Most of an arena's buildings open on their ground floor, and one in two of
  them up to its roof (`src/world/interiors.ts`). Alone with no bots it's a round of one, for looking at the edge or the
  guns. To try shots, two browser contexts in a room (as for a race), each put face to face with
  `__walk`, or one put facing a bot; under `?autodrive`, `__kart.fight` has your health, armour, the
  weapon in hand, its magazine and reserve, the scope, the loadout, your team,
  ammunition, kills and deaths, the others as you'd shoot at them (`foes`), and if you host, the
  bots (where, up or down, health, weapon, shots, times put back on their paths), and the grenades,
  clouds and fires up. With
  the pointer locked, Playwright's mouse buttons can turn the view (a movement comes with them):
  dispatch `mousedown`/`mouseup` on the document instead to hold the trigger (headless, the pointer
  lock is refused: dispatch the `mousedown` on `#view`, which fires as it asks for the lock).
- Its "Modo: Competitivo (bomba)" is Counter-Strike 2's competitive mode (`src/game/comp.ts`, the
  rules, the money and the host's `Match`; `src/game/matchbots.ts`, its bots): rounds with no coming
  back, the bomb planted at A or B and defused, the money earned and spent, the sides swapped at half
  time. `__kart.fight.comp` has the round, its phase, your side and money, the score, the bomb, who's
  up, the sites and spawns, and the bots' plants and defuses.
- ⚙️ Definições (`src/settingsScreen.ts`) changes the graphics, the sound, the mouse, the crosshair
  and every control's keys (`src/binds.ts`, kept with the rest in `localStorage`'s `pk-settings` by
  `src/prefs.ts`). The keys in this file are the defaults.
- `?view=x,y,z,tx,ty,tz` holds the race's camera at (x, y, z), looking at (tx, ty, tz), to look at
  the scenery from anywhere (the sights on the hills, say). A seventh number sets its vertical
  field of view in degrees (the race's own widens with speed). Take positions from braga-map's map
  page (`npm run map` there); heights are metres above the map's `elev0` (154 m above the sea).
- `?record=60` records the first 60 s of the next race's sound, from its countdown, and offers it
  as a file. Under `?autodrive`, `__kart.audio` has the loudest sample since the race began (in
  dBFS, on the louder side and on each), how many samples clipped and which effects played, and
  `window.__sound` the sounds themselves and the camera they're heard from, to play any of them
  anywhere. `node scripts/listen.mjs <label>` records six takes with the autopilot (eight karts with
  items, alone at speed, alone onto the cobbles, and 30 s at each of the Avenida da Liberdade, São
  João da Ponte and the Picoto, for the city) into `sounds/<date>-<label>/` (ignored by
  git), with what the game measured of them, and a page setting each beside the baseline's (the
  latest round labelled `baseline`) and the round before's, to judge a change to the sound by ear.
  A race needs a room, so it needs internet access. About 7 minutes.
- `?scenery` shows the city alone from `?view=`, with no menus, room, karts or network: built as a
  race builds it, still, and the same every time (its textures' noise is seeded). The graphics are
  whatever `localStorage['pk-quality']` says, or `?quality=` (`ultra`, `high`, `medium`, `low`) whatever
  the device. `window.__kart` has the build time, draw calls,
  triangles, textures and geometries, and `__kart.timeFrames(60)` the milliseconds a frame takes.
- The buildings' facades are the map's (braga-map's task 017, `render/facades.ts`): each building's
  kind of facade, drawn in its real proportions, its colours, its walls' material, its ground floor
  along a street, its balconies and its shutters, as a session saw it in its photos or as the map
  guesses it. The shops' signs are the map's too (`render/signs.ts`). Every building's facade is the kit's: the ten photo facades were
  taken out with braga-map's task 082.
- `?stats` shows what the game costs in a corner, for measuring it on a phone (`src/stats.ts`): the
  frame rate and the worst second (of the race, or round the city since the last; after its first two), the graphics level, draw calls,
  triangles, the textures' memory, how long the city took to build and the page to be ready, what
  it downloaded, the graphics card and the pixels drawn. A screenshot of it is the measurement.
- `node scripts/download.mjs` builds the game as it's shipped, opens it and adds up what the page
  fetched before you can drive, as it is and gzipped.
- `node scripts/shots.mjs <label>` shoots braga-map's viewpoints (`../braga-map/refs/viewpoints.json`)
  with `?scenery`, at High and Low (and Medium with `--medium`; with `--ultra`, Ultra in High's place,
  as the rounds are shot since braga-map's task 081, and `--high` for High as well), into `shots/<date>-<label>/` (ignored
  by git): a PNG each, the shape of its photo and 720 pixels high, `stats.json` with each one's cost
  (draw calls, triangles, textures' memory, build and frame time), and `index.html` setting
  each beside its real photo (`../braga-map/.cache/refs/`) and the round before's. Name viewpoints
  after the label to shoot only those, and `--map=<folder>` to take the viewpoints and photos from
  another braga-map checkout than `../braga-map` (a worktree's, whose viewpoints the main one hasn't
  got yet). It starts its own dev server, as one started before braga-map
  was last installed still serves the old map; restart yours after `npm install` too. About 2 minutes.
- The touch controls show on a touch screen: Chrome's device toolbar, or Playwright with
  `hasTouch` and `isMobile`. Drive them with real touches (CDP's `Input.dispatchTouchEvent`), not
  synthetic events.

## The two halves

**The simulation** is pure TypeScript with no three.js and no DOM, so it runs under `node --test`:
`src/math.ts`, `src/sun.ts`, `src/track/`, `src/car/`, `src/world/`, `src/race.ts` and `src/game/`. Keep it that way. If one of
these files imports `three` or touches `window`/`document`, the tests can no longer load it.

**The browser** is everything else: `src/render/` (three.js), `src/session.ts` (PeerJS),
`src/main.ts` (screens, the frame loop and the glue), `src/hud.ts`, `src/audio.ts` and
`src/input.ts`.

Outside a race the game is free roam (braga-map's decision 019): your `Roamer`
(`src/game/roamer.ts`) on the world's ground (`world.drive`), anywhere in the open world's area, the
room's players drawn where they are from the same snapshots as in a race. Out of it, you fly the camera
(`Flyer`) or walk (`Walker`, on the same ground, stopped by the same walls through
`WorldGround.circle`, and by the karts and the others on foot), your kart waiting; the others see you
on foot as the driver you picked, standing. The race is something the
host starts from the menu, and everyone goes back to where they were when it's over. So is the
deathmatch (braga-map's task 074): a round on foot in Fujacal, in free roam (`fight` in `main.ts`
beside `roam`), everyone's kart waiting where it was, its shots decided by the shooter's browser
against the others as it draws them (the items' rule turned round: a bullet is instant), the
victim's browser taking the damage, the host keeping the kills and deaths. Its bots (braga-map's
task 075) are the host's: it steps them with you (`Squad`), finds their ways on the arena's walkable
ground (`Paths`, `src/world/paths.ts`), decides their shots as a player's browser does theirs, takes
their hits and says when they're down; everyone draws them from their snapshots, the host too. A
round is played in an arena (braga-map's task 079, `field` in `field.ts`), whose buildings have
insides: made up, by `src/world/interiors.ts`, the world's always (walked round the city too), the
ground's walls and floors in them (`roomAt`, `roomFloor`), looks through their windows, the city
cutting their facades' openings and drawing them (`render/interiors.ts`).

How a race runs:

- The host picks the track on the race screen, from `TRACKS` in `src/tracks.ts`: the Volta dos
  Amigos (`braga-map/tracks/amigos.js`) and the Volta de Lamaçães (`lamacaes.js`), Braga's real
  streets planned by braga-map. `buildTrack(course.points)` turns a track's points into a road
  sampled every metre from the start line. A sample index is roughly metres from the line, and the
  Volta dos Amigos' lap is about 10.1 km (N ≈ 10080 samples).
- `stepCar` (`src/car/car.ts`) is the handling. It always runs at a fixed `DT = 1/120` s, in the
  game and in the tests alike, on a `Ground`: the open world's `worldGround` (`src/world/ground.ts`:
  the land, braga-map's streets at their levels, and walls), or a race's, the same with the race's
  walls and ramp (`raceGround` in `src/world/race.ts`, built with the city for every track by
  `world.raceOn`, kept in `main.ts`'s `races`).
- An `Arena` is one browser's view of a race: the clock, every car's `CarInfo`, the projectiles and
  hazards on the track, and positions. A `Racer` is a car this browser drives: yours, plus the bots
  if you host.
- Each browser simulates only its own cars. Everyone else is drawn from snapshots, interpolated
  110 ms behind.
- The host is the hub of a star network. It relays positions 15 times a second, round the city as in
  a race, relays item events, runs the bots, keeps the leaderboard and decides when the race ends. If
  the host leaves, the room closes and everyone else drives on alone.
- Item events are deterministic. A projectile is its start (`t0`, `p0`, `lat`, `v`), so every
  browser draws it in the same place without sending positions. **A hit is decided by the browser
  of the car that gets hit**, which then tells the others.

## Conventions

- Imports carry the `.ts` extension, and type-only imports use `import type` or `type`
  (`verbatimModuleSyntax`).
- Use no TS-only runtime syntax: no `enum`, `namespace` or constructor parameter properties
  (`erasableSyntaxOnly`). Node has to be able to strip the types. Use `as const` objects instead.
- Coordinates: y is up, x is east, z is south. A car faces `(cos yaw, 0, sin yaw)`. Kart models face
  +x with +z to their right.
- Units: the physics is in metres, m/s and seconds (`dt`, and `spin`/`shrink`/`gold` timers). The
  race clock is in **milliseconds**: `arena.t`, `Run.lapStart`, `Proj.t0`, `LIFE`.
- Progress `P` is `laps × N + sample index`. It counts laps and is negative behind the line on the
  grid. Use `loopDelta` for distances round the loop.
- A `Racer` reports what happened as `notes`, which `main.ts` drains every frame for sounds, the HUD
  and the leaderboard. An `Arena` reports item effects through its `fx` callback. The simulation
  never plays sounds or touches the screen itself.
- Build DOM with the `h()` helper in `main.ts`, which only ever sets text. Never use `innerHTML`:
  player names come from other people.
- The host trusts nothing a client sends. `cleanSnap` and `cleanEv` in `session.ts` clamp every
  number and overwrite `owner`/`victim` with the sender's id; the room's marks go through
  `MarkBook` in `game/marks.ts`. Any new message or field needs the same treatment.
- Style: comments are full sentences in plain English that say what a thing is for or why it is so,
  not what the next line does. Maths-heavy code uses short names (`c`, `s`, `r`, `a`, `P`, `N`). Use
  2 spaces, single quotes, semicolons and trailing commas. Long lines are fine, and no formatter is
  configured. Write the README and UI text in the same plain voice as the README.
- Everything a player sees is in Portuguese, Portugal's, speaking to them as *tu*: the menus, the
  HUD, the feed, the item names and blurbs, the drivers' taglines, the errors, and the signs in the
  city. The code, its comments, the README and the docs stay in English. Credits a licence words
  exactly (EU-DEM's, "© OpenStreetMap contributors") keep their own words.

## Gotchas

- **The tracks and the city come from braga-map.** The tracks are `braga-map/tracks/<id>.js`, and
  `buildCity` loads the city round the home track, the Volta dos Amigos (`HOME` in `tracks.ts`),
  from the map's tiles (`loadWorld(HOME.box)`): every street
  in the open world's area drawn from the map's surfaces (`streets.ts`), the buildings cut back at
  the kerb as the karts find them (`ground.ts`). Other games use the same map, so change it there: run its
  scripts, tag a new version, then change the tag in `package.json` and `npm install`. To try a
  change before tagging it, `npm install --install-links ../braga-map` (again after each change
  there), and put the tag back before committing. See "The tracks" in `docs/making-changes.md`.
- **The race runs on the streets as they're drawn** (braga-map's task 037). Its road is braga-map's
  `road`: the route's own streets at their real widths and the jump's flight. Its outline is the
  race's walls (`raceWalls`), standing at the route's level, and a row of the race's barriers is
  drawn wherever the street goes on past it (`closures`: across each side street, and between a
  road's two carriageways drawn as one). Past the jump's landing it takes in the ground a kart flat
  out comes down on, walled in the open. A kart that comes down off it (launched over a wall) has
  left the race and is put back. The track's samples are only
  where the race goes: a sample's `w` is its street's width kerb to kerb, never past the race's road
  either side of the line, for the bots' lines, the item boxes and the grid; the walls are the
  road's outline, not the samples' edges (`kerbs` and `lanes`, carried through the layout like `w`,
  are the first track's, and only drawn). In front of a tunnel's mouth the land is held down, but
  not on another street's carriageway beside it (`land.ts`); where the race's road still drops away
  under the route, a fence stands (`raceDips`).
- **The friends' houses.** The waypoints are only in braga-map's ignored `.cache/places.json` and
  the shared map's database. Since braga-map's decision 014 (the owner's choice, knowing the repos
  are public) the easter eggs stand on the houses themselves, and the drivers are the friends by
  first name, each car matching their egg. Still: never a surname, a street name or a door number
  in the code, the docs or the UI.
- **The first track is kept for reference.** `LAYOUT` (`src/track/layout.ts`) and its world
  (`world.ts`, `landmarks.ts`, `braga.ts`, `buildTrees`) compile but aren't used by the game.
  Its scenery has raw sample indices of `LAYOUT` in it. The tests use the track for the jump and
  for the items.
- **Holding the brake reverses once the car has stopped.** That's the down arrow's job when
  driving. To keep a car still (the grid, "Time's up!", a spin-out), use `stopInput(car)` from
  `src/car/car.ts`, never `{ brake: 1 }`, or the car drives backwards.
- **The status flags are defined twice.** They are `FLAG` in `src/game/arena.ts`, and again as
  local `GOLD`/`SHIELD`/`SPIN`/`SHRINK`/`BOOST` constants in `src/render/drivers.ts`. Change both
  together. `cleanSnap` clamps flags to 16 bits.
- **`bake()` (`src/render/kit.ts`) merges a landmark's static meshes by material.** Anything you
  animate needs `userData.moves = true` on it or a parent, or it gets frozen into the merged mesh.
- **`mat()` caches materials by colour and settings**, so changing one changes every mesh that
  uses it. A kart's body paint is its own because gold plating recolours it.
- **The peer id prefix** `partykart-pk44-` in `src/session.ts` decides which builds can see each
  other's rooms. The deployed game and a dev build share rooms while it matches. Change it when the
  message format changes incompatibly, or a track changes or is added.
- **Item rolls and bot patience use `Math.random`.** That's fine because only one browser ever
  simulates a given car, or a given bot on foot (the host's `Squad`, which takes its dice as a
  function, so the tests seed them). Never have several browsers each re-simulate something that
  rolls dice.
  A shot's spread is drawn from its `seed`, sent with it, so every browser draws the same pellets.
- **A round's snapshot reuses `fl`.** On foot in a round, a snapshot's `fl` is the fighter's flags
  (`FIGHT` in `src/game/fight.ts`: down, armed, scoped, reloading, safe, crouched, team, and the weapon
  in hand as `WEAPON_IDS`' index in the top bits), not the kart's. `WEAPON_IDS` (arsenal.ts) is only
  ever added to at its end: its order is in every snapshot.
- **A grenade's flight is worked out in every browser** (`fly` in `src/game/nades.ts`), from its throw,
  on the round's ground without the karts (they're drawn where they are a little differently in each
  browser), so it bounces the same everywhere. Keep anything that differs between browsers out of it.
- **The eight-bot race test rolls dice.** "eight bots race a lap…" asserts that the lead changes
  at least once. Its item rolls are random, so it could still fail now and then, though since the
  bots spread across the road to pass (`steerLine` in `src/game/bot.ts`) it rarely does. Rerun it
  before assuming you broke something, and look at the printed summary.
- **The tests guard the tracks and the tuning.** Over every track in `TRACKS` they check a loop of
  7–10.5 km with 5 checkpoints inside the open world, an autopilot lap of the race on the world's
  ground with no respawns and a second lap at 25–60 m/s on average (the Volta dos Amigos' 170–310 s),
  the race closed (from its line a kart reaches nothing off its road), every row of
  barriers stopping a kart driven at it flat out, the first track's jump flying over 1 s and landing
  at any speed from 60 to 158 km/h, the Volta dos Amigos' jump landing on the race's road from
  braga-map's speed to flat out (past its 4 m landing street, on the ground beside it the race's road
  takes in) and short of it respawning on the run-up, the autopilot flying that jump's flight from
  any line and turning into the landing street with no wall hit, bots behind a kart stopped on its
  run-up going round it and flying, every item turning up at
  some place in the race, and eight bots all finishing a lap of each track within 60 s of each other.
  A change to a track, the physics or the item odds has to keep them passing.
- **A bot stuck against a wall gets itself out.** Still for 3 s in a race, it's put back on the
  track's line where it is (`unstick`), as a player would press Enter. A kart bumped by another is
  pushed back out of any wall the bump took it through (`nudge`).
- **A race's time limit follows its track's length.** `lapLimit` (`tracks.ts`), which the host's
  `start` takes for the track in the lobby, allows a lap at 60 km/h. The race's settings offer 1–3 laps, and time attack 5–15
  minutes.
- **What the race adds to the streets is up only in a race.** The start line, the gates, the boost
  pads, the barriers along the start and across the side streets, and the ramp into the dead end
  (`raceMarks`) are each track's `marks`, shown by `startRace` and hidden by `endRace`; the race's
  walls and ramp are in its own ground (each track's `ground`, from `world.raceOn`), not
  `world.drive`. The world's walls the Volta dos Amigos' race takes down (`world.cleared`) are hidden
  only in its race: no other track may clear any (a test). `?scenery` shoots the city
  without them. Round the city there's no ramp or barrier, on the screen or in the karts' ground:
  free roam is all real.
- **The plinth at the start is part of the karts' ground**, added to `world.drive` once the city is
  built (`stand` in `ground.ts`), and so are the walls of the buildings the city leaves out round the
  plinth, the eggs and the Tourigalo taken away (`unwall`). A test that builds its own
  `worldGround` has neither.
- **Graphics step down a level by themselves**, as far as Low, each time the game runs under 35 fps
  for 6 s, round the city or in a race (`watchSpeed` in `main.ts`). `?autodrive` turns this off. Phones start on Medium.
- **On a touch screen the kart accelerates by itself in a race.** `TouchPad` in `src/input.ts`
  holds the throttle down unless Brake is held, and its controls are merged with the keyboard's in
  `stepRace`. Round the city (`show('roam')`) it holds it only while a thumb is on the steering
  half; with none, `pad.waiting` and `stepRoam` pull the kart up, so it doesn't drive off the plinth
  and into the building over the street the moment the game opens. `body.touch` is set while the touch controls are in use (from the first touch until
  a game key is pressed). Mark keyboard-only and touch-only UI with `.keys-only` and `.touch-only`.
  Don't re-render the menus when it changes, or the tap that changed it is lost.
