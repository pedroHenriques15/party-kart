// What's on the screen while you drive. In a race (Hud): place and lap, the item slot, the clock, the
// minimap, the order, what just happened to whom, the speed, and speed lines when boosting or in a
// slipstream. Round the city (RoamHud): the speed, the street's name, a minimap round you, the feed;
// on foot, a dot in the middle of the screen for the speed.
import type { CarInfo } from './game/arena.ts';
import { ARMOUR, FAMILIES, GUN_IDS, GUNS, isGun, isNade, KNIFE, NADE_IDS, NADES, NADES_MAX, nameOf, type Cause, type Family, type GunId, type Loadout, type NadeId, type WeaponId } from './game/arsenal.ts';
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

// The keys, at the bottom: driving round the city, and flying (body.flying hides the speed).
const KEYS = {
  drive: 'Setas conduzem · Espaço derrapa · Enter volta à rua · H buzina · C câmara · V voa · F a pé · Esc menu',
  fly: 'WASD voa · ←→ vira · E sobe · Q desce · Shift mais depressa · arrasta o rato para olhar · V volta ao kart · Esc menu',
  walk: 'WASD anda · o rato olha · Shift corre · Espaço salta · F volta ao kart · Esc menu',
  // In a round, two lines (the stylesheet keeps the line break), faded away after its first 20 s.
  fight: 'WASD anda · o rato aponta · clique dispara · botão direito: mira, facada, lançar · R recarrega · 1–4 armas (Q a anterior, roda do rato)\nB compra · Shift caminha · Ctrl ou C agacha · Espaço salta · F inspeciona · Tab pontuação · Esc menu',
};

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
    root.replaceChildren(h('div', 'tc', e.plate, e.feed), e.speed, this.map, e.keys, e.lines, e.dot);
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

  // The keys for driving, flying, on foot, or in a round.
  keys(mode: keyof typeof KEYS): void {
    this.el.keys.textContent = KEYS[mode];
    // A round's keys are many: they stay long enough to be read, then go out of the way.
    this.keysUntil = mode === 'fight' ? performance.now() + 20000 : Infinity;
  }

  // The area's edge on the minimap: the open world's, or a round's.
  setEdge(edge: [number, number][]): void {
    this.edge = edge;
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
type Gear = { kind: 'armour'; level: 1 | 2 } | { kind: 'nade'; id: NadeId };
const GEAR: Gear[] = [{ kind: 'armour', level: 1 }, { kind: 'armour', level: 2 }, ...NADE_IDS.map((id) => ({ kind: 'nade' as const, id }))];
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

    e.deadBy = h('h2');
    e.deadHow = h('p', 'dp-how');
    e.deadWait = h('p', 'dp-wait');
    const ask = h('button', 'touch-only', '🛒 Armas');
    ask.addEventListener('click', () => this.onBuyAsked());
    e.dead = h('div', 'deadpanel', h('p', 'dp-tag', 'Morto'), e.deadBy, e.deadHow, e.deadWait, h('p', 'dp-hint keys-only', h('kbd', '', 'B'), ' muda de armas'), ask);

    e.scores = h('div', 'scores');
    e.buy = this.buildBuy();

    this.el = h('div', 'fight', e.hurt, e.scope, e.flash, e.from, e.cross, e.marker, e.top, e.killfeed, e.vitals, e.slots, e.ammo, e.center, e.dead, e.scores, e.buy);
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

    // The clock, and the teams' kills or where you stand.
    this.text('clock', e.clock, v.clock);
    this.text('standing', e.standing, v.teams ? '' : v.standing);
    this.cls('teams', e.top, 'teams', !!v.teams);
    if (v.teams) {
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
      this.text('deadWait', e.deadWait, s > 0 ? `Voltas em ${s} s` : 'A voltar…');
    }
    this.cls('deadOn', e.dead, 'on', !!v.dead);

    // The buy menu's time to buy in.
    if (this.open) this.drawTill();

    // The scores, only when they change.
    const key = v.scores ? JSON.stringify(v.scores) : '';
    if (this.changed('scores', key)) this.drawScores(v.scores, !!v.teams);

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
      v.slots.primary ? row('1', icon(GUNS[v.slots.primary].family), GUNS[v.slots.primary].name, w === v.slots.primary) : null,
      row('2', icon('pistol'), GUNS[v.slots.secondary].name, w === v.slots.secondary),
      row('3', icon('knife'), KNIFE.name, w === 'knife'),
      nades.length ? row('4', icon('nade'), isNade(w) ? NADES[w].name : 'Granadas', isNade(w), h('span', 'pips', ...nades.map((n) => h('i', `pip ${n}${n === w ? ' on' : ''}`)))) : null,
      ),
    );
  }

  private drawScores(rows: ScoreRow[] | null, teams: boolean): void {
    const s = this.e.scores;
    s.classList.toggle('on', !!rows);
    if (!rows) return;
    const sorted = [...rows].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const table = (list: ScoreRow[], title: Node[], color: string | null) => {
      const t = h(
        'div',
        'table',
        h('div', 'title', ...title),
        h('div', 'row head', h('span', 'who', 'Jogador'), h('span', '', 'Abates'), h('span', '', 'Mortes'), h('span', 'hs', '% cabeça')),
        ...list.map((r) => {
          const el = h('div', `row${r.me ? ' me' : ''}`, h('span', 'who', h('i', 'sw'), h('span', 'nm', r.name)), h('span', '', String(r.kills)), h('span', '', String(r.deaths)), h('span', 'hs', pct(r.hs, r.kills)));
          el.style.setProperty('--c', r.color);
          return el;
        }),
      );
      if (color) t.style.setProperty('--team', color);
      return t;
    };
    if (teams || rows.some((r) => r.team !== undefined)) {
      s.replaceChildren(
        h('div', 'tables', ...TEAMS.map((t, i) => {
          const list = sorted.filter((r) => (r.team ?? 0) === i);
          const kills = list.reduce((n, r) => n + r.kills, 0);
          return table(list, [h('span', '', t.name), h('b', '', String(kills))], t.color);
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

  private close(): void {
    if (!this.open || !this.kit) return;
    this.buy(false, this.kit);
    this.onBuyClosed();
  }

  private change(kit: Loadout): void {
    this.kit = kit;
    this.drawBuy();
    this.onBuy({ ...kit, nades: [...kit.nades] });
  }

  // A gun to its slot, or a piece of the gear's tab: armour on or off, a grenade more (or, when no
  // more fit, none of that kind).
  private take(item: GunId | Gear): void {
    const k = this.kit;
    if (!k) return;
    if (typeof item === 'string') {
      const g = GUNS[item];
      if (g.slot === 'primary') {
        if (k.primary !== item) this.change({ ...k, primary: item });
      } else if (k.secondary !== item) this.change({ ...k, secondary: item });
    } else if (item.kind === 'armour') this.change({ ...k, armour: k.armour === item.level ? 0 : item.level });
    else {
      const have = k.nades.filter((n) => n === item.id).length;
      if (have < NADES[item.id].max && k.nades.length < NADES_MAX) this.change({ ...k, nades: [...k.nades, item.id] });
      else if (have > 0) this.change({ ...k, nades: k.nades.filter((n) => n !== item.id) });
    }
  }

  private drop(id: NadeId): void {
    const k = this.kit;
    const i = k ? k.nades.lastIndexOf(id) : -1;
    if (k && i >= 0) this.change({ ...k, nades: k.nades.filter((_, j) => j !== i) });
  }

  // The buy menu's own keys while it's open, ahead of the game's: digits, Backspace, B and Esc.
  private key(ev: KeyboardEvent): void {
    if (!this.open || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const d = digitOf(ev.code);
    if (!d && ev.code !== 'Escape' && ev.code !== 'KeyB' && ev.code !== 'Backspace') return;
    // Every digit is the menu's while it's open, even one that picks nothing: none switches weapons.
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (ev.repeat) return;
    if (ev.code === 'Escape' || ev.code === 'KeyB') this.close();
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
      const items = this.tab === 'gear' ? GEAR : FAMILY_GUNS[this.tab];
      const item = items[d - 1];
      if (!item) return;
      this.picked = false;
      this.take(item);
      this.drawBuy();
    }
  }

  private buildBuy(): HTMLElement {
    const e = this.e;
    e.till = h('p', 'till');
    const x = h('button', 'close', '✕');
    x.title = 'Fechar (B ou Esc)';
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
    const panel = h(
      'div',
      'buy-panel',
      h('header', '', h('h2', '', 'Armas'), e.till, h('span', 'money', h('small', '', 'Dinheiro'), '∞ €'), x),
      h('div', 'buy-body', fams, e.items),
      h('footer', '', h('span', 'lbl', 'Levas'), e.kit, h('span', 'hint keys-only', h('kbd', '', '1–7'), ' família, depois a arma · ', h('kbd', '', 'B'), ' fecha')),
    );
    const el = h('div', 'buy', panel);
    // Clicks in the menu are its own: none reaches the game, to fire or to take the pointer back.
    for (const t of ['mousedown', 'mouseup', 'click', 'contextmenu'] as const) el.addEventListener(t, (ev) => ev.stopPropagation());
    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
    return el;
  }

  private drawTill(): void {
    const s = Math.ceil(this.buyLeft);
    if (!this.changed('till', s)) return;
    this.e.till.textContent = s > 0 ? `Tempo de compra: ${s} s` : 'Fica para a próxima vida';
    this.e.till.classList.toggle('later', s <= 0);
  }

  private drawBuy(): void {
    const e = this.e;
    const k = this.kit;
    if (!k) return;
    this.shown.delete('till');
    this.drawTill();
    for (const [id, b] of this.famBtns) b.classList.toggle('on', id === this.tab);
    e.items.classList.toggle('picking', this.picked);
    const card = (n: number, ic: SVGSVGElement, name: string, price: number, blurb: string, have: boolean, cls = '', ...extra: Child[]) =>
      h('button', `card${have ? ' have' : ''}${cls ? ` ${cls}` : ''}`, h('span', 'key keys-only', String(n)), have ? h('span', 'tick', 'Tens') : null, ic, h('b', 'name', name), h('span', 'price', `${price} €`), h('small', 'blurb', blurb), ...extra);
    if (this.tab === 'gear') {
      const total = k.nades.length;
      e.items.replaceChildren(
        h('p', 'sect', 'Proteção'),
        ...GEAR.slice(0, 2).map((g, i) => {
          const lvl = (g as { level: 1 | 2 }).level;
          const a = lvl === 1 ? ARMOUR.vest : ARMOUR.helmet;
          const b = card(i + 1, icon(lvl === 1 ? 'shield' : 'helmet'), a.name, a.price, lvl === 1 ? '100 de armadura no corpo' : 'O corpo e a cabeça', k.armour === lvl);
          b.addEventListener('click', () => this.take(g));
          return b;
        }),
        h('p', 'sect', `Granadas `, h('small', '', `${total} de ${NADES_MAX}`)),
        ...NADE_IDS.map((id, i) => {
          const nd = NADES[id];
          const have = k.nades.filter((n) => n === id).length;
          const full = have < nd.max && total >= NADES_MAX;
          const pips = h('span', 'pips', ...Array.from({ length: nd.max }, (_, j) => h('i', `pip ${id}${j < have ? ' on' : ''}`)));
          const minus = have > 0 ? h('span', 'minus', '−') : null;
          minus?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.drop(id);
          });
          const b = card(i + 3, icon('nade', id), nd.name, nd.price, nd.blurb, have > 0, `nade${full ? ' full' : ''}`, pips, minus);
          if (minus) minus.title = 'Tirar uma';
          b.addEventListener('click', () => this.take({ kind: 'nade', id }));
          return b;
        }),
      );
    } else {
      e.items.replaceChildren(
        ...FAMILY_GUNS[this.tab].map((id, i) => {
          const g = GUNS[id];
          const b = card(i + 1, icon(g.family), g.name, g.price, g.blurb, k.primary === id || k.secondary === id, '', h('span', 'spec', `${g.mag} / ${g.reserve}`, g.slot === 'secondary' ? ' · secundária' : ''));
          b.addEventListener('click', () => this.take(id));
          return b;
        }),
      );
    }
    // What you'll come back with.
    const chip = (ic: SVGSVGElement, name: string, ...extra: Child[]) => h('span', 'carry', ic, h('span', '', name), ...extra);
    const counts = NADE_IDS.map((id) => [id, k.nades.filter((n) => n === id).length] as const).filter(([, n]) => n > 0);
    let drop: HTMLElement | null = null;
    if (k.primary) {
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
      ),
    );
  }

  remove(): void {
    removeEventListener('keydown', this.onKey, true);
    this.el.remove();
  }
}
