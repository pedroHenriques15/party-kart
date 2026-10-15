// The keyboard, and the touch screen. Actions (respawn, restart, horn, camera, use) are counted
// presses, read once.
const KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  drift: ['Space'],
};
const ACTIONS: Record<string, Action> = {
  KeyE: 'use',
  ShiftLeft: 'use',
  ShiftRight: 'use',
  KeyQ: 'use',
  Enter: 'respawn',
  NumpadEnter: 'respawn',
  Backspace: 'restart',
  Delete: 'restart',
  KeyH: 'horn',
  KeyC: 'camera',
};
// 'useBack' throws the item backwards: the touch screen's swipe, where the keyboard holds ↓.
export type Action = 'respawn' | 'restart' | 'horn' | 'camera' | 'use' | 'useBack';

export interface Held {
  throttle: number;
  brake: number;
  steer: number;
  drift: boolean;
}

const GAME_KEYS = new Set([...Object.values(KEYS).flat(), ...Object.keys(ACTIONS)]);
const inField = (e: Event) => e.target instanceof HTMLElement && !!e.target.closest('input, select, textarea');

export class Keyboard {
  private down = new Set<string>();
  private pending: Action[] = [];
  enabled = false;

  constructor() {
    addEventListener('keydown', (e) => {
      if (!this.enabled || inField(e)) return;
      if (!GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      this.down.add(e.code);
      if (!e.repeat && ACTIONS[e.code]) this.pending.push(ACTIONS[e.code]);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
  }

  private any(codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  controls(): Held {
    return {
      throttle: this.any(KEYS.up) ? 1 : 0,
      brake: this.any(KEYS.down) ? 1 : 0,
      steer: (this.any(KEYS.right) ? 1 : 0) - (this.any(KEYS.left) ? 1 : 0),
      drift: this.any(KEYS.drift),
    };
  }

  actions(): Action[] {
    const a = this.pending;
    this.pending = [];
    return a;
  }
}

function el(cls: string, text = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  return d;
}

// How far the thumb moves for full lock, in CSS pixels, and the dead zone in the middle.
const REACH = 56;
const DEAD = 0.08;
// How far down the item button a swipe has to go to throw backwards.
const SWIPE = 28;

// The touch screen, for phones and tablets: drag anywhere on the left half to steer, and the
// buttons on the right drift, brake and use the item. There's no thumb spare for a pedal, so in a
// race the kart accelerates by itself; round the city it goes while a thumb is on the steering
// half, and pulls up when it lifts (`waiting`). Brake slows it down, and reverses once stopped, as
// ↓ does. The rarer
// actions (back on the street, restart, horn, camera) are buttons in the bar, out of the thumbs' way.
export class TouchPad {
  readonly el: HTMLElement;
  // Whether the touch controls show: from the start on a touch screen, from the first touch on
  // anything else, and until a key is pressed.
  on = false;
  private driving = false;
  private roam = false;
  private steer = 0;
  private drift = false;
  private brake = false;
  private pending: Action[] = [];
  private stick: { id: number; x: number } | null = null;
  private flick: { id: number; y: number; done: boolean } | null = null; // on the item button
  private base: HTMLElement;
  private knob: HTMLElement;
  private itemBtn: HTMLElement;
  private shown = '';

  constructor() {
    this.knob = el('t-knob');
    this.base = el('t-stick');
    this.base.append(this.knob);
    const zone = el('t-steer');
    zone.append(this.base);
    const drift = el('t-btn t-drift', 'Derrapar');
    const brake = el('t-btn t-brake', 'Travar');
    this.itemBtn = el('t-btn t-item');
    this.el = el('t-pad');
    this.el.append(zone, drift, brake, this.itemBtn, el('t-rotate', 'Deita o telemóvel para veres mais'));
    document.body.append(this.el);

    // A finger keeps whatever it pressed until it lifts, even if it slides off.
    const grab = (e: PointerEvent, target: HTMLElement) => {
      e.preventDefault();
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic event */
      }
    };
    const ends = ['pointerup', 'pointercancel', 'lostpointercapture'] as const;
    const hold = (b: HTMLElement, set: (on: boolean) => void) => {
      b.addEventListener('pointerdown', (e) => {
        grab(e, b);
        set(true);
        b.classList.add('down');
      });
      for (const k of ends) {
        b.addEventListener(k, () => {
          set(false);
          b.classList.remove('down');
        });
      }
    };
    hold(drift, (on) => (this.drift = on));
    hold(brake, (on) => (this.brake = on));

    // The item: tap to use it, or swipe down to throw it backwards. A tap fires as it lifts, as
    // only then is it clear it wasn't a swipe.
    const item = this.itemBtn;
    item.addEventListener('pointerdown', (e) => {
      grab(e, item);
      this.flick = { id: e.pointerId, y: e.clientY, done: false };
      item.classList.add('down');
    });
    item.addEventListener('pointermove', (e) => {
      const p = this.flick;
      if (!p || p.id !== e.pointerId || p.done || e.clientY - p.y < SWIPE) return;
      p.done = true;
      if (this.driving) this.pending.push('useBack');
    });
    for (const k of ends) {
      item.addEventListener(k, (e) => {
        const p = this.flick;
        if (p?.id !== e.pointerId) return;
        if (!p.done && k === 'pointerup' && this.driving) this.pending.push('use');
        this.flick = null;
        item.classList.remove('down');
      });
    }

    // The stick appears where the thumb lands, and follows it when it goes past full lock, so
    // steering the other way is never more than a full lock's travel.
    zone.addEventListener('pointerdown', (e) => {
      if (this.stick) return;
      grab(e, zone);
      this.stick = { id: e.pointerId, x: e.clientX };
      this.base.classList.add('live');
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.knob.style.transform = '';
    });
    zone.addEventListener('pointermove', (e) => {
      const s = this.stick;
      if (!s || s.id !== e.pointerId) return;
      if (e.clientX - s.x > REACH) s.x = e.clientX - REACH;
      if (e.clientX - s.x < -REACH) s.x = e.clientX + REACH;
      this.base.style.left = `${s.x}px`;
      const d = (e.clientX - s.x) / REACH;
      this.steer = Math.abs(d) < DEAD ? 0 : Math.sign(d) * ((Math.abs(d) - DEAD) / (1 - DEAD));
      this.knob.style.transform = `translateX(${d * REACH}px)`;
    });
    for (const k of ends) zone.addEventListener(k, (e) => this.stick?.id === e.pointerId && this.centre());
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    // No scrolling, zooming or swiping back a page from under a thumb. (Pointer events come first,
    // so this doesn't stop them.)
    this.el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    // A phone that switches app mid-race may never say the fingers lifted.
    addEventListener('blur', () => this.letGo());
    document.addEventListener('visibilitychange', () => document.hidden && this.letGo());

    this.setOn(matchMedia('(pointer: coarse)').matches);
    addEventListener('pointerdown', (e) => e.pointerType === 'touch' && this.setOn(true), true);
    addEventListener('keydown', (e) => GAME_KEYS.has(e.code) && !inField(e) && this.setOn(false), true);
  }

  private setOn(on: boolean): void {
    this.on = on;
    document.body.classList.toggle('touch', on);
  }

  private centre(): void {
    this.stick = null;
    this.steer = 0;
    this.base.classList.remove('live');
    this.base.style.left = this.base.style.top = this.knob.style.transform = '';
  }

  private letGo(): void {
    this.centre();
    this.flick = null;
    this.drift = this.brake = false;
    for (const b of this.el.querySelectorAll('.down')) b.classList.remove('down');
  }

  // Shown for driving ('race' has the item button, time attack and free roam don't), or hidden (null).
  show(mode: 'race' | 'time' | 'roam' | null): void {
    if (mode === (this.el.dataset.mode || null)) return;
    this.driving = mode !== null;
    this.roam = mode === 'roam';
    this.el.dataset.mode = mode ?? '';
    this.letGo();
    this.pending = [];
  }

  // The item button wears the item: its icon, '?' while the roulette spins, or nothing.
  item(icon: string, uses: number, rolling: boolean, guarded: boolean): void {
    const key = `${icon}|${uses}|${rolling}|${guarded}`;
    if (key === this.shown) return;
    this.shown = key;
    this.itemBtn.textContent = rolling ? '?' : icon;
    if (uses > 1) this.itemBtn.append(el('uses', `×${uses}`));
    this.itemBtn.classList.toggle('rolling', rolling);
    this.itemBtn.classList.toggle('full', !rolling && !!icon);
    this.itemBtn.classList.toggle('guarded', guarded);
  }

  controls(): Held {
    if (!this.on || !this.driving) return { throttle: 0, brake: 0, steer: 0, drift: false };
    const go = !this.roam || !!this.stick;
    return { throttle: this.brake || !go ? 0 : 1, brake: this.brake ? 1 : 0, steer: this.steer, drift: this.drift };
  }

  // Round the city, no thumb on the steering half and Brake not held: the kart pulls up and waits,
  // rather than driving off by itself the moment the game opens.
  get waiting(): boolean {
    return this.on && this.driving && this.roam && !this.stick && !this.brake;
  }

  actions(): Action[] {
    const a = this.pending;
    this.pending = [];
    return a;
  }

  // For the bar's buttons.
  press(act: Action): void {
    if (this.driving) this.pending.push(act);
  }
}
