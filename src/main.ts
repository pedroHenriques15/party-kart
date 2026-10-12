import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import './style.css';
import { beep, checkpointSound, engineSound, horn, lapSound, thud, toggleMute, unlockAudio } from './audio.ts';
import { autopilot } from './car/autopilot.ts';
import { newCar, speedOf, stepCar, type Car } from './car/car.ts';
import { Keyboard } from './input.ts';
import { advance, newRun, noteSpeed, respawn, restart, startGrid, type Run } from './race.ts';
import { buildKart, driverById, DRIVERS, type KartModel } from './render/drivers.ts';
import { Particles } from './render/fx.ts';
import { nameTag } from './render/textures.ts';
import { buildWorld } from './render/world.ts';
import { ClientRoom, cleanName, HostRoom, type Entry, type Room, type Snap } from './session.ts';
import { LAYOUT } from './track/layout.ts';
import { buildTrack } from './track/track.ts';

const DT = 1 / 120;
// ?autodrive: the autopilot drives your car (for testing the game in a browser).
const AUTODRIVE = new URLSearchParams(location.search).has('autodrive');
const track = buildTrack(LAYOUT);
const keys = new Keyboard();

// ---- Three.js ----

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const ui = document.querySelector<HTMLDivElement>('#ui')!;
const hud = document.querySelector<HTMLDivElement>('#hud')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#dfe7f1', 250, 1400);
// Something for chrome and gold to reflect.
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const camera = new THREE.PerspectiveCamera(68, 1, 0.3, 4000);
scene.add(new THREE.HemisphereLight('#cfe3ff', '#6b7a4a', 1.6));
const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 300 });
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(-0.5, 1, 0.35).normalize();

const world = buildWorld(track);
scene.add(world.group);
const fx = new Particles();
scene.add(fx.points);

function resize(): void {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---- Cars on screen ----

interface Shown {
  model: KartModel;
  tag: THREE.Sprite | null;
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
    tag.scale.set(4, 1, 1);
    tag.position.set(0, 3.4, 0);
    tag.renderOrder = 10;
    model.group.add(tag);
  }
  scene.add(model.group);
  return { model, tag };
}

function hide(s: Shown | null): void {
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

// ---- State ----

let room: Room | null = null;
let notice = '';

interface Race {
  car: Car;
  run: Run;
  shown: Shown;
  goAt: number; // performance.now() of the green light
  endAt: number;
  acc: number;
  over: boolean;
  cam: number; // 0 chase, 1 close
  rec: number[][]; // this lap, every 50 ms
  ghostLap: number[][] | null;
  ghost: Shown | null;
  flash: { text: string; cls: string; until: number } | null;
  lastBeep: number;
}

let race: Race | null = null;
let results: Entry[] | null = null;
const others = new Map<string, Shown & { driver: string }>();

// Bots driving round behind the menus.
const attract: { car: Car; shown: Shown; caution: number }[] = [];
function startAttract(): void {
  if (attract.length) return;
  const picks = [...DRIVERS].sort(() => Math.random() - 0.5).slice(0, 5);
  picks.forEach((d, k) => {
    attract.push({ car: newCar(track, (k * 37 + 2300) % track.samples.length), shown: showKart(d.id, null), caution: 1 + k * 0.06 });
  });
}
function stopAttract(): void {
  for (const a of attract) hide(a.shown);
  attract.length = 0;
}

function myName(): string {
  try {
    return localStorage.getItem('pk-name') ?? '';
  } catch {
    return '';
  }
}
function myDriver(): string {
  try {
    return localStorage.getItem('pk-driver') ?? DRIVERS[0].id;
  } catch {
    return DRIVERS[0].id;
  }
}
function remember(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private window */
  }
}

const roomFromUrl = () => (new URLSearchParams(location.search).get('room') ?? '').trim().toLowerCase();
const inviteLink = (code: string) => `${location.origin}${location.pathname}?room=${code}`;
const fmt = (ms: number | null) => {
  if (ms === null) return '–';
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};
const fmtDiff = (ms: number) => `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(3)}`;

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

function homeScreen(): HTMLElement {
  let driver = myDriver();
  const name = h('input', { maxLength: 16, placeholder: 'Your name', value: myName(), autocomplete: 'off' });
  const code = h('input', { class: 'code-in', maxLength: 5, placeholder: 'Room code', value: roomFromUrl(), autocomplete: 'off', spellcheck: false });
  const err = h('p', { class: 'err' }, notice);
  const grid = h('div', {});
  const drawGrid = () => grid.replaceChildren(driverGrid(driver, new Map(), (id) => {
    driver = id;
    remember('pk-driver', id);
    drawGrid();
  }));
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
    h('p', { class: 'tag' }, "P. Kiddy's White Party · Braga Grand Prix. Race your friends, Trackmania-style."),
    h('label', {}, 'Your name', name),
    h('label', {}, 'Your driver'),
    grid,
    invited ? h('button', { class: 'primary', onclick: join }, `Join room ${invited}`) : h('button', { class: 'primary', onclick: host }, 'Create a room'),
    h('div', { class: 'or' }, invited ? 'or' : 'or join one'),
    invited ? h('button', { onclick: host }, 'Create my own room') : h('div', { class: 'row' }, code, h('button', { onclick: join }, 'Join')),
    err,
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
      h('li', {}, h('b', {}, 'Drive'), ' arrows or WASD. ', h('b', {}, 'Drift'), ' hold Space in a corner.'),
      h('li', {}, h('b', {}, 'Enter'), ' back to your last checkpoint, at the speed you passed it. ', h('b', {}, 'Backspace'), ' restart the lap.'),
      h('li', {}, h('b', {}, 'H'), ' horn · ', h('b', {}, 'C'), ' camera · ', h('b', {}, 'M'), ' sound.'),
      h('li', {}, 'Time attack: everyone drives at once, through each other. Your best lap before the clock runs out counts. Orange pads boost you.'),
    ),
  );
}

function lobbyScreen(r: Room): HTMLElement {
  const me = r.lobby.members.find((m) => m.id === r.you);
  const taken = new Map(r.lobby.members.filter((m) => m.id !== r.you).map((m) => [m.driver, m.name] as const));
  if (me) showroom(me.driver);
  const copy = h(
    'button',
    {
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(inviteLink(r.lobby.code));
          copy.textContent = 'Copied!';
        } catch {
          prompt('Send this link to your friends:', inviteLink(r.lobby.code));
        }
      },
    },
    'Copy invite link',
  );
  const minutes = h(
    'select',
    { disabled: !r.isHost, onchange: () => (r as HostRoom).setMinutes(Number(minutes.value)) },
    ...[2, 3, 4, 5, 8, 10].map((n) => h('option', { value: String(n), selected: n === r.lobby.minutes }, `${n} minutes`)),
  );
  return h(
    'div',
    { class: 'panel lobby' },
    h('div', { class: 'room' }, h('div', {}, h('span', { class: 'label' }, 'Room'), h('b', { class: 'code' }, r.lobby.code)), copy),
    h('div', { class: 'members' }, ...r.lobby.members.map((m) => h('span', { class: 'chip', style: `--c:${driverById(m.driver).color}` }, m.id === r.you ? `${m.name} (you)` : m.name, h('small', {}, driverById(m.driver).name)))),
    h('label', {}, 'Your driver'),
    driverGrid(me?.driver ?? '', taken, (id) => {
      remember('pk-driver', id);
      r.pick(id);
    }),
    h('div', { class: 'settings' }, h('label', {}, 'Round ', minutes)),
    r.isHost
      ? h('button', { class: 'primary', onclick: () => (r as HostRoom).start() }, 'Start the round')
      : h('p', { class: 'wait' }, 'Waiting for the host to start…'),
    h('button', { class: 'ghost', onclick: leave }, 'Leave the room'),
    howTo(),
  );
}

function resultsScreen(r: Room, list: Entry[]): HTMLElement {
  return h(
    'div',
    { class: 'panel results' },
    h('h2', {}, 'Results'),
    h(
      'ol',
      { class: 'podium' },
      ...list.map((e, k) =>
        h(
          'li',
          { class: e.id === r.you ? 'me' : '' },
          h('span', { class: 'pos' }, String(k + 1)),
          h('span', { class: 'swatch', style: `--c:${driverById(e.driver).color};--t:${driverById(e.driver).trim}` }),
          h('span', { class: 'who' }, e.name, h('small', {}, driverById(e.driver).name)),
          h('span', { class: 'time' }, fmt(e.best)),
        ),
      ),
    ),
    r.isHost
      ? h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => (r as HostRoom).start() }, 'Race again'), h('button', { onclick: () => { results = null; render(); } }, 'Back to the lobby'))
      : h('div', { class: 'row' }, h('p', { class: 'wait' }, 'Waiting for the host…'), h('button', { onclick: () => { results = null; render(); } }, 'Change driver')),
  );
}

function leave(): void {
  if (room) {
    if (room.isHost && room.lobby.members.length > 1 && !confirm('Close the room for everyone?')) return;
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
  r.onStart = (goIn, endIn) => startRace(goIn, endIn);
  r.onEnd = (list) => {
    results = list;
    endRace();
    render();
  };
  r.onHonk = (id) => {
    const m = r.lobby.members.find((x) => x.id === id);
    if (m) horn(driverById(m.driver).horn, 0.6);
  };
  r.onBoard = () => drawBoard();
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
  document.body.classList.toggle('racing', !!race);
  if (race) {
    ui.replaceChildren(h('div', { class: 'bar' }, h('span', {}, 'Room ', h('b', {}, room?.lobby.code ?? '')), room?.isHost ? h('button', { class: 'small ghost', onclick: () => (room as HostRoom).endNow() }, 'End round') : null, h('button', { class: 'small ghost', onclick: leave }, 'Leave')));
    return;
  }
  startAttract();
  if (!room) {
    hide(showroomCar);
    showroomCar = null;
  }
  if (!room) ui.replaceChildren(homeScreen());
  else if (results) ui.replaceChildren(resultsScreen(room, results));
  else ui.replaceChildren(lobbyScreen(room));
}

// The lobby's showroom: your car turning slowly on the start line.
let showroomCar: Shown | null = null;
function showroom(driverId: string): void {
  if (showroomCar?.model.driver.id === driverId) return;
  hide(showroomCar);
  showroomCar = showKart(driverId, null);
}

// ---- The race ----

function startRace(goIn: number, endIn: number): void {
  endRace();
  hide(showroomCar);
  showroomCar = null;
  stopAttract();
  results = null;
  const me = room!.lobby.members.find((m) => m.id === room!.you)!;
  const now = performance.now();
  const goAt = now + goIn;
  race = {
    car: newCar(track, startGrid(track)),
    run: newRun(0),
    shown: showKart(me.driver, null),
    goAt,
    endAt: now + endIn,
    acc: 0,
    over: false,
    cam: 0,
    rec: [],
    ghostLap: null,
    ghost: null,
    flash: null,
    lastBeep: 99,
  };
  (document.activeElement as HTMLElement | null)?.blur();
  buildHud();
  render();
}

function endRace(): void {
  if (!race) return;
  hide(race.shown);
  hide(race.ghost);
  race = null;
  for (const o of others.values()) hide(o);
  others.clear();
  engineSound(0, 0, false);
  hud.replaceChildren();
}

let hudEls: Record<string, HTMLElement> = {};
function buildHud(): void {
  hudEls = {
    clock: h('div', { class: 'clock' }),
    lap: h('div', { class: 'lap' }),
    best: h('div', { class: 'best' }),
    center: h('div', { class: 'center' }),
    split: h('div', { class: 'split' }),
    speed: h('div', { class: 'speed' }),
    board: h('ol', { class: 'board' }),
    keys: h('div', { class: 'keys' }, 'Arrows drive · Space drift · Enter checkpoint · Backspace restart · H horn · C camera'),
  };
  hud.replaceChildren(h('div', { class: 'times' }, hudEls.clock, hudEls.lap, hudEls.best), hudEls.center, hudEls.split, hudEls.speed, hudEls.board, hudEls.keys);
  drawBoard();
}

function drawBoard(): void {
  if (!race || !room || !hudEls.board) return;
  const list = room.board.length ? room.board : room.lobby.members.map((m) => ({ id: m.id, name: m.name, driver: m.driver, best: null, laps: 0 }));
  hudEls.board.replaceChildren(
    ...list.map((e) =>
      h('li', { class: e.id === room!.you ? 'me' : '', style: `--c:${driverById(e.driver).color}` }, h('span', { class: 'who' }, e.name), h('span', { class: 'time' }, fmt(e.best))),
    ),
  );
}

function stepRace(r: Race, now: number, frameDt: number): void {
  const started = now >= r.goAt;
  const raceMs = now - r.goAt;
  for (const a of keys.actions()) {
    if (a === 'horn' && room) {
      horn(r.shown.model.driver.horn);
      room.honk();
    }
    if (a === 'camera') r.cam = (r.cam + 1) % 2;
    if (!started || r.over) continue;
    if (a === 'respawn') r.car = respawn(r.run, track, raceMs);
    if (a === 'restart') {
      r.car = restart(r.run, track, raceMs);
      r.rec = [];
    }
  }
  if (!r.over && now >= r.endAt) {
    r.over = true;
    flash(r, "Time's up!", 'big', 99999);
  }

  const ctl = AUTODRIVE ? autopilot(r.car, track) : keys.controls();
  const input = started && !r.over ? ctl : { throttle: 0, brake: 1, steer: 0, drift: false };
  r.acc += Math.min(0.25, frameDt);
  while (r.acc >= DT) {
    r.acc -= DT;
    const from = r.car.idx;
    const t = (performance.now() - r.goAt) - r.acc * 1000;
    if (stepCar(r.car, input, track, DT)) {
      r.car = respawn(r.run, track, t);
      flash(r, 'Respawn', 'small', t + 800);
      continue;
    }
    if (r.car.wallHit > 3) thud(r.car.wallHit);
    if (!started || r.over) continue;
    const e = advance(r.run, track, from, r.car.idx, t);
    if (e) noteSpeed(r.run, r.car);
    if (e?.k === 'cp') {
      checkpointSound(e.diff === null ? null : e.diff < 0);
      flash(r, `${fmt(e.ms)}${e.diff === null ? '' : `  ${fmtDiff(e.diff)}`}`, e.diff === null ? 'neutral' : e.diff < 0 ? 'faster' : 'slower', t + 2000);
    }
    if (e?.k === 'lap') {
      lapSound(e.best);
      fx.burst(r.shown.model.group.position);
      flash(r, `${e.best ? 'Best lap! ' : 'Lap '}${fmt(e.ms)}${e.diff === null ? '' : `  ${fmtDiff(e.diff)}`}`, e.best ? 'faster' : 'slower', t + 3000);
      if (e.best) r.ghostLap = r.rec;
      r.rec = [];
      room?.sendLap(e.ms);
    }
  }

  // Record this lap for the ghost; draw the best one.
  const lapMs = raceMs - r.run.lapStart;
  if (started && !r.over) {
    const k = Math.floor(lapMs / 50);
    if (r.rec.length <= k) r.rec[k] = [r.car.p.x, r.car.p.y, r.car.p.z, r.car.yaw, r.car.up.x, r.car.up.y, r.car.up.z];
  }
  if (r.ghostLap && started) {
    if (!r.ghost) r.ghost = showKart(r.shown.model.driver.id, null, true);
    const g = r.ghostLap[Math.min(r.ghostLap.length - 1, Math.floor(lapMs / 50))] ?? r.ghostLap.find(Boolean);
    if (g) pose(r.ghost.model.group, g[0], g[1], g[2], g[3], { x: g[4], y: g[5], z: g[6] });
  }

  const c = r.car;
  const spd = speedOf(c);
  if (AUTODRIVE) (window as unknown as { __kart: object }).__kart = { idx: c.idx, lap: r.run.laps };
  pose(r.shown.model.group, c.p.x, c.p.y, c.p.z, c.yaw, c.up);
  r.shown.model.update(spd * Math.sign(c.v.x * Math.cos(c.yaw) + c.v.z * Math.sin(c.yaw) || 1), input.steer, frameDt, c.grounded);
  const back = new THREE.Vector3(-Math.cos(c.yaw), 0, -Math.sin(c.yaw));
  fx.trail('me', r.shown.model.driver.trail, r.shown.model.group.position, back, spd, c.boost > 0, frameDt);
  engineSound(spd, input.throttle, true);
  room?.sendPos({
    id: room.you,
    x: +c.p.x.toFixed(2),
    y: +c.p.y.toFixed(2),
    z: +c.p.z.toFixed(2),
    yaw: +c.yaw.toFixed(3),
    ux: +c.up.x.toFixed(3),
    uy: +c.up.y.toFixed(3),
    uz: +c.up.z.toFixed(3),
    spd: +spd.toFixed(1),
    st: input.steer,
    b: c.boost > 0 ? 1 : 0,
    g: c.grounded ? 1 : 0,
  });

  // The countdown.
  const left = Math.ceil((r.goAt - now) / 1000);
  if (!started && left <= 3 && left !== r.lastBeep) {
    r.lastBeep = left;
    beep(false);
  }
  if (started && r.lastBeep !== 0 && r.lastBeep < 99) {
    r.lastBeep = 0;
    beep(true);
    flash(r, 'GO!', 'big go', raceMs + 900);
  }

  // The HUD.
  const remaining = Math.max(0, r.endAt - now);
  hudEls.clock.textContent = `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}`;
  hudEls.lap.textContent = started && !r.over ? fmt(Math.max(0, lapMs)) : fmt(0);
  hudEls.best.textContent = `Best ${fmt(r.run.best)}`;
  hudEls.speed.textContent = `${Math.round(spd * 3.6)}`;
  hudEls.speed.dataset.boost = c.boost > 0 ? '1' : '';
  if (!started) {
    hudEls.center.textContent = left <= 3 ? String(left) : 'Get ready';
    hudEls.center.className = 'center big';
  } else if (r.flash && (r.flash.cls.includes('big') ? raceMs < r.flash.until : false)) {
    hudEls.center.textContent = r.flash.text;
    hudEls.center.className = `center ${r.flash.cls}`;
  } else {
    hudEls.center.textContent = '';
  }
  if (r.flash && !r.flash.cls.includes('big') && raceMs < r.flash.until) {
    hudEls.split.textContent = r.flash.text;
    hudEls.split.className = `split ${r.flash.cls}`;
  } else hudEls.split.textContent = '';
}

function flash(r: Race, text: string, cls: string, until: number): void {
  r.flash = { text, cls, until };
}

// The others: where they were a moment ago, smoothly.
function drawOthers(frameDt: number): void {
  if (!room) return;
  const at = performance.now() - 110;
  for (const [id, snaps] of room.cars) {
    const m = room.lobby.members.find((x) => x.id === id);
    if (!m || snaps.length === 0) continue;
    let o = others.get(id);
    if (!o || o.driver !== m.driver) {
      hide(o ?? null);
      o = { ...showKart(m.driver, m.name), driver: m.driver };
      others.set(id, o);
    }
    let i = snaps.length - 1;
    while (i > 0 && snaps[i - 1].at > at) i--;
    const a = snaps[Math.max(0, i - 1)];
    const b = snaps[i];
    const f = b.at === a.at ? 1 : Math.max(0, Math.min(1, (at - a.at) / (b.at - a.at)));
    const L = (x: number, y: number) => x + (y - x) * f;
    const s = b.s;
    const jump = Math.hypot(b.s.x - a.s.x, b.s.z - a.s.z) > 30;
    const yaw = a.s.yaw + Math.atan2(Math.sin(b.s.yaw - a.s.yaw), Math.cos(b.s.yaw - a.s.yaw)) * f;
    if (jump) pose(o.model.group, s.x, s.y, s.z, s.yaw, { x: s.ux, y: s.uy, z: s.uz });
    else pose(o.model.group, L(a.s.x, s.x), L(a.s.y, s.y), L(a.s.z, s.z), yaw, { x: L(a.s.ux, s.ux), y: L(a.s.uy, s.uy), z: L(a.s.uz, s.uz) });
    o.model.update(s.spd, s.st, frameDt, !!s.g);
    const back = new THREE.Vector3(-Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    fx.trail(id, o.model.driver.trail, o.model.group.position, back, Math.abs(s.spd), !!s.b, frameDt);
  }
  for (const [id, o] of others) {
    if (!room.cars.has(id) || !room.lobby.members.some((m) => m.id === id)) {
      hide(o);
      others.delete(id);
    }
  }
}

// ---- Cameras ----

const camPos = new THREE.Vector3(0, 30, 40);
const camLook = new THREE.Vector3();
function chase(c: Car, close: boolean, dt: number): void {
  const f = new THREE.Vector3(Math.cos(c.yaw), 0, Math.sin(c.yaw));
  const spd = speedOf(c);
  const dist = close ? 4.6 : 7.5 + spd * 0.04;
  const want = new THREE.Vector3(c.p.x, c.p.y, c.p.z).addScaledVector(f, -dist).add(new THREE.Vector3(0, close ? 1.9 : 3.1, 0));
  want.y = Math.max(want.y, world.ground(want.x, want.z) + 1.2);
  camPos.lerp(want, 1 - Math.exp(-dt * (close ? 14 : 8)));
  camLook.set(c.p.x, c.p.y + 1.3, c.p.z).addScaledVector(f, 5);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  const fov = 66 + Math.min(18, spd * 0.32);
  if (Math.abs(camera.fov - fov) > 0.1) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }
}

// ---- The loop ----

let last = performance.now();
let attractAcc = 0;
function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  world.update(t);

  if (race) {
    stepRace(race, now, dt);
    drawOthers(dt);
    chase(race.car, race.cam === 1, dt);
    sunFollow(race.car.p);
  } else {
    // The menus: bots lapping, the camera on one of them; in the lobby, your car up close.
    attractAcc += dt;
    while (attractAcc >= DT) {
      attractAcc -= DT;
      for (const a of attract) if (stepCar(a.car, autopilot(a.car, track, a.caution), track, DT)) a.car = newCar(track, a.car.idx);
    }
    for (const a of attract) {
      pose(a.shown.model.group, a.car.p.x, a.car.p.y, a.car.p.z, a.car.yaw, a.car.up);
      a.shown.model.update(speedOf(a.car), 0, dt, a.car.grounded);
      fx.trail(a.shown.model.driver.id + 'a', a.shown.model.driver.trail, a.shown.model.group.position, new THREE.Vector3(-Math.cos(a.car.yaw), 0, -Math.sin(a.car.yaw)), speedOf(a.car), a.car.boost > 0, dt);
    }
    if (showroomCar && room) {
      // On the party stage, framed in the right half of the screen, clear of the panel.
      const p = world.stage;
      const s = track.samples[40];
      showroomCar.model.group.position.copy(p);
      showroomCar.model.group.rotation.set(0, t * 0.6, 0);
      showroomCar.model.update(0, Math.sin(t) * 0.5, dt, true);
      const toCam = new THREE.Vector3(-s.r.x, 0, -s.r.z).multiplyScalar(7.5).addScaledVector(new THREE.Vector3(s.t.x, 0, s.t.z), -1.5);
      camera.position.set(p.x + toCam.x, p.y + 2.6, p.z + toCam.z);
      const aim = new THREE.Vector3(s.t.x, 0, s.t.z).multiplyScalar(2.4);
      camera.lookAt(p.x + aim.x, p.y + 1.1, p.z + aim.z);
      sunFollow(p);
    } else if (attract[0]) {
      const c = attract[0].car;
      // Swing round the lead car slowly.
      const a = t * 0.25;
      const f = new THREE.Vector3(Math.cos(c.yaw + Math.PI + Math.sin(a) * 0.9), 0, Math.sin(c.yaw + Math.PI + Math.sin(a) * 0.9));
      const want = new THREE.Vector3(c.p.x, c.p.y + 3.5, c.p.z).addScaledVector(f, 10);
      want.y = Math.max(want.y, world.ground(want.x, want.z) + 1.5);
      camPos.lerp(want, 1 - Math.exp(-dt * 3));
      camera.position.copy(camPos);
      camera.lookAt(c.p.x, c.p.y + 1, c.p.z);
      sunFollow(c.p);
    }
  }
  fx.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function sunFollow(p: { x: number; y: number; z: number }): void {
  sun.target.position.set(p.x, p.y, p.z);
  sun.position.set(p.x + SUN_DIR.x * 100, p.y + SUN_DIR.y * 100, p.z + SUN_DIR.z * 100);
}

addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) toggleMute();
});

render();
requestAnimationFrame(frame);
