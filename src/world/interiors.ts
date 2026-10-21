// The insides of the arenas' buildings (braga-map's task 079, the owner's answer of 2026-10-20: very
// simple, a ground floor in most, every floor and the roof in one or two of the tallest). Made up, as
// the map knows nothing of what's inside: each building wholly in an arena whose ground floor a door
// can open onto the street at its level gets one room on its ground floor, its doors and windows open
// where its facade draws them (storeys.ts's bays; render/facades.ts's door and windows), and in two of
// the arenas the tallest flat-roofed block gets a stairwell from its ground floor to its roof, each
// storey one floor, its windows open, a parapet round its roof and a hut over the stairs.
//
// To be good places to fight in, as a Counter-Strike map's are (the owner's word of 2026-10-21), a
// floor of any size is split by partitions into two to four rooms, each partition with an open
// doorway, so there are corners to hold and to look round; a room has a second door where its walls
// allow, so it's a way through and not a dead end; and each of its rooms is furnished for what it
// is (a shop, a cafe, a kitchen, a living room, a bedroom, a store, an office): counters and bars to
// crouch behind, tables, sofas, beds, shelves and fridges to stand behind, crates to climb on, as
// boxes. A metre's lane is kept clear between its doors, its doorways and its stairs, and nothing
// stands in a door's way or a stair's. All of it is drawn from the building's own dice, so every
// browser furnishes it the same.
//
// The ground takes it as walls and floors (ground.ts: the outline's walls with their openings, the
// partitions and each piece of furniture's sides, a room's floor over the land, a box's top to stand
// on), a look and a shot through the openings and not through a partition or a box (sight.ts), and
// the city draws it (city.ts cuts the walls' openings and leaves the land out under the room;
// render/interiors.ts draws the inside). Pure, so the tests walk it.
import type { Building, FacadeProportions, World as Braga } from 'braga-map';
import { baysOf, storeys, streetFront } from './storeys.ts';

// The walls' thickness as drawn: the facade outside, the inside face this far in. The walls a walker
// meets stand at their middle, half as thick each side.
export const SKIN = 0.2;
// A floor's thickness, between a storey's ceiling and the next one's floor.
export const SLAB = 0.25;
// The highest a walker steps up (ground.ts's STEP, here to keep the two modules apart).
const STEP = 0.3;
// The stairs: a tread's going, the highest riser, each flight's width and the gap between the two, the
// floor at the foot of a flight and the landing at the turn.
const GOING = 0.28;
const RISE = 0.18;
const FLIGHT = 1.1;
const GAP = 0.15;
const ENTRY = 1.2;
const LANDING = 1.2;
const STAIR_W = 2 * FLIGHT + GAP;
// The balustrades round a stairwell and a roof's parapet, and the hut over the stairs on the roof.
export const RAIL = 1.0;
export const PARAPET = 1.05;
export const HUT = 2.4;
// The arenas whose tallest flat-roofed building has every floor and its roof (the owner's answer:
// one or two at most).
// The owner's word of 2026-10-21 asked for Santa Justa's too.
const TOWERS = new Set(['topo', 'vilaca', 'santa-justa']);

type XZ = [number, number];

// A hole through a wall: from s0 to s1 along it (from its first corner), from y0 to y1 (heights over
// elev0, as everything's).
export interface Opening {
  s0: number;
  s1: number;
  y0: number;
  y1: number;
  door: boolean;
}

// One of a room's walls: the building's outline from a to b, out to its right (nx, nz); its bays as
// the facade lays them out; whether it faces a street and whether another building stands against it;
// the bay of its door (-1 for none) and its openings.
export interface RoomSide {
  a: XZ;
  b: XZ;
  L: number;
  nx: number;
  nz: number;
  street: boolean;
  shared: boolean;
  bays: number;
  bayW: number;
  margin: number;
  door: number;
  open: Opening[];
}

// A tread or a landing: a box, its top at y.
export interface Step {
  pts: XZ[];
  y: number;
}

// A wall of the stairwell's and the roof's: the stairwell's, the hut's or the parapet (open: a look
// passes it).
export interface Partition {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  y0: number;
  y1: number;
  open: boolean;
}

// The stairs up a tower: their rectangle, where every floor above the ground is open over them, the
// treads and landings, what stands round them, the hut over them on the roof, and the way up for the
// bots (each flight's foot, its landing's two ends and the next floor).
export interface Stair {
  pts: XZ[];
  hole: XZ[];
  steps: Step[];
  walls: Partition[];
  hut: { pts: XZ[]; y: number; door: [number, number] };
  ways: { x: number; y: number; z: number }[][];
}

// A piece of furniture as a box, or a part of one (a sofa's seat and its back): its corners, the two
// at its back first (against the wall it stands at, if any), from y0 to y1; and what it is, for
// drawing it.
export type Thing = 'crate' | 'shelf' | 'wardrobe' | 'counter' | 'bar' | 'table' | 'desk' | 'sofa' | 'sofa-back' | 'bed' | 'headboard' | 'fridge' | 'unit';
export interface Solid {
  pts: XZ[];
  y0: number;
  y1: number;
  kind: Thing;
}

// What a room of a floor is, and what its floor is laid with.
export type Use = 'shop' | 'cafe' | 'kitchen' | 'living' | 'bedroom' | 'store' | 'office' | 'roof';
export type Finish = 'tiles' | 'wood' | 'concrete' | 'carpet';

// A room of a floor, between its partitions: its outline, its floor and the underside of what's over
// it (on a roof, Infinity), and what it is.
export interface Zone {
  pts: XZ[];
  y: number;
  top: number;
  use: Use;
  finish: Finish;
}

export interface Room {
  b: Building;
  pts: XZ[]; // the outline, counter-clockwise seen from above
  inner: XZ[]; // its inside face, SKIN in
  y: number; // the ground floor
  G: number;
  S: number;
  floors: number;
  // The floors to stand on: the ground floor's, and in a tower each storey's and the roof's.
  levels: number[];
  ceiling: number; // over the ground floor, in a room of one floor
  tower: boolean;
  sides: RoomSide[];
  stair: Stair | null;
  parapet: Partition[];
  // Each door's way through, for the bots: a point outside it and one inside.
  doors: { x: number; y: number; z: number }[][];
  box: { x0: number; z0: number; x1: number; z1: number };
  arena: string;
  // The way its longest inside wall runs: its partitions stand along it or across it, and its floors'
  // boards and tiles are laid along it.
  axis: XZ;
  // The partitions between its rooms (each piece beside a doorway, and the lintel over it), its
  // furniture, its rooms, and each doorway's way through for the bots: a point either side.
  partitions: Partition[];
  solids: Solid[];
  zones: Zone[];
  gaps: { x: number; y: number; z: number }[][];
  // Which of the inside walls' colours it has.
  tone: number;
  // The outlines of the buildings that stand into it (the map's outlines overlap now and then): their
  // walls stand in the room, and nothing is put where they are.
  intruders: XZ[][];
}

// What the ground tells the rooms: what's underfoot outside at (x, z) from height y, and whether
// anything stands in the way of someone at (x, z) at height y (a wall, a tree, a building).
export interface Outside {
  floor(x: number, z: number, y: number): { y: number; buried: boolean };
  blocked(x: number, z: number, y: number): boolean;
  // Whether the building's walls are as the map has them, not cut back at a kerb or a passage.
  whole(b: Building): boolean;
}

// Whether (x, z) is in a ring.
export function inside(r: XZ[], x: number, z: number): boolean {
  let odd = false;
  for (let k = 0, j = r.length - 1; k < r.length; j = k++) {
    const [ax, az] = r[k];
    const [bx, bz] = r[j];
    if (az > z !== bz > z && x < ax + ((z - az) / (bz - az)) * (bx - ax)) odd = !odd;
  }
  return odd;
}

const areaOf = (r: XZ[]) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
};

// A ring moved in by d: each side's line moved d to its left (the inside, counter-clockwise), each
// corner where two meet. Null where it folds over itself.
export function inset(r: XZ[], d: number): XZ[] | null {
  const n = r.length;
  const out: XZ[] = [];
  for (let k = 0; k < n; k++) {
    const p = r[(k + n - 1) % n];
    const q = r[k];
    const s = r[(k + 1) % n];
    const l1 = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const l2 = Math.hypot(s[0] - q[0], s[1] - q[1]) || 1;
    // In: to the left of the way round, (-dz, dx).
    const n1: XZ = [-(q[1] - p[1]) / l1, (q[0] - p[0]) / l1];
    const n2: XZ = [-(s[1] - q[1]) / l2, (s[0] - q[0]) / l2];
    const bx = n1[0] + n2[0];
    const bz = n1[1] + n2[1];
    const c = (bx * n1[0] + bz * n1[1]) || 1;
    const k2 = d / c;
    if (Math.abs(k2) > 3 * d) out.push([q[0] + n2[0] * d, q[1] + n2[1] * d]);
    else out.push([q[0] + bx * k2, q[1] + bz * k2]);
  }
  const a0 = areaOf(r);
  const a1 = areaOf(out);
  if (Math.sign(a0) !== Math.sign(a1) || Math.abs(a1) < Math.abs(a0) * 0.5) return null;
  return out;
}

// Where the facade draws a window in a bay, as parts of the bay across and up: its kind's storey (on a
// ground floor of homes as on the others), or a ground floor's (render/facades.ts's groundOf).
type Pane = { x0: number; x1: number; y0: number; y1: number };
function paneOf(kind: string, p: FacadeProportions): Pane | null {
  switch (kind) {
    case 'shops':
      return { x0: 0.51 / 3.4, x1: 2.89 / 3.4, y0: 0.31 / 3.6, y1: 2.74 / 3.6 };
    case 'glazed':
      return { x0: 0.05 / 3.4, x1: 3.35 / 3.4, y0: 0.05 / 3.6, y1: 3.25 / 3.6 };
    case 'arcade':
      return { x0: 0.75 / 3.4, x1: 2.65 / 3.4, y0: 0.2 / 3.6, y1: 2.5 / 3.6 };
    case 'garages':
    case 'church':
    case 'plain':
      return null;
    case 'glass-office':
      return { x0: 0.06, x1: 0.94, y0: 0.45 / p.storey, y1: 0.92 };
    case 'commercial':
      return { x0: (p.bay - p.win[0]) / 2 / p.bay, x1: (p.bay + p.win[0]) / 2 / p.bay, y0: (p.storey - 1.5) / p.storey, y1: (p.storey - 0.6) / p.storey };
    default:
      return { x0: (p.bay - p.win[0]) / 2 / p.bay, x1: (p.bay + p.win[0]) / 2 / p.bay, y0: p.sill / p.storey, y1: Math.min(0.97, (p.sill + p.win[1]) / p.storey) };
  }
}

// The front door the facade draws in a bay (render/facades.ts's groundOf('door')), as parts of it.
const DOOR: Pane = { x0: 1.1 / 3.4, x1: 2.3 / 3.4, y0: 0, y1: 2.25 / 3.6 };

// The rooms of every arena's buildings.
export function furnish(world: Braga, out: Outside): Room[] {
  const rooms: Room[] = [];
  const front = streetFront(world.lines);
  for (const arena of world.arenas ?? []) {
    const here: Room[] = [];
    for (const b of world.buildings) {
      if (!b.pts.every(([x, z]) => inside(arena.pts, x, z))) continue;
      const r = roomOf(world, b, out, front, arena.id);
      if (r) here.push(r);
    }
    // The tower: the tallest flat-roofed building of three storeys or more a stairwell fits in, the
    // nearer the arena's middle the better (where it looks over all of it).
    if (TOWERS.has(arena.id)) {
      const cx = arena.pts.reduce((s, p) => s + p[0], 0) / arena.pts.length;
      const cz = arena.pts.reduce((s, p) => s + p[1], 0) / arena.pts.length;
      const score = (r: Room) => r.b.h - 0.3 * Math.hypot((r.box.x0 + r.box.x1) / 2 - cx, (r.box.z0 + r.box.z1) / 2 - cz);
      for (const r of [...here].sort((p, q) => score(q) - score(p))) {
        if (r.b.roof !== 0 || r.floors < 3 || !tower(world, r)) continue;
        break;
      }
    }
    for (const r of here) fit(r);
    rooms.push(...here);
  }
  return rooms;
}

function roomOf(world: Braga, b: Building, out: Outside, front: ReturnType<typeof streetFront>, arena: string): Room | null {
  if (b.kind === 3 || !out.whole(b)) return null;
  let pts = b.pts.slice() as XZ[];
  // Counter-clockwise seen from above (x east, z south), as city.ts lays the walls out.
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  if (a < 0) pts = pts.reverse();
  const area = Math.abs(areaOf(pts));
  if (area < 12 || area > 900) return null;
  const inner = inset(pts, SKIN);
  if (!inner) return null;
  const f = b.facade;
  const P = world.facadeTypes[f.type];
  const { G, S, floors } = storeys(P, b.h, b.floors, b.roof === 0);
  if (G < 2.4) return null;
  const homes = f.type === 'house' || f.type === 'old-house' || f.type.startsWith('block');
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const box = { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };

  // Each wall: its bays, whether it faces a street, whether another building stands against it, and
  // where a door in it would open onto (the floor 0.45 m out from its middle bay).
  const sides: RoomSide[] = [];
  const cand: { k: number; i: number; s0: number; s1: number; y: number; score: number }[] = [];
  for (let k = 0; k < pts.length; k++) {
    const [x0, z0] = pts[k];
    const [x1, z1] = pts[(k + 1) % pts.length];
    const L = Math.hypot(x1 - x0, z1 - z0);
    const nx = L ? (z1 - z0) / L : 0;
    const nz = L ? -(x1 - x0) / L : 0;
    const street = L > 0.01 && front(x0, z0, x1, z1, nx, nz);
    const bays = baysOf(P, L, f.type);
    const mx = (x0 + x1) / 2 + nx * 0.5;
    const mz = (z0 + z1) / 2 + nz * 0.5;
    const shared = world.buildings.some((o) => o !== b && Math.abs(o.pts[0][0] - mx) < 80 && Math.abs(o.pts[0][1] - mz) < 80 && inside(o.pts as XZ[], mx, mz));
    sides.push({ a: [x0, z0], b: [x1, z1], L, nx, nz, street, shared, ...bays, door: -1, open: [] });
    if (shared || !bays.bays || bays.bayW < 2.2) continue;
    // In its middle bay, as wide as the facade draws it, but a metre at least; else in the bay
    // nearest the middle whose outside is clear.
    const mid = Math.floor(bays.bays / 2);
    const order = [...Array(bays.bays).keys()].sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid) || p - q);
    for (const i of order) {
      const half = Math.max(0.5, ((DOOR.x1 - DOOR.x0) * bays.bayW) / 2);
      const s0 = bays.margin + (i + 0.5) * bays.bayW - half;
      const s1 = bays.margin + (i + 0.5) * bays.bayW + half;
      // Outside the door, either side of its middle: somewhere to stand, at one level.
      const ys: number[] = [];
      let clear = true;
      for (const s of [s0 + 0.25, (s0 + s1) / 2, s1 - 0.25]) {
        const x = x0 + ((x1 - x0) * s) / L + nx * 0.45;
        const z = z0 + ((z1 - z0) * s) / L + nz * 0.45;
        const fl = out.floor(x, z, b.y + 1.5);
        if (fl.buried) clear = false;
        ys.push(fl.y);
        if (out.blocked(x + nx * 0.2, z + nz * 0.2, fl.y)) clear = false;
      }
      if (!clear || Math.max(...ys) - Math.min(...ys) > 0.25) continue;
      cand.push({ k, i, s0, s1, y: Math.max(...ys), score: (street ? 100 : 0) + L - Math.abs(i - mid) });
      break;
    }
  }
  // The floor: at the best door's sill (a street's first), if that's at the building's foot or a
  // little over it; the doors, those whose sill is within a step of it: the best, then each time the
  // one furthest from those chosen, so a room is a way through (a back door); three at most in a big
  // one.
  cand.sort((p, q) => q.score - p.score);
  const best = cand.find((c) => c.y > b.y - 0.55 && c.y < b.y + 1.05);
  if (!best) return null;
  const y = best.y;
  const doorH = Math.min(G - 0.3, Math.max(2.05, DOOR.y1 * G));
  if (doorH < 1.95) return null;
  const doors: Room['doors'] = [];
  const midOf = (c: (typeof cand)[number]): XZ => {
    const sd = sides[c.k];
    const s = (c.s0 + c.s1) / 2;
    return [sd.a[0] + ((sd.b[0] - sd.a[0]) * s) / sd.L, sd.a[1] + ((sd.b[1] - sd.a[1]) * s) / sd.L];
  };
  const pool = cand.filter((q) => q !== best && Math.abs(q.y - y) <= STEP - 0.05);
  const chosen = [best];
  while (chosen.length < (area > 120 ? 3 : 2)) {
    let far: (typeof cand)[number] | null = null;
    let fd = 4;
    for (const q of pool) {
      if (chosen.includes(q)) continue;
      const m = midOf(q);
      const d = Math.min(...chosen.map((c) => Math.hypot(midOf(c)[0] - m[0], midOf(c)[1] - m[1])));
      if (d > fd) [far, fd] = [q, d];
    }
    if (!far) break;
    chosen.push(far);
  }
  for (const c of chosen) {
    const sd = sides[c.k];
    sd.door = c.i;
    // From well under the floors either side, so no sill stands in a walker's way.
    sd.open.push({ s0: c.s0, s1: c.s1, y0: Math.min(y, c.y) - 0.6, y1: y + doorH, door: true });
    const s = (c.s0 + c.s1) / 2;
    const x = sd.a[0] + ((sd.b[0] - sd.a[0]) * s) / sd.L;
    const z = sd.a[1] + ((sd.b[1] - sd.a[1]) * s) / sd.L;
    doors.push([{ x: x + sd.nx * 0.8, y: c.y, z: z + sd.nz * 0.8 }, { x: x - sd.nx * 0.8, y, z: z - sd.nz * 0.8 }]);
  }

  // The ground floor's windows, where the facade draws them, but where the ground outside stands over
  // their sills, or something stands right in front of them (a wall, another building).
  for (const sd of sides) {
    if (sd.shared || !sd.bays) continue;
    const kind = sd.street ? (f.ground === 'housing' ? f.type : f.ground) : homes && (f.ground === 'housing' || f.type === 'house' || f.type === 'old-house') ? f.type : 'plain';
    const pane = paneOf(kind, P);
    if (!pane) continue;
    for (let i = 0; i < sd.bays; i++) {
      if (i === sd.door) continue;
      const s0 = sd.margin + (i + pane.x0) * sd.bayW;
      const s1 = sd.margin + (i + pane.x1) * sd.bayW;
      const y0 = b.y + pane.y0 * G;
      const y1 = b.y + pane.y1 * G;
      if (y1 - y0 < 0.4 || s1 - s0 < 0.3 || y0 < y + 0.05) continue;
      const x = sd.a[0] + ((sd.b[0] - sd.a[0]) * (s0 + s1)) / 2 / sd.L + sd.nx * 0.4;
      const z = sd.a[1] + ((sd.b[1] - sd.a[1]) * (s0 + s1)) / 2 / sd.L + sd.nz * 0.4;
      if (out.floor(x, z, y1).y > y0 - 0.05 || out.blocked(x + sd.nx * 0.6, z + sd.nz * 0.6, y0)) continue;
      sd.open.push({ s0, s1, y0, y1, door: false });
    }
  }
  // The buildings that stand into it (the map's outlines overlap now and then): a corner of one in
  // its inside outline, or a wall of one across it. Their walls stand in the room.
  const intruders: XZ[][] = [];
  for (const o of world.buildings) {
    if (o === b || Math.abs(o.pts[0][0] - pts[0][0]) > 80 || Math.abs(o.pts[0][1] - pts[0][1]) > 80) continue;
    const op = o.pts as XZ[];
    if (!op.some(([x, z]) => x > box.x0 && x < box.x1 && z > box.z0 && z < box.z1) && !op.some(([x, z], k) => crossesBox(box, [x, z], op[(k + 1) % op.length]))) continue;
    const into = op.some(([x, z]) => inside(inner, x, z)) || op.some((p, k) => inner.some((q, j) => crosses(p, op[(k + 1) % op.length], q, inner[(j + 1) % inner.length])));
    if (into) intruders.push(op);
  }
  return { b, pts, inner, y, G, S, floors, levels: [y], ceiling: b.y + G, tower: false, sides, stair: null, parapet: [], doors, box, arena, axis: frameOf(inner).u, partitions: [], solids: [], zones: [], gaps: [], tone: 0, intruders };
}

// Makes a room a tower: every storey a floor, the roof one too, a stairwell up through them and a hut
// over it, its upper storeys' windows open and a parapet round its roof. False if no stairwell fits.
function tower(world: Braga, r: Room): boolean {
  const b = r.b;
  const P = world.facadeTypes[b.facade.type];
  const roof = b.y + b.h;
  const levels = [r.y];
  for (let j = 1; j < r.floors; j++) levels.push(b.y + r.G + (j - 1) * r.S);
  levels.push(roof);
  // Every flight as many risers as the highest storey's half needs.
  let m = 2;
  for (let i = 1; i < levels.length; i++) m = Math.max(m, Math.ceil((levels[i] - levels[i - 1]) / 2 / RISE));
  const Ls = ENTRY + (m - 1) * GOING + LANDING;
  const at = findStairwell(r, Ls, STAIR_W);
  if (!at) return false;
  const { o, u, v } = at;
  // A point of the stairwell, a along it and c across.
  const P2 = (aa: number, c: number): XZ => [o[0] + u[0] * aa + v[0] * c, o[1] + u[1] * aa + v[1] * c];
  const rect = (a0: number, a1: number, c0: number, c1: number): XZ[] => [P2(a0, c0), P2(a1, c0), P2(a1, c1), P2(a0, c1)];
  const steps: Step[] = [];
  const walls: Partition[] = [];
  const ways: { x: number; y: number; z: number }[][] = [];
  const pt = (aa: number, c: number, y: number) => {
    const [x, z] = P2(aa, c);
    return { x, y, z };
  };
  const turn = ENTRY + (m - 1) * GOING;
  for (let i = 0; i + 1 < levels.length; i++) {
    const L0 = levels[i];
    const L1 = levels[i + 1];
    const mid = (L0 + L1) / 2;
    const rise = (L1 - L0) / 2 / m;
    // Up the first flight, along it, to the landing; back up the second, beside it, to the next floor.
    for (let k = 1; k < m; k++) steps.push({ pts: rect(ENTRY + (k - 1) * GOING, ENTRY + k * GOING, 0, FLIGHT), y: L0 + k * rise });
    steps.push({ pts: rect(turn, Ls, 0, STAIR_W), y: mid });
    for (let k = 1; k < m; k++) steps.push({ pts: rect(ENTRY + (m - 1 - k) * GOING, ENTRY + (m - k) * GOING, FLIGHT + GAP, STAIR_W), y: mid + k * rise });
    // Between the flights, from this floor to a rail's height over the next.
    const [p0, p1] = [P2(ENTRY, FLIGHT + GAP / 2), P2(turn, FLIGHT + GAP / 2)];
    walls.push({ ax: p0[0], az: p0[1], bx: p1[0], bz: p1[1], y0: L0 - 0.1, y1: L1 + RAIL, open: false });
    ways.push([pt(ENTRY / 2, FLIGHT / 2, L0), pt(Ls - LANDING / 2, FLIGHT / 2, mid), pt(Ls - LANDING / 2, STAIR_W - FLIGHT / 2, mid), pt(ENTRY / 2, STAIR_W - FLIGHT / 2, L1)]);
  }
  // Round the well, its two long sides and its far end, from the ground floor to the roof: a stairwell
  // open only at each floor's end of it.
  for (const [a0, c0, a1, c1] of [[ENTRY, 0, Ls, 0], [Ls, 0, Ls, STAIR_W], [Ls, STAIR_W, ENTRY, STAIR_W]]) {
    const [p, q] = [P2(a0, c0), P2(a1, c1)];
    walls.push({ ax: p[0], az: p[1], bx: q[0], bz: q[1], y0: r.y - 0.1, y1: roof + RAIL, open: false });
  }
  // The hut on the roof over the whole well, its door at the near end over the second flight's top.
  const hut = rect(0, Ls, 0, STAIR_W);
  const dc0 = FLIGHT + GAP;
  for (let k = 0; k < 4; k++) {
    const p = hut[k];
    const q = hut[(k + 1) % 4];
    if (k === 3) {
      // The near end, from c = STAIR_W back to 0: its door from c = STAIR_W to dc0.
      const d = P2(0, dc0);
      walls.push({ ax: d[0], az: d[1], bx: q[0], bz: q[1], y0: roof - 0.1, y1: roof + HUT, open: false });
      walls.push({ ax: p[0], az: p[1], bx: d[0], bz: d[1], y0: roof + 2.1, y1: roof + HUT, open: false });
      continue;
    }
    walls.push({ ax: p[0], az: p[1], bx: q[0], bz: q[1], y0: roof - 0.1, y1: roof + HUT, open: false });
  }
  ways[ways.length - 1].push(pt(-0.7, (dc0 + STAIR_W) / 2, roof));
  r.stair = { pts: hut, hole: rect(ENTRY, Ls, 0, STAIR_W), steps, walls, hut: { pts: hut, y: roof, door: [dc0, STAIR_W] }, ways };
  r.tower = true;
  r.levels = levels;
  r.ceiling = roof;
  // The roof's parapet, round its inside face.
  for (let k = 0; k < r.inner.length; k++) {
    const p = r.inner[k];
    const q = r.inner[(k + 1) % r.inner.length];
    r.parapet.push({ ax: p[0], az: p[1], bx: q[0], bz: q[1], y0: roof - 0.3, y1: roof + PARAPET, open: false });
  }
  // The upper storeys' windows, every bay of every wall no building stands against.
  for (const sd of r.sides) {
    if (sd.shared || !sd.bays) continue;
    const pane = paneOf(b.facade.type, P);
    if (!pane) continue;
    for (let j = 1; j < r.floors; j++) {
      const base = b.y + r.G + (j - 1) * r.S;
      for (let i = 0; i < sd.bays; i++) {
        const s0 = sd.margin + (i + pane.x0) * sd.bayW;
        const s1 = sd.margin + (i + pane.x1) * sd.bayW;
        sd.open.push({ s0, s1, y0: base + pane.y0 * r.S, y1: base + pane.y1 * r.S, door: false });
      }
    }
  }
  return true;
}

// A stairwell's corner and its two ways (u along it, v across, into the room) where a rectangle Ls by
// W fits inside the room, as far from its middle as it can (against a wall, the floors left open);
// along the room's longest wall or across it.
function findStairwell(r: Room, Ls: number, W: number): { o: XZ; u: XZ; v: XZ } | null {
  const pts = r.inner;
  let longest = 0;
  let u: XZ = [1, 0];
  for (let k = 0; k < pts.length; k++) {
    const [ax, az] = pts[k];
    const [bx, bz] = pts[(k + 1) % pts.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (L > longest) {
      longest = L;
      u = [(bx - ax) / L, (bz - az) / L];
    }
  }
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let best: { o: XZ; u: XZ; v: XZ; d: number } | null = null;
  const { x0, z0, x1, z1 } = r.box;
  for (const dir of [u, [-u[1], u[0]] as XZ]) {
    for (const sgn of [1, -1]) {
      const uu: XZ = [dir[0] * sgn, dir[1] * sgn];
      const vv: XZ = [-uu[1], uu[0]];
      for (let x = x0; x <= x1; x += 0.5) {
        for (let z = z0; z <= z1; z += 0.5) {
          const corners: XZ[] = [[x, z], [x + uu[0] * Ls, z + uu[1] * Ls], [x + uu[0] * Ls + vv[0] * W, z + uu[1] * Ls + vv[1] * W], [x + vv[0] * W, z + vv[1] * W]];
          // In, a little clear of the walls, nothing of the outline crossing it; room to step in
          // beside its foot, and on the roof outside its hut's door.
          const mx0 = x + (uu[0] * Ls + vv[0] * W) / 2;
          const mz0 = z + (uu[1] * Ls + vv[1] * W) / 2;
          const shrunk = corners.map(([px, pz]) => [px + (mx0 - px) * 0.03, pz + (mz0 - pz) * 0.03] as XZ);
          if (!shrunk.every(([px, pz]) => inside(pts, px, pz)) || !edgesClear(pts, corners)) continue;
          const at = (a: number, c: number): XZ => [x + uu[0] * a + vv[0] * c, z + uu[1] * a + vv[1] * c];
          if (![at(-1.3, W * 0.75), at(-1.3, W * 0.25)].every(([px, pz]) => inside(pts, px, pz))) continue;
          if (![at(ENTRY / 2, -0.7), at(ENTRY / 2, W + 0.7)].some(([px, pz]) => inside(pts, px, pz))) continue;
          const d = Math.hypot(mx0 - cx, mz0 - cz);
          if (!best || d > best.d) best = { o: [x, z], u: uu, v: vv, d };
        }
      }
    }
  }
  return best;
}

// Whether the segment from a to b crosses a box's sides.
function crossesBox(b: { x0: number; z0: number; x1: number; z1: number }, a: XZ, c: XZ): boolean {
  const r: XZ[] = [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]];
  return r.some((p, k) => crosses(a, c, p, r[(k + 1) % 4]));
}

// Whether no edge of a ring crosses a rectangle's sides.
function edgesClear(ring: XZ[], rect: XZ[]): boolean {
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k];
    const q = ring[(k + 1) % ring.length];
    for (let j = 0; j < 4; j++) if (crosses(p, q, rect[j], rect[(j + 1) % 4])) return false;
  }
  return true;
}

function crosses([ax, az]: XZ, [bx, bz]: XZ, [cx, cz]: XZ, [dx, dz]: XZ): boolean {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}


// What a walker at height y stands on in a room at (x, z): the highest of its floors (not over the
// stairwell, but its ground floor), treads, landings and furniture's tops a step over y or under it;
// null under them all.
export function roomFloor(r: Room, x: number, z: number, y: number): number | null {
  let best: number | null = r.y <= y + STEP ? r.y : null;
  const well = r.stair && inside(r.stair.hole, x, z);
  for (let i = 1; i < r.levels.length; i++) {
    const L = r.levels[i];
    if (L <= y + STEP && (best === null || L > best) && !well) best = L;
  }
  if (r.stair && inside(r.stair.pts, x, z)) {
    for (const s of r.stair.steps) if (s.y <= y + STEP && (best === null || s.y > best) && inside(s.pts, x, z)) best = s.y;
  }
  for (const s of r.solids) if (s.y1 <= y + STEP && (best === null || s.y1 > best) && inside(s.pts, x, z)) best = s.y1;
  return best;
}

// Whether (x, y, z) in a room is in something solid, for a look: under its ground floor, in a piece
// of furniture, in a floor (or the ceiling over a room of one floor), or in a tread or a landing. (Its
// walls and partitions are walls, which a look meets as it meets any.)
export function roomSolid(r: Room, x: number, y: number, z: number): boolean {
  if (y < r.y) return true;
  for (const s of r.solids) if (y <= s.y1 && y >= s.y0 && inside(s.pts, x, z)) return true;
  if (!r.tower) return y >= r.ceiling && y <= r.ceiling + SLAB;
  const well = r.stair && inside(r.stair.hole, x, z);
  for (let i = 1; i < r.levels.length; i++) if (!well && y <= r.levels[i] && y >= r.levels[i] - SLAB) return true;
  if (r.stair && inside(r.stair.pts, x, z)) for (const s of r.stair.steps) if (y <= s.y && y >= s.y - 0.2 && inside(s.pts, x, z)) return true;
  return false;
}

// The walls a room stands, as the ground has them: each of the outline's walls at its middle, SKIN / 2
// in, SKIN / 2 thick each side, from below the building's foot to its top, but its openings; the
// stairwell's, the hut's and the parapet; its partitions, PART thick; and each piece of furniture's
// sides, from its foot to its top (which a walker can climb onto, where it's low enough to jump to).
export function roomWalls(r: Room): { ax: number; az: number; bx: number; bz: number; y0: number; y1: number; half?: number; open?: boolean }[] {
  const b = r.b;
  const Y0 = b.y - 2;
  const Y1 = b.y + Math.max(b.h, b.ridge);
  const out: ReturnType<typeof roomWalls> = [];
  for (const sd of r.sides) {
    const [x0, z0] = sd.a;
    const [x1, z1] = sd.b;
    if (sd.L < 0.01) continue;
    const ox = (-sd.nx * SKIN) / 2;
    const oz = (-sd.nz * SKIN) / 2;
    const at = (s: number): XZ => [x0 + ((x1 - x0) * s) / sd.L + ox, z0 + ((z1 - z0) * s) / sd.L + oz];
    // Cut along it at every opening's ends; in each stretch, what stands between the openings over it.
    const cuts = [...new Set([0, sd.L, ...sd.open.flatMap((o) => [o.s0, o.s1])])].sort((p, q) => p - q);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const s0 = cuts[k];
      const s1 = cuts[k + 1];
      if (s1 - s0 < 1e-3) continue;
      const over = sd.open.filter((o) => o.s0 <= s0 + 1e-6 && o.s1 >= s1 - 1e-6).sort((p, q) => p.y0 - q.y0);
      let y = Y0;
      const [p, q] = [at(s0), at(s1)];
      for (const o of over) {
        if (o.y0 > y) out.push({ ax: p[0], az: p[1], bx: q[0], bz: q[1], y0: y, y1: o.y0, half: SKIN / 2 });
        y = Math.max(y, o.y1);
      }
      if (y < Y1) out.push({ ax: p[0], az: p[1], bx: q[0], bz: q[1], y0: y, y1: Y1, half: SKIN / 2 });
    }
  }
  for (const w of [...(r.stair?.walls ?? []), ...r.parapet]) out.push({ ...w, open: w.open || undefined });
  for (const w of r.partitions) out.push({ ax: w.ax, az: w.az, bx: w.bx, bz: w.bz, y0: w.y0, y1: w.y1, half: PART / 2 });
  for (const s of r.solids) {
    for (let k = 0; k < s.pts.length; k++) {
      const p = s.pts[k];
      const q = s.pts[(k + 1) % s.pts.length];
      out.push({ ax: p[0], az: p[1], bx: q[0], bz: q[1], y0: s.y0, y1: s.y1 });
    }
  }
  return out;
}

// ---- Inside: the rooms a floor is split into, and what stands in them ----

// A partition's thickness; a doorway through one, its narrowest and widest, and its head's height; half
// the lane kept clear between the doors, the doorways and the stairs (a metre wide), and the squares
// the lanes are looked for on.
export const PART = 0.12;
const GAP0 = 1.25;
const GAP1 = 1.6;
export const HEAD = 2.2;
const LANE = 0.5;
const CELL = 0.2;
// How many colours the walls inside come in (render/interiors.ts has them).
export const TONES = 6;

// A room's frame: its middle, the way its longest inside wall runs (u, as findStairwell takes it) and
// across it (v, u turned a quarter to the left). A floor is laid out in it.
interface Frame {
  o: XZ;
  u: XZ;
  v: XZ;
}
function frameOf(inner: XZ[]): Frame {
  let longest = 0;
  let u: XZ = [1, 0];
  for (let k = 0; k < inner.length; k++) {
    const [ax, az] = inner[k];
    const [bx, bz] = inner[(k + 1) % inner.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (L > longest) {
      longest = L;
      u = [(bx - ax) / L, (bz - az) / L];
    }
  }
  const o: XZ = [inner.reduce((s, p) => s + p[0], 0) / inner.length, inner.reduce((s, p) => s + p[1], 0) / inner.length];
  return { o, u, v: [-u[1], u[0]] };
}
const toL = (f: Frame, [x, z]: XZ): XZ => [(x - f.o[0]) * f.u[0] + (z - f.o[1]) * f.u[1], (x - f.o[0]) * f.v[0] + (z - f.o[1]) * f.v[1]];
const toW = (f: Frame, [a, c]: XZ): XZ => [f.o[0] + f.u[0] * a + f.v[0] * c, f.o[1] + f.u[1] * a + f.v[1] * c];

// The building's own dice (mulberry32, seeded by its corners): the same rooms in every browser.
function dice(b: Building): () => number {
  let h = 2166136261;
  for (const [x, z] of b.pts) {
    for (const v of [Math.round(x * 100), Math.round(z * 100)]) {
      h ^= v;
      h = Math.imul(h, 16777619);
    }
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Seg = { a: XZ; b: XZ };
type Bay = { u0: number; u1: number; v0: number; v1: number };

// A floor being laid out, in its room's frame: its floor and the underside of what's over it (a roof's
// open sky), its inside outline; what stands round it and in it (the outline's inside faces and the
// stairwell's walls, the partitions and the lintels over their doorways); where nobody stands (over the
// flights, in the hut); where nothing may be put (a door's way in, a doorway's way through, the way to
// the stairs); the points that have to stay joined by a metre's lane (inside each door, either side
// of each doorway, at each flight's foot and top); its rooms; and its furniture.
interface Plan {
  r: Room;
  f: Frame;
  y: number;
  top: number;
  roof: boolean;
  poly: XZ[];
  walls: Seg[];
  parts: Seg[];
  lintels: Seg[];
  holes: XZ[][];
  keep: XZ[][];
  targets: XZ[];
  gaps: XZ[][];
  bays: Bay[];
  solids: Solid[];
  base: Uint8Array | null;
}

// What a room of each use is furnished with, in the order it's put in (the first, the most), and
// its floor.
const USES: Record<Use, { finish: Finish; things: Kind[] }> = {
  shop: { finish: 'tiles', things: ['shelf', 'bar', 'shelf', 'shelf', 'crate', 'shelf'] },
  cafe: { finish: 'wood', things: ['bar', 'table', 'table', 'fridge', 'table', 'crate'] },
  kitchen: { finish: 'tiles', things: ['counter', 'fridge', 'table', 'counter'] },
  living: { finish: 'wood', things: ['sofa', 'shelf', 'table', 'crate', 'sofa'] },
  bedroom: { finish: 'carpet', things: ['bed', 'wardrobe', 'desk', 'crate'] },
  store: { finish: 'concrete', things: ['bigcrate', 'shelf', 'bigcrate', 'crate', 'shelf', 'bigcrate', 'crate'] },
  office: { finish: 'carpet', things: ['desk', 'desk', 'shelf', 'desk', 'bigcrate', 'desk'] },
  roof: { finish: 'concrete', things: ['unit', 'unit', 'bigcrate', 'unit'] },
};

// Each piece of furniture: how long its back is (from, to), how deep it is (0: as long), how high,
// and whether it stands against a wall (or either). A crate's top (60 cm) is a jump up, a big one's
// (1 m) and a bar's (1.05 m) a jump with the legs tucked up (walker.ts); a shelf, a wardrobe and a
// fridge stand over a crouching head, and a standing one.
type Kind = 'crate' | 'bigcrate' | 'shelf' | 'wardrobe' | 'counter' | 'bar' | 'table' | 'desk' | 'sofa' | 'bed' | 'fridge' | 'unit';
const SPECS: Record<Kind, { w: [number, number]; d: number; h: number; wall: boolean | 'any' }> = {
  crate: { w: [0.75, 0.85], d: 0, h: 0.6, wall: 'any' },
  bigcrate: { w: [1.05, 1.15], d: 0, h: 1.0, wall: 'any' },
  shelf: { w: [1.4, 2.2], d: 0.5, h: 1.9, wall: 'any' },
  wardrobe: { w: [1.0, 1.6], d: 0.6, h: 2.0, wall: true },
  counter: { w: [1.6, 2.6], d: 0.62, h: 0.92, wall: true },
  bar: { w: [2.0, 3.0], d: 0.6, h: 1.05, wall: false },
  table: { w: [1.2, 1.8], d: 0.85, h: 0.76, wall: false },
  desk: { w: [1.3, 1.6], d: 0.75, h: 0.76, wall: 'any' },
  sofa: { w: [1.8, 2.2], d: 0.9, h: 0.85, wall: true },
  bed: { w: [1.4, 1.6], d: 2.0, h: 0.95, wall: true },
  fridge: { w: [0.7, 0.75], d: 0.7, h: 1.85, wall: true },
  unit: { w: [1.3, 1.6], d: 0.9, h: 1.0, wall: false },
};

// Lays out every floor of a room: its partitions and their doorways, its rooms and what's in them.
function fit(r: Room): void {
  const f = frameOf(r.inner);
  const rand = dice(r.b);
  r.tone = Math.floor(rand() * TONES);
  const n = r.tower ? r.levels.length : 1;
  const ground = r.b.facade.ground;
  for (let i = 0; i < n; i++) {
    const roof = r.tower && i === n - 1;
    const top = roof ? Infinity : r.tower ? r.levels[i + 1] - SLAB : r.ceiling;
    const p = plan(r, f, i, top, roof);
    let uses: Use[];
    if (roof) uses = ['roof'];
    else if (i === 0) {
      if (ground === 'shops' || ground === 'glazed' || ground === 'arcade') uses = [rand() < 0.5 ? 'shop' : 'cafe', 'store', 'kitchen', 'office'];
      else if (ground === 'housing') uses = ['living', 'kitchen', 'bedroom', 'store'];
      else uses = ['store', 'office', 'store', 'kitchen'];
    } else {
      const k = Math.floor(rand() * 3);
      uses = k === 0 ? ['office', 'office', 'store', 'kitchen'] : k === 1 ? ['living', 'kitchen', 'bedroom', 'bedroom'] : ['store', 'office', 'store', 'store'];
    }
    if (!roof) split(p, rand);
    else p.bays = [boundsOf(p.poly)];
    // The rooms, the one nearest the way in (the first door, the stairs) first.
    const t0 = p.targets[0] ?? [0, 0];
    const mid = (b: Bay) => Math.hypot((b.u0 + b.u1) / 2 - t0[0], (b.v0 + b.v1) / 2 - t0[1]);
    p.bays.sort((a, b) => mid(a) - mid(b));
    p.bays.forEach((bay, k) => {
      const use = uses[k % uses.length];
      const zone = clipRect(p.poly, bay);
      const area = Math.abs(areaOf(zone));
      if (area < 0.5) return;
      if (!roof) r.zones.push({ pts: zone.map((q) => toW(f, q)), y: p.y, top, use, finish: USES[use].finish });
      const things = USES[use].things;
      const many = roof ? Math.max(2, Math.min(4, Math.round(area / 25))) : area < 8 ? 1 : Math.min(things.length, Math.max(1, Math.round(area / 6)));
      for (let j = 0; j < many; j++) put(p, bay, things[j], rand);
    });
    // Into the world's frame.
    const W = (s: Seg) => [toW(f, s.a), toW(f, s.b)];
    for (const s of p.parts) {
      const [a, b] = W(s);
      r.partitions.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], y0: p.y - 0.05, y1: top, open: false });
    }
    for (const s of p.lintels) {
      const [a, b] = W(s);
      if (top - (p.y + HEAD) > 0.05) r.partitions.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], y0: p.y + HEAD, y1: top, open: false });
    }
    for (const s of p.solids) r.solids.push({ ...s, pts: s.pts.map((q) => toW(f, q)) });
    for (const g of p.gaps) r.gaps.push(g.map((q) => ({ x: toW(f, q)[0], y: p.y, z: toW(f, q)[1] })));
  }
}

// A floor's plan before anything's put on it: its outline in the frame, what stands round it, where
// nobody stands and nothing goes, and the points to keep joined (those the outline alone leaves joined).
function plan(r: Room, f: Frame, i: number, top: number, roof: boolean): Plan {
  const y = r.levels[i];
  const poly = r.inner.map((q) => toL(f, q));
  const p: Plan = { r, f, y, top, roof, poly, walls: poly.map((a, k) => ({ a, b: poly[(k + 1) % poly.length] })), parts: [], lintels: [], holes: [], keep: [], targets: [], gaps: [], bays: [], solids: [], base: null };
  const L = (q: XZ) => toL(f, q);
  if (i === 0) {
    // Each door's way in: a little wider than it, 2 m in from the facade.
    for (const sd of r.sides) {
      for (const o of sd.open) {
        if (!o.door) continue;
        const at = (s: number, d: number): XZ => [sd.a[0] + ((sd.b[0] - sd.a[0]) * s) / sd.L - sd.nx * d, sd.a[1] + ((sd.b[1] - sd.a[1]) * s) / sd.L - sd.nz * d];
        p.keep.push([at(o.s0 - 0.35, -0.1), at(o.s1 + 0.35, -0.1), at(o.s1 + 0.35, 2), at(o.s0 - 0.35, 2)].map(L));
      }
    }
    for (const [, inner] of r.doors) p.targets.push(L([inner.x, inner.z]));
  }
  // Where another building stands into the room: cut down to round it, as nobody's there.
  const B = boundsOf(poly);
  for (const o of r.intruders) {
    const q = clipRect(o.map(L), { u0: B.u0 - 0.5, u1: B.u1 + 0.5, v0: B.v0 - 0.5, v1: B.v1 + 0.5 });
    if (q.length < 3) continue;
    p.holes.push(q);
    for (let k = 0; k < q.length; k++) p.walls.push({ a: q[k], b: q[(k + 1) % q.length] });
  }
  const st = r.stair;
  if (st) {
    // The stairwell in its own frame: along the flights from its open end (a), and across (c).
    const [h0, h1, , h3] = st.pts;
    const Ls = Math.hypot(h1[0] - h0[0], h1[1] - h0[1]);
    const W = Math.hypot(h3[0] - h0[0], h3[1] - h0[1]);
    const E = (a: number, c: number): XZ => L([h0[0] + ((h1[0] - h0[0]) * a) / Ls + ((h3[0] - h0[0]) * c) / W, h0[1] + ((h1[1] - h0[1]) * a) / Ls + ((h3[1] - h0[1]) * c) / W]);
    for (const w of st.walls) if (w.y0 < y + 1.2 && w.y1 > y + 0.2) p.walls.push({ a: L([w.ax, w.az]), b: L([w.bx, w.bz]) });
    if (roof) {
      p.holes.push([E(0, 0), E(Ls, 0), E(Ls, W), E(0, W)]);
      p.keep.push([E(-2.2, -0.8), E(Ls + 0.8, -0.8), E(Ls + 0.8, W + 0.8), E(-2.2, W + 0.8)]);
      const w = st.ways[st.ways.length - 1];
      p.targets.push(L([w[w.length - 1].x, w[w.length - 1].z]));
    } else {
      p.holes.push(st.hole.map(L));
      p.keep.push([E(-1.8, -0.9), E(Ls + 0.3, -0.9), E(Ls + 0.3, W + 0.9), E(-1.8, W + 0.9)]);
      if (i < st.ways.length) p.targets.push(L([st.ways[i][0].x, st.ways[i][0].z]));
      if (i >= 1) p.targets.push(L([st.ways[i - 1][3].x, st.ways[i - 1][3].z]));
    }
  }
  // Only the points the outline itself leaves a lane between.
  p.targets = joined(p, p.targets);
  return p;
}

// The partitions: across the floor's long way, one to three as it's big (a room 3.3 m deep at least),
// each with a doorway in every piece of it; and along the biggest room they leave, if it's wide, one
// more. None crosses a door's way, the stairs' or an opening in the outline's walls, and a floor
// keeps its lanes.
function split(p: Plan, rand: () => number): void {
  const B = boundsOf(p.poly);
  const area = Math.abs(areaOf(p.poly));
  let n = area < 40 ? 0 : area < 100 ? 1 : area < 240 ? 2 : 3;
  n = Math.min(n, Math.floor((B.u1 - B.u0) / 3.3) - 1);
  const cuts: { u: number; gaps: [number, number][] }[] = [];
  for (let k = 0; k < n; k++) {
    const base = B.u0 + ((k + 1) * (B.u1 - B.u0)) / (n + 1) + (rand() - 0.5) * 0.8;
    for (const off of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6]) {
      const u = base + off;
      if (u - (cuts.length ? cuts[cuts.length - 1].u : B.u0) < 3 || B.u1 - u < 2.8) continue;
      const gaps = partition(p, 0, u, -Infinity, Infinity, rand);
      if (gaps) {
        cuts.push({ u, gaps });
        break;
      }
    }
  }
  const us = [B.u0, ...cuts.map((c) => c.u), B.u1];
  p.bays = us.slice(1).map((u1, k) => ({ u0: us[k], u1, v0: B.v0, v1: B.v1 }));
  // Along the biggest, if it's 4.2 m deep and 7 m wide: a partition from one to the other (clear of
  // their doorways), its own doorway in it.
  const big = p.bays.reduce((a, b) => ((b.u1 - b.u0) * (b.v1 - b.v0) > (a.u1 - a.u0) * (a.v1 - a.v0) ? b : a));
  if (big.u1 - big.u0 < 4.2 || big.v1 - big.v0 < 7 || rand() < 0.15) return;
  const ends = cuts.filter((c) => Math.abs(c.u - big.u0) < 1e-6 || Math.abs(c.u - big.u1) < 1e-6);
  const v0 = (big.v0 + big.v1) / 2 + (rand() - 0.5) * 0.8;
  for (const off of [0, 0.6, -0.6, 1.2, -1.2]) {
    const v = v0 + off;
    if (v - big.v0 < 3 || big.v1 - v < 3) continue;
    if (ends.some((c) => c.gaps.some(([g0, g1]) => v > g0 - 0.5 && v < g1 + 0.5))) continue;
    if (!partition(p, 1, v, big.u0 + PART / 2, big.u1 - PART / 2, rand)) continue;
    const i = p.bays.indexOf(big);
    p.bays.splice(i, 1, { ...big, v1: v }, { ...big, v0: v });
    return;
  }
}

// A partition along the line where the frame's coordinate `axis` is `at`, between lo and hi along it:
// each piece of the line inside the floor 2.6 m long or more, with a doorway in it, 1.2 to 1.6 m wide,
// near one end or anywhere; the doorways' ends (from and to along the line), or null where it can't
// stand (it would cross a door's way, the stairs or an opening, or cut a lane).
function partition(p: Plan, axis: 0 | 1, at: number, lo: number, hi: number, rand: () => number): [number, number][] | null {
  const pt = (s: number, d = 0): XZ => (axis === 0 ? [at + d, s] : [s, at + d]);
  const spans = across(p.poly, axis, at)
    .map(([s0, s1]) => [Math.max(s0, lo), Math.min(s1, hi)] as [number, number])
    .filter(([s0, s1]) => s1 - s0 >= 2.6);
  if (!spans.length) return null;
  const was = { parts: p.parts.length, lintels: p.lintels.length, keep: p.keep.length, targets: p.targets.length, gaps: p.gaps.length };
  const undo = () => {
    p.parts.length = was.parts;
    p.lintels.length = was.lintels;
    p.keep.length = was.keep;
    p.targets.length = was.targets;
    p.gaps.length = was.gaps;
    return null;
  };
  const out: [number, number][] = [];
  for (const [s0, s1] of spans) {
    const slab = thick(pt(s0), pt(s1), PART / 2 + 0.1);
    if ([...p.keep, ...p.holes].some((k) => !apart(slab, k, 0))) return undo();
    // Its ends where they meet the outline: not at an opening in the outline's walls.
    for (const s of [s0, s1]) if ((s === s0 ? s0 > lo : s1 < hi) && atOpening(p, pt(s))) return undo();
    const S = s1 - s0;
    const w = Math.min(GAP0 + rand() * (GAP1 - GAP0), S - 1.2);
    const k = rand();
    const c = k < 0.35 ? s0 + 0.6 + w / 2 : k < 0.7 ? s1 - 0.6 - w / 2 : s0 + 0.6 + w / 2 + rand() * (S - 1.2 - w);
    p.parts.push({ a: pt(s0), b: pt(c - w / 2) }, { a: pt(c + w / 2), b: pt(s1) });
    p.lintels.push({ a: pt(c - w / 2), b: pt(c + w / 2) });
    p.keep.push([pt(c - w / 2 - 0.25, -1.3), pt(c + w / 2 + 0.25, -1.3), pt(c + w / 2 + 0.25, 1.3), pt(c - w / 2 - 0.25, 1.3)]);
    p.targets.push(pt(c, -0.75), pt(c, 0.75));
    p.gaps.push([pt(c, -0.75), pt(c, 0.75)]);
    out.push([c - w / 2, c + w / 2]);
  }
  if (!lanes(p)) return undo();
  return out;
}

// Puts a piece of furniture in a room of a floor, where it fits: against a wall (its back to the
// nearest wall a way from a point in the room), or standing free, clear of the walls; tried 40 times.
function put(p: Plan, bay: Bay, kind: Kind, rand: () => number): boolean {
  const spec = SPECS[kind];
  for (let t = 0; t < 40; t++) {
    const w = spec.w[0] + rand() * (spec.w[1] - spec.w[0]);
    const d = spec.d || w;
    const c: XZ = [bay.u0 + 0.3 + rand() * Math.max(0, bay.u1 - bay.u0 - 0.6), bay.v0 + 0.3 + rand() * Math.max(0, bay.v1 - bay.v0 - 0.6)];
    const wall = spec.wall === 'any' ? rand() < 0.6 : spec.wall;
    let pts: XZ[];
    if (wall) {
      const a = Math.floor(rand() * 4) * (Math.PI / 2);
      const hit = ray(p, c, [Math.cos(a), Math.sin(a)]);
      if (!hit || hit.t > Math.max(bay.u1 - bay.u0, bay.v1 - bay.v0)) continue;
      const L = Math.hypot(hit.b[0] - hit.a[0], hit.b[1] - hit.a[1]);
      const e: XZ = [(hit.b[0] - hit.a[0]) / L, (hit.b[1] - hit.a[1]) / L];
      let nn: XZ = [-e[1], e[0]];
      if ((c[0] - hit.p[0]) * nn[0] + (c[1] - hit.p[1]) * nn[1] < 0) nn = [-nn[0], -nn[1]];
      const off = 0.02 + (hit.part ? PART / 2 : 0);
      // Along the wall from where the way met it, by up to a metre.
      const slide = (rand() - 0.5) * 2;
      pts = rect([hit.p[0] + nn[0] * off + e[0] * slide, hit.p[1] + nn[1] * off + e[1] * slide], e, nn, w, d);
    } else {
      // Square to the room, or a crate a little askew.
      const a = kind === 'crate' || kind === 'bigcrate' ? (rand() - 0.5) * 0.7 : rand() < 0.5 ? 0 : Math.PI / 2;
      const e: XZ = [Math.cos(a), Math.sin(a)];
      const nn: XZ = [-e[1], e[0]];
      pts = rect([c[0] - (nn[0] * d) / 2, c[1] - (nn[1] * d) / 2], e, nn, w, d);
    }
    const made = make(kind, pts, p.y, spec.h, rand);
    if (!fits(p, pts, wall, Math.max(...made.map((s) => s.y1)))) continue;
    p.solids.push(...made);
    if (lanes(p)) return true;
    p.solids.length -= made.length;
  }
  return false;
}

// A piece of furniture's boxes, over its outline from height y: a sofa's seat and back, a bed and its
// headboard, a big crate and now and then a small one on it, askew; anything else one box.
function make(kind: Kind, pts: XZ[], y: number, h: number, rand: () => number): Solid[] {
  // Its outline from d0 to d1 of the way from its back to its front.
  const part = (d0: number, d1: number): XZ[] => {
    const at = (a: XZ, b: XZ, t: number): XZ => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return [at(pts[0], pts[3], d0), at(pts[1], pts[2], d0), at(pts[1], pts[2], d1), at(pts[0], pts[3], d1)];
  };
  const d = Math.hypot(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1]);
  switch (kind) {
    case 'sofa':
      return [{ pts, y0: y, y1: y + 0.45, kind: 'sofa' }, { pts: part(0, 0.25 / d), y0: y + 0.45, y1: y + h, kind: 'sofa-back' }];
    case 'bed':
      return [{ pts, y0: y, y1: y + 0.5, kind: 'bed' }, { pts: part(0, 0.08 / d), y0: y + 0.5, y1: y + h, kind: 'headboard' }];
    case 'bigcrate': {
      const out: Solid[] = [{ pts, y0: y, y1: y + h, kind: 'crate' }];
      if (rand() < 0.5) {
        const cx = pts.reduce((s, q) => s + q[0], 0) / 4 + (rand() - 0.5) * 0.15;
        const cz = pts.reduce((s, q) => s + q[1], 0) / 4 + (rand() - 0.5) * 0.15;
        const a = Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]) + (rand() - 0.5) * 0.8;
        const e: XZ = [Math.cos(a), Math.sin(a)];
        const nn: XZ = [-e[1], e[0]];
        out.push({ pts: rect([cx - nn[0] * 0.35, cz - nn[1] * 0.35], e, nn, 0.7, 0.7), y0: y + h, y1: y + h + 0.6, kind: 'crate' });
      }
      return out;
    }
    default:
      return [{ pts, y0: y, y1: y + h, kind }];
  }
}

// Whether a piece of furniture fits where it's put: inside the floor (clear of its walls, but against
// one where it stands at one), clear of the ways in and through and of where nobody stands, of the
// rest of the furniture and of the partitions; and not across a door or in front of a window it would
// stand higher than the middle of.
function fits(p: Plan, pts: XZ[], wall: boolean, top: number): boolean {
  for (const q of pts) if (!inside(p.poly, q[0], q[1])) return false;
  for (let k = 0; k < 4; k++) for (const w of p.walls) if (crosses(pts[k], pts[(k + 1) % 4], w.a, w.b)) return false;
  const clear = wall ? 0 : p.roof ? 1.3 : 0.8;
  if (clear > 0) {
    for (const w of p.walls) {
      for (const q of pts) if (segDist(q, w.a, w.b) < clear) return false;
      if (!apart(pts, [w.a, w.b], clear)) return false;
    }
  }
  for (const k of [...p.keep, ...p.holes]) if (!apart(pts, k, 0.02)) return false;
  for (const s of p.solids) if (!apart(pts, s.pts, 0.1)) return false;
  for (const w of p.parts) if (!apart(pts, thick(w.a, w.b, PART / 2), 0.01)) return false;
  // The openings in the outline's walls it's near.
  const r = p.r;
  for (let k = 0; k < p.poly.length; k++) {
    const a = p.poly[k];
    const b = p.poly[(k + 1) % p.poly.length];
    if (Math.min(...pts.map((q) => segDist(q, a, b))) > 0.6) continue;
    const sd = r.sides[k];
    if (!sd || sd.L < 0.01) continue;
    const ss = pts.map((q) => {
      const [x, z] = toW(p.f, q);
      return ((x - sd.a[0]) * (sd.b[0] - sd.a[0]) + (z - sd.a[1]) * (sd.b[1] - sd.a[1])) / sd.L;
    });
    const s0 = Math.min(...ss);
    const s1 = Math.max(...ss);
    for (const o of sd.open) {
      if (o.y0 >= p.top || o.y1 <= p.y) continue;
      if (o.door ? s1 > o.s0 - 0.3 && s0 < o.s1 + 0.3 : s1 > o.s0 - 0.1 && s0 < o.s1 + 0.1 && top > (o.y0 + o.y1) / 2 - 0.15) return false;
    }
  }
  return true;
}

// Whether a point of the outline (a partition's end) is at an opening in its wall.
function atOpening(p: Plan, q: XZ): boolean {
  for (let k = 0; k < p.poly.length; k++) {
    const a = p.poly[k];
    const b = p.poly[(k + 1) % p.poly.length];
    if (segDist(q, a, b) > 0.05) continue;
    const sd = p.r.sides[k];
    if (!sd || sd.L < 0.01) continue;
    const [x, z] = toW(p.f, q);
    const s = ((x - sd.a[0]) * (sd.b[0] - sd.a[0]) + (z - sd.a[1]) * (sd.b[1] - sd.a[1])) / sd.L;
    if (sd.open.some((o) => o.y0 < p.top && o.y1 > p.y && s > o.s0 - 0.25 && s < o.s1 + 0.25)) return true;
  }
  return false;
}

// Whether every point to keep joined still is, by a lane a metre wide: on squares of CELL, those a
// walker's half-metre round them leaves clear of the walls, the partitions, the furniture and where
// nobody stands.
function lanes(p: Plan): boolean {
  if (p.targets.length < 2) return true;
  const g = grid(p);
  const m = g.base.slice();
  for (const w of p.parts) mark(g, m, (q) => segDist(q, w.a, w.b) <= LANE + PART / 2, w.a, w.b, LANE + PART / 2);
  for (const s of p.solids) mark(g, m, (q) => inside(s.pts, q[0], q[1]) || ringDist(s.pts, q) <= LANE, ...corners(s.pts), LANE);
  const reached = flood(g, m, p.targets[0], p.targets.slice(1));
  return !!reached && p.targets.every((t) => reached(t));
}

// The targets the floor's outline alone leaves joined to the first that has room round it.
function joined(p: Plan, targets: XZ[]): XZ[] {
  if (targets.length < 2) return targets;
  const g = grid(p);
  for (const t of targets) {
    const reached = flood(g, g.base, t);
    if (reached) return targets.filter((q) => reached(q));
  }
  return [];
}

type Grid = { x0: number; z0: number; nx: number; nz: number; base: Uint8Array };

// The squares over a floor, those a walker's middle can't be at marked: outside it, within a lane's
// half of its walls (and the stairwell's), and where nobody stands. Made once a floor.
function grid(p: Plan): Grid {
  if (p.base) {
    const B = boundsOf(p.poly);
    return { x0: B.u0 - CELL, z0: B.v0 - CELL, nx: Math.ceil((B.u1 - B.u0) / CELL) + 3, nz: Math.ceil((B.v1 - B.v0) / CELL) + 3, base: p.base };
  }
  const B = boundsOf(p.poly);
  const g: Grid = { x0: B.u0 - CELL, z0: B.v0 - CELL, nx: Math.ceil((B.u1 - B.u0) / CELL) + 3, nz: Math.ceil((B.v1 - B.v0) / CELL) + 3, base: new Uint8Array(0) };
  const m = new Uint8Array(g.nx * g.nz);
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) if (!inside(p.poly, g.x0 + (i + 0.5) * CELL, g.z0 + (j + 0.5) * CELL)) m[j * g.nx + i] = 1;
  for (const w of p.walls) mark(g, m, (q) => segDist(q, w.a, w.b) <= LANE, w.a, w.b, LANE);
  for (const h of p.holes) mark(g, m, (q) => inside(h, q[0], q[1]) || ringDist(h, q) <= LANE, ...corners(h), LANE);
  p.base = m;
  g.base = m;
  return g;
}

// The bounding corners of some points, for mark().
const corners = (pts: XZ[]): [XZ, XZ] => [
  [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1]))],
  [Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))],
];

// Marks the squares from a to b (their box, R round it) where `hit` holds.
function mark(g: Grid, m: Uint8Array, hit: (q: XZ) => boolean, a: XZ, b: XZ, R: number): void {
  const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - R - g.x0) / CELL));
  const i1 = Math.min(g.nx - 1, Math.ceil((Math.max(a[0], b[0]) + R - g.x0) / CELL));
  const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - R - g.z0) / CELL));
  const j1 = Math.min(g.nz - 1, Math.ceil((Math.max(a[1], b[1]) + R - g.z0) / CELL));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!m[j * g.nx + i] && hit([g.x0 + (i + 0.5) * CELL, g.z0 + (j + 0.5) * CELL])) m[j * g.nx + i] = 1;
}

// The squares joined to the clear one nearest t (within 60 cm), as a test of whether a point is among
// them (its nearest clear square, within the same); null where t has no clear square near it.
function flood(g: Grid, m: Uint8Array, t: XZ, until: XZ[] = []): ((q: XZ) => boolean) | null {
  const near = (q: XZ): number => {
    const ci = Math.floor((q[0] - g.x0) / CELL);
    const cj = Math.floor((q[1] - g.z0) / CELL);
    let best = -1;
    let bd = 0.6;
    for (let j = cj - 4; j <= cj + 4; j++) {
      for (let i = ci - 4; i <= ci + 4; i++) {
        if (i < 0 || j < 0 || i >= g.nx || j >= g.nz || m[j * g.nx + i]) continue;
        const d = Math.hypot(g.x0 + (i + 0.5) * CELL - q[0], g.z0 + (j + 0.5) * CELL - q[1]);
        if (d < bd) [best, bd] = [j * g.nx + i, d];
      }
    }
    return best;
  };
  const s = near(t);
  if (s < 0) return null;
  // Done as soon as every square of `until` is reached, if they're given.
  const goals = until.map(near);
  if (goals.some((k) => k < 0)) return () => false;
  let left = goals.length ? new Set(goals.filter((k) => k !== s)).size : -1;
  const goal = new Uint8Array(m.length);
  for (const k of goals) goal[k] = 1;
  const seen = new Uint8Array(m.length);
  const queue = new Int32Array(m.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = s;
  seen[s] = 1;
  while (head < tail && left !== 0) {
    const k = queue[head++];
    const i = k % g.nx;
    for (const n of [i > 0 ? k - 1 : -1, i < g.nx - 1 ? k + 1 : -1, k - g.nx, k + g.nx]) {
      if (n < 0 || n >= m.length || seen[n] || m[n]) continue;
      seen[n] = 1;
      queue[tail++] = n;
      if (goal[n]) left--;
    }
  }
  return (q) => {
    const k = near(q);
    return k >= 0 && seen[k] === 1;
  };
}

// The nearest wall or partition a way d (a unit vector) from o meets: how far, where, its ends, and
// whether it's a partition.
function ray(p: Plan, o: XZ, d: XZ): { t: number; p: XZ; a: XZ; b: XZ; part: boolean } | null {
  let best: { t: number; p: XZ; a: XZ; b: XZ; part: boolean } | null = null;
  for (const [segs, part] of [[p.walls, false], [p.parts, true]] as [Seg[], boolean][]) {
    for (const w of segs) {
      const ex = w.b[0] - w.a[0];
      const ez = w.b[1] - w.a[1];
      const den = d[0] * ez - d[1] * ex;
      if (Math.abs(den) < 1e-9) continue;
      const qx = w.a[0] - o[0];
      const qz = w.a[1] - o[1];
      const t = (qx * ez - qz * ex) / den;
      const s = (qx * d[1] - qz * d[0]) / den;
      if (t <= 0 || s < 0 || s > 1 || (best && t >= best.t)) continue;
      best = { t, p: [o[0] + d[0] * t, o[1] + d[1] * t], a: w.a, b: w.b, part };
    }
  }
  return best;
}

// A rectangle w along e from its back's middle c, d deep the way n: its back's two corners first.
const rect = (c: XZ, e: XZ, n: XZ, w: number, d: number): XZ[] => [
  [c[0] - (e[0] * w) / 2, c[1] - (e[1] * w) / 2],
  [c[0] + (e[0] * w) / 2, c[1] + (e[1] * w) / 2],
  [c[0] + (e[0] * w) / 2 + n[0] * d, c[1] + (e[1] * w) / 2 + n[1] * d],
  [c[0] - (e[0] * w) / 2 + n[0] * d, c[1] - (e[1] * w) / 2 + n[1] * d],
];

// A segment as a rectangle, h out either side of it.
function thick(a: XZ, b: XZ, h: number): XZ[] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const n: XZ = [(-(b[1] - a[1]) / L) * h, ((b[0] - a[0]) / L) * h];
  return [[a[0] - n[0], a[1] - n[1]], [b[0] - n[0], b[1] - n[1]], [b[0] + n[0], b[1] + n[1]], [a[0] + n[0], a[1] + n[1]]];
}

// Whether two convex outlines (or a segment, as two points) stand at least `gap` apart along some
// way (the separating axes): apart, and by that much.
function apart(A: XZ[], B: XZ[], gap: number): boolean {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      const b = P[(i + 1) % P.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-9) continue;
      const nx = (b[1] - a[1]) / L;
      const nz = -(b[0] - a[0]) / L;
      let a0 = Infinity;
      let a1 = -Infinity;
      let b0 = Infinity;
      let b1 = -Infinity;
      for (const q of A) {
        const d = q[0] * nx + q[1] * nz;
        a0 = Math.min(a0, d);
        a1 = Math.max(a1, d);
      }
      for (const q of B) {
        const d = q[0] * nx + q[1] * nz;
        b0 = Math.min(b0, d);
        b1 = Math.max(b1, d);
      }
      if (b0 - a1 >= gap || a0 - b1 >= gap) return true;
    }
  }
  return false;
}

function segDist(q: XZ, a: XZ, b: XZ): number {
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const L2 = ex * ex + ez * ez;
  const t = L2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ez) / L2)) : 0;
  return Math.hypot(q[0] - a[0] - ex * t, q[1] - a[1] - ez * t);
}

function ringDist(r: XZ[], q: XZ): number {
  let d = Infinity;
  for (let k = 0; k < r.length; k++) d = Math.min(d, segDist(q, r[k], r[(k + 1) % r.length]));
  return d;
}

// The box round a floor's outline, in its frame.
function boundsOf(poly: XZ[]): Bay {
  return { u0: Math.min(...poly.map((q) => q[0])), u1: Math.max(...poly.map((q) => q[0])), v0: Math.min(...poly.map((q) => q[1])), v1: Math.max(...poly.map((q) => q[1])) };
}

// Where the line on which the coordinate `axis` is `at` runs inside a ring: each piece, from and to
// along it.
function across(ring: XZ[], axis: 0 | 1, at: number): [number, number][] {
  const o = 1 - axis;
  const xs: number[] = [];
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % ring.length];
    if (a[axis] > at !== b[axis] > at) xs.push(a[o] + ((at - a[axis]) / (b[axis] - a[axis])) * (b[o] - a[o]));
  }
  xs.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}

// A ring cut down to a box (Sutherland-Hodgman, a side of the box at a time).
function clipRect(ring: XZ[], b: Bay): XZ[] {
  let out = ring;
  const cuts: [0 | 1, number, number][] = [[0, b.u0, 1], [0, b.u1, -1], [1, b.v0, 1], [1, b.v1, -1]];
  for (const [axis, at, sgn] of cuts) {
    const next: XZ[] = [];
    for (let k = 0; k < out.length; k++) {
      const p = out[k];
      const q = out[(k + 1) % out.length];
      const kp = (p[axis] - at) * sgn;
      const kq = (q[axis] - at) * sgn;
      if (kp >= 0) next.push(p);
      if (kp >= 0 !== kq >= 0) {
        const t = kp / (kp - kq);
        next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    out = next;
    if (out.length < 3) return [];
  }
  return out;
}
