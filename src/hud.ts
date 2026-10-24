// What's on the screen while you drive. In a race (Hud): place and lap, the item slot, the clock, the
// minimap, the order, what just happened to whom, the speed, and speed lines when boosting or in a
// slipstream. Round the city (RoamHud): the speed, the street's name, a minimap round you, the feed;
// on foot, a dot in the middle of the screen for the speed.
import type { CarInfo } from './game/arena.ts';
import { ARMOUR, FAMILIES, GUN_IDS, GUNS, isGun, isNade, KNIFE, NADE_IDS, NADES, NADES_MAX, nameOf, type Cause, type Family, type GunId, type Loadout, type NadeId, type WeaponId } from './game/arsenal.ts';
import { COMP, priceOf, sells, type Side } from './game/comp.ts';
import { ITEMS, type ItemKind } from './game/items.ts';
import type { Track } from './track/track.ts';
import { boundsOf, fit, keep, lengths, limits, pan, pointAt, toMap, toScreen, zoomAt, type Bounds, type View } from './world/mapview.ts';
import type { Step } from './world/route.ts';

type Child = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const k of kids) if (k) el.append(k);
  return el;
}

export const ordinal = (n: number) => `${n}.º`;
export const fmt = (ms: number | null) => {
  if (ms === null || !Number.isFinite(ms)) return '–';
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};
export const fmtDiff = (ms: number) => `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(3)}`;

const ROLL_ICONS = Object.values(ITEMS).map((i) => i.icon);

export interface BoardRow {
  id: string;
  name: string;
  color: string;
  right: string; // a time, or a gap
  me: boolean;
}

export class Hud {
  readonly root: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  private map: HTMLCanvasElement;
  private base: HTMLCanvasElement;
  private toMap: (x: number, z: number) => [number, number];
  private feedItems: { el: HTMLElement; until: number }[] = [];
  private race: boolean;

  constructor(root: HTMLElement, track: Track, race: boolean, mapKey = 'M') {
    this.root = root;
    this.race = race;
    const e = this.el;
    e.place = h('div', 'place');
    e.lap = h('div', 'lap');
    e.time = h('div', 'laptime');
    e.clock = h('div', 'clock');
    e.item = h('div', 'item', h('span', 'icon'), h('span', 'uses'));
    e.itemName = h('div', 'item-name');
    e.center = h('div', 'center');
    e.split = h('div', 'split');
    e.feed = h('div', 'feed');
    e.board = h('ol', 'board');
    e.speed = h('div', 'speed');
    e.lines = h('div', 'speedlines');
    e.keys = h(
      'div',
      'keys',
      `${race ? 'Setas conduzem · Espaço derrapa (mantém e larga para um turbo) · E/Shift usa o item (↓ atira para trás) · Enter ponto de controlo · H buzina · C câmara' : 'Setas conduzem · Espaço derrapa · Enter ponto de controlo · Backspace recomeça a volta · H buzina · C câmara'} · ${mapKey} mapa`,
    );

    // The minimap: the track drawn once, the cars on top each frame.
    const xs = track.samples.map((s) => s.p.x);
    const zs = track.samples.map((s) => s.p.z);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const W = 240;
    const scale = (W - 24) / (x1 - x0);
    const H = Math.round((z1 - z0) * scale + 24);
    this.toMap = (x, z) => [12 + (x - x0) * scale, 12 + (z - z0) * scale];
    this.map = h('canvas', 'minimap');
    this.base = document.createElement('canvas');
    // Drawn at twice the size, for sharp lines; the stylesheet sets its width (W, or less on a
    // phone), and its height follows.
    for (const c of [this.map, this.base]) {
      c.width = W * 2;
      c.height = H * 2;
    }
    const g = this.base.getContext('2d')!;
    g.scale(2, 2);
    g.lineJoin = g.lineCap = 'round';
    for (const [w, c] of [
      [9, 'rgba(10,12,18,0.55)'],
      [5, 'rgba(255,255,255,0.9)'],
    ] as const) {
      g.strokeStyle = c;
      g.lineWidth = w;
      g.beginPath();
      track.samples.forEach((s, i) => {
        const [x, y] = this.toMap(s.p.x, s.p.z);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.closePath();
      g.stroke();
    }
    const [sx, sy] = this.toMap(track.samples[0].p.x, track.samples[0].p.z);
    g.fillStyle = '#111';
    g.fillRect(sx - 1.5, sy - 6, 3, 12);

    root.replaceChildren(
      h('div', 'tl', race ? e.place : null, e.lap, e.time, e.clock),
      h('div', 'tc', e.item, e.itemName, e.split, e.feed),
      e.center,
      e.board,
      e.speed,
      this.map,
      e.keys,
      e.lines,
    );
    if (!race) e.item.style.display = 'none';
  }

  set(o: {
    place?: [number, number];
    lap: string;
    time: string;
    clock: string;
    item: { kind: ItemKind; uses: number } | null;
    rolling: boolean;
    speed: number;
    boosting: boolean;
    slip: number; // the slipstream's strength, 0 to 1
    shield: boolean; // the umbrella's open
    center: { text: string; cls: string } | null;
    split: { text: string; cls: string } | null;
  }): void {
    const e = this.el;
    if (o.place) {
      e.place.replaceChildren(h('b', '', String(o.place[0])), h('sup', '', 'º'), h('small', '', ` /${o.place[1]}`));
      e.place.dataset.p = String(o.place[0]);
    }
    e.lap.textContent = o.lap;
    e.time.textContent = o.time;
    e.clock.textContent = o.clock;
    const icon = e.item.querySelector('.icon')!;
    const uses = e.item.querySelector('.uses')!;
    e.item.classList.toggle('guarded', o.shield);
    if (o.rolling) {
      icon.textContent = ROLL_ICONS[Math.floor(performance.now() / 70) % ROLL_ICONS.length];
      e.item.classList.add('rolling');
      e.item.classList.remove('full');
      uses.textContent = '';
      e.itemName.textContent = '';
    } else if (o.item) {
      icon.textContent = ITEMS[o.item.kind].icon;
      e.item.classList.add('full');
      e.item.classList.remove('rolling');
      uses.textContent = o.item.uses > 1 ? `×${o.item.uses}` : '';
      e.itemName.textContent = `${ITEMS[o.item.kind].name}: ${ITEMS[o.item.kind].blurb}`;
    } else {
      icon.textContent = '';
      uses.textContent = '';
      e.item.classList.remove('full', 'rolling');
      e.itemName.textContent = '';
    }
    e.speed.textContent = String(Math.round(o.speed * 3.6));
    e.speed.dataset.boost = o.boosting ? '1' : '';
    e.lines.style.opacity = String(Math.max(o.boosting ? Math.min(0.9, (o.speed - 30) / 20) : 0, o.slip * 0.7));
    if (o.center) {
      e.center.textContent = o.center.text;
      e.center.className = `center ${o.center.cls}`;
    } else e.center.textContent = '';
    if (o.split) {
      e.split.textContent = o.split.text;
      e.split.className = `split ${o.split.cls}`;
    } else e.split.textContent = '';
    const now = performance.now();
    for (const f of [...this.feedItems]) {
      if (now > f.until) {
        f.el.remove();
        this.feedItems.splice(this.feedItems.indexOf(f), 1);
      }
    }
  }

  board(rows: BoardRow[]): void {
    this.el.board.replaceChildren(
      ...rows.map((r) => {
        const li = h('li', r.me ? 'me' : '', h('span', 'who', r.name), h('span', 'time', r.right));
        li.style.setProperty('--c', r.color);
        return li;
      }),
    );
  }

  // A line in the feed: what just happened, for a few seconds.
  feed(text: string, cls = ''): void {
    const el = h('div', `line ${cls}`, text);
    this.el.feed.prepend(el);
    this.feedItems.push({ el, until: performance.now() + 3500 });
    while (this.feedItems.length > 4) this.feedItems.shift()!.el.remove();
  }

  minimap(cars: CarInfo[], colorOf: (id: string) => string, me: string): void {
    const g = this.map.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.map.width, this.map.height);
    g.drawImage(this.base, 0, 0);
    g.scale(2, 2);
    for (const c of [...cars].sort((a) => (a.id === me ? 1 : -1))) {
      const [x, y] = this.toMap(c.x, c.z);
      g.beginPath();
      g.arc(x, y, c.id === me ? 6 : 4.5, 0, Math.PI * 2);
      g.fillStyle = colorOf(c.id);
      g.fill();
      g.lineWidth = c.id === me ? 2.5 : 1.5;
      g.strokeStyle = c.id === me ? '#ffe14d' : '#111';
      g.stroke();
    }
  }
}

// What the minimap round you draws: the streets (braga-map's lines, with their widths), the open
// world's edge, and the race's route. The full map names the streets too.
export interface MapLines {
  lines: { kind: number; w: number; name?: string | null; pts: [number, number][] }[];
  edge: [number, number][];
  route: { x: number; z: number }[];
}

export interface Dot {
  x: number;
  z: number;
  color: string;
}

// The minimap shows this far round you, and is this wide on the screen (the stylesheet can make it
// smaller), drawn at twice the size for sharp lines; what's on it is kept in cells of 100 m.
const RANGE = 220;
const SIZE = 200;
const CELL = 100;
const cellKey = (x: number, z: number) => (Math.floor(x / CELL) + 512) * 1024 + (Math.floor(z / CELL) + 512);

interface MapLine {
  w: number;
  minor: boolean;
  pts: [number, number][];
}

// The keys, at the bottom: driving round the city, and flying (body.flying hides the speed).
const KEYS = {
  drive: 'Setas conduzem · Espaço derrapa · Enter volta à rua · H buzina · C câmara · V voa · F a pé · M mapa · Esc menu',
  fly: 'WASD voa · ←→ vira · E sobe · Q desce · Shift mais depressa · arrasta o rato para olhar · V volta ao kart · M mapa · Esc menu',
  walk: 'WASD anda · o rato olha · Shift corre · Espaço salta · F volta ao kart · M mapa · Esc menu',
  // In a round, two lines (the stylesheet keeps the line break), faded away after its first 20 s.
  fight: 'WASD anda · o rato aponta · clique dispara · botão direito: mira, facada, lançar · R recarrega · 1–4 armas (Q a anterior, roda do rato)\nB compra · Shift caminha · Ctrl ou C agacha · Espaço salta · F inspeciona · Tab pontuação · M mapa · Esc menu',
};

// What the GPS says (task 107): the next turn's arrow, how far to it, what to do there, and how far
// there is to go.
export interface Guide {
  icon: string;
  dist: string;
  what: string;
  left: string;
}

// A distance as a GPS says it: to 10 m under a kilometre, to 100 m over.
export const howFar = (m: number) => (m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(Math.round(m / 100) / 10).toLocaleString('pt-PT')} km`);

const TURNS: Record<Step['turn'], [string, string]> = {
  left: ['⬅', 'Vira à esquerda'],
  right: ['➡', 'Vira à direita'],
  'slight-left': ['⬉', 'Ligeiramente à esquerda'],
  'slight-right': ['⬈', 'Ligeiramente à direita'],
  'sharp-left': ['↰', 'Curva apertada à esquerda'],
  'sharp-right': ['↱', 'Curva apertada à direita'],
  back: ['↶', 'Dá a volta'],
  roundabout: ['⟳', 'Na rotunda'],
  path: ['⤴', 'Sai da estrada: segue pelo caminho'],
};
// "na Rua …", "no Largo …": the street's article, by the word its name starts with.
const MASCULINE = /^(Largo|Campo|Caminho|Beco|Bairro|Parque|Terreiro|Passeio|Jardim|Adro|Monte|Lugar|Cais|Viaduto|Túnel|Acesso|Ramal)\b/;
export const onto = (name: string) => `${MASCULINE.test(name) ? 'no' : 'na'} ${name}`;

// The GPS's words for the next turn `dist` metres ahead (or none: straight on to the waypoint), with
// `left` metres to go.
export function guideOf(step: Step | null, dist: number, left: number): Guide {
  const togo = `Faltam ${howFar(left)}`;
  if (!step) return { icon: '⬆', dist: howFar(left), what: 'Segue até ao destino', left: togo };
  const [icon, words] = TURNS[step.turn];
  const what =
    step.turn === 'roundabout'
      ? `${words}, sai na ${step.exit}.ª saída${step.onto ? `, para ${onto(step.onto).replace(/^n/, '')}` : ''}`
      : step.turn === 'path'
        ? `${words}${step.onto ? ` (${step.onto})` : ''}`
        : `${words}${step.onto ? ` ${onto(step.onto)}` : ''}`;
  return { icon, dist: howFar(dist), what, left: togo };
}

// The screen while driving round the city (braga-map's decision 019): the speed, the street's name
// as you turn into it, a minimap of the area round you with the others on it, what just happened,
// and speed lines when boosting or in a slipstream. Flying, the minimap is round the camera.
export class RoamHud {
  readonly root: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  private map: HTMLCanvasElement;
  private feedItems: { el: HTMLElement; until: number }[] = [];
  private plateUntil = 0;
  private keysUntil = Infinity;
  private cells = new Map<number, MapLine[]>();
  private routeCells = new Map<number, { x: number; z: number }[][]>();
  private edge: [number, number][];

  constructor(root: HTMLElement, m: MapLines) {
    this.root = root;
    const e = this.el;
    e.plate = h('div', 'plate');
    e.feed = h('div', 'feed');
    e.speed = h('div', 'speed');
    e.lines = h('div', 'speedlines');
    e.keys = h('div', 'keys', KEYS.drive);
    e.dot = h('div', 'dot');
    e.gps = h('div', 'gps');
    this.map = h('canvas', 'minimap round');
    this.map.width = this.map.height = SIZE * 2;
    this.edge = m.edge;
    // A line goes into every cell one of its points is in, whole: drawn once however many of
    // them are in view.
    for (const l of m.lines) {
      if (l.kind > 8) continue;
      const it = { w: l.w, minor: l.kind >= 6, pts: l.pts };
      for (const k of new Set(l.pts.map(([x, z]) => cellKey(x, z)))) {
        const list = this.cells.get(k);
        if (list) list.push(it);
        else this.cells.set(k, [it]);
      }
    }
    for (let i = 0; i < m.route.length; i += 20) {
      const run = m.route.slice(i, i + 21);
      const k = cellKey(run[0].x, run[0].z);
      const list = this.routeCells.get(k);
      if (list) list.push(run);
      else this.routeCells.set(k, [run]);
    }
    root.replaceChildren(h('div', 'tc', e.plate, e.feed), e.speed, this.map, e.gps, e.keys, e.lines, e.dot);
  }

  set(o: { speed: number; boosting: boolean; slip: number }): void {
    const e = this.el;
    e.speed.textContent = String(Math.round(o.speed * 3.6));
    e.speed.dataset.boost = o.boosting ? '1' : '';
    e.lines.style.opacity = String(Math.max(o.boosting ? Math.min(0.9, (o.speed - 30) / 20) : 0, o.slip * 0.7));
    const now = performance.now();
    e.plate.classList.toggle('on', now < this.plateUntil);
    e.keys.classList.toggle('gone', now > this.keysUntil);
    for (const f of [...this.feedItems]) {
      if (now > f.until) {
        f.el.remove();
        this.feedItems.splice(this.feedItems.indexOf(f), 1);
      }
    }
  }

  // The keys for driving, flying, on foot, or in a round: as main.ts says them (the keys as the
  // settings bind them), or the defaults.
  keys(mode: keyof typeof KEYS, text: string = KEYS[mode]): void {
    this.el.keys.textContent = text;
    // A round's keys are many: they stay long enough to be read, then go out of the way.
    this.keysUntil = mode === 'fight' ? performance.now() + 20000 : Infinity;
  }

  // The area's edge on the minimap: the open world's, or a round's.
  setEdge(edge: [number, number][]): void {
    this.edge = edge;
  }

  // The GPS (task 107): the next turn's arrow, how far it is, what to do and onto which street, and
  // how far there is to go; or nothing.
  guide(g: Guide | null): void {
    const el = this.el.gps;
    const k = g ? `${g.icon}|${g.dist}|${g.what}|${g.left}` : '';
    if (el.dataset.k === k) return;
    el.dataset.k = k;
    el.classList.toggle('on', !!g);
    el.replaceChildren(...(g ? [h('div', 'gi', g.icon), h('div', 'gt', h('b', '', g.dist), h('span', '', g.what), h('small', '', g.left))] : []));
  }

  // The street's name, on a blue-and-white plate as Braga's are, for a few seconds.
  street(name: string): void {
    this.el.plate.textContent = name;
    this.plateUntil = performance.now() + 4000;
  }

  // A line in the feed: what just happened, for a few seconds.
  feed(text: string, cls = ''): void {
    const el = h('div', `line ${cls}`, text);
    this.el.feed.prepend(el);
    this.feedItems.push({ el, until: performance.now() + 4000 });
    while (this.feedItems.length > 4) this.feedItems.shift()!.el.remove();
  }

  // The streets round you, turned so the way you face is up; the others as dots, at the rim when
  // they're further off than it shows.
  minimap(me: { x: number; z: number; yaw: number }, others: Dot[], gps: Gps | null = null): void {
    const g = this.map.getContext('2d')!;
    const R = SIZE;
    const k = R / RANGE; // pixels a metre
    const a = -Math.PI / 2 - me.yaw;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, R * 2, R * 2);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 3, 0, Math.PI * 2);
    g.fillStyle = 'rgba(10,12,18,0.6)';
    g.fill();
    g.clip();
    g.setTransform(k * ca, k * sa, -k * sa, k * ca, R - k * (ca * me.x - sa * me.z), R - k * (sa * me.x + ca * me.z));
    g.lineJoin = g.lineCap = 'round';
    const seen = new Set<MapLine>();
    const near: MapLine[] = [];
    const runs: { x: number; z: number }[][] = [];
    const n = Math.ceil((RANGE * 1.1) / CELL);
    const ci = Math.floor(me.x / CELL);
    const cj = Math.floor(me.z / CELL);
    for (let i = ci - n; i <= ci + n; i++) {
      for (let j = cj - n; j <= cj + n; j++) {
        const key = (i + 512) * 1024 + (j + 512);
        for (const l of this.cells.get(key) ?? []) {
          if (seen.has(l)) continue;
          seen.add(l);
          near.push(l);
        }
        for (const run of this.routeCells.get(key) ?? []) runs.push(run);
      }
    }
    const path = (pts: [number, number][], close = false) => {
      g.beginPath();
      let first = true;
      for (const [x, z] of pts) {
        if (first) g.moveTo(x, z);
        else g.lineTo(x, z);
        first = false;
      }
      if (close) g.closePath();
    };
    // Outside the area, darker.
    g.beginPath();
    g.rect(me.x - RANGE * 2, me.z - RANGE * 2, RANGE * 4, RANGE * 4);
    this.edge.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
    g.closePath();
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fill('evenodd');
    // The streets at their widths, the paths and service roads fainter.
    for (const minor of [true, false]) {
      g.strokeStyle = minor ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.85)';
      for (const l of near) {
        if (l.minor !== minor) continue;
        g.lineWidth = Math.max(1.6 / k, l.w + (minor ? 0 : 2));
        path(l.pts);
        g.stroke();
      }
    }
    // The race's route, in gold.
    g.strokeStyle = 'rgba(255,211,77,0.75)';
    g.lineWidth = 2.2 / k;
    g.beginPath();
    for (const run of runs) run.forEach((p, i) => (i ? g.lineTo(p.x, p.z) : g.moveTo(p.x, p.z)));
    g.stroke();
    // The GPS's route (task 107), over it.
    if (gps?.route && gps.route.length > 1) trace(g, gps.route, (x, z) => [x, z], 4 / k);
    // The area's edge.
    g.strokeStyle = 'rgba(255,90,79,0.9)';
    g.lineWidth = 2.5 / k;
    g.setLineDash([6 / k, 5 / k]);
    path(this.edge, true);
    g.stroke();
    g.setLineDash([]);
    g.restore();

    // The others and north, on the screen's own axes.
    g.setTransform(1, 0, 0, 1, 0, 0);
    const onScreen = (x: number, z: number, rim: number) => {
      const dx = (x - me.x) * k;
      const dz = (z - me.z) * k;
      let sx = ca * dx - sa * dz;
      let sy = sa * dx + ca * dz;
      const d = Math.hypot(sx, sy);
      if (d > rim) {
        sx *= rim / d;
        sy *= rim / d;
      }
      return { x: R + sx, y: R + sy, far: d > rim };
    };
    for (const o of others) {
      const p = onScreen(o.x, o.z, R - 12);
      g.beginPath();
      g.arc(p.x, p.y, p.far ? 7 : 9, 0, Math.PI * 2);
      g.fillStyle = o.color;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = p.far ? '#ffffff' : '#111111';
      g.stroke();
    }
    if (gps?.mark) {
      const m = onScreen(gps.mark.x, gps.mark.z, R - 26);
      pin(g, m.x, m.y + 9, 0.9);
    }
    const north = onScreen(me.x, me.z - 1e5, R - 18);
    g.font = '800 22px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.fillText('N', north.x, north.y);
    // You, in the middle, pointing the way you face.
    g.beginPath();
    g.moveTo(R, R - 14);
    g.lineTo(R + 10, R + 11);
    g.lineTo(R, R + 5);
    g.lineTo(R - 10, R + 11);
    g.closePath();
    g.fillStyle = '#ffe14d';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#111111';
    g.stroke();
  }
}

// The full map (braga-map's task 106): M, or a tap on the minimap, opens it over the game, which goes
// on under it. The whole open world and the city round it, north up, from the minimap's lines: the
// streets at their widths and their names as you zoom in, the race's route, the arenas and the area's
// edge, and you and the others on it as on the minimap. The wheel or a pinch zooms, a drag pans.
export interface FullMapData extends MapLines {
  arenas: { id: string; name: string; pts: [number, number][] }[];
}

// What it opens on: its title; you; a place framed whole (a race's track, a round's arena), or else
// the city round you; the race's route; the area's edge (the open world's, or the round's); the
// round's arena; and the key that closes it as the settings bind it (none, '').
export interface MapOpening {
  title: string;
  at: { x: number; z: number };
  fit?: { x: number; z: number }[];
  route: { x: number; z: number }[];
  edge: [number, number][];
  arena?: string;
  key: string;
  // Whether a click puts the GPS's waypoint (task 107): round the city, not in a race or a round.
  pick?: boolean;
}

// The GPS on a map (task 107): the route from you to the waypoint, and the waypoint.
export interface Gps {
  route: [number, number][] | null;
  mark: { x: number; z: number } | null;
}

// The waypoint: a pin, its point at (x, y).
function pin(g: CanvasRenderingContext2D, x: number, y: number, s = 1): void {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(-3, -8, -9, -11, -9, -18);
  g.arc(0, -18, 9, Math.PI, 0);
  g.bezierCurveTo(9, -11, 3, -8, 0, 0);
  g.closePath();
  g.fillStyle = '#ff3d7f';
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.beginPath();
  g.arc(0, -18, 3.5, 0, Math.PI * 2);
  g.fillStyle = '#ffffff';
  g.fill();
  g.restore();
}

// The route on a map: blue, on a dark edge.
function trace(g: CanvasRenderingContext2D, pts: [number, number][], to: (x: number, z: number) => [number, number], w: number): void {
  g.lineJoin = g.lineCap = 'round';
  g.beginPath();
  pts.forEach(([x, z], i) => {
    const [sx, sy] = to(x, z);
    if (i) g.lineTo(sx, sy);
    else g.moveTo(sx, sy);
  });
  g.lineWidth = w * 1.7;
  g.strokeStyle = 'rgba(8,10,16,0.8)';
  g.stroke();
  g.lineWidth = w;
  g.strokeStyle = '#3da5ff';
  g.stroke();
}

// Round you, it opens with this many metres across the screen's shorter side.
const ACROSS = 1000;
// The streets' names: the big streets' from this many pixels a metre, every street's from this.
const NAMED_BIG = 0.5;
const NAMED_ALL = 1.4;
const NAME_FONT = '600 12px system-ui, sans-serif';
const BIG_FONT = '700 13px system-ui, sans-serif';
// A street's name is written along it about this many pixels apart.
const NAME_EVERY = 450;
// The scale's lengths, m.
const SCALES = [10, 20, 50, 100, 200, 500, 1000, 2000];

// A named street's line, its lengths along it (cum, len) for writing its name on it.
interface Label {
  name: string;
  big: boolean;
  pts: [number, number][];
  cum: number[];
  len: number;
  box: Bounds;
}

interface Street {
  w: number;
  minor: boolean;
  pts: [number, number][];
  box: Bounds;
}

export class FullMap {
  readonly el: HTMLElement;
  // The ✕, for main.ts to close it as M and Esc do.
  onClose = () => {};
  // A click (a tap) that didn't drag it, where pick allows: the waypoint put there, or null where it's
  // on the waypoint, to take it away.
  onPick = (_at: { x: number; z: number } | null) => {};
  private canvas: HTMLCanvasElement;
  private base = document.createElement('canvas');
  private title: HTMLElement;
  private keyHint: HTMLElement;
  private touchHint: HTMLElement;
  private streets: Street[] = [];
  private labels: Label[] = [];
  private arenas: FullMapData['arenas'];
  private bounds: Bounds;
  private o: MapOpening | null = null;
  private view: View = { x: 0, z: 0, k: 1 };
  // The view the map was last painted at (none: to be painted), and when a drag, a pinch or the wheel
  // last moved it.
  private painted: View | null = null;
  private movedAt = 0;
  private me = { x: 0, z: 0 };
  private fingers = new Map<number, { x: number; y: number }>();
  private widths = new Map<string, number>();
  // A finger or the mouse down alone, till it moves: a click, if it lifts first.
  private press: { id: number; x: number; y: number } | null = null;
  private mark: { x: number; z: number } | null = null;

  constructor(m: FullMapData) {
    this.arenas = m.arenas;
    for (const l of m.lines) {
      if (l.kind > 8 || l.pts.length < 2) continue;
      const box = boundsOf(l.pts.map(([x, z]) => ({ x, z })));
      this.streets.push({ w: l.w, minor: l.kind >= 6, pts: l.pts, box });
      if (!l.name) continue;
      const cum = lengths(l.pts);
      this.labels.push({ name: l.name, big: l.kind <= 4, pts: l.pts, cum, len: cum[cum.length - 1], box });
    }
    // The big streets named first, the longest first, so the others' names make way for theirs.
    this.labels.sort((a, b) => Number(b.big) - Number(a.big) || b.len - a.len);
    const b = boundsOf(m.edge.map(([x, z]) => ({ x, z })));
    for (const s of this.streets) {
      b.x0 = Math.min(b.x0, s.box.x0);
      b.x1 = Math.max(b.x1, s.box.x1);
      b.z0 = Math.min(b.z0, s.box.z0);
      b.z1 = Math.max(b.z1, s.box.z1);
    }
    this.bounds = b;

    this.canvas = h('canvas', 'fm-map');
    this.title = h('div', 'fm-title');
    this.keyHint = h('span', 'keys-only');
    this.touchHint = h('span', 'touch-only');
    const here = h('button', 'ghost small fm-here', '⌖ Onde estou');
    here.title = 'Pôr o mapa à tua volta';
    here.addEventListener('click', () => {
      const [W, H] = this.size();
      this.view = keep({ ...this.view, x: this.me.x, z: this.me.z }, limits(this.bounds, W, H));
    });
    const close = h('button', 'ghost small fm-close', '✕');
    close.title = 'Fechar o mapa';
    close.addEventListener('click', () => this.onClose());
    this.el = h('div', 'fullmap', this.canvas, h('div', 'fm-head', this.title, h('div', 'fm-hint', this.keyHint, this.touchHint), here, close));

    // A drag pans; two fingers zoom about their middle and take it with them; the wheel zooms about
    // the pointer. A click that doesn't drag it puts the waypoint, or takes it away.
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic event */
      }
      this.press = this.fingers.size ? null : { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      c.classList.add('dragging');
    });
    c.addEventListener('pointerup', (e) => {
      const p = this.press;
      this.press = null;
      if (!p || p.id !== e.pointerId || !this.o?.pick) return;
      const [W, H] = this.size();
      const m = this.mark;
      if (m) {
        const [mx, my] = toScreen(this.view, W, H, m.x, m.z);
        if (Math.hypot(e.clientX - mx, e.clientY - (my - 12)) < 18) return this.onPick(null);
      }
      const [x, z] = toMap(this.view, W, H, e.clientX, e.clientY);
      this.onPick({ x, z });
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.fingers.get(e.pointerId);
      if (!p) return;
      if (this.press && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 6) this.press = null;
      const [W, H] = this.size();
      const l = limits(this.bounds, W, H);
      const q = [...this.fingers].find(([id]) => id !== e.pointerId)?.[1];
      if (q) {
        const d0 = Math.hypot(p.x - q.x, p.y - q.y);
        const d1 = Math.hypot(e.clientX - q.x, e.clientY - q.y);
        const v = zoomAt(this.view, d0 > 0 ? d1 / d0 : 1, (p.x + q.x) / 2, (p.y + q.y) / 2, l);
        this.move(pan(v, (e.clientX - p.x) / 2, (e.clientY - p.y) / 2, l));
      } else this.move(pan(this.view, e.clientX - p.x, e.clientY - p.y, l));
      p.x = e.clientX;
      p.y = e.clientY;
    });
    for (const k of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      c.addEventListener(k, (e) => {
        this.fingers.delete(e.pointerId);
        if (!this.fingers.size) c.classList.remove('dragging');
      });
    }
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const [W, H] = this.size();
        const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1);
        this.move(zoomAt(this.view, Math.exp(-dy * 0.0015), e.clientX, e.clientY, limits(this.bounds, W, H)));
      },
      { passive: false },
    );
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get isOpen(): boolean {
    return !!this.o;
  }

  open(o: MapOpening): void {
    this.o = o;
    this.me = { x: o.at.x, z: o.at.z };
    this.title.textContent = o.title;
    this.keyHint.textContent = `Roda do rato aproxima e afasta · arrasta para mexer${o.pick ? ' · clica para pôr um destino' : ''} · ${o.key ? `${o.key} ou ` : ''}Esc fecha`;
    this.touchHint.textContent = `Dois dedos aproximam e afastam · arrasta para mexer${o.pick ? ' · toca para pôr um destino' : ''} · ✕ fecha`;
    // It isn't shown yet: the window's size is the map's.
    const W = innerWidth;
    const H = innerHeight;
    const l = limits(this.bounds, W, H);
    this.view = keep(o.fit?.length ? fit(boundsOf(o.fit), W, H, 0.8) : { x: o.at.x, z: o.at.z, k: Math.min(W, H) / ACROSS }, l);
    this.painted = null;
    this.fingers.clear();
  }

  close(): void {
    this.o = null;
    this.fingers.clear();
    this.press = null;
    this.canvas.classList.remove('dragging');
  }

  private move(v: View): void {
    this.view = v;
    this.movedAt = performance.now();
  }

  private size(): [number, number] {
    return [this.el.clientWidth || innerWidth, this.el.clientHeight || innerHeight];
  }

  // A frame while it's open: the map painted again only when the view has changed (while it's being
  // dragged or zoomed, the last painting moved with it, and painted afresh once it's still: a painting
  // takes several milliseconds), the GPS's route and waypoint, and you and the others on it every frame,
  // at its edge when they're off it.
  draw(me: { x: number; z: number; yaw: number }, others: Dot[], gps: Gps | null = null): void {
    if (!this.o) return;
    this.me = { x: me.x, z: me.z };
    this.mark = gps?.mark ?? null;
    const [W, H] = this.size();
    const r = Math.min(2, devicePixelRatio || 1);
    const c = this.canvas;
    const cw = Math.round(W * r);
    const ch = Math.round(H * r);
    if (c.width !== cw || c.height !== ch) {
      c.width = this.base.width = cw;
      c.height = this.base.height = ch;
      this.painted = null;
    }
    const v = this.view;
    let q = this.painted;
    if (!q || ((q.x !== v.x || q.z !== v.z || q.k !== v.k) && performance.now() - this.movedAt > 150)) {
      this.paint(W, H, r);
      q = this.painted = { ...v };
    }
    const g = c.getContext('2d')!;
    const s = v.k / q.k;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0b0e14';
    g.fillRect(0, 0, cw, ch);
    g.drawImage(this.base, r * (W / 2 - (W / 2) * s + (q.x - v.x) * v.k), r * (H / 2 - (H / 2) * s + (q.z - v.z) * v.k), cw * s, ch * s);
    g.setTransform(r, 0, 0, r, 0, 0);
    const onScreen = (x: number, z: number, m: number) => {
      const [sx, sy] = toScreen(v, W, H, x, z);
      const px = Math.min(W - m, Math.max(m, sx));
      const py = Math.min(H - m, Math.max(m, sy));
      return { x: px, y: py, off: px !== sx || py !== sy };
    };
    if (gps?.route && gps.route.length > 1) trace(g, gps.route, (x, z) => toScreen(v, W, H, x, z), 5);
    if (gps?.mark) {
      const m = onScreen(gps.mark.x, gps.mark.z, 22);
      pin(g, m.x, m.y + (m.off ? 12 : 0));
    }
    for (const o of others) {
      const p = onScreen(o.x, o.z, 14);
      g.beginPath();
      g.arc(p.x, p.y, p.off ? 5 : 7, 0, Math.PI * 2);
      g.fillStyle = o.color;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = p.off ? '#ffffff' : '#111111';
      g.stroke();
    }
    // You, pointing the way you face, in a halo to find at a glance.
    const p = onScreen(me.x, me.z, 18);
    g.save();
    g.translate(p.x, p.y);
    g.beginPath();
    g.arc(0, 0, 18, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,225,77,0.22)';
    g.fill();
    g.rotate(me.yaw + Math.PI / 2);
    g.beginPath();
    g.moveTo(0, -12);
    g.lineTo(9, 10);
    g.lineTo(0, 5);
    g.lineTo(-9, 10);
    g.closePath();
    g.fillStyle = '#ffe14d';
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = '#111111';
    g.stroke();
    g.restore();
  }

  // The map under you and the others: the area, the arenas, the streets, the route and the edge in
  // the map's metres; the names, the scale and north in the screen's pixels.
  private paint(W: number, H: number, r: number): void {
    const o = this.o!;
    const v = this.view;
    const g = this.base.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0b0e14';
    g.fillRect(0, 0, this.base.width, this.base.height);
    g.setTransform(r * v.k, 0, 0, r * v.k, r * (W / 2 - v.x * v.k), r * (H / 2 - v.z * v.k));
    const x0 = v.x - W / 2 / v.k;
    const x1 = v.x + W / 2 / v.k;
    const z0 = v.z - H / 2 / v.k;
    const z1 = v.z + H / 2 / v.k;
    const ring = (pts: [number, number][]) => {
      g.beginPath();
      pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
      g.closePath();
    };
    g.lineJoin = g.lineCap = 'round';
    // The area, lighter than the city round it; the arenas in orange (a round's, its area already, only
    // lightly).
    ring(o.edge);
    g.fillStyle = '#18202c';
    g.fill();
    for (const a of this.arenas) {
      ring(a.pts);
      g.fillStyle = a.id === o.arena ? 'rgba(255,140,60,0.1)' : 'rgba(255,140,60,0.16)';
      g.fill();
      g.lineWidth = (a.id === o.arena ? 2.5 : 1.5) / v.k;
      g.strokeStyle = 'rgba(255,150,70,0.9)';
      g.stroke();
    }
    // The streets at their widths, the paths and service roads fainter: those of a width in one
    // stroke.
    for (const minor of [true, false]) {
      const byWidth = new Map<number, Street[]>();
      for (const s of this.streets) {
        if (s.minor !== minor || s.box.x1 < x0 || s.box.x0 > x1 || s.box.z1 < z0 || s.box.z0 > z1) continue;
        const w = Math.max(1.2 / v.k, s.w + (minor ? 0 : 2));
        const list = byWidth.get(w);
        if (list) list.push(s);
        else byWidth.set(w, [s]);
      }
      g.strokeStyle = minor ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.86)';
      for (const [w, list] of byWidth) {
        g.lineWidth = w;
        g.beginPath();
        for (const s of list) s.pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
        g.stroke();
      }
    }
    // The race's route, in gold.
    if (o.route.length) {
      g.strokeStyle = 'rgba(255,211,77,0.85)';
      g.lineWidth = Math.max(3 / v.k, 2.5);
      g.beginPath();
      o.route.forEach((p, i) => (i ? g.lineTo(p.x, p.z) : g.moveTo(p.x, p.z)));
      g.stroke();
    }
    // The area's edge.
    g.strokeStyle = 'rgba(255,90,79,0.95)';
    g.lineWidth = 2.5 / v.k;
    g.setLineDash([8 / v.k, 6 / v.k]);
    ring(o.edge);
    g.stroke();
    g.setLineDash([]);

    g.setTransform(r, 0, 0, r, 0, 0);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    // Each name where it fits along its street and clear of the names put down before it (and of its
    // own name nearby): the arenas', then the streets'.
    const put: [number, number, number, number][] = [];
    const clear = (x: number, y: number, ax: number, ay: number) => !put.some(([px, py, qx, qy]) => Math.abs(px - x) < qx + ax && Math.abs(py - y) < qy + ay);
    const say = (text: string, x: number, y: number, a: number, fill: string) => {
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.lineWidth = 3.5;
      g.strokeStyle = 'rgba(8,10,16,0.9)';
      g.strokeText(text, 0, 0);
      g.fillStyle = fill;
      g.fillText(text, 0, 0);
      g.restore();
    };
    g.font = BIG_FONT;
    for (const a of this.arenas) {
      const c = boundsOf(a.pts.map(([x, z]) => ({ x, z })));
      const [x, y] = toScreen(v, W, H, (c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2);
      const text = v.k < 0.4 ? '🎯' : `🎯 ${a.name}`;
      const w = g.measureText(text).width;
      say(text, x, y, 0, '#ffb27a');
      put.push([x, y, w / 2 + 4, 9]);
    }
    if (v.k >= NAMED_BIG) {
      const near = new Map<string, [number, number][]>();
      for (const l of this.labels) {
        if ((!l.big && v.k < NAMED_ALL) || l.box.x1 < x0 || l.box.x0 > x1 || l.box.z1 < z0 || l.box.z0 > z1) continue;
        g.font = l.big ? BIG_FONT : NAME_FONT;
        const id = `${l.big}|${l.name}`;
        let w = this.widths.get(id);
        if (w === undefined) this.widths.set(id, (w = g.measureText(l.name).width));
        // Half the name's length, in metres along the street; written where the street runs nearly
        // straight that far either side.
        const half = (w / 2 + 6) / v.k;
        if (l.len < 2 * half) continue;
        const n = Math.max(1, Math.round((l.len * v.k) / NAME_EVERY));
        for (let i = 0; i < n; i++) {
          const s = Math.min(l.len - half, Math.max(half, (l.len * (i + 0.5)) / n));
          const [ax, az] = pointAt(l.pts, l.cum, s - half);
          const [bx, bz] = pointAt(l.pts, l.cum, s + half);
          if (Math.hypot(bx - ax, bz - az) < 1.85 * half) continue;
          const [x, y] = toScreen(v, W, H, ...pointAt(l.pts, l.cum, s));
          if (x < 0 || x > W || y < 0 || y > H) continue;
          let a = Math.atan2(bz - az, bx - ax);
          if (a > Math.PI / 2) a -= Math.PI;
          else if (a < -Math.PI / 2) a += Math.PI;
          const c = Math.abs(Math.cos(a));
          const sn = Math.abs(Math.sin(a));
          const hx = c * (w / 2 + 3) + sn * 8;
          const hy = sn * (w / 2 + 3) + c * 8;
          const same = near.get(l.name) ?? [];
          if (!clear(x, y, hx, hy) || same.some(([px, py]) => Math.hypot(px - x, py - y) < 380)) continue;
          put.push([x, y, hx, hy]);
          near.set(l.name, [...same, [x, y]]);
          say(l.name, x, y, a, l.big ? '#ffffff' : 'rgba(255,255,255,0.86)');
        }
      }
    }
    // The scale, bottom left, and north, bottom right.
    const m = SCALES.reduce((a, b) => (b * v.k <= 140 ? b : a), SCALES[0]);
    const len = m * v.k;
    const y = H - 22;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(24, y - 5);
    g.lineTo(24, y);
    g.lineTo(24 + len, y);
    g.lineTo(24 + len, y - 5);
    g.stroke();
    g.font = NAME_FONT;
    g.textAlign = 'left';
    say(m >= 1000 ? `${m / 1000} km` : `${m} m`, 24 + len + 8, y - 2, 0, '#ffffff');
    g.textAlign = 'center';
    g.font = BIG_FONT;
    say('▲', W - 30, H - 40, 0, '#ffffff');
    say('N', W - 30, H - 22, 0, '#ffffff');
  }
}

// A row of a round's scores: a fighter's kills, deaths and kills to the head, and in a round of teams
// which team they're on (0 or 1).
export interface ScoreRow {
  name: string;
  color: string;
  kills: number;
  deaths: number;
  hs: number;
  me: boolean;
  team?: number;
  // In a match: their money (your team-mates' only), and whether they're down this round.
  money?: number;
  dead?: boolean;
}

// A line of the kill feed: who put whom down, with what, whether in the head, and whether you were
// either of them.
export interface KillLine {
  by: string;
  byColor: string;
  victim: string;
  victimColor: string;
  w: Cause;
  head: boolean;
  mine: boolean;
}

// What the round's screen shows, as main.ts gives it every frame.
export interface FightView {
  started: boolean; // the round has begun (before it, a countdown in `center`)
  alive: boolean;
  health: number; // 0 to 100
  armour: number; // 0 to 100
  helmet: boolean;
  hand: WeaponId;
  mag: number; // rounds in the magazine (a gun's), else 0
  reserve: number;
  reloading: number | null; // how far through a reload, 0 to 1
  slots: { primary: GunId | null; secondary: GunId; nades: NadeId[] };
  clock: string;
  standing: string; // every one for themselves: your kills and the leader's; '' with teams
  teams: { a: number; b: number; mine: 0 | 1 } | null; // the teams' kills, and yours (0 is a)
  cross: { gap: number; show: boolean }; // the crosshair's gap from its middle in CSS pixels
  scope: number; // 0, or the scope's zoom level
  hurt: number; // 0 to 1, how red the screen's edge is
  from: { angle: number; a: number }[]; // where shots came from: clockwise from straight ahead (radians), and how strong
  flash: number; // 0 to 1, how white a flashbang has made the screen
  center: string;
  dead: { by: string; w: Cause; head: boolean; wait: number } | null; // put down: by whom, with what, back in `wait` s
  buyLeft: number; // seconds left to buy in after coming back (0: what's bought is for the next life)
  scores: ScoreRow[] | null; // the scores while Tab is held
  // A competitive match's (game/comp.ts), or null; and whether you're on foot round the city, where
  // nothing's at stake.
  comp?: CompView | null;
  free?: boolean;
}

// A match on the screen: each side's rounds and how many are up, yours, the round of how many, your
// money, the bomb (yours to carry, or planted), what you're planting or defusing and how far along,
// a line under the clock, and whether you have a defuse kit.
export interface CompView {
  rounds: Record<Side, number>;
  alive: Record<Side, number>;
  mine: Side;
  round: number;
  total: number;
  money: number;
  bomb: 'mine' | 'planted' | null;
  task: { text: string; k: number } | null;
  note: string;
  kit: boolean;
}

// The sides' names and colours, as Counter-Strike's.
export const SIDES: Record<Side, { name: string; short: string; color: string }> = {
  T: { name: 'Terroristas', short: 'T', color: '#e8a838' },
  CT: { name: 'Contraterroristas', short: 'CT', color: '#5aa0ff' },
};

// The buy menu in a match: your money, your side, whether it sells now (and why not), and whether
// you've a defuse kit.
export interface Shop {
  money: number;
  side: Side;
  open: boolean;
  why: string;
  kit: boolean;
}

// The two teams of a round of teams, as the scores and the clock name and colour them.
export const TEAMS = [
  { name: 'Equipa Azul', color: '#4aa8ff' },
  { name: 'Equipa Laranja', color: '#ff9636' },
] as const;

// Small silhouettes, in the kill feed, the weapons' list and the buy menu: each family of gun facing
// right (towards whoever it put down), the knife, a grenade, a fall, a head shot, and health and
// armour. Each is its width and a path 16 high. Built as SVG elements, never parsed from text.
type IconKind = Family | 'knife' | 'nade' | 'fall' | 'head' | 'health' | 'shield' | 'helmet';
const ICONS: Record<IconKind, [number, string]> = {
  pistol: [26, 'M2 3h21v1h2v3H12.5l-.8 1.6c-.3.6-.9.9-1.5.9H9.6L8.4 14.5H3.2L5 7.4 2 7z M9.6 8.5h1.8l.6-1.5H10z'],
  smg: [38, 'M1 5h7l1.5 1H24V4h2v1h7v2h4v2h-4v1H25l-1 1h-3.2l-1.6 4.5h-3l1.6-4.5H13l-1.2 3.2H9l1.2-3.2H8.4L7 9.5H1z'],
  rifle: [54, 'M1 5.5 10 4l2 1.2h16V3.6h3v1.6h9V6h7v1.6h6v1.6h-6v.6h-9v1h-5.2l-1.3 1.6h-3.2l-.6-1.6h-3.2c-.6 2.2-1.6 4-3 5.1l-3.3-.9c1.2-1 2-2.5 2.3-4.2H14l-1 2.6H9.6l.9-2.6-9.5 2.3z'],
  sniper: [62, 'M1 6.5 10 5l2 1h11V4.4h2V3h16v1.4h2V6h18v1.4H43V9h-9l-1 1.4h-3l-.6-1.4h-3.6l-1.2 3.2H21L22 9h-8l-1.4 2.6-11.6 2.2zM25 4.6h16V3.8H25z'],
  shotgun: [56, 'M1 6 10 4.6l2 1.2h11V5h32v1.6H38v1.2h7v2h-7v-1H25v1.4h-4l-1.2 2.4h-3.2l1-2.4H14l-1.4 2.2L1 13.2z'],
  heavy: [56, 'M1 6.2 9 4.6l2.4 1.4H18V3.6h10V6h14v1h9v1.6h4v1.6h-4V11H34l2.6 4.6h-1.8L32 11h-3v2.2h-8V11h-1.2l-1.4 3.6h-3.2l1.2-3.6H14l-1.6 2.6L1 12.8z'],
  knife: [34, 'M2 7.2h9.6l1.2-1.2h3.4C24 6 29 6.6 33 8.6c-3.6 1.4-9 2-16.6 2H12.8l-1.2-1.2H2c-.8 0-1.2-.4-1.2-1.1S1.2 7.2 2 7.2z'],
  nade: [14, 'M5.2 1.6h3.4v2H11v1.2l2 .8-.4 1-1.3-.5C12.4 7.2 13 8.6 13 10.2 13 13 10.8 15 7.6 15S2.2 13 2.2 10.2C2.2 7.6 3.6 5.6 5.2 4.8z'],
  fall: [14, 'M5 1h4v8h3.6L7 15 1.4 9H5z'],
  head: [16, 'M8 1.2c3.8 0 6.4 2.6 6.4 6 0 2-.9 3.6-2.3 4.6v2.8H3.9v-2.8C2.5 10.8 1.6 9.2 1.6 7.2c0-3.4 2.6-6 6.4-6zM5 6.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zm6 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM7 10.4l-.8 1.8h3.6L9 10.4z'],
  health: [16, 'M5.6 1.5h4.8v4.1h4.1v4.8h-4.1v4.1H5.6v-4.1H1.5V5.6h4.1z'],
  shield: [16, 'M8 .8 14.2 3v4.6c0 3.6-2.4 6.4-6.2 7.6C4.2 14 1.8 11.2 1.8 7.6V3z'],
  helmet: [16, 'M8 2.4c3.8 0 6.6 2.8 6.6 6.4v1H16v2H5.4C3 11.8 1.4 10.2 1.4 8.4 1.4 4.8 4.2 2.4 8 2.4z'],
};
const SVG_NS = 'http://www.w3.org/2000/svg';

// What replaceChildren takes of h()'s children: the ones that are there.
const kids = (...c: Child[]) => c.filter((k): k is Node | string => !!k);

function icon(k: IconKind, cls = ''): SVGSVGElement {
  const [w, d] = ICONS[k];
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', `0 0 ${w} 16`);
  s.setAttribute('class', `ic ic-${k}${cls ? ` ${cls}` : ''}`);
  s.setAttribute('aria-hidden', 'true');
  s.style.setProperty('--w', String(w / 16));
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  s.append(p);
  return s;
}

const iconOf = (w: Cause): IconKind => (w === 'fall' ? 'fall' : w === 'knife' ? 'knife' : isGun(w) ? GUNS[w].family : 'nade');

// The guns of each family, in the buy menu's order (a family's n-th is its key n).
const FAMILY_GUNS = Object.fromEntries(FAMILIES.map((f) => [f.id, GUN_IDS.filter((g) => GUNS[g].family === f.id)])) as Record<Family, GunId[]>;

// The buy menu's last tab, after the families: armour and grenades, in its keys' order.
type Gear = { kind: 'armour'; level: 1 | 2 } | { kind: 'nade'; id: NadeId } | { kind: 'kit' };
const GEAR: Gear[] = [{ kind: 'armour', level: 1 }, { kind: 'armour', level: 2 }, ...NADE_IDS.map((id) => ({ kind: 'nade' as const, id })), { kind: 'kit' }];
const GEAR_KEY = String(FAMILIES.length + 1);
type Tab = Family | 'gear';

// A key's digit, from the row above the letters or the number pad, or 0.
const digitOf = (code: string) => (/^(Digit|Numpad)[1-9]$/.test(code) ? Number(code.slice(-1)) : 0);

const pct = (hs: number, kills: number) => (kills > 0 ? `${Math.round((100 * hs) / kills)}%` : '–');

// The kill feed keeps a line this long (ms), and this many lines at most.
const FEED_LIFE = 5000;
const FEED_MAX = 6;

// What's on the screen in a round (braga-map's task 074), after Counter-Strike 2's: your health and
// armour bottom left, the ammunition and the weapon in your hand bottom right with your weapons above
// it, the clock (and the teams' kills) at the top, the kill feed top right, the crosshair opening as
// your shots would spread and the mark that says you hit, the screen's edge going red when you're hurt
// and an arc the way the shot came from, the scope, a flashbang's white, the panel that says who put
// you down, the scores (Tab), and the buy menu.
export class FightHud {
  readonly el: HTMLElement;
  // Every change made in the buy menu, as it's made, with the whole new loadout.
  onBuy: (kit: Loadout) => void = () => {};
  // The buy menu closed by itself: its ✕, Esc or B.
  onBuyClosed: () => void = () => {};
  // The dead panel's touch button asked for the buy menu. Unless main.ts says otherwise, it opens it
  // with the loadout it last showed, or else what the screen shows you carrying.
  onBuyAsked: () => void = () => this.buy(true, this.kit ?? this.carried());
  // In a match, a defuse kit bought.
  onKit: () => void = () => {};
  // A control's key as the settings bind it (main.ts), for the keys shown; and whether a key is the
  // buy menu's own (B, as bound), which closes it.
  keyOf: (id: string) => string = (id) => ({ slot1: '1', slot2: '2', slot3: '3', slot4: '4', buy: 'B' })[id] ?? '';
  isBuyKey: (code: string) => boolean = (code) => code === 'KeyB';
  // In a match: the shop (prices, money, your side); null when the money's unlimited.
  private shop: Shop | null = null;
  private e: Record<string, HTMLElement> = {};
  private arcs: HTMLElement[] = [];
  // What the screen last showed, by key, so a frame only touches what changed.
  private shown = new Map<string, string | number | boolean>();
  private feedLines: { el: HTMLElement; until: number }[] = [];
  private open = false;
  private kit: Loadout | null = null;
  private view: FightView | null = null;
  private tab: Tab = 'rifle';
  // The buy menu's keys, as Counter-Strike's: a first digit picks a family, a second one of its items.
  private picked = false;
  private buyLeft = 0;
  private famBtns = new Map<Tab, HTMLButtonElement>();
  private onKey = (ev: KeyboardEvent) => this.key(ev);

  constructor(root: HTMLElement) {
    const e = this.e;
    e.hurt = h('div', 'hurt');
    e.scope = h('div', 'scope', h('i', 'lens'));
    e.flash = h('div', 'flashed');
    e.from = h('div', 'from');
    e.cross = h('div', 'cross', h('i'), h('i'), h('i'), h('i'));
    e.marker = h('div', 'hitmark', h('i'), h('i'), h('i'), h('i'));

    e.clock = h('b', 'roundtime');
    e.standing = h('small', 'standing');
    e.teamA = h('span', 'team a', h('small', '', TEAMS[0].name), h('b'));
    e.teamB = h('span', 'team b', h('b'), h('small', '', TEAMS[1].name));
    e.top = h('div', 'fight-top', e.teamA, h('span', 'mid', e.clock, e.standing), e.teamB);
    e.killfeed = h('div', 'killfeed');

    e.hp = h('b');
    e.hpBar = h('i');
    e.ap = h('b');
    e.helmet = h('span', 'helm', icon('helmet'));
    e.health = h('div', 'vital hp', icon('health'), e.hp, h('span', 'meter', e.hpBar));
    e.armour = h('div', 'vital ap', icon('shield'), e.ap, e.helmet);
    e.vitals = h('div', 'vitals', e.health, e.armour);

    e.slots = h('div', 'slots');
    e.gunName = h('small', 'gun');
    e.mag = h('b', 'mag');
    e.reserve = h('span', 'reserve');
    e.reloadBar = h('i');
    e.reload = h('span', 'reload', h('span', 'meter', e.reloadBar));
    e.ammo = h('div', 'ammo', h('span', 'count', e.mag, e.reserve), e.gunName, e.reload);

    e.center = h('div', 'center');
    // A match's: your money, bottom left over your health; the bomb, if it's yours; and what you're
    // planting or defusing.
    e.money = h('div', 'money-now');
    e.taskText = h('span', 'tt');
    e.taskBar = h('i');
    e.task = h('div', 'task', e.taskText, h('span', 'meter', e.taskBar));
    e.note = h('small', 'note');
    e.bomb = h('div', 'bombmark', 'Bomba');

    e.deadBy = h('h2');
    e.deadHow = h('p', 'dp-how');
    e.deadWait = h('p', 'dp-wait');
    const ask = h('button', 'touch-only', '🛒 Armas');
    ask.addEventListener('click', () => this.onBuyAsked());
    e.deadKey = h('kbd', '', 'B');
    e.dead = h('div', 'deadpanel', h('p', 'dp-tag', 'Morto'), e.deadBy, e.deadHow, e.deadWait, h('p', 'dp-hint keys-only', e.deadKey, ' muda de armas'), ask);

    e.scores = h('div', 'scores');
    e.buy = this.buildBuy();

    e.top.querySelector('.mid')!.append(e.note);
    this.el = h('div', 'fight', e.hurt, e.scope, e.flash, e.from, e.cross, e.marker, e.top, e.killfeed, e.vitals, e.money, e.bomb, e.slots, e.ammo, e.center, e.task, e.dead, e.scores, e.buy);
    root.append(this.el);
    // Capture, ahead of the game's own keys: while the menu is open its digits and B and Esc are its.
    addEventListener('keydown', this.onKey, true);
  }

  // Whether `v` differs from what `key` last showed (and remembers it).
  private changed(key: string, v: string | number | boolean): boolean {
    if (this.shown.get(key) === v) return false;
    this.shown.set(key, v);
    return true;
  }

  private text(key: string, el: HTMLElement, s: string): void {
    if (this.changed(key, s)) el.textContent = s;
  }

  private cls(key: string, el: HTMLElement, name: string, on: boolean): void {
    if (this.changed(key, on)) el.classList.toggle(name, on);
  }

  private style(key: string, el: HTMLElement, prop: string, v: string): void {
    if (this.changed(key, v)) el.style.setProperty(prop, v);
  }

  set(v: FightView): void {
    const e = this.e;
    this.buyLeft = v.buyLeft;
    this.view = v;
    this.cls('dead', this.el, 'dead', !v.alive);
    this.cls('waiting', this.el, 'waiting', !v.started);

    // Health and armour.
    const hp = Math.max(0, Math.ceil(v.health));
    this.text('hp', e.hp, String(hp));
    this.style('hpBar', e.hpBar, 'transform', `scaleX(${Math.min(1, hp / 100)})`);
    this.cls('low', e.health, 'low', hp <= 25);
    const ap = Math.max(0, Math.ceil(v.armour));
    this.text('ap', e.ap, String(ap));
    this.cls('noap', e.armour, 'none', ap <= 0);
    this.cls('helmet', e.helmet, 'on', v.helmet && ap > 0);

    // The weapon in your hand: a gun's magazine and reserve, a grenade's count, the knife's nothing.
    const w = v.hand;
    const gun = isGun(w) ? GUNS[w] : null;
    this.text('gun', e.gunName, gun ? gun.name : w === 'knife' ? KNIFE.name : NADES[w as NadeId].name);
    if (gun) {
      this.text('mag', e.mag, String(v.mag));
      this.text('reserve', e.reserve, `/ ${v.reserve}`);
    } else {
      this.text('mag', e.mag, w === 'knife' ? '' : `×${v.slots.nades.filter((n) => n === w).length}`);
      this.text('reserve', e.reserve, '');
    }
    this.cls('empty', e.ammo, 'empty', !!gun && v.mag === 0 && v.reloading === null);
    this.cls('lowmag', e.ammo, 'low', !!gun && v.mag > 0 && v.mag <= Math.max(1, Math.floor(gun.mag * 0.2)));
    this.cls('reloading', e.ammo, 'reloading', v.reloading !== null);
    if (v.reloading !== null) this.style('reloadBar', e.reloadBar, 'transform', `scaleX(${Math.min(1, Math.max(0, v.reloading)).toFixed(3)})`);

    // Your weapons, Counter-Strike's slots: rebuilt only when what you carry or hold changes.
    const sk = `${v.slots.primary}|${v.slots.secondary}|${v.slots.nades.join(',')}|${w}`;
    if (this.changed('slots', sk)) this.drawSlots(v);

    // The clock, and the teams' kills or where you stand; in a match, each side's rounds and how many
    // of it are up, the round, and your money.
    this.text('clock', e.clock, v.clock);
    this.text('standing', e.standing, v.teams || v.comp ? '' : v.standing);
    this.cls('teams', e.top, 'teams', !!v.teams || !!v.comp);
    this.cls('free', this.el, 'free', !!v.free);
    const c = v.comp ?? null;
    this.cls('comp', this.el, 'comp', !!c);
    this.text('note', e.note, c ? c.note : '');
    this.text('deadKey', e.deadKey, this.keyOf('buy'));
    if (c) {
      const side = (el: HTMLElement, sd: Side, k: string) => {
        this.text(`${k}n`, el.querySelector('small')!, `${SIDES[sd].short} · ${c.alive[sd]} ${c.alive[sd] === 1 ? 'vivo' : 'vivos'}`);
        this.text(`${k}s`, el.querySelector('b')!, String(c.rounds[sd]));
        this.style(`${k}c`, el, '--tc', SIDES[sd].color);
        this.cls(`${k}m`, el, 'mine', c.mine === sd);
      };
      side(e.teamA, 'CT', 'ca');
      side(e.teamB, 'T', 'cb');
      this.text('money', e.money, `${c.money} €`);
      this.cls('bombMine', e.bomb, 'on', c.bomb === 'mine' && v.alive);
      this.cls('task', e.task, 'on', !!c.task);
      if (c.task) {
        this.cls('taskHint', e.task, 'hint', c.task.k <= 0);
        this.text('taskText', e.taskText, c.task.text);
        this.style('taskBar', e.taskBar, 'transform', `scaleX(${Math.min(1, Math.max(0, c.task.k)).toFixed(3)})`);
      }
    } else if (v.teams) {
      this.text('ta', e.teamA.querySelector('b')!, String(v.teams.a));
      this.text('tb', e.teamB.querySelector('b')!, String(v.teams.b));
      this.cls('mineA', e.teamA, 'mine', v.teams.mine === 0);
      this.cls('mineB', e.teamB, 'mine', v.teams.mine === 1);
    }

    // The crosshair, the scope and the screen's colours.
    const cross = v.alive && v.cross.show && v.scope === 0;
    this.cls('cross', e.cross, 'on', cross);
    if (cross) this.style('gap', e.cross, '--gap', `${Math.round(v.cross.gap)}px`);
    this.cls('scope', e.scope, 'on', v.alive && v.scope > 0);
    this.style('hurt', e.hurt, 'opacity', Math.min(1, Math.max(0, v.hurt)).toFixed(2));
    this.style('flash', e.flash, 'opacity', Math.min(1, Math.max(0, v.flash)).toFixed(2));
    while (this.arcs.length < v.from.length) {
      const arc = h('div', 'arc');
      this.arcs.push(arc);
      e.from.append(arc);
    }
    this.arcs.forEach((arc, i) => {
      const f = v.from[i];
      this.style(`arc${i}d`, arc, 'display', f ? 'block' : 'none');
      if (!f) return;
      this.style(`arc${i}t`, arc, 'transform', `translate(-50%, -50%) rotate(${f.angle.toFixed(3)}rad)`);
      this.style(`arc${i}a`, arc, 'opacity', Math.min(1, f.a).toFixed(2));
    });

    // The big text in the middle: a countdown's digits bigger.
    this.text('center', e.center, v.center);
    this.cls('centerBig', e.center, 'big', v.center.length > 0 && v.center.length <= 3);

    // Put down: by whom, with what, and when you're back.
    if (v.dead) {
      const d = v.dead;
      if (this.changed('deadKey', `${d.by}|${d.w}|${d.head}`)) {
        e.deadBy.replaceChildren(...(d.by ? ['Eliminado por ', h('b', '', d.by)] : [d.w === 'fall' ? 'Caíste' : 'Morreste']));
        e.deadHow.replaceChildren(...kids(icon(iconOf(d.w)), h('span', '', d.w === 'fall' ? 'Uma queda' : nameOf(d.w)), d.head ? h('span', 'headshot', icon('head'), 'na cabeça') : null));
      }
      const s = Math.ceil(d.wait);
      // In a match nobody comes back till the next round.
      this.text('deadWait', e.deadWait, d.wait < 0 ? 'Voltas na próxima ronda' : s > 0 ? `Voltas em ${s} s` : 'A voltar…');
    }
    this.cls('deadOn', e.dead, 'on', !!v.dead);

    // The buy menu's time to buy in.
    if (this.open) this.drawTill();

    // The scores, only when they change.
    const key = v.scores ? JSON.stringify(v.scores) : '';
    if (this.changed('scores', key)) this.drawScores(v.scores, !!v.teams || !!v.comp, !!v.comp, v.comp ? [v.comp.rounds.CT, v.comp.rounds.T] : null);

    // The kill feed's old lines go.
    if (this.feedLines.length) {
      const now = performance.now();
      while (this.feedLines.length && now > this.feedLines[0].until) this.feedLines.shift()!.el.remove();
    }
  }

  private drawSlots(v: FightView): void {
    const row = (key: string, ic: SVGSVGElement, name: string, on: boolean, extra: Node | null = null) =>
      h('div', `slot${on ? ' on' : ''}`, h('span', 'key keys-only', key), extra, h('span', 'name', name), ic);
    const w = v.hand;
    const nades = v.slots.nades;
    this.e.slots.replaceChildren(
      ...kids(
      v.slots.primary ? row(this.keyOf('slot1'), icon(GUNS[v.slots.primary].family), GUNS[v.slots.primary].name, w === v.slots.primary) : null,
      row(this.keyOf('slot2'), icon('pistol'), GUNS[v.slots.secondary].name, w === v.slots.secondary),
      row(this.keyOf('slot3'), icon('knife'), KNIFE.name, w === 'knife'),
      nades.length ? row(this.keyOf('slot4'), icon('nade'), isNade(w) ? NADES[w].name : 'Granadas', isNade(w), h('span', 'pips', ...nades.map((n) => h('i', `pip ${n}${n === w ? ' on' : ''}`)))) : null,
      ),
    );
  }

  // The scores: one table, or one a team; in a match one a side (a row's `team` then 0 for the
  // Counter-Terrorists, 1 for the Terrorists), with the rounds won.
  private drawScores(rows: ScoreRow[] | null, teams: boolean, comp = false, rounds: [number, number] | null = null): void {
    const s = this.e.scores;
    s.classList.toggle('on', !!rows);
    if (!rows) return;
    const sorted = [...rows].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const money = rows.some((r) => r.money !== undefined);
    const table = (list: ScoreRow[], title: Node[], color: string | null) => {
      const t = h(
        'div',
        'table',
        h('div', 'title', ...title),
        h('div', `row head${money ? ' cashed' : ''}`, h('span', 'who', 'Jogador'), money ? h('span', 'cash', 'Dinheiro') : null, h('span', '', 'Abates'), h('span', '', 'Mortes'), h('span', 'hs', '% cabeça')),
        ...list.map((r) => {
          const el = h('div', `row${r.me ? ' me' : ''}${r.dead ? ' down' : ''}${money ? ' cashed' : ''}`, h('span', 'who', h('i', 'sw'), h('span', 'nm', r.name)), money ? h('span', 'cash', r.money === undefined ? '' : `${r.money} €`) : null, h('span', '', String(r.kills)), h('span', '', String(r.deaths)), h('span', 'hs', pct(r.hs, r.kills)));
          el.style.setProperty('--c', r.color);
          return el;
        }),
      );
      if (color) t.style.setProperty('--team', color);
      return t;
    };
    if (teams || rows.some((r) => r.team !== undefined)) {
      s.replaceChildren(
        h('div', 'tables', ...(comp ? [SIDES.CT, SIDES.T] : TEAMS).map((t, i) => {
          const list = sorted.filter((r) => (r.team ?? 0) === i);
          const kills = list.reduce((n, r) => n + r.kills, 0);
          return table(list, [h('span', '', t.name), h('b', '', String(comp && rounds ? rounds[i] : kills))], t.color);
        })),
      );
    } else s.replaceChildren(table(sorted, [h('span', '', 'Pontuação'), h('small', '', 'cada um por si')], null));
  }

  // Your shot hit someone: the mark round the crosshair, red for the head, bigger and longer for a kill.
  hit(head: boolean, kill: boolean): void {
    const m = this.e.marker;
    m.className = `hitmark${head ? ' head' : ''}${kill ? ' kill' : ''}`;
    for (const a of m.getAnimations()) a.cancel();
    m.animate(
      [
        { opacity: 1, transform: `scale(${kill ? 1.25 : 1})` },
        { opacity: 1, offset: 0.55 },
        { opacity: 0, transform: 'scale(1)' },
      ],
      { duration: kill ? 520 : 240, easing: 'ease-out' },
    );
  }

  // A line in the kill feed, top right: the killer in their colour, the weapon, a head for a head
  // shot, the victim in theirs; outlined in red when you were either.
  kill(l: KillLine): void {
    const by = h('span', 'who', l.by);
    by.style.color = l.byColor;
    const victim = h('span', 'who', l.victim);
    victim.style.color = l.victimColor;
    const w = icon(iconOf(l.w));
    const weapon = h('span', 'w', w);
    weapon.title = nameOf(l.w);
    const el = h('div', `kl${l.mine ? ' mine' : ''}`, l.by && l.w !== 'fall' ? by : null, weapon, l.head ? icon('head', 'hs') : null, victim);
    this.e.killfeed.append(el);
    this.feedLines.push({ el, until: performance.now() + FEED_LIFE });
    while (this.feedLines.length > FEED_MAX) this.feedLines.shift()!.el.remove();
  }

  // What the screen last showed you carrying, as a loadout.
  private carried(): Loadout {
    const v = this.view;
    if (!v) return { primary: null, secondary: 'usp', nades: [], armour: 0 };
    return { primary: v.slots.primary, secondary: v.slots.secondary, nades: [...v.slots.nades], armour: v.helmet ? 2 : v.armour > 0 ? 1 : 0 };
  }

  get buying(): boolean {
    return this.open;
  }

  // Opens or closes the buy menu, showing `kit` as what you have.
  buy(open: boolean, kit: Loadout): void {
    this.kit = { ...kit, nades: [...kit.nades] };
    if (open && !this.open) {
      this.tab = kit.primary ? GUNS[kit.primary].family : 'rifle';
      this.picked = false;
    }
    this.open = open;
    this.el.classList.toggle('buying', open);
    this.e.buy.classList.toggle('on', open);
    if (open) this.drawBuy();
  }

  // In a match, the shop as it is now (null: the money's unlimited); the menu drawn again if it's open
  // and anything it shows changed.
  setShop(s: Shop | null): void {
    const was = JSON.stringify(this.shop);
    this.shop = s ? { ...s } : null;
    if (this.open && was !== JSON.stringify(this.shop)) this.drawBuy();
  }

  private close(): void {
    if (!this.open || !this.kit) return;
    this.buy(false, this.kit);
    this.onBuyClosed();
  }

  // A change asked for. With unlimited money it's yours at once; in a match main.ts buys it (or not),
  // and shows the menu again with what you have.
  private change(kit: Loadout): void {
    if (!this.shop) {
      this.kit = kit;
      this.drawBuy();
    }
    this.onBuy({ ...kit, nades: [...kit.nades] });
  }

  // Whether the shop sells an item now, as it would leave you: on your side, and within your money.
  private affords(want: Loadout): boolean {
    const s = this.shop;
    if (!s || !this.kit) return true;
    return s.open && priceOf(this.kit, want) <= s.money;
  }

  // A gun to its slot, or a piece of the gear's tab: armour on or off, a grenade more (or, when no
  // more fit, none of that kind); in a match only what's bought, never sold back.
  private take(item: GunId | Gear): void {
    const k = this.kit;
    if (!k) return;
    const shop = this.shop;
    if (typeof item === 'string') {
      const g = GUNS[item];
      if (shop && !sells(shop.side, item)) return;
      const want = g.slot === 'primary' ? { ...k, primary: item } : { ...k, secondary: item };
      if ((g.slot === 'primary' ? k.primary : k.secondary) === item || !this.affords(want)) return;
      this.change(want);
    } else if (item.kind === 'kit') {
      if (shop && shop.side === 'CT' && !shop.kit && shop.open && shop.money >= COMP.kit) this.onKit();
    } else if (item.kind === 'armour') {
      if (shop) {
        if (k.armour < item.level && this.affords({ ...k, armour: item.level })) this.change({ ...k, armour: item.level });
      } else this.change({ ...k, armour: k.armour === item.level ? 0 : item.level });
    } else {
      const have = k.nades.filter((n) => n === item.id).length;
      const want = { ...k, nades: [...k.nades, item.id] };
      if (have < NADES[item.id].max && k.nades.length < NADES_MAX && this.affords(want)) this.change(want);
      else if (have > 0 && !shop) this.change({ ...k, nades: k.nades.filter((n) => n !== item.id) });
    }
  }

  private drop(id: NadeId): void {
    const k = this.kit;
    const i = k ? k.nades.lastIndexOf(id) : -1;
    if (k && i >= 0 && !this.shop) this.change({ ...k, nades: k.nades.filter((_, j) => j !== i) });
  }

  // The buy menu's own keys while it's open, ahead of the game's: digits, Backspace, the buy key and Esc.
  private key(ev: KeyboardEvent): void {
    if (!this.open || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const d = digitOf(ev.code);
    const shut = ev.code === 'Escape' || this.isBuyKey(ev.code);
    if (!d && !shut && ev.code !== 'Backspace') return;
    // Every digit is the menu's while it's open, even one that picks nothing: none switches weapons.
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (ev.repeat) return;
    if (shut) this.close();
    else if (ev.code === 'Backspace') {
      this.picked = false;
      this.drawBuy();
    } else if (!this.picked) {
      const tab = d === FAMILIES.length + 1 ? 'gear' : FAMILIES[d - 1]?.id;
      if (!tab) return;
      this.tab = tab;
      this.picked = true;
      this.drawBuy();
    } else {
      const items = this.tab === 'gear' ? this.gear() : FAMILY_GUNS[this.tab];
      const item = items[d - 1];
      if (!item) return;
      this.picked = false;
      this.take(item);
      this.drawBuy();
    }
  }

  // The gear's tab: the defuse kit only in a match, a Counter-Terrorist's.
  private gear(): Gear[] {
    return GEAR.filter((g) => g.kind !== 'kit' || this.shop?.side === 'CT');
  }

  private buildBuy(): HTMLElement {
    const e = this.e;
    e.till = h('p', 'till');
    const x = h('button', 'close', '✕');
    x.title = 'Fechar';
    x.addEventListener('click', () => this.close());
    const fams = h(
      'nav',
      'fams',
      ...[...FAMILIES.map((f) => ({ id: f.id as Tab, name: f.name, key: f.key })), { id: 'gear' as Tab, name: 'Equipamento', key: GEAR_KEY }].map((f) => {
        const b = h('button', 'fam', h('span', 'key keys-only', f.key), f.id === 'gear' ? icon('shield') : icon(f.id as Family), h('span', 'name', f.name));
        b.addEventListener('click', () => {
          this.tab = f.id;
          this.picked = false;
          this.drawBuy();
        });
        this.famBtns.set(f.id, b);
        return b;
      }),
    );
    e.items = h('div', 'items');
    e.kit = h('div', 'kit');
    e.wallet = h('span', 'money', h('small', '', 'Dinheiro'), '∞ €');
    e.buyHint = h('span', 'hint keys-only');
    const panel = h(
      'div',
      'buy-panel',
      h('header', '', h('h2', '', 'Armas'), e.till, e.wallet, x),
      h('div', 'buy-body', fams, e.items),
      h('footer', '', h('span', 'lbl', 'Levas'), e.kit, e.buyHint),
    );
    const el = h('div', 'buy', panel);
    // Clicks in the menu are its own: none reaches the game, to fire or to take the pointer back.
    for (const t of ['mousedown', 'mouseup', 'click', 'contextmenu'] as const) el.addEventListener(t, (ev) => ev.stopPropagation());
    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
    return el;
  }

  private drawTill(): void {
    const shop = this.shop;
    const s = Math.ceil(this.buyLeft);
    const key = shop ? `${shop.open}|${shop.why}|${s}` : this.view?.free ? 'free' : s;
    if (!this.changed('till', key)) return;
    const t = this.e.till;
    if (shop) {
      t.textContent = shop.open ? `Tempo de compra: ${s} s` : shop.why;
      t.classList.toggle('later', !shop.open);
    } else if (this.view?.free) {
      t.textContent = 'Pela cidade: compra quando quiseres';
      t.classList.remove('later');
    } else {
      t.textContent = s > 0 ? `Tempo de compra: ${s} s` : 'Fica para a próxima vida';
      t.classList.toggle('later', s <= 0);
    }
  }

  private drawBuy(): void {
    const e = this.e;
    const k = this.kit;
    if (!k) return;
    const shop = this.shop;
    this.shown.delete('till');
    this.drawTill();
    e.wallet.replaceChildren(h('small', '', 'Dinheiro'), shop ? `${shop.money} €` : '∞ €');
    e.buyHint.replaceChildren(h('kbd', '', '1–7'), ' família, depois a arma · ', h('kbd', '', this.keyOf('buy') || 'B'), ' fecha');
    for (const [id, b] of this.famBtns) b.classList.toggle('on', id === this.tab);
    e.items.classList.toggle('picking', this.picked);
    // A card's state in a match: not for your side, more than your money, or the shop shut.
    const why = (want: Loadout, have: boolean, side: boolean) => (!shop || have ? '' : !side ? 'other' : !this.affords(want) ? 'cant' : '');
    const card = (n: number, ic: SVGSVGElement, name: string, price: number, blurb: string, have: boolean, cls = '', ...extra: Child[]) =>
      h('button', `card${have ? ' have' : ''}${cls ? ` ${cls}` : ''}`, h('span', 'key keys-only', String(n)), have ? h('span', 'tick', 'Tens') : null, ic, h('b', 'name', name), h('span', 'price', `${price} €`), h('small', 'blurb', blurb), ...extra);
    if (this.tab === 'gear') {
      const total = k.nades.length;
      const gear = this.gear();
      e.items.replaceChildren(
        h('p', 'sect', 'Proteção'),
        ...GEAR.slice(0, 2).map((g, i) => {
          const lvl = (g as { level: 1 | 2 }).level;
          const a = lvl === 1 ? ARMOUR.vest : ARMOUR.helmet;
          const price = shop && lvl === 2 && k.armour === 1 ? COMP.helmetOnly : a.price;
          const have = shop ? k.armour >= lvl : k.armour === lvl;
          const b = card(i + 1, icon(lvl === 1 ? 'shield' : 'helmet'), a.name, price, lvl === 1 ? '100 de armadura no corpo' : 'O corpo e a cabeça', have, why({ ...k, armour: lvl }, have, true));
          b.addEventListener('click', () => this.take(g));
          return b;
        }),
        h('p', 'sect', `Granadas `, h('small', '', `${total} de ${NADES_MAX}`)),
        ...NADE_IDS.map((id, i) => {
          const nd = NADES[id];
          const have = k.nades.filter((n) => n === id).length;
          const full = have < nd.max && total >= NADES_MAX;
          const pips = h('span', 'pips', ...Array.from({ length: nd.max }, (_, j) => h('i', `pip ${id}${j < have ? ' on' : ''}`)));
          const minus = have > 0 && !shop ? h('span', 'minus', '−') : null;
          minus?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.drop(id);
          });
          const maxed = have >= nd.max;
          const b = card(i + 3, icon('nade', id), nd.name, nd.price, nd.blurb, have > 0, `nade${full ? ' full' : ''} ${maxed && shop ? '' : why({ ...k, nades: [...k.nades, id] }, false, true)}`, pips, minus);
          if (minus) minus.title = 'Tirar uma';
          b.addEventListener('click', () => this.take({ kind: 'nade', id }));
          return b;
        }),
        ...(gear.some((g) => g.kind === 'kit')
          ? [
              h('p', 'sect', 'Contraterroristas'),
              (() => {
                const have = !!shop?.kit;
                const b = card(GEAR.length, icon('shield'), 'Kit de desativação', COMP.kit, 'Desativa a bomba em 5 s', have, have ? '' : !shop || (shop.open && shop.money >= COMP.kit) ? '' : 'cant');
                b.addEventListener('click', () => this.take({ kind: 'kit' }));
                return b;
              })(),
            ]
          : []),
      );
    } else {
      e.items.replaceChildren(
        ...FAMILY_GUNS[this.tab].map((id, i) => {
          const g = GUNS[id];
          const mine = k.primary === id || k.secondary === id;
          const side = !shop || sells(shop.side, id);
          const want = g.slot === 'primary' ? { ...k, primary: id } : { ...k, secondary: id };
          const only = !side ? (shop!.side === 'T' ? ' · só para os CT' : ' · só para os T') : '';
          const b = card(i + 1, icon(g.family), g.name, g.price, g.blurb, mine, why(want, mine, side), h('span', 'spec', `${g.mag} / ${g.reserve}`, g.slot === 'secondary' ? ' · secundária' : '', only));
          b.addEventListener('click', () => this.take(id));
          return b;
        }),
      );
    }
    // What you'll come back with.
    const chip = (ic: SVGSVGElement, name: string, ...extra: Child[]) => h('span', 'carry', ic, h('span', '', name), ...extra);
    const counts = NADE_IDS.map((id) => [id, k.nades.filter((n) => n === id).length] as const).filter(([, n]) => n > 0);
    let drop: HTMLElement | null = null;
    if (k.primary && !shop) {
      drop = h('span', 'x', '✕');
      drop.title = 'Largar a arma principal';
      drop.addEventListener('click', () => this.change({ ...k, primary: null }));
    }
    e.kit.replaceChildren(
      ...kids(
        k.primary ? chip(icon(GUNS[k.primary].family), GUNS[k.primary].name, drop) : h('span', 'carry none', 'Sem arma principal'),
        chip(icon('pistol'), GUNS[k.secondary].name),
        k.armour ? chip(icon(k.armour === 2 ? 'helmet' : 'shield'), k.armour === 2 ? ARMOUR.helmet.name : ARMOUR.vest.name) : null,
        ...counts.map(([id, n]) => chip(icon('nade', id), n > 1 ? `${NADES[id].name} ×${n}` : NADES[id].name)),
        shop?.kit ? chip(icon('shield'), 'Kit de desativação') : null,
      ),
    );
  }

  remove(): void {
    removeEventListener('keydown', this.onKey, true);
    this.el.remove();
  }
}
