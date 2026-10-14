# Party Kart

The Volta dos Amigos, round Braga's real streets and past the friends' houses. A kart game to race
your friends in the browser, on a keyboard or a phone, with power-ups and bots. A throwaway game: no
server, no accounts, nothing to maintain. The drivers are the friends, and all faces are cartoons.

## Playing

The game speaks Portuguese, Portugal's.

1. Open the page, pick a driver, click **Criar uma sala**.
2. **Copiar o convite** and send it to your friends. They open it, pick a driver, **Entrar**.
3. Choose the mode and **Começar a corrida**. Empty places on the grid are bots (you choose how many).

**Race**: 1 to 3 laps (a lap is about four and a half minutes), a starting grid, positions, power-ups, catch-up. **Time attack**: everyone
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
| Derrapar | Hold it through a corner, as with Space |
| Travar | Slows you down, and reverses once you've stopped |
| Item | Tap to use what it shows; swipe it down to throw backwards |
| ↺ · 📢 · 🎥 · 🔊 (at the top) | Back to your last checkpoint · horn · camera · sound |

On Android the game goes full screen when you create, join or start a race. On an iPhone, add the
page to the home screen (Share → Add to Home Screen) for the same.

The power-ups, from the **?** boxes. The further behind you are, the better what you get:

| | |
|---|---|
| ☕ Café (×1, or três cafés) | A burst of speed |
| 🍮 Pudim Abade de Priscos | Dropped behind you; whoever hits it spins |
| ⚽ Bola do Braga | Rolls ahead (or back); spins whoever it meets |
| 🕊️ Pombo-correio | Flies to the car ahead of you |
| 🚀 Foguete | Goes for the leader, and catches anyone close |
| ✨ Filigrana | Gold all over: faster, untouchable; spins whoever you touch |
| 🔨 Martelinho | Bonks everyone ahead of you down to size |
| ☂️ Guarda-chuva | Open as soon as you get it, and keeps off the next hit. Your item slot stays free for the next box |

Also: get right behind a car and its **slipstream** builds up over a second or so and pulls you
along, harder the closer you are, and when you pull out to pass the extra speed wears off over a
few seconds; karts **bump**; and with
**catch-up** on, the further behind the leader, the more top speed. All of it can be switched off
in the lobby.

**The track, the Volta dos Amigos**: 9.3 km of Braga as it is, through five friends' neighbourhoods
south and east of the centre, the way the traffic goes. Every street, building, park and tree round
it comes from OpenStreetMap, and the ground from DGT's 2025 LiDAR: the hills, 68 m from the lowest
point to the highest and as steep as 19.5%, the streets that tip sideways, the cuttings and banks
beside them. From the line on the Rua do Fujacal, west as its traffic goes, round by the Avenida
Imaculada Conceição, down the Avenida da Liberdade and over the Rio Este at São João da Ponte; up
past the Largo da Devesa to the slopes of the Picoto; up the Avenida 31 de Janeiro and the Avenida
João XXI and back down the Rua Bernardo Sequeira, then Lamaçães's avenues and roundabouts, past
Makro and the Tourigalo; back west round the Picoto by the Picoto Adventure Park, and down
the Avenida Doutor Viriato Amaral Nunes past the Estádio 1.º de Maio and the Altice Forum; through a
new link into what was the dead end of the Rua Nova do Couteiro, over the river again, and home
along the Rua Conselheiro Lobato.

The streets are as wide as they are (never under 9 m, so eight karts fit), with their lanes
painted white, their zebra crossings, traffic lights and bus stops, calçada pavements behind
granite kerbs, central reservations where the avenues have them, and granite setts where the
street is cobbled. A blue-and-white plate names each street as you turn into it. Bom Jesus and the
Sameiro stand on the hills to the east, drawn twice their size so you can find them, and the cross
on top of the Picoto. By the Avenida Doutor António Alves Palha's roundabout stands the Tourigalo, the
black bull with a rooster's head, on its lawn: five times its real size, and exaggerated in every
part, on purpose. Each friend's house has its joke on it: a dog, a
dentist, a supermarket, a café, and an alarm clock.

The first track, the cartoon Braga Grand Prix (the Avenida, the Sé, the switchbacks of Bom Jesus
and the jump), is kept in the code for reference, but the game doesn't race it any more.

The drivers are the five friends, each in a car that's a joke about them: Pedro's tech kart (a laptop
on the nose, a Wi-Fi antenna, neon underneath), Joel's dentist's chair, Joel F.'s Mercadona trolley,
Capelas's car for sale for parts (rusty, roofless, its bumper hanging off), and Vale's kart with a
giant alarm clock on the back, because he's always late. With more than five on the grid, the bots
drive the same cars again in a second paint ("Pedro II").

**Graphics** (*Gráficos*): *Alta*, *Média* or *Baixa*, on the first screen and in the lobby. Phones start on Medium. If
a race runs slowly, the game steps down a level by itself, as far as Low.

## How it works

- Everyone drives their own car in their own browser, so there's no lag on your own driving.
  Whoever creates the room is the host: their browser drives the bots, relays where everyone is
  (15 times a second) and what they throw, keeps the order and the clock.
- What's thrown is deterministic: a bola is where it started, how fast and when, so every
  browser draws it in the same place without sending positions. A hit is decided by the one
  who gets hit, in their own browser, and told to the others: what you see is what happened.
- Players connect over WebRTC, through [PeerJS](https://peerjs.com/)'s free public server, which
  only introduces them (and relays when a router is strict).

## Code

- `src/track/`: the road built from a layout, and the first track (`layout.ts`, for reference).
  The Volta dos Amigos itself comes from the map of Braga, below.
- `src/car/`: the handling (drifts, mini-turbos, jumps), and an autopilot.
- `src/game/`: a race: the arena (clock, cars, items in flight, order), a racer (laps, boxes,
  items, hits, bumps, slipstreams, catch-up), the items' rules, and the bots.
- `src/render/`: the look (sky, sun, shadows, quality); the city round the track (`city.ts`,
  from the map), the road (`road.ts`), the bridges off it and the tunnels' mouths
  (`levels.ts`), the easter eggs (`eggs.ts`); trees, karts and
  drivers, items, particles, skid marks; and the first track's world (`world.ts`,
  `landmarks.ts`, `braga.ts`), for reference.
- The map of Braga is its own repo, [braga-map](https://github.com/pedroHenriques15/braga-map),
  shared with the games to come: the city in sections, and the tracks planned on its streets. The
  game installs it as a package.
- `src/session.ts`: rooms. `src/hud.ts`: the race's screen. `src/main.ts`: the screens and the loop.
- `src/audio.ts`: every sound, through one mix. The karts' engines are a race car's V8 through six
  gears, synthesized, as is everything else but the city round the track: recordings of traffic,
  a town, birds, woods, a river, bells, a bus and a crowd (CC0, from Freesound, listed in
  braga-map's `docs/SOURCES.md`), in `src/sounds/`, heard by what's near (`src/ambience.ts`).

How it fits together, the network messages included, is in [docs/architecture.md](docs/architecture.md).
How to change the track, add an item or a driver, and what to watch out for is in
[docs/making-changes.md](docs/making-changes.md). Putting a change live is in
[docs/releasing.md](docs/releasing.md).

The tests run the TypeScript straight in Node, which needs Node 22.18 or later.

```sh
npm install
npm run dev      # http://localhost:5173; ?autodrive lets the autopilot drive, for testing
npm test         # the track; the first track's jump; items, catch-up, slipstreams; eight bots
npm run check    # the type check (Node runs the tests without one)
npm run build
npm run deploy   # publish to GitHub Pages (the gh-pages branch)
```

Map data © OpenStreetMap contributors, under the Open Database Licence. The ground is from DGT's
LiDAR (CC BY 4.0): informação geográfica cedida pela Direção-Geral do Território. The horizon
beyond the map is from Terrain Tiles, on AWS Open Data. Europe terrain data produced using
Copernicus data and information funded by the European Union - EU-DEM layers.
