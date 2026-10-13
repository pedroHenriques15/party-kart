# CLAUDE.md

Party Kart is a kart game played in the browser, for racing friends round a cartoon Braga. It is
TypeScript, three.js and PeerJS (WebRTC), built with Vite and served from GitHub Pages. There is no
server and no accounts, and no asset files either: every texture is drawn on a canvas and every
sound is synthesized. The README promises "nothing to maintain", so treat that as a design
constraint: don't add a backend, a build step or a dependency without a strong reason.

- `README.md`: the game as a player sees it (controls, items, the track).
- `docs/architecture.md`: how it fits together: the simulation, the frame loop, the network.
- `docs/making-changes.md`: step-by-step guides for changes that touch several files (the track,
  an item, a driver, a status flag, a message).
- `docs/releasing.md`: shipping a change to the live site.

## Commands

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # node --test over test/*.test.ts, about a second
npm run check        # tsc; the only type check the tests get
npm run build        # tsc && vite build, into dist/
npm run deploy       # tests, builds, force-pushes dist/ to gh-pages: it publishes the game
```

- Run one test with `node --test --test-name-pattern="disco ball" test/race.test.ts`.
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

- `?autodrive` lets the autopilot drive your car and use its items. It also exposes
  `window.__kart` (lap, place, item, draw calls, triangles) and `window.__scene`, for checking a
  change with Playwright.
- To play alone, create a room and start it: the empty places fill with bots. To test with other
  players, open a second tab with the invite link (`?room=<code>`). Rooms go through PeerJS's public
  server, so this needs internet access.
- `?exp= ?sun= ?hemi= ?env= ?fog=` override the lighting (`src/render/look.ts`), for tuning.

## The two halves

**The simulation** is pure TypeScript with no three.js and no DOM, so it runs under `node --test`:
`src/math.ts`, `src/track/`, `src/car/`, `src/race.ts` and `src/game/`. Keep it that way. If one of
these files imports `three` or touches `window`/`document`, the tests can no longer load it.

**The browser** is everything else: `src/render/` (three.js), `src/session.ts` (PeerJS),
`src/main.ts` (screens, the frame loop and the glue), `src/hud.ts`, `src/audio.ts` and
`src/input.ts`.

How a race runs:

- `buildTrack(LAYOUT)` turns the hand-placed points in `src/track/layout.ts` into a road sampled
  every metre from the start line. A sample index is roughly metres from the line, and the lap is
  about 2.5 km (N ≈ 2503 samples).
- `stepCar` (`src/car/car.ts`) is the handling. It always runs at a fixed `DT = 1/120` s, in the
  game and in the tests alike.
- An `Arena` is one browser's view of a race: the clock, every car's `CarInfo`, the projectiles and
  hazards on the track, and positions. A `Racer` is a car this browser drives: yours, plus the bots
  if you host.
- Each browser simulates only its own cars. Everyone else is drawn from snapshots, interpolated
  110 ms behind.
- The host is the hub of a star network. It relays positions 15 times a second, relays item events,
  runs the bots, keeps the leaderboard and decides when the race ends. If the host leaves, the room
  closes.
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
  number and overwrite `owner`/`victim` with the sender's id. Any new message or field needs the
  same treatment.
- Style: comments are full sentences in plain English that say what a thing is for or why it is so,
  not what the next line does. Maths-heavy code uses short names (`c`, `s`, `r`, `a`, `P`, `N`). Use
  2 spaces, single quotes, semicolons and trailing commas. Long lines are fine, and no formatter is
  configured. Write the README and UI text in the same plain voice as the README.

## Gotchas

- **Sample indices are hard-coded in the scenery.** Editing `LAYOUT` moves every sample, and these
  depend on them:
  - `SPOTS`, the Roman ruins and their sign (`1700`, `1690`), and `N - 45`/`N - 22` in
    `src/render/braga.ts`;
  - the house rows (`290–475`, `2330–2500`) in `src/render/landmarks.ts`;
  - the menu cars (`2300`) and the showroom camera (`samples[40]`) in `src/main.ts`.

  Things placed by `tag` follow the track by themselves. See `docs/making-changes.md`.
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
- **The peer id prefix** `partykart-pk26-` in `src/session.ts` decides which builds can see each
  other's rooms. The deployed game and a dev build share rooms while it matches. Change it when the
  message format changes incompatibly.
- **Item rolls and bot patience use `Math.random`.** That's fine because only one browser ever
  simulates a given car. Never have several browsers each re-simulate something that rolls dice.
- **The eight-bot race test is flaky.** "eight bots race two laps…" asserts that the lead changes
  at least once, and fails now and then because its item rolls are random. Rerun it before
  assuming you broke something, and look at the printed summary.
- **The tests guard the track and the tuning.** They check a loop of 1.8–2.8 km with 5
  checkpoints, an autopilot lap with no respawns and a second lap of 45–100 s, a jump that flies over
  1 s and lands at any speed from 60 to 158 km/h, every item turning up at some place in the race,
  and eight bots all finishing within 40 s of each other. A change to the layout, the physics or
  the item odds has to keep them passing.
- **Graphics on High step down to Medium by themselves** if a race runs under 35 fps for 6 s
  (`watchSpeed` in `main.ts`). `?autodrive` turns this off.
