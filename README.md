# Party Kart

P. Kiddy's White Party · Braga Grand Prix. A Trackmania-style kart game to race your friends in
the browser, keyboard only. A throwaway game: no server, no accounts, nothing to maintain.

All names are parodies, and all faces are cartoons.

## Playing

1. Open the page, pick a driver, click **Create a room**.
2. **Copy invite link** and send it to your friends. They open it, pick a driver, **Join**.
3. Choose the round's length and **Start the round**.

It's a time attack: everyone drives at the same time, through each other. Your best lap before
the clock runs out counts.

| Key | |
|---|---|
| Arrows or WASD | Drive |
| Space | Drift, in a corner |
| Enter | Back to your last checkpoint, at the speed you passed it |
| Backspace | Restart the lap |
| H | Horn (everyone hears it) |
| C | Camera |
| M | Sound on/off |

The track, through Braga: the Avenida Central from the Praça da República's fountain, the old
town's calçada past the Sé and under the Arco da Porta Nova, the switchbacks up to Bom Jesus, a
jump down the hill beside the funicular, the pitch of the quarry stadium and the tunnel through
its rock, and the long curve home. The orange pads boost you.

The drivers: P. Kiddy (the host), Donald Trunk, Gucci Pain, Lil Woozy Vert, Trav Scotch,
22 Average, Lil Babyface, Lil Past and Playboi Farty.

## How it works

- Everyone drives their own car in their own browser, so there's no lag on your own driving.
  Whoever creates the room is the host: their browser relays where everyone is (15 times a
  second), keeps the leaderboard and the round's clock.
- Players connect over WebRTC, through [PeerJS](https://peerjs.com/)'s free public server, which
  only introduces them (and relays when a router is strict).
- If someone leaves, their car goes; if the host leaves, the room closes.

## Code

- `src/track/`: the layout of the Braga track, and the road built from it.
- `src/car/`: the handling, and an autopilot (for the tests and the cars on the menus).
- `src/race.ts`: laps, checkpoints, respawns.
- `src/render/`: the 3D world (three.js), Braga's landmarks, the drivers and their karts.
- `src/session.ts`: rooms. `src/main.ts`: the screens and the game loop.

```sh
npm install
npm run dev      # http://localhost:5173; add ?autodrive to let the autopilot drive
npm test         # the track, the handling and the jumps, driven by the autopilot
npm run build
npm run deploy   # publish to GitHub Pages (the gh-pages branch)
```
