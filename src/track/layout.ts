// The Braga Grand Prix, loosely: down the Avenida Central from the Praça da República, through the
// old town by the Sé and the Arco da Porta Nova, up the switchbacks of Bom Jesus to the sanctuary,
// a jump down the hill over the funicular, across the pitch of the quarry stadium and out through
// the rock, and round back to the Avenida.
//
// Each point is [x, y, z] in metres (x east, z south, y up), then options for the stretch from it
// to the next: width, bank (radians, + lifts the right edge), walls, and tags that mark a place.
export interface Point {
  p: [number, number, number];
  w?: number; // road width, carried on until changed
  bank?: number;
  walls?: boolean; // carried on until changed
  surface?: Surface; // carried on until changed
  tag?: Tag;
}

export type Surface = 'asphalt' | 'cobble' | 'grass';

export type Tag =
  | 'start'
  | 'fountain'
  | 'cp'
  | 'arch'
  | 'se'
  | 'boost'
  | 'church'
  | 'lip'
  | 'stadium-in'
  | 'kicker'
  | 'stadium-out'
  | 'items'; // a row of item boxes across the road

export const LAYOUT: Point[] = [
  // The Avenida Central, eastwards. The Praça da República and its fountain at the west end.
  { p: [-60, 0, 0], w: 18, walls: true, surface: 'asphalt', tag: 'fountain' },
  { p: [0, 0, 0], tag: 'start' },
  { p: [100, 0, 0] },
  { p: [200, 0, 0], tag: 'items' },
  { p: [270, 0, -3] },
  // Left into the old town: narrow, past the Sé, under the Arco da Porta Nova.
  { p: [312, 0, -25], w: 13, surface: 'cobble' },
  { p: [330, 0, -65], tag: 'se' },
  { p: [338, 0, -110], tag: 'arch' },
  { p: [352, 1, -155], tag: 'cp' },
  // Out of town and up towards Bom Jesus.
  { p: [380, 3, -205], w: 14, surface: 'asphalt' },
  { p: [420, 6, -245], tag: 'items' },
  { p: [470, 9, -260] },
  // The switchbacks, hairpin after hairpin.
  { p: [560, 14, -260], tag: 'cp' },
  { p: [605, 16, -262] },
  { p: [630, 17, -285], bank: 0 },
  { p: [605, 18, -310] },
  { p: [560, 21, -312] },
  { p: [490, 25, -312] },
  { p: [455, 26, -322] },
  { p: [442, 27, -340] },
  { p: [462, 28, -362] },
  { p: [510, 31, -362] },
  { p: [570, 35, -362], tag: 'cp' },
  { p: [612, 37, -366] },
  { p: [634, 38, -388] },
  { p: [612, 39, -410] },
  // The sanctuary at the top, then the run-up to the jump.
  { p: [560, 40, -412], tag: 'church' },
  { p: [500, 40, -412], tag: 'items' },
  { p: [455, 40, -412] },
  { p: [436, 41, -412] },
  { p: [426, 42.6, -412], tag: 'lip', walls: false },
  // Down the hill, beside the funicular: wide, to land on.
  { p: [412, 38, -412], w: 22 },
  { p: [395, 34, -412] },
  { p: [370, 30.5, -412] },
  { p: [320, 25.5, -411] },
  { p: [270, 20.5, -405], w: 15, walls: true, tag: 'cp' },
  { p: [210, 15, -385], tag: 'items' },
  { p: [150, 10, -355] },
  { p: [100, 6, -315], bank: -0.1 },
  { p: [62, 3, -272], bank: 0 },
  // The quarry stadium: in at the open end, over the pitch, out through the rock.
  { p: [40, 1, -250], w: 22, surface: 'grass', tag: 'stadium-in' },
  { p: [10, 1, -246], tag: 'boost' },
  { p: [-20, 3.5, -245], tag: 'kicker' },
  { p: [-35, 1, -245] },
  { p: [-70, 1, -245], w: 16, tag: 'items' },
  { p: [-110, 1, -245], surface: 'asphalt', tag: 'stadium-out' },
  // The long left-hander home, banked.
  { p: [-150, 1, -240], w: 18, bank: 0.12, tag: 'cp' },
  { p: [-190, 0.5, -215] },
  { p: [-212, 0, -170] },
  { p: [-215, 0, -110], tag: 'items' },
  { p: [-195, 0, -55] },
  { p: [-150, 0, -15], bank: 0, tag: 'boost' },
  { p: [-105, 0, 0] },
];

// The Rio Este, from the west across the run home, south of the stadium, under the old town's
// road and away east: [x, z] points. Where the road crosses it, there's a bridge.
export const RIVER: [number, number][] = [
  [-520, -122],
  [-330, -134],
  [-213, -138],
  [-120, -152],
  [-20, -160],
  [100, -150],
  [230, -140],
  [350, -148],
  [480, -170],
  [650, -186],
  [940, -192],
];
export const RIVER_HALF_W = 9;
export const WATER_Y = -2;
