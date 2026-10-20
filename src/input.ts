// The keyboard, the mouse and the touch screen. Actions (respawn, restart, horn, camera, use, fly,
// walk) are counted presses, read once.
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
  KeyV: 'fly',
  KeyF: 'walk',
};
// 'useBack' throws the item backwards: the touch screen's swipe, where the keyboard holds ↓.
export type Action = 'respawn' | 'restart' | 'horn' | 'camera' | 'use' | 'useBack' | 'fly' | 'walk';

export interface Held {
  throttle: number;
  brake: number;
  steer: number;
  drift: boolean;
}

// The flying camera's controls (src/game/flyer.ts's FlyInput): the moves from -1 to 1, and the drags
// since they were last read, in radians.
export interface Flight {
  fwd: number;
  side: number;
  up: number;
  turn: number;
  look: { x: number; y: number };
  fast: boolean;
}

// On foot (src/game/walker.ts's WalkInput, less the look): the moves from -1 to 1.
export interface Steps {
  fwd: number;
  side: number;
  turn: number;
  run: boolean;
  jump: boolean;
}

// How far a drag turns the flying camera, or the mouse a walker's head, in radians a CSS pixel: the
// mouse's, and a finger's, which has fewer pixels to go across.
const MOUSE_LOOK = 0.004;
const TOUCH_LOOK = 0.007;

const GAME_KEYS = new Set([...Object.values(KEYS).flat(), ...Object.keys(ACTIONS)]);
const inField = (e: Event) => e.target instanceof HTMLElement && !!e.target.closest('input, select, textarea');

export class Keyboard {
  private down = new Set<string>();
  private pending: Action[] = [];
  private hop = false; // on foot: Space pressed since steps() was read, however briefly
  enabled = false;

  constructor() {
    addEventListener('keydown', (e) => {
      if (!this.enabled || inField(e)) return;
      if (!GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      this.down.add(e.code);
      if (!e.repeat && ACTIONS[e.code]) this.pending.push(ACTIONS[e.code]);
      if (!e.repeat && e.code === 'Space') this.hop = true;
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

  // Flying: W and S, or ↑ and ↓, forward and back; A and D sideways; ← and → turn; E up and Q down;
  // Shift faster. The mouse looks round (Mouse).
  flight(): Omit<Flight, 'look'> {
    const k = (code: string) => (this.down.has(code) ? 1 : 0);
    return {
      fwd: Math.max(k('KeyW'), k('ArrowUp')) - Math.max(k('KeyS'), k('ArrowDown')),
      side: k('KeyD') - k('KeyA'),
      up: k('KeyE') - k('KeyQ'),
      turn: k('ArrowRight') - k('ArrowLeft'),
      fast: !!(k('ShiftLeft') || k('ShiftRight')),
    };
  }

  // On foot: W and S, or ↑ and ↓, forward and back; A and D sideways; ← and → turn; Shift runs;
  // Space jumps. The mouse looks round (Mouse).
  steps(): Steps {
    const k = (code: string) => (this.down.has(code) ? 1 : 0);
    const jump = this.hop || !!k('Space');
    this.hop = false;
    return {
      fwd: Math.max(k('KeyW'), k('ArrowUp')) - Math.max(k('KeyS'), k('ArrowDown')),
      side: k('KeyD') - k('KeyA'),
      turn: k('ArrowRight') - k('ArrowLeft'),
      run: !!(k('ShiftLeft') || k('ShiftRight')),
      jump,
    };
  }
}

// The mouse. Flying, dragged with a button held on the world, it looks round, with no pointer lock, as
// Esc is the menu. On foot (`aim`), it looks round as it moves, the pointer locked to the world (a
// click on it locks it again); Esc lets the browser unlock it, which the game takes for its menu
// (`onLost`), so Esc is still the menu.
export class Mouse {
  enabled = false;
  aim = false;
  locked = false;
  // When the browser last let the pointer go of itself, for Esc's keydown, where a browser sends it.
  lostAt = -Infinity;
  onLost = () => {};
  private on: HTMLElement;
  private letting = false;
  private x = 0;
  private y = 0;
  private held: number | null = null;

  constructor(on: HTMLElement) {
    this.on = on;
    document.addEventListener('pointerlockchange', () => {
      const now = document.pointerLockElement === on;
      if (this.locked && !now && !this.letting) {
        this.lostAt = performance.now();
        this.onLost();
      }
      this.locked = now;
      this.letting = false;
      document.body.classList.toggle('aiming', now);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.aim) return;
      this.x += e.movementX;
      this.y += e.movementY;
    });
    on.addEventListener('click', () => this.lock());
    on.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.pointerType !== 'mouse') return;
      this.held = e.pointerId;
      on.setPointerCapture(e.pointerId);
      document.body.classList.add('looking');
    });
    on.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.held || !this.enabled || this.locked) return;
      this.x += e.movementX;
      this.y += e.movementY;
    });
    for (const k of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      on.addEventListener(k, (e) => {
        if (e.pointerId !== this.held) return;
        this.held = null;
        document.body.classList.remove('looking');
      });
    }
  }

  // On foot: the pointer locked to the world. Only in answer to a click or a key; a browser refuses it
  // for a moment after Esc let it go, when a click on the world locks it. Not on a touch screen, where a
  // finger looks round.
  lock(): void {
    if (this.locked || !this.aim || document.body.classList.contains('touch')) return;
    try {
      (this.on.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {});
    } catch {
      /* not allowed now */
    }
  }

  unlock(): void {
    if (!this.locked) return;
    this.letting = true;
    document.exitPointerLock();
  }

  // The drag, or the moves with the pointer locked, since last read, in radians: to the right, and up.
  look(): { x: number; y: number } {
    const l = { x: this.x * MOUSE_LOOK, y: -this.y * MOUSE_LOOK };
    this.x = this.y = 0;
    return l;
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
// actions (back on the street, restart, horn, camera, flying, on foot) are buttons in the bar, out of
// the thumbs' way. Flying ('fly'), the stick on the left half goes forward, back and sideways, a drag
// anywhere on the right half looks round, and Subir and Descer are where Derrapar and Travar are. On
// foot ('walk'), twin sticks: the left walks, running when it's pushed to its rim, a drag on the right
// half looks round, and Saltar jumps.
export class TouchPad {
  readonly el: HTMLElement;
  // Whether the touch controls show: from the start on a touch screen, from the first touch on
  // anything else, and until a key is pressed.
  on = false;
  private driving = false;
  private roam = false;
  private flying = false;
  private walking = false;
  private steer = 0;
  private move = { x: 0, y: 0 }; // flying and on foot: the stick, to the right and forward
  private rim = false; // on foot: the stick pushed to its rim, to run
  private hop = false; // on foot: Saltar pressed, not yet read
  private drift = false;
  private brake = false;
  private rise = false;
  private sink = false;
  private pending: Action[] = [];
  private stick: { id: number; x: number; y: number } | null = null;
  private turn: { id: number; x: number; y: number } | null = null; // flying and on foot: the drag on the right half
  private looked = { x: 0, y: 0 };
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
    const look = el('t-look');
    const drift = el('t-btn t-drift', 'Derrapar');
    const brake = el('t-btn t-brake', 'Travar');
    const rise = el('t-btn t-rise', '▲\nSubir');
    const sink = el('t-btn t-sink', '▼\nDescer');
    const jump = el('t-btn t-jump', 'Saltar');
    this.itemBtn = el('t-btn t-item');
    this.el = el('t-pad');
    this.el.append(zone, look, drift, brake, rise, sink, jump, this.itemBtn, el('t-rotate', 'Deita o telemóvel para veres mais'));
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
    hold(rise, (on) => (this.rise = on));
    hold(sink, (on) => (this.sink = on));
    hold(jump, (on) => on && (this.hop = true));

    // Flying and on foot, a drag on the right half looks round, as the mouse does.
    look.addEventListener('pointerdown', (e) => {
      if (this.turn) return;
      grab(e, look);
      this.turn = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    look.addEventListener('pointermove', (e) => {
      const t = this.turn;
      if (!t || t.id !== e.pointerId) return;
      this.looked.x += e.clientX - t.x;
      this.looked.y += e.clientY - t.y;
      t.x = e.clientX;
      t.y = e.clientY;
    });
    for (const k of ends) look.addEventListener(k, (e) => this.turn?.id === e.pointerId && (this.turn = null));

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
      this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.base.classList.add('live');
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.knob.style.transform = '';
    });
    zone.addEventListener('pointermove', (e) => {
      const s = this.stick;
      if (!s || s.id !== e.pointerId) return;
      if (this.flying || this.walking) return this.fly(s, e);
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

  // Flying and on foot, the stick goes every way, and follows the thumb past its rim as it does steering.
  private fly(s: { x: number; y: number }, e: PointerEvent): void {
    let dx = e.clientX - s.x;
    let dy = e.clientY - s.y;
    const d = Math.hypot(dx, dy);
    if (d > REACH) {
      dx *= REACH / d;
      dy *= REACH / d;
      s.x = e.clientX - dx;
      s.y = e.clientY - dy;
    }
    this.base.style.left = `${s.x}px`;
    this.base.style.top = `${s.y}px`;
    const r = Math.min(1, d / REACH);
    this.rim = r > 0.95;
    const k = r < DEAD ? 0 : (r - DEAD) / (1 - DEAD) / (r * REACH);
    this.move = { x: dx * k, y: -dy * k };
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  private centre(): void {
    this.stick = null;
    this.steer = 0;
    this.move = { x: 0, y: 0 };
    this.rim = false;
    this.base.classList.remove('live');
    this.base.style.left = this.base.style.top = this.knob.style.transform = '';
  }

  private letGo(): void {
    this.centre();
    this.flick = null;
    this.turn = null;
    this.looked = { x: 0, y: 0 };
    this.drift = this.brake = this.rise = this.sink = this.hop = false;
    for (const b of this.el.querySelectorAll('.down')) b.classList.remove('down');
  }

  // Shown for driving ('race' has the item button, time attack and free roam don't), flying or on
  // foot, or hidden (null).
  show(mode: 'race' | 'time' | 'roam' | 'fly' | 'walk' | null): void {
    if (mode === (this.el.dataset.mode || null)) return;
    this.flying = mode === 'fly';
    this.walking = mode === 'walk';
    this.driving = mode !== null && !this.flying && !this.walking;
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

  // Flying: the stick, Subir and Descer, and the drags on the right half since last read.
  flight(): Flight {
    const look = { x: this.looked.x * TOUCH_LOOK, y: -this.looked.y * TOUCH_LOOK };
    this.looked = { x: 0, y: 0 };
    if (!this.on || !this.flying) return { fwd: 0, side: 0, up: 0, turn: 0, look: { x: 0, y: 0 }, fast: false };
    return { fwd: this.move.y, side: this.move.x, up: (this.rise ? 1 : 0) - (this.sink ? 1 : 0), turn: 0, look, fast: false };
  }

  // On foot: the stick, running at its rim, and Saltar since last read; and the drags on the right
  // half, as flight()'s.
  steps(): Steps & { look: { x: number; y: number } } {
    const look = { x: this.looked.x * TOUCH_LOOK, y: -this.looked.y * TOUCH_LOOK };
    this.looked = { x: 0, y: 0 };
    const jump = this.hop;
    this.hop = false;
    if (!this.on || !this.walking) return { fwd: 0, side: 0, turn: 0, run: false, jump: false, look: { x: 0, y: 0 } };
    return { fwd: this.move.y, side: this.move.x, turn: 0, run: this.rim, jump, look };
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
    if (this.driving || this.flying || this.walking) this.pending.push(act);
  }
}
