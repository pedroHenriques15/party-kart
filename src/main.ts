import { map as bragaMap, type Track as Course } from 'braga-map';
import * as THREE from 'three';
import './style.css';
import { ambienceOf } from './ambience.ts';
import { beep, checkpointSound, cityHeard, cityIs, citySound, engines, fightSfx, horn, isMuted, lapSound, listen, measureAudio, played, readMeter, recordAudio, recordState, resetMeter, sfx, thud, toggleMute, unlockAudio, type Kart } from './audio.ts';
import { autopilot } from './car/autopilot.ts';
import { carAt, clampSteer, newCar, speedOf, stopInput, type Car, type Input } from './car/car.ts';
import { Arena, FLAG, type ArenaFx, type CarInfo, type Rules } from './game/arena.ts';
import { botControls, newBrain, type Brain } from './game/bot.ts';
import { field, fighterOf, fire, KIT_IDS, KITS, landed, pickSpawn, RESPAWN, seeOn, Soldier, spreadOf, struck, type Body, type DownEv, type Field, type FightEv, type KitId, type ShotEv } from './game/fight.ts';
import { Flyer, landing, type Bound, type FlyInput } from './game/flyer.ts';
import { SKILLS, Squad, type FootBot, type Mark } from './game/footbot.ts';
import { ITEMS } from './game/items.ts';
import { NO_CONTROLS, Racer, type Controls, type Note } from './game/racer.ts';
import { Roamer } from './game/roamer.ts';
import { alight, EYE, STAND, type WalkInput, Walker } from './game/walker.ts';
import { FightHud, fmt, fmtDiff, Hud, ordinal, RoamHud } from './hud.ts';
import { Keyboard, Mouse, TouchPad } from './input.ts';
import { addScaled, clamp, v3, type V } from './math.ts';
import { buildEdge, ShotsView, Viewmodel } from './render/arms.ts';
import { buildKart, buildWalker, driverById, DRIVERS, type KartModel, type WalkerModel } from './render/drivers.ts';
import { Particles } from './render/fx.ts';
import { ItemsView } from './render/items3d.ts';
import { Look, SUN_DIR, type Quality } from './render/look.ts';
import { Skids } from './render/skids.ts';
import { nameTag } from './render/textures.ts';
import { buildCity, type RaceWorld } from './render/city.ts';
import type { EggEvent } from './render/eggs.ts';
import { ClientRoom, cleanName, HOST_ID, HostRoom, MAX_RACERS, type Entry, type GameEv, type Room, type Snap } from './session.ts';
import { Stats, textureBytes } from './stats.ts';
import { buildTrack, locate, type Track } from './track/track.ts';
import { courseById, HOME, km, TRACKS } from './tracks.ts';
import { streetNames } from './world/names.ts';
import type { Blocker } from './world/sight.ts';

const DT = 1 / 120;
// ?autodrive: the autopilot drives your car in a race (for testing the game in a browser), and
// window.__kart says where you are, round the city or in the race. With &at=<sample> as well, your
// car starts the race there, to look at one part of the track.
const AUTODRIVE = new URLSearchParams(location.search).has('autodrive');
// ?view=x,y,z,tx,ty,tz holds the camera at (x, y, z) looking at (tx, ty, tz), for looking at the
// scenery. A seventh number sets its vertical field of view, in degrees.
const VIEW = new URLSearchParams(location.search).get('view')?.split(',').map(Number) ?? null;
const START_AT = AUTODRIVE ? Number(new URLSearchParams(location.search).get('at')) || 0 : 0;
// ?record=60 records the first 60 s of the next race's sound, from its countdown, and offers it as a
// file, to judge the sound by ear (scripts/listen.mjs records the takes it's judged by).
const RECORD = Number(new URLSearchParams(location.search).get('record')) || 0;
// ?scenery: the city alone, built as the game builds it and seen from ?view=, with no menus, room or
// karts, for shooting the viewpoints (scripts/shots.mjs). The textures' noise comes out the same
// every time and nothing moves, so two shots of the same city match. What a frame costs is in
// window.__kart.
const SCENERY = new URLSearchParams(location.search).has('scenery');
// ?stats: what the game costs on this screen, in a corner, for measuring it on a phone.
const STATS = new URLSearchParams(location.search).has('stats');
if (SCENERY) {
  let seed = 1;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
// The tracks as the game drives them, by id (tracks.ts); the home track's is the city's.
const tracks = new Map(TRACKS.map(({ course: c }) => [c.id, buildTrack(c.points, c.ramps)]));
const home = tracks.get(HOME.id)!;
const keys = new Keyboard();
const pad = new TouchPad();
// A phone or a tablet: its finger is its pointer.
const PHONE = matchMedia('(pointer: coarse)').matches;

// ---- Three.js ----

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const mouse = new Mouse(canvas);
const ui = document.querySelector<HTMLDivElement>('#ui')!;
const hudRoot = document.querySelector<HTMLDivElement>('#hud')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 1, 0.3, 30000);
const look = new Look(renderer, scene, camera);
// A phone or a tablet starts at medium, and one with 4 GB or less at low: Braga takes some 500 MB to build.
const SMALL = ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
let quality = stored('pk-quality', PHONE ? (SMALL ? 'low' : 'medium') : 'high') as Quality;
// A phone that runs out of memory for the graphics loses them: the canvas goes blank and stays so,
// under the HUD. Say so, and open a step lower the next time.
canvas.addEventListener('webglcontextlost', lostGraphics, { once: true });
const building = performance.now();
const world = await buildCity(home, HOME, quality, renderer);
// What's round every part of the city, for its sound: from the map the karts drive on, once the city
// is up and the game is running, so it never holds the page.
if (!SCENERY) setTimeout(() => cityIs(ambienceOf(world.drive.d.world)), 1500);
const buildMs = performance.now() - building;
// Each track's race, built with the city: its ground and the marks it adds to the streets.
const racing = performance.now();
const races = new Map(TRACKS.map(({ course: c }) => [c.id, world.raceOn(tracks.get(c.id)!, c)]));
const racesMs = performance.now() - racing;
console.info(`The city took ${Math.round(buildMs)} ms to build, and the races ${Math.round(racesMs)} ms (${TRACKS.length}).`);
scene.add(world.group);
const stats = STATS ? new Stats(renderer, scene, buildMs, performance.now()) : null;
const fx = new Particles(0.55);
const glow = new Particles(0.32, true);
const smoke = new Particles(1.8);
const skids = new Skids();
scene.add(fx.points, glow.points, smoke.points, skids.mesh);
addEventListener('resize', () => look.resize());

function lostGraphics(e: Event): void {
  e.preventDefault();
  const lower: Quality = quality === 'high' ? 'medium' : 'low';
  remember('pk-quality', lower);
  const lost = document.createElement('div');
  lost.id = 'lost';
  const say = document.createElement('p');
  say.textContent = 'O telemóvel ficou sem memória para os gráficos. ' + (lower !== quality ? 'Ao recarregar, o jogo abre com gráficos mais leves.' : 'Fecha as outras abas e apps, e recarrega.');
  const again = document.createElement('button');
  again.textContent = 'Recarregar';
  again.onclick = () => {
    leaving = true;
    location.reload();
  };
  lost.append(say, again);
  document.body.append(lost);
}
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

look.setQuality(quality);

// ---- Karts on screen ----

interface Shown {
  model: KartModel;
  tag: THREE.Sprite | null;
  driver: string;
  label: string | null;
  walker: WalkerModel | null; // another player out of their kart, standing (braga-map's task 073)
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
  return { model, tag, driver: driverId, label, walker: null };
}

function hide(s: Shown | null | undefined): void {
  if (!s) return;
  scene.remove(s.model.group);
  if (s.walker) scene.remove(s.walker.group);
}

// Name tags keep to a readable size: never bigger on screen than they are 18 m away, and gone when
// a kart is right by the camera, so a kart close behind never covers the screen with its name.
const tagAt = new THREE.Vector3();
function fitTags(karts: Iterable<Shown>): void {
  for (const k of karts) {
    if (!k.tag) continue;
    const d = camera.position.distanceTo(k.tag.getWorldPosition(tagAt));
    const f = Math.min(1, d / 18);
    k.tag.scale.set(3 * f, 0.75 * f, 1);
    k.tag.material.opacity = Math.max(0, Math.min(1, (d - 3) / 4));
  }
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

// Smoke from the café's cigarette, going along with the kart as it rises away above the driver.
function cigarette(k: Shown, c: Car, dt: number): void {
  if (Math.random() >= dt * 5) return;
  const tip = k.model.ember.getWorldPosition(new THREE.Vector3());
  fx.add(tip.x, tip.y + 0.1, tip.z, c.v.x * 0.97 + (Math.random() - 0.5) * 0.3, 1.6, c.v.z * 0.97 + (Math.random() - 0.5) * 0.3, 0.7, '#ececea', 1.2);
}

// ---- State ----

// The room you're in, if any: made when you invite friends, or joined from a link or a code.
let room: Room | null = null;
// What the menu says about the room: why it closed, or what went wrong.
let notice = '';
// What the menu is waiting on: a room opening, or joining one.
let busy = '';
let results: Entry[] | null = null;
// The menu, over the world; and its page: the main one, the race's settings, or the deathmatch's.
let menu = false;
let page: 'main' | 'race' | 'fight' = 'main';

interface RaceCtx {
  course: Course;
  track: Track;
  on: RaceWorld; // its ground and marks
  arena: Arena;
  rules: Rules;
  me: Racer;
  kart: Shown;
  bots: { racer: Racer; brain: Brain; steer: number; throttle: number }[];
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
  vice: number; // performance.now() until which the café's cigarette and beer last
}

let race: RaceCtx | null = null;

// Driving round the city, alone or with the room (braga-map's decision 019): your car on the
// world's ground, the others where they are, the screen and the sound round you.
interface RoamCtx {
  me: Roamer;
  kart: Shown;
  karts: Map<string, Shown>; // the others'
  cars: Map<string, CarInfo>; // the others, where they're drawn, for bumping into
  hud: RoamHud;
  acc: number;
  cam: number;
  steer: number;
  throttle: number;
  shake: number;
  vice: number;
  idx: number | null; // the track's sample you're by while you're on the route, for the eggs
  street: string; // the street whose name was shown last
  stride: number; // on foot, metres since your last footstep
  kept: number; // performance.now() when where you are was last kept
  fly: Flyer | null; // the camera, while you fly and your kart waits (braga-map's task 054)
  walk: Walker | null; // you, on foot, while your kart waits (braga-map's task 073)
  eye: number; // on foot, the camera's height, easing up a kerb or a tread
  hop: boolean; // on foot, a jump asked for and not yet stepped
}

let roam: RoamCtx | null = null;

// The deathmatch (braga-map's task 074): a round on foot in Fujacal, in free roam, your kart waiting
// where it was; started by the host as a race is. You, the round's clock, the kit to come back with,
// and what's on the screen.
interface FightCtx {
  goAt: number; // performance.now() of the start: the round's clock is ms since
  endAt: number;
  me: Soldier;
  hud: FightHud;
  kit: KitId; // to come back with
  chose: boolean; // chosen while the kits are up, this time
  by: string; // who put you down last
  fell: number; // performance.now() when you went down
  hurt: number; // how red the screen's edge is, fading
  from: { id: string; x: number; z: number; at: number }[]; // who shot you lately, from where, when (performance.now())
  center: { text: string; until: number } | null;
  lastBeep: number;
  started: boolean;
  scores: boolean; // shown, by the bar's button on a touch screen
  downs: number;
  squad: Squad | null; // the bots, if you host (braga-map's task 075)
}

let fight: FightCtx | null = null;
// The kit you last chose, for the next round.
let lastKit: KitId = 'rifle';
// Where you were when the race started, to go back to when it's over.
let before: Car | null = null;
// Whether a friend who has just joined has been put beside the host yet.
let besideHost = true;

const roomFromUrl = () => (new URLSearchParams(location.search).get('room') ?? '').trim().toLowerCase();
const inviteLink = (code: string) => `${location.origin}${location.pathname}?room=${code}`;
const myName = () => cleanName(stored('pk-name', ''));
// The driver you last picked, kept in this browser.
let picked = driverById(stored('pk-driver', DRIVERS[0].id)).id;
// Your driver: the room's say, as it gives another when someone else has yours; else your pick.
function myDriver(): string {
  return room?.lobby.members.find((x) => x.id === room!.you)?.driver ?? picked;
}
const colorOf = (id: string) => driverById(room?.lobby.members.find((m) => m.id === id)?.driver ?? '').color;
// A line in the feed of whichever screen is up.
const feed = (text: string, cls = '') => (race?.hud ?? roam?.hud)?.feed(text, cls);

// On a phone, the game wants the whole screen. Browsers only allow that in answer to a tap, so the
// first tap asks for it, and the buttons that lead to driving. (An iPhone can't; added to the home
// screen, it opens without the browser round it anyway.)
function fullScreen(): void {
  if (!PHONE || !document.fullscreenEnabled || document.fullscreenElement) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}

// On a computer, the bar's "Ecrã inteiro": in full screen the game locks the keyboard (Chrome and
// Edge), so the keys a browser keeps for itself, Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Tab and Esc among them,
// come to the game instead, and none closes the page or leaves full screen by mistake: Esc is the
// menu, and held, the browser says, leaves full screen.
function wholeScreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
const keyboardLock = () => (navigator as Navigator & { keyboard?: { lock?: () => Promise<void>; unlock?: () => void } }).keyboard;
document.addEventListener('fullscreenchange', () => {
  if (PHONE) return;
  if (document.fullscreenElement) keyboardLock()?.lock?.().catch(() => {});
  else keyboardLock()?.unlock?.();
  render();
});
// In full screen, Ctrl and Cmd with a key do nothing of the browser's, menu or no menu.
addEventListener('keydown', (e) => {
  if (document.fullscreenElement && (e.ctrlKey || e.metaKey) && !(e.target instanceof HTMLElement && e.target.closest('input, textarea'))) e.preventDefault();
});
const wholeBtn = () =>
  !PHONE &&
  document.fullscreenEnabled &&
  h(
    'button',
    { class: 'small ghost keys-only', title: 'No ecrã inteiro, Ctrl+W, Ctrl+T e Esc já não te tiram do jogo (Esc premido muito tempo sai do ecrã inteiro)', onclick: wholeScreen },
    document.fullscreenElement ? '⛶ Sair do ecrã inteiro' : '⛶ Ecrã inteiro',
  );

// In a room, a race or a round, the page doesn't go by mistake: Back (a mouse's side button,
// Alt+←, a swipe) only comes back to the game, as the page pushes an entry of its own on the history
// for it to take, and closing or reloading the page asks first.
const staying = () => !!(room || race || fight);
let pushed = false; // the page's own entry is on the history's top
let here = location.href; // the address there, as the game last left it
let leaving = false; // on purpose
function holdPage(): void {
  if (pushed) here = location.href;
  else if (staying()) {
    here = location.href;
    history.pushState(null, '', here);
    pushed = true;
  }
}
addEventListener('popstate', () => {
  pushed = false;
  history.replaceState(null, '', here);
  holdPage();
});
addEventListener('beforeunload', (e) => {
  if (!staying() || leaving) return;
  e.preventDefault();
  e.returnValue = '';
});

// Sideways while in full screen, where the browser allows it (Android).
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
        h('small', {}, by && d.id !== current ? `escolhido por ${by}` : d.tagline),
      );
    }),
  );
}

const QUALITY_NAME: Record<Quality, string> = { high: 'Alta', medium: 'Média', low: 'Baixa' };

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
    ...(['high', 'medium', 'low'] as Quality[]).map((q) => h('option', { value: q, selected: q === quality }, QUALITY_NAME[q])),
  );
  return h('label', { class: 'inline' }, 'Gráficos ', sel);
}

// The invite, to send the friends: shared on a phone, copied elsewhere.
function inviteButton(code: string): HTMLElement {
  const share = PHONE && 'share' in navigator;
  const copy = h(
    'button',
    {
      onclick: async () => {
        if (share) {
          try {
            await navigator.share({ title: 'Party Kart', text: 'Vem conduzir comigo por Braga no Party Kart', url: inviteLink(code) });
            return;
          } catch (e) {
            if ((e as Error).name === 'AbortError') return;
          }
        }
        try {
          await navigator.clipboard.writeText(inviteLink(code));
          copy.textContent = 'Copiado!';
        } catch {
          prompt('Envia esta ligação aos teus amigos:', inviteLink(code));
        }
      },
    },
    share ? 'Partilhar o convite' : 'Copiar o convite',
  );
  return copy;
}

function members(r: Room, bots: boolean): HTMLElement {
  return h(
    'div',
    { class: 'members' },
    ...r.lobby.members
      .filter((m) => bots || !m.bot)
      .map((m) => h('span', { class: `chip${m.bot ? ' bot' : ''}`, style: `--c:${driverById(m.driver).color}` }, m.bot ? '🤖 ' : '', m.id === r.you ? `${m.name} (tu)` : m.name, h('small', {}, m.bot ? 'bot' : driverById(m.driver).name))),
  );
}

// The menu, over the world while it goes on: your name and driver, the friends, the race, back on
// the street, the graphics and the help.
function menuScreen(): HTMLElement {
  const r = room;
  if (page === 'race' && r) return raceScreen(r);
  if (page === 'fight' && r) return fightScreen(r);
  const taken = new Map(r ? r.lobby.members.filter((m) => m.id !== r.you && !m.bot).map((m) => [m.driver, m.name] as const) : []);
  const name = h('input', {
    maxLength: 16,
    placeholder: 'O teu nome',
    value: stored('pk-name', ''),
    autocomplete: 'off',
    oninput: () => remember('pk-name', name.value.trim()),
    onchange: () => room?.rename(myName()),
  });
  const code = h('input', { class: 'code-in', maxLength: 5, placeholder: 'Código da sala', autocomplete: 'off', spellcheck: false });
  code.addEventListener('keydown', (e) => e.key === 'Enter' && void join(code.value));
  const friends = r
    ? h(
        'div',
        { class: 'friends' },
        h('div', { class: 'room' }, h('div', {}, h('span', { class: 'label' }, 'Sala'), h('b', { class: 'code' }, r.lobby.code)), inviteButton(r.lobby.code)),
        members(r, false),
        h('div', { class: 'row' }, h('p', { class: 'wait' }, 'Quem abrir o convite aparece ao lado do anfitrião.'), h('button', { class: 'ghost', onclick: leave }, r.isHost ? 'Fechar a sala' : 'Sair da sala')),
      )
    : h(
        'div',
        { class: 'friends' },
        h('button', { onclick: () => void invite(), disabled: !!busy }, 'Convidar amigos'),
        h('div', { class: 'or' }, 'ou entra na sala de alguém'),
        h('div', { class: 'row' }, code, h('button', { onclick: () => void join(code.value), disabled: !!busy }, 'Entrar')),
      );
  return h(
    'div',
    { class: 'panel menu' },
    h('button', { class: 'ghost small close', title: 'Voltar a conduzir (Esc)', onclick: closeMenu }, '✕'),
    h('h1', {}, 'Party Kart', h('span', {}, '.')),
    h('p', { class: 'tag' }, `Braga como ela é, para conduzires por onde quiseres, sozinho ou com os amigos. E ${TRACKS.length > 1 ? 'pistas nas ruas dela' : `a ${HOME.name}`}, para correres contra eles e lhes atirares com coisas.`),
    h('label', {}, 'O teu nome', name),
    h('label', {}, 'O teu piloto'),
    driverGrid(myDriver(), taken, pickDriver),
    h('button', { class: 'primary', onclick: closeMenu }, 'Conduzir'),
    h('label', {}, 'Amigos'),
    friends,
    h(
      'div',
      { class: 'row wrap' },
      h('button', { onclick: () => void openRace(), disabled: !!busy || !!fight }, '🏁 Corrida'),
      h('button', { onclick: () => void openFight(), disabled: !!busy || !!fight }, '🎯 Tiroteio'),
      !fight && h('button', { onclick: reposition }, '↺ Reposicionar'),
      roam && !roam.walk && h('button', { onclick: () => (fly(roam!, !roam!.fly), closeMenu()) }, roam.fly ? '🏎️ Voltar ao kart' : '🎥 Voar pela cidade'),
      roam && !roam.fly && !fight && h('button', { onclick: () => (walk(roam!, !roam!.walk), closeMenu()) }, roam.walk ? '🏎️ Voltar ao kart' : '🚶 A pé'),
    ),
    h('p', { class: 'err' }, busy || notice),
    h('div', { class: 'row foot' }, qualityPicker()),
    howTo(),
  );
}

function howTo(): HTMLElement {
  return h(
    'details',
    { class: 'how' },
    h('summary', {}, 'Como se joga'),
    h(
      'ul',
      {},
      h('li', { class: 'keys-only' }, h('b', {}, 'Conduzir:'), ' setas ou WASD, por onde quiseres dentro da zona (o mapa mostra o limite a vermelho). ', h('b', {}, 'Derrapar:'), ' mantém o Espaço numa curva; quando as faíscas ficarem azuis, e depois laranja, larga para um mini-turbo.'),
      h('li', { class: 'touch-only' }, h('b', {}, 'Virar:'), ' com o polegar esquerdo, a arrastar para a esquerda e para a direita em qualquer sítio dessa metade do ecrã. Pela cidade, o kart anda enquanto lá tiveres o polegar e para quando o levantas; na corrida anda sozinho. ', h('b', {}, 'Travar'), ' abranda, e faz marcha-atrás depois de parar. Melhor com o telemóvel deitado.'),
      h('li', { class: 'touch-only' }, h('b', {}, 'Derrapar:'), ' mantém-no numa curva; quando as faíscas ficarem azuis, e depois laranja, larga para um mini-turbo.'),
      h('li', { class: 'keys-only' }, h('b', {}, 'Voar:'), ' V, ou 🎥 Voar pela cidade no menu, deixa o kart à espera e leva a câmara por cima da cidade e dos montes, até ao horizonte. WASD ou ↑↓ anda, ←→ vira, ', h('b', {}, 'E'), ' sobe, ', h('b', {}, 'Q'), ' desce, ', h('b', {}, 'Shift'), ' vai mais depressa, e arrastar o rato olha à volta. V outra vez põe o kart na rua por baixo da câmara.'),
      h('li', { class: 'keys-only' }, h('b', {}, 'A pé:'), ' F, ou 🚶 A pé no menu, tira-te do kart, que fica à espera onde parou, e andas por Braga com os teus olhos: ', h('b', {}, 'WASD'), ' anda, o rato olha à volta, ', h('b', {}, 'Shift'), ' corre e ', h('b', {}, 'Espaço'), ' salta. Sobes passeios e escadas, mas não muros. F outra vez volta ao kart, onde ele ficou.'),
      h('li', { class: 'touch-only' }, h('b', {}, 'A pé:'), ' 🚶 A pé, lá em cima, tira-te do kart, que fica à espera onde parou, e andas por Braga com os teus olhos: o polegar esquerdo anda (e corre, se o levares até ao fim), arrastar na metade direita olha à volta, e Saltar salta. Voltar ao kart põe-te nele, onde ficou.'),
      h('li', { class: 'touch-only' }, h('b', {}, 'Voar:'), ' Voar lá em cima, ou 🎥 Voar pela cidade no menu, deixa o kart à espera e leva a câmara por cima da cidade e dos montes, até ao horizonte. O polegar esquerdo anda para onde o arrastares, arrastar na metade direita olha à volta, e ▲ Subir e ▼ Descer. Voltar ao kart põe-no na rua por baixo da câmara.'),
      h('li', {}, h('b', {}, 'Amigos:'), ' Convidar amigos dá-te uma ligação para lhes mandares; quem a abrir aparece ao teu lado, no teu mundo.'),
      h('li', {}, h('b', {}, 'Corrida:'), ` ${TRACKS.length > 1 ? 'numa das pistas' : `a ${HOME.name}`}, com toda a gente da sala e bots nos lugares vazios. O anfitrião escolhe ${TRACKS.length > 1 ? 'a pista, ' : ''}as voltas e os itens e dá a partida; no fim voltas para onde estavas.`),
      h('li', {}, h('b', {}, 'Tiroteio:'), ' a pé no Fujacal, com toda a gente da sala, cada um por si. Escolhes a arma sempre que voltas: ', KIT_IDS.map((k) => KITS[k].name.toLowerCase()).join(', '), '. Ganha quem abater mais até acabar o tempo; no fim voltas ao kart, onde ficou.'),
      h('li', { class: 'keys-only' }, h('b', {}, 'No tiroteio:'), ' WASD anda, o rato aponta, o clique dispara, o botão direito mira (com a espingarda de precisão), ', h('b', {}, 'R'), ' recarrega, ', h('b', {}, 'Tab'), ' mostra a pontuação, e ', h('b', {}, '1'), ' a ', h('b', {}, '4'), ' escolhem a arma.'),
      h('li', { class: 'touch-only' }, h('b', {}, 'No tiroteio:'), ' o polegar esquerdo anda, arrastar na metade direita aponta, Fogo dispara (e aponta, se o arrastares), Recarregar, e Mira com a espingarda de precisão. Toca na arma para a escolher.'),
      h('li', { class: 'keys-only' }, h('b', {}, 'Itens, na corrida:'), ' passa pelas caixas ?; ', h('b', {}, 'E'), ' ou ', h('b', {}, 'Shift'), ' usa o que te saiu (com ↓ atiras para trás). Quanto mais atrás fores, melhor o que te sai.'),
      h('li', { class: 'touch-only' }, h('b', {}, 'Itens, na corrida:'), ' passa pelas caixas ? e toca no botão do item (arrasta-o para baixo para atirar para trás). Quanto mais atrás fores, melhor o que te sai.'),
      h('li', {}, h('b', {}, 'Cone de aspiração:'), ' cola-te atrás de um carro e ele puxa-te, com mais força quanto mais perto; sai para ultrapassar e a velocidade a mais vai-se em poucos segundos.'),
      h('li', { class: 'keys-only' }, h('b', {}, 'Enter'), ' volta à rua (na corrida, ao último ponto de controlo). ', h('b', {}, 'H'), ' buzina · ', h('b', {}, 'C'), ' câmara · ', h('b', {}, 'M'), ' som · ', h('b', {}, 'Esc'), ' menu.'),
      h('li', { class: 'touch-only' }, h('b', {}, '↺'), ' volta à rua (na corrida, ao último ponto de controlo). O menu, a buzina, a câmara e o som estão lá em cima.'),
      h(
        'li',
        {},
        'Itens: ',
        Object.values(ITEMS)
          .filter((i, k, a) => a.findIndex((x) => x.icon === i.icon) === k)
          .map((i) => `${i.icon} ${i.name}`)
          .join(' · '),
      ),
      h('li', {}, h('b', {}, 'Braga'), ' como ela é: as ruas, os prédios e os montes, e o Tourigalo. ' + `A ${HOME.name} são ${km(HOME)} dela, e em casa de cada amigo há uma surpresa.` + ' Mapa: © OpenStreetMap contributors (ODbL). Relevo e ortofotos: informação geográfica cedida pela Direção-Geral do Território. Horizonte: Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers. Fotografias: ' + photoCredits() + '.'),
    ),
  );
}

// The map's photos' credits (render/photos.ts and cover.ts, braga-map's tasks 007 and 016), but the
// DGT's, which the line gives with the relief: each source with what it photographs, Mapillary's in its
// own words, its licence and the authors of the photos used. The game publishes every photo texture,
// drawn or not.
function photoCredits(): string {
  return bragaMap()
    .photoCredits.filter((c) => c.source !== 'DGT')
    .map((c) => `${c.kinds.map((k) => (k === 'facade' ? 'das fachadas' : 'do chão')).join(' e ')}, ${c.source === 'Mapillary' ? '© Mapillary contributors' : c.source} (${c.authors.join(', ')}), ${c.licence}`)
    .join('; ');
}

// The race's settings, from the menu's "Corrida": the host chooses and starts it, the others see
// what's chosen and wait.
function raceScreen(r: Room): HTMLElement {
  const L = r.lobby;
  const host = r.isHost ? (r as HostRoom) : null;
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
  const course = courseById(L.track);
  const settings = h(
    'div',
    { class: 'settings' },
    TRACKS.length > 1 &&
      h(
        'label',
        { class: 'inline' },
        'Pista ',
        select(
          course.id,
          TRACKS.map(({ course: c }) => [c.id, `${c.name} · ${km(c)}`] as [string, string]),
          (track) => host?.configure({ track }),
        ),
      ),
    h('label', { class: 'inline' }, 'Modo ', select(L.mode, [['race', 'Corrida'], ['time', 'Contrarrelógio']], (mode) => host?.configure({ mode }))),
    L.mode === 'race'
      ? h('label', { class: 'inline' }, 'Voltas ', select(L.laps, [[1, '1'], [2, '2'], [3, '3']], (laps) => host?.configure({ laps })))
      : h('label', { class: 'inline' }, 'Duração ', select(L.minutes, [5, 8, 10, 15].map((n) => [n, `${n} min`] as [number, string]), (minutes) => host?.configure({ minutes }))),
    L.mode === 'race' && h('label', { class: 'inline' }, check(L.items, (items) => host?.configure({ items })), ' Itens'),
    L.mode === 'race' && h('label', { class: 'inline' }, check(L.catchUp, (catchUp) => host?.configure({ catchUp })), ' Ajuda a quem vai atrás'),
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
    h('h2', {}, '🏁 Corrida'),
    h('p', { class: 'tag' }, `${course.name}: ${km(course)} de Braga, ${TRACKS.find((t) => t.course === course)!.blurb}. Corre toda a gente da sala, e os lugares vazios são bots.`),
    h('div', { class: 'room' }, h('div', {}, h('span', { class: 'label' }, 'Sala'), h('b', { class: 'code' }, L.code)), inviteButton(L.code)),
    members(r, true),
    settings,
    host ? h('button', { class: 'primary', onclick: () => (fullScreen(), host.start()) }, L.mode === 'race' ? 'Começar a corrida' : 'Começar a ronda') : h('p', { class: 'wait' }, 'À espera que o anfitrião comece…'),
    h(
      'div',
      { class: 'row foot' },
      h(
        'button',
        {
          class: 'ghost',
          onclick: () => {
            page = 'main';
            render();
          },
        },
        '← Voltar',
      ),
    ),
  );
}

// The deathmatch's settings, from the menu's "Tiroteio" (braga-map's task 074): the host chooses how
// long a round lasts and starts it, the others see what's chosen and wait.
function fightScreen(r: Room): HTMLElement {
  const L = r.lobby;
  const host = r.isHost ? (r as HostRoom) : null;
  const humans = L.members.filter((m) => !m.bot).length;
  const minutes = h('select', { disabled: !host, onchange: () => host?.configure({ round: Number(minutes.value) }) }, ...[3, 5, 10].map((n) => h('option', { value: String(n), selected: n === L.round }, `${n} min`)));
  const bots = h('select', { disabled: !host, onchange: () => host?.configure({ bots: Number(bots.value) }) }, ...Array.from({ length: MAX_RACERS - humans + 1 }, (_, n) => h('option', { value: String(n), selected: n === L.bots }, String(n))));
  const skill = h('select', { disabled: !host || !L.bots, onchange: () => host?.configure({ skill: Number(skill.value) }) }, ...SKILLS.map((s, n) => h('option', { value: String(n), selected: n === L.skill }, s)));
  const where = h('select', { disabled: !host, onchange: () => host?.configure({ arena: where.value }) }, ...world.drive.d.world.arenas.map((a) => h('option', { value: a.id, selected: a.id === L.arena }, a.name)));
  return h(
    'div',
    { class: 'panel lobby' },
    h('h2', {}, '🎯 Tiroteio'),
    h('p', { class: 'tag' }, 'A pé, numa de três arenas pequenas no Fujacal e no Conselheiro Lobato, com portas abertas nos rés-do-chão e um prédio que se sobe até ao telhado: toda a gente da sala, cada um por si, com a arma que escolher sempre que volta, e bots nos lugares vazios. Ganha quem abater mais até acabar o tempo, e no fim cada um volta ao seu kart.'),
    h('div', { class: 'room' }, h('div', {}, h('span', { class: 'label' }, 'Sala'), h('b', { class: 'code' }, L.code)), inviteButton(L.code)),
    members(r, true),
    h('div', { class: 'settings' }, h('label', { class: 'inline' }, 'Arena ', where), h('label', { class: 'inline' }, 'Duração ', minutes), h('label', { class: 'inline' }, 'Bots ', bots), h('label', { class: 'inline' }, 'Nível ', skill)),
    host
      ? h(
          'button',
          {
            class: 'primary',
            onclick: () => {
              fullScreen();
              host.configure({ mode: 'fight' });
              host.start();
            },
          },
          'Começar o tiroteio',
        )
      : h('p', { class: 'wait' }, 'À espera que o anfitrião comece…'),
    h(
      'div',
      { class: 'row foot' },
      h(
        'button',
        {
          class: 'ghost',
          onclick: () => {
            page = 'main';
            render();
          },
        },
        '← Voltar',
      ),
    ),
  );
}

function resultsScreen(r: Room, list: Entry[]): HTMLElement {
  if (r.lobby.mode === 'fight') return fightResults(r, list);
  const isRace = r.lobby.mode === 'race';
  const back = () => {
    results = null;
    render();
  };
  return h(
    'div',
    { class: 'panel results' },
    h('h2', {}, isRace ? 'Resultados' : 'Melhores voltas'),
    h(
      'ol',
      { class: 'podium' },
      ...list.map((e, k) =>
        h(
          'li',
          { class: e.id === r.you ? 'me' : '' },
          h('span', { class: 'pos' }, String(k + 1)),
          h('span', { class: 'swatch', style: `--c:${driverById(e.driver).color};--t:${driverById(e.driver).trim}` }),
          h('span', { class: 'who' }, e.bot ? `🤖 ${e.name}` : e.name, h('small', {}, isRace ? `melhor volta ${fmt(e.best)}` : driverById(e.driver).name)),
          h('span', { class: 'time' }, isRace ? (e.fin !== null ? fmt(e.fin) : 'não acabou') : fmt(e.best)),
        ),
      ),
    ),
    h('div', { class: 'row' }, r.isHost && h('button', { onclick: () => (fullScreen(), (r as HostRoom).start()) }, 'Correr outra vez'), h('button', { class: 'primary', onclick: back }, 'Voltar a conduzir')),
  );
}

// A round's results: the most kills first, then the fewest deaths.
function fightResults(r: Room, list: Entry[]): HTMLElement {
  const back = () => {
    results = null;
    render();
  };
  return h(
    'div',
    { class: 'panel results' },
    h('h2', {}, 'O tiroteio acabou'),
    h(
      'ol',
      { class: 'podium' },
      ...list.map((e, k) =>
        h(
          'li',
          { class: e.id === r.you ? 'me' : '' },
          h('span', { class: 'pos' }, String(k + 1)),
          h('span', { class: 'swatch', style: `--c:${driverById(e.driver).color};--t:${driverById(e.driver).trim}` }),
          h('span', { class: 'who' }, e.bot ? `🤖 ${e.name}` : e.name, h('small', {}, `${e.deaths} ${e.deaths === 1 ? 'morte' : 'mortes'}`)),
          h('span', { class: 'time' }, `${e.kills} ${e.kills === 1 ? 'abate' : 'abates'}`),
        ),
      ),
    ),
    h('div', { class: 'row' }, r.isHost && h('button', { onclick: () => (fullScreen(), (r as HostRoom).start()) }, 'Outra ronda'), h('button', { class: 'primary', onclick: back }, 'Voltar a conduzir')),
  );
}

// The bar at the top while you drive: the menu, the room, and on a touch screen the keys Enter,
// Backspace, H, C and M as buttons.
function bar(): HTMLElement {
  const touchBtn = (label: string, title: string, onclick: () => void) => h('button', { class: 'small ghost touch-only', title, onclick }, label);
  const sound = touchBtn(isMuted() ? '🔇' : '🔊', 'Som', () => (sound.textContent = toggleMute() ? '🔇' : '🔊'));
  if (race) {
    return h(
      'div',
      { class: 'bar' },
      h('span', { class: 'room-code' }, 'Sala ', h('b', {}, room?.lobby.code ?? '')),
      touchBtn('↺', 'Voltar ao último ponto de controlo', () => pad.press('respawn')),
      race.rules.mode === 'time' && touchBtn('Recomeçar volta', 'Recomeçar a volta', () => pad.press('restart')),
      touchBtn('📢', 'Buzina', () => pad.press('horn')),
      touchBtn('🎥', 'Câmara', () => pad.press('camera')),
      sound,
      wholeBtn(),
      room?.isHost ? h('button', { class: 'small ghost', onclick: () => (room as HostRoom).endNow() }, 'Acabar a corrida') : null,
      h('button', { class: 'small ghost', onclick: leave }, 'Sair'),
    );
  }
  const humans = room ? room.lobby.members.filter((m) => !m.bot).length : 0;
  // In a round: the menu, the scores and the sound; the host can end it.
  if (fight) {
    return h(
      'div',
      { class: 'bar' },
      h('button', { class: 'small ghost', title: 'Menu (Esc)', onclick: openMenu }, '☰ Menu'),
      h('span', { class: 'room-code' }, 'Sala ', h('b', {}, room?.lobby.code ?? '')),
      touchBtn('Pontuação', 'Pontuação', () => fight && (fight.scores = !fight.scores)),
      sound,
      wholeBtn(),
      room?.isHost ? h('button', { class: 'small ghost', onclick: () => (room as HostRoom).endNow() }, 'Acabar o tiroteio') : null,
      h('button', { class: 'small ghost', onclick: leave }, 'Sair'),
    );
  }
  const flying = !!roam?.fly;
  const walking = !!roam?.walk;
  return h(
    'div',
    { class: 'bar' },
    h('button', { class: 'small ghost', title: 'Menu (Esc)', onclick: openMenu }, '☰ Menu'),
    room && h('span', { class: 'room-code' }, 'Sala ', h('b', {}, room.lobby.code), ` · ${humans} ${humans === 1 ? 'piloto' : 'pilotos'}`),
    !flying && !walking && touchBtn('↺', 'Voltar à rua', () => pad.press('respawn')),
    !walking && touchBtn(flying ? '🏎️ Voltar ao kart' : 'Voar', flying ? 'Voltar ao kart' : 'Voar pela cidade', () => pad.press('fly')),
    !flying && touchBtn(walking ? '🏎️ Voltar ao kart' : '🚶 A pé', walking ? 'Voltar ao kart' : 'Sair do kart e andar a pé', () => pad.press('walk')),
    touchBtn('📢', 'Buzina', () => pad.press('horn')),
    !flying && !walking && touchBtn('🎥', 'Câmara', () => pad.press('camera')),
    sound,
    wholeBtn(),
  );
}

function render(): void {
  const panel = race ? null : results && room ? 'results' : menu ? 'menu' : null;
  const driving = (!!race || !!roam) && !panel;
  const flying = !race && !!roam?.fly;
  const walking = !race && !!roam?.walk;
  keys.enabled = driving;
  mouse.playing = driving;
  mouse.enabled = driving && flying;
  holdPage();
  // On foot, the mouse looks round with the pointer locked, and lets it go under a menu; in a round,
  // also while the kits are up to choose from, so they can be clicked.
  mouse.aim = driving && walking && !(fight && picking(fight) && !fight.chose);
  if (!mouse.aim) mouse.unlock();
  pad.show(driving ? (race ? race.rules.mode : flying ? 'fly' : fight ? 'fight' : walking ? 'walk' : 'roam') : null);
  document.body.classList.toggle('flying', flying);
  document.body.classList.toggle('walking', walking);
  document.body.classList.toggle('fighting', !!fight);
  document.body.classList.toggle('racing', !!race);
  document.body.classList.toggle('driving', driving);
  document.body.classList.toggle('paneled', !!panel);
  if (panel === 'results') ui.replaceChildren(resultsScreen(room!, results!));
  else if (panel === 'menu') ui.replaceChildren(menuScreen());
  else ui.replaceChildren(bar());
}

// What the room says changed while you're typing in the menu waits until you've finished.
function renderSoon(): void {
  const f = document.activeElement;
  if (f instanceof HTMLInputElement && ui.contains(f) && f.type !== 'checkbox') f.addEventListener('blur', () => render(), { once: true });
  else render();
}

function openMenu(): void {
  menu = true;
  render();
}

function closeMenu(): void {
  menu = false;
  page = 'main';
  (document.activeElement as HTMLElement | null)?.blur();
  unlockAudio();
  fullScreen();
  render();
  mouse.lock();
}

function pickDriver(id: string): void {
  picked = id;
  remember('pk-driver', id);
  room?.pick(id);
  render();
}

function reposition(): void {
  if (roam?.walk) roam.walk.respawn();
  else roam?.me.respawn();
  closeMenu();
}

// ---- The room ----

function enter(r: Room): void {
  room = r;
  notice = '';
  wire(r);
}

// "Convidar amigos": a room of your own, with you as its host, for the friends' invite link.
async function invite(): Promise<void> {
  if (room || busy) return;
  unlockAudio();
  busy = 'A abrir uma sala…';
  render();
  try {
    enter(await HostRoom.create(myName(), myDriver()));
  } catch (e) {
    notice = `Não foi possível abrir uma sala (${(e as { type?: string }).type ?? 'erro'}). Tenta outra vez daqui a pouco.`;
  }
  busy = '';
  render();
}

// "Corrida": the race's settings, in a room (one of your own if you aren't in one yet).
async function openRace(): Promise<void> {
  if (!room) await invite();
  if (!room) return;
  if (room.isHost && room.lobby.mode === 'fight') (room as HostRoom).configure({ mode: 'race' });
  page = 'race';
  render();
}

// "Tiroteio": the deathmatch's, the same way.
async function openFight(): Promise<void> {
  if (!room) await invite();
  if (!room) return;
  page = 'fight';
  render();
}

async function join(raw: string): Promise<void> {
  const c = raw.trim().toLowerCase();
  if (!/^[a-z0-9]{5}$/.test(c)) {
    notice = 'O código da sala tem 5 letras e números.';
    render();
    return;
  }
  if (busy || (room && !leave())) return;
  unlockAudio();
  busy = 'A entrar na sala…';
  feed(`A entrar na sala ${c}…`);
  render();
  try {
    enter(await ClientRoom.join(c, myName(), myDriver()));
    besideHost = false;
    if (roomFromUrl() !== c) history.replaceState(null, '', `${location.pathname}?room=${c}`);
  } catch (e) {
    notice = (e as Error).message;
    feed(notice, 'big');
    history.replaceState(null, '', location.pathname);
  }
  busy = '';
  render();
}

// Out of the room, and on driving alone. False if the host thought better of closing it on everyone.
function leave(): boolean {
  if (room) {
    if (room.isHost && room.lobby.members.some((m) => !m.bot && m.id !== room!.you) && !confirm('Fechar a sala para todos?')) return false;
    room.onClose = () => {};
    room.leave();
  }
  room = null;
  endFight();
  endRace();
  results = null;
  notice = '';
  page = 'main';
  history.replaceState(null, '', location.pathname);
  render();
  return true;
}

function wire(r: Room): void {
  // Who's in the room besides you, to say in the feed who came and went. A client hears the room's
  // first lobby as it joins.
  let known: Map<string, string> | null = r.isHost ? new Map() : null;
  r.onLobby = () => {
    const now = new Map(r.lobby.members.filter((m) => !m.bot && m.id !== r.you).map((m) => [m.id, m.name] as const));
    if (known) {
      for (const [id, name] of now) if (!known.has(id)) feed(`👋 ${name} entrou na sala`, 'big');
      for (const [id, name] of known) if (!now.has(id)) feed(`${name} saiu da sala`);
    } else {
      feed(`Entraste na sala de ${r.lobby.members.find((m) => m.id === HOST_ID)?.name ?? 'alguém'}`, 'big');
    }
    known = now;
    if (!race) renderSoon();
  };
  r.onStart = (goIn, endIn, grid) => (r.lobby.mode === 'fight' ? startFight(goIn, endIn, grid) : startRace(goIn, endIn, grid));
  r.onEnd = (list) => {
    // Everyone goes back to where they were: none of the race's positions are wanted any more.
    r.cars.clear();
    results = list;
    if (fight) endFight();
    else endRace();
    render();
  };
  r.onHonk = (id) => {
    const m = r.lobby.members.find((x) => x.id === id);
    const k = (race?.karts ?? roam?.karts)?.get(id);
    if (m) horn(driverById(m.driver).horn, k ? 1 : 0.6, k?.model.group.position);
  };
  r.onBoard = () => {};
  r.onEv = (ev) => (ev.k === 'shot' || ev.k === 'down' ? onFightEv(ev) : race?.arena.apply(ev));
  r.onClose = (why) => {
    room = null;
    endFight();
    endRace();
    results = null;
    page = 'main';
    notice = why;
    if (why) feed(`${why} Continuas a conduzir sozinho.`, 'big');
    history.replaceState(null, '', location.pathname);
    render();
  };
}

// ---- Driving round the city ----

// The streets, the area's edge and the home track's route, for the minimap round you.
const mapLines = { lines: world.drive.d.world.lines, edge: world.drive.d.world.open.pts, route: home.samples.filter((_, i) => i % 4 === 0).map((s) => s.p) };

// Where free roam starts: where you last were, kept in this browser, if a car can still be there;
// else on the granite plinth at the start, facing the Rua do Fujacal.
function startCar(): Car {
  const d = world.drive;
  const [x, y, z, yaw] = stored('pk-where', '').split(',').map(Number);
  if ([x, y, z, yaw].every(Number.isFinite) && d.d.inside.has(x, z) && !d.floor(x, z, y + 1).buried) return d.place(carAt(v3(x, y, z), yaw, v3(0, 1, 0)));
  const s = world.stage;
  return d.place(carAt(v3(s.x, s.y, s.z), world.stageYaw, v3(0, 1, 0)), s.y + 0.5);
}

function keepWhere(c: Car): void {
  remember('pk-where', [c.p.x.toFixed(1), c.p.y.toFixed(2), c.p.z.toFixed(1), c.yaw.toFixed(3)].join(','));
}

function startRoam(car: Car): void {
  car.v = v3();
  const me = new Roamer(world.drive, room?.you || 'me', myName(), car);
  roam = { me, kart: showKart(myDriver(), null), karts: new Map(), cars: new Map(), hud: new RoamHud(hudRoot, mapLines), acc: 0, cam: 0, steer: 0, throttle: 0, shake: 0, vice: 0, idx: null, street: '', stride: 0, kept: 0, fly: null, walk: null, eye: 0, hop: false };
  slow.frames = slow.time = 0;
}

function stopRoam(): Car | null {
  const r = roam;
  if (!r) return null;
  // Back in the kart: a race starts from where it waits.
  if (r.walk) nearPlane(false);
  hide(r.kart);
  for (const k of r.karts.values()) hide(k);
  hudRoot.replaceChildren();
  roam = null;
  return r.me.car;
}

// A friend who has just joined is put on the street nearest the host, once the host's position comes
// in: a few metres back along it if that's where the host is, so as not to land on them.
function besideTheHost(r: RoamCtx): void {
  if (besideHost || !room || room.isHost) return;
  const snaps = room.cars.get(HOST_ID);
  const s = snaps?.[snaps.length - 1]?.s;
  if (!s) return;
  besideHost = true;
  const d = world.drive;
  try {
    let c = d.spawn(s.x, s.z, s.y, s.yaw);
    if (Math.hypot(c.p.x - s.x, c.p.z - s.z) < 6) c = d.place(carAt(v3(c.p.x - Math.cos(c.yaw) * 7, c.p.y, c.p.z - Math.sin(c.yaw) * 7), c.yaw, c.up), c.p.y + 1.5);
    r.me.car = c;
    if (r.walk && !fight) r.walk = alight(world.drive, c.p, c.yaw);
  } catch {
    /* no street near the host: stay where you are */
  }
}

function honk(k: Shown): void {
  horn(k.model.driver.horn);
  room?.honk();
}

// ---- Flying (braga-map's task 054) ----

// The flying camera goes as far as the horizon (the owner's choice): the hills drawn 15 km round, short
// of where they end by enough for the haze to hide it.
const HAZED = 6000;
const FLY_BOUND: Bound = { x0: world.horizon.x0 + HAZED, x1: world.horizon.x1 - HAZED, z0: world.horizon.z0 + HAZED, z1: world.horizon.z1 - HAZED };

// Into the air from where the camera is, facing the way it faces, your kart waiting where it is; or
// back down, your kart put on the street under the camera (the owner's choice), and the chase camera
// going to it from where the flying camera was.
function fly(r: RoamCtx, on: boolean): void {
  if (on === !!r.fly || r.walk) return;
  if (on) {
    const d = camera.getWorldDirection(new THREE.Vector3());
    r.fly = new Flyer(v3(camera.position.x, camera.position.y, camera.position.z), Math.atan2(d.z, d.x), Math.asin(clamp(d.y, -1, 1)), world.above, FLY_BOUND);
    r.hud.feed(pad.on ? '🎥 A voar: o polegar esquerdo anda, a metade direita olha, ▲ sobe e ▼ desce' : '🎥 A voar: WASD anda, ←→ vira, E sobe, Q desce, Shift acelera, o rato olha; V volta ao kart', 'big');
  } else {
    const f = r.fly!;
    r.fly = null;
    try {
      r.me.car = landing(world.drive, f.p.x, f.p.y, f.p.z, f.yaw);
      r.me.slip = 0;
    } catch {
      /* no street near: the kart stays where it waited */
    }
    keepWhere(r.me.car);
    r.kept = performance.now();
    camPos.copy(camera.position);
  }
  r.hud.keys(on ? 'fly' : 'drive');
  render();
}

// Your keys, mouse and thumbs, for the flying camera.
function flight(): FlyInput {
  const k = keys.flight();
  const p = pad.flight();
  const m = mouse.look();
  return {
    fwd: clamp(k.fwd + p.fwd, -1, 1),
    side: clamp(k.side + p.side, -1, 1),
    up: clamp(k.up + p.up, -1, 1),
    turn: k.turn,
    look: { x: m.x + p.look.x, y: m.y + p.look.y },
    fast: k.fast,
  };
}

// ---- On foot (braga-map's task 073) ----

// Out of your kart beside it, on the pavement's side, walking in first person, your kart waiting where
// it stops; or back in it there. Not while flying.
function walk(r: RoamCtx, on: boolean): void {
  if (on === !!r.walk || r.fly) return;
  if (on) {
    const c = r.me.car;
    r.walk = alight(world.drive, c.p, c.yaw);
    r.eye = r.walk.p.y + EYE;
    r.hud.feed(pad.on ? '🚶 A pé: o polegar esquerdo anda (no fim, corre), a metade direita olha, Saltar salta' : '🚶 A pé: WASD anda, o rato olha, Shift corre, Espaço salta; F volta ao kart', 'big');
  } else {
    r.walk = null;
    camPos.copy(camera.position);
  }
  mouse.aim = on;
  if (on) mouse.lock();
  nearPlane(on);
  r.hud.keys(on ? 'walk' : 'drive');
  render();
}

// On foot, a wall can be a walker's width from the camera: the near plane comes in to it.
function nearPlane(foot: boolean): void {
  camera.near = foot ? 0.1 : 0.3;
  camera.updateProjectionMatrix();
}

// Your keys, mouse and thumbs, on foot; looking round `fine` times as fast, through a scope.
function steps(fine = 1): WalkInput {
  const k = keys.steps();
  const p = pad.steps();
  const m = mouse.look(fine);
  return {
    fwd: clamp(k.fwd + p.fwd, -1, 1),
    side: clamp(k.side + p.side, -1, 1),
    turn: k.turn,
    look: { x: m.x + p.look.x * fine, y: m.y + p.look.y * fine },
    run: k.run || p.run,
    jump: k.jump || p.jump,
  };
}

function stepRoam(r: RoamCtx, now: number, dt: number): void {
  const me = r.me;
  me.id = room?.you || 'me';
  syncOthers(r.karts, r.cars, (id) => id === me.id, true, dt);
  besideTheHost(r);
  const open = menu || !!results;
  // On foot, the karts and the others on foot stop you (and in a round, a bullet); in a round you fire,
  // as the trigger says, at the others as they're drawn.
  const f = fight;
  if (r.walk) {
    block = [...kartBlocks];
    kartBlock(block, me.car.p.x, me.car.p.y, me.car.p.z, me.car.yaw);
    r.walk.blockers = [...block, ...[...standing.values()].filter((a) => !a.downAt).map((a) => ({ x: a.x, z: a.z, r: 0.3, y0: a.y, y1: a.y + 1.75 }))];
  }
  const trig = f ? trigger(f) : null;

  for (const act of [...keys.actions(), ...pad.actions()]) {
    if (f) {
      fightAction(f, act, now);
      continue;
    }
    if (act === 'horn') honk(r.kart);
    if (act === 'fly') fly(r, !r.fly);
    if (act === 'walk') walk(r, !r.walk);
    if (r.fly || r.walk) {
      if (act === 'respawn') r.walk?.respawn();
      continue;
    }
    if (act === 'camera') r.cam = (r.cam + 1) % 2;
    if (act === 'respawn') me.respawn();
  }
  // On foot: where you look turns at once, every frame; the rest goes in steps. With the menu open you
  // stand (or come down). In a round, you stand till the start, and while you're down.
  const scope = f?.me.scoped ? (KITS[f.me.kit].scope?.zoom ?? 1) : 1;
  let foot = r.walk && !open ? steps(1 / scope) : STAND;
  if (f && (!f.started || !f.me.alive)) foot = { ...STAND, look: f.me.alive ? foot.look : { x: 0, y: 0 } };
  r.walk?.look(foot.look);
  r.hop ||= foot.jump;
  r.acc += Math.min(0.25, dt);
  while (r.acc >= DT) {
    r.acc -= DT;
    const k = keys.controls();
    const p = pad.controls();
    // With the menu open, flying, on foot, or no thumb on a touch screen's steering half, the kart pulls
    // up and waits.
    const ctl: Input = open || r.fly || r.walk || (pad.waiting && !k.throttle && !k.brake) ? stopInput(me.car) : { throttle: Math.max(k.throttle, p.throttle), brake: Math.max(k.brake, p.brake), steer: clampSteer(k.steer + p.steer), drift: k.drift || p.drift };
    r.steer = ctl.steer;
    r.throttle = ctl.throttle;
    me.step(r.cars.values(), ctl, DT);
    if (r.walk) {
      if (r.walk.step({ ...foot, look: { x: 0, y: 0 }, jump: r.hop }, DT)) {
        if (f) respawn(f, r.walk, now);
        else r.hud.feed('De volta à rua');
      }
      r.hop = false;
      if (f && trig) fightStep(f, r.walk, trig, now - f.goAt - r.acc * 1000);
      if (f?.squad && f.started) stepBots(f, r.walk, now - f.goAt - r.acc * 1000);
    }
  }
  // Your footsteps.
  if (r.walk?.grounded && (!f || f.me.alive)) {
    const v = r.walk.speed();
    r.stride = v > 0.6 ? r.stride + v * dt : 0;
    if (r.stride > (v > 3 ? 1.6 : 0.8)) {
      r.stride = 0;
      fightSfx.step(v > 3);
    }
  }
  if (f && r.walk) fightFrame(f, r, r.walk, now, dt);
  if (r.fly && !open) r.fly.step(flight(), dt);
  for (const n of me.notes) {
    if (n.k === 'respawn') r.hud.feed('De volta à rua');
    else feel(r, n);
  }
  me.notes = [];
  room?.sendPos(snapOf(me, r.steer, r.walk, f ? f.me.flags(now - f.goAt) : 0));
  for (const b of f?.squad?.bots ?? []) room?.sendPos(botSnap(b, b.s.flags(now - f!.goAt)));

  // Your kart, with the driver the room gives you: empty while you're out of it.
  const c = me.car;
  const driver = myDriver();
  if (r.kart.driver !== driver) {
    hide(r.kart);
    r.kart = showKart(driver, null);
  }
  r.kart.model.figure.visible = !r.walk;
  pose(r.kart.model.group, c.p.x, c.p.y, c.p.z, c.yaw, c.up);
  const fwd = c.v.x * Math.cos(c.yaw) + c.v.z * Math.sin(c.yaw);
  const flags = me.info().flags;
  const vice = now < r.vice;
  r.kart.model.update(speedOf(c) * Math.sign(fwd || 1), r.steer, dt, c.grounded, flags, vice);
  kartEffects(me.id, r.kart, c.p.x, c.p.y, c.p.z, c.yaw, speedOf(c), flags, c.grounded, dt);
  if (vice) cigarette(r.kart, c, dt);
  hearRoam(r, dt);

  // The friends' houses go off as you pass them on the route, as in a race.
  const loc = locate(home, c.p, r.idx);
  const s = home.samples[loc.i];
  r.idx = Math.abs(loc.lateral) < s.w / 2 + 8 && Math.abs(loc.h) < 4 ? loc.i : null;
  eggReact(r, world.eggs.update(now / 1000, dt, r.idx === null ? null : { idx: r.idx, speed: speedOf(c) }));

  streetName(r);
  r.hud.set({ speed: speedOf(c), boosting: c.boost > 0, slip: me.slip });
  // Flying or on foot, round you, your kart a dot where it waits.
  const others = [...r.cars.values()].map((o) => ({ x: o.x, z: o.z, color: colorOf(o.id) }));
  const away = r.walk ? { x: r.walk.p.x, z: r.walk.p.z, yaw: r.walk.yaw } : r.fly ? { x: r.fly.p.x, z: r.fly.p.z, yaw: r.fly.yaw } : null;
  // In a round, nobody but you: the minimap gives nobody away.
  if (away) r.hud.minimap(away, f ? [] : [...others, { x: c.p.x, z: c.p.z, color: r.kart.model.driver.color }]);
  else r.hud.minimap({ x: c.p.x, z: c.p.z, yaw: c.yaw }, others);

  if (now - r.kept > 3000) {
    r.kept = now;
    keepWhere(c);
  }
}

// The street's name as you drive onto it (braga-map's task 042): the nearest named street whose
// carriageway you're on, kept while you're on the one shown last, so a junction doesn't flicker
// between them.
const namesAt = streetNames(world.drive.d.world.lines);
function streetName(r: RoamCtx): void {
  const p = r.walk?.p ?? r.me.car.p;
  if (r.walk ? r.walk.speed() < 0.5 : speedOf(r.me.car) < 3) return;
  const names = namesAt(p.x, p.z);
  if (!names.length || names.includes(r.street)) return;
  r.street = names[0];
  r.hud.street(names[0]);
}

// Your engine, tyres and wind, the others' engines, and the city round you. Flying, your engine is heard
// from where your kart waits, as the others' are, and the city from the ground under the camera. On foot
// it's off, as are the others' who are, and the city's round you.
function hearRoam(r: RoamCtx, dt: number): void {
  const c = r.me.car;
  const others: Kart[] = [];
  for (const o of r.cars.values()) {
    if (afoot.has(o.id)) continue;
    const speed = Math.hypot(o.vx, o.vz);
    others.push({ id: o.id, p: o, v: { x: o.vx, y: 0, z: o.vz }, speed, throttle: speed > 2 ? 1 : 0, grounded: true });
  }
  const slip = Math.abs(-c.v.x * Math.sin(c.yaw) + c.v.z * Math.cos(c.yaw));
  const mine = { id: r.me.id, p: c.p, v: c.v, speed: speedOf(c), throttle: r.throttle, grounded: c.grounded, drifting: c.drifting, slip, cobble: world.drive.surface(c.p.x, c.p.z, c.p.y) === 'setts' };
  if (r.walk) engines(null, others, dt);
  else if (r.fly) engines(null, [...others, mine], dt);
  else engines(mine, others, dt);
  citySound(r.walk?.p ?? r.fly?.p ?? c.p, dt);
}

// ---- The deathmatch (braga-map's task 074) ----

// The arenas as a round is played in (braga-map's task 079), each made the first time a round starts
// in it (about 0.1 s): its ground with the edge, the spawns, where the bots walk, where the railings and
// barriers stand, and its edge drawn; the one the round's in; and what's drawn for any round, the
// shots' marks and tracers, and your gun.
const arenas = new Map<string, { field: Field; edge: THREE.Group }>();
let arena: Field | null = null;
let arms: { shots: ShotsView; view: Viewmodel } | null = null;

function arenaFor(id: string): { field: Field; edge: THREE.Group } {
  const w0 = world.drive.d.world;
  const area = w0.arenas.find((a) => a.id === id) ?? w0.arenas[0];
  let a = arenas.get(area.id);
  if (!a) {
    const f = field(world.drive, area);
    a = { field: f, edge: buildEdge(f) };
    a.edge.visible = false;
    scene.add(a.edge);
    arenas.set(area.id, a);
  }
  return a;
}

// The others on foot as they're drawn this frame (syncOthers): where they stand, which way they face,
// whether they're in the round and since when they're down, and their footsteps.
interface Afoot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  spd: number;
  fighting: boolean;
  downAt: number;
  stride: number;
  model: WalkerModel;
}
const standing = new Map<string, Afoot>();
// The karts waiting, the others' (syncOthers) and with yours this frame, as what stops someone on foot
// and a bullet.
const kartBlocks: Blocker[] = [];
let block: Blocker[] = [];

// A kart as someone on foot and a bullet meet it: its two circles, as it bumps, up to its roll bar.
function kartBlock(out: Blocker[], x: number, y: number, z: number, yaw: number): void {
  for (const s of [1, -1]) out.push({ x: x + Math.cos(yaw) * 0.95 * s, z: z + Math.sin(yaw) * 0.95 * s, r: 0.8, y0: y - 0.3, y1: y + 1.1 });
}

// The others in the round who are up, as a shot finds them.
const foes = (): Body[] => [...standing.entries()].filter(([, a]) => a.fighting && !a.downAt).map(([id, a]) => ({ id, x: a.x, y: a.y, z: a.z }));

// Whether the kits are up to choose from: before the start, and while you're down.
const picking = (f: FightCtx) => !f.started || !f.me.alive;

const nameOf = (id: string) => (id === room?.you ? 'Tu' : (room?.lobby.members.find((m) => m.id === id)?.name ?? 'Alguém'));

// The host has started a round: everyone on foot at a spawn in Fujacal (the grid says whose), your kart
// waiting where it was, the kits to choose from until the start.
function startFight(goIn: number, endIn: number, grid: Record<string, number>): void {
  const rm = room!;
  if (race) endRace();
  if (!roam) startRoam(before ?? startCar());
  const r = roam!;
  if (fight) endFight();
  menu = false;
  page = 'main';
  results = null;
  // Flying, the camera comes down: your kart waits where it was.
  r.fly = null;
  const bots = rm.isHost ? rm.lobby.members.filter((m) => m.bot) : [];
  const here = arenaFor(rm.lobby.arena);
  const f = (arena = here.field);
  for (const a of arenas.values()) a.edge.visible = a === here;
  if (!arms) {
    arms = { shots: new ShotsView(), view: new Viewmodel(scene.environment) };
    scene.add(arms.shots.group);
    look.overlay = arms.view.scene;
  }
  arms.shots.clear();
  const now = performance.now();
  // Joining a round under way: where none of the others can see.
  const s = goIn > 0 ? f.spawns[(grid[rm.you] ?? 0) % f.spawns.length] : pickSpawn(f, foes(), kartBlocks);
  const w = new Walker(f.ground, v3(s.x, s.y, s.z), s.yaw);
  w.bound = f.inside;
  r.walk = w;
  r.eye = w.p.y + EYE;
  r.hop = false;
  const me = new Soldier(rm.you, lastKit);
  mouse.pulls = 0;
  // The host's bots, each at its spawn on the grid as a player is, as good as the host chose.
  let squad: Squad | null = null;
  if (bots.length) {
    squad = new Squad(f, f.paths, rm.lobby.skill / (SKILLS.length - 1));
    for (const m of bots) squad.add(m.id, Math.max(0, -goIn), goIn > 0 ? f.spawns[(grid[m.id] ?? 0) % f.spawns.length] : null, foes());
  }
  fight = { goAt: now + goIn, endAt: now + endIn, me, hud: new FightHud(hudRoot), kit: lastKit, chose: false, by: '', fell: 0, hurt: 0, from: [], center: null, lastBeep: 99, started: goIn <= 0, scores: false, downs: 0, squad };
  fight.hud.onPick = pickKit;
  if (fight.started) me.arm(lastKit, now - fight.goAt);
  r.hud.keys('fight');
  const where = world.drive.d.world.arenas.find((a) => a.id === rm.lobby.arena) ?? world.drive.d.world.arenas[0];
  r.hud.setEdge(where.pts);
  r.hud.feed(pad.on ? `🎯 Tiroteio em ${where.name}: escolhe a arma, e cada um por si` : `🎯 Tiroteio em ${where.name}: escolhe a arma (1 a 4), e cada um por si`, 'big');
  nearPlane(true);
  (document.activeElement as HTMLElement | null)?.blur();
  render();
}

// The round over (or left): the edge down, and back in your kart where it waited.
function endFight(): void {
  const f = fight;
  if (!f) return;
  fight = null;
  f.hud.remove();
  for (const a of arenas.values()) a.edge.visible = false;
  if (arms) arms.view.show(null);
  pad.unscope();
  document.body.classList.remove('picking');
  for (const a of standing.values()) {
    a.model.arm(null);
    a.model.fall(0, 0);
    a.fighting = false;
    a.downAt = 0;
  }
  const r = roam;
  if (!r) return;
  r.hud.setEdge(mapLines.edge);
  if (r.walk) walk(r, false);
  else render();
}

// The kit to come back with, from the picker or the keys 1 to 4. Chosen while the kits are up, the
// pointer locks again (the click that chose it allows it).
function pickKit(k: KitId): void {
  const f = fight;
  if (!f) return;
  f.kit = lastKit = k;
  if (!picking(f)) return;
  f.chose = true;
  render();
  mouse.lock();
}

function fightAction(f: FightCtx, act: string, now: number): void {
  if (act === 'reload' && f.me.reload(now - f.goAt)) {
    fightSfx.reload(KITS[f.me.kit].reload);
    pad.unscope();
  }
  const k = ['kit1', 'kit2', 'kit3', 'kit4'].indexOf(act);
  if (k >= 0) pickKit(KIT_IDS[k]);
}

// The trigger this frame, the mouse's and the thumbs': held, pulled since last read (a semi-automatic
// fires once a pull, and one pull waits for the gun to be ready), and the scope.
function trigger(f: FightCtx): { held: boolean; pulls: number; scope: boolean } {
  const p = pad.fight(!!KITS[f.me.kit].scope);
  const pulls = Math.min(1, mouse.pulls + p.pulls);
  mouse.pulls = 0;
  return { held: mouse.trigger || p.trigger, pulls, scope: mouse.scope || p.scope };
}

// A step of the round at its ms t: your kit's state, the scope, and a shot if the trigger says so.
function fightStep(f: FightCtx, w: Walker, trig: { held: boolean; pulls: number; scope: boolean }, t: number): void {
  const me = f.me;
  me.step(DT, t);
  if (!f.started || !me.alive) return;
  const k = KITS[me.kit];
  me.scoped = trig.scope && !!k.scope && !me.reloading;
  if (!trig.pulls && !(k.auto && trig.held)) return;
  if (me.ammo === 0) {
    if (trig.pulls) fightSfx.dry();
    trig.pulls = 0;
    if (me.reload(t)) fightSfx.reload(k.reload);
    return;
  }
  const ev = fire(me, v3(w.p.x, w.p.y + EYE, w.p.z), w.dir(), w.speed(), !w.grounded, t, foes(), seeOn(arena!, block), (Math.random() * 4294967296) >>> 0);
  if (!ev) return;
  trig.pulls = 0;
  shotFx(ev, true);
  room?.sendEv(ev);
  botsShot(f, ev, t);
  for (const h of ev.hits) {
    f.hud.hit(h.head);
    fightSfx.marker(h.head);
  }
  if (me.ammo === 0 && me.reload(t)) fightSfx.reload(k.reload);
}

// Back at the spawn none of the others can see, with the kit chosen, whole and safe for a moment.
function respawn(f: FightCtx, w: Walker, now: number): void {
  const s = pickSpawn(arena!, foes(), block);
  w.p = v3(s.x, s.y, s.z);
  w.v = v3();
  w.yaw = s.yaw;
  w.pitch = 0;
  w.grounded = true;
  if (roam) roam.eye = s.y + EYE;
  f.me.arm(f.kit, now - f.goAt);
  f.chose = false;
  pad.unscope();
  render();
}

// Once a frame in a round: the start, coming back, and what's on the screen.
function fightFrame(f: FightCtx, r: RoamCtx, w: Walker, now: number, dt: number): void {
  const me = f.me;
  const t = now - f.goAt;
  // The countdown, and the start.
  const left = Math.ceil(-t / 1000);
  if (!f.started && left <= 3 && left !== f.lastBeep) {
    f.lastBeep = left;
    beep(false);
  }
  if (!f.started && t >= 0) {
    f.started = true;
    me.arm(f.kit, t);
    beep(true);
    f.center = { text: 'JÁ!', until: now + 900 };
    render();
  }
  if (f.started && !me.alive && now - f.fell >= RESPAWN) respawn(f, w, now);
  f.hurt *= Math.exp(-dt * 2.5);
  f.from = f.from.filter((s) => now - s.at < FROM_FOR);
  document.body.classList.toggle('picking', picking(f));

  const board = room?.board ?? [];
  const mine = board.find((e) => e.id === room?.you);
  const lead = board[0];
  const standingText = !mine ? '' : lead && lead.id !== mine.id && lead.kills > mine.kills ? `Tu ${mine.kills} · 1.º ${lead.name} ${lead.kills}` : `Tu ${mine.kills} · vais à frente`;
  const end = Math.max(0, f.endAt - now);
  const wait = Math.max(0, Math.ceil((f.started ? f.fell + RESPAWN - now : -t) / 1000));
  f.hud.set({
    health: me.health,
    alive: me.alive && f.started,
    kit: me.kit,
    ammo: me.ammo,
    reloading: me.reloading,
    clock: f.started ? `${Math.floor(end / 60000)}:${String(Math.floor((end % 60000) / 1000)).padStart(2, '0')}` : `Começa em ${left}`,
    standing: standingText,
    gap: 5 + (Math.tan(spreadOf(me, w.speed(), !w.grounded)) / Math.tan((camera.fov * Math.PI) / 360)) * (innerHeight / 2),
    scoped: me.scoped,
    hurt: me.alive ? Math.max(f.hurt, (1 - me.health / 100) * 0.5) : 0.6,
    from: f.from.slice(-4).map((s) => {
      const dx = s.x - w.p.x;
      const dz = s.z - w.p.z;
      const c = Math.cos(w.yaw);
      const sn = Math.sin(w.yaw);
      return { angle: Math.atan2(dz * c - dx * sn, dx * c + dz * sn), a: (FROM_FOR - (now - s.at)) / 1000 };
    }),
    center: !f.started && left <= 3 ? String(left) : f.center && now < f.center.until ? f.center.text : '',
    picking: !picking(f) ? null : f.started ? { title: `Eliminado por ${nameOf(f.by)}`, sub: 'A arma com que voltas:', kit: f.kit, wait: `Voltas em ${wait} s` } : { title: 'Escolhe a tua arma', sub: KITS[f.kit].blurb, kit: f.kit, wait: '' },
    scores: keys.scores || f.scores ? board.map((e) => ({ name: e.bot ? `🤖 ${e.name}` : e.name, color: colorOf(e.id), kills: e.kills, deaths: e.deaths, me: e.id === room?.you })) : null,
  });
}

// How long the arc that says where a shot came from stays (ms), fading over its last second.
const FROM_FOR = 2500;

// What a shot looks and sounds like, yours or someone else's: the flash at the muzzle, the report
// from where it was fired, the tracers, and where each pellet no one stopped struck, its mark, a puff
// of what it struck and a smack. Where it hit someone, a tracer from the muzzle to them, a red puff
// and their figure jerked away from it, so it's plain from anywhere who shot whom; a tracer that hit
// you streaks past a metre short of your eye.
const DUST: Record<string, string[]> = { ground: ['#b8ad99', '#8d8577'], building: ['#ddd6ca', '#b9b1a4'], roof: ['#a8553f', '#8c8c8c'], wall: ['#cfc8bb', '#9f998d'], hedge: ['#5c7a37', '#3f5a26'], tree: ['#6b5641', '#4d3d2c'], kart: ['#ffe14d', '#ffffff'] };
function shotFx(ev: ShotEv, mine: boolean): void {
  if (!arms || !arena) return;
  const from = new THREE.Vector3();
  if (mine) {
    arms.view.fired();
    arms.view.muzzle(from);
    fightSfx.shot(ev.kit);
  } else {
    const o = standing.get(ev.owner);
    if (o) o.model.muzzle(from);
    else from.set(ev.x, ev.y - 0.4, ev.z);
    arms.shots.flash(from);
    fightSfx.shot(ev.kit, { x: ev.x, y: ev.y, z: ev.z });
  }
  const you = room?.you;
  const hits = struck(ev, (id) => (id === you ? (roam?.walk?.p ?? null) : (standing.get(id) ?? null)));
  hits.forEach((s, i) => {
    const atYou = s.v === you;
    if (i < 2) arms!.shots.tracer(from, atYou ? addScaled(s.p, s.d, -1.2) : s.p);
    if (atYou) return;
    glow.spray(s.p, 2, ['#ff6a55', '#ffd2c4'], 2.2, 1.6, 0.15);
    for (let k = 0; k < 2; k++) smoke.add(s.p.x, s.p.y, s.p.z, s.d.x * 1.2, s.d.y * 1.2 + 0.3, s.d.z * 1.2, 0.16 + k * 0.08, k ? '#a3150d' : '#e0261a', 0);
    for (let k = 0; k < 7; k++) fx.add(s.p.x, s.p.y, s.p.z, s.d.x * 3 + (Math.random() - 0.5) * 2, s.d.y * 3 + Math.random() * 1.5, s.d.z * 3 + (Math.random() - 0.5) * 2, 0.25 + Math.random() * 0.2, k % 2 ? '#e0261a' : '#9a140c', -6);
  });
  for (const h of ev.hits) {
    const s = hits.find((x) => x.v === h.v);
    if (s && h.v !== you) standing.get(h.v)?.model.hit(s.d, h.n / 40);
  }
  const traced = Math.min(2, hits.length);
  landed(ev, seeOn(arena, block)).forEach((s, i) => {
    if (i + traced < 3) arms!.shots.tracer(from, s);
    if (!s.what) return;
    arms!.shots.mark(s, { x: s.nx, y: s.ny, z: s.nz });
    const c = DUST[s.what] ?? DUST.wall;
    for (let k = 0; k < 6; k++) smoke.add(s.x, s.y, s.z, s.nx * 1.5 + (Math.random() - 0.5), s.ny * 1.5 + Math.random(), s.nz * 1.5 + (Math.random() - 0.5), 0.5 + Math.random() * 0.4, c[k % 2], -2);
    if (s.what !== 'hedge' && s.what !== 'tree') glow.spray(s, 4, ['#ffd98a', '#ffffff'], 3, 2, 0.15);
    if (i === 0) fightSfx.impact(s);
  });
}

// Something from someone else in the round: a shot (and it hit you, by the shooter's say), or someone
// put down.
function onFightEv(ev: FightEv): void {
  const f = fight;
  if (!f) return;
  if (ev.k === 'down') return downFx(ev);
  if (ev.owner === room?.you) return;
  shotFx(ev, false);
  for (const h of ev.hits) if (h.v === f.me.id) hitMe(f, ev, h);
  botsShot(f, ev, performance.now() - f.goAt);
}

// The host's bots, a step of the round at its ms t (braga-map's task 075): they look for the players as
// this browser draws them, and for you where you are, and shoot as you do; each shot goes to everyone,
// as yours does, and what it hit is decided here, as yours is in your browser.
function stepBots(f: FightCtx, w: Walker, t: number): void {
  const squad = f.squad!;
  const players: Mark[] = [...standing.entries()].filter(([id, a]) => a.fighting && !a.downAt && !squad.bots.some((b) => b.id === id)).map(([id, a]) => ({ id, x: a.x, y: a.y, z: a.z, spd: a.spd }));
  if (f.me.alive) players.push({ id: f.me.id, x: w.p.x, y: w.p.y, z: w.p.z, spd: w.speed() });
  for (const ev of squad.step(DT, t, players, block)) {
    shotFx(ev, false);
    room?.sendEv(ev);
    for (const h of ev.hits) if (h.v === f.me.id) hitMe(f, ev, h);
    botsShot(f, ev, t);
  }
}

// A shot, anyone's, as the host's bots meet it: heard, and those it hit hurt; one put down, everyone
// told, as a player's browser tells them.
function botsShot(f: FightCtx, ev: ShotEv, t: number): void {
  for (const d of f.squad?.shot(ev, t) ?? []) {
    room?.sendEv(d);
    downFx(d);
  }
}

// A bot's snapshot on foot: no kart waiting.
function botSnap(b: FootBot, fl: number): Snap {
  const p = b.w.p;
  return { id: b.id, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +b.w.yaw.toFixed(3), ux: 0, uy: 1, uz: 0, spd: +b.w.speed().toFixed(1), st: 0, P: 0, fl, g: b.w.grounded ? 1 : 0, w: 1, pi: +b.w.pitch.toFixed(3), kx: 0, ky: 0, kz: 0, kw: 0 };
}

// Shot: hurt, or down, by what the shooter's browser says it hit.
function hitMe(f: FightCtx, ev: ShotEv, h: { n: number; head: boolean }): void {
  const me = f.me;
  const now = performance.now();
  const was = me.health;
  const down = me.hurt(h.n, now - f.goAt);
  if (me.health === was && !down) return;
  f.hurt = Math.min(1, f.hurt + 0.35 + (was - me.health) / 100);
  f.from = [...f.from.filter((s) => s.id !== ev.owner), { id: ev.owner, x: ev.x, z: ev.z, at: now }];
  fightSfx.hurt();
  if (roam) roam.shake = Math.max(roam.shake, 0.3);
  if (!down) return;
  const p = roam?.walk?.p ?? v3(ev.x, ev.y, ev.z);
  const d: DownEv = { k: 'down', id: `${me.id}:d${++f.downs}`, victim: me.id, by: ev.owner, kit: ev.kit, head: h.head, x: p.x, y: p.y, z: p.z };
  f.fell = now;
  f.by = ev.owner;
  f.chose = false;
  pad.unscope();
  room?.sendEv(d);
  downFx(d);
  render();
}

// Someone down: in the feed, and for whoever did it, the word.
function downFx(ev: DownEv): void {
  const f = fight;
  if (!f) return;
  const me = room?.you;
  const how = `${KITS[ev.kit].article}${ev.head ? ', na cabeça' : ''}`;
  const line = ev.victim === me ? `${nameOf(ev.by)} eliminou-te com ${how}` : ev.by === me ? `Eliminaste ${nameOf(ev.victim)} com ${how}` : `${nameOf(ev.by)} eliminou ${nameOf(ev.victim)} com ${how}`;
  roam?.hud.feed(line, ev.by === me || ev.victim === me ? 'big' : '');
  if (ev.by === me && ev.victim !== me) {
    fightSfx.down();
    f.center = { text: `Eliminaste ${nameOf(ev.victim)}`, until: performance.now() + 1600 };
  }
}

// ---- The race ----

function startRace(goIn: number, endIn: number, grid: Record<string, number>): void {
  const r = room!;
  if (race) endRace(false);
  else before = stopRoam() ?? before;
  menu = false;
  page = 'main';
  results = null;
  const L = r.lobby;
  // On the track the host picked.
  const course = courseById(L.track);
  const track = tracks.get(course.id)!;
  const on = races.get(course.id)!;
  const N = track.samples.length;
  const rules: Rules = { mode: L.mode === 'time' ? 'time' : 'race', laps: L.laps, items: L.mode === 'race' && L.items, catchUp: L.mode === 'race' && L.catchUp };
  const arena = new Arena(track, rules);
  const meMember = L.members.find((m) => m.id === r.you)!;
  // On the world's ground with the race's walls and ramp (braga-map's task 037).
  const me = new Racer(track, r.you, meMember.name, false, grid[r.you] ?? 0, on.ground);
  if (START_AT) {
    me.car = me.put(newCar(track, START_AT % N));
    me.run.nextCp = track.checkpoints.filter((c) => c < START_AT % N).length;
  }
  const bots = r.isHost
    ? L.members.filter((m) => m.bot).map((m) => ({ racer: new Racer(track, m.id, m.name, true, grid[m.id] ?? 0, on.ground), brain: newBrain(), steer: 0, throttle: 0 }))
    : [];
  arena.locals = [me, ...bots.map((b) => b.racer)];
  for (const x of arena.locals) arena.cars.set(x.id, x.info());
  arena.send = (ev) => room?.sendEv(ev);
  const now = performance.now();
  const karts = new Map<string, Shown>();
  const kart = showKart(meMember.driver, null);
  karts.set(me.id, kart);
  for (const b of bots) karts.set(b.racer.id, showKart(L.members.find((m) => m.id === b.racer.id)!.driver, b.racer.name));
  const ctx: RaceCtx = {
    course,
    track,
    on,
    arena,
    rules,
    me,
    kart,
    bots,
    goAt: now + goIn,
    endAt: now + endIn,
    acc: 0,
    cam: 0,
    karts,
    items: new ItemsView(track, arena, (x, z, y) => on.ground.floor(x, z, y + 1).y),
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
    vice: 0,
    timeUp: false,
  };
  scene.add(ctx.items.group);
  arena.fx = (f) => onArenaFx(ctx, f);
  race = ctx;
  on.marks.visible = true;
  world.cleared.visible = !on.clears;
  slow.frames = slow.time = 0;
  resetMeter();
  if (RECORD) recordAudio(RECORD);
  (document.activeElement as HTMLElement | null)?.blur();
  render();
}

// The race over (or left): back to driving round the city where you were before it, unless another
// race starts at once.
function endRace(resume = true): void {
  if (!race) return;
  for (const k of race.karts.values()) hide(k);
  hide(race.ghost);
  scene.remove(race.items.group);
  race.on.marks.visible = false;
  race = null;
  world.cleared.visible = true;
  engines(null, [], 0);
  citySound(null, 0);
  hudRoot.replaceChildren();
  if (resume) {
    startRoam(before ?? startCar());
    before = null;
  }
}

// The engines: yours, the others' from where they are (the bots' exact, the other players' as
// they're drawn, 110 ms behind), your tyres and the wind; and the city round you.
function hearKarts(r: RaceCtx, dt: number): void {
  const c = r.me.car;
  const others: Kart[] = [];
  for (const [id, o] of r.arena.cars) {
    if (id === r.me.id) continue;
    const bot = r.bots.find((b) => b.racer.id === id);
    const speed = Math.hypot(o.vx, o.vz);
    others.push({ id, p: o, v: { x: o.vx, y: 0, z: o.vz }, speed, throttle: bot ? bot.throttle : speed > 2 ? 1 : 0, grounded: bot ? bot.racer.car.grounded : true });
  }
  const slip = Math.abs(-c.v.x * Math.sin(c.yaw) + c.v.z * Math.cos(c.yaw));
  engines({ id: r.me.id, p: c.p, v: c.v, speed: speedOf(c), throttle: r.throttle, grounded: c.grounded, drifting: c.drifting, slip, cobble: r.on.ground.surface(c.p.x, c.p.z, c.p.y) === 'setts' }, others, dt);
  citySound(c.p, dt);
}

// How close a place is to your kart, from 1 there to nothing at 120 m: how hard an explosion shakes
// the camera.
const near = (r: RaceCtx, p: { x: number; z: number }) => Math.max(0, 1 - Math.hypot(p.x - r.me.car.p.x, p.z - r.me.car.p.z) / 120);

function onArenaFx(r: RaceCtx, f: ArenaFx): void {
  const t = performance.now() / 1000;
  const a = r.arena;
  const owner = (itemId: string) => a.nameOf(itemId.split(':')[0]);
  if (f.k === 'thrown') {
    const ev = f.ev;
    if ('owner' in ev && ev.owner !== r.me.id) {
      const c = a.cars.get(ev.owner);
      if (c) sfx.throw(c);
    }
  } else if (f.k === 'hit') {
    const ev = f.ev;
    const where = { x: ev.x, y: ev.y, z: ev.z };
    r.items.flash(where, t, ev.blocked ? '#7fd4ff' : '#ffe14d', ev.blocked ? 1.6 : 1);
    glow.spray(where, 40, ev.blocked ? ['#7fd4ff', '#ffffff'] : ['#ffe14d', '#ffffff', '#ff4fd8'], 7, 6, 0.7);
    if (ev.victim !== r.me.id) sfx.hit(where);
    if (ev.victim && ev.victim !== r.me.id && !ev.blocked && ev.item) {
      r.hud.feed(`${owner(ev.item)} acertou em ${a.nameOf(ev.victim)} com ${howName(ev.how)}`);
    }
  } else if (f.k === 'boom') {
    const ev = f.ev;
    const where = { x: ev.x, y: ev.y, z: ev.z };
    r.items.flash(where, t, '#ffb347', 4);
    fx.spray(where, 260, ['#ffffff', '#ffe14d', '#ff7a1a', '#c8102e', '#7fd4ff'], 16, 14, 2.4);
    sfx.boom(where);
    r.shake = Math.max(r.shake, near(r, where) * 1.2);
    r.hud.feed(`🚀 O foguete de ${a.nameOf(ev.owner)} apanhou ${a.nameOf(ev.victim)}!`, 'big');
  } else if (f.k === 'martelinho') {
    const ev = f.ev;
    const c = a.cars.get(ev.owner);
    if (c) r.items.wave(c, t);
    sfx.hammer(c);
    r.hud.feed(`🔨 Martelada de ${a.nameOf(ev.owner)}!`, 'big');
  }
}

// What hit someone, with its article, for the feed and the flash: "a bola ⚽".
const HOW: Record<string, [string, string]> = { bola: ['a bola', '⚽'], pombo: ['o pombo-correio', '🕊️'], foguete: ['o foguete', '🚀'], pudim: ['o pudim', '🍮'], filigrana: ['a filigrana', '✨'] };
const howName = (how: string) => (HOW[how] ? `${HOW[how][0]} ${HOW[how][1]}` : how);

function flashSplit(r: RaceCtx, text: string, cls: string, ms = 2000): void {
  r.split = { text, cls, until: performance.now() + ms };
}

// Whatever you're driving, in a race or round the city, as the eggs, the notes and the camera need it.
interface Driving {
  me: { car: Car; slip: number };
  kart: Shown;
  hud: { feed(text: string, cls?: string): void };
  cam: number;
  shake: number;
  vice: number;
}

// The easter eggs on the friends' houses, when your kart passes them: the sounds, the sparkle, the
// word.
function eggReact(r: Driving | null, events: EggEvent[]): void {
  for (const e of events) {
    if (e.kind === 'bark') sfx.bark(e.at);
    if (e.kind === 'dog') {
      if (r) horn(r.kart.model.driver.horn);
      sfx.bark(e.at);
      r?.hud.feed('🐕 O Faísca vai atrás de ti!', 'big');
    }
    if (e.kind === 'dentist') {
      sfx.drill(e.at);
      for (let k = 0; k < 50; k++) glow.add(e.at.x + (Math.random() - 0.5) * 4, e.at.y + Math.random() * 3, e.at.z + (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6, 2 + Math.random() * 5, (Math.random() - 0.5) * 6, 0.9, k % 2 ? '#ffffff' : '#9fe3ff', -6);
      r?.hud.feed('🦷 O dentista diz: abra bem a boca!', 'big');
    }
    if (e.kind === 'supermarket') {
      sfx.chime(e.at);
      r?.hud.feed('🛒 Cartão Contente: +1 ponto', 'big');
    }
    if (e.kind === 'smoke' && r) {
      sfx.pop(e.at);
      r.vice = performance.now() + 15000;
      r.hud.feed('🚬🍺 Uma para o caminho, oferta do café', 'big');
    }
    if (e.kind === 'clock') {
      sfx.alarm(e.at);
      for (let k = 0; k < 60; k++) glow.add(e.at.x + (Math.random() - 0.5) * 6, e.at.y + (Math.random() - 0.5) * 5, e.at.z + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6, 1.1, k % 2 ? '#ffe14d' : '#ffffff', -4);
      r?.hud.feed('⏰ O Vale está atrasado outra vez!', 'big');
    }
  }
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
      fx.burst(r.kart.model.group.position);
      if (race) {
        if (me.fin === null) {
          const lap = me.run.laps + 1;
          if (lap === r.rules.laps) flashCenter(r, 'ÚLTIMA VOLTA', 'big final', 2200);
          else flashSplit(r, `Volta ${lap}/${r.rules.laps}  ·  ${fmt(n.ms)}`, n.best ? 'faster' : 'neutral');
        }
      } else {
        flashSplit(r, `${n.best ? 'Melhor volta! ' : 'Volta '}${fmt(n.ms)}${n.diff === null ? '' : `  ${fmtDiff(n.diff)}`}`, n.best ? 'faster' : 'slower', 3000);
        if (n.best) r.ghostLap = r.rec;
        r.rec = [];
      }
      room?.sendLap(n.ms);
      break;
    case 'finish': {
      const place = r.arena.rankOf(me.id);
      sfx.finish(place);
      fx.spray(me.car.p, 300, ['#ffffff', '#d4af37', '#ffe14d', '#ff4fd8'], 10, 12, 2.5);
      flashCenter(r, `${ordinal(place)} lugar!`, `big place p${place}`, 4000);
      room?.sendFin(n.ms);
      break;
    }
    case 'respawn':
      flashSplit(r, 'De volta à estrada', 'neutral', 800);
      break;
    case 'box':
      sfx.box();
      break;
    case 'item':
      sfx.got();
      break;
    case 'use':
      if (n.kind === 'cafe' || n.kind === 'cafe3') {
        sfx.pop();
        fx.spray(me.car.p, 50, ['#6f4a2e', '#c8a27a', '#f3e6d0'], 4, 7, 0.9);
      } else if (n.kind === 'filigrana') sfx.got();
      else if (n.kind === 'guarda') {
        sfx.shield();
        flashSplit(r, '☂️ Guarda-chuva aberto: aguenta o próximo ataque', 'faster', 1600);
      } else if (n.kind !== 'martelinho') sfx.throw();
      break;
    case 'hit':
      sfx.hit();
      r.shake = Math.max(r.shake, 0.8);
      flashCenter(r, HOW[n.how] ? `${HOW[n.how][1]} Levaste com ${HOW[n.how][0]} de ${n.by}!` : 'Levaste!', 'hit', 1400);
      break;
    case 'blocked':
      sfx.shield();
      flashSplit(r, '☂️ O guarda-chuva aguentou!', 'faster');
      break;
    case 'shrunk':
      flashCenter(r, `🔨 Martelada! O martelinho de ${n.by}`, 'hit', 1600);
      r.shake = Math.max(r.shake, 0.5);
      break;
    default:
      feel(r, n);
  }
}

// What driving does to any kart of ours, in a race or round the city: bumps, slipstreams,
// mini-turbos, walls and landings, on screen and in the speakers.
function feel(r: { me: { car: Car }; shake: number }, n: Note): void {
  const p = r.me.car.p;
  switch (n.k) {
    case 'bump':
      sfx.bump(n.strength);
      r.shake = Math.max(r.shake, Math.min(0.4, n.strength * 0.03));
      break;
    case 'slip':
      sfx.slip();
      break;
    case 'turbo':
      sfx.turbo(n.level);
      glow.spray(p, 40, n.level === 2 ? ['#ff9a2e', '#ffd04d'] : ['#5ad1ff', '#ffffff'], 5, 3, 0.4);
      break;
    case 'wall':
      thud(n.strength);
      r.shake = Math.max(r.shake, Math.min(0.5, n.strength * 0.04));
      break;
    case 'land':
      thud(n.strength * 0.5);
      smoke.spray(p, 14, ['#cfc6b6', '#e0d8c8'], 3, 1, 0.8, 0.3);
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

// A car's snapshot; or, its driver out of it, theirs on foot and where it waits, and in a round their
// fighter's flags (game/fight.ts's FIGHT) where the car's are.
function snapOf(x: { id: string; car: Car; info(): CarInfo }, steer: number, foot: Walker | null = null, fighter = 0): Snap {
  const c = x.car;
  const info = x.info();
  const s: Snap = {
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
    w: 0,
    pi: 0,
    kx: 0,
    ky: 0,
    kz: 0,
    kw: 0,
  };
  if (!foot) return s;
  const p = foot.p;
  return { ...s, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +foot.yaw.toFixed(3), spd: +foot.speed().toFixed(1), st: 0, fl: fighter, g: foot.grounded ? 1 : 0, w: 1, pi: +foot.pitch.toFixed(3), kx: s.x, ky: s.y, kz: s.z, kw: s.yaw };
}

// The others round the city who are on foot, their karts waiting, empty and quiet.
const afoot = new Set<string>();

// The others, where they were a moment ago, smoothly: into `cars` (for positions, bumps and
// targets) and onto the screen as `karts`. `local` says which cars this browser drives itself; round
// the city the bots aren't out but in a round. One out of their kart (braga-map's task 073) is drawn
// standing where they are, as the driver they picked, and their kart empty where it waits; a bot on
// foot (braga-map's task 075) as the driver it is, with no kart.
function syncOthers(karts: Map<string, Shown>, cars: Map<string, CarInfo>, local: (id: string) => boolean, roaming: boolean, dt: number): void {
  const now = performance.now();
  const at = now - 110;
  const seen = new Set<string>();
  kartBlocks.length = 0;
  for (const [id, snaps] of room ? room.cars : []) {
    if (local(id)) continue;
    const m = room!.lobby.members.find((x) => x.id === id);
    if (!m || snaps.length === 0 || (roaming && m.bot && !fight)) continue;
    seen.add(id);
    let i = snaps.length - 1;
    while (i > 0 && snaps[i - 1].at > at) i--;
    const a = snaps[Math.max(0, i - 1)].s;
    const b = snaps[i].s;
    const span = snaps[i].at - snaps[Math.max(0, i - 1)].at;
    const f = span <= 0 ? 1 : Math.max(0, Math.min(1, (at - snaps[Math.max(0, i - 1)].at) / span));
    const foot = !!b.w;
    const jump = !!a.w !== foot || Math.hypot(b.x - a.x, b.z - a.z) > 30;
    const L = (p: number, q: number) => (jump ? q : p + (q - p) * f);
    const yaw = jump ? b.yaw : a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * f;
    const x = L(a.x, b.x);
    const y = L(a.y, b.y);
    const z = L(a.z, b.z);
    const fin = room!.board.find((e) => e.id === id)?.fin ?? null;
    let k = karts.get(id);
    if (!k || k.driver !== m.driver || k.label !== m.name) {
      hide(k);
      k = showKart(m.driver, m.name);
      karts.set(id, k);
    }
    k.model.figure.visible = !foot;
    k.model.group.visible = !(foot && m.bot);
    if (foot) {
      afoot.add(id);
      if (!m.bot) {
        cars.set(id, { id, name: m.name, P: 0, x: b.kx, y: b.ky, z: b.kz, vx: 0, vz: 0, flags: 0, fin });
        pose(k.model.group, b.kx, b.ky, b.kz, b.kw, { x: b.ux, y: b.uy, z: b.uz });
        k.model.update(0, 0, dt, true, 0);
        kartBlock(kartBlocks, b.kx, b.ky, b.kz, b.kw);
      }
      if (!k.walker) {
        k.walker = buildWalker(driverById(m.driver));
        scene.add(k.walker.group);
      }
      k.walker.group.visible = true;
      k.walker.group.position.set(x, y, z);
      k.walker.group.rotation.y = -yaw;
      k.walker.update(b.spd, dt, L(a.pi, b.pi));
      // In a round: their gun, and down, falling and fading; their footsteps always.
      const fl = fight ? fighterOf(b.fl) : null;
      const armed = !!fl?.armed;
      k.walker.arm(armed ? fl!.kit : null);
      let s = standing.get(id);
      if (!s) standing.set(id, (s = { x, y, z, yaw, spd: 0, fighting: false, downAt: 0, stride: 0, model: k.walker }));
      Object.assign(s, { x, y, z, yaw, spd: b.spd, fighting: armed, model: k.walker });
      s.downAt = armed && fl!.down ? s.downAt || now : 0;
      const since = s.downAt ? now - s.downAt : 0;
      k.walker.fall(s.downAt ? Math.min(1, since / 450) : 0, s.downAt ? clamp((since - 2500) / 800, 0, 1) : 0);
      if (b.g && b.spd > 0.6 && !s.downAt) {
        s.stride += b.spd * dt;
        if (s.stride > (b.spd > 3 ? 1.6 : 0.8)) {
          s.stride = 0;
          fightSfx.step(b.spd > 3, { x, y, z });
        }
      }
    } else {
      afoot.delete(id);
      standing.delete(id);
      kartBlock(kartBlocks, x, y, z, yaw);
      cars.set(id, { id, name: m.name, P: L(a.P, b.P), x, y, z, vx: Math.cos(b.yaw) * b.spd, vz: Math.sin(b.yaw) * b.spd, flags: b.fl, fin });
      pose(k.model.group, x, y, z, yaw, { x: L(a.ux, b.ux), y: L(a.uy, b.uy), z: L(a.uz, b.uz) });
      k.model.update(b.spd, b.st, dt, !!b.g, b.fl);
      kartEffects(id, k, x, y, z, yaw, Math.abs(b.spd), b.fl, !!b.g, dt);
      if (k.walker) k.walker.group.visible = false;
    }
    // Their name over them, in the kart or on foot; but in a round, where it would say where they are
    // through the walls, none.
    const over = foot ? k.walker!.group : k.model.group;
    if (k.tag && k.tag.parent !== over) {
      over.add(k.tag);
      k.tag.position.y = foot ? 2.2 : 3.4;
    }
    if (k.tag) k.tag.visible = !fight;
  }
  for (const [id, k] of karts) {
    if (local(id) || seen.has(id)) continue;
    hide(k);
    karts.delete(id);
    cars.delete(id);
    afoot.delete(id);
    standing.delete(id);
  }
}

function stepRace(r: RaceCtx, now: number, dt: number): void {
  const a = r.arena;
  const me = r.me;
  const raceMs = now - r.goAt;
  a.started = raceMs >= 0;
  syncOthers(r.karts, a.cars, (id) => id === me.id || r.bots.some((b) => b.racer.id === id), false, dt);

  for (const act of [...keys.actions(), ...pad.actions()]) {
    if (act === 'horn') honk(r.kart);
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
    flashCenter(r, 'Acabou o tempo!', 'big', 99999);
  }

  r.acc += Math.min(0.25, dt);
  while (r.acc >= DT) {
    r.acc -= DT;
    a.t = now - r.goAt - r.acc * 1000;
    const k = keys.controls();
    const p = pad.controls();
    const held = { throttle: Math.max(k.throttle, p.throttle), brake: Math.max(k.brake, p.brake), steer: clampSteer(k.steer + p.steer), drift: k.drift || p.drift };
    let ctl: Controls = AUTODRIVE ? { ...autopilot(me.car, r.track), use: false, back: false } : { ...held, use: false, back: held.brake > 0 };
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
      b.throttle = bc.throttle;
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
    const vice = x === me && now < r.vice;
    k.model.update(speedOf(c) * Math.sign(fwd || 1), x === me ? r.steer : (r.bots.find((b) => b.racer === x)?.steer ?? 0), dt, c.grounded, info.flags, vice);
    kartEffects(x.id, k, c.p.x, c.p.y, c.p.z, c.yaw, speedOf(c), info.flags, c.grounded, dt);
    if (vice) cigarette(k, c, dt);
  }
  r.items.update(a, me.taken, now / 1000, dt);
  hearKarts(r, dt);

  // Time attack: record this lap for the ghost, and show the best one.
  const lapMs = raceMs - me.run.lapStart;
  if (r.rules.mode === 'time' && a.started && !r.timeUp) {
    const k = Math.floor(lapMs / 50);
    if (r.rec.length <= k) r.rec[k] = [me.car.p.x, me.car.p.y, me.car.p.z, me.car.yaw, me.car.up.x, me.car.up.y, me.car.up.z];
    if (r.ghostLap) {
      if (!r.ghost) r.ghost = showKart(r.kart.driver, null, true);
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
    flashCenter(r, 'JÁ!', 'big go', 900);
  }

  // The HUD.
  const isRace = r.rules.mode === 'race';
  const order = a.order();
  const center = !a.started
    ? { text: left <= 3 ? String(left) : 'Prepara-te', cls: 'big' }
    : r.center && now < r.center.until
      ? r.center
      : null;
  const grace = room?.isHost ? (room as HostRoom).graceLeft() : null;
  r.hud.set({
    place: isRace ? [a.rankOf(me.id), a.cars.size] : undefined,
    lap: isRace ? (me.fin !== null ? 'Acabaste' : `Volta ${Math.min(r.rules.laps, me.run.laps + 1)}/${r.rules.laps}`) : a.started && !r.timeUp ? fmt(Math.max(0, lapMs)) : fmt(0),
    time: isRace ? (me.fin !== null ? fmt(me.fin) : a.started ? fmt(raceMs) : fmt(0)) : `Melhor ${fmt(me.run.best)}`,
    clock: isRace ? (grace !== null ? `Fim em ${Math.ceil(grace / 1000)} s` : '') : `Tempo ${Math.floor(Math.max(0, r.endAt - now) / 60000)}:${String(Math.floor((Math.max(0, r.endAt - now) % 60000) / 1000)).padStart(2, '0')}`,
    item: me.item,
    rolling: me.roll > 0,
    speed: speedOf(me.car),
    boosting: me.car.boost > 0,
    slip: me.slip,
    shield: me.shield,
    center,
    split: r.split && now < r.split.until ? r.split : null,
  });
  pad.item(me.item ? ITEMS[me.item.kind].icon : '', me.item?.uses ?? 0, me.roll > 0, me.shield);
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
          right: c.fin !== null ? fmt(c.fin) : c === lead ? 'Líder' : `−${Math.max(0, Math.round((lead.P - c.P) / Math.max(10, speedOf(me.car) || 30)))}s`,
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
// The camera where ?view= holds it.
function holdView(v: number[]): void {
  camera.position.set(v[0], v[1], v[2]);
  camera.lookAt(v[3], v[4], v[5]);
  if (v[6] > 0 && camera.fov !== v[6]) {
    camera.fov = v[6];
    camera.updateProjectionMatrix();
  }
}

// The field of view eased towards fov, at `rate` a second, opened up on a phone held upright, or the
// road is a slot down the middle.
function widen(fov: number, dt: number, rate = 4): void {
  if (camera.aspect < 1) fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) / Math.sqrt(camera.aspect)));
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * rate);
    camera.updateProjectionMatrix();
  }
}

function chase(r: Driving, dt: number): void {
  if (VIEW && VIEW.length >= 6) {
    holdView(VIEW);
    return;
  }
  const c = r.me.car;
  const close = r.cam === 1;
  const f = new THREE.Vector3(Math.cos(c.yaw), 0, Math.sin(c.yaw));
  const spd = speedOf(c);
  const dist = close ? 4.8 : 7.6 + spd * 0.045;
  const want = new THREE.Vector3(c.p.x, c.p.y, c.p.z).addScaledVector(f, -dist).add(new THREE.Vector3(0, close ? 2.0 : 3.2, 0));
  want.y = Math.max(want.y, world.ground(want.x, want.z) + 1.2);
  // Somewhere else altogether (the game opening, a friend's side): straight there.
  if (camPos.distanceTo(want) > 150) camPos.copy(want);
  camPos.lerp(want, 1 - Math.exp(-dt * (close ? 14 : 8)));
  camLook.set(c.p.x, c.p.y + 1.3, c.p.z).addScaledVector(f, 5);
  camera.position.copy(camPos);
  if (r.shake > 0.01) {
    const s = r.shake * 0.35;
    camera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    r.shake *= Math.exp(-dt * 6);
  }
  camera.lookAt(camLook);
  widen(66 + Math.min(20, spd * 0.32) + (c.boost > 0 ? 6 : 0) + r.me.slip * 4, dt);
}

// With the menu open: the camera turns slowly round your kart, which stands on the right of the
// screen, clear of the menu.
function orbit(c: Car, t: number, dt: number): void {
  if (VIEW && VIEW.length >= 6) {
    holdView(VIEW);
    return;
  }
  const ang = c.yaw + Math.PI * 0.8 + Math.sin(t * 0.2) * 0.6;
  const want = new THREE.Vector3(c.p.x + Math.cos(ang) * 7.5, c.p.y + 2.6, c.p.z + Math.sin(ang) * 7.5);
  want.y = Math.max(want.y, world.ground(want.x, want.z) + 1.2);
  if (camPos.distanceTo(want) > 150) camPos.copy(want);
  camPos.lerp(want, 1 - Math.exp(-dt * 2.5));
  camera.position.copy(camPos);
  const toKart = new THREE.Vector3(c.p.x - camPos.x, 0, c.p.z - camPos.z).normalize();
  camera.lookAt(c.p.x + toKart.z * 2.4, c.p.y + 1.1, c.p.z - toKart.x * 2.4);
  widen(58, dt);
}

// Flying: the camera is the flyer's, at a field of view of 70°. Any other camera starts from it.
function flyCam(f: Flyer, dt: number): void {
  const d = f.dir();
  camera.position.set(f.p.x, f.p.y, f.p.z);
  camera.lookAt(f.p.x + d.x, f.p.y + d.y, f.p.z + d.z);
  camPos.copy(camera.position);
  widen(70, dt);
}

// On foot: the camera at your eyes, looking where you look, its height easing up a kerb or a tread
// rather than jumping, and never bobbing. ?view= still holds it. In a round, through a scope it
// narrows, and put down, it drops to the ground, rolling over.
function walkCam(r: RoamCtx, w: Walker, dt: number): void {
  if (VIEW && VIEW.length >= 6) {
    holdView(VIEW);
    return;
  }
  const f = fight;
  const down = !!f && f.started && !f.me.alive;
  const want = w.p.y + (down ? 0.35 : EYE);
  r.eye = Math.abs(want - r.eye) > 2 && !down ? want : r.eye + (want - r.eye) * (1 - Math.exp(-dt / (down ? 0.15 : 0.07)));
  const d = w.dir();
  camera.position.set(w.p.x, r.eye, w.p.z);
  camera.lookAt(w.p.x + d.x, r.eye + d.y, w.p.z + d.z);
  if (down) camera.rotateZ(0.7 * Math.min(1, (performance.now() - f.fell) / 500));
  if (r.shake > 0.01) {
    camera.rotateX((Math.random() - 0.5) * r.shake * 0.04);
    r.shake *= Math.exp(-dt * 8);
  }
  camPos.copy(camera.position);
  const zoom = f?.me.scoped && f.me.alive ? (KITS[f.me.kit].scope?.zoom ?? 1) : 1;
  widen(72 / zoom, dt, f ? 18 : 4);
}

// Where the flying camera looks on the ground, at most 100 m ahead, for the sun's shadows to fall
// round, as ?scenery's fall 8 m ahead of its camera.
function lookedAt(f: Flyer): V {
  const d = f.dir();
  const level = Math.hypot(d.x, d.z) || 1e-6;
  for (let s = 4; s <= 100; s += 4) {
    const x = f.p.x + (d.x / level) * s;
    const z = f.p.z + (d.z / level) * s;
    const y = world.above(x, z);
    if (f.p.y + (d.y / level) * s <= y) return v3(x, y, z);
  }
  const x = f.p.x + (d.x / level) * 100;
  const z = f.p.z + (d.z / level) * 100;
  return v3(x, world.above(x, z), z);
}

// The sounds' listener, on the camera.
const ahead = new THREE.Vector3();
const above = new THREE.Vector3();
function hear(): void {
  camera.getWorldDirection(ahead);
  above.set(0, 1, 0).applyQuaternion(camera.quaternion);
  listen(camera.position, ahead, above);
}

// ---- The loop ----

let last = performance.now();
// If the game runs slowly, step the graphics down a level (as far as Low), and say so.
const slow = { frames: 0, time: 0 };
function watchSpeed(dt: number): void {
  if ((!race && !roam) || quality === 'low' || AUTODRIVE) return;
  slow.frames++;
  slow.time += dt;
  if (slow.time < 6) return;
  if (slow.frames / slow.time < 35) {
    quality = quality === 'high' ? 'medium' : 'low';
    remember('pk-quality', quality);
    look.setQuality(quality);
    feed(`Gráficos baixados para ${QUALITY_NAME[quality]}, para o jogo não engasgar`, 'big');
  }
  slow.frames = 0;
  slow.time = 0;
}

function frame(now: number): void {
  // Never back in time: a first frame can be stamped before the city was built.
  const dt = clamp((now - last) / 1000, 0, 0.25);
  last = now;
  const t = now / 1000;
  world.update(t);
  watchSpeed(dt);

  if (race) {
    stepRace(race, now, dt);
    race.on.update(t);
    const me = race.me;
    // The friends' houses go off as you pass them on the home track; on another, they're only there.
    const passing = race.course === HOME && race.arena.started && !race.timeUp && me.fin === null;
    eggReact(race, world.eggs.update(t, dt, passing ? { idx: me.car.idx, speed: speedOf(me.car) } : null));
    chase(race, dt);
    fitTags(race.karts.values());
    look.follow(race.me.car.p);
    if (AUTODRIVE) (window as unknown as { __kart: object }).__kart = { mode: 'race', track: race.course.id, driver: race.kart.driver, x: race.me.car.p.x, y: race.me.car.p.y, z: race.me.car.p.z, idx: race.me.car.idx, lap: race.me.run.laps, fin: race.me.fin, item: race.me.item?.kind ?? null, place: race.arena.rankOf(race.me.id), cars: race.arena.cars.size, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, audio: { ...readMeter(), record: recordState(), played, city: cityHeard } };
  } else if (roam) {
    const r = roam;
    stepRoam(r, now, dt);
    if (r.walk) walkCam(r, r.walk, dt);
    // Your gun, once the camera's set; the shots' tracers and flashes.
    if (arms) {
      const f = fight;
      arms.view.show(f && f.started && f.me.alive && r.walk ? f.me.kit : null);
      if (f && r.walk) arms.view.update(camera, SUN_DIR, dt, r.walk.speed(), f.me.reloading ? 1 - (f.me.reloadAt - (now - f.goAt)) / KITS[f.me.kit].reload : null, f.me.scoped);
      arms.shots.update(dt);
    }
    else if (r.fly) flyCam(r.fly, dt);
    else if (menu || results) orbit(r.me.car, t, dt);
    else chase(r, dt);
    fitTags(r.karts.values());
    look.follow(r.walk ? r.walk.p : r.fly ? lookedAt(r.fly) : r.me.car.p);
    if (AUTODRIVE) {
      const c = r.me.car;
      const d = camera.getWorldDirection(new THREE.Vector3());
      (window as unknown as { __kart: object }).__kart = {
        mode: 'roam',
        fly: !!r.fly,
        walk: r.walk ? { x: r.walk.p.x, y: r.walk.p.y, z: r.walk.p.z, yaw: r.walk.yaw, pitch: r.walk.pitch, grounded: r.walk.grounded, speed: r.walk.speed() } : null,
        cam: { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: Math.atan2(d.z, d.x), pitch: Math.asin(clamp(d.y, -1, 1)) },
        driver: r.kart.driver,
        x: c.p.x,
        y: c.p.y,
        z: c.p.z,
        yaw: c.yaw,
        speed: speedOf(c),
        room: room?.lobby.code ?? null,
        host: room?.isHost ?? false,
        members: room?.lobby.members.filter((m) => !m.bot).map((m) => m.name) ?? [],
        others: [...r.cars.values()].map((o) => ({ id: o.id, name: o.name, x: o.x, y: o.y, z: o.z })),
        street: r.street,
        fight: fight ? { started: fight.started, alive: fight.me.alive, health: fight.me.health, kit: fight.me.kit, ammo: fight.me.ammo, kills: room?.board.find((e) => e.id === room?.you)?.kills ?? 0, deaths: room?.board.find((e) => e.id === room?.you)?.deaths ?? 0, foes: foes(), bots: fight.squad?.bots.map((b) => ({ id: b.id, x: b.w.p.x, y: b.w.p.y, z: b.w.p.z, alive: b.s.alive, health: b.s.health, kit: b.s.kit, shots: b.shots, stuck: b.stuck })) ?? null } : null,
        calls: renderer.info.render.calls,
        tris: renderer.info.render.triangles,
        audio: { city: cityHeard },
      };
    }
  }
  hear();
  fx.update(dt);
  glow.update(dt);
  smoke.update(dt);
  look.render(t);
  stats?.frame(quality, race ? 'race' : roam ? (fight ? 'fight' : roam.walk ? 'walk' : 'roam') : null);
  requestAnimationFrame(frame);
}

// ---- The scenery alone (?scenery) ----

// Without ?view=, the start line from behind the grid.
const line = home.samples[0];
const held = VIEW && VIEW.length >= 6 ? VIEW : [line.p.x - line.t.x * 14, line.p.y + 5, line.p.z - line.t.z * 14, line.p.x, line.p.y + 1, line.p.z];
// The sun's shadows fall round where a kart would be in a race: 8 m in front of the camera.
const kartAt = new THREE.Vector3(held[3] - held[0], 0, held[5] - held[2]).normalize().multiplyScalar(8).add(new THREE.Vector3(held[0], 0, held[2]));
kartAt.y = world.ground(kartAt.x, kartAt.z);
// Waits for the graphics card to finish what it's been given: reading a pixel back has to.
const pixel = new Uint8Array(4);
const finish = () => {
  const gl = renderer.getContext();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
};
// What a frame costs: n of them drawn one after another, and the milliseconds each took. That's
// the time the graphics card or the browser, whichever is slower, takes over a frame, so 60 frames
// a second wants it under 16.7 ms.
function timeFrames(n: number): number {
  finish();
  const t0 = performance.now();
  for (let k = 0; k < n; k++) look.render();
  finish();
  return (performance.now() - t0) / n;
}
let drawn = 0;
let texBytes = 0;
// The city as it is at 0 s.
function sceneryFrame(): void {
  world.update(0);
  holdView(held);
  look.follow(kartAt);
  look.render();
  const { render: r, memory: m } = renderer.info;
  // Once the sun's shadows are made, at the first frame.
  texBytes ||= textureBytes(scene);
  (window as unknown as { __kart: object }).__kart = { frames: ++drawn, buildMs: Math.round(buildMs), calls: r.calls, tris: r.triangles, textures: m.textures, texMB: Math.round(texBytes / 1048576), geometries: m.geometries, timeFrames };
  requestAnimationFrame(sceneryFrame);
}

if (AUTODRIVE || SCENERY) (window as unknown as { __scene: THREE.Scene }).__scene = scene;
if (AUTODRIVE) {
  measureAudio();
  // The sounds themselves, for scripts/listen.mjs to play the loudest of them at once, and the
  // camera they're heard from.
  (window as unknown as { __sound: object }).__sound = { sfx, horn, lapSound, beep, thud, engines, resetMeter, readMeter, camera };
  // On foot, you put at (x, z) looking at (tx, ty, tz), for checking a round with Playwright.
  (window as unknown as { __walk: object }).__walk = (x: number, z: number, tx: number, ty: number, tz: number, y?: number): boolean => {
    const w = roam?.walk;
    if (!w) return false;
    w.p = v3(x, w.ground.floor(x, z, (y ?? w.ground.groundAt(x, z)) + 0.5).y, z);
    w.v = v3();
    w.yaw = Math.atan2(tz - z, tx - x);
    w.pitch = Math.atan2(ty - w.p.y - EYE, Math.hypot(tx - x, tz - z));
    roam!.eye = w.p.y + EYE;
    return true;
  };
}

addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) toggleMute();
  // Esc opens the menu over the world, and closes it (or the results, or goes back from the race's
  // settings).
  // On foot, the Esc that let the pointer go has opened the menu already (mouse.onLost).
  if (e.code === 'Escape' && roam && !race && performance.now() - mouse.lostAt > 500) {
    e.preventDefault();
    if (results) results = null;
    else if (menu && page === 'race') page = 'main';
    else if (menu) return closeMenu();
    else menu = true;
    render();
  }
});
// On foot, the browser letting the pointer go (Esc, or another window) opens the menu.
mouse.onLost = () => {
  if (roam?.walk && !race && !menu && !results) openMenu();
};
// A phone suspends the sound when the page goes to the background; the next touch brings it back.
addEventListener('pointerdown', unlockAudio);
addEventListener('touchend', unlockAudio);
// The first tap on a phone asks for the whole screen, and sideways once it has it.
addEventListener('pointerup', fullScreen, { once: true });
document.addEventListener('fullscreenchange', () => sideways(!!document.fullscreenElement));
// Where you are, for the next time the game opens.
addEventListener('pagehide', () => roam && keepWhere(roam.me.car));

if (SCENERY) {
  document.getElementById('loading')?.remove();
  requestAnimationFrame(sceneryFrame);
} else {
  // The game opens driving, alone, where you last were or on the plinth at the start.
  startRoam(startCar());
  // Prepare every driver's materials now, and the race's marks', rather than freezing when a race
  // starts or a friend joins.
  const warm = DRIVERS.map((d) => showKart(d.id, d.name));
  for (const r of races.values()) r.marks.visible = true;
  renderer.compile(scene, camera);
  for (const r of races.values()) r.marks.visible = false;
  warm.forEach(hide);
  render();
  document.getElementById('loading')?.remove();
  feed(pad.on ? 'Bem-vindo a Braga! O ☰ lá em cima abre o menu: o teu nome, o piloto, os amigos e a corrida.' : 'Bem-vindo a Braga! Esc abre o menu: o teu nome, o piloto, os amigos e a corrida.', 'big');
  const invited = roomFromUrl();
  if (invited) void join(invited);
  requestAnimationFrame(frame);
}
