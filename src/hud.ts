// The race's screen furniture: place and lap, the item slot, the clock, the minimap, the order,
// what just happened to whom, the speed, and speed lines when boosting.
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

export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
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
      race ? 'Arrows drive · Space drift (hold, then let go for a turbo) · E/Shift use item (↓ to throw back) · Enter checkpoint · H horn · C camera' : 'Arrows drive · Space drift · Enter checkpoint · Backspace restart · H horn · C camera',
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
    for (const c of [this.map, this.base]) {
      c.width = W * 2;
      c.height = H * 2;
    }
    this.map.style.width = `${W}px`;
    this.map.style.height = `${H}px`;
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
    center: { text: string; cls: string } | null;
    split: { text: string; cls: string } | null;
  }): void {
    const e = this.el;
    if (o.place) {
      e.place.replaceChildren(h('b', '', String(o.place[0])), h('sup', '', ordinal(o.place[0]).slice(-2)), h('small', '', ` /${o.place[1]}`));
      e.place.dataset.p = String(o.place[0]);
    }
    e.lap.textContent = o.lap;
    e.time.textContent = o.time;
    e.clock.textContent = o.clock;
    const icon = e.item.querySelector('.icon')!;
    const uses = e.item.querySelector('.uses')!;
    if (o.rolling) {
      icon.textContent = ROLL_ICONS[Math.floor(performance.now() / 70) % ROLL_ICONS.length];
      e.item.className = 'item rolling';
      uses.textContent = '';
      e.itemName.textContent = '';
    } else if (o.item) {
      icon.textContent = ITEMS[o.item.kind].icon;
      e.item.className = 'item full';
      uses.textContent = o.item.uses > 1 ? `×${o.item.uses}` : '';
      e.itemName.textContent = `${ITEMS[o.item.kind].name}: ${ITEMS[o.item.kind].blurb}`;
    } else {
      icon.textContent = '';
      uses.textContent = '';
      e.item.className = 'item';
      e.itemName.textContent = '';
    }
    e.speed.textContent = String(Math.round(o.speed * 3.6));
    e.speed.dataset.boost = o.boosting ? '1' : '';
    e.lines.style.opacity = o.boosting ? String(Math.min(0.9, (o.speed - 30) / 20)) : '0';
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
