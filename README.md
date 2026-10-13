# Party Kart

P. Kiddy's White Party · the Braga Grand Prix. A kart game to race your friends in the browser,
on a keyboard or a phone, with power-ups and bots. A throwaway game: no server, no accounts,
nothing to maintain. All names are parodies, and all faces are cartoons.

## Playing

1. Open the page, pick a driver, click **Create a room**.
2. **Copy invite link** and send it to your friends. They open it, pick a driver, **Join**.
3. Choose the mode and **Start**. Empty places on the grid are bots (you choose how many).

**Race**: 1 to 5 laps, a starting grid, positions, power-ups, catch-up. **Time attack**: everyone
drives at once, through each other; your best lap before the clock runs out counts, against
the ghost of your best.

| Key | |
|---|---|
| Arrows or WASD | Drive |
| Space | Drift. Hold it through a corner: blue sparks, then orange; let go for a mini-turbo |
| E or Shift | Use your item (hold ↓ to throw backwards) |
| Enter | Back to your last checkpoint |
| Backspace | Restart the lap (time attack) |
| H · C · M | Horn · camera · sound |

**On a phone or a tablet**, turned sideways, the kart goes by itself:

| Touch | |
|---|---|
| Left half of the screen | Steer: put your thumb down anywhere and drag left or right |
| Drift | Hold it through a corner, as with Space |
| Brake | Slows you down, and reverses once you've stopped |
| Item | Tap to use what it shows; swipe it down to throw backwards |
| ↺ · 📢 · 🎥 · 🔊 (at the top) | Back to your last checkpoint · horn · camera · sound |

On Android the game goes full screen when you create, join or start a race. On an iPhone, add the
page to the home screen (Share → Add to Home Screen) for the same.

The power-ups, from the **?** boxes. The further behind you are, the better what you get:

| | |
|---|---|
| 🍾 Champagne (×1 or ×3) | A burst of speed |
| 🍮 Pudim Abade de Priscos | Dropped behind you; whoever hits it spins |
| 🪩 Disco ball | Rolls ahead (or back); spins whoever it meets |
| 📸 Paparazzi drone | Flies to the car ahead of you |
| 💣 Party bomb | Goes for the leader, and catches anyone close |
| 👑 Gold plating | Faster, untouchable; spins whoever you touch |
| 🔊 Bass drop | Shrinks everyone ahead of you |
| 🛡️ Bodyguard | Blocks the next hit |

Also: sit close behind a car for a second for a **slipstream** boost; karts **bump**; and with
**catch-up** on, the further behind the leader, the more top speed. All of it can be switched off
in the lobby.

**The track, through Braga**: the Avenida Central from the Praça da República (its fountain, the
Arcada, the Torre de Menagem, the BRAGA letters, the Theatro Circo, jacarandas in bloom); the old
town's calçada past the Câmara Municipal and the Pelican fountain, the Capela dos Coimbras, the
Jardim de Santa Bárbara, the Sé, under the Arco da Porta Nova, past the azulejos of the Palácio do
Raio and over the Rio Este; up the switchbacks of Bom Jesus (its stairway, the cypresses, the lake
and its boats, the Sameiro on the next hill); a jump down the hill beside the funicular; past the
Roman ruins of Bracara Augusta; across the pitch of the quarry stadium and out through its rock;
and over the river again on the long curve home, Tibães on its hill to the west.

The drivers: P. Kiddy (the host), Donald Trunk, Gucci Pain, Lil Woozy Vert, Trav Scotch,
22 Average, Lil Babyface, Lil Past and Playboi Farty.

**Graphics**: High, Medium or Low, on the first screen and in the lobby. Phones start on Medium. If
a race runs slowly, the game steps down a level by itself, as far as Low.

## How it works

- Everyone drives their own car in their own browser, so there's no lag on your own driving.
  Whoever creates the room is the host: their browser drives the bots, relays where everyone is
  (15 times a second) and what they throw, keeps the order and the clock.
- What's thrown is deterministic: a disco ball is where it started, how fast and when, so every
  browser draws it in the same place without sending positions. A hit is decided by the one
  who gets hit, in their own browser, and told to the others: what you see is what happened.
- Players connect over WebRTC, through [PeerJS](https://peerjs.com/)'s free public server, which
  only introduces them (and relays when a router is strict).

## Code

- `src/track/`: the layout of the Braga track (and the river), and the road built from it.
- `src/car/`: the handling (drifts, mini-turbos, jumps), and an autopilot.
- `src/game/`: a race: the arena (clock, cars, items in flight, order), a racer (laps, boxes,
  items, hits, bumps, slipstreams, catch-up), the items' rules, and the bots.
- `src/render/`: the look (sky, sun, shadows, quality), the world, Braga's landmarks
  (`landmarks.ts`, `braga.ts`), trees, karts and drivers, items, particles, skid marks.
- `src/session.ts`: rooms. `src/hud.ts`: the race's screen. `src/main.ts`: the screens and the loop.

How it fits together, the network messages included, is in [docs/architecture.md](docs/architecture.md).
How to change the track, add an item or a driver, and what to watch out for is in
[docs/making-changes.md](docs/making-changes.md). Putting a change live is in
[docs/releasing.md](docs/releasing.md).

The tests run the TypeScript straight in Node, which needs Node 22.18 or later.

```sh
npm install
npm run dev      # http://localhost:5173; ?autodrive lets the autopilot drive, for testing
npm test         # the track and the jumps; items, catch-up, slipstreams; a race of eight bots
npm run check    # the type check (Node runs the tests without one)
npm run build
npm run deploy   # publish to GitHub Pages (the gh-pages branch)
```
