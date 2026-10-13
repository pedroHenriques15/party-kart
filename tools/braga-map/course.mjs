// Plans the game's track on Braga's real streets, through waypoints kept out of the repo
// (.cache/places.json, the houses from the shared map), and writes what the game needs.
//
// node tools/braga-map/course.mjs
//
// 1. A street graph from OpenStreetMap, and the cheapest loop through the waypoints: bigger roads
//    cost less, sharp turns cost more, and the loop never uses a street twice or runs alongside
//    itself.
// 2. That loop turned into a raceable centre line: corners rounded to a radius a kart can take,
//    heights from the real relief, smoothed.
// 3. The output: the layout (src/track/amigos.ts), the scenery round it (src/render/amigos-data.ts)
//    and course.json, which the map page draws.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { P, relief } from './geo.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = path.join(here, '.cache');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(cache, f), 'utf8'));
if (!fs.existsSync(path.join(cache, 'places.json'))) throw new Error('No waypoints: .cache/places.json holds the houses, from the shared map.');
const base = readJson('osm/base.json');
const places = readJson('places.json').places;


// ---------------------------------------------------------------------------------------------
// 1. The street graph and the loop.

// What a metre of each kind of street costs: the loop prefers avenues and keeps residential
// streets for where it has to go.
const RES = Number(process.env.RES || 1.15), TURN = Number(process.env.TURN || 15);
const COST = { primary: 1, secondary: 1, tertiary: 1.05, primary_link: 1.3, secondary_link: 1.3, tertiary_link: 1.3, unclassified: Math.min(1.3, RES), residential: RES, living_street: 2 };

const nodes = new Map(); // id -> { x, z, adj: [{ to, len, kind, name }] }
for (const e of base.elements) {
  const t = e.tags || {};
  if (e.type !== 'way' || !COST[t.highway] || (t.tunnel && t.tunnel !== 'no') || t.area === 'yes' || t.access === 'private') continue;
  e.nodes.forEach((id, i) => {
    if (!nodes.has(id)) { const [x, z] = P(e.geometry[i]); nodes.set(id, { id, x, z, adj: [] }); }
  });
  for (let i = 1; i < e.nodes.length; i++) {
    const a = nodes.get(e.nodes[i - 1]), b = nodes.get(e.nodes[i]);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const edge = { kind: t.highway, name: t.name || '', len, way: e.id, tags: t };
    a.adj.push({ to: b.id, ...edge, fwd: true });
    b.adj.push({ to: a.id, ...edge, fwd: false });
  }
}

const nearestNode = (x, z, ok = () => true) => {
  let best = null, bd = Infinity;
  for (const n of nodes.values()) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd && ok(n)) { bd = d; best = n; } }
  return { node: best, d: bd };
};
const segDist = (px, pz, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / L)) : 0;
  return Math.hypot(px - a.x - t * dx, pz - a.z - t * dz);
};
// The street a waypoint is on: the nearest stretch of road, and the nearer of its two ends.
function snap(x, z) {
  let best = null, bd = Infinity;
  for (const a of nodes.values()) for (const e of a.adj) {
    const b = nodes.get(e.to), d = segDist(x, z, a, b);
    if (d < bd) { bd = d; best = { a, b, name: e.name }; }
  }
  const n = Math.hypot(best.a.x - x, best.a.z - z) < Math.hypot(best.b.x - x, best.b.z - z) ? best.a : best.b;
  return { node: n, name: best.name, d: bd };
}

// A waypoint's street that's a dead end is joined from its end to the nearest other street, so
// the loop can drive through it (a note on the map asked for that).
const joins = [];
for (const p of places) {
  const s = snap(p.x, p.z);
  // Every node of that street within 400 m, and any dead end among them.
  const street = new Set([s.node.id]);
  const todo = [s.node];
  while (todo.length) {
    const n = todo.pop();
    for (const e of n.adj) {
      const m = nodes.get(e.to);
      if (e.name === s.name && !street.has(m.id) && Math.hypot(m.x - s.node.x, m.z - s.node.z) < 400) { street.add(m.id); todo.push(m); }
    }
  }
  for (const id of street) {
    const end = nodes.get(id);
    if (end.adj.length !== 1) continue;
    // Carry on the way the street was going, to a street that leads somewhere (not another dead
    // end), the nearest such, with going straight on worth more than going close.
    const from = nodes.get(end.adj[0].to);
    const hx = end.x - from.x, hz = end.z - from.z, hl = Math.hypot(hx, hz);
    // Not to a street that's already a short drive away: joining it would only make a hairpin.
    const close = new Map([...street].map((s) => [s, 0]));
    const todo = [...street];
    while (todo.length) {
      const n = nodes.get(todo.shift()), dn = close.get(n.id);
      for (const e of n.adj) if (dn + e.len < 300 && dn + e.len < (close.get(e.to) ?? Infinity)) { close.set(e.to, dn + e.len); todo.push(e.to); }
    }
    let to = null, d = Infinity, score = Infinity;
    for (const n of nodes.values()) {
      if (close.has(n.id) || n.adj.length < 2) continue;
      const dx = n.x - end.x, dz = n.z - end.z, dd = Math.hypot(dx, dz);
      if (dd > 200 || dd < 5) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * hx + dz * hz) / (dd * hl))));
      if (ang > 1.1) continue;
      const sc = dd * (1 + 1.5 * ang);
      if (sc < score) { score = sc; to = n; d = dd; }
    }
    if (!to) continue;
    const edge = { kind: 'residential', name: '(joined)', len: d, tags: { highway: 'residential' } };
    end.adj.push({ to: to.id, ...edge });
    to.adj.push({ to: end.id, ...edge });
    joins.push({ from: [Math.round(end.x), Math.round(end.z)], to: [Math.round(to.x), Math.round(to.z)], len: Math.round(d), street: s.name });
  }
  p.node = s.node.id;
  p.street = s.name;
}

// A binary heap of [cost, key].
class Heap {
  constructor() { this.a = []; }
  push(v) { const a = this.a; a.push(v); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

const turn = (a, b, c) => {
  const ux = b.x - a.x, uz = b.z - a.z, vx = c.x - b.x, vz = c.z - b.z;
  return Math.abs(Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz));
};

// Cheapest path from `from` (arriving there from `prev`, which it mustn't turn back to) to `to`,
// not arriving from `notFrom`, over directed edges so turns can be priced. `extra(a, b)` adds the
// cost of reusing streets.
function route(from, prev, to, notFrom, extra) {
  const key = (n, p) => n + ',' + p;
  const best = new Map(), back = new Map();
  const heap = new Heap();
  const start = key(from, prev ?? '');
  best.set(start, 0);
  heap.push([0, start, from, prev]);
  while (heap.size) {
    const [c, k, n, p] = heap.pop();
    if (c > best.get(k)) continue;
    if (n === to && p !== notFrom) {
      const path = [n];
      let kk = k;
      while (back.has(kk)) { const [pk, pn] = back.get(kk); path.push(pn); kk = pk; }
      return { cost: c, path: path.reverse(), last: p };
    }
    const N = nodes.get(n);
    for (const e of N.adj) {
      if (e.to === p) continue; // no turning back
      let cost = e.len * COST[e.kind] + extra(n, e.to);
      if (p != null && p !== '') {
        const th = turn(nodes.get(p), N, nodes.get(e.to));
        if (th > 2.4) continue; // a hairpin a kart can't make in a street
        cost += TURN * (th / (Math.PI / 2)) ** 2;
      }
      const kk = key(e.to, n), nc = c + cost;
      if (nc < (best.get(kk) ?? Infinity)) { best.set(kk, nc); back.set(kk, [k, n]); heap.push([nc, kk, e.to, n]); }
    }
  }
  return null;
}

// The loop drives along each waypoint's street through it: in from one neighbour on that street,
// out to the other. `flips` says which way round, for each waypoint.
function through(p) {
  const n = nodes.get(p.node);
  let along = n.adj.filter((e) => e.name === p.street || e.name === '(joined)').map((e) => e.to);
  if (along.length < 2) along = [...along, ...n.adj.map((e) => e.to).filter((id) => !along.includes(id))];
  // The two that make the straightest line through the waypoint.
  let pair = null, bestT = Infinity;
  for (const a of along) for (const b of along) {
    if (a === b) continue;
    const th = turn(nodes.get(a), n, nodes.get(b));
    if (th < bestT) { bestT = th; pair = [a, b]; }
  }
  return pair;
}

function loopThrough(order, flips) {
  const ids = order.map((p) => p.node);
  const ends = order.map((p, k) => (flips[k] ? [...through(p)].reverse() : through(p)));
  const used = new Set(), near = new Map();
  const cellOf = (x, z) => Math.floor(x / 30) + ',' + Math.floor(z / 30);
  const mark = (id) => {
    const n = nodes.get(id);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const c = Math.floor(n.x / 30) + a + ',' + (Math.floor(n.z / 30) + b); if (!near.has(c)) near.set(c, []); near.get(c).push(n); }
  };
  const extra = (a, b) => {
    const e = [a, b].sort().join('-');
    if (used.has(e)) return 5000;
    const A = nodes.get(a), B = nodes.get(b), mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
    // Close to a waypoint the loop comes and goes; elsewhere it keeps 28 m from itself.
    if (ids.some((id) => Math.hypot(nodes.get(id).x - mx, nodes.get(id).z - mz) < 70)) return 0;
    const close = (near.get(cellOf(mx, mz)) || []).some((n) => Math.hypot(n.x - mx, n.z - mz) < 28);
    return close ? 400 : 0;
  };
  const use = (a, b) => { used.add([a, b].sort().join('-')); mark(a); mark(b); };
  ends.forEach(([a, b], k) => { use(a, ids[k]); use(ids[k], b); });
  const path = [];
  let cost = 0;
  for (let k = 0; k < ids.length; k++) {
    const [, out] = ends[k], [into] = ends[(k + 1) % ids.length], next = ids[(k + 1) % ids.length];
    const r = route(out, ids[k], into, next, extra);
    if (!r) return null;
    for (let i = 1; i < r.path.length; i++) use(r.path[i - 1], r.path[i]);
    path.push(ids[k], ...r.path);
    cost += r.cost;
  }
  // Each waypoint's own street appears twice where legs meet (into, waypoint, out): drop repeats.
  const clean = path.filter((id, i) => id !== path[(i + 1) % path.length]);
  return { path: clean, cost, closeTurn: 0 };
}

// Every order of the waypoints, unless places.json gives one (`order`, their ids): then only the
// directions through each are tried. That keeps the loop as it was when a house is added.
const orders = [];
const fixed = readJson('places.json').order;
const [first, ...rest] = places;
const perms = (xs) => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
if (fixed) orders.push(fixed.map((id) => places.find((p) => p.id === id)));
else for (const p of perms(rest)) orders.push([first, ...p]);
let bestLoop = null;
for (const o of orders) {
  for (let f = 0; f < 1 << o.length; f++) {
    const flips = o.map((_, k) => !!(f & (1 << k)));
    const r = loopThrough(o, flips);
    if (!r) continue;
    if (!bestLoop || r.cost < bestLoop.cost) bestLoop = { ...r, order: o, flips };
  }
  console.log('order', o.map((p) => p.id).join(' > '), 'best so far', Math.round(bestLoop?.cost ?? NaN));
}
if (!bestLoop) throw new Error('No loop through the waypoints.');
const loop = bestLoop.path.map((id) => nodes.get(id));

// What the loop is made of, street by street.
{
  let L = 0, lastName = null, run = 0;
  const parts = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    const e = a.adj.find((x) => x.to === b.id);
    const name = e ? e.name || '(' + e.kind + ')' : '?';
    if (name !== lastName && lastName !== null) { parts.push(`${lastName} ${Math.round(run)}`); run = 0; }
    lastName = name;
    run += Math.hypot(b.x - a.x, b.z - a.z);
    L += Math.hypot(b.x - a.x, b.z - a.z);
  }
  parts.push(`${lastName} ${Math.round(run)}`);
  console.log('\nloop', bestLoop.order.map((p) => p.id).join(' > '), Math.round(L), 'm,', loop.length, 'nodes');
  console.log(parts.join(' | '));
  console.log('joins', JSON.stringify(joins));
}


// ---------------------------------------------------------------------------------------------
// 2. The centre line.

const loopEdges = loop.map((a, i) => a.adj.find((e) => e.to === loop[(i + 1) % loop.length].id));
// The carriageway, kerb to kerb: the map's width where it gives one, else its lanes, else what that
// kind of street usually is. The race is never narrower than W_MIN, so eight karts still fit; the
// streets round it are drawn as they are.
const W_MIN = 9;
const LANE_W = { motorway: 3.6, trunk: 3.5, primary: 3.4, secondary: 3.3, tertiary: 3.2 }; // others 3
const BARE = { motorway: 11, trunk: 10, primary: 10, secondary: 9, tertiary: 8, residential: 6.5, unclassified: 6, living_street: 5, pedestrian: 6, service: 4, track: 3 };
const isOneway = (t) => t.oneway === 'yes' || t.oneway === '-1' || t.junction === 'roundabout';
function carriageway(t = {}) {
  const kind = (t.highway || 'residential').replace('_link', '');
  const w = parseFloat(t.width);
  if (w >= 3 && w <= 40) return w;
  const lanes = parseInt(t.lanes);
  if (lanes > 0) return lanes * (LANE_W[kind] ?? 3) + (isOneway(t) ? 0.6 : 1);
  return (BARE[kind] ?? 6) * (isOneway(t) ? 0.65 : 1) * (String(t.highway).endsWith('_link') ? 0.8 : 1);
}
// The lines painted on it: how many lanes (0 for none), and whether it's one way.
function lanesOf(t = {}) {
  if (t.lane_markings === 'no') return 0;
  const l = parseInt(t.lanes);
  if (l > 0) return Math.min(l, 6);
  return ['primary', 'secondary', 'tertiary'].includes(t.highway) ? (isOneway(t) ? 1 : 2) : 0;
}
const COBBLE = new Set(['sett', 'cobblestone', 'unhewn_cobblestone', 'paving_stones', 'granite']);
const R_MIN = 12; // the corner radius aimed for: a street corner, about 80 km/h for a kart

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len2 = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => { const l = len2(a) || 1; return [a[0] / l, a[1] / l]; };

// Douglas-Peucker on a closed loop: drops the points that only wobble along a straight street.
function simplify(pts, tol) {
  const open = [...pts, pts[0]];
  const keep = new Uint8Array(open.length);
  keep[0] = keep[open.length - 1] = 1;
  const stack = [[0, open.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = segDist(open[i][0], open[i][1], { x: open[a][0], z: open[a][1] }, { x: open[b][0], z: open[b][1] }); if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return open.filter((_, i) => keep[i]).slice(0, -1);
}

// Each corner becomes an arc of radius R_MIN, or tighter where the streets either side are too
// short for it. Returns the points every few metres, and the corners that had to be tighter.
function fillet(pts) {
  const n = pts.length, out = [], tight = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const u = unit(sub(b, a)), v = unit(sub(c, b));
    const th = Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
    if (Math.abs(th) < 0.05) { out.push(b); continue; }
    const half = Math.tan(Math.abs(th) / 2);
    let r = R_MIN, t = r * half;
    const room = Math.min(len2(sub(b, a)), len2(sub(c, b))) / 2;
    if (t > room) { t = room; r = t / half; }
    if (r < 9) tight.push({ x: Math.round(b[0]), z: Math.round(b[1]), r: Math.round(r) });
    const p1 = [b[0] - u[0] * t, b[1] - u[1] * t];
    const side = Math.sign(th);
    const cx = p1[0] - u[1] * side * r, cz = p1[1] + u[0] * side * r;
    const a0 = Math.atan2(p1[1] - cz, p1[0] - cx);
    const steps = Math.max(2, Math.ceil((Math.abs(th) * r) / 2.5));
    for (let k = 0; k <= steps; k++) { const ang = a0 + (th * k) / steps; out.push([cx + Math.cos(ang) * r, cz + Math.sin(ang) * r]); }
  }
  return { pts: out, tight };
}

// Every `step` metres round a closed loop.
function resample(pts, step) {
  const out = [];
  let carry = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], L = len2(sub(b, a));
    let d = carry;
    while (d < L) { out.push([a[0] + ((b[0] - a[0]) * d) / L, a[1] + ((b[1] - a[1]) * d) / L]); d += step; }
    carry = d - L;
  }
  return out;
}

// A moving average round the loop, `k` points either side.
function blur(vals, k) {
  const n = vals.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, w = 0;
    for (let j = -k; j <= k; j++) { const g = Math.exp(-(j * j) / (2 * (k / 2) ** 2)); s += vals[(i + j + n) % n] * g; w += g; }
    out[i] = s / w;
  }
  return out;
}

// Junctions often jog a few metres from one street to the next: a stretch shorter than 14 m
// between two corners is folded into one corner at its middle.
function fold(pts) {
  let out = pts.slice();
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    const next = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length];
      if (len2(sub(b, a)) < 14 && out.length > 4 && !changed) {
        next.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        if (i === out.length - 1) next.shift();
        else i++;
        changed = true;
      } else next.push(a);
    }
    out = next;
    if (!changed) break;
  }
  return out;
}

const raw = loop.map((n) => [n.x, n.z]);
let simple = simplify(raw, 3);
for (let k = 0; k < 40; k++) { const f = fold(simple); if (f.length === simple.length) break; simple = simplify(f, 3); }
const rounded = fillet(simple);
let line = resample(rounded.pts, 2);
// A light blur joins the arcs to the straights without kinks.
{
  const xs = blur(line.map((p) => p[0]), 3), zs = blur(line.map((p) => p[1]), 3);
  line = line.map((_, i) => [xs[i], zs[i]]);
}
const n2 = line.length;

// What street each point is on, for its width and for the scenery.
const onStreet = line.map(([x, z]) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < loop.length; i++) { const d = segDist(x, z, loop[i], loop[(i + 1) % loop.length]); if (d < bd) { bd = d; best = i; } }
  return loopEdges[best];
});
const widths = blur(onStreet.map((e) => Math.max(W_MIN, carriageway(e.tags))), 12);

// The tightest corners, by heading change over 6 m.
const heading = line.map((p, i) => { const q = line[(i + 1) % n2]; return Math.atan2(q[1] - p[1], q[0] - p[0]); });
const curvature = line.map((_, i) => { let d = heading[(i + 2) % n2] - heading[(i - 1 + n2) % n2]; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.abs(d) / 6; });

// The heights: the relief under the road, smoothed over about 50 m so the DEM's bumps don't throw
// the karts, then raised to the game's zero.
const elev = relief(path.join(cache, 'dem'));
const ground = line.map(([x, z]) => elev(x, z));
const smooth = blur(blur(ground, 25), 25);
const ELEV0 = Math.floor(Math.min(...smooth)) - 2;
const ys = smooth.map((h) => h - ELEV0);

// Does any part of the road come close to another part far along it?
const clashes = [];
for (let i = 0; i < n2; i += 2) for (let j = i + 60; j < n2; j += 2) {
  if (n2 - (j - i) < 60) continue;
  const d = Math.hypot(line[i][0] - line[j][0], line[i][1] - line[j][1]);
  if (d < (widths[i] + widths[j]) / 2 + 4) clashes.push({ i, j, d: Math.round(d), at: line[i].map(Math.round) });
}

let maxGrade = 0, minCrest = Infinity;
for (let i = 0; i < n2; i++) {
  const a = ys[(i - 5 + n2) % n2], b = ys[i], c = ys[(i + 5) % n2];
  maxGrade = Math.max(maxGrade, Math.abs(c - a) / 20);
  const k = (a - 2 * b + c) / 100; // second derivative over 10 m
  if (k < 0) minCrest = Math.min(minCrest, -1 / k);
}
const length = n2 * 2;
console.log(`\ncentre line ${length} m; corners tighter than 9 m: ${rounded.tight.length} ${JSON.stringify(rounded.tight)}`);
console.log(`widths ${Math.min(...widths).toFixed(1)}–${Math.max(...widths).toFixed(1)} m, ${Math.round((100 * widths.filter((w) => w < W_MIN + 0.5).length) / n2)}% at the least`);
console.log(`tightest radius ${(1 / Math.max(...curvature)).toFixed(1)} m; height ${Math.min(...smooth).toFixed(0)}–${Math.max(...smooth).toFixed(0)} m (zero at ${ELEV0}); steepest ${(maxGrade * 100).toFixed(1)}%; sharpest crest radius ${minCrest.toFixed(0)} m`);
console.log(`clashes: ${clashes.length} ${JSON.stringify(clashes.slice(0, 8))}`);

// What's beyond each kerb, at every point: a pavement (its width, positive), a central reservation
// with the other carriageway beyond it (its width, negative), or nothing (0, a verge).
const buildingsOsm = readJson('osm/buildings.json');
// The buildings: one way each, or for the big ones mapped as a multipolygon (the Altice Forum),
// each of its outer rings, with the relation's tags.
const footprints = buildingsOsm.elements.flatMap((e) => {
  if (e.type === 'way') return e.geometry ? [e] : [];
  if (e.type !== 'relation') return [];
  const same = (a, b) => a.lat === b.lat && a.lon === b.lon;
  const ways = e.members.filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry).map((m) => m.geometry.slice());
  const rings = [];
  while (ways.length) {
    let ring = ways.shift();
    for (let guard = 0; guard < 50 && !(ring.length > 3 && same(ring[0], ring[ring.length - 1])); guard++) {
      const end = ring[ring.length - 1];
      const k = ways.findIndex((w) => same(w[0], end) || same(w[w.length - 1], end));
      if (k < 0) break;
      const w = ways.splice(k, 1)[0];
      ring = ring.concat(same(w[0], end) ? w.slice(1) : w.reverse().slice(1));
    }
    rings.push(ring);
  }
  return rings.map((g, k) => ({ type: 'way', id: e.id * 16 + k, tags: e.tags, geometry: g }));
});
const kerbs = (() => {
  // The buildings' walls, a point every 2 m, for how much room there is for a pavement.
  const vgrid = new Map();
  for (const e of footprints) {
    const pts = e.geometry.map(P);
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
      for (let f = 0; f < n; f++) { const x = ax + ((bx - ax) * f) / n, z = az + ((bz - az) * f) / n, k = Math.floor(x / 20) + ',' + Math.floor(z / 20); if (!vgrid.has(k)) vgrid.set(k, []); vgrid.get(k).push([x, z]); }
    }
  }
  // The other carriageways the loop might run beside: one-way main roads it doesn't use.
  const loopWays = new Set(loopEdges.map((e) => e.way));
  const sgrid = new Map();
  for (const e of base.elements) {
    const t = e.tags || {};
    if (e.type !== 'way' || loopWays.has(e.id) || !isOneway(t) || t.junction === 'roundabout') continue;
    if (!/^(motorway|trunk|primary|secondary|tertiary)(_link)?$/.test(t.highway || '')) continue;
    const pts = e.geometry.map(P), w = carriageway(t);
    for (let i = 1; i < pts.length; i++) {
      const seg = [pts[i - 1], pts[i], w];
      for (let f = 0; f <= 1; f += 0.25) { const k = Math.floor((pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f) / 30) + ',' + Math.floor((pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f) / 30); if (!sgrid.has(k)) sgrid.set(k, new Set()); sgrid.get(k).add(seg); }
    }
  }
  // A side's sidewalk tag, for the way as the loop drives it (its left is the way's right when the
  // loop goes against the way): true, false, or null when the map doesn't say.
  const sidewalk = (e, right) => {
    const t = e.tags || {}, side = right === e.fwd ? 'right' : 'left', other = side === 'right' ? 'left' : 'right';
    const v = t[`sidewalk:${side}`] ?? t['sidewalk:both'] ?? t.sidewalk;
    if (v == null) return null;
    if (['no', 'none', other].includes(v)) return false;
    return true;
  };
  const out = [[], []]; // left, right
  for (let i = 0; i < n2; i++) {
    const [x, z] = line[i], [x2, z2] = line[(i + 1) % n2], tl = Math.hypot(x2 - x, z2 - z) || 1, tx = (x2 - x) / tl, tz = (z2 - z) / tl;
    const w = widths[i], cx = Math.floor(x / 30), cz = Math.floor(z / 30);
    [-1, 1].forEach((side, k) => {
      const rx = -tz * side, rz = tx * side;
      // A twin carriageway alongside, beyond a reservation.
      let twin = Infinity;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [p, q, tw] of sgrid.get(cx + a + ',' + (cz + b)) || []) {
        const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1;
        if (Math.abs((dx * tx + dz * tz) / L) < 0.94) continue;
        const f = ((x - p[0]) * dx + (z - p[1]) * dz) / (L * L);
        if (f < -0.05 || f > 1.05) continue;
        const o = (p[0] + dx * f - x) * rx + (p[1] + dz * f - z) * rz;
        if (o > w / 2 + 1 && o < w / 2 + tw / 2 + 14) twin = Math.min(twin, o - w / 2 - tw / 2);
      }
      if (twin < Infinity) { out[k].push(-Math.max(0.4, twin)); return; }
      // Otherwise a pavement, as wide as the buildings leave room for.
      let room = Infinity;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [vx, vz] of vgrid.get(Math.floor(x / 20) + a + ',' + (Math.floor(z / 20) + b)) || []) {
        const along = (vx - x) * tx + (vz - z) * tz, o = (vx - x) * rx + (vz - z) * rz;
        if (Math.abs(along) < 8 && o > w / 2 - 1) room = Math.min(room, o - w / 2);
      }
      const tag = sidewalk(onStreet[i], side > 0);
      const built = room < 25;
      if (tag === false || (tag === null && !built)) out[k].push(0);
      else out[k].push(Math.max(1.2, Math.min(3.2, room - 0.3)));
    });
  }
  // Where a side street joins, the pavement (or the reservation) stops for it.
  let gaps = 0;
  for (let li = 0; li < loop.length; li++) {
    const n = loop[li], prev = loop[(li - 1 + loop.length) % loop.length].id, next = loop[(li + 1) % loop.length].id;
    for (const e of n.adj) {
      if (e.to === prev || e.to === next) continue;
      const o = nodes.get(e.to);
      let bi = 0, bd = Infinity;
      for (let i = 0; i < n2; i++) { const d = Math.hypot(line[i][0] - n.x, line[i][1] - n.z); if (d < bd) { bd = d; bi = i; } }
      if (bd > 12) continue;
      const [x, z] = line[bi], [x2, z2] = line[(bi + 1) % n2], tl = Math.hypot(x2 - x, z2 - z) || 1, tx = (x2 - x) / tl, tz = (z2 - z) / tl;
      const dx = o.x - n.x, dz = o.z - n.z, dl = Math.hypot(dx, dz) || 1;
      if (Math.abs((dx * tx + dz * tz) / dl) > 0.9) continue; // running alongside, not off it
      const k = (-tz * dx + tx * dz) / dl > 0 ? 1 : 0;
      const reach = Math.ceil((carriageway(e.tags) / 2 + 3) / 2);
      for (let j = -reach; j <= reach; j++) out[k][(bi + j + n2) % n2] = 0;
      gaps++;
    }
  }
  // Tidy: a reservation shorter than 30 m is a traffic island, kept as pavement; widths change
  // smoothly.
  for (const side of out) {
    for (let i = 0; i < n2; ) {
      if (side[i] >= 0) { i++; continue; }
      let j = i;
      while (j < n2 && side[j] < 0) j++;
      if (j - i < 15) for (let k = i; k < j; k++) side[k] = 2;
      i = j;
    }
    const sm = blur(side.map((v) => Math.abs(v)), 3);
    side.forEach((v, i) => (side[i] = v === 0 ? 0 : Math.sign(v) * sm[i]));
  }
  const share = (f) => Math.round((100 * out.flat().filter(f).length) / (2 * n2));
  console.log(`kerbs: ${share((v) => v > 0)}% pavement, ${share((v) => v < 0)}% reservation, ${share((v) => v === 0)}% open; ${gaps} side streets`);
  return out;
})();

// ---------------------------------------------------------------------------------------------
// 3. Where things go on it: the start, checkpoints, item boxes, boost pads, and the easter eggs.

const maxCurve = (i, back, ahead) => { let m = 0; for (let k = -back; k <= ahead; k++) m = Math.max(m, curvature[(i + k + n2) % n2]); return m; };
const main = (e) => ['primary', 'secondary', 'tertiary'].includes(e.kind);

// The start: the straightest stretch of a main road, 120 m before the line and 80 m after, on
// the Rua do Fujacal, where it has always been, while the loop still goes along it.
const START_ON = 'Rua do Fujacal';
const startStreet = onStreet.some((e) => e.name === START_ON);
let start = 0, startScore = Infinity;
for (let i = 0; i < n2; i++) {
  // Not by anyone's house: the start is where everyone looks.
  if (places.some((p) => Math.hypot(line[i][0] - p.x, line[i][1] - p.z) < 250)) continue;
  if (startStreet && onStreet[i].name !== START_ON) continue;
  const sc = maxCurve(i, 60, 40) + (main(onStreet[i]) ? 0 : 0.01);
  if (sc < startScore) { startScore = sc; start = i; }
}
// Everything from here counts from the start line.
const order = (i) => (i - start + n2) % n2;
const at = (k) => (start + k) % n2; // k samples (2 m each) after the start
const straightest = (k, span) => { let best = k, bs = Infinity; for (let d = -span; d <= span; d++) { const sc = maxCurve(at(k + d), 10, 10); if (sc < bs) { bs = sc; best = k + d; } } return best; };

const checkpoints = [1, 2, 3, 4, 5].map((f) => straightest(Math.round((f * n2) / 6), 20));
const busy = (k) => [0, ...checkpoints].some((c) => Math.abs(((k - c + n2 / 2 + n2) % n2) - n2 / 2) < 30);
const items = [];
for (let k = 150; k < n2 - 100; k += 410) { let b = straightest(k, 40); if (busy(b)) b += 40; items.push(b); }
// Boost pads 30 m into the longest straights.
const straights = [];
for (let k = 0, run = 0; k < n2; k++) {
  if (curvature[at(k)] < 0.006) run++;
  else { if (run > 60) straights.push({ from: k - run, len: run }); run = 0; }
}
const boosts = straights.sort((a, b) => b.len - a.len).slice(0, 6).map((s) => s.from + 15).filter((k) => !busy(k) && !items.some((it) => Math.abs(it - k) < 25));

// The easter eggs stand beside the road a little way past each house, never at its door.
const eggs = places.filter((p) => p.egg).map((p, n) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < n2; i++) { const d = Math.hypot(line[i][0] - p.x, line[i][1] - p.z); if (d < bd) { bd = d; best = i; } }
  const k = (order(best) + 22 + n * 3) % n2; // 44-50 m further on
  const [x, z] = line[at(k)];
  return { kind: p.egg, x: Math.round(x), z: Math.round(z), side: n % 2 ? 1 : -1 };
});
// The streets a note on the map asked to have houses all down both sides: the waypoints marked
// `rows` in places.json, and the joins out of them.
const rowStreets = new Set([...places.filter((p) => p.rows).map((p) => p.street), '(joined)']);
const rows = [];
{
  let from = -1;
  for (let k = 0; k <= n2; k++) {
    const on = k < n2 && rowStreets.has(onStreet[at(k)].name);
    if (on && from < 0) from = k;
    if (!on && from >= 0) { rows.push([line[at(from)].map(Math.round), line[at(k - 1)].map(Math.round)]); from = -1; }
  }
}

console.log(`start on ${onStreet[start].name} at ${line[start].map(Math.round)}; checkpoints every ${Math.round(length / 6)} m; ${items.length} item rows; ${boosts.length} boost pads; eggs ${eggs.map((e) => e.kind).join(', ')}`);

// ---------------------------------------------------------------------------------------------
// 4. The layout for the game: a point every 8 m (every tagged sample too), from the start line.

const tagAt = new Map([[0, 'start'], ...checkpoints.map((k) => [k, 'cp']), ...items.map((k) => [k, 'items']), ...boosts.map((k) => [k, 'boost'])]);
const r1 = (v) => Math.round(v * 10) / 10;
const pointsOut = [];
let lastW = null, lastSurface = null, lastLanes = null, lastKerbs = null;
const half5 = (v) => Math.round(v * 2) / 2;
for (let k = 0; k < n2; k++) {
  if (k % 4 !== 0 && !tagAt.has(k)) continue;
  const i = at(k), w = Math.round(widths[i] * 2) / 2, t = onStreet[i].tags || {};
  const o = { p: [r1(line[i][0]), r1(ys[i]), r1(line[i][1])] };
  if (w !== lastW) { o.w = w; lastW = w; }
  if (k === 0) o.walls = true;
  const surface = COBBLE.has(t.surface) ? 'cobble' : 'asphalt';
  if (surface !== lastSurface) { o.surface = surface; lastSurface = surface; }
  const lanes = lanesOf(t) * (isOneway(t) ? -1 : 1);
  if (lanes !== lastLanes) { o.lanes = lanes; lastLanes = lanes; }
  const kb = [half5(kerbs[0][i]), half5(kerbs[1][i])];
  if (kb.join() !== lastKerbs) { o.kerbs = kb; lastKerbs = kb.join(); }
  if (tagAt.has(k)) o.tag = tagAt.get(k);
  pointsOut.push(o);
}
const fmtPoint = (o) => '  { ' + Object.entries(o).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : typeof v === 'string' ? `'${v}'` : v}`).join(', ') + ' },';
const repo = path.resolve(here, '../..');
fs.writeFileSync(path.join(repo, 'src/track/amigos.ts'), `// The Volta dos Amigos: Braga's real streets, through five friends' neighbourhoods, from the
// Rio Este to Lamaçães and round the Picoto. Made by tools/braga-map/course.mjs from
// OpenStreetMap and the relief: run that again rather than editing the points by hand.
// ${length} m round; heights in metres above ${ELEV0} m.
import type { Point } from './layout.ts';

export const ELEV0 = ${ELEV0};

export const AMIGOS: Point[] = [
${pointsOut.map(fmtPoint).join('\n')}
];
`);

// For the map page: the line every 6 m, and where things are.
const pick = (k) => line[at(k)].map(Math.round);
fs.writeFileSync(path.join(here, 'course.json'), JSON.stringify({
  length, w: 14, elev0: ELEV0,
  line: line.filter((_, i) => i % 3 === 0).map((p) => p.map(Math.round)),
  start: pick(0), checkpoints: checkpoints.map(pick), items: items.map(pick), boosts: boosts.map(pick),
  eggs, joins, rows,
}));
console.log(`wrote src/track/amigos.ts (${pointsOut.length} points) and course.json`);

export { line, ys, widths, kerbs, onStreet, start, at, n2, length, ELEV0, eggs, rows, joins, elev, curvature, carriageway };

// ---------------------------------------------------------------------------------------------
// 5. The scenery round the track, for src/render/city.ts: the relief, what the ground is
//    (painted onto it), the buildings, trees, the river, street names, landmarks and the eggs.
//    All in the game's metres, heights from ELEV0. Packed as 16-bit numbers in half metres.

const treesOsm = readJson('osm/trees.json');
const braga = JSON.parse(fs.readFileSync(path.join(here, 'braga.json'), 'utf8'));

// A grid of the centre line, for "how far is this from the road".
const lineGrid = new Map();
line.forEach(([x, z], i) => { const k = Math.floor(x / 40) + ',' + Math.floor(z / 40); if (!lineGrid.has(k)) lineGrid.set(k, []); lineGrid.get(k).push(i); });
function roadDist(x, z, reach = 1) {
  let bd = Infinity, bi = -1;
  const cx = Math.floor(x / 40), cz = Math.floor(z / 40);
  for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) for (const i of lineGrid.get(cx + a + ',' + (cz + b)) || []) { const d = Math.hypot(line[i][0] - x, line[i][1] - z); if (d < bd) { bd = d; bi = i; } }
  return { d: bd, i: bi };
}
const farFromRoad = (x, z, r) => roadDist(x, z, Math.ceil(r / 40)).d > r;

// The box the scenery covers: the track and 500 m round it, inside the map's own box.
let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
for (const [x, z] of line) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
const BOX = { x0: Math.max(braga.ext.x0, Math.floor((bx0 - 500) / 10) * 10), x1: Math.min(braga.ext.x1, Math.ceil((bx1 + 500) / 10) * 10), z0: Math.max(braga.ext.z0, Math.floor((bz0 - 500) / 10) * 10), z1: Math.min(braga.ext.z1, Math.ceil((bz1 + 500) / 10) * 10) };
const inBox = (x, z, m = 0) => x >= BOX.x0 - m && x <= BOX.x1 + m && z >= BOX.z0 - m && z <= BOX.z1 + m;

const half = (v) => Math.round(v * 2); // half metres
const dm = (v) => Math.round(v * 10); // decimetres
const out = { header: {}, data: [] };
const section = (name, nums, meta = {}) => { out.header[name] = { at: out.data.length, n: nums.length, ...meta }; for (const v of nums) out.data.push(v); };

// -- The relief: near the track every 10 m, and the whole map every 50 m for the distant hills.
{
  const grid = (b, step) => {
    const nx = Math.round((b.x1 - b.x0) / step) + 1, nz = Math.round((b.z1 - b.z0) / step) + 1, h = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) h.push(dm(elev(b.x0 + i * step, b.z0 + j * step) - ELEV0));
    return { h, meta: { x0: b.x0, z0: b.z0, step, nx, nz } };
  };
  const near = grid(BOX, 10);
  section('terrain', near.h, near.meta);
  const E = braga.ext, far = grid({ x0: E.x0, x1: E.x1, z0: E.z0, z1: E.z1 }, 50);
  section('far', far.h, far.meta);
  // The horizon: the hills 15 km round the map, every 250 m, from the coarser tiles.
  const hz = relief(path.join(cache, 'dem'), 11), cx = Math.round((E.x0 + E.x1) / 500) * 250, cz = Math.round((E.z0 + E.z1) / 500) * 250;
  const H = { x0: cx - 15000, x1: cx + 15000, z0: cz - 15000, z1: cz + 15000 }, nx = 121, nz = 121, h = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) h.push(dm(Math.max(-50, hz(H.x0 + i * 250, H.z0 + j * 250) - ELEV0)));
  section('horizon', h, { x0: H.x0, z0: H.z0, step: 250, nx, nz });
}

// -- The ground: what each area is, the other streets, the railway.
const AREA = ['urban', 'industrial', 'farm', 'grass', 'scrub', 'forest', 'park', 'cemetery', 'hospital', 'school', 'sport', 'water', 'plaza'];
const AREA_OF = (t) => {
  if (t.natural === 'water') return 'water';
  if (t.landuse === 'forest' || t.natural === 'wood') return 'forest';
  if (t.natural === 'scrub' || t.natural === 'heath') return 'scrub';
  if (t.landuse === 'cemetery') return 'cemetery';
  if (['pitch', 'stadium', 'track', 'sports_centre', 'golf_course'].includes(t.leisure)) return 'sport';
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (['grass', 'recreation_ground'].includes(t.landuse) || ['grassland', 'grass', 'shrubbery'].includes(t.natural)) return 'grass';
  if (['farmland', 'meadow', 'orchard', 'vineyard'].includes(t.landuse)) return 'farm';
  if (t.landuse === 'industrial') return 'industrial';
  if (t.amenity === 'hospital') return 'hospital';
  if (['university', 'school', 'college'].includes(t.amenity)) return 'school';
  if (t.landuse) return 'urban';
  return null;
};
const LINE = { trunk: 0, motorway: 0, trunk_link: 1, motorway_link: 1, primary: 2, primary_link: 2, secondary: 3, secondary_link: 3, tertiary: 4, tertiary_link: 4, residential: 5, unclassified: 5, living_street: 5, pedestrian: 6, service: 7, track: 8 };
function openThin(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = segDist(pts[i][0], pts[i][1], { x: pts[a][0], z: pts[a][1] }, { x: pts[b][0], z: pts[b][1] }); if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const ringArea = (pts) => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return Math.abs(a / 2); };
const packPts = (pts) => { const o = []; let px = 0, pz = 0; pts.forEach(([x, z], i) => { const hx = half(x), hz = half(z); o.push(i ? hx - px : hx, i ? hz - pz : hz); px = hx; pz = hz; }); return o; };
const groundAreas = [], groundLines = []; // [kind, points], kept for the infill below
{
  const areas = groundAreas, lines = groundLines;
  for (const e of base.elements) {
    const t = e.tags || {};
    if (e.type === 'way' && (LINE[t.highway] != null || t.railway)) {
      const pts = e.geometry.map(P);
      if (!pts.some(([x, z]) => inBox(x, z, 50))) continue;
      const k = t.railway ? 9 : LINE[t.highway];
      const closed = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
      if (t.highway === 'pedestrian' && (t.area === 'yes' || closed)) { areas.push([AREA.indexOf('plaza'), simplify(pts.slice(0, -1), 0.5)]); continue; }
      if (t.tunnel && t.tunnel !== 'no') continue;
      lines.push([k, t.railway ? 4 : carriageway(t), openThin(pts, 0.8)]);
      continue;
    }
    const c = AREA_OF(t);
    if (!c) continue;
    // A relation's member ways are each painted as their own ring: good enough for the ground.
    const rings = e.type === 'way' ? [e.geometry.map(P)] : e.members.filter((m) => m.type === 'way' && m.geometry).map((m) => m.geometry.map(P));
    for (const r of rings) if (r.length > 3 && r.some(([x, z]) => inBox(x, z, 200))) areas.push([AREA.indexOf(c), simplify(r, c === 'forest' || c === 'farm' ? 2 : 1)]);
  }
  // Big areas first, so smaller ones inside them are painted over them; squares last.
  const plaza = AREA.indexOf('plaza');
  areas.sort((a, b) => (a[0] === plaza) - (b[0] === plaza) || ringArea(b[1]) - ringArea(a[1]));
  const A = [];
  for (const [c, pts] of areas) if (pts.length >= 3) A.push(c, pts.length, ...packPts(pts));
  section('areas', A, { kinds: AREA });
  // What the far hills are covered with, at each point of their 50 m grid: 0 fields and scrub,
  // 1 woods, 2 town.
  {
    const far = out.header.far, cover = new Array(far.nx * far.nz).fill(0), kinds = [];
    for (const e of base.elements) {
      const c = AREA_OF(e.tags || {});
      const k = c === 'forest' ? 1 : ['urban', 'industrial'].includes(c) ? 2 : 0;
      if (!k) continue;
      const rings = e.type === 'way' ? [e.geometry.map(P)] : e.members.filter((m) => m.type === 'way' && m.geometry && m.role !== 'inner').map((m) => m.geometry.map(P));
      for (const r of rings) if (r.length > 3) kinds.push([k, r]);
    }
    // Woods last, so a wood inside a town's boundary is still a wood.
    kinds.sort((a, b) => b[0] - a[0]);
    const inside = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
    for (const [k, r] of kinds) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      for (let j = Math.max(0, Math.ceil((z0 - far.z0) / far.step)); j <= Math.min(far.nz - 1, Math.floor((z1 - far.z0) / far.step)); j++) {
        for (let i = Math.max(0, Math.ceil((x0 - far.x0) / far.step)); i <= Math.min(far.nx - 1, Math.floor((x1 - far.x0) / far.step)); i++) {
          if (inside(r, far.x0 + i * far.step, far.z0 + j * far.step)) cover[j * far.nx + i] = k;
        }
      }
    }
    section('cover', cover);
    console.log(`far cover: ${Math.round((100 * cover.filter((v) => v === 1).length) / cover.length)}% woods, ${Math.round((100 * cover.filter((v) => v === 2).length) / cover.length)}% town`);
  }
  lines.sort((a, b) => b[0] - a[0]);
  const Ls = [];
  for (const [k, w, pts] of lines) Ls.push(k, Math.round(w * 10), pts.length, ...packPts(pts));
  section('lines', Ls, { widths: 'dm' });
  console.log(`ground: ${areas.length} areas, ${lines.length} lines`);
}

// -- Buildings within 300 m of the road, but none on it: the road is wider than the streets were.
const KIND = { house: 0, flats: 1, shop: 2, church: 3, civic: 4 };
const ROOF = { flat: 0, hipped: 1, gabled: 2 };
const COLORS = 8; // facade colours, picked from each building's id
{
  const B = [];
  let kept = 0, cleared = 0;
  const church = new Set(['church', 'cathedral', 'chapel', 'basilica', 'religious', 'monastery', 'convent']);
  const flats = new Set(['apartments', 'residential', 'dormitory', 'hotel']);
  const house = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'duplex']);
  const civic = new Set(['school', 'university', 'college', 'kindergarten', 'hospital', 'public', 'civic', 'government', 'museum', 'fire_station']);
  const low = new Set(['roof', 'carport', 'garage', 'garages', 'shed', 'kiosk']);
  const rnd = (id, k) => { let x = (id * 2654435761 + k * 40503) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; };
  for (const e of footprints) {
    let pts = e.geometry.map(P);
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
    if (pts.length < 3) continue;
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    if (roadDist(cx, cz, 8).d > 300) continue;
    // Anything on the road or its kerb goes.
    const onRoad = (x, z) => { const r = roadDist(x, z, 1); return r.d < widths[r.i] / 2 + 1; };
    const edgeHits = pts.some((p, k) => { const q = pts[(k + 1) % pts.length]; for (let f = 0; f <= 1; f += 0.25) if (onRoad(p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f)) return true; return false; });
    if (edgeHits || onRoad(cx, cz)) { cleared++; continue; }
    const t = e.tags, a = ringArea(pts);
    if (a < 12) continue;
    let kind = church.has(t.building) ? KIND.church : flats.has(t.building) ? KIND.flats : house.has(t.building) ? KIND.house : civic.has(t.building) ? KIND.civic : t.building === 'yes' ? (a < 220 ? KIND.house : a < 1400 ? KIND.flats : KIND.shop) : KIND.shop;
    const levels = Number(t['building:levels']);
    let h;
    if (Number(t.height)) h = Number(t.height);
    else if (levels) h = levels * 3 + 0.6;
    else if (low.has(t.building)) h = 3;
    else h = kind === KIND.house ? 3.4 + 3 * Math.floor(1 + rnd(e.id, 1) * 1.6) : kind === KIND.flats ? 3 * (4 + Math.floor(rnd(e.id, 2) * 4)) + 0.6 : kind === KIND.church ? 12 : kind === KIND.civic ? (a > 4000 ? 14 : 7.5 + Math.floor(rnd(e.id, 3) * 2) * 3) : 7;
    if (kind === KIND.house && h > 10) kind = KIND.flats;
    const shape = t['roof:shape'];
    let roof = shape === 'flat' ? ROOF.flat : shape === 'gabled' ? ROOF.gabled : ['hipped', 'half-hipped', 'pyramidal'].includes(shape) ? ROOF.hipped : null;
    if (roof === null) roof = kind === KIND.house ? (rnd(e.id, 4) < 0.7 ? ROOF.hipped : ROOF.gabled) : kind === KIND.flats ? (rnd(e.id, 5) < 0.45 ? ROOF.hipped : ROOF.flat) : kind === KIND.church ? ROOF.gabled : kind === KIND.civic ? (rnd(e.id, 6) < 0.5 ? ROOF.hipped : ROOF.flat) : ROOF.flat;
    if (low.has(t.building)) roof = ROOF.flat;
    const ring = simplify(pts, 0.3);
    if (ring.length < 3) continue;
    B.push(ring.length, kind, roof, Math.floor(rnd(e.id, 7) * COLORS), Math.round(h * 10), ...packPts(ring));
    kept++;
  }
  // OpenStreetMap is missing many of the buildings along the way: where the land is built-up and
  // the frontage is empty, line the road with houses, and flats on the main roads. Never in a
  // park, a wood, a field or a pitch, across a side street, or over a real building; and the
  // streets marked for rows get them all down both sides.
  const cell = 40, bgrid = new Map(), add = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const allBuildings = [];
  for (const e of footprints) {
    const r = e.geometry.map(P);
    if (!r.some(([x, z]) => inBox(x, z, 50))) continue;
    allBuildings.push(r);
    for (const [x, z] of r) add(bgrid, Math.floor(x / cell) + ',' + Math.floor(z / cell), allBuildings.length - 1);
  }
  const inside = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const nearBuildings = (x, z, reach) => { const out = new Set(); const cx = Math.floor(x / cell), cz = Math.floor(z / cell); for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) for (const i of bgrid.get(cx + a + ',' + (cz + b)) || []) out.add(i); return [...out]; };
  const GREEN = new Set(['farm', 'grass', 'scrub', 'forest', 'park', 'cemetery', 'sport', 'water']);
  const agrid = new Map();
  groundAreas.forEach(([k, r], i) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } for (let a = Math.floor(x0 / 100); a <= Math.floor(x1 / 100); a++) for (let b = Math.floor(z0 / 100); b <= Math.floor(z1 / 100); b++) add(agrid, a + ',' + b, i); });
  const landAt = (x, z) => { let best = null, ba = Infinity; for (const i of agrid.get(Math.floor(x / 100) + ',' + Math.floor(z / 100)) || []) { const [k, r] = groundAreas[i]; if (inside(r, x, z)) { const a = ringArea(r); if (a < ba) { ba = a; best = AREA[k]; } } } return best; };
  const sgrid = new Map();
  groundLines.forEach(([k, , r]) => { if (k > 6) return; for (let i = 1; i < r.length; i++) { const [ax, az] = r[i - 1], [bx, bz] = r[i]; const ra = roadDist(ax, az, 1), rb = roadDist(bx, bz, 1); if (ra.d < widths[Math.max(0, ra.i)] / 2 + 5 && rb.d < widths[Math.max(0, rb.i)] / 2 + 5) continue; for (let f = 0; f <= 1; f += 0.5) add(sgrid, Math.floor((ax + (bx - ax) * f) / cell) + ',' + Math.floor((az + (bz - az) * f) / cell), [ax, az, bx, bz]); } });
  const sideStreet = (x, z, r) => { const cx = Math.floor(x / cell), cz = Math.floor(z / cell); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [ax, az, bx, bz] of sgrid.get(cx + a + ',' + (cz + b)) || []) if (segDist(x, z, { x: ax, z: az }, { x: bx, z: bz }) < r) return true; return false; };
  let seed = 4242, infill = 0;
  const why = { green: 0, empty: 0, road: 0, street: 0, building: 0, chance: 0 };
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rowsOn = (k) => rowStreets.has(onStreet[at(k)].name);
  for (const side of [-1, 1]) {
    let k = 0;
    while (k < n2) {
      const i = at(k), j = at(k + 3), [x, z] = line[i], [x2, z2] = line[j];
      const tl = Math.hypot(x2 - x, z2 - z) || 1, tx = (x2 - x) / tl, tz = (z2 - z) / tl, rx = -tz * side, rz = tx * side;
      const row = rowsOn(k), mainRoad = main(onStreet[i]);
      const wide = 9 + rand() * (mainRoad ? 9 : 6), deep = mainRoad ? 12 + rand() * 6 : 9 + rand() * 4, set = widths[i] / 2 + Math.max(1.5, kerbs[side > 0 ? 1 : 0][i]) + 0.5;
      const quad = [[0, set], [wide, set], [wide, set + deep], [0, set + deep]].map(([a, b]) => [x + tx * a + rx * b, z + tz * a + rz * b]);
      const mid = [x + tx * (wide / 2) + rx * (set + deep / 2), z + tz * (wide / 2) + rz * (set + deep / 2)];
      const land = landAt(mid[0], mid[1]);
      const builtUp = row || (land && !GREEN.has(land)) || (!land && nearBuildings(mid[0], mid[1], 2).length >= 4);
      const clearRoad = quad.every(([qx, qz]) => roadDist(qx, qz, 1).d > widths[roadDist(qx, qz, 1).i] / 2 + 1.5);
      const free = clearRoad && !quad.concat([mid]).some(([qx, qz]) => sideStreet(qx, qz, 6)) && !nearBuildings(mid[0], mid[1], 1).some((b) => quad.concat([mid]).some(([qx, qz]) => inside(allBuildings[b], qx, qz)) || allBuildings[b].some(([bx, bz]) => inside(quad, bx, bz)));
      if (!builtUp) why[land ? 'green' : 'empty']++;
      else if (!clearRoad) why.road++;
      else if (!free) why[quad.concat([mid]).some(([qx, qz]) => sideStreet(qx, qz, 6)) ? 'street' : 'building']++;
      if (builtUp && free && (row || rand() < 0.85)) {
        const kind = mainRoad ? (rand() < 0.75 ? KIND.flats : KIND.house) : rand() < 0.85 ? KIND.house : KIND.flats;
        const h = kind === KIND.flats ? 3 * (3 + Math.floor(rand() * 4)) + 0.6 : 3.4 + 3 * Math.floor(1 + rand() * 1.5);
        const roof = kind === KIND.house ? (rand() < 0.65 ? ROOF.hipped : ROOF.gabled) : rand() < 0.5 ? ROOF.hipped : ROOF.flat;
        B.push(4, kind, roof, Math.floor(rand() * COLORS), Math.round(h * 10), ...packPts(quad));
        allBuildings.push(quad);
        for (const [qx, qz] of quad) add(bgrid, Math.floor(qx / cell) + ',' + Math.floor(qz / cell), allBuildings.length - 1);
        infill++;
        k += Math.max(2, Math.round((wide + (row || rand() < 0.7 ? 0.4 : 3 + rand() * 4)) / 2));
      } else k += 3;
    }
  }
  section('buildings', B, { kinds: KIND, roofs: ROOF, colors: COLORS });
  console.log(`buildings: ${kept} from the map, ${cleared} cleared off the road, ${infill} filled in; frontage skipped for ${JSON.stringify(why)}`);
}

// -- Trees: the ones on the map, and woods and parks filled in; none on the road.
{
  const T = [];
  let seed = 9;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ok = (x, z) => inBox(x, z) && farFromRoad(x, z, 11);
  for (const e of treesOsm.elements) {
    if (e.type === 'node') { const [x, z] = P(e); if (ok(x, z)) T.push(half(x), half(z), e.tags && e.tags.leaf_type === 'needleleaved' ? 1 : 0); }
    else for (const g of e.geometry) { const [x, z] = P(g); if (ok(x, z)) T.push(half(x), half(z), 0); }
  }
  // One tree to so many square metres, pines among the woods' trees.
  const fill = { forest: 200, park: 420, scrub: 900 };
  for (const e of base.elements) {
    const c = AREA_OF(e.tags || {});
    if (!fill[c] || e.type !== 'way') continue;
    const r = e.geometry.map(P);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (x1 < BOX.x0 || x0 > BOX.x1 || z1 < BOX.z0 || z0 > BOX.z1) continue;
    const inside = (x, z) => { let c2 = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c2 = !c2; } return c2; };
    const n = Math.min(4000, Math.round(((x1 - x0) * (z1 - z0)) / fill[c]));
    for (let k = 0; k < n; k++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
      if (inside(x, z) && ok(x, z) && roadDist(x, z, 6).d < 230) T.push(half(x), half(z), c === 'forest' && rnd() < 0.6 ? 1 : 0);
    }
  }
  section('trees', T);
  console.log(`trees: ${T.length / 3}`);
}

// -- The Rio Este: its course and water level, falling downstream, and always well below the
//    road where the road crosses it.
{
  const R = [];
  for (const e of base.elements) {
    const t = e.tags || {};
    if (e.type !== 'way' || t.waterway !== 'river' || (t.tunnel && t.tunnel !== 'no')) continue;
    const pts = e.geometry.map(P).filter(([x, z]) => inBox(x, z, 100));
    if (pts.length < 2) continue;
    const lv = blur(pts.map(([x, z]) => elev(x, z)), 4);
    for (let i = 1; i < lv.length; i++) lv[i] = Math.min(lv[i], lv[i - 1]); // water runs downhill
    const yW = pts.map(([x, z], i) => {
      let y = lv[i] - ELEV0 - 2.2;
      const r = roadDist(x, z, 1);
      if (r.d < 30) y = Math.min(y, ys[r.i] - 4.5);
      return y;
    });
    R.push(pts.length, ...pts.flatMap(([x, z], i) => [half(x), half(z), dm(yW[i])]));
  }
  section('rivers', R, { halfWidth: 6 });
}

// -- Names: each street as the track turns into it, and the landmarks it passes.
const streets = [];
{
  let last = null;
  for (let k = 0; k < n2; k++) {
    const name = onStreet[at(k)].name;
    if (name && name !== '(joined)' && name !== last && !streets.some((s) => s.name === name)) {
      const [x, z] = line[at(k + 8)];
      streets.push({ name, x: Math.round(x), z: Math.round(z) });
    }
    if (name) last = name;
  }
}
const landmarks = braga.landmarks.filter((l) => roadDist(l.x, l.z, 8).d < 220).map((l) => ({ name: l.name, x: l.x, z: l.z }));

// -- The lobby's stage: beside the road just past the start.
const stage = (() => {
  const i = at(12), [x, z] = line[i], [nx, nz] = line[at(13)];
  const tx = nx - x, tz = nz - z, tl = Math.hypot(tx, tz), rx = -tz / tl, rz = tx / tl;
  return { x: Math.round(x + rx * (widths[i] / 2 + 9)), z: Math.round(z + rz * (widths[i] / 2 + 9)), face: Math.atan2(-rz, -rx) };
})();

// -- Along the road, from the map: zebra crossings and traffic lights on the loop's own streets,
//    and the bus stops beside it.
const crossings = [], signals = [], stops = [];
{
  const streetOsm = readJson('osm/street.json');
  const loopNodes = new Set(loop.map((n) => n.id));
  const near = (list, x, z, r) => list.some((q) => Math.hypot(q[0] - x, q[1] - z) < r);
  for (const e of streetOsm.elements) {
    const t = e.tags || {}, [x, z] = P(e).map(Math.round);
    if (loopNodes.has(e.id)) {
      const marked = (t.highway === 'crossing' || t.crossing) && !['unmarked', 'no', 'informal'].includes(t.crossing) && t['crossing:markings'] !== 'no';
      if (marked && !near(crossings, x, z, 8)) crossings.push([x, z]);
      if ((t.highway === 'traffic_signals' || t.crossing === 'traffic_signals') && !near(signals, x, z, 12)) signals.push([x, z]);
    } else if (t.highway === 'bus_stop') {
      const r = roadDist(x, z, 1);
      if (r.d < widths[r.i] / 2 + 9 && !stops.some((q) => Math.hypot(q.x - x, q.z - z) < 30)) stops.push({ x, z, shelter: t.shelter === 'yes' ? 1 : 0 });
    }
  }
  console.log(`along the road: ${crossings.length} crossings, ${signals.length} traffic lights, ${stops.length} bus stops`);
}

// -- The sights a Bracarense steers by: Bom Jesus and the Sameiro on the hills to the east, the
//    cross on the Picoto, and along the way the stadium, the Altice Forum, Makro and the
//    Tourigalo's bull. Footprints and positions from the map, heights from the relief.
const sights = [];
{
  const pois = readJson('osm/pois.json').elements;
  const find = (list, type, id) => list.find((e) => e.type === type && e.id === id);
  const ground = (x, z) => Math.round((elev(x, z) - ELEV0) * 10) / 10;
  // The smallest rectangle round a footprint: centre, the angle of its long side, its half-sizes.
  const rect = (pts) => {
    let best = null;
    for (let k = 0; k < pts.length; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[(k + 1) % pts.length], l = Math.hypot(bx - ax, bz - az);
      if (l < 0.5) continue;
      const ux = (bx - ax) / l, uz = (bz - az) / l;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, z] of pts) { const a = x * ux + z * uz, b = -x * uz + z * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
      const area = (a1 - a0) * (b1 - b0);
      if (!best || area < best.area) {
        const am = (a0 + a1) / 2, bm = (b0 + b1) / 2, long = a1 - a0 >= b1 - b0;
        best = { area, x: am * ux - bm * uz, z: am * uz + bm * ux, angle: Math.atan2(long ? uz : ux, long ? ux : -uz), L: Math.max(a1 - a0, b1 - b0) / 2, W: Math.min(a1 - a0, b1 - b0) / 2 };
      }
    }
    return best;
  };
  const r1 = (v) => Math.round(v * 10) / 10;
  const facing = (x, z, tx, tz) => r1(Math.atan2(tz - z, tx - x) * 100) / 100;
  // A building's front: the middle of its long wall nearest the road, and which way it looks.
  const front = (pts) => {
    let best = null;
    const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length, cz = pts.reduce((a, q) => a + q[1], 0) / pts.length;
    const longest = Math.max(...pts.map((q, k) => Math.hypot(pts[(k + 1) % pts.length][0] - q[0], pts[(k + 1) % pts.length][1] - q[1])));
    for (let k = 0; k < pts.length; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[(k + 1) % pts.length], l = Math.hypot(bx - ax, bz - az);
      if (l < Math.min(30, longest * 0.6)) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, d = roadDist(mx, mz, 8).d;
      if (!best || d < best.d) {
        let nx = (bz - az) / l, nz = -(bx - ax) / l;
        if (nx * (mx - cx) + nz * (mz - cz) < 0) { nx = -nx; nz = -nz; }
        best = { d, x: r1(mx), z: r1(mz), face: r1(Math.atan2(nz, nx) * 100) / 100, L: r1(l / 2) };
      }
    }
    const { d: _d, ...rest } = best;
    return rest;
  };
  const ring = (e) => e.geometry.map(P);

  const basilica = find(footprints, 'way', 146373021);
  if (basilica) {
    const r = rect(ring(basilica));
    // It looks west, down the Escadório to the city.
    const foot = [3420, -352];
    sights.push({ kind: 'bomjesus', x: r1(r.x), z: r1(r.z), y: ground(r.x, r.z), angle: r1(r.angle * 100) / 100, L: r1(r.L), W: r1(r.W), face: facing(r.x, r.z, ...foot), foot, footY: ground(...foot) });
  }
  const sameiro = find(footprints, 'way', 146227475);
  const statue = find(pois, 'node', 6562581627);
  if (sameiro && statue) {
    const r = rect(ring(sameiro)), [sx, sz] = P(statue);
    sights.push({ kind: 'sameiro', x: r1(r.x), z: r1(r.z), y: ground(r.x, r.z), angle: r1(r.angle * 100) / 100, L: r1(r.L), W: r1(r.W), face: facing(r.x, r.z, sx, sz), statue: [r1(sx), r1(sz)], statueY: ground(sx, sz) });
  }
  const cross = find(pois, 'node', 3917613795);
  if (cross) { const [x, z] = P(cross); sights.push({ kind: 'cruzeiro', x: r1(x), z: r1(z), y: ground(x, z) }); }
  const bull = find(pois, 'node', 4872503160);
  if (bull) {
    const [x, z] = P(bull), r = roadDist(x, z, 8);
    sights.push({ kind: 'tourigalo', x: r1(x), z: r1(z), y: ground(x, z), face: facing(x, z, ...line[r.i]) });
  }
  const makro = find(footprints, 'way', 41677157);
  if (makro) sights.push({ kind: 'makro', ...front(ring(makro)), y: ground(...P(makro.geometry[0])) });
  const altice = footprints.filter((e) => Math.floor(e.id / 16) === 19915703).map(ring).sort((a, b) => ringArea(b) - ringArea(a))[0];
  if (altice) sights.push({ kind: 'altice', ...front(altice), y: ground(altice[0][0], altice[0][1]) });
  const pitch = find(base.elements, 'way', 22660434);
  if (pitch) {
    const r = rect(ring(pitch));
    sights.push({ kind: 'stadium', x: r1(r.x), z: r1(r.z), y: ground(r.x, r.z), angle: r1(r.angle * 100) / 100, L: r1(r.L), W: r1(r.W) });
  }
  console.log(`sights: ${sights.map((q) => q.kind).join(', ')}`);
}

out.header.meta = { elev0: ELEV0, box: BOX, eggs, rows, streets, landmarks, stage, crossings, signals, stops, sights };
{
  const head = Buffer.from(JSON.stringify(out.header), 'utf8');
  const pad = (4 - ((head.length + 4) % 4)) % 4;
  const buf = Buffer.alloc(4 + head.length + pad + out.data.length * 2);
  buf.writeUInt32LE(head.length, 0);
  head.copy(buf, 4);
  const view = new Int16Array(buf.buffer, buf.byteOffset + 4 + head.length + pad, out.data.length);
  out.data.forEach((v, i) => { if (v > 32767 || v < -32768) throw new Error(`a number won't fit in 16 bits: ${v}`); view[i] = v; });
  const b64 = buf.toString('base64');
  fs.writeFileSync(path.join(repo, 'src/render/amigos-data.ts'), `// The scenery round the Volta dos Amigos, from OpenStreetMap and the relief: made by
// tools/braga-map/course.mjs, and read by city.ts. A JSON header, then 16-bit numbers, in base64.
// © OpenStreetMap contributors (ODbL).
export const CITY_DATA =
  '${b64}';
`);
  console.log(`scenery: ${(buf.length / 1024).toFixed(0)} KB packed, ${(b64.length / 1024).toFixed(0)} KB as text; box ${JSON.stringify(BOX)}`);
  console.log(`${streets.length} street names; landmarks: ${landmarks.map((l) => l.name).join(', ')}`);
}
