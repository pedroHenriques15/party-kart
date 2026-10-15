// What's on the screen while you drive. In a race (Hud): place and lap, the item slot, the clock, the
// minimap, the order, what just happened to whom, the speed, and speed lines when boosting or in a
// slipstream. Round the city (RoamHud): the speed, the street's name, a minimap round you, the feed.
import type { CarInfo } from './game/arena.ts';
import { ITEMS, type ItemKind } from './game/items.ts';
import type { Track } from './track/track.ts';

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

  constructor(root: HTMLElement, track: Track, race: boolean) {
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
      race ? 'Setas conduzem · Espaço derrapa (mantém e larga para um turbo) · E/Shift usa o item (↓ atira para trás) · Enter ponto de controlo · H buzina · C câmara' : 'Setas conduzem · Espaço derrapa · Enter ponto de controlo · Backspace recomeça a volta · H buzina · C câmara',
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
// world's edge, and the race's route.
export interface MapLines {
  lines: { kind: number; w: number; pts: [number, number][] }[];
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

// The screen while driving round the city (braga-map's decision 019): the speed, the street's name
// as you turn into it, a minimap of the area round you with the others on it, what just happened,
// and speed lines when boosting or in a slipstream.
export class RoamHud {
  readonly root: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  private map: HTMLCanvasElement;
  private feedItems: { el: HTMLElement; until: number }[] = [];
  private plateUntil = 0;
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
    e.keys = h('div', 'keys', 'Setas conduzem · Espaço derrapa · Enter volta à rua · H buzina · C câmara · Esc menu');
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
    root.replaceChildren(h('div', 'tc', e.plate, e.feed), e.speed, this.map, e.keys, e.lines);
  }

  set(o: { speed: number; boosting: boolean; slip: number }): void {
    const e = this.el;
    e.speed.textContent = String(Math.round(o.speed * 3.6));
    e.speed.dataset.boost = o.boosting ? '1' : '';
    e.lines.style.opacity = String(Math.max(o.boosting ? Math.min(0.9, (o.speed - 30) / 20) : 0, o.slip * 0.7));
    const now = performance.now();
    e.plate.classList.toggle('on', now < this.plateUntil);
    for (const f of [...this.feedItems]) {
      if (now > f.until) {
        f.el.remove();
        this.feedItems.splice(this.feedItems.indexOf(f), 1);
      }
    }
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
  minimap(me: { x: number; z: number; yaw: number }, others: Dot[]): void {
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
