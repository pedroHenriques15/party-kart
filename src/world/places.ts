// Finding a place by its name (braga-map's task 109): the streets, the landmarks, the arenas and the
// bus stops in the open world's area, by their names with Portugal's accents or without them, the
// nearest first; each at a point a route goes to (a street at its nearest point to you).
import type { Landmark, Line, Stop } from 'braga-map';

export type PlaceKind = 'street' | 'place' | 'arena' | 'stop';

export interface Found {
  kind: PlaceKind;
  name: string;
  x: number;
  z: number;
  d: number; // metres from you
}

// A name as it's searched: no accents, no capitals, only its words.
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

interface Entry {
  kind: PlaceKind;
  name: string;
  words: string[];
  runs: [number, number][][]; // a street's lines in the area; anything else, its point
}

// A bus stop's street: the nearest named one within this many metres.
const STOP_STREET = 30;

// The nearest point to (x, z) on lines of points, and how far it is.
function nearest(runs: [number, number][][], x: number, z: number): { x: number; z: number; d: number } {
  let best = { x: runs[0][0][0], z: runs[0][0][1], d: Infinity };
  for (const r of runs) {
    if (r.length === 1) {
      const d = Math.hypot(r[0][0] - x, r[0][1] - z);
      if (d < best.d) best = { x: r[0][0], z: r[0][1], d };
      continue;
    }
    for (let i = 1; i < r.length; i++) {
      const [ax, az] = r[i - 1];
      const dx = r[i][0] - ax;
      const dz = r[i][1] - az;
      const L = dx * dx + dz * dz;
      const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
      const px = ax + dx * t;
      const pz = az + dz * t;
      const d = Math.hypot(px - x, pz - z);
      if (d < best.d) best = { x: px, z: pz, d };
    }
  }
  return best;
}

export class Places {
  private all: Entry[] = [];

  constructor(o: { lines: Line[]; landmarks: Landmark[]; arenas: { name: string; pts: [number, number][] }[]; stops: Stop[]; inside: (x: number, z: number) => boolean }) {
    const add = (kind: PlaceKind, name: string, runs: [number, number][][]) => runs.length && this.all.push({ kind, name, words: fold(name).split(' '), runs });
    // Every named street, its lines' stretches inside the area (the railway isn't one).
    const streets = new Map<string, [number, number][][]>();
    for (const l of o.lines) {
      if (!l.name || l.kind > 8) continue;
      let run: [number, number][] = [];
      const list = streets.get(l.name) ?? [];
      for (const p of l.pts) {
        if (o.inside(p[0], p[1])) run.push(p);
        else if (run.length) list.push(run), (run = []);
      }
      if (run.length) list.push(run);
      if (list.length) streets.set(l.name, list);
    }
    for (const [name, runs] of streets) add('street', name, runs);
    for (const m of o.landmarks) if (o.inside(m.x, m.z)) add('place', m.name, [[[m.x, m.z]]]);
    for (const a of o.arenas) {
      const x = a.pts.reduce((s, p) => s + p[0], 0) / a.pts.length;
      const z = a.pts.reduce((s, p) => s + p[1], 0) / a.pts.length;
      add('arena', a.name, [[[x, z]]]);
    }
    // A bus stop by its street: "Paragem, Rua do …".
    for (const s of o.stops) {
      if (!o.inside(s.x, s.z)) continue;
      let street = '';
      let bd = STOP_STREET;
      for (const [name, runs] of streets) {
        const n = nearest(runs, s.x, s.z);
        if (n.d < bd) (bd = n.d), (street = name);
      }
      add('stop', street ? `Paragem, ${street}` : 'Paragem de autocarro', [[[s.x, s.z]]]);
    }
  }

  // The places whose names have a word starting with each word asked (in any order), the nearest to
  // `at` first, at most n.
  find(q: string, at: { x: number; z: number }, n = 8): Found[] {
    const asked = fold(q).split(' ').filter(Boolean);
    if (!asked.length) return [];
    const out: Found[] = [];
    for (const e of this.all) {
      if (!asked.every((w) => e.words.some((v) => v.startsWith(w)))) continue;
      const p = nearest(e.runs, at.x, at.z);
      out.push({ kind: e.kind, name: e.name, x: p.x, z: p.z, d: p.d });
    }
    return out.sort((a, b) => a.d - b.d).slice(0, n);
  }
}
