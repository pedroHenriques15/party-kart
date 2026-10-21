// The keyboard, the mouse and the touch screen. The keys and the mouse's buttons work the controls of
// whichever way you play (binds.ts: driving, flying, on foot, in a round), as the settings bind them:
// held controls read every step, pressed ones counted once a press.
import { CONTROLS, keysOf, RESERVED, type Binds, type Mode } from './binds.ts';

// 'useBack' throws the item backwards: the touch screen's swipe, where the keyboard holds ↓.
export type Action = 'respawn' | 'restart' | 'horn' | 'camera' | 'use' | 'useBack' | 'fly' | 'walk' | 'reload' | 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'last' | 'next' | 'prev' | 'buy' | 'inspect' | 'drop' | 'mute';

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
  // Walking quietly (Shift), and crouching (Ctrl).
  walk: boolean;
  crouch: boolean;
}

// How far a drag turns the flying camera, or the mouse a walker's head, in radians a CSS pixel: the
// mouse's, and a finger's, which has fewer pixels to go across. The settings' sensitivity multiplies them.
const MOUSE_LOOK = 0.004;
const TOUCH_LOOK = 0.007;

const inField = (e: Event) => e.target instanceof HTMLElement && !!e.target.closest('input, select, textarea');
const onLink = (e: Event) => e.target instanceof Element && !!e.target.closest('a');
// While you play, the keys the browser keeps: full screen and its tools. Every other key does nothing
// but what the game makes of it, so a slip (Alt, F1, F3, F5, F7, /, Ctrl with S, D, F, P, R or +) never
// opens a dialog, a menu, a search or another page. Some a browser never lets a page have (Ctrl+W,
// Ctrl+T, Ctrl+N, Ctrl+Tab), but in full screen the game locks the keyboard (main.ts), and then it
// has those too.
const FREE = new Set(['F11', 'F12']);

// The keys (and buttons) bound in a mode: for each, the controls it works.
function codesOf(b: Binds, mode: Mode): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const c of CONTROLS[mode]) for (const k of keysOf(b, mode, c.id)) m.set(k, [...(m.get(k) ?? []), c.id]);
  return m;
}

// The keys and the mouse's buttons, as the controls of the mode you're in.
export class Keyboard {
  private down = new Set<string>();
  private pending: Action[] = [];
  private counts = new Map<string, number>();
  private maps = {} as Record<Mode, Map<string, string[]>>;
  private any = new Set<string>();
  private _mode: Mode = 'drive';
  enabled = false;
  // While the settings wait for a key to bind, every key is theirs.
  capturing = false;

  constructor(binds: Binds = {}) {
    this.bind(binds);
    addEventListener('keydown', (e) => {
      if (this.capturing || !this.enabled || inField(e)) return;
      if (!FREE.has(e.code)) e.preventDefault();
      // A button clicked a moment ago still has the focus: Space or Enter would press it again.
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      if (RESERVED.has(e.code)) return;
      this.press(e.code, e.repeat);
    });
    addEventListener('keyup', (e) => {
      this.release(e.code);
      if (this.enabled && !inField(e) && !FREE.has(e.code)) e.preventDefault();
    });
    addEventListener('blur', () => this.down.clear());
  }

  // The keys as the settings bind them.
  bind(b: Binds): void {
    this.any.clear();
    for (const mode of Object.keys(CONTROLS) as Mode[]) {
      this.maps[mode] = codesOf(b, mode);
      for (const k of this.maps[mode].keys()) this.any.add(k);
    }
  }

  // Whether a key is any control's, in any mode.
  bound(code: string): boolean {
    return this.any.has(code);
  }

  // Whether a key works a control in the mode you're in.
  works(code: string, id: string): boolean {
    return !!this.maps[this._mode].get(code)?.includes(id);
  }

  get mode(): Mode {
    return this._mode;
  }

  // Into another way of playing: nothing pressed for the last one carries over.
  set mode(m: Mode) {
    if (m === this._mode) return;
    this._mode = m;
    this.pending = [];
    this.counts.clear();
  }

  // A key or a button down (a repeat of a held key isn't a press), and up.
  press(code: string, repeat = false): void {
    this.down.add(code);
    if (repeat || !this.enabled) return;
    for (const id of this.maps[this._mode].get(code) ?? []) {
      this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
      if (!CONTROLS[this._mode].find((c) => c.id === id)!.held) this.pending.push(id as Action);
    }
  }

  release(code: string): void {
    this.down.delete(code);
  }

  // Whether a control is held.
  held(id: string): boolean {
    for (const k of this.down) if (this.maps[this._mode].get(k)?.includes(id)) return true;
    return false;
  }

  // How many times a control was pressed since this was last asked.
  take(id: string): number {
    const n = this.counts.get(id) ?? 0;
    this.counts.delete(id);
    return n;
  }

  private on(id: string): number {
    return this.held(id) ? 1 : 0;
  }

  controls(): Held {
    return {
      throttle: this.on('throttle'),
      brake: this.on('brake'),
      steer: this.on('steerRight') - this.on('steerLeft'),
      drift: this.held('drift'),
    };
  }

  actions(): Action[] {
    const a = this.pending;
    this.pending = [];
    return a;
  }

  // In a round, held: the scores.
  get scores(): boolean {
    return this.held('scores');
  }

  // Flying: forward and back, sideways, turning, up and down, faster. The mouse looks round (Mouse).
  flight(): Omit<Flight, 'look'> {
    return {
      fwd: this.on('fwd') - this.on('back'),
      side: this.on('right') - this.on('left'),
      up: this.on('rise') - this.on('sink'),
      turn: this.on('turnRight') - this.on('turnLeft'),
      fast: this.held('fast'),
    };
  }

  // On foot: forward and back, sideways, turning, walking quietly, crouching, jumping (pressed since
  // last read, however briefly, or held). The mouse looks round (Mouse).
  steps(): Steps {
    const jump = this.take('jump') > 0 || this.held('jump');
    const quiet = this.held('quiet');
    return {
      fwd: this.on('fwd') - this.on('back'),
      side: this.on('right') - this.on('left'),
      turn: this.on('turnRight') - this.on('turnLeft'),
      run: !quiet,
      jump,
      walk: quiet,
      crouch: this.held('crouch'),
    };
  }
}

// The mouse. Flying, dragged with a button held on the world, it looks round, with no pointer lock, as
// Esc is the menu. On foot (`aim`), it looks round as it moves, the pointer locked to the world (a
// click on it locks it again, and counts as the click it was); Esc lets the browser unlock it, which the
// game takes for its menu (`onLost`), so Esc is still the menu. Its buttons and its wheel are keys to
// the Keyboard (Mouse0 to Mouse4, WheelUp and WheelDown), on the world or with the pointer locked.
export class Mouse {
  enabled = false;
  aim = false;
  locked = false;
  playing = false; // driving, flying or on foot, no menu up
  // The settings': how fast it turns your head, through a scope a share of that again, and whether
  // pushing it forward looks down.
  sens = 1;
  scopeSens = 1;
  invert = false;

  // When the browser last let the pointer go of itself, for Esc's keydown, where a browser sends it.
  lostAt = -Infinity;
  onLost = () => {};
  private on: HTMLElement;
  private keys: Keyboard;
  private letting = false;
  private x = 0;
  private y = 0;
  private held: number | null = null;

  constructor(on: HTMLElement, keys: Keyboard) {
    this.on = on;
    this.keys = keys;
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
    document.addEventListener('mousedown', (e) => {
      if (keys.capturing || !this.playing || !(this.locked || e.target === on)) return;
      // A click on the world with the pointer let go takes it back, and is the click it was: the shot
      // isn't lost to the lock.
      if (!this.locked && this.aim) this.lock();
      keys.press(`Mouse${e.button}`);
    });
    document.addEventListener('mouseup', (e) => keys.release(`Mouse${e.button}`));
    // The mouse never leaves the game by itself: its side buttons don't go back or forward a page, the
    // middle one doesn't start scrolling, the right one opens no menu (but on a link or in a field), and
    // while you play, Ctrl and the wheel don't zoom the page.
    for (const k of ['mousedown', 'mouseup', 'auxclick'] as const) {
      document.addEventListener(k, (e) => {
        if (e.button === 3 || e.button === 4 || (e.button === 1 && !onLink(e))) e.preventDefault();
      });
    }
    document.addEventListener('contextmenu', (e) => {
      if (this.locked || !(inField(e) || onLink(e))) e.preventDefault();
    });
    addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey && this.playing) e.preventDefault();
        if (keys.capturing || !e.deltaY || !this.playing || !(this.locked || e.target === on)) return;
        const code = e.deltaY > 0 ? 'WheelDown' : 'WheelUp';
        keys.press(code);
        keys.release(code);
      },
      { passive: false },
    );
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

  // The pointer let go, and the buttons with it: a trigger held as a menu opens isn't held after.
  unlock(): void {
    for (let b = 0; b < 5; b++) this.keys.release(`Mouse${b}`);
    if (!this.locked) return;
    this.letting = true;
    document.exitPointerLock();
  }

  // The drag, or the moves with the pointer locked, since last read, in radians: to the right, and up;
  // `fine` times that through a scope.
  look(fine = 1): { x: number; y: number } {
    const k = MOUSE_LOOK * this.sens * (fine === 1 ? 1 : fine * this.scopeSens);
    const l = { x: this.x * k, y: -this.y * k * (this.invert ? -1 : 1) };
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
// half looks round, and Saltar jumps. In a round ('fight', braga-map's task 074), on foot with Fogo
// under the right thumb, which aims as it's dragged too, Recarregar, Mira (a scope's next zoom, a
// knife's stab, a grenade's lob), Agachar (held down till pressed again) and Trocar (the next weapon).
export class TouchPad {
  readonly el: HTMLElement;
  // The settings': how fast a drag turns the view.
  sens = 1;
  // Whether the touch controls show: from the start on a touch screen, from the first touch on
  // anything else, and until a key is pressed.
  on = false;
  private driving = false;
  private roam = false;
  private flying = false;
  private walking = false;
  private fighting = false;
  private trigger = false;
  private pulls = 0;
  private alts = 0;
  private crouched = false;
  private crouchBtn: HTMLElement;
  // In a match: Usar held (to plant or defuse), and pressed since last read (to pick a gun up).
  private useHeld = false;
  private usePresses = 0;
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
  private aim: { id: number; x: number; y: number } | null = null; // in a round: the thumb on Fogo
  private scopeBtn: HTMLElement;
  private looked = { x: 0, y: 0 };
  private flick: { id: number; y: number; done: boolean } | null = null; // on the item button
  private base: HTMLElement;
  private knob: HTMLElement;
  private itemBtn: HTMLElement;
  private shown = '';

  constructor(isBound: (code: string) => boolean) {
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
    const fire = el('t-btn t-fire', 'Fogo');
    const reload = el('t-btn t-reload', 'Recarregar');
    this.scopeBtn = el('t-btn t-scope', 'Mira');
    this.crouchBtn = el('t-btn t-crouch', 'Agachar');
    const swap = el('t-btn t-swap', 'Trocar');
    const use = el('t-btn t-use', 'Usar');
    this.itemBtn = el('t-btn t-item');
    this.el = el('t-pad');
    this.el.append(zone, look, drift, brake, rise, sink, jump, fire, reload, this.scopeBtn, this.crouchBtn, swap, use, this.itemBtn, el('t-rotate', 'Deita o telemóvel para veres mais'));
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
    hold(reload, (on) => on && this.fighting && this.pending.push('reload'));
    hold(this.scopeBtn, (on) => on && this.alts++);
    hold(this.crouchBtn, (on) => {
      if (!on) return;
      this.crouched = !this.crouched;
      this.crouchBtn.classList.toggle('on', this.crouched);
    });
    hold(swap, (on) => on && this.fighting && this.pending.push('next'));
    hold(use, (on) => {
      this.useHeld = on && this.fighting;
      if (this.useHeld) this.usePresses++;
    });

    // In a round, Fogo fires while it's held, and the thumb on it aims as it moves, as a drag on the
    // right half looks round.
    fire.addEventListener('pointerdown', (e) => {
      grab(e, fire);
      this.trigger = true;
      this.pulls++;
      this.aim = { id: e.pointerId, x: e.clientX, y: e.clientY };
      fire.classList.add('down');
    });
    fire.addEventListener('pointermove', (e) => {
      const a = this.aim;
      if (!a || a.id !== e.pointerId) return;
      this.looked.x += e.clientX - a.x;
      this.looked.y += e.clientY - a.y;
      a.x = e.clientX;
      a.y = e.clientY;
    });
    for (const k of ends) {
      fire.addEventListener(k, (e) => {
        if (this.aim?.id !== e.pointerId) return;
        this.aim = null;
        this.trigger = false;
        fire.classList.remove('down');
      });
    }

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
    addEventListener('keydown', (e) => isBound(e.code) && !inField(e) && this.setOn(false), true);
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
    this.aim = null;
    this.looked = { x: 0, y: 0 };
    this.drift = this.brake = this.rise = this.sink = this.hop = this.trigger = this.useHeld = false;
    for (const b of this.el.querySelectorAll('.down')) b.classList.remove('down');
  }

  // Shown for driving ('race' has the item button, time attack and free roam don't), flying or on
  // foot, or hidden (null).
  show(mode: 'race' | 'time' | 'roam' | 'fly' | 'walk' | 'fight' | null): void {
    if (mode === (this.el.dataset.mode || null)) return;
    this.flying = mode === 'fly';
    this.fighting = mode === 'fight';
    this.walking = mode === 'walk' || this.fighting;
    if (!this.fighting) this.unscope();
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
    const look = { x: this.looked.x * TOUCH_LOOK * this.sens, y: -this.looked.y * TOUCH_LOOK * this.sens };
    this.looked = { x: 0, y: 0 };
    if (!this.on || !this.flying) return { fwd: 0, side: 0, up: 0, turn: 0, look: { x: 0, y: 0 }, fast: false };
    return { fwd: this.move.y, side: this.move.x, up: (this.rise ? 1 : 0) - (this.sink ? 1 : 0), turn: 0, look, fast: false };
  }

  // In a round: Fogo held and pressed since last read, and Mira pressed since; Mira only when what's
  // in hand has a use for it (`alt`, its label), and lit while a scope's up.
  fight(alt: string | null, scoped: boolean): { trigger: boolean; pulls: number; alts: number } {
    const pulls = this.pulls;
    const alts = this.alts;
    this.pulls = this.alts = 0;
    this.scopeBtn.style.visibility = alt ? '' : 'hidden';
    if (alt && this.scopeBtn.textContent !== alt) this.scopeBtn.textContent = alt;
    this.scopeBtn.classList.toggle('on', scoped);
    if (!this.on || !this.fighting) return { trigger: false, pulls: 0, alts: 0 };
    return { trigger: this.trigger, pulls, alts };
  }

  // On foot: the stick, running at its rim, and Saltar since last read; and the drags on the right
  // half, as flight()'s.
  steps(): Steps & { look: { x: number; y: number } } {
    const look = { x: this.looked.x * TOUCH_LOOK * this.sens, y: -this.looked.y * TOUCH_LOOK * this.sens };
    this.looked = { x: 0, y: 0 };
    const jump = this.hop;
    this.hop = false;
    if (!this.on || !this.walking) return { fwd: 0, side: 0, turn: 0, run: false, jump: false, walk: false, crouch: false, look: { x: 0, y: 0 } };
    return { fwd: this.move.y, side: this.move.x, turn: 0, run: this.rim, jump, walk: this.fighting && !this.rim && Math.hypot(this.move.x, this.move.y) < 0.6, crouch: this.fighting && this.crouched, look };
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

  // In a match: Usar held, and pressed since this was last asked.
  get using(): boolean {
    return this.on && this.useHeld;
  }

  used(): boolean {
    const n = this.usePresses;
    this.usePresses = 0;
    return this.on && n > 0;
  }

  // Back up on your feet (a respawn, the round over).
  unscope(): void {
    this.crouched = false;
    this.crouchBtn.classList.remove('on');
  }
}
