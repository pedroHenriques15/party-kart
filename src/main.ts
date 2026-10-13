import * as THREE from 'three';
import './style.css';
import { beep, checkpointSound, engineSound, horn, isMuted, lapSound, sfx, thud, toggleMute, unlockAudio } from './audio.ts';
import { autopilot } from './car/autopilot.ts';
import { clampSteer, newCar, speedOf, stepCar, stopInput, type Car } from './car/car.ts';
import { Arena, FLAG, type ArenaFx, type CarInfo, type Rules } from './game/arena.ts';
import { botControls, newBrain, type Brain } from './game/bot.ts';
import { ITEMS } from './game/items.ts';
import { NO_CONTROLS, Racer, type Controls, type Note } from './game/racer.ts';
import { fmt, fmtDiff, Hud, ordinal } from './hud.ts';
import { Keyboard, TouchPad } from './input.ts';
import { buildKart, driverById, DRIVERS, type KartModel } from './render/drivers.ts';
import { Particles } from './render/fx.ts';
import { ItemsView } from './render/items3d.ts';
import { Look, type Quality } from './render/look.ts';
import { Skids } from './render/skids.ts';
import { nameTag } from './render/textures.ts';
import { buildWorld } from './render/world.ts';
import { ClientRoom, cleanName, HostRoom, MAX_RACERS, type Entry, type Room, type Snap } from './session.ts';
import { LAYOUT } from './track/layout.ts';
import { buildTrack } from './track/track.ts';

const DT = 1 / 120;
// ?autodrive: the autopilot drives your car (for testing the game in a browser).
const AUTODRIVE = new URLSearchParams(location.search).has('autodrive');
const track = buildTrack(LAYOUT);
const N = track.samples.length;
const keys = new Keyboard();
const pad = new TouchPad();
// A phone or a tablet: its finger is its pointer.
const PHONE = matchMedia('(pointer: coarse)').matches;

// ---- Three.js ----

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const ui = document.querySelector<HTMLDivElement>('#ui')!;
const hudRoot = document.querySelector<HTMLDivElement>('#hud')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 1, 0.3, 30000);
const look = new Look(renderer, scene, camera);
const world = buildWorld(track);
scene.add(world.group);
const fx = new Particles(0.55);
const glow = new Particles(0.32, true);
const smoke = new Particles(1.8);
const skids = new Skids();
scene.add(fx.points, glow.points, smoke.points, skids.mesh);
addEventListener('resize', () => look.resize());

function stored(k: string, fallback: string): string {
  try {
    return localStorage.getItem(k) ?? fallback;
  } catch {
    return fallback;
  }
}
function remember(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private window */
  }
}

let quality = stored('pk-quality', PHONE ? 'medium' : 'high') as Quality;
look.setQuality(quality);

// ---- Karts on screen ----

interface Shown {
  model: KartModel;
  tag: THREE.Sprite | null;
  driver: string;
}

function showKart(driverId: string, label: string | null, ghost = false): Shown {
  const model = buildKart(driverById(driverId));
  if (ghost) {
    model.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.material = (o.material as THREE.MeshStandardMaterial).clone();
        Object.assign(o.material, { transparent: true, opacity: 0.3, depthWrite: false });
        o.castShadow = false;
      }
    });
  }
  let tag: THREE.Sprite | null = null;
  if (label) {
    tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTag(label, driverById(driverId).color), depthTest: false }));
    tag.scale.set(3, 0.75, 1);
    tag.position.set(0, 3.4, 0);
    tag.renderOrder = 10;
    model.group.add(tag);
  }
  scene.add(model.group);
  return { model, tag, driver: driverId };
}

function hide(s: Shown | null | undefined): void {
  if (s) scene.remove(s.model.group);
}

const tmpM = new THREE.Matrix4();
function pose(obj: THREE.Object3D, x: number, y: number, z: number, yaw: number, up: { x: number; y: number; z: number }): void {
  const u = new THREE.Vector3(up.x, up.y, up.z).normalize();
  const f = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  f.sub(u.clone().multiplyScalar(f.dot(u))).normalize();
  const r = f.clone().cross(u);
  tmpM.makeBasis(f, u, r);
  obj.quaternion.setFromRotationMatrix(tmpM);
  obj.position.set(x, y, z);
}

// Sparks, smoke, skid marks and the driver's trail for a kart this frame.
function kartEffects(id: string, s: Shown, x: number, y: number, z: number, yaw: number, speed: number, flags: number, grounded: boolean, dt: number): void {
  const back = new THREE.Vector3(-Math.cos(yaw), 0, -Math.sin(yaw));
  const right = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
  const pos = new THREE.Vector3(x, y, z);
  fx.trail(id, s.model.driver.trail, pos, back, speed, !!(flags & FLAG.boost), dt);
  const drifting = !!(flags & FLAG.drift) && grounded;
  const rear = (side: number) => pos.clone().addScaledVector(back, 1.1).addScaledVector(right, side * 0.9).add(new THREE.Vector3(0, 0.05, 0));
  skids.mark(id, drifting, rear(-1), rear(1));
  if (drifting) {
    const color = flags & FLAG.turbo2 ? ['#ff9a2e', '#ffd04d'] : flags & FLAG.turbo1 ? ['#5ad1ff', '#ffffff'] : null;
    for (const side of [-1, 1]) {
      const p = rear(side);
      if (color && Math.random() < 0.8) glow.add(p.x, p.y + 0.1, p.z, back.x * 3 + (Math.random() - 0.5) * 3, 1 + Math.random() * 2, back.z * 3 + (Math.random() - 0.5) * 3, 0.35, color[Math.floor(Math.random() * 2)], -14);
      if (Math.random() < 0.35) smoke.add(p.x, p.y + 0.3, p.z, back.x * 2, 0.6, back.z * 2, 0.9, '#d9d6d0', 0.5);
    }
  }
}

// ---- State ----

let room: Room | null = null;
let notice = '';
let results: Entry[] | null = null;

interface RaceCtx {
  arena: Arena;
  rules: Rules;
  me: Racer;
  bots: { racer: Racer; brain: Brain; steer: number }[];
  goAt: number; // performance.now() of the green light
  endAt: number;
  acc: number;
  cam: number; // 0 chase, 1 close
  karts: Map<string, Shown>;
  items: ItemsView;
  hud: Hud;
  use: boolean; // the item key was pressed, not yet used
  back: boolean; // and it's to be thrown backwards
  steer: number;
  throttle: number;
  rec: number[][]; // time attack: this lap, every 50 ms
  ghostLap: number[][] | null;
  ghost: Shown | null;
  split: { text: string; cls: string; until: number } | null;
  center: { text: string; cls: string; until: number } | null;
  lastBeep: number;
  shake: number;
  timeUp: boolean;
}

let race: RaceCtx | null = null;

// Bots driving round behind the menus.
const attract: { car: Car; shown: Shown; caution: number }[] = [];
function startAttract(): void {
  if (attract.length) return;
  const picks = [...DRIVERS].sort(() => Math.random() - 0.5).slice(0, 5);
  picks.forEach((d, k) => attract.push({ car: newCar(track, (k * 37 + 2300) % N), shown: showKart(d.id, null), caution: 1 + k * 0.06 }));
}
function stopAttract(): void {
  for (const a of attract) hide(a.shown);
  attract.length = 0;
}

const roomFromUrl = () => (new URLSearchParams(location.search).get('room') ?? '').trim().toLowerCase();
const inviteLink = (code: string) => `${location.origin}${location.pathname}?room=${code}`;

// On a phone, a race wants the whole screen. Browsers only allow that in answer to a tap, so the
// buttons that lead to a race ask for it. (An iPhone can't; added to the home screen, it opens
// without the browser round it anyway.)
function fullScreen(): void {
  if (!PHONE || !document.fullscreenEnabled || document.fullscreenElement) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}

// Sideways for a race, where the browser allows it (Android, in full screen).
function sideways(on: boolean): void {
  const o = screen.orientation as unknown as { lock?: (to: string) => Promise<void>; unlock?: () => void } | undefined;
  if (!PHONE || !o) return;
  try {
    if (on) o.lock?.('landscape').catch(() => {});
    else o.unlock?.();
  } catch {
    /* not in full screen */
  }
}

// ---- A tiny DOM builder: text only, never HTML, since names come from other people. ----

type Child = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k in el) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}

// ---- Screens ----

function driverGrid(current: string, taken: Map<string, string>, onPick: (id: string) => void): HTMLElement {
  return h(
    'div',
    { class: 'drivers' },
    ...DRIVERS.map((d) => {
      const by = taken.get(d.id);
      return h(
        'button',
        { class: `driver${d.id === current ? ' on' : ''}`, disabled: !!by && d.id !== current, onclick: () => onPick(d.id), style: `--c:${d.color};--t:${d.trim}` },
        h('span', { class: 'swatch' }),
        h('b', {}, d.name),
        h('small', {}, by && d.id !== current ? `taken by ${by}` : d.tagline),
      );
    }),
  );
}

function qualityPicker(): HTMLElement {
  const sel = h(
    'select',
    {
      onchange: () => {
        quality = sel.value as Quality;
        remember('pk-quality', quality);
        look.setQuality(quality);
      },
    },
    ...(['high', 'medium', 'low'] as Quality[]).map((q) => h('option', { value: q, selected: q === quality }, q[0].toUpperCase() + q.slice(1))),
  );
  return h('label', { class: 'inline' }, 'Graphics ', sel);
}

function homeScreen(): HTMLElement {
  let driver = stored('pk-driver', DRIVERS[0].id);
  const name = h('input', { maxLength: 16, placeholder: 'Your name', value: stored('pk-name', ''), autocomplete: 'off' });
  const code = h('input', { class: 'code-in', maxLength: 5, placeholder: 'Room code', value: roomFromUrl(), autocomplete: 'off', spellcheck: false });
  const err = h('p', { class: 'err' }, notice);
  const grid = h('div', {});
  const drawGrid = () =>
    grid.replaceChildren(
      driverGrid(driver, new Map(), (id) => {
        driver = id;
        remember('pk-driver', id);
        drawGrid();
      }),
    );
  drawGrid();
  const busy = (b: boolean) => panel.querySelectorAll('button').forEach((x) => (x.disabled = b));
  const who = () => {
    const n = cleanName(name.value);
    remember('pk-name', n);
    return n;
  };
  const enter = (r: Room) => {
    room = r;
    notice = '';
    wire(r);
    render();
  };
  const host = async () => {
    unlockAudio();
    fullScreen();
    busy(true);
    err.textContent = 'Opening a room…';
    try {
      enter(await HostRoom.create(who(), driver));
    } catch (e) {
      busy(false);
      err.textContent = `Couldn't open a room (${(e as { type?: string }).type ?? 'error'}). Try again in a moment.`;
    }
  };
  const join = async () => {
    const c = code.value.trim().toLowerCase();
    if (!/^[a-z0-9]{5}$/.test(c)) {
      err.textContent = 'A room code has 5 letters and numbers.';
      return;
    }
    unlockAudio();
    fullScreen();
    busy(true);
    err.textContent = 'Joining…';
    try {
      enter(await ClientRoom.join(c, who(), driver));
    } catch (e) {
      busy(false);
      err.textContent = (e as Error).message;
    }
  };
  code.addEventListener('keydown', (e) => e.key === 'Enter' && void join());
  const invited = roomFromUrl();
  const panel = h(
    'div',
    { class: 'panel home' },
    h('h1', {}, 'Party Kart', h('span', {}, '.')),
    h('p', { class: 'tag' }, "P. Kiddy's White Party · the Braga Grand Prix. Race your friends, throw things at them."),
    h('label', {}, 'Your name', name),
    h('label', {}, 'Your driver'),
    grid,
    invited ? h('button', { class: 'primary', onclick: join }, `Join room ${invited}`) : h('button', { class: 'primary', onclick: host }, 'Create a room'),
    h('div', { class: 'or' }, invited ? 'or' : 'or join one'),
    invited ? h('button', { onclick: host }, 'Create my own room') : h('div', { class: 'row' }, code, h('button', { onclick: join }, 'Join')),
    err,
    h('div', { class: 'row foot' }, qualityPicker()),
    howTo(),
  );
  return panel;
}

function howTo(): HTMLElement {
  return h(
    'details',
    { class: 'how' },
    h('summary', {}, 'How to play'),
    h(
      'ul',
      {},
      h('li', { class: 'keys-only' }, h('b', {}, 'Drive'), ' arrows or WASD. ', h('b', {}, 'Drift'), ' hold Space through a corner; when the sparks turn blue, then orange, let go for a mini-turbo.'),
      h('li', { class: 'keys-only' }, h('b', {}, 'Items'), ' drive through the ? boxes; ', h('b', {}, 'E'), ' or ', h('b', {}, 'Shift'), ' uses it (hold ↓ to throw backwards). The further behind you are, the better what you get.'),
      h('li', { class: 'touch-only' }, h('b', {}, 'Steer'), ' with your left thumb, dragging left and right anywhere on that half of the screen. The kart goes by itself; ', h('b', {}, 'Brake'), ' slows it down, and reverses once it stops. Best with the phone sideways.'),
      h('li', { class: 'touch-only' }, h('b', {}, 'Drift'), ' hold it through a corner; when the sparks turn blue, then orange, let go for a mini-turbo.'),
      h('li', { class: 'touch-only' }, h('b', {}, 'Items'), ' drive through the ? boxes, then tap the item button (swipe it down to throw backwards). The further behind you are, the better what you get.'),
      h('li', {}, h('b', {}, 'Slipstream'), ' sit close behind a car for a second and you get a boost.'),
      h('li', { class: 'keys-only' }, h('b', {}, 'Enter'), ' back to your last checkpoint. ', h('b', {}, 'H'), ' horn · ', h('b', {}, 'C'), ' camera · ', h('b', {}, 'M'), ' sound.'),
      h('li', { class: 'touch-only' }, h('b', {}, '↺'), ' back to your last checkpoint. The horn, the camera and the sound are at the top.'),
      h(
        'li',
        {},
        'Items: ',
        Object.values(ITEMS)
          .filter((i, k, a) => a.findIndex((x) => x.icon === i.icon) === k)
          .map((i) => `${i.icon} ${i.name}`)
          .join(' · '),
      ),
    ),
  );
}

function lobbyScreen(r: Room): HTMLElement {
  const L = r.lobby;
  const me = L.members.find((m) => m.id === r.you);
  const taken = new Map(L.members.filter((m) => m.id !== r.you && !m.bot).map((m) => [m.driver, m.name] as const));
  if (me) showroom(me.driver);
  const host = r.isHost ? (r as HostRoom) : null;
  const share = PHONE && 'share' in navigator;
  const copy = h(
    'button',
    {
      onclick: async () => {
        if (share) {
          try {
            await navigator.share({ title: 'Party Kart', text: 'Race me in Party Kart', url: inviteLink(L.code) });
            return;
          } catch (e) {
            if ((e as Error).name === 'AbortError') return;
          }
        }
        try {
          await navigator.clipboard.writeText(inviteLink(L.code));
          copy.textContent = 'Copied!';
        } catch {
          prompt('Send this link to your friends:', inviteLink(L.code));
        }
      },
    },
    share ? 'Share invite link' : 'Copy invite link',
  );
  const select = <T extends string | number>(value: T, options: [T, string][], set: (v: T) => void) => {
    const s = h(
      'select',
      { disabled: !host, onchange: () => set((typeof value === 'number' ? Number(s.value) : s.value) as T) },
      ...options.map(([v, label]) => h('option', { value: String(v), selected: v === value }, label)),
    );
    return s;
  };
  const check = (value: boolean, set: (v: boolean) => void) => {
    const c = h('input', { type: 'checkbox', checked: value, disabled: !host, onchange: () => set(c.checked) });
    return c;
  };
  const humans = L.members.filter((m) => !m.bot).length;
  const settings = h(
    'div',
    { class: 'settings' },
    h('label', { class: 'inline' }, 'Mode ', select(L.mode, [['race', 'Race'], ['time', 'Time attack']], (mode) => host?.configure({ mode }))),
    L.mode === 'race'
      ? h('label', { class: 'inline' }, 'Laps ', select(L.laps, [[1, '1'], [2, '2'], [3, '3'], [5, '5']], (laps) => host?.configure({ laps })))
      : h('label', { class: 'inline' }, 'Round ', select(L.minutes, [2, 3, 4, 5, 8].map((n) => [n, `${n} min`] as [number, string]), (minutes) => host?.configure({ minutes }))),
    L.mode === 'race' && h('label', { class: 'inline' }, check(L.items, (items) => host?.configure({ items })), ' Power-ups'),
    L.mode === 'race' && h('label', { class: 'inline' }, check(L.catchUp, (catchUp) => host?.configure({ catchUp })), ' Catch-up'),
    h(
      'label',
      { class: 'inline' },
      'Bots ',
      select(
        L.bots,
        Array.from({ length: MAX_RACERS - humans + 1 }, (_, n) => [n, String(n)] as [number, string]),
        (bots) => host?.configure({ bots }),
      ),
    ),
  );
  return h(
    'div',
    { class: 'panel lobby' },
    h('div', { class: 'room' }, h('div', {}, h('span', { class: 'label' }, 'Room'), h('b', { class: 'code' }, L.code)), copy),
    h(
      'div',
      { class: 'members' },
      ...L.members.map((m) =>
        h('span', { class: `chip${m.bot ? ' bot' : ''}`, style: `--c:${driverById(m.driver).color}` }, m.bot ? '🤖 ' : '', m.id === r.you ? `${m.name} (you)` : m.name, h('small', {}, m.bot ? 'bot' : driverById(m.driver).name)),
      ),
    ),
    h('label', {}, 'Your driver'),
    driverGrid(me?.driver ?? '', taken, (id) => {
      remember('pk-driver', id);
      r.pick(id);
    }),
    settings,
    host ? h('button', { class: 'primary', onclick: () => (fullScreen(), host.start()) }, L.mode === 'race' ? 'Start the race' : 'Start the round') : h('p', { class: 'wait' }, 'Waiting for the host to start…'),
    h('div', { class: 'row foot' }, qualityPicker(), h('button', { class: 'ghost', onclick: leave }, 'Leave the room')),
    howTo(),
  );
}

function resultsScreen(r: Room, list: Entry[]): HTMLElement {
  const isRace = r.lobby.mode === 'race';
  return h(
    'div',
    { class: 'panel results' },
    h('h2', {}, isRace ? 'Results' : 'Best laps'),
    h(
      'ol',
      { class: 'podium' },
      ...list.map((e, k) =>
        h(
          'li',
          { class: e.id === r.you ? 'me' : '' },
          h('span', { class: 'pos' }, String(k + 1)),
          h('span', { class: 'swatch', style: `--c:${driverById(e.driver).color};--t:${driverById(e.driver).trim}` }),
          h('span', { class: 'who' }, e.bot ? `🤖 ${e.name}` : e.name, h('small', {}, isRace ? `best lap ${fmt(e.best)}` : driverById(e.driver).name)),
          h('span', { class: 'time' }, isRace ? (e.fin !== null ? fmt(e.fin) : 'DNF') : fmt(e.best)),
        ),
      ),
    ),
    r.isHost
      ? h(
          'div',
          { class: 'row' },
          h('button', { class: 'primary', onclick: () => (fullScreen(), (r as HostRoom).start()) }, 'Race again'),
          h(
            'button',
            {
              onclick: () => {
                results = null;
                render();
              },
            },
            'Back to the lobby',
          ),
        )
      : h(
          'div',
          { class: 'row' },
          h('p', { class: 'wait' }, 'Waiting for the host…'),
          h(
            'button',
            {
              onclick: () => {
                results = null;
                render();
              },
            },
            'Change driver',
          ),
        ),
  );
}

function leave(): void {
  if (room) {
    if (room.isHost && room.lobby.members.some((m) => !m.bot && m.id !== room!.you) && !confirm('Close the room for everyone?')) return;
    room.onClose = () => {};
    room.leave();
  }
  room = null;
  endRace();
  results = null;
  notice = '';
  history.replaceState(null, '', location.pathname);
  render();
}

function wire(r: Room): void {
  r.onLobby = () => {
    if (!race) render();
  };
  r.onStart = (goIn, endIn, grid) => startRace(goIn, endIn, grid);
  r.onEnd = (list) => {
    results = list;
    endRace();
    render();
  };
  r.onHonk = (id) => {
    const m = r.lobby.members.find((x) => x.id === id);
    if (m) horn(driverById(m.driver).horn, 0.6);
  };
  r.onBoard = () => {};
  r.onEv = (ev) => race?.arena.apply(ev);
  r.onClose = (why) => {
    room = null;
    endRace();
    results = null;
    notice = why;
    history.replaceState(null, '', location.pathname);
    render();
  };
}

function render(): void {
  keys.enabled = !!race;
  pad.show(race ? race.rules.mode : null);
  document.body.classList.toggle('racing', !!race);
  if (race) {
    // On a touch screen, the keys Enter, Backspace, H, C and M are buttons here.
    const touchBtn = (label: string, title: string, onclick: () => void) => h('button', { class: 'small ghost touch-only', title, onclick }, label);
    const sound = touchBtn(isMuted() ? '🔇' : '🔊', 'Sound', () => (sound.textContent = toggleMute() ? '🔇' : '🔊'));
    ui.replaceChildren(
      h(
        'div',
        { class: 'bar' },
        h('span', { class: 'room-code' }, 'Room ', h('b', {}, room?.lobby.code ?? '')),
        touchBtn('↺', 'Back to the last checkpoint', () => pad.press('respawn')),
        race.rules.mode === 'time' && touchBtn('Restart lap', 'Restart the lap', () => pad.press('restart')),
        touchBtn('📢', 'Horn', () => pad.press('horn')),
        touchBtn('🎥', 'Camera', () => pad.press('camera')),
        sound,
        room?.isHost ? h('button', { class: 'small ghost', onclick: () => (room as HostRoom).endNow() }, 'End race') : null,
        h('button', { class: 'small ghost', onclick: leave }, 'Leave'),
      ),
    );
    return;
  }
  startAttract();
  if (!room) {
    hide(showroomCar);
    showroomCar = null;
    ui.replaceChildren(homeScreen());
  } else if (results) ui.replaceChildren(resultsScreen(room, results));
  else ui.replaceChildren(lobbyScreen(room));
}

// The lobby's showroom: your car turning slowly on the party stage.
let showroomCar: Shown | null = null;
function showroom(driverId: string): void {
  if (showroomCar?.driver === driverId) return;
  hide(showroomCar);
  showroomCar = showKart(driverId, null);
}

// ---- The race ----

function startRace(goIn: number, endIn: number, grid: Record<string, number>): void {
  const r = room!;
  endRace();
  hide(showroomCar);
  showroomCar = null;
  stopAttract();
  results = null;
  const L = r.lobby;
  const rules: Rules = { mode: L.mode, laps: L.laps, items: L.mode === 'race' && L.items, catchUp: L.mode === 'race' && L.catchUp };
  const arena = new Arena(track, rules);
  const meMember = L.members.find((m) => m.id === r.you)!;
  const me = new Racer(track, r.you, meMember.name, false, grid[r.you] ?? 0);
  const bots = r.isHost
    ? L.members.filter((m) => m.bot).map((m) => ({ racer: new Racer(track, m.id, m.name, true, grid[m.id] ?? 0), brain: newBrain(), steer: 0 }))
    : [];
  arena.locals = [me, ...bots.map((b) => b.racer)];
  for (const x of arena.locals) arena.cars.set(x.id, x.info());
  arena.send = (ev) => room?.sendEv(ev);
  const now = performance.now();
  const karts = new Map<string, Shown>();
  karts.set(me.id, showKart(meMember.driver, null));
  for (const b of bots) karts.set(b.racer.id, showKart(L.members.find((m) => m.id === b.racer.id)!.driver, b.racer.name));
  const ctx: RaceCtx = {
    arena,
    rules,
    me,
    bots,
    goAt: now + goIn,
    endAt: now + endIn,
    acc: 0,
    cam: 0,
    karts,
    items: new ItemsView(track, arena),
    hud: new Hud(hudRoot, track, rules.mode === 'race'),
    use: false,
    back: false,
    steer: 0,
    throttle: 0,
    rec: [],
    ghostLap: null,
    ghost: null,
    split: null,
    center: null,
    lastBeep: 99,
    shake: 0,
    timeUp: false,
  };
  scene.add(ctx.items.group);
  arena.fx = (f) => onArenaFx(ctx, f);
  race = ctx;
  (document.activeElement as HTMLElement | null)?.blur();
  sideways(true);
  render();
}

function endRace(): void {
  if (!race) return;
  for (const k of race.karts.values()) hide(k);
  hide(race.ghost);
  scene.remove(race.items.group);
  race = null;
  engineSound(0, 0, false);
  hudRoot.replaceChildren();
  sideways(false);
}

const near = (r: RaceCtx, p: { x: number; z: number }) => Math.max(0, 1 - Math.hypot(p.x - r.me.car.p.x, p.z - r.me.car.p.z) / 120);

function onArenaFx(r: RaceCtx, f: ArenaFx): void {
  const t = performance.now() / 1000;
  const a = r.arena;
  const owner = (itemId: string) => a.nameOf(itemId.split(':')[0]);
  if (f.k === 'thrown') {
    const ev = f.ev;
    if ('owner' in ev && ev.owner !== r.me.id) {
      const c = a.cars.get(ev.owner);
      if (c && near(r, c) > 0) sfx.throw();
    }
  } else if (f.k === 'hit') {
    const ev = f.ev;
    const where = { x: ev.x, y: ev.y, z: ev.z };
    r.items.flash(where, t, ev.blocked ? '#7fd4ff' : '#ffe14d', ev.blocked ? 1.6 : 1);
    glow.spray(where, 40, ev.blocked ? ['#7fd4ff', '#ffffff'] : ['#ffe14d', '#ffffff', '#ff4fd8'], 7, 6, 0.7);
    if (ev.victim !== r.me.id && near(r, where) > 0) sfx.hit(near(r, where));
    if (ev.victim && ev.victim !== r.me.id && !ev.blocked && ev.item) {
      r.hud.feed(`${a.nameOf(ev.victim)} got ${owner(ev.item)}'s ${howName(ev.how)}`);
    }
  } else if (f.k === 'boom') {
    const ev = f.ev;
    const where = { x: ev.x, y: ev.y, z: ev.z };
    r.items.flash(where, t, '#ff4fd8', 4);
    fx.spray(where, 260, ['#ffffff', '#d4af37', '#ffe14d', '#ff4fd8', '#3be8c4'], 16, 14, 2.4);
    sfx.boom(Math.max(0.25, near(r, where)));
    r.shake = Math.max(r.shake, near(r, where) * 1.2);
    r.hud.feed(`💣 ${a.nameOf(ev.owner)}'s party bomb blew up ${a.nameOf(ev.victim)}!`, 'big');
  } else if (f.k === 'bass') {
    const ev = f.ev;
    const c = a.cars.get(ev.owner);
    if (c) r.items.wave(c, t);
    sfx.bass();
    r.hud.feed(`🔊 ${a.nameOf(ev.owner)} dropped the bass!`, 'big');
  }
}

const howName = (how: string) => ({ disco: 'disco ball 🪩', drone: 'paparazzi drone 📸', bomb: 'party bomb 💣', pudim: 'pudim 🍮', gold: 'gold plating 👑' })[how] ?? how;

function flashSplit(r: RaceCtx, text: string, cls: string, ms = 2000): void {
  r.split = { text, cls, until: performance.now() + ms };
}
function flashCenter(r: RaceCtx, text: string, cls: string, ms = 1500): void {
  r.center = { text, cls, until: performance.now() + ms };
}

// What happened to us this step, on screen and in the speakers.
function ourNotes(r: RaceCtx): void {
  const me = r.me;
  for (const n of me.notes) noteForMe(r, n);
  me.notes = [];
}

function noteForMe(r: RaceCtx, n: Note): void {
  const me = r.me;
  const race = r.rules.mode === 'race';
  switch (n.k) {
    case 'cp':
      checkpointSound(n.diff === null ? null : n.diff < 0);
      if (!race) flashSplit(r, `${fmt(n.ms)}${n.diff === null ? '' : `  ${fmtDiff(n.diff)}`}`, n.diff === null ? 'neutral' : n.diff < 0 ? 'faster' : 'slower');
      break;
    case 'lap':
      lapSound(n.best);
      fx.burst(r.karts.get(me.id)!.model.group.position);
      if (race) {
        if (me.fin === null) {
          const lap = me.run.laps + 1;
          if (lap === r.rules.laps) flashCenter(r, 'FINAL LAP', 'big final', 2200);
          else flashSplit(r, `Lap ${lap}/${r.rules.laps}  ·  ${fmt(n.ms)}`, n.best ? 'faster' : 'neutral');
        }
      } else {
        flashSplit(r, `${n.best ? 'Best lap! ' : 'Lap '}${fmt(n.ms)}${n.diff === null ? '' : `  ${fmtDiff(n.diff)}`}`, n.best ? 'faster' : 'slower', 3000);
        if (n.best) r.ghostLap = r.rec;
        r.rec = [];
      }
      room?.sendLap(n.ms);
      break;
    case 'finish': {
      const place = r.arena.rankOf(me.id);
      sfx.finish(place);
      fx.spray(me.car.p, 300, ['#ffffff', '#d4af37', '#ffe14d', '#ff4fd8'], 10, 12, 2.5);
      flashCenter(r, `${ordinal(place)}!`, `big place p${place}`, 4000);
      room?.sendFin(n.ms);
      break;
    }
    case 'respawn':
      flashSplit(r, 'Respawn', 'neutral', 800);
      break;
    case 'box':
      sfx.box();
      break;
    case 'item':
      sfx.got();
      break;
    case 'use':
      if (n.kind === 'champagne' || n.kind === 'champagne3') {
        sfx.pop();
        fx.spray(me.car.p, 50, ['#fff8e0', '#ffe9a8', '#ffffff'], 4, 7, 0.9);
      } else if (n.kind === 'gold') sfx.got();
      else if (n.kind === 'shield') sfx.shield();
      else if (n.kind !== 'bass') sfx.throw();
      break;
    case 'hit':
      sfx.hit(1);
      r.shake = Math.max(r.shake, 0.8);
      flashCenter(r, n.how === 'gold' ? 'Knocked by gold!' : `${n.by}'s ${howName(n.how)}!`, 'hit', 1400);
      break;
    case 'blocked':
      sfx.shield();
      flashSplit(r, '🛡️ Bodyguard blocked it!', 'faster');
      break;
    case 'shrunk':
      flashCenter(r, `🔊 ${n.by} dropped the bass!`, 'hit', 1600);
      r.shake = Math.max(r.shake, 0.5);
      break;
    case 'bump':
      sfx.bump(n.strength);
      r.shake = Math.max(r.shake, Math.min(0.4, n.strength * 0.03));
      break;
    case 'slip':
      sfx.slip();
      flashSplit(r, '💨 Slipstream!', 'neutral', 900);
      break;
    case 'turbo':
      sfx.turbo(n.level);
      glow.spray(me.car.p, 40, n.level === 2 ? ['#ff9a2e', '#ffd04d'] : ['#5ad1ff', '#ffffff'], 5, 3, 0.4);
      break;
    case 'wall':
      thud(n.strength);
      r.shake = Math.max(r.shake, Math.min(0.5, n.strength * 0.04));
      break;
    case 'land':
      thud(n.strength * 0.5);
      smoke.spray(me.car.p, 14, ['#cfc6b6', '#e0d8c8'], 3, 1, 0.8, 0.3);
      r.shake = Math.max(r.shake, Math.min(0.6, n.strength * 0.05));
      break;
  }
}

// The bots' laps and finishes go to the leaderboard; the rest is for nobody's screen.
function botNotes(b: Racer): void {
  for (const n of b.notes) {
    if (n.k === 'lap') room?.sendLap(n.ms, b.id);
    if (n.k === 'finish') room?.sendFin(n.ms, b.id);
  }
  b.notes = [];
}

function snapOf(x: Racer, steer: number): Snap {
  const c = x.car;
  const info = x.info();
  return {
    id: x.id,
    x: +c.p.x.toFixed(2),
    y: +c.p.y.toFixed(2),
    z: +c.p.z.toFixed(2),
    yaw: +c.yaw.toFixed(3),
    ux: +c.up.x.toFixed(3),
    uy: +c.up.y.toFixed(3),
    uz: +c.up.z.toFixed(3),
    spd: +speedOf(c).toFixed(1),
    st: steer,
    P: +info.P.toFixed(1),
    fl: info.flags,
    g: c.grounded ? 1 : 0,
  };
}

// The others, where they were a moment ago, smoothly; into the arena (for positions, bumps and
// targets) and onto the screen.
function syncOthers(r: RaceCtx, dt: number): void {
  if (!room) return;
  const at = performance.now() - 110;
  const seen = new Set<string>();
  for (const [id, snaps] of room.cars) {
    if (id === r.me.id || r.bots.some((b) => b.racer.id === id)) continue;
    const m = room.lobby.members.find((x) => x.id === id);
    if (!m || snaps.length === 0) continue;
    seen.add(id);
    let i = snaps.length - 1;
    while (i > 0 && snaps[i - 1].at > at) i--;
    const a = snaps[Math.max(0, i - 1)].s;
    const b = snaps[i].s;
    const span = snaps[i].at - snaps[Math.max(0, i - 1)].at;
    const f = span <= 0 ? 1 : Math.max(0, Math.min(1, (at - snaps[Math.max(0, i - 1)].at) / span));
    const jump = Math.hypot(b.x - a.x, b.z - a.z) > 30;
    const L = (p: number, q: number) => (jump ? q : p + (q - p) * f);
    const yaw = jump ? b.yaw : a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * f;
    const x = L(a.x, b.x);
    const y = L(a.y, b.y);
    const z = L(a.z, b.z);
    const fin = room.board.find((e) => e.id === id)?.fin ?? null;
    r.arena.cars.set(id, { id, name: m.name, P: L(a.P, b.P), x, y, z, vx: Math.cos(b.yaw) * b.spd, vz: Math.sin(b.yaw) * b.spd, flags: b.fl, fin });
    let k = r.karts.get(id);
    if (!k || k.driver !== m.driver) {
      hide(k);
      k = showKart(m.driver, m.name);
      r.karts.set(id, k);
    }
    pose(k.model.group, x, y, z, yaw, { x: L(a.ux, b.ux), y: L(a.uy, b.uy), z: L(a.uz, b.uz) });
    k.model.update(b.spd, b.st, dt, !!b.g, b.fl);
    kartEffects(id, k, x, y, z, yaw, Math.abs(b.spd), b.fl, !!b.g, dt);
  }
  for (const [id, k] of r.karts) {
    if (id === r.me.id || r.bots.some((b) => b.racer.id === id) || seen.has(id)) continue;
    hide(k);
    r.karts.delete(id);
    r.arena.cars.delete(id);
  }
}

function stepRace(r: RaceCtx, now: number, dt: number): void {
  const a = r.arena;
  const me = r.me;
  const raceMs = now - r.goAt;
  a.started = raceMs >= 0;
  syncOthers(r, dt);

  for (const act of [...keys.actions(), ...pad.actions()]) {
    if (act === 'horn' && room) {
      horn(r.karts.get(me.id)!.model.driver.horn);
      room.honk();
    }
    if (act === 'camera') r.cam = (r.cam + 1) % 2;
    if (!a.started || r.timeUp) continue;
    if (act === 'use' || act === 'useBack') {
      r.use = true;
      r.back = act === 'useBack';
    }
    if (act === 'respawn' && me.fin === null) me.respawn(a);
    if (act === 'restart' && r.rules.mode === 'time') {
      me.restart(a);
      r.rec = [];
    }
  }
  if (r.rules.mode === 'time' && !r.timeUp && now >= r.endAt) {
    r.timeUp = true;
    flashCenter(r, "Time's up!", 'big', 99999);
  }

  r.acc += Math.min(0.25, dt);
  while (r.acc >= DT) {
    r.acc -= DT;
    a.t = now - r.goAt - r.acc * 1000;
    const k = keys.controls();
    const p = pad.controls();
    const held = { throttle: Math.max(k.throttle, p.throttle), brake: Math.max(k.brake, p.brake), steer: clampSteer(k.steer + p.steer), drift: k.drift || p.drift };
    let ctl: Controls = AUTODRIVE ? { ...autopilot(me.car, track), use: false, back: false } : { ...held, use: false, back: held.brake > 0 };
    if (r.use) {
      ctl = { ...ctl, use: true, back: ctl.back || r.back };
      if (me.item && me.roll <= 0) r.use = false;
      else if (!me.roll) r.use = false;
      if (!r.use) r.back = false;
    }
    if (AUTODRIVE && me.item && me.roll <= 0) ctl = { ...ctl, use: true };
    if (r.timeUp) ctl = { ...NO_CONTROLS, ...stopInput(me.car) };
    r.steer = ctl.steer;
    r.throttle = ctl.throttle;
    me.step(a, ctl, DT);
    a.cars.set(me.id, me.info());
    for (const b of r.bots) {
      const bc = botControls(b.racer, b.brain, a, DT);
      b.steer = bc.steer;
      b.racer.step(a, bc, DT);
      a.cars.set(b.racer.id, b.racer.info());
    }
  }
  a.prune();
  ourNotes(r);
  for (const b of r.bots) botNotes(b.racer);

  room?.sendPos(snapOf(me, r.steer));
  for (const b of r.bots) room?.sendPos(snapOf(b.racer, b.steer));

  // Our kart, and the bots'.
  for (const x of [me, ...r.bots.map((b) => b.racer)]) {
    const k = r.karts.get(x.id)!;
    const c = x.car;
    const info = x.info();
    pose(k.model.group, c.p.x, c.p.y, c.p.z, c.yaw, c.up);
    const fwd = c.v.x * Math.cos(c.yaw) + c.v.z * Math.sin(c.yaw);
    k.model.update(speedOf(c) * Math.sign(fwd || 1), x === me ? r.steer : (r.bots.find((b) => b.racer === x)?.steer ?? 0), dt, c.grounded, info.flags);
    kartEffects(x.id, k, c.p.x, c.p.y, c.p.z, c.yaw, speedOf(c), info.flags, c.grounded, dt);
  }
  r.items.update(a, me.taken, now / 1000, dt);
  engineSound(speedOf(me.car), r.throttle, true);

  // Time attack: record this lap for the ghost, and show the best one.
  const lapMs = raceMs - me.run.lapStart;
  if (r.rules.mode === 'time' && a.started && !r.timeUp) {
    const k = Math.floor(lapMs / 50);
    if (r.rec.length <= k) r.rec[k] = [me.car.p.x, me.car.p.y, me.car.p.z, me.car.yaw, me.car.up.x, me.car.up.y, me.car.up.z];
    if (r.ghostLap) {
      if (!r.ghost) r.ghost = showKart(r.karts.get(me.id)!.driver, null, true);
      const g = r.ghostLap[Math.min(r.ghostLap.length - 1, k)] ?? r.ghostLap.find(Boolean);
      if (g) pose(r.ghost.model.group, g[0], g[1], g[2], g[3], { x: g[4], y: g[5], z: g[6] });
    }
  }

  // The countdown.
  const left = Math.ceil((r.goAt - now) / 1000);
  if (!a.started && left <= 3 && left !== r.lastBeep) {
    r.lastBeep = left;
    beep(false);
  }
  if (a.started && r.lastBeep !== 0 && r.lastBeep < 99) {
    r.lastBeep = 0;
    beep(true);
    flashCenter(r, 'GO!', 'big go', 900);
  }

  // The HUD.
  const isRace = r.rules.mode === 'race';
  const order = a.order();
  const colorOf = (id: string) => driverById(room?.lobby.members.find((m) => m.id === id)?.driver ?? '').color;
  const center = !a.started
    ? { text: left <= 3 ? String(left) : 'Get ready', cls: 'big' }
    : r.center && now < r.center.until
      ? r.center
      : null;
  const grace = room?.isHost ? (room as HostRoom).graceLeft() : null;
  r.hud.set({
    place: isRace ? [a.rankOf(me.id), a.cars.size] : undefined,
    lap: isRace ? (me.fin !== null ? 'Finished' : `Lap ${Math.min(r.rules.laps, me.run.laps + 1)}/${r.rules.laps}`) : a.started && !r.timeUp ? fmt(Math.max(0, lapMs)) : fmt(0),
    time: isRace ? (me.fin !== null ? fmt(me.fin) : a.started ? fmt(raceMs) : fmt(0)) : `Best ${fmt(me.run.best)}`,
    clock: isRace ? (grace !== null ? `Finish in ${Math.ceil(grace / 1000)} s` : '') : `Round ${Math.floor(Math.max(0, r.endAt - now) / 60000)}:${String(Math.floor((Math.max(0, r.endAt - now) % 60000) / 1000)).padStart(2, '0')}`,
    item: me.item,
    rolling: me.roll > 0,
    speed: speedOf(me.car),
    boosting: me.car.boost > 0,
    center,
    split: r.split && now < r.split.until ? r.split : null,
  });
  pad.item(me.item ? ITEMS[me.item.kind].icon : '', me.item?.uses ?? 0, me.roll > 0);
  if (me.roll > 0 && Math.floor(now / 70) !== Math.floor((now - dt * 1000) / 70)) sfx.tick();
  if (Math.floor(now / 250) !== Math.floor((now - dt * 1000) / 250)) {
    if (isRace) {
      const lead = order[0];
      r.hud.board(
        order.map((c: CarInfo) => ({
          id: c.id,
          name: c.name,
          color: colorOf(c.id),
          me: c.id === me.id,
          right: c.fin !== null ? fmt(c.fin) : c === lead ? 'Leader' : `−${Math.max(0, Math.round((lead.P - c.P) / Math.max(10, speedOf(me.car) || 30)))}s`,
        })),
      );
    } else if (room) {
      const list = room.board.length ? room.board : room.lobby.members.map((m) => ({ id: m.id, name: m.name, best: null as number | null }));
      r.hud.board(list.map((e) => ({ id: e.id, name: e.name, color: colorOf(e.id), me: e.id === me.id, right: fmt(e.best) })));
    }
  }
  r.hud.minimap([...a.cars.values()], colorOf, me.id);
}

// ---- Cameras ----

const camPos = new THREE.Vector3(0, 30, 40);
const camLook = new THREE.Vector3();
function chase(r: RaceCtx, dt: number): void {
  const c = r.me.car;
  const close = r.cam === 1;
  const f = new THREE.Vector3(Math.cos(c.yaw), 0, Math.sin(c.yaw));
  const spd = speedOf(c);
  const dist = close ? 4.8 : 7.6 + spd * 0.045;
  const want = new THREE.Vector3(c.p.x, c.p.y, c.p.z).addScaledVector(f, -dist).add(new THREE.Vector3(0, close ? 2.0 : 3.2, 0));
  want.y = Math.max(want.y, world.ground(want.x, want.z) + 1.2);
  camPos.lerp(want, 1 - Math.exp(-dt * (close ? 14 : 8)));
  camLook.set(c.p.x, c.p.y + 1.3, c.p.z).addScaledVector(f, 5);
  camera.position.copy(camPos);
  if (r.shake > 0.01) {
    const s = r.shake * 0.35;
    camera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    r.shake *= Math.exp(-dt * 6);
  }
  camera.lookAt(camLook);
  let fov = 66 + Math.min(20, spd * 0.32) + (c.boost > 0 ? 6 : 0);
  // On a phone held upright, open the view up, or the road is a slot down the middle.
  if (camera.aspect < 1) fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) / Math.sqrt(camera.aspect)));
  if (Math.abs(camera.fov - fov) > 0.1) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }
}

// ---- The loop ----

let last = performance.now();
let attractAcc = 0;
// If a race runs slowly, step the graphics down a level (as far as Low), and say so.
const slow = { frames: 0, time: 0 };
function watchSpeed(dt: number): void {
  if (!race || quality === 'low' || AUTODRIVE) return;
  slow.frames++;
  slow.time += dt;
  if (slow.time < 6) return;
  if (slow.frames / slow.time < 35) {
    quality = quality === 'high' ? 'medium' : 'low';
    remember('pk-quality', quality);
    look.setQuality(quality);
    race.hud.feed(`Graphics lowered to ${quality === 'medium' ? 'Medium' : 'Low'} to keep it smooth`, 'big');
  }
  slow.frames = 0;
  slow.time = 0;
}
function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  world.update(t);

  if (race) {
    watchSpeed(dt);
    stepRace(race, now, dt);
    chase(race, dt);
    look.follow(race.me.car.p);
    if (AUTODRIVE) (window as unknown as { __kart: object }).__kart = { idx: race.me.car.idx, lap: race.me.run.laps, fin: race.me.fin, item: race.me.item?.kind ?? null, place: race.arena.rankOf(race.me.id), cars: race.arena.cars.size, calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
  } else {
    // The menus: bots lapping, the camera on one of them; in the lobby, your car on the stage.
    attractAcc += dt;
    while (attractAcc >= DT) {
      attractAcc -= DT;
      for (const a of attract) if (stepCar(a.car, autopilot(a.car, track, a.caution), track, DT)) a.car = newCar(track, a.car.idx);
    }
    for (const a of attract) {
      pose(a.shown.model.group, a.car.p.x, a.car.p.y, a.car.p.z, a.car.yaw, a.car.up);
      a.shown.model.update(speedOf(a.car), 0, dt, a.car.grounded, a.car.boost > 0 ? FLAG.boost : 0);
      kartEffects(`attract-${a.shown.driver}`, a.shown, a.car.p.x, a.car.p.y, a.car.p.z, a.car.yaw, speedOf(a.car), a.car.boost > 0 ? FLAG.boost : 0, a.car.grounded, dt);
    }
    if (showroomCar && room) {
      const p = world.stage;
      const s = track.samples[40];
      showroomCar.model.group.position.copy(p);
      showroomCar.model.group.rotation.set(0, t * 0.6, 0);
      showroomCar.model.update(0, Math.sin(t) * 0.5, dt, true, 0);
      const toCam = new THREE.Vector3(-s.r.x, 0, -s.r.z).multiplyScalar(7.5).addScaledVector(new THREE.Vector3(s.t.x, 0, s.t.z), -1.5);
      camera.position.set(p.x + toCam.x, p.y + 2.6, p.z + toCam.z);
      const aim = new THREE.Vector3(s.t.x, 0, s.t.z).multiplyScalar(2.4);
      camera.lookAt(p.x + aim.x, p.y + 1.1, p.z + aim.z);
      look.follow(p);
    } else if (attract[0]) {
      const c = attract[0].car;
      // Swing round the lead car slowly.
      const ang = t * 0.25;
      const f = new THREE.Vector3(Math.cos(c.yaw + Math.PI + Math.sin(ang) * 0.9), 0, Math.sin(c.yaw + Math.PI + Math.sin(ang) * 0.9));
      const want = new THREE.Vector3(c.p.x, c.p.y + 3.5, c.p.z).addScaledVector(f, 10);
      want.y = Math.max(want.y, world.ground(want.x, want.z) + 1.5);
      camPos.lerp(want, 1 - Math.exp(-dt * 3));
      camera.position.copy(camPos);
      camera.lookAt(c.p.x, c.p.y + 1, c.p.z);
      look.follow(c.p);
    }
  }
  fx.update(dt);
  glow.update(dt);
  smoke.update(dt);
  look.render();
  requestAnimationFrame(frame);
}

if (AUTODRIVE) (window as unknown as { __scene: THREE.Scene }).__scene = scene;

addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) toggleMute();
});
// A phone suspends the sound when the page goes to the background; the next touch brings it back.
addEventListener('pointerdown', unlockAudio);
addEventListener('touchend', unlockAudio);

render();
// Prepare every driver's materials now, rather than freezing when a race starts.
{
  const warm = DRIVERS.map((d) => showKart(d.id, d.name));
  renderer.compile(scene, camera);
  warm.forEach(hide);
}
requestAnimationFrame(frame);
