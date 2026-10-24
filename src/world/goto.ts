// "Ir para aqui" (braga-map's task 108): from the full map, your kart put on the street nearest a
// place a kart can drive to, at the ground's level, facing along it; round the city only.
import type { Car } from '../car/car.ts';
import type { WorldGround } from './ground.ts';

// Whether the map offers it: round the city, never in a race or a round, nor while the room is
// starting one (its lobby racing before this browser's race or round has begun).
export const mayGo = (where: 'roam' | 'race' | 'round' | null, starting: boolean) => where === 'roam' && !starting;

// Where your kart goes for (x, z): on the nearest carriageway inside the open world's area, at the
// ground's level there (not a deck over it), facing along the street the way nearest `yaw`; or
// null outside the area.
export function kartTo(g: WorldGround, x: number, z: number, yaw = 0): Car | null {
  if (!g.d.inside.has(x, z)) return null;
  return g.spawn(x, z, g.groundAt(x, z), yaw);
}
