// The insides of the arenas' buildings (braga-map's task 079, the owner's answer of 2026-10-20: very
// simple, a ground floor in most, every floor and the roof in one or two of the tallest). Made up, as
// the map knows nothing of what's inside: each building wholly in an arena whose ground floor a door
// can open onto the street at its level gets one room on its ground floor, its doors and windows open
// where its facade draws them (storeys.ts's bays; render/facades.ts's door and windows), and in two of
// the arenas the tallest flat-roofed block gets a stairwell from its ground floor to its roof, each
// storey one open floor, its windows open, a parapet round its roof and a hut over the stairs.
//
// The ground takes it as walls and floors (ground.ts: the outline's walls with their openings, a
// room's floor over the land), a look and a shot through the openings (sight.ts), and the city draws it
// (city.ts cuts the walls' openings; render/interiors.ts draws the inside). Pure, so the tests walk it.
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
const TOWERS = new Set(['topo', 'vilaca']);

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
function inset(r: XZ[], d: number): XZ[] | null {
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
  const cand: { k: number; s0: number; s1: number; y: number; score: number }[] = [];
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
    // In its middle bay, as wide as the facade draws it, but a metre at least.
    const i = Math.floor(bays.bays / 2);
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
    cand.push({ k, s0, s1, y: Math.max(...ys), score: (street ? 100 : 0) + L });
  }
  // The floor: at the best door's sill (a street's first), if that's at the building's foot or a
  // little over it; the doors, those whose sill is within a step of it, two at most.
  cand.sort((p, q) => q.score - p.score);
  const best = cand.find((c) => c.y > b.y - 0.55 && c.y < b.y + 1.05);
  if (!best) return null;
  const y = best.y;
  const doorH = Math.min(G - 0.3, Math.max(2.05, DOOR.y1 * G));
  if (doorH < 1.95) return null;
  const doors: Room['doors'] = [];
  for (const c of cand.filter((q) => Math.abs(q.y - y) <= STEP - 0.05).slice(0, 2)) {
    const sd = sides[c.k];
    sd.door = Math.floor(sd.bays / 2);
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
  return { b, pts, inner, y, G, S, floors, levels: [y], ceiling: b.y + G, tower: false, sides, stair: null, parapet: [], doors, box, arena };
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
// stairwell, but its ground floor), treads and landings a step over y or under it; null under them all.
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
  return best;
}

// Whether (x, y, z) in a room is in something solid, for a look: under its ground floor, in a floor
// (or the ceiling over a room of one floor), or in a tread or a landing.
export function roomSolid(r: Room, x: number, y: number, z: number): boolean {
  if (y < r.y) return true;
  if (!r.tower) return y >= r.ceiling && y <= r.ceiling + SLAB;
  const well = r.stair && inside(r.stair.hole, x, z);
  for (let i = 1; i < r.levels.length; i++) if (!well && y <= r.levels[i] && y >= r.levels[i] - SLAB) return true;
  if (r.stair && inside(r.stair.pts, x, z)) for (const s of r.stair.steps) if (y <= s.y && y >= s.y - 0.2 && inside(s.pts, x, z)) return true;
  return false;
}

// The walls a room stands, as the ground has them: each of the outline's walls at its middle, SKIN / 2
// in, SKIN / 2 thick each side, from below the building's foot to its top, but its openings; the
// stairwell's, the hut's and the parapet.
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
  return out;
}
