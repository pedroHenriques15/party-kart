import { map as bragaMap, type Track as Course } from 'braga-map';
import * as THREE from 'three';
import './style.css';
import { ambienceOf } from './ambience.ts';
import { beep, checkpointSound, cityHeard, cityIs, citySound, engines, fightSfx, horn, isMuted, lapSound, listen, measureAudio, played, readMeter, recordAudio, recordState, resetMeter, setVolumes, sfx, thud, toggleMute, unlockAudio, type Kart } from './audio.ts';
import { keyName, keysOf, keysText, learnLayout, type Mode } from './binds.ts';
import { autopilot } from './car/autopilot.ts';
import { carAt, clampSteer, newCar, speedOf, stopInput, type Car, type Input } from './car/car.ts';
import { Arena, FLAG, type ArenaFx, type CarInfo, type Rules } from './game/arena.ts';
import { botControls, newBrain, type Brain } from './game/bot.ts';
import { drawOf, GUNS, isGun, isNade, nameOf as weaponName, speedWith, START, type Cause, type GunId, type Loadout } from './game/arsenal.ts';
import { blastAt, COMP, compMap, inBuyZone, killReward, Match, priceOf, sideOf, siteAt, startKit, type CompState, type Side } from './game/comp.ts';
import { carriedBy as carried, MatchBots } from './game/matchbots.ts';
import { BUY_TIME, fighterOf, fire, hitTotal, landed, RESPAWN, Soldier, spreadOf, stab, struck, type Body, type DownEv, type FightEv, type Hit, type See, type ShotEv } from './game/fight.ts';
import { field, pickSpawn, seeOn, type Field, type Spawn } from './game/field.ts';
import { along, blast, blinding, burning, CLOUD, douse, FIRE, fly as flyNade, inFire, thickness, toss, WINDUP, type Blaze, type Cloud, type Flight, type NadeEv } from './game/nades.ts';
import { Flyer, landing, type Bound, type FlyInput } from './game/flyer.ts';
import { SKILLS, Squad, type FootBot, type Mark } from './game/footbot.ts';
import { ITEMS } from './game/items.ts';
import { whereIs } from './game/marks.ts';
import { NO_CONTROLS, Racer, type Controls, type Note } from './game/racer.ts';
import { Roamer } from './game/roamer.ts';
import { alight, EYE, FALL, STAND, type WalkInput, Walker } from './game/walker.ts';
import { FightHud, fmt, fmtDiff, FullMap, guideOf, Hud, ordinal, RoamHud, SIDES, TEAMS, type CompView as CompHud, type Dot, type Gps, type RoomView, type ScoreRow, type Shop } from './hud.ts';
import { Keyboard, Mouse, TouchPad } from './input.ts';
import { loadPrefs, savePrefs, type Prefs } from './prefs.ts';
import { capturing, settingsScreen } from './settingsScreen.ts';
import { addScaled, clamp, v3, type V } from './math.ts';
import { buildEdge, ShotsView, Viewmodel, type HandState } from './render/arms.ts';
import { CompView } from './render/comp.ts';
import { buildProps } from './render/props.ts';
import { loadParked, type Parked } from './world/cover.ts';
import { CAR_L, CAR_R } from './world/ground.ts';
import { NadesView } from './render/nades.ts';
import { buildFighter, type Fighter } from './render/soldier.ts';
import { buildKart, buildWalker, driverById, DRIVERS, type KartModel, type WalkerModel } from './render/drivers.ts';
import { Particles } from './render/fx.ts';
import { ItemsView } from './render/items3d.ts';
import { Look, SUN_DIR, type Quality } from './render/look.ts';
import { Skids } from './render/skids.ts';
import { nameTag } from './render/textures.ts';
import { buildCity, type RaceWorld } from './render/city.ts';
import { GpsArrows } from './render/gps.ts';
import type { EggEvent } from './render/eggs.ts';
import { ClientRoom, cleanName, HOST_ID, HostRoom, MAX_RACERS, teamed, type Entry, type GameEv, type Room, type Snap } from './session.ts';
import { Stats, textureBytes } from './stats.ts';
import { buildTrack, locate, type Track } from './track/track.ts';
import { courseById, HOME, km, TRACKS } from './tracks.ts';
import { onTheMap } from './world/mapview.ts';
import { nextStep, onRoute, Router, type Route, type Travel } from './world/route.ts';
import { kartTo, mayGo } from './world/goto.ts';
import { Places } from './world/places.ts';
import { streetNames } from './world/names.ts';
import { clear, sight, type Blocker } from './world/sight.ts';

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
// The settings (prefs.ts): the controls' keys among them.
let prefs: Prefs = loadPrefs();
learnLayout();
const keys = new Keyboard(prefs.binds);
const pad = new TouchPad((code) => keys.bound(code));
// A phone or a tablet: its finger is its pointer.
const PHONE = matchMedia('(pointer: coarse)').matches;

// ---- Three.js ----

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const mouse = new Mouse(canvas, keys);
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

look.scale = prefs.scale;
look.setQuality(quality);

// ---- The settings (prefs.ts, settingsScreen.ts) ----

// The frames a second, in a corner, when the settings ask for them.
const fpsEl = document.createElement('div');
fpsEl.className = 'fps';
const fpsCount = { frames: 0, since: 0 };

// The settings put to work: the keys, the mouse's and a finger's sensitivity, the sound's levels, the
// resolution, the crosshair, and what the screen shows.
function applyPrefs(): void {
  const p = prefs;
  keys.bind(p.binds);
  mouse.sens = p.sens;
  mouse.scopeSens = p.scopeSens;
  mouse.invert = p.invert;
  pad.sens = p.touchSens;
  setVolumes(p);
  if (look.scale !== p.scale) {
    look.scale = p.scale;
    look.setQuality(quality);
  }
  const c = p.crosshair;
  const root = document.documentElement.style;
  root.setProperty('--ch-c', c.color);
  root.setProperty('--ch-len', `${c.len}px`);
  root.setProperty('--ch-th', `${c.thick}px`);
  root.setProperty('--ch-a', String(c.alpha));
  root.setProperty('--ch-dot', c.dot ? 'block' : 'none');
  root.setProperty('--ch-out', c.outline ? '0 0 0 1px rgba(0, 0, 0, 0.75)' : 'none');
  document.body.classList.toggle('no-hints', !p.hints);
  document.body.classList.toggle('no-minimap', !p.minimap);
  if (p.fps && !fpsEl.isConnected) document.body.append(fpsEl);
  if (!p.fps) fpsEl.remove();
}
applyPrefs();

const settingsHost = {
  get prefs() {
    return prefs;
  },
  set prefs(p: Prefs) {
    prefs = p;
  },
  get quality() {
    return quality;
  },
  setQuality(q: Quality) {
    quality = q;
    remember('pk-quality', q);
    look.setQuality(q);
  },
  changed(p: Prefs) {
    prefs = p;
    savePrefs(p);
    applyPrefs();
    // The keys' line at the bottom says the keys as they are now.
    roam?.hud.keys(hintMode(), hints(hintMode()));
  },
  muted: isMuted,
  toggleMute: () => void toggleMute(),
  capture(on: boolean) {
    keys.capturing = on;
  },
  back() {
    page = 'main';
    render();
  },
};

// The way you play now, for the keys: driving (a race too), flying, on foot, or in a round.
function inputMode(): Mode {
  if (race || !roam) return 'drive';
  return roam.fly ? 'fly' : roam.walk ? (fight && !fight.free ? 'fight' : 'foot') : 'drive';
}
const hintMode = (): 'drive' | 'fly' | 'walk' | 'fight' => {
  const m = inputMode();
  return m === 'foot' ? 'walk' : m;
};

// The keys' line at the bottom, as the keys are bound: the first of each control's keys.
function hints(mode: 'drive' | 'fly' | 'walk' | 'fight'): string {
  const b = prefs.binds;
  const m: Mode = mode === 'walk' ? 'foot' : mode;
  const k = (id: string) => keyName(keysOf(b, m, id)[0] ?? '') || '—';
  const move = `${k('fwd')}${k('left')}${k('back')}${k('right')}`;
  if (mode === 'drive') return `${k('throttle')} ${k('brake')} ${k('steerLeft')} ${k('steerRight')} conduzem · ${k('drift')} derrapa · ${k('respawn')} volta à rua · ${k('horn')} buzina · ${k('camera')} câmara · ${k('fly')} voa · ${k('walk')} a pé · ${k('map')} mapa · Esc menu`;
  if (mode === 'fly') return `${move} voa · ${k('turnLeft')}${k('turnRight')} vira · ${k('rise')} sobe · ${k('sink')} desce · ${k('fast')} mais depressa · arrasta o rato para olhar · ${k('fly')} volta ao kart · ${k('map')} mapa · Esc menu`;
  const arms = `${k('fire')} dispara · ${k('alt')}: mira, facada, lançar · ${k('reload')} recarrega · ${k('slot1')}–${k('slot4')} armas (${k('last')} a anterior) · ${k('buy')} compra`;
  if (mode === 'walk') return `${move} anda · o rato olha · ${k('quiet')} caminha · ${k('crouch')} agacha · ${k('jump')} salta · ${arms}
${k('inspect')} inspeciona · ${k('walk')} volta ao kart · ${k('map')} mapa · Esc menu`;
  return `${move} anda · o rato aponta · ${arms}
${k('quiet')} caminha · ${k('crouch')} agacha · ${k('jump')} salta · ${k('use')} planta, desativa, apanha · ${k('inspect')} inspeciona · ${k('scores')} pontuação · ${k('map')} mapa · Esc menu`;
}

// ---- Karts on screen ----

interface Shown {
  model: KartModel;
  tag: THREE.Sprite | null;
  driver: string;
  label: string | null;
  walker: WalkerModel | null; // another player out of their kart, standing (braga-map's task 073)
  fighter: Fighter | null; // and in a round, as a fighter
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
    tag.position.set(0, 2.6, 0);
    tag.renderOrder = 10;
    model.group.add(tag);
  }
  scene.add(model.group);
  return { model, tag, driver: driverId, label, walker: null, fighter: null };
}

function hide(s: Shown | null | undefined): void {
  if (!s) return;
  scene.remove(s.model.group);
  if (s.walker) scene.remove(s.walker.group);
  if (s.fighter) scene.remove(s.fighter.group);
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
  const rear = (side: number) => pos.clone().addScaledVector(back, 0.8).addScaledVector(right, side * 0.7).add(new THREE.Vector3(0, 0.05, 0));
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
let page: 'main' | 'race' | 'fight' | 'settings' = 'main';

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
const staying = () => !!(room || race || (fight && !fight.free));
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
  if (page === 'settings') return settingsScreen(settingsHost, render);
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
      h('button', { onclick: () => void openRace(), disabled: !!busy || inRound() }, '🏁 Corrida'),
      h('button', { onclick: () => void openFight(), disabled: !!busy || inRound() }, '🎯 Tiroteio'),
      !inRound() && h('button', { onclick: reposition }, '↺ Reposicionar'),
      roam && !roam.walk && h('button', { onclick: () => (fly(roam!, !roam!.fly), closeMenu()) }, roam.fly ? '🏎️ Voltar ao kart' : '🎥 Voar pela cidade'),
      roam && !roam.fly && !inRound() && h('button', { onclick: () => (walk(roam!, !roam!.walk), closeMenu()) }, roam.walk ? '🏎️ Voltar ao kart' : '🚶 A pé'),
    ),
    h('p', { class: 'err' }, busy || notice),
    h('div', { class: 'row foot' }, qualityPicker(), h('button', { class: 'ghost', onclick: () => ((page = 'settings'), render()) }, '⚙️ Definições')),
    howTo(),
  );
}

function howTo(): HTMLElement {
  // A control's keys as bound (⚙️ Definições › Controlos).
  const k = (mode: Mode, id: string) => h('b', {}, keysText(prefs.binds, mode, id));
  return h(
    'details',
    { class: 'how' },
    h('summary', {}, 'Como se joga'),
    h(
      'ul',
      {},
      h('li', { class: 'keys-only' }, h('b', {}, 'Conduzir:'), ' ', k('drive', 'throttle'), ' acelera, ', k('drive', 'brake'), ' trava, ', k('drive', 'steerLeft'), ' e ', k('drive', 'steerRight'), ' viram, por onde quiseres dentro da zona (o mapa mostra o limite a vermelho). Derrapar: mantém ', k('drive', 'drift'), ' numa curva; quando as faíscas ficarem azuis, e depois laranja, larga para um mini-turbo.'),
      h('li', { class: 'touch-only' }, h('b', {}, 'Virar:'), ' com o polegar esquerdo, a arrastar para a esquerda e para a direita em qualquer sítio dessa metade do ecrã. Pela cidade, o kart anda enquanto lá tiveres o polegar e para quando o levantas; na corrida anda sozinho. ', h('b', {}, 'Travar'), ' abranda, e faz marcha-atrás depois de parar. Melhor com o telemóvel deitado.'),
      h('li', { class: 'touch-only' }, h('b', {}, 'Derrapar:'), ' mantém-no numa curva; quando as faíscas ficarem azuis, e depois laranja, larga para um mini-turbo.'),
      h('li', { class: 'keys-only' }, h('b', {}, 'Voar:'), ' ', k('drive', 'fly'), ', ou 🎥 Voar pela cidade no menu, deixa o kart à espera e leva a câmara por cima da cidade e dos montes, até ao horizonte. ', k('fly', 'fwd'), ' e ', k('fly', 'back'), ' andam, ', k('fly', 'left'), ' e ', k('fly', 'right'), ' de lado, ', k('fly', 'rise'), ' sobe, ', k('fly', 'sink'), ' desce, ', k('fly', 'fast'), ' vai mais depressa, e arrastar o rato olha à volta. ', k('fly', 'fly'), ' outra vez põe o kart na rua por baixo da câmara.'),
      h('li', { class: 'keys-only' }, h('b', {}, 'A pé:'), ' ', k('drive', 'walk'), ', ou 🚶 A pé no menu, tira-te do kart, que fica à espera onde parou, e andas por Braga com os teus olhos e as tuas armas: ', k('foot', 'fwd'), k('foot', 'left'), k('foot', 'back'), k('foot', 'right'), ' anda, o rato olha e aponta, ', k('foot', 'quiet'), ' caminha devagar, ', k('foot', 'crouch'), ' agacha e ', k('foot', 'jump'), ' salta. ', k('foot', 'fire'), ' dispara e ', k('foot', 'buy'), ' abre o menu de compra, com dinheiro sem fim: aqui não magoas ninguém. ', k('foot', 'walk'), ' outra vez volta ao kart, onde ele ficou.'),
      h('li', { class: 'touch-only' }, h('b', {}, 'A pé:'), ' 🚶 A pé, lá em cima, tira-te do kart, que fica à espera onde parou, e andas por Braga com os teus olhos: o polegar esquerdo anda (e corre, se o levares até ao fim), arrastar na metade direita olha à volta, e Saltar salta. Voltar ao kart põe-te nele, onde ficou.'),
      h('li', { class: 'touch-only' }, h('b', {}, 'Voar:'), ' Voar lá em cima, ou 🎥 Voar pela cidade no menu, deixa o kart à espera e leva a câmara por cima da cidade e dos montes, até ao horizonte. O polegar esquerdo anda para onde o arrastares, arrastar na metade direita olha à volta, e ▲ Subir e ▼ Descer. Voltar ao kart põe-no na rua por baixo da câmara.'),
      h('li', {}, h('b', {}, 'Amigos:'), ' Convidar amigos dá-te uma ligação para lhes mandares; quem a abrir aparece ao teu lado, no teu mundo.'),
      h('li', {}, h('b', {}, 'Corrida:'), ` ${TRACKS.length > 1 ? 'numa das pistas' : `a ${HOME.name}`}, com toda a gente da sala e bots nos lugares vazios. O anfitrião escolhe ${TRACKS.length > 1 ? 'a pista, ' : ''}as voltas e os itens e dá a partida; no fim voltas para onde estavas.`),
      h('li', {}, h('b', {}, 'Tiroteio:'), ' a pé no Fujacal, com toda a gente da sala, como no Counter-Strike. Mata-mata, cada um por si ou em duas equipas: compras as armas que quiseres (o dinheiro não acaba), vinte armas, a faca, granadas, colete e capacete, e ficam contigo sempre que voltas; ganha quem abater mais até acabar o tempo. Ou competitivo: Terroristas contra Contraterroristas, rondas sem voltar, a bomba plantada em A ou B e desativada, o dinheiro ganho ronda a ronda e gasto na tua base, os lados trocados ao intervalo. No fim voltas ao kart, onde ficou.'),
      h('li', { class: 'keys-only' }, h('b', {}, 'No tiroteio:'), ' ', k('fight', 'fwd'), k('fight', 'left'), k('fight', 'back'), k('fight', 'right'), ' anda, o rato aponta, ', k('fight', 'fire'), ' dispara, ', k('fight', 'alt'), ' mira (com a espingarda de precisão), ', k('fight', 'reload'), ' recarrega, ', k('fight', 'scores'), ' mostra a pontuação, ', k('fight', 'slot1'), ' a ', k('fight', 'slot4'), ' escolhem a arma, ', k('fight', 'buy'), ' compra. No competitivo, mantém ', k('fight', 'use'), ' para plantar a bomba num local (A ou B) ou para a desativar, e ', k('fight', 'drop'), ' larga a arma.'),
      h('li', { class: 'touch-only' }, h('b', {}, 'No tiroteio:'), ' o polegar esquerdo anda, arrastar na metade direita aponta, Fogo dispara (e aponta, se o arrastares), Recarregar, e Mira com a espingarda de precisão. Toca na arma para a escolher.'),
      h('li', { class: 'keys-only' }, h('b', {}, 'Itens, na corrida:'), ' passa pelas caixas ?; ', k('drive', 'use'), ' usa o que te saiu (com ', k('drive', 'brake'), ' atiras para trás). Quanto mais atrás fores, melhor o que te sai.'),
      h('li', { class: 'touch-only' }, h('b', {}, 'Itens, na corrida:'), ' passa pelas caixas ? e toca no botão do item (arrasta-o para baixo para atirar para trás). Quanto mais atrás fores, melhor o que te sai.'),
      h('li', {}, h('b', {}, 'Cone de aspiração:'), ' cola-te atrás de um carro e ele puxa-te, com mais força quanto mais perto; sai para ultrapassar e a velocidade a mais vai-se em poucos segundos.'),
      h('li', { class: 'keys-only' }, k('drive', 'respawn'), ' volta à rua (na corrida, ao último ponto de controlo). ', k('drive', 'horn'), ' buzina · ', k('drive', 'camera'), ' câmara · ', k('drive', 'mute'), ' som · ', h('b', {}, 'Esc'), ' menu.'),
      h('li', { class: 'keys-only' }, h('b', {}, 'Mapa:'), ' ', k('drive', 'map'), ' abre o mapa de Braga inteiro, a conduzir, a voar, a pé, na corrida (a pista toda) e no tiroteio (a arena, só com a tua equipa): a roda do rato aproxima e afasta, arrastar mexe-o, e com o zoom aparecem os nomes das ruas. O jogo continua por baixo, com o teu kart parado. ', k('drive', 'map'), ' ou ', h('b', {}, 'Esc'), ' fecha-o. Pela cidade, um clique no mapa põe lá um destino, e outro em cima dele tira-o: o GPS leva-te pelas ruas, pelas regras do código, com o caminho a azul nos mapas, setas na estrada e a próxima viragem lá em cima. O botão direito no mapa abre «Ir para aqui»: o teu kart vai para a rua mais perto desse sítio. Na caixa lá em cima procuras uma rua, um sítio ou uma paragem pelo nome, com acentos ou sem eles: o que escolheres fica o destino. Numa sala, clica em alguém (no mapa ou na lista em baixo) e o GPS leva-te até essa pessoa, por onde ela for; e o botão direito tem «Marcar para todos», uma marca que todos na sala veem.'),
      h('li', { class: 'touch-only' }, h('b', {}, 'Mapa:'), ' toca no minimapa (ou em 🗺️ lá em cima, se o esconderes) para abrires o mapa de Braga inteiro (na corrida, a pista toda; no tiroteio, a arena, só com a tua equipa): dois dedos aproximam e afastam, arrastar mexe-o, e com o zoom aparecem os nomes das ruas. O jogo continua por baixo, com o teu kart parado. O ✕ fecha-o. Pela cidade, toca no mapa para pores lá um destino, e em cima dele para o tirares: o GPS leva-te pelas ruas, pelas regras do código, com o caminho a azul nos mapas, setas na estrada e a próxima viragem lá em cima. Mantém o dedo no mapa para «Ir para aqui»: o teu kart vai para a rua mais perto desse sítio. Na caixa lá em cima procuras uma rua, um sítio ou uma paragem pelo nome: o que escolheres fica o destino. Numa sala, toca em alguém (no mapa ou na lista em baixo) e o GPS leva-te até essa pessoa, por onde ela for; e mantendo o dedo no mapa tens «Marcar para todos», uma marca que todos na sala veem.'),
      h('li', {}, h('b', {}, '⚙️ Definições:'), ' os gráficos (a resolução, o campo de visão), o som de cada coisa, a sensibilidade do rato, a mira, e as teclas de tudo, para conduzir, voar, andar a pé e no tiroteio: muda as que quiseres.'),
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
  // The arena chosen, made now while the settings are up (half a second), not as the round starts.
  if (L.arena && !arenas.has(L.arena)) setTimeout(() => page === 'fight' && arenaFor(room?.lobby.arena ?? L.arena), 400);
  const host = r.isHost ? (r as HostRoom) : null;
  const humans = L.members.filter((m) => !m.bot).length;
  const minutes = h('select', { disabled: !host, onchange: () => host?.configure({ round: Number(minutes.value) }) }, ...[3, 5, 10].map((n) => h('option', { value: String(n), selected: n === L.round }, `${n} min`)));
  const bots = h('select', { disabled: !host, onchange: () => host?.configure({ bots: Number(bots.value) }) }, ...Array.from({ length: MAX_RACERS - humans + 1 }, (_, n) => h('option', { value: String(n), selected: n === L.bots }, String(n))));
  const skill = h('select', { disabled: !host || !L.bots, onchange: () => host?.configure({ skill: Number(skill.value) }) }, ...SKILLS.map((s, n) => h('option', { value: String(n), selected: n === L.skill }, s)));
  const where = h('select', { disabled: !host, onchange: () => host?.configure({ arena: where.value }) }, ...world.drive.d.world.arenas.map((a) => h('option', { value: a.id, selected: a.id === L.arena }, a.name)));
  const comp = L.kind === 'comp';
  const mode = h(
    'select',
    { disabled: !host, onchange: () => host?.configure(mode.value === 'comp' ? { kind: 'comp', teams: true } : { kind: 'dm', teams: mode.value === 'teams' }) },
    h('option', { value: 'ffa', selected: !comp && !L.teams }, 'Mata-mata: cada um por si'),
    h('option', { value: 'teams', selected: !comp && L.teams }, 'Mata-mata: duas equipas'),
    h('option', { value: 'comp', selected: comp }, 'Competitivo (bomba)'),
  );
  const half = h('select', { disabled: !host, onchange: () => host?.configure({ half: Number(half.value) }) }, h('option', { value: '8', selected: L.half === 8 }, 'Curta: primeiro a 9'), h('option', { value: '12', selected: L.half === 12 }, 'Completa: primeiro a 13'));
  return h(
    'div',
    { class: 'panel lobby' },
    h('h2', {}, '🎯 Tiroteio'),
    h(
      'p',
      { class: 'tag' },
      comp
        ? 'Competitivo, como no Counter-Strike 2: Terroristas contra Contraterroristas, rondas sem voltar, a bomba plantada em A ou em B e desativada, o dinheiro ganho a abater e a ganhar rondas, gasto no menu de compra no início de cada ronda, na tua base. Ao intervalo trocam de lado; ganha quem chegar primeiro a mais de metade das rondas. Bots nos lugares vazios, a jogar o mesmo.'
        : 'A pé, como no Counter-Strike, numa de três arenas pequenas no Fujacal e no Conselheiro Lobato, entre carros estacionados e obras, com portas abertas nos rés-do-chão e prédios que se sobem até ao telhado: toda a gente da sala, cada um por si ou em duas equipas, com as armas que comprar (o dinheiro não acaba), e bots nos lugares vazios. Ganha quem abater mais até acabar o tempo, e no fim cada um volta ao seu kart.',
    ),
    h('div', { class: 'room' }, h('div', {}, h('span', { class: 'label' }, 'Sala'), h('b', { class: 'code' }, L.code)), inviteButton(L.code)),
    members(r, true),
    h('div', { class: 'settings' }, h('label', { class: 'inline' }, 'Arena ', where), h('label', { class: 'inline' }, 'Modo ', mode), comp ? h('label', { class: 'inline' }, 'Partida ', half) : h('label', { class: 'inline' }, 'Duração ', minutes), h('label', { class: 'inline' }, 'Bots ', bots), h('label', { class: 'inline' }, 'Nível ', skill)),
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
          comp ? 'Começar a partida' : 'Começar o tiroteio',
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
  // In two teams, which won, by their kills together; in a match, by its rounds.
  const sums = lastMatch ? lastMatch.score : [0, 1].map((k) => list.filter((e) => e.team === k).reduce((s, e) => s + e.kills, 0));
  const mine = list.find((e) => e.id === r.you)?.team;
  const unit = lastMatch ? ' rondas' : '';
  const won = !list.some((e) => e.team !== undefined) ? '' : sums[0] === sums[1] ? `Empate, ${sums[0]} a ${sums[1]}${unit}` : `Ganhou a ${TEAMS[sums[0] > sums[1] ? 0 : 1].name}, ${Math.max(...sums)} a ${Math.min(...sums)}${unit}${mine === undefined ? '' : (sums[0] > sums[1]) === (mine === 0) ? ' — a tua!' : ''}`;
  return h(
    'div',
    { class: 'panel results' },
    h('h2', {}, lastMatch ? 'A partida acabou' : 'O tiroteio acabou'),
    won && h('p', { class: 'tag' }, won),
    h(
      'ol',
      { class: 'podium' },
      ...list.map((e, k) =>
        h(
          'li',
          { class: e.id === r.you ? 'me' : '' },
          h('span', { class: 'pos' }, String(k + 1)),
          h('span', { class: 'swatch', style: `--c:${e.team === undefined ? driverById(e.driver).color : TEAMS[e.team].color};--t:${driverById(e.driver).trim}` }),
          h('span', { class: 'who' }, e.bot ? `🤖 ${e.name}` : e.name, h('small', {}, `${e.deaths} ${e.deaths === 1 ? 'morte' : 'mortes'}${e.kills ? ` · ${Math.round((100 * (e.hs ?? 0)) / e.kills)}% na cabeça` : ''}`)),
          h('span', { class: 'time' }, `${e.kills} ${e.kills === 1 ? 'abate' : 'abates'}`),
        ),
      ),
    ),
    h('div', { class: 'row' }, r.isHost && h('button', { onclick: () => (fullScreen(), (r as HostRoom).start()) }, lastMatch ? 'Outra partida' : 'Outra ronda'), h('button', { class: 'primary', onclick: back }, 'Voltar a conduzir')),
  );
}

// The bar at the top while you drive: the menu, the room, and on a touch screen the keys Enter,
// Backspace, H, C and M as buttons.
function bar(): HTMLElement {
  const touchBtn = (label: string, title: string, onclick: () => void) => h('button', { class: 'small ghost touch-only', title, onclick }, label);
  const sound = touchBtn(isMuted() ? '🔇' : '🔊', 'Som', () => (sound.textContent = toggleMute() ? '🔇' : '🔊'));
  // On a touch screen the full map opens with a tap on the minimap; with the minimap hidden, here.
  const mapBtn = !prefs.minimap && touchBtn('🗺️', 'Mapa', openMap);
  if (race) {
    return h(
      'div',
      { class: 'bar' },
      h('span', { class: 'room-code' }, 'Sala ', h('b', {}, room?.lobby.code ?? '')),
      touchBtn('↺', 'Voltar ao último ponto de controlo', () => pad.press('respawn')),
      race.rules.mode === 'time' && touchBtn('Recomeçar volta', 'Recomeçar a volta', () => pad.press('restart')),
      touchBtn('📢', 'Buzina', () => pad.press('horn')),
      touchBtn('🎥', 'Câmara', () => pad.press('camera')),
      mapBtn,
      sound,
      wholeBtn(),
      room?.isHost ? h('button', { class: 'small ghost', onclick: () => (room as HostRoom).endNow() }, 'Acabar a corrida') : null,
      h('button', { class: 'small ghost', onclick: leave }, 'Sair'),
    );
  }
  const humans = room ? room.lobby.members.filter((m) => !m.bot).length : 0;
  // In a round: the menu, the scores and the sound; the host can end it.
  if (fight && !fight.free) {
    return h(
      'div',
      { class: 'bar' },
      h('button', { class: 'small ghost', title: 'Menu (Esc)', onclick: openMenu }, '☰ Menu'),
      h('span', { class: 'room-code' }, 'Sala ', h('b', {}, room?.lobby.code ?? '')),
      touchBtn('🛒 Armas', 'Comprar armas', () => fight && toggleBuy(fight)),
      touchBtn('Pontuação', 'Pontuação', () => fight && (fight.scores = !fight.scores)),
      mapBtn,
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
    fight?.free && touchBtn('🛒 Armas', 'Comprar armas', () => fight && toggleBuy(fight)),
    touchBtn('📢', 'Buzina', () => pad.press('horn')),
    !flying && !walking && touchBtn('🎥', 'Câmara', () => pad.press('camera')),
    mapBtn,
    sound,
    wholeBtn(),
  );
}

function render(): void {
  const panel = race ? null : results && room ? 'results' : menu ? 'menu' : null;
  // With the full map up the game goes on under it, but the keys, the mouse and the thumbs are the
  // map's, and your kart waits (or you stand) as with the menu.
  const mapping = fullMap.isOpen && !panel;
  const driving = (!!race || !!roam) && !panel && !mapping;
  const flying = !race && !!roam?.fly;
  const walking = !race && !!roam?.walk;
  keys.enabled = driving;
  keys.mode = inputMode();
  mouse.playing = driving;
  mouse.enabled = driving && flying;
  holdPage();
  // On foot, the mouse looks round with the pointer locked, and lets it go under a menu; in a round,
  // also while the kits are up to choose from, so they can be clicked.
  mouse.aim = driving && walking && !fight?.hud.buying;
  if (!mouse.aim) mouse.unlock();
  pad.show(driving ? (race ? race.rules.mode : flying ? 'fly' : fight ? 'fight' : walking ? 'walk' : 'roam') : null);
  document.body.classList.toggle('flying', flying);
  document.body.classList.toggle('walking', walking);
  document.body.classList.toggle('fighting', !!fight);
  document.body.classList.toggle('matching', !!fight?.comp);
  document.body.classList.toggle('racing', !!race);
  document.body.classList.toggle('driving', driving);
  document.body.classList.toggle('paneled', !!panel);
  document.body.classList.toggle('mapping', mapping);
  if (panel === 'results') ui.replaceChildren(resultsScreen(room!, results!));
  else if (panel === 'menu') ui.replaceChildren(menuScreen());
  else if (mapping) ui.replaceChildren();
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
    enter(await HostRoom.create(myName(), myDriver(), (x, z) => world.drive.d.inside.has(x, z)));
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
    if (inRound()) endFight();
    else endRace();
    render();
  };
  r.onHonk = (id) => {
    const m = r.lobby.members.find((x) => x.id === id);
    const k = (race?.karts ?? roam?.karts)?.get(id);
    if (m) horn(driverById(m.driver).horn, k ? 1 : 0.6, k?.model.group.position);
  };
  r.onBoard = () => {};
  r.onEv = (ev) => (ev.k === 'shot' || ev.k === 'down' || ev.k === 'nade' ? onFightEv(ev) : race?.arena.apply(ev));
  r.onComp = (s) => onComp(s);
  // The room's marks (braga-map's task 110): one put or moved by someone else is said in the feed.
  const marked = new Map<string, { x: number; z: number }>();
  r.onMarks = () => {
    for (const m of r.marks) {
      const was = marked.get(m.id);
      if (m.id !== r.you && (!was || Math.hypot(was.x - m.x, was.z - m.z) > 5) && !r.lobby.racing) feed(`🚩 ${m.name} marcou um sítio para todos`, 'big');
    }
    marked.clear();
    for (const m of r.marks) marked.set(m.id, { x: m.x, z: m.z });
  };
  if (r instanceof HostRoom) r.onCompAct = (from, a) => fight?.comp?.match?.act(from, a, performance.now());
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

// The full map (braga-map's task 106): the minimap's, with the arenas, over the game while it's open;
// what it was opened for (round the city, a race, a round), so it closes when that's over.
const fullMap = new FullMap({ ...mapLines, arenas: world.drive.d.world.arenas });
document.body.append(fullMap.el);
let mapFor: 'roam' | 'race' | 'round' | null = null;
const mapNow = () => (race ? 'race' : inRound() ? 'round' : roam ? 'roam' : null);
// The menu or the results over the world: no map then.
const paneled = () => !race && (menu || (!!results && !!room));

function openMap(): void {
  const ctx = mapNow();
  if (!ctx || paneled() || fullMap.isOpen) return;
  const w = world.drive.d.world;
  const bound = keysOf(prefs.binds, inputMode(), 'map')[0];
  const key = bound ? keyName(bound) : '';
  if (race) {
    const route = race.track.samples.filter((_, i) => i % 4 === 0).map((s) => s.p);
    fullMap.open({ title: `🏁 ${race.course.name}`, at: race.me.car.p, fit: route, route, edge: w.open.pts, key });
  } else if (roam) {
    const at = roam.walk?.p ?? roam.fly?.p ?? roam.me.car.p;
    // In a round, its arena whole; round the city, the city round you.
    const a = ctx === 'round' ? (w.arenas.find((x) => x.id === room?.lobby.arena) ?? w.arenas[0]) : null;
    if (a) fullMap.open({ title: `🎯 ${a.name}`, at, fit: a.pts.map(([x, z]) => ({ x, z })), route: [], edge: a.pts, arena: a.id, key });
    else fullMap.open({ title: '🗺️ Braga', at, route: mapLines.route, edge: w.open.pts, key, pick: true, go: mayGo(ctx, starting()) });
  }
  mapFor = ctx;
  render();
}

function closeMap(): void {
  if (!fullMap.isOpen) return;
  fullMap.close();
  mapFor = null;
  render();
  // On foot, the pointer taken back (a key can; Esc can't, and a click on the world does it then).
  mouse.lock();
}
fullMap.onClose = closeMap;

// ---- Finding a place on the full map (braga-map's task 109) ----

// The streets, landmarks, arenas and bus stops in the open world by their names; one picked is the
// GPS's waypoint, and the map goes to it.
const places = new Places({ lines: world.drive.d.world.lines, landmarks: bragaMap().landmarks, arenas: world.drive.d.world.arenas, stops: world.drive.d.world.stops, inside: (x, z) => world.drive.d.inside.has(x, z) });
fullMap.search = (q) => {
  const p = roam?.walk?.p ?? roam?.fly?.p ?? roam?.me.car.p;
  return p ? places.find(q, p) : [];
};
fullMap.onFound = (f) => {
  if (mapFor !== 'roam') return;
  setMark({ x: f.x, z: f.z });
  fullMap.centre(f.x, f.z);
  feed(`📍 ${f.name}`);
};

// ---- Meeting the others (braga-map's task 110) ----

// Round the city in a room: the friends where they are (on foot, their feet; in their karts, the
// kart), and the room's marks, each in the colour of who put it. Not in a race or a round, as the
// minimap keeps a round's foes off it.
function roomView(): RoomView | null {
  if (!room || inRound()) return null;
  const now = performance.now();
  const friends: RoomView['friends'] = [];
  for (const m of room.lobby.members) {
    if (m.bot || m.id === room.you) continue;
    const at = whereIs(m.id, room.lobby.members, room.cars, now);
    if (at) friends.push({ id: m.id, name: m.name, color: colorOf(m.id), ...at });
  }
  const marks = room.marks.map((m) => ({ ...m, color: colorOf(m.id), mine: m.id === room!.you }));
  return { friends, marks };
}

// A friend clicked on the full map, or in the list beside it: the GPS takes you to them, following
// them as they go; them again, it stops.
fullMap.onFriend = (id) => {
  if (mapFor !== 'roam' || !room) return;
  if (gps.follow === id) {
    setMark(null);
    feed(`Deixaste de seguir ${nameOf(id)}`);
    return;
  }
  const at = whereIs(id, room.lobby.members, room.cars, performance.now());
  if (!at) return;
  setMark(at);
  gps.follow = id;
  gps.name = nameOf(id);
  gps.heard = performance.now();
  feed(`🧭 A caminho de ${gps.name}`);
};
// A room's mark clicked: your waypoint there.
fullMap.onRoomMark = (m) => {
  if (mapFor !== 'roam') return;
  setMark({ x: m.x, z: m.z });
  feed(m.mine ? '📍 Destino na tua marca' : `📍 Destino na marca de ${m.name}`);
};
// Yours for everyone, or taken away: the host says who has which, and everyone's maps show it.
fullMap.shareable = () => !!room && mapNow() === 'roam' && !room.lobby.racing;
fullMap.onShare = (at) => {
  if (!fullMap.shareable()) return;
  room!.sendMark(at);
  feed(at ? '🚩 Marcaste um sítio para todos na sala' : 'Tiraste a tua marca');
};

// ---- "Ir para aqui" (braga-map's task 108) ----

// The room's lobby says a race or a round is on before this browser's has begun.
const starting = () => !!room?.lobby.racing && !race && !fight;
fullMap.goable = (x, z) => world.drive.d.inside.has(x, z);
// From the full map, round the city: your kart on the nearest street a kart can drive to there, at
// the ground's level, facing along it; on foot, you there, your kart left where it was; flying, the
// camera over it, as high over the ground as it was. The others see you go from one place to the
// other (syncOthers draws a jump of more than 30 m as one), and the GPS works its route out again.
fullMap.onGo = (at) => {
  const r = roam;
  if (!r || !mayGo(mapNow(), starting())) return;
  const yaw = r.walk?.yaw ?? r.fly?.yaw ?? r.me.car.yaw;
  if (r.fly) {
    if (!world.drive.d.inside.has(at.x, at.z)) return;
    const f = r.fly;
    const high = Math.max(10, f.height());
    f.p = v3(at.x, f.ground(at.x, at.z) + high, at.z);
    f.v = v3();
  } else {
    const c = kartTo(world.drive, at.x, at.z, yaw);
    if (!c) return;
    if (r.walk) {
      r.walk.p = v3(c.p.x, c.p.y, c.p.z);
      r.walk.v = v3();
      r.eye = r.walk.p.y + EYE;
    } else {
      r.me.car = c;
      r.me.slip = 0;
      keepWhere(c);
    }
  }
  gps.route = null;
  gps.triedAt = -Infinity;
  closeMap();
  const p = r.walk?.p ?? r.fly?.p ?? r.me.car.p;
  feed(`🚀 ${namesAt(p.x, p.z)[0] ?? 'Aqui'}`);
};

// ---- The GPS (braga-map's task 107) ----

// Round the city, a waypoint of your own put on the full map, and the route to it from where you are
// (your kart's, flying; yours, on foot) along the map's road graph, worked out again when you leave
// it: on both maps, as arrows on the street ahead, and the next turn on the screen. Not in a race or
// a round, whose own routes rule.
const router = new Router(world.drive.d.world.roads, world.drive.d.world.turns);
const arrows = new GpsArrows();
scene.add(arrows.mesh);
// Following a friend (braga-map's task 110), the waypoint is where they were when the route was last
// worked out: again every few seconds as they move, at once when they've gone 50 m.
const gps: { mark: { x: number; z: number } | null; route: Route | null; i: number; along: number; offFor: number; triedAt: number; follow: string | null; name: string; heard: number } = { mark: null, route: null, i: 0, along: 0, offFor: 0, triedAt: -Infinity, follow: null, name: '', heard: 0 };
// Off the route this far (m) for 1.5 s, it's worked out again; this near the waypoint, you're there.
const OFF_ROUTE = { car: 25, foot: 12 };
const THERE = { car: 15, foot: 6 };
const FOLLOW_EVERY = 4000;
const FOLLOW_FAR = 50;

// A waypoint of your own, or none: no longer following anyone.
function setMark(at: { x: number; z: number } | null): void {
  gps.mark = at;
  gps.route = null;
  gps.triedAt = -Infinity;
  gps.follow = null;
  if (!at) arrows.hide();
}
fullMap.onPick = (at) => {
  if (mapFor !== 'roam') return;
  setMark(at);
  feed(at ? '📍 Destino marcado' : 'Destino tirado');
};

// A frame of the GPS round the city: the route, where you are on it, the arrows and the next turn;
// what the maps show of it.
function stepGps(r: RoamCtx, now: number, dt: number): Gps | null {
  if (!gps.mark || inRound()) {
    arrows.hide();
    r.hud.guide(null);
    return null;
  }
  const travel: Travel = r.walk ? 'foot' : 'car';
  const p = r.walk?.p ?? r.me.car.p;
  // Following a friend: where they are now. Not heard of for a moment (a race's end clears everyone's
  // positions), towards where they were; gone from the room, or not heard of for 5 s, the GPS stops.
  let goal = gps.mark;
  if (gps.follow) {
    const at = room ? whereIs(gps.follow, room.lobby.members, room.cars, now) : null;
    if (at) gps.heard = now;
    else if (!room?.lobby.members.some((m) => m.id === gps.follow) || now - gps.heard > 5000) {
      feed(room?.lobby.members.some((m) => m.id === gps.follow) ? `Já não se sabe onde está ${gps.name}` : `${gps.name} já não está na sala`);
      setMark(null);
      r.hud.guide(null);
      return null;
    }
    goal = at ?? gps.mark;
    const moved = Math.hypot(goal.x - gps.mark.x, goal.z - gps.mark.z);
    if (moved > FOLLOW_FAR || (moved > THERE[travel] && now - gps.triedAt > FOLLOW_EVERY)) {
      gps.mark = goal;
      gps.route = null;
      gps.triedAt = -Infinity;
    }
  }
  // There: near the waypoint (the friend), or at the route's end while it still ends near them.
  if (Math.hypot(p.x - goal.x, p.z - goal.z) < THERE[travel] || (gps.route && gps.route.travel === travel && gps.along > gps.route.length - THERE[travel] / 2 && Math.hypot(goal.x - gps.mark.x, goal.z - gps.mark.z) < 2 * THERE[travel])) {
    feed(gps.follow ? `🏁 Chegaste ao pé de ${gps.name}` : '🏁 Chegaste ao destino', 'big');
    setMark(null);
    r.hud.guide(null);
    return null;
  }
  if (gps.route?.travel === travel) {
    const at = onRoute(gps.route, p.x, p.z, gps.i);
    gps.i = at.i;
    gps.along = at.along;
    gps.offFor = at.off > OFF_ROUTE[travel] ? gps.offFor + dt : 0;
  }
  if ((!gps.route || gps.route.travel !== travel || gps.offFor > 1.5) && now - gps.triedAt > 1000) {
    gps.triedAt = now;
    gps.route = router.route({ x: p.x, z: p.z, yaw: r.walk ? undefined : r.me.car.yaw }, gps.mark, travel);
    gps.i = 0;
    gps.along = 0;
    gps.offFor = 0;
  }
  const route = gps.route;
  if (!route) {
    arrows.hide();
    r.hud.guide({ icon: '⚠', dist: '', what: gps.follow ? `Não há caminho até ${gps.name}` : 'Não há caminho até lá', left: '' });
    return { route: null, mark: gps.mark, follow: gps.follow };
  }
  const step = nextStep(route, gps.along);
  const g = guideOf(step, step ? step.at - gps.along : 0, route.length - gps.along);
  r.hud.guide(gps.follow && !step ? { ...g, what: `Segue até ${gps.name}` } : g);
  arrows.update(route, gps.along, p.y, (x, z, y) => world.drive.floor(x, z, y + 2).y);
  return { route: [[p.x, p.z], ...route.pts.slice(gps.i + 1)], mark: gps.mark, follow: gps.follow };
}

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
  roam.hud.keys('drive', hints('drive'));
  slow.frames = slow.time = 0;
}

function stopRoam(): Car | null {
  const r = roam;
  if (!r) return null;
  // Back in the kart: a race starts from where it waits.
  if (fight?.free) endFight(false);
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
    if (r.walk && !inRound()) r.walk = alight(world.drive, c.p, c.yaw);
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
  r.hud.keys(on ? 'fly' : 'drive', hints(on ? 'fly' : 'drive'));
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
    const k = (id: string) => keyName(keysOf(prefs.binds, 'foot', id)[0] ?? '');
    r.hud.feed(pad.on ? '🚶 A pé: o polegar esquerdo anda (no fim, corre), a metade direita olha, Fogo dispara, 🛒 compra' : `🚶 A pé: ${k('fwd')}${k('left')}${k('back')}${k('right')} anda, o rato olha e aponta, ${k('fire')} dispara, ${k('buy')} compra armas; ${k('walk')} volta ao kart`, 'big');
    startFree(r);
  } else {
    if (fight?.free) endFight(false);
    r.walk = null;
    camPos.copy(camera.position);
  }
  mouse.aim = on;
  if (on) mouse.lock();
  nearPlane(on);
  r.hud.keys(on ? 'walk' : 'drive', hints(on ? 'walk' : 'drive'));
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
    walk: k.walk || p.walk,
    crouch: k.crouch || p.crouch,
  };
}

function stepRoam(r: RoamCtx, now: number, dt: number): void {
  const me = r.me;
  me.id = room?.you || 'me';
  syncOthers(r.karts, r.cars, (id) => id === me.id, true, dt);
  besideTheHost(r);
  const open = menu || !!results || fullMap.isOpen;
  // On foot, the karts and the others on foot stop you (and in a round, a bullet); in a round you fire,
  // as the trigger says, at the others as they're drawn.
  const f = fight;
  if (r.walk) {
    block = [...kartBlocks];
    kartBlock(block, me.car.p.x, me.car.p.y, me.car.p.z, me.car.yaw);
    r.walk.blockers = [...block, ...[...standing.values()].filter((a) => !a.downAt).map((a) => ({ x: a.x, z: a.z, r: 0.3, y0: a.y, y1: a.y + 1.75 }))];
  }
  const trig = f ? trigger(f, now) : null;

  for (const act of [...keys.actions(), ...pad.actions()]) {
    // On foot round the city, your guns out: back in the kart, or back on the street, as on foot.
    if (f?.free && act === 'walk') {
      walk(r, false);
      break;
    }
    if (f?.free && act === 'respawn') {
      r.walk?.respawn();
      continue;
    }
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
  const scope = zoomOf(f);
  let foot = r.walk && !open ? steps(1 / scope) : STAND;
  // A match's freeze, or planting or defusing, holds you where you are, looking round.
  const cm = f?.comp;
  const held = !!cm && (!!cm.task || (cm.s.phase === 'freeze' && cm.s.round === cm.round));
  if (f && (!f.started || !f.me.alive || held)) foot = { ...STAND, look: f.me.alive ? foot.look : { x: 0, y: 0 }, crouch: held ? foot.crouch : false };
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
        if (f && !f.free && !f.comp) respawn(f, r.walk, now);
        else if (f?.comp && arena) placeAt(r.walk, (f.comp.side === 'T' ? f.comp.s.map.t : f.comp.s.map.ct)[0] ?? arena.spawns[0]);
        else r.hud.feed('De volta à rua');
      }
      r.hop = false;
      if (f && trig) fightStep(f, r.walk, trig, now - f.goAt - r.acc * 1000);
      if (f?.squad && f.started) stepBots(f, r.walk, now - f.goAt - r.acc * 1000);
    }
  }
  // A pull the gun couldn't use in time is let go.
  if (f && f.trig.at && now - f.trig.at > PULL_KEPT) f.trig.pulls = f.trig.alts = 0;
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
  // Flying or on foot, round you, your kart a dot where it waits. In a round, nobody but you and your
  // team-mates who are up: neither map gives a foe away.
  const away = r.walk ? { x: r.walk.p.x, z: r.walk.p.z, yaw: r.walk.yaw } : r.fly ? { x: r.fly.p.x, z: r.fly.p.z, yaw: r.fly.yaw } : null;
  // The friends where they are, on foot as in their karts (braga-map's task 110), and the room's marks.
  const view = roomView();
  const others: Dot[] = [...(view?.friends ?? [])];
  if (away) others.push({ x: c.p.x, z: c.p.z, color: r.kart.model.driver.color });
  const fighters = () => [...standing.entries()].map(([id, a]) => ({ id, x: a.x, z: a.z, color: shade(id), fighting: a.fighting, down: !!a.downAt }));
  const dots = inRound() ? onTheMap(fighters(), { mate: (id) => mates(id, room?.you ?? '') }) : others;
  const here = away ?? { x: c.p.x, z: c.p.z, yaw: c.yaw };
  const way = stepGps(r, now, dt);
  r.hud.minimap(here, dots, way, view?.marks);
  fullMap.draw(here, dots, way, view);

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

// ---- The deathmatch (braga-map's task 074, after Counter-Strike 2's) ----

// The arenas as a round is played in (braga-map's task 079), each made the first time a round starts
// in it: its ground with the edge, the spawns, where the bots walk, where the railings and barriers
// stand, and its edge drawn; the one the round's in; and what's drawn for any round, the shots' marks
// and tracers, the grenades, and the weapon in your hands.
const arenas = new Map<string, { field: Field; edge: THREE.Group }>();
let arena: Field | null = null;
// The edge (and cover) of the arena the round is in, up while it lasts.
let edgeUp: THREE.Group | null = null;
let arms: { shots: ShotsView; view: Viewmodel; nades: NadesView; comp: CompView } | null = null;

// The cars the LiDAR saw parked in the arenas (braga-map's ground cover), cover in a round; fetched once
// the city's up. Every browser must make an arena alike (a shot is decided on the shooter's), so one
// made before they're in is used once and made again.
let parked: Parked[] = [];
let parkedIn = false;
if (!SCENERY) {
  setTimeout(
    () =>
      void loadParked(world.drive.d.world)
        .then((p) => (parked = p))
        .catch(() => [])
        .finally(() => (parkedIn = true)),
    2500,
  );
}

function arenaFor(id: string): { field: Field; edge: THREE.Group } {
  const w0 = world.drive.d.world;
  const area = w0.arenas.find((a) => a.id === id) ?? w0.arenas[0];
  let a = arenas.get(area.id);
  if (!a) {
    const f = field(world.drive, area, parked);
    a = { field: f, edge: buildEdge(f) };
    // Its cover (render/props.ts), shown and hidden with its edge.
    const props = buildProps(f);
    props.visible = true;
    a.edge.add(props);
    a.edge.visible = false;
    scene.add(a.edge);
    if (parkedIn) arenas.set(area.id, a);
  }
  return a;
}

// What's drawn for any fighting, made the first time: the shots, your weapon, the grenades, and a
// match's sites, bomb and guns on the ground.
function armsUp(): NonNullable<typeof arms> {
  if (!arms) {
    arms = { shots: new ShotsView(), view: new Viewmodel(scene.environment), nades: new NadesView(), comp: new CompView() };
    scene.add(arms.shots.group, arms.nades.group, arms.comp.group);
    look.overlay = arms.view.scene;
  }
  return arms;
}

// The others on foot as they're drawn this frame (syncOthers): where they stand, which way they face
// and look, how far they're crouched, whether they're armed and since when they're down, their
// footsteps, and armed, their figure.
interface Afoot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  spd: number;
  c: number;
  fighting: boolean;
  downAt: number;
  stride: number;
  fig: Fighter | null;
}
const standing = new Map<string, Afoot>();
// The karts waiting, the others' (syncOthers) and with yours this frame, as what stops someone on foot
// and a bullet.
const kartBlocks: Blocker[] = [];
let block: Blocker[] = [];

// A kart as someone on foot and a bullet meet it: its two circles, as it bumps (CAR_R and CAR_L,
// world/ground.ts), up to its roll bar.
function kartBlock(out: Blocker[], x: number, y: number, z: number, yaw: number): void {
  for (const s of [1, -1]) out.push({ x: x + Math.cos(yaw) * CAR_L * s, z: z + Math.sin(yaw) * CAR_L * s, r: CAR_R, y0: y - 0.3, y1: y + 0.9 });
}

// Whether a round (or a match) is on, rather than your guns out round the city; and the match, if
// it's one.
const inRound = () => !!fight && !fight.free;
const matchOn = () => (fight && !fight.free ? fight.comp : null);

// In a round of two teams, the team someone's on; else null. Who's the same side as whom, and the
// colour someone's drawn in (their team's, the HUD's TEAMS; in a match their side's).
const teamOf = (id: string): number | null => (room?.lobby.racing && teamed(room.lobby) ? (room.lobby.members.find((m) => m.id === id)?.team ?? null) : null);
const mates = (a: string, b: string) => {
  const t = teamOf(a);
  return t !== null && t === teamOf(b);
};
const sideOfTeam = (c: CompCtx, team: number): Side => sideOf(team, Math.max(1, c.s.round), c.s.half);
const shade = (id: string) => {
  const t = teamOf(id);
  const c = matchOn();
  if (t !== null && c) return SIDES[sideOfTeam(c, t)].color;
  return t === null ? colorOf(id) : TEAMS[t].color;
};

// The others in the round who are up, as a shot finds them: your foes, not your team-mates.
const foes = (): Body[] => [...standing.entries()].filter(([id, a]) => a.fighting && !a.downAt && !mates(id, room?.you ?? '')).map(([id, a]) => ({ id, x: a.x, y: a.y, z: a.z, yaw: a.yaw, c: a.c }));

const nameOf = (id: string) => (id === room?.you ? 'Tu' : (room?.lobby.members.find((m) => m.id === id)?.name ?? 'Alguém'));

// The loadout you last bought, kept in this browser for the next round.
function keptKit(): Loadout {
  try {
    const k = JSON.parse(stored('pk-kit', '')) as Loadout;
    const ok = (k.primary === null || isGun(k.primary)) && isGun(k.secondary) && GUNS[k.secondary].slot === 'secondary' && Array.isArray(k.nades) && k.nades.every(isNade) && [0, 1, 2].includes(k.armour);
    return ok ? { primary: k.primary, secondary: k.secondary, nades: k.nades.slice(0, 4), armour: k.armour } : START;
  } catch {
    return START;
  }
}
let lastKit: Loadout = keptKit();

// A random 32-bit seed for a shot's spread.
const seed32 = () => (Math.random() * 4294967296) >>> 0;

// A grenade on its way, worked out from its throw: its event, its flight, and how far along it its
// bounces have been heard.
interface Thrown {
  ev: NadeEv;
  fl: Flight;
  heard: number;
  done: boolean;
}

// The trigger as the frames have it: held, and a pull (and the right button's press) not yet used, from
// when. A pull is kept a moment, so a click is never lost to a frame with no step of the game in it (a
// screen faster than the game's 120 steps a second has many), nor to a gun a few milliseconds short of
// ready; a click the gun can't use by then is let go.
interface Trig {
  held: boolean;
  pulls: number;
  alt: boolean;
  alts: number;
  at: number;
}
const PULL_KEPT = 220;

// A competitive match (game/comp.ts) as this browser plays it: the host's last word on it and when it
// came, the round it has started here, your side, your defuse kit, your buys the host hasn't counted
// yet, what you're planting or defusing, the guns asked for and got, the bomb's last beep, the last
// result shown; and if you host, the match itself, when it was last sent, and the bots' doings.
interface CompCtx {
  s: CompState;
  at: number;
  round: number;
  side: Side;
  kit: boolean;
  seq: number;
  spent: { seq: number; cost: number }[];
  task: { kind: 'plant' | 'defuse'; from: number; dur: number } | null;
  asked: Map<string, number>;
  taken: Set<string>;
  beepAt: number;
  shown: string;
  boomed: boolean;
  match: Match | null;
  sentAt: number;
  bots: MatchBots | null;
  spectate: string | null;
}

// The deathmatch (braga-map's task 074): a round on foot in Fujacal, in free roam, your kart waiting
// where it was; started by the host as a race is. Or a competitive match (`comp`), or your guns out on
// foot round the city (`free`: nobody hurt, the money unlimited, the buy menu always open). You, the
// round's clock, what you come back with, the grenades up, and what's on the screen.
interface FightCtx {
  goAt: number; // performance.now() of the start: the round's clock is ms since
  endAt: number;
  free: boolean;
  comp: CompCtx | null;
  me: Soldier;
  hud: FightHud;
  kit: Loadout; // to come back with, as bought
  by: string; // who put you down last, with what, and whether in the head
  byW: Cause;
  byHead: boolean;
  fell: number; // performance.now() when you went down
  hurt: number; // how red the screen's edge is, fading
  from: { id: string; x: number; z: number; at: number }[]; // who shot you lately, from where, when (performance.now())
  center: { text: string; until: number } | null;
  lastBeep: number;
  started: boolean;
  scores: boolean; // shown, by the bar's button on a touch screen
  downs: number;
  squad: Squad | null; // the bots, if you host (braga-map's task 075)
  trig: Trig;
  // The grenades thrown, the smoke clouds and the fires up, round ms; a grenade's pin pulled (since,
  // how hard it'll go); flashed till (performance.now()) and for how long; the fire's damage owed;
  // when you last looked your gun over.
  thrown: Thrown[];
  clouds: Cloud[];
  fires: (Blaze & { owner: string })[];
  pin: { at: number; power: number } | null;
  blindUntil: number;
  blindFor: number;
  burn: number;
  burnBy: string;
  inspectAt: number;
  mags: number; // the magazine last frame, for a shotgun's shells going in
}

let fight: FightCtx | null = null;
// The last match's score and who won, for its results.
let lastMatch: { score: [number, number]; winner: number | null; half: number } | null = null;

// A fight context, new: you with a loadout, the screen for it.
function newFight(o: { goAt: number; endAt: number; free: boolean; comp: CompCtx | null; me: Soldier; squad: Squad | null; started: boolean }): FightCtx {
  const hud = new FightHud(hudRoot);
  hud.keyOf = (id) => keyName(keysOf(prefs.binds, keys.mode === 'foot' ? 'foot' : 'fight', id)[0] ?? '');
  hud.isBuyKey = (code) => keys.works(code, 'buy');
  const f: FightCtx = { ...o, hud, kit: lastKit, by: '', byW: 'knife', byHead: false, fell: 0, hurt: 0, from: [], center: null, lastBeep: 99, scores: false, downs: 0, trig: { held: false, pulls: 0, alt: false, alts: 0, at: 0 }, thrown: [], clouds: [], fires: [], pin: null, blindUntil: 0, blindFor: 1, burn: 0, burnBy: '', inspectAt: -1e9, mags: 0 };
  hud.onBuy = buy;
  hud.onBuyAsked = () => toggleBuy(fight!);
  hud.onBuyClosed = () => {
    render();
    mouse.lock();
  };
  hud.onKit = () => buyKit(f);
  return f;
}

// On foot round the city, your guns out: what you last bought in your hands, the
// buy menu yours whenever you want it, the money unlimited; your shots and grenades are seen and heard
// by the others on foot, and hurt nobody.
function startFree(r: RoamCtx): void {
  if (fight || !r.walk) return;
  armsUp();
  const now = performance.now();
  const me = new Soldier(room?.you || 'me', lastKit);
  me.arm(lastKit, 0);
  me.safeUntil = 0;
  fight = newFight({ goAt: now, endAt: Infinity, free: true, comp: null, me, squad: null, started: true });
  r.walk.fighter = speedWith(me.hand, false);
  r.hud.keys('walk', hints('walk'));
}

// The host has started a round: everyone on foot at a spawn in the arena (the grid says whose), your
// kart waiting where it was, the buy menu up till the start. In a match, the host's word on it says
// where and when.
function startFight(goIn: number, endIn: number, grid: Record<string, number>): void {
  const rm = room!;
  if (race) endRace();
  if (!roam) startRoam(before ?? startCar());
  const r = roam!;
  if (fight) endFight(false);
  menu = false;
  page = 'main';
  results = null;
  lastMatch = null;
  // Flying, the camera comes down: your kart waits where it was.
  r.fly = null;
  const comp = rm.lobby.kind === 'comp';
  const bots = rm.isHost ? rm.lobby.members.filter((m) => m.bot) : [];
  const here = arenaFor(rm.lobby.arena);
  const f = (arena = here.field);
  for (const a of arenas.values()) a.edge.visible = a === here;
  here.edge.visible = true;
  edgeUp = here.edge;
  const A = armsUp();
  A.shots.clear();
  A.nades.clear();
  A.comp.clear();
  const now = performance.now();
  // Joining a round under way: where none of the others can see.
  const s = goIn > 0 ? f.spawns[(grid[rm.you] ?? 0) % f.spawns.length] : pickSpawn(f, foes(), kartBlocks);
  const w = new Walker(f.ground, v3(s.x, s.y, s.z), s.yaw);
  w.bound = f.inside;
  w.fighter = speedWith(lastKit.primary ?? lastKit.secondary, false);
  r.walk = w;
  r.eye = w.p.y + EYE;
  r.hop = false;
  keys.mode = 'fight';
  const me = new Soldier(rm.you, comp ? startKit('CT') : lastKit);
  me.team = teamOf(rm.you) ?? 0;
  // The host's bots, each at its spawn on the grid as a player is, as good as the host chose.
  let squad: Squad | null = null;
  if (bots.length) {
    squad = new Squad(f, f.paths, rm.lobby.skill / (SKILLS.length - 1));
    squad.respawn = !comp;
    for (const m of bots) squad.add(m.id, Math.max(0, -goIn), goIn > 0 ? f.spawns[(grid[m.id] ?? 0) % f.spawns.length] : null, foes()).s.team = m.team ?? 0;
  }
  let cc: CompCtx | null = null;
  if (comp) {
    // A match starts at once: its freeze is its countdown. The host makes it, the others wait for its
    // word on it.
    const match = rm.isHost ? new Match(rm.lobby.members.map((m) => ({ id: m.id, team: m.team ?? 0 })), compMap(f), rm.lobby.half) : null;
    match?.start(now);
    const s0 = match ? match.state(now) : waitingState(compMap(f), rm.lobby.half);
    cc = { s: s0, at: now, round: 0, side: 'CT', kit: false, seq: 0, spent: [], task: null, asked: new Map(), taken: new Set(), beepAt: 0, shown: '', boomed: false, match, sentAt: 0, bots: match && squad ? new MatchBots(squad, match) : null, spectate: null };
  }
  fight = newFight({ goAt: comp ? now : now + goIn, endAt: comp ? Infinity : now + endIn, free: false, comp: cc, me, squad, started: comp || goIn <= 0 });
  const fc = fight;
  if (cc?.match) for (const b of squad?.bots ?? []) b.frozen = true;
  me.arm(comp ? startKit('CT') : lastKit, now - fc.goAt);
  if (comp) me.safeUntil = 0;
  // Before the start, the guns to choose, as Counter-Strike's deathmatch opens.
  if (!fc.started) fc.hud.buy(true, lastKit);
  r.hud.keys('fight', hints('fight'));
  const where = world.drive.d.world.arenas.find((a) => a.id === rm.lobby.arena) ?? world.drive.d.world.arenas[0];
  r.hud.setEdge(where.pts);
  const side = teamOf(rm.you);
  r.hud.feed(comp ? `🎯 Competitivo em ${where.name}: primeiro a ${rm.lobby.half + 1} rondas` : `🎯 Tiroteio em ${where.name}: ${side === null ? 'cada um por si' : `estás na ${TEAMS[side].name}`}`, 'big');
  nearPlane(true);
  (document.activeElement as HTMLElement | null)?.blur();
  render();
}

// A match's state before the host's first word on it.
function waitingState(map: CompState['map'], half: number): CompState {
  return { round: 0, phase: 'freeze', left: COMP.freeze, buyLeft: 0, score: [0, 0], half, money: {}, ack: {}, alive: [], bomb: { at: 'carried', by: null, x: 0, y: 0, z: 0, site: null }, drops: [], took: [], last: null, spawns: {}, winner: null, map };
}

// The round over (or left), or your guns put away round the city: the edge down, the grenades gone;
// and out of a round, back in your kart where it waited (`back`).
function endFight(back = true): void {
  const f = fight;
  if (!f) return;
  fight = null;
  f.hud.remove();
  if (arms) {
    arms.view.update(camera, SUN_DIR, 0, IDLE);
    arms.nades.clear();
    arms.comp.clear();
  }
  fightSfx.calm();
  pad.unscope();
  document.body.classList.remove('picking');
  if (f.free) {
    if (roam?.walk) roam.walk.fighter = null;
    return;
  }
  for (const a of arenas.values()) a.edge.visible = false;
  if (edgeUp) edgeUp.visible = false;
  for (const a of standing.values()) {
    a.fig?.fall(0, 0);
    a.fighting = false;
    a.downAt = 0;
  }
  const r = roam;
  if (!r) return;
  r.hud.setEdge(mapLines.edge);
  if (r.walk) {
    r.walk.fighter = null;
    r.walk.crouch = 0;
    if (back) walk(r, false);
  } else render();
}

// The buy menu changed what you carry: kept for the next life (and the next round), and yours now if
// you came back a moment ago. In a match, bought with your money, if you have it and the shop's open.
function buy(kit: Loadout): void {
  const f = fight;
  if (!f) return;
  const t = performance.now() - f.goAt;
  const c = f.comp;
  if (c) {
    const have = carried(f.me);
    const cost = priceOf(have, kit);
    const shop = shopOf(f, c);
    if (!shop.open || cost > shop.money || !f.me.alive) return f.hud.buy(true, have);
    const armour = f.me.armour;
    const was = f.me.hand;
    f.me.equip(kit, t);
    // The armour you had stays as worn as it was, unless you bought more.
    if (kit.armour <= have.armour) {
      f.me.armour = armour;
      f.me.helmet = have.armour === 2;
    }
    if (f.me.hand !== was) drew(f);
    spend(f, c, cost);
    f.hud.buy(true, carried(f.me));
    return;
  }
  f.kit = lastKit = kit;
  remember('pk-kit', JSON.stringify(kit));
  if (!f.free && f.started && (!f.me.alive || t - f.me.spawnAt > BUY_TIME)) return;
  const was = f.me.hand;
  f.me.equip(kit, t);
  if (f.me.hand !== was) drew(f);
}

// A defuse kit, a Counter-Terrorist's, in a match.
function buyKit(f: FightCtx): void {
  const c = f.comp;
  if (!c || c.kit || c.side !== 'CT') return;
  const shop = shopOf(f, c);
  if (!shop.open || shop.money < COMP.kit) return;
  c.kit = true;
  spend(f, c, COMP.kit);
  f.hud.setShop(shopOf(f, c));
  f.hud.buy(true, carried(f.me));
}

// Money spent in a match: told to the host, and off what the screen shows till it's counted.
function spend(f: FightCtx, c: CompCtx, cost: number): void {
  if (cost <= 0) return;
  c.seq++;
  c.spent.push({ seq: c.seq, cost });
  room?.sendComp({ k: 'buy', seq: c.seq, cost });
  fightSfx.draw('knife');
  f.hud.setShop(shopOf(f, c));
}

// Your money in a match: the host's word, less what you've spent since.
function moneyOf(c: CompCtx): number {
  const me = room?.you ?? '';
  const acked = c.s.ack[me] ?? 0;
  return Math.max(0, (c.s.money[me] ?? 0) - c.spent.filter((x) => x.seq > acked).reduce((n, x) => n + x.cost, 0));
}

// How long a match's phase has left, ms, by the host's word and the time since.
const phaseLeft = (c: CompCtx, now = performance.now()) => Math.max(0, c.s.left - (now - c.at));

// The shop in a match: your money, your side, and whether it sells now: in the buy time, alive, in
// your side's buy zone.
function shopOf(f: FightCtx, c: CompCtx): Shop {
  const w = roam?.walk;
  const now = performance.now();
  const timeLeft = c.s.buyLeft - (now - c.at);
  const zone = !!w && inBuyZone(c.s.map, c.side, w.p.x, w.p.z);
  const open = timeLeft > 0 && f.me.alive && zone && c.s.round === c.round;
  const why = !f.me.alive ? 'Estás morto: compras na próxima ronda' : timeLeft <= 0 ? 'Acabou o tempo de compra' : !zone ? 'Fora da zona de compra (volta à tua base)' : '';
  return { money: moneyOf(c), side: c.side, open, why, kit: c.kit };
}

function toggleBuy(f: FightCtx): void {
  if (f.comp) f.hud.setShop(shopOf(f, f.comp));
  f.hud.buy(!f.hud.buying, f.comp ? carried(f.me) : f.kit);
  render();
  if (!f.hud.buying) mouse.lock();
}

// Something else in your hand: its sound, and no inspecting it or throwing.
function drew(f: FightCtx): void {
  fightSfx.draw(f.me.hand);
  f.inspectAt = -1e9;
  f.pin = null;
}

function fightAction(f: FightCtx, act: string, now: number): void {
  const me = f.me;
  const t = now - f.goAt;
  if (act === 'buy') return toggleBuy(f);
  if (!f.started || !me.alive) return;
  if (act === 'reload' && me.reload(t)) fightSfx.reload(me.hand, me.gun!.reload);
  const slot = ['slot1', 'slot2', 'slot3', 'slot4'].indexOf(act);
  if (slot >= 0 && me.slot(slot + 1, t)) drew(f);
  if (act === 'last' && me.select(me.has(me.last) ? me.last : (me.primary ?? me.secondary), t)) drew(f);
  if ((act === 'next' || act === 'prev') && me.cycle(act === 'next' ? 1 : -1, t)) drew(f);
  if (act === 'inspect' && t >= me.drawnAt && !me.reloading) f.inspectAt = now;
  if (act === 'drop' && f.comp) dropSomething(f, f.comp, t);
}

// What the right button (on a touch screen, Mira) does with what's in your hand, as its label says.
const altOf = (me: Soldier): string | null => (me.gun?.scope ? 'Mira' : me.hand === 'knife' ? 'Facada' : isNade(me.hand) ? 'Lançar' : null);

// The trigger this frame, the mouse's (or whatever's bound to fire) and the thumbs': held, and the
// pulls since last read added to those still kept, as is the right button.
function trigger(f: FightCtx, now: number): Trig {
  const p = pad.fight(f.started && f.me.alive ? altOf(f.me) : null, f.me.scope > 0);
  const tr = f.trig;
  const pulls = keys.take('fire') + p.pulls;
  const alts = keys.take('alt') + p.alts;
  if (pulls || alts) tr.at = now;
  tr.pulls = Math.min(1, tr.pulls + pulls);
  tr.alts = Math.min(1, tr.alts + alts);
  tr.held = keys.held('fire') || p.trigger;
  tr.alt = keys.held('alt');
  return tr;
}

// A step of the round at its ms t: your weapon's state, a fall's hurt, and what the buttons do with
// what's in your hand: a shot, a cut, the scope, a grenade's pin and throw.
function fightStep(f: FightCtx, w: Walker, trig: Trig, t: number): void {
  const me = f.me;
  me.crouch = w.crouch > 0.5;
  me.step(DT, t);
  w.fighter = speedWith(me.hand, me.scope > 0);
  if (!f.started || !me.alive) return;
  // Coming down from more than a storey hurts, as Counter-Strike's falls do.
  if (w.landed) {
    const v = w.landed;
    w.landed = 0;
    const safe = Math.sqrt(2 * 9.81 * FALL);
    if (v > safe) hurtMe(f, { b: 0, h: 0, l: Math.round((v - safe) * 18) }, 'fall', me.id, null);
    if (v > 4) fightSfx.land(Math.min(1, v / 10));
  }
  // Frozen at a match's start, or planting or defusing: the trigger's let be.
  const c = f.comp;
  if (c && (c.task || (c.s.phase === 'freeze' && c.s.round === c.round))) return;
  const eye = v3(w.p.x, w.p.y + w.eye(), w.p.z);
  const aim = w.dir();
  // Round the city your shots go through people: nobody's hurt.
  const them = f.free ? [] : foes();
  if (me.hand === 'knife') {
    if (!trig.pulls && !trig.held && !trig.alts && !trig.alt) return;
    const heavy = (trig.alts > 0 || trig.alt) && !trig.pulls && !trig.held;
    const ev = stab(me, eye, aim, heavy, t, them, seeNow(block));
    if (!ev) return;
    trig.pulls = trig.alts = 0;
    mine(f, ev, t);
    return;
  }
  if (isNade(me.hand)) {
    // Either button pulls the pin; let go, it's thrown: overarm with the left, a lob with the right,
    // between with both.
    if (!f.pin && (trig.pulls || trig.alts) && me.ready(t)) {
      f.pin = { at: t, power: trig.pulls && (trig.alts || trig.alt) ? 0.5 : trig.pulls ? 1 : 0 };
      me.throwAt = t;
      fightSfx.nade('pin');
      trig.pulls = trig.alts = 0;
    }
    if (!f.pin) return;
    if (trig.held && trig.alt) f.pin.power = 0.5;
    if (trig.held || trig.alt || t < f.pin.at + WINDUP) return;
    const ev = toss(me, eye, aim, f.pin.power, w.v, t);
    f.pin = null;
    if (!ev) return;
    fightSfx.nade('throw');
    arms?.view.thrown();
    addThrown(f, ev);
    room?.sendEv(ev);
    return;
  }
  const g = me.gun!;
  if (trig.alts) {
    trig.alts = 0;
    if (g.scope && t >= me.drawnAt) {
      me.zoom(t);
      fightSfx.zoom(me.scope > 0);
    }
  }
  if (!trig.pulls && !(g.auto && trig.held)) return;
  if (me.mag === 0) {
    if (trig.pulls) fightSfx.dry();
    trig.pulls = 0;
    if (me.reload(t)) fightSfx.reload(me.hand, g.reload);
    return;
  }
  const ev = fire(me, eye, aim, { speed: w.speed(), air: !w.grounded }, t, them, seeNow(block), seed32());
  if (!ev) return;
  trig.pulls = 0;
  f.inspectAt = -1e9;
  mine(f, ev, t);
  if (me.mag === 0 && me.reload(t)) fightSfx.reload(me.hand, g.reload);
}

// How far the world lets a shot go where you are: the round's arena, or round the city the open
// world's ground; the karts (and whatever else is given) in it.
function seeNow(blockers: readonly Blocker[] = []): See {
  if (fight && !fight.free && arena) return seeOn(arena, blockers);
  return (o, d, max) => sight(world.drive, o, d, max, blockers);
}
const groundNow = () => (fight && !fight.free && arena ? arena.ground : world.drive);

// Your shot or cut: drawn, sent, met by the bots, and a mark at the crosshair for each hit.
function mine(f: FightCtx, ev: ShotEv, t: number): void {
  shotFx(ev, true);
  room?.sendEv(ev);
  botsShot(f, ev, t);
  for (const h of ev.hits) {
    f.hud.hit(h.h > 0, false);
    fightSfx.marker(h.h > 0, false);
  }
}

// A grenade on its way, yours or anyone's: its flight worked out on the ground it's thrown on, as
// every browser works it out, and drawn.
function addThrown(f: FightCtx, ev: NadeEv): void {
  const fl = flyNade(ev, seeNow());
  f.thrown.push({ ev, fl, heard: ev.t, done: false });
  arms?.nades.add(ev, fl);
}

// A grenade going off at round ms t: the HE grenade's blast, the flash's blinding, the smoke's cloud,
// the molotov's fire (on the ground; in the air it's lost); what it does to you, and if you host, to
// the bots.
function goOff(f: FightCtx, n: Thrown, t: number): void {
  const { ev, fl } = n;
  const at = v3(fl.at.x, fl.at.y, fl.at.z);
  const G = groundNow();
  const clearTo = (a: V, b: V) => clear(G, a, b);
  const me = f.me;
  const w = roam?.walk;
  const up = f.started && me.alive && !!w;
  if (ev.w === 'he') {
    arms?.nades.boom('he', at);
    fightSfx.nade('he', at);
    if (w && Math.hypot(w.p.x - at.x, w.p.z - at.z) < 25 && roam) roam.shake = Math.max(roam.shake, 1 - Math.hypot(w.p.x - at.x, w.p.z - at.z) / 25);
    const n2 = up ? blast(at, w!.p, clearTo) : 0;
    if (n2) hurtMe(f, { b: n2, h: 0, l: 0 }, 'he', ev.owner, at);
  } else if (ev.w === 'flash') {
    arms?.nades.boom('flash', at);
    fightSfx.nade('flash', at);
    if (up) {
      const ms = blinding(at, v3(w!.p.x, w!.p.y + w!.eye(), w!.p.z), w!.dir(), clearTo);
      if (ms > 0) {
        f.blindUntil = performance.now() + ms;
        f.blindFor = ms;
        fightSfx.ring(ms);
      }
    }
  } else if (ev.w === 'smoke') {
    const c: Cloud = { x: at.x, y: at.y, z: at.z, t0: t };
    f.clouds.push(c);
    douse(f.fires, c);
    arms?.nades.cloud(c);
    fightSfx.nade('smoke', at);
  } else if (fl.ground) {
    const b = { x: at.x, y: at.y, z: at.z, t0: t, out: t + FIRE.last, owner: ev.owner };
    // Into a smoke, it's out at once.
    for (const c of f.clouds) if (thickness(c, t) > 0.3) douse([b], c);
    f.fires.push(b);
    arms?.nades.blaze(b);
    fightSfx.nade('fire', at);
  } else fightSfx.nade('bounce', at);
  if (f.squad) for (const d of f.squad.boom(ev, fl, t, clearTo)) {
    room?.sendEv(d);
    downFx(d);
  }
}

// Back at a spawn none of your foes can see, with what you bought, whole and safe for a moment.
function respawn(f: FightCtx, w: Walker, now: number): void {
  const s = pickSpawn(arena!, foes(), block);
  placeAt(w, s);
  f.me.arm(f.kit, now - f.goAt);
  f.pin = null;
  f.blindUntil = 0;
  f.burn = 0;
  f.mags = f.me.mag;
  if (f.hud.buying) f.hud.buy(false, f.kit);
  pad.unscope();
  fightSfx.draw(f.me.hand);
  render();
}

// You, on foot, at a spawn, facing its way, still.
function placeAt(w: Walker, s: Spawn): void {
  w.p = v3(s.x, s.y, s.z);
  w.v = v3();
  w.yaw = s.yaw;
  w.pitch = 0;
  w.grounded = true;
  w.crouch = 0;
  w.landed = 0;
  if (roam) roam.eye = s.y + EYE;
}

// Once a frame in a round: the start, coming back, the grenades going off and the fires burning, and
// what's on the screen; in a match, its rounds, the bomb and the shop.
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
    f.mags = me.mag;
    if (f.hud.buying) f.hud.buy(false, f.kit);
    beep(true);
    f.center = { text: 'JÁ!', until: now + 900 };
    render();
    mouse.lock();
  }
  const c = f.comp;
  if (c) compFrame(f, c, w, now, dt);
  else if (!f.free && f.started && !me.alive && now - f.fell >= RESPAWN) respawn(f, w, now);
  // A shotgun's shells going in, one by one.
  if (me.gun?.shells && me.mag > f.mags && me.alive) fightSfx.reload(me.hand, 0);
  f.mags = me.mag;

  // The grenades: their bounces heard, and those whose time has come going off.
  for (const n of f.thrown) {
    if (n.done) continue;
    for (const b of n.fl.bounces) if (b.t > n.heard && b.t <= t) fightSfx.nade('bounce', along(n.fl, b.t), Math.min(1, b.v / 8));
    n.heard = t;
    if (t < n.fl.at.t) continue;
    n.done = true;
    goOff(f, n, t);
  }
  f.thrown = f.thrown.filter((n) => !n.done);
  f.clouds = f.clouds.filter((cl) => t - cl.t0 < CLOUD.last);
  f.fires = f.fires.filter((b) => t < Math.min(b.out, b.t0 + FIRE.last));
  fightSfx.burning(f.fires.filter((b) => burning(b, t)).map((b) => ({ x: b.x, y: b.y, z: b.z })));
  // Standing in a fire, it burns, a little at a time.
  if (f.started && me.alive) {
    for (const b of f.fires) {
      if (!inFire(b, w.p, t)) continue;
      f.burn += FIRE.dps * dt;
      f.burnBy = b.owner;
      break;
    }
    if (f.burn >= 4) {
      const n = Math.floor(f.burn);
      f.burn -= n;
      hurtMe(f, { b: n, h: 0, l: 0 }, 'molotov', f.burnBy, null);
    }
  }
  if (f.squad && f.started) {
    for (const d of f.squad.burn(f.fires, t, dt)) {
      room?.sendEv(d);
      downFx(d);
    }
  }

  f.hurt *= Math.exp(-dt * 2.5);
  f.from = f.from.filter((s) => now - s.at < FROM_FOR);
  document.body.classList.toggle('picking', f.hud.buying);

  const board = room?.board ?? [];
  const mine2 = board.find((e) => e.id === room?.you);
  const lead = board[0];
  const side = teamOf(room?.you ?? '');
  const standingText = f.free || side !== null || !mine2 ? '' : lead && lead.id !== mine2.id && lead.kills > mine2.kills ? `Tu ${mine2.kills} · 1.º ${lead.name} ${lead.kills}` : `Tu ${mine2.kills} · vais à frente`;
  const end = Math.max(0, f.endAt - now);
  const wait = Math.max(0, Math.ceil((f.started ? f.fell + RESPAWN - now : -t) / 1000));
  const g = me.gun;
  const spread = spreadOf(me, { speed: w.speed(), air: !w.grounded }, t);
  const kills = (k: number) => board.filter((e) => teamOf(e.id) === k).reduce((s, e) => s + e.kills, 0);
  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  const cv = c ? compView(f, c, w, now) : null;
  const clock = c ? compClock(c, now) : f.free ? '' : f.started ? mmss(end) : `Começa em ${left}`;
  const cross = prefs.crosshair;
  const gap = cross.dynamic ? cross.gap + (Math.tan(spread) / Math.tan((camera.fov * Math.PI) / 360)) * (innerHeight / 2) : cross.gap;
  f.hud.set({
    started: f.started,
    alive: me.alive,
    health: me.health,
    armour: me.armour,
    helmet: me.helmet,
    hand: me.hand,
    mag: me.mag,
    reserve: me.reserve,
    reloading: me.reloading && g ? clamp(1 - (me.reloadAt - t) / g.reload, 0, 1) : null,
    slots: { primary: me.primary, secondary: me.secondary, nades: me.nades },
    clock,
    standing: standingText,
    teams: side === null || c ? null : { a: kills(0), b: kills(1), mine: side as 0 | 1 },
    cross: { gap, show: f.started && me.alive && !me.scope && !(g?.family === 'sniper') },
    scope: me.alive ? me.scope : 0,
    hurt: me.alive ? Math.max(f.hurt, (1 - me.health / 100) * 0.4) : 0.6,
    from: f.from.slice(-4).map((s) => {
      const dx = s.x - w.p.x;
      const dz = s.z - w.p.z;
      const co = Math.cos(w.yaw);
      const sn = Math.sin(w.yaw);
      return { angle: Math.atan2(dz * co - dx * sn, dx * co + dz * sn), a: (FROM_FOR - (now - s.at)) / 1000 };
    }),
    flash: now < f.blindUntil ? clamp((f.blindUntil - now) / (f.blindFor * 0.5), 0, 1) : 0,
    center: !f.started && left <= 3 ? String(left) : f.center && now < f.center.until ? f.center.text : '',
    dead: f.started && !me.alive ? { by: nameOf(f.by), w: f.byW, head: f.byHead, wait: c ? -1 : wait } : null,
    buyLeft: f.free ? 99 : !f.started ? Math.ceil(BUY_TIME / 1000) : c ? Math.max(0, (c.s.buyLeft - (now - c.at)) / 1000) : me.alive ? Math.max(0, Math.ceil((BUY_TIME - (t - me.spawnAt)) / 1000)) : 0,
    scores: !f.free && (keys.scores || f.scores) ? scoreRows(board, c) : null,
    comp: cv,
    free: f.free,
  });
}

// The scores' rows: in a match each with their side (0 the Counter-Terrorists, 1 the Terrorists),
// your team-mates' money, and whether they're down.
function scoreRows(board: Entry[], c: CompCtx | null): ScoreRow[] {
  const you = room?.you ?? '';
  return board.map((e) => {
    const team = teamOf(e.id) ?? undefined;
    const row: ScoreRow = { name: e.bot ? `🤖 ${e.name}` : e.name, color: shade(e.id), kills: e.kills, deaths: e.deaths, hs: e.hs ?? 0, me: e.id === you, team };
    if (c && team !== undefined) {
      row.team = sideOfTeam(c, team) === 'CT' ? 0 : 1;
      if (mates(e.id, you) || e.id === you) row.money = e.id === you ? moneyOf(c) : (c.s.money[e.id] ?? 0);
      row.dead = !c.s.alive.includes(e.id);
    }
    return row;
  });
}

// ---- A competitive match (game/comp.ts), as this browser plays it ----

// The clock in a match: the freeze's seconds, the round's time, the bomb (its timer's not shown, as in
// Counter-Strike: its beeps say it).
function compClock(c: CompCtx, now: number): string {
  const ms = phaseLeft(c, now);
  const s = c.s;
  if (s.phase === 'planted') return '💣';
  if (s.phase === 'end') return 'Fim';
  if (s.phase === 'over') return '0:00';
  const sec = Math.ceil(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// What the screen shows of the match.
function compView(f: FightCtx, c: CompCtx, w: Walker, now: number): CompHud {
  const s = c.s;
  const you = room?.you ?? '';
  const rounds = { CT: 0, T: 0 } as Record<Side, number>;
  const alive = { CT: 0, T: 0 } as Record<Side, number>;
  for (const team of [0, 1]) rounds[sideOfTeam(c, team)] = s.score[team];
  for (const id of s.alive) {
    const t = teamOf(id);
    if (t !== null) alive[sideOfTeam(c, t)]++;
  }
  const buyLeft = Math.ceil((s.buyLeft - (now - c.at)) / 1000);
  const note =
    s.phase === 'freeze'
      ? `Ronda ${s.round} de ${s.half * 2} · compra: ${keyName(keysOf(prefs.binds, 'fight', 'buy')[0] ?? '')}`
      : s.phase === 'planted'
        ? `Bomba plantada em ${s.bomb.site}`
        : s.phase === 'over' && s.round === s.half
          ? 'Intervalo: trocam de lado'
          : s.phase === 'end'
            ? ''
            : buyLeft > 0
              ? `Ronda ${s.round} · compra ainda ${buyLeft} s`
              : `Ronda ${s.round} de ${s.half * 2}`;
  const task = c.task ? { text: c.task.kind === 'plant' ? 'A plantar a bomba…' : c.kit ? 'A desativar a bomba (com kit)…' : 'A desativar a bomba…', k: (now - c.task.from) / c.task.dur } : null;
  // What you could do here, said under the crosshair: plant, defuse, pick something up.
  const hint = !c.task && f.me.alive ? useHint(c, w) : null;
  return { rounds, alive, mine: c.side, round: s.round, total: s.half * 2, money: moneyOf(c), bomb: s.bomb.at === 'carried' && s.bomb.by === you ? 'mine' : s.bomb.at === 'planted' ? 'planted' : null, task: task ?? (hint ? { text: hint, k: 0 } : null), note, kit: c.kit };
}

// What the use key does where you stand, if anything.
function useHint(c: CompCtx, w: Walker): string | null {
  const s = c.s;
  const you = room?.you ?? '';
  const k = keyName(keysOf(prefs.binds, 'fight', 'use')[0] ?? '');
  if (s.phase === 'live' && s.bomb.at === 'carried' && s.bomb.by === you && siteAt(s.map, w.p.x, w.p.y, w.p.z)) return `Mantém ${k} para plantar a bomba`;
  if (s.phase === 'planted' && c.side === 'CT' && Math.hypot(s.bomb.x - w.p.x, s.bomb.z - w.p.z) < COMP.reach && Math.abs(s.bomb.y - w.p.y) < 1.5) return `Mantém ${k} para desativar`;
  const d = nearDrop(c, w);
  if (d && d.w !== 'c4') return `${k}: trocar por ${GUNS[d.w].name}`;
  return null;
}

// The gun on the ground nearest your feet, within reach.
function nearDrop(c: CompCtx, w: Walker): CompState['drops'][number] | null {
  let best: CompState['drops'][number] | null = null;
  let bd = 1.8;
  for (const d of c.s.drops) {
    const dd = Math.hypot(d.x - w.p.x, d.z - w.p.z);
    if (dd < bd && Math.abs(d.y - w.p.y) < 1.5) {
      bd = dd;
      best = d;
    }
  }
  return best;
}

// The host's word on the match: a new round begun here, the guns you were given, the bomb gone off,
// the round's result shown.
function onComp(s: CompState): void {
  const f = fight;
  const c = matchOn();
  if (!f || !c) return;
  const now = performance.now();
  const was = c.s;
  c.s = s;
  c.at = now;
  const acked = s.ack[room?.you ?? ''] ?? 0;
  c.spent = c.spent.filter((x) => x.seq > acked);
  if (s.round !== c.round && s.round > 0) beginRound(f, c, now);
  // What you picked up.
  const you = room?.you ?? '';
  for (const e of s.took) {
    const key = `${s.round}:${e.d}`;
    if (e.by !== you || c.taken.has(key)) continue;
    c.taken.add(key);
    if (e.w !== 'c4') giveGun(f, e.w, e.mag, e.reserve);
    else if (f.me.alive) f.center = { text: 'Apanhaste a bomba', until: now + 1400 };
  }
  // The bomb planted, gone off, defused.
  if (s.bomb.at === 'planted' && was.bomb.at !== 'planted') {
    f.center = { text: `A bomba foi plantada em ${s.bomb.site}`, until: now + 2200 };
    c.beepAt = now;
  }
  if (s.bomb.at === 'exploded' && !c.boomed) {
    c.boomed = true;
    bombBlast(f, c, s.bomb, now);
  }
  // A round won: who, and how.
  const shown = s.last ? `${s.round}:${s.last.win}:${s.last.why}:${s.phase}` : '';
  if (s.phase === 'over' && s.last && shown !== c.shown) {
    c.shown = shown;
    const win = sideOfTeam(c, s.last.win);
    const how = { elim: 'Todos eliminados', bomb: 'A bomba explodiu', defuse: 'A bomba foi desativada', time: 'Acabou o tempo' }[s.last.why];
    f.center = { text: `Ganham os ${SIDES[win].name} · ${how}${s.round === s.half ? ' · Intervalo: trocam de lado' : ''}`, until: now + COMP.after };
    if (win === c.side) lapSound(true);
    else beep(false);
    c.task = null;
  }
  if (s.phase === 'end' && was.phase !== 'end' && s.winner !== null) {
    const mine = teamOf(you);
    f.center = { text: s.winner === -1 ? `Empate, ${s.score[0]} a ${s.score[1]}` : s.winner === mine ? 'Vitória! Ganharam a partida' : 'Derrota: perderam a partida', until: now + 6000 };
    lastMatch = { score: [...s.score], winner: s.winner, half: s.half };
  }
  f.hud.setShop(shopOf(f, c));
}

// A new round here: your side, back at your spawn, whole; what you had if you lived (the guns full),
// else your side's pistol; the grenades and fires gone, frozen till the freeze is over.
function beginRound(f: FightCtx, c: CompCtx, now: number): void {
  const s = c.s;
  const w = roam?.walk;
  const you = room?.you ?? '';
  const team = teamOf(you) ?? f.me.team;
  const was = c.side;
  c.round = s.round;
  c.side = sideOf(team, s.round, s.half);
  c.task = null;
  c.boomed = false;
  c.asked.clear();
  c.spectate = null;
  const fresh = s.round === 1 || s.round === s.half + 1;
  const lived = f.me.alive && was === c.side && !fresh;
  const kit = lived ? carried(f.me) : startKit(c.side);
  if (!lived) c.kit = false;
  const spawns = c.side === 'T' ? s.map.t : s.map.ct;
  const k = s.spawns[you] ?? 0;
  if (w && spawns.length) placeAt(w, spawns[k % spawns.length]);
  const armour = f.me.armour;
  f.me.arm(kit, now - f.goAt);
  // Armour you lived with is as worn as you left it.
  if (lived) f.me.armour = armour;
  f.me.safeUntil = 0;
  f.me.team = team;
  f.started = true;
  f.pin = null;
  f.blindUntil = 0;
  f.burn = 0;
  f.thrown = [];
  f.clouds = [];
  f.fires = [];
  f.from = [];
  f.mags = f.me.mag;
  arms?.nades.clear();
  arms?.shots.clear();
  pad.unscope();
  fightSfx.calm();
  fightSfx.draw(f.me.hand);
  const msg = fresh ? (s.round === 1 ? `Ronda de pistolas · és ${SIDES[c.side].name}` : `Segunda parte · agora és ${SIDES[c.side].name}`) : s.score[0] === s.half || s.score[1] === s.half ? `Ronda ${s.round} · ponto de partida` : `Ronda ${s.round}`;
  f.center = { text: msg, until: now + 2500 };
  beep(true);
  if (f.hud.buying) f.hud.buy(true, carried(f.me));
  // Come in with the round under way: you watch till the next.
  if (!s.alive.includes(you) && s.phase !== 'freeze') {
    f.me.alive = false;
    f.fell = now - 3000;
  }
  render();
}

// A gun picked up: into its slot, as loaded as it was, in your hand.
function giveGun(f: FightCtx, g: GunId, mag: number, reserve: number): void {
  const me = f.me;
  if (!me.alive) return;
  const t = performance.now() - f.goAt;
  if (GUNS[g].slot === 'primary') {
    if (me.primary && me.primary !== g) me.rounds.delete(me.primary);
    me.primary = g;
  } else {
    if (me.secondary !== g) me.rounds.delete(me.secondary);
    me.secondary = g;
  }
  me.rounds.set(g, { mag, reserve });
  me.hand = 'knife';
  me.select(g, t);
  drew(f);
}

// The drop key: the gun in your hand thrown down in front of you (a primary; a pistol stays), or the
// bomb if you carry it and hold no gun to drop.
function dropSomething(f: FightCtx, c: CompCtx, t: number): void {
  const me = f.me;
  const w = roam?.walk;
  if (!w || !me.alive) return;
  const ahead = { x: w.p.x + Math.cos(w.yaw) * 1.1, y: w.p.y, z: w.p.z + Math.sin(w.yaw) * 1.1 };
  const fl = groundNow().floor(ahead.x, ahead.z, w.p.y + 0.6);
  const at = { x: ahead.x, y: fl.buried ? w.p.y : fl.y, z: ahead.z };
  if (me.hand === me.primary && me.primary) {
    const g = me.primary;
    const r = me.rounds.get(g) ?? { mag: 0, reserve: 0 };
    room?.sendComp({ k: 'drop', w: g, ...at, mag: r.mag, reserve: r.reserve });
    me.rounds.delete(g);
    me.primary = null;
    me.select(me.secondary, t);
    drew(f);
    // Not picked up again the moment it's down.
    c.asked.set('*', performance.now() + 1500);
  } else if (c.s.bomb.at === 'carried' && c.s.bomb.by === room?.you) {
    room?.sendComp({ k: 'drop', w: 'c4', ...at, mag: 0, reserve: 0 });
    c.asked.set('c4', performance.now() + 2500);
  }
}

// The bomb gone off: its blast seen and heard, and what it does to you, the nearer the worse; if you
// host, to the bots too.
function bombBlast(f: FightCtx, c: CompCtx, b: CompState['bomb'], now: number): void {
  const at = v3(b.x, b.y + 0.3, b.z);
  arms?.nades.boom('he', at);
  arms?.nades.boom('he', v3(b.x + 1.5, b.y + 1.5, b.z));
  arms?.nades.boom('he', v3(b.x - 1.2, b.y + 2.4, b.z + 1));
  fightSfx.blast(at);
  const w = roam?.walk;
  if (w && roam) roam.shake = Math.max(roam.shake, clamp(1 - Math.hypot(w.p.x - at.x, w.p.z - at.z) / 60, 0.2, 1));
  if (w && f.me.alive) {
    const n = blastAt(Math.hypot(w.p.x - b.x, w.p.y - b.y, w.p.z - b.z));
    if (n > 0) hurtMe(f, { b: n, h: 0, l: 0 }, 'c4', f.me.id, at);
  }
  const t = now - f.goAt;
  for (const bot of f.squad?.bots ?? []) {
    if (!bot.s.alive) continue;
    const p = bot.w.p;
    const n = blastAt(Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z));
    if (n <= 0 || !bot.s.hurt({ b: n, h: 0, l: 0 }, 'c4', t).down) continue;
    const d: DownEv = { k: 'down', id: `${bot.id}:c4${c.s.round}`, victim: bot.id, by: bot.id, w: 'c4', head: false, x: p.x, y: p.y, z: p.z };
    room?.sendEv(d);
    downFx(d);
  }
}

// Once a frame in a match: frozen through the freeze; planting, defusing and picking up as you hold
// the use key or walk over a gun; the bomb's beeps; and if you host, the match itself and its bots.
function compFrame(f: FightCtx, c: CompCtx, w: Walker, now: number, dt: number): void {
  const s = c.s;
  const me = f.me;
  const you = room?.you ?? '';
  const t = now - f.goAt;
  if (c.match) hostMatch(f, c, now);
  // The shop's state, while the menu's up.
  if (f.hud.buying) f.hud.setShop(shopOf(f, c));
  // Planting and defusing: held, standing; let go, or moved, and it's lost.
  const use = keys.held('use') || pad.using;
  const live = s.round === c.round && me.alive;
  if (c.task) {
    const done = now - c.task.from >= c.task.dur;
    const still = use && live && (c.task.kind === 'plant' ? s.phase === 'live' : s.phase === 'planted');
    if (!still) c.task = null;
    else if (done) {
      if (c.task.kind === 'plant') room?.sendComp({ k: 'plant', x: w.p.x, y: w.p.y, z: w.p.z });
      else room?.sendComp({ k: 'defuse' });
      c.task = null;
    } else if (Math.floor((now - c.task.from) / 260) !== Math.floor((now - c.task.from - dt * 1000) / 260)) fightSfx.keypad(c.task.kind === 'plant' ? undefined : s.bomb);
  } else if (use && live && w.grounded) {
    if (s.phase === 'live' && s.bomb.at === 'carried' && s.bomb.by === you && siteAt(s.map, w.p.x, w.p.y, w.p.z)) c.task = { kind: 'plant', from: now, dur: COMP.plant };
    else if (s.phase === 'planted' && c.side === 'CT' && Math.hypot(s.bomb.x - w.p.x, s.bomb.z - w.p.z) < COMP.reach && Math.abs(s.bomb.y - w.p.y) < 1.5) c.task = { kind: 'defuse', from: now, dur: c.kit ? COMP.kitDefuse : COMP.defuse };
    else if (keys.take('use') || pad.used()) {
      const d = nearDrop(c, w);
      if (d && d.w !== 'c4') askFor(c, d.id, GUNS[d.w].slot === 'primary' ? me.primary : me.secondary, me);
    }
  }
  keys.take('use');
  // Walking over the bomb (a Terrorist) or a gun whose slot is empty: picked up.
  if (live && !c.task && now > (c.asked.get('*') ?? 0)) {
    if (c.side === 'T' && s.bomb.at === 'dropped' && Math.hypot(s.bomb.x - w.p.x, s.bomb.z - w.p.z) < 1.2 && Math.abs(s.bomb.y - w.p.y) < 1.6 && now > (c.asked.get('c4') ?? 0)) {
      c.asked.set('c4', now + 1200);
      room?.sendComp({ k: 'take', id: 'c4' });
    }
    const d = nearDrop(c, w);
    if (d && d.w !== 'c4' && Math.hypot(d.x - w.p.x, d.z - w.p.z) < 1.2 && GUNS[d.w].slot === 'primary' && !me.primary) askFor(c, d.id, null, me);
  }
  // The planted bomb's beeps, faster as its time runs out.
  if (s.phase === 'planted' && s.bomb.at === 'planted') {
    const left = phaseLeft(c, now);
    const every = clamp(left / 40, 120, 1000);
    if (now - c.beepAt >= every) {
      c.beepAt = now;
      fightSfx.bomb(s.bomb, 1 - left / COMP.bomb);
    }
  }
  arms?.comp.update(s, phaseLeft(c, now), now);
  // Down, after a moment you watch a team-mate who's up (a click for the next).
  if (!me.alive && now - f.fell > 3000) {
    const up = s.alive.filter((id) => id !== you && mates(id, you) && standing.has(id));
    if (keys.take('fire') && up.length) c.spectate = up[(up.indexOf(c.spectate ?? '') + 1) % up.length];
    if (!c.spectate || !up.includes(c.spectate)) c.spectate = up[0] ?? null;
  } else c.spectate = null;
  void t;
}

// A gun on the ground asked for (and what's given for it, a gun of the same slot), once in a while.
// Yours, and the one given down in its place, when the host says so (giveGun); till then you keep it.
function askFor(c: CompCtx, id: string, give: GunId | null, me: Soldier): void {
  const now = performance.now();
  if (now < (c.asked.get(id) ?? 0)) return;
  c.asked.set(id, now + 1200);
  const r = give ? me.rounds.get(give) : null;
  room?.sendComp({ k: 'take', id, give: give && r ? { w: give, mag: r.mag, reserve: r.reserve } : undefined });
}

// If you host, once a frame: the match a step on, what happened in it done here (the bots back at their
// spawns with what they buy, the bomb's blast, the end), and its state sent when it changed (or every
// second, for the clocks).
function hostMatch(f: FightCtx, c: CompCtx, now: number): void {
  const m = c.match!;
  // Who's in it, as the room has it.
  const ids = new Set(room?.lobby.members.map((x) => x.id) ?? []);
  for (const id of m.ids()) if (!ids.has(id)) m.leave(id, now);
  for (const mb of room?.lobby.members ?? []) if (mb.team !== undefined && m.side(mb.id) === null) m.join({ id: mb.id, team: mb.team });
  m.step(now);
  for (const ev of m.events()) {
    if (ev.k === 'round') c.bots?.round(ev.fresh, now, now - f.goAt);
    if (ev.k === 'end') setTimeout(() => room?.isHost && (room as HostRoom).endNow(), 6000);
  }
  if (m.dirty || now - c.sentAt > 1000) {
    m.dirty = false;
    c.sentAt = now;
    const s = m.state(now);
    (room as HostRoom | null)?.broadcastComp(s);
    onComp(s);
  }
}

// How long the arc that says where a shot came from stays (ms), fading over its last second.
const FROM_FOR = 2500;

// What a shot looks and sounds like, yours or someone else's: the flash at the muzzle, the report
// from where it was fired, the tracers, and where each pellet no one stopped struck, its mark, a puff
// of what it struck and a smack. Where it hit someone, a tracer from the muzzle to them, a red puff
// and their figure jerked away from it, so it's plain from anywhere who shot whom; a tracer that hit
// you streaks past a metre short of your eye. A knife's cut: its swish, and what it struck.
const DUST: Record<string, string[]> = { ground: ['#b8ad99', '#8d8577'], building: ['#ddd6ca', '#b9b1a4'], roof: ['#a8553f', '#8c8c8c'], wall: ['#cfc8bb', '#9f998d'], hedge: ['#5c7a37', '#3f5a26'], tree: ['#6b5641', '#4d3d2c'], kart: ['#ffe14d', '#ffffff'], plastic: ['#e8e2d4', '#c0392b'], sand: ['#c9b48a', '#a8956c'], metal: ['#9aa0a6', '#ffffff'], wood: ['#b08455', '#7a5a38'], concrete: ['#c9c5bc', '#9b978e'], car: ['#c9d2d8', '#ffffff'] };
function shotFx(ev: ShotEv, mine: boolean): void {
  if (!arms) return;
  const knife = ev.w === 'knife';
  const quiet = isGun(ev.w) && GUNS[ev.w].silenced;
  const from = new THREE.Vector3();
  if (mine) {
    arms.view.fired(ev.w, !!ev.heavy);
    arms.view.muzzle(from);
    if (knife) fightSfx.knife(ev.hits.length ? 'hit' : 'air');
    else fightSfx.shot(ev.w);
  } else {
    const o = standing.get(ev.owner);
    if (o?.fig) {
      o.fig.fired(ev.w);
      o.fig.muzzle(from);
    } else from.set(ev.x, ev.y - 0.4, ev.z);
    if (!knife && !quiet) arms.shots.flash(from);
    if (knife) fightSfx.knife(ev.hits.length ? 'hit' : 'air', { x: ev.x, y: ev.y, z: ev.z });
    else fightSfx.shot(ev.w, { x: ev.x, y: ev.y, z: ev.z });
  }
  const you = room?.you;
  const hits = struck(ev, (id) => (id === you ? (roam?.walk?.p ?? null) : (standing.get(id) ?? null)));
  hits.forEach((s, i) => {
    const atYou = s.v === you;
    if (i < 2 && !knife && !quiet) arms!.shots.tracer(from, atYou ? addScaled(s.p, s.d, -1.2) : s.p);
    if (atYou) return;
    glow.spray(s.p, 2, ['#ff6a55', '#ffd2c4'], 2.2, 1.6, 0.15);
    for (let k = 0; k < 2; k++) smoke.add(s.p.x, s.p.y, s.p.z, s.d.x * 1.2, s.d.y * 1.2 + 0.3, s.d.z * 1.2, 0.16 + k * 0.08, k ? '#a3150d' : '#e0261a', 0);
    for (let k = 0; k < 7; k++) fx.add(s.p.x, s.p.y, s.p.z, s.d.x * 3 + (Math.random() - 0.5) * 2, s.d.y * 3 + Math.random() * 1.5, s.d.z * 3 + (Math.random() - 0.5) * 2, 0.25 + Math.random() * 0.2, k % 2 ? '#e0261a' : '#9a140c', -6);
  });
  for (const h of ev.hits) {
    const s = hits.find((x) => x.v === h.v);
    if (s && h.v !== you) standing.get(h.v)?.fig?.hit(s.d, hitTotal(h) / 40);
  }
  const traced = Math.min(2, hits.length);
  landed(ev, seeNow(block)).forEach((s, i) => {
    if (i + traced < 3 && !knife && !quiet) arms!.shots.tracer(from, s);
    if (!s.what) return;
    arms!.shots.mark(s, { x: s.nx, y: s.ny, z: s.nz });
    const c = DUST[s.what] ?? DUST.wall;
    // A small puff: a spray's dozen of them on one wall mustn't make a cloud of it.
    for (let k = 0; k < (knife ? 1 : 3); k++) smoke.add(s.x + s.nx * 0.05, s.y + s.ny * 0.05, s.z + s.nz * 0.05, s.nx * 1.2 + (Math.random() - 0.5) * 0.6, s.ny * 1.2 + Math.random() * 0.6, s.nz * 1.2 + (Math.random() - 0.5) * 0.6, 0.18 + Math.random() * 0.17, c[k % 2], -1.5);
    for (let k = 0; k < 4; k++) fx.add(s.x, s.y, s.z, s.nx * 2.5 + (Math.random() - 0.5) * 2, s.ny * 2.5 + Math.random() * 1.5, s.nz * 2.5 + (Math.random() - 0.5) * 2, 0.06 + Math.random() * 0.05, c[1], -9);
    if (s.what !== 'hedge' && s.what !== 'tree' && s.what !== 'wood') glow.spray(s, 4, ['#ffd98a', '#ffffff'], 3, 2, 0.15);
    if (i === 0) {
      if (knife) fightSfx.knife('wall', s);
      else fightSfx.impact(s);
    }
  });
}

// Something from someone else in the round: a shot (and it hit you, by the shooter's say), a grenade
// thrown, or someone put down. Round the city, a shot or a grenade only seen and heard.
function onFightEv(ev: FightEv): void {
  const f = fight;
  if (!f) return;
  if (ev.k === 'down') return f.free ? undefined : downFx(ev);
  if (ev.owner === room?.you) return;
  if (ev.k === 'nade') return addThrown(f, ev);
  shotFx(ev, false);
  if (f.free) return;
  for (const h of ev.hits) if (h.v === f.me.id) hurtMe(f, h, ev.w, ev.owner, { x: ev.x, z: ev.z });
  botsShot(f, ev, performance.now() - f.goAt);
}

// The host's bots, a step of the round at its ms t (braga-map's task 075): they look for the players as
// this browser draws them, and for you where you are, and shoot and throw as you do; each shot goes to
// everyone, as yours does, and what it hit is decided here, as yours is in your browser.
function stepBots(f: FightCtx, w: Walker, t: number): void {
  const squad = f.squad!;
  f.comp?.bots?.step(t, performance.now());
  const players: Mark[] = [...standing.entries()].filter(([id, a]) => a.fighting && !a.downAt && !squad.bots.some((b) => b.id === id)).map(([id, a]) => ({ id, x: a.x, y: a.y, z: a.z, spd: a.spd, yaw: a.yaw, c: a.c, team: teamOf(id) ?? undefined }));
  if (f.me.alive && f.started) players.push({ id: f.me.id, x: w.p.x, y: w.p.y, z: w.p.z, spd: w.speed(), yaw: w.yaw, c: w.crouch, team: teamOf(f.me.id) ?? undefined });
  for (const ev of squad.step(DT, t, players, block, { clouds: f.clouds, fires: f.fires })) {
    room?.sendEv(ev);
    if (ev.k === 'nade') {
      addThrown(f, ev);
      continue;
    }
    if (ev.k !== 'shot') continue;
    shotFx(ev, false);
    for (const h of ev.hits) if (h.v === f.me.id) hurtMe(f, h, ev.w, ev.owner, { x: ev.x, z: ev.z });
    botsShot(f, ev, t);
  }
}

// A shot, anyone's, as the host's bots meet it: heard, and those it hit hurt; one put down, everyone
// told, as a player's browser tells them. In a match, with the gun it drops.
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

// Hurt by a hit (each part's damage before your armour), with a weapon, by someone, from somewhere
// (or nowhere to point at: a fall, a fire): the red, the arc, the flinch; and down, everyone told (in a
// match, with the gun you drop). Round the city nothing hurts.
function hurtMe(f: FightCtx, h: Pick<Hit, 'b' | 'h' | 'l'>, w: Cause, by: string, from: { x: number; z: number } | null): void {
  if (f.free) return;
  const me = f.me;
  const now = performance.now();
  const g = me.primary ?? me.secondary;
  const rounds = me.rounds.get(g);
  const { lost, down } = me.hurt(h, w, now - f.goAt);
  if (!lost) return;
  f.hurt = Math.min(1, f.hurt + 0.3 + lost / 100);
  if (from && by !== me.id) f.from = [...f.from.filter((s) => s.id !== by), { id: by, x: from.x, z: from.z, at: now }];
  fightSfx.hurt(h.h > 0);
  if (roam) roam.shake = Math.max(roam.shake, 0.25 + lost / 120);
  if (!down) return;
  const p = roam?.walk?.p ?? v3();
  const d: DownEv = { k: 'down', id: `${me.id}:d${++f.downs}`, victim: me.id, by, w, head: h.h > 0, x: p.x, y: p.y, z: p.z };
  if (f.comp && g && rounds) d.drop = { w: g, mag: rounds.mag, reserve: rounds.reserve };
  f.fell = now;
  f.by = by;
  f.byW = w;
  f.byHead = d.head;
  f.pin = null;
  if (f.comp) f.comp.task = null;
  pad.unscope();
  room?.sendEv(d);
  downFx(d);
  render();
}

// Someone down: in the kill feed, and for whoever did it, the word; in a match, the host's Match told.
function downFx(ev: DownEv): void {
  const f = fight;
  if (!f) return;
  const me = room?.you;
  const self = ev.by === ev.victim;
  const m = f.comp?.match;
  if (m) {
    const b = ev.drop ? null : f.squad?.bots.find((x) => x.id === ev.victim);
    if (b) ev.drop = dropOf(b.s);
    m.down(ev, performance.now());
  }
  f.hud.kill({ by: self ? '' : nameOf(ev.by), byColor: shade(ev.by), victim: nameOf(ev.victim), victimColor: shade(ev.victim), w: ev.w, head: ev.head, mine: ev.by === me || ev.victim === me });
  if (ev.by === me && !self) {
    fightSfx.down();
    f.hud.hit(ev.head, true);
    f.center = { text: `Eliminaste ${nameOf(ev.victim)}${ev.head ? ' com um tiro na cabeça' : ''}${f.comp ? ` · +${killReward(ev.w)} €` : ''}`, until: performance.now() + 1600 };
  }
}

// The gun a fighter drops as it's put down in a match: its primary, else its pistol, as loaded as it is.
function dropOf(s: Soldier): DownEv['drop'] {
  const g = s.primary ?? s.secondary;
  const r = s.rounds.get(g);
  return r ? { w: g, mag: r.mag, reserve: r.reserve } : undefined;
}

// How many times the scope narrows your view, 1 without.
function zoomOf(f: FightCtx | null): number {
  const g = f?.me.alive ? f.me.gun : null;
  return g?.scope && f!.me.scope ? g.scope.zooms[f!.me.scope - 1] : 1;
}

// What your hands hold when there's nothing to show.
const IDLE: HandState = { hand: null, draw: 1, reload: null, speed: 0, grounded: true, crouch: 0, scope: 0, punch: { x: 0, y: 0 }, pin: false, inspect: false, walk: false };

// Your weapon in your hands this frame, as the round has it; planting or defusing, none.
function hands(f: FightCtx, w: Walker, now: number): HandState {
  const me = f.me;
  const t = now - f.goAt;
  if (!f.started || !me.alive || f.comp?.task) return IDLE;
  const g = me.gun;
  return {
    hand: me.hand,
    draw: clamp(1 - (me.drawnAt - t) / drawOf(me.hand), 0, 1),
    reload: me.reloading && g ? clamp(1 - (me.reloadAt - t) / g.reload, 0, 1) : null,
    speed: w.speed(),
    grounded: w.grounded,
    crouch: w.crouch,
    scope: me.scope,
    punch: me.punch,
    pin: !!f.pin,
    inspect: now - f.inspectAt < 2600,
    walk: w.speed() < speedWith(me.hand, false) * 0.6,
  };
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
    hud: new Hud(hudRoot, track, rules.mode === 'race', keysText(prefs.binds, 'drive', 'map')),
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
    if (!m || snaps.length === 0 || (roaming && m.bot && !inRound())) continue;
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
        cars.set(id, { id, name: m.name, P: 0, x: b.kx, y: b.ky, z: b.kz, yaw: b.kw, vx: 0, vz: 0, flags: 0, fin });
        pose(k.model.group, b.kx, b.ky, b.kz, b.kw, { x: b.ux, y: b.uy, z: b.uz });
        k.model.update(0, 0, dt, true, 0);
        kartBlock(kartBlocks, b.kx, b.ky, b.kz, b.kw);
      }
      // In a round: as a fighter, the weapon in their hands, crouched or not, down, falling and
      // fading; out of one, the driver they picked, walking. Their footsteps when they run (walking,
      // as crouched, is quiet, as in Counter-Strike).
      const fl = fighterOf(b.fl);
      const armed = !!fl?.armed;
      if (!k.walker) {
        k.walker = buildWalker(driverById(m.driver));
        scene.add(k.walker.group);
      }
      k.walker.group.visible = !armed;
      if (armed && !k.fighter) {
        k.fighter = buildFighter(driverById(m.driver));
        scene.add(k.fighter.group);
      }
      if (k.fighter) k.fighter.group.visible = armed;
      let s = standing.get(id);
      if (!s) standing.set(id, (s = { x, y, z, yaw, pitch: 0, spd: 0, c: 0, fighting: false, downAt: 0, stride: 0, fig: null }));
      s.c = clamp(s.c + (fl?.crouch ? dt : -dt) / 0.16, 0, 1);
      Object.assign(s, { x, y, z, yaw, pitch: L(a.pi, b.pi), spd: b.spd, fighting: armed, fig: armed ? k.fighter : null });
      s.downAt = armed && fl!.down ? s.downAt || now : 0;
      const since = s.downAt ? now - s.downAt : 0;
      if (armed) {
        const fig = k.fighter!;
        fig.group.position.set(x, y, z);
        fig.group.rotation.y = -yaw;
        fig.update(dt, { speed: b.spd, pitch: L(a.pi, b.pi), crouch: s.c, hand: fl!.down ? null : fl!.weapon, scoped: fl!.scoped, reloading: fl!.reloading, grounded: !!b.g, team: teamOf(id) });
        fig.fall(s.downAt ? Math.min(1, since / 450) : 0, s.downAt ? clamp((since - 2500) / 800, 0, 1) : 0);
      } else {
        k.walker.group.position.set(x, y, z);
        k.walker.group.rotation.y = -yaw;
        k.walker.update(b.spd, dt, L(a.pi, b.pi));
      }
      if (b.g && b.spd > (armed ? 2.9 : 0.6) && !s.downAt) {
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
      cars.set(id, { id, name: m.name, P: L(a.P, b.P), x, y, z, yaw, vx: Math.cos(b.yaw) * b.spd, vz: Math.sin(b.yaw) * b.spd, flags: b.fl, fin });
      pose(k.model.group, x, y, z, yaw, { x: L(a.ux, b.ux), y: L(a.uy, b.uy), z: L(a.uz, b.uz) });
      k.model.update(b.spd, b.st, dt, !!b.g, b.fl);
      kartEffects(id, k, x, y, z, yaw, Math.abs(b.spd), b.fl, !!b.g, dt);
      if (k.walker) k.walker.group.visible = false;
      if (k.fighter) k.fighter.group.visible = false;
    }
    // Their name over them, in the kart or on foot; but in a round, where it would say where they are
    // through the walls, none.
    const over = foot ? (k.fighter?.group.visible ? k.fighter.group : k.walker!.group) : k.model.group;
    if (k.tag && k.tag.parent !== over) {
      over.add(k.tag);
      k.tag.position.y = foot ? 2.2 : 2.6;
    }
    if (k.tag) k.tag.visible = !inRound() || mates(id, room!.you);
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
    if (r.timeUp || fullMap.isOpen) ctl = { ...NO_CONTROLS, ...stopInput(me.car) };
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
  if (fullMap.isOpen)
    fullMap.draw(
      { x: me.car.p.x, z: me.car.p.z, yaw: me.car.yaw },
      [...a.cars.values()].filter((o) => o.id !== me.id).map((o) => ({ x: o.x, z: o.z, color: colorOf(o.id) })),
    );
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

// Behind your kart, or close behind it, framing it as the karts are drawn (2.8 m long since braga-map's
// task 105, the camera brought in with them).
function chase(r: Driving, dt: number): void {
  if (VIEW && VIEW.length >= 6) {
    holdView(VIEW);
    return;
  }
  const c = r.me.car;
  const close = r.cam === 1;
  const f = new THREE.Vector3(Math.cos(c.yaw), 0, Math.sin(c.yaw));
  const spd = speedOf(c);
  const dist = close ? 3.4 : 5.3 + spd * 0.032;
  const want = new THREE.Vector3(c.p.x, c.p.y, c.p.z).addScaledVector(f, -dist).add(new THREE.Vector3(0, close ? 1.4 : 2.25, 0));
  want.y = Math.max(want.y, world.ground(want.x, want.z) + 1.2);
  // Somewhere else altogether (the game opening, a friend's side): straight there.
  if (camPos.distanceTo(want) > 150) camPos.copy(want);
  camPos.lerp(want, 1 - Math.exp(-dt * (close ? 14 : 8)));
  camLook.set(c.p.x, c.p.y + 0.9, c.p.z).addScaledVector(f, 3.5);
  camera.position.copy(camPos);
  if (!prefs.shake) r.shake = 0;
  if (r.shake > 0.01) {
    const s = r.shake * 0.35;
    camera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    r.shake *= Math.exp(-dt * 6);
  }
  camera.lookAt(camLook);
  widen(66 + prefs.driveFov + Math.min(20, spd * 0.32) + (c.boost > 0 ? 6 : 0) + r.me.slip * 4, dt);
}

// With the menu open: the camera turns slowly round your kart, which stands on the right of the
// screen, clear of the menu.
function orbit(c: Car, t: number, dt: number): void {
  if (VIEW && VIEW.length >= 6) {
    holdView(VIEW);
    return;
  }
  const ang = c.yaw + Math.PI * 0.8 + Math.sin(t * 0.2) * 0.6;
  const want = new THREE.Vector3(c.p.x + Math.cos(ang) * 5.3, c.p.y + 1.8, c.p.z + Math.sin(ang) * 5.3);
  want.y = Math.max(want.y, world.ground(want.x, want.z) + 1.2);
  if (camPos.distanceTo(want) > 150) camPos.copy(want);
  camPos.lerp(want, 1 - Math.exp(-dt * 2.5));
  camera.position.copy(camPos);
  const toKart = new THREE.Vector3(c.p.x - camPos.x, 0, c.p.z - camPos.z).normalize();
  camera.lookAt(c.p.x + toKart.z * 1.7, c.p.y + 0.8, c.p.z - toKart.x * 1.7);
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
// rather than jumping, and never bobbing. ?view= still holds it. In a round, it ducks as you crouch,
// a spray's recoil kicks it up (by less than the bullets go: Counter-Strike's view punch), through a
// scope it narrows, and put down, it drops to the ground, rolling over.
function walkCam(r: RoamCtx, w: Walker, dt: number): void {
  if (VIEW && VIEW.length >= 6) {
    holdView(VIEW);
    return;
  }
  const f = fight;
  const down = !!f && f.started && !f.me.alive;
  // Down in a match, watching a team-mate: from their eyes, the way they look.
  const spec = f?.comp?.spectate ? standing.get(f.comp.spectate) : null;
  if (spec) {
    const ey = spec.y + EYE - spec.c * 0.45;
    const cp = Math.cos(spec.pitch);
    camera.position.set(spec.x, ey, spec.z);
    camera.lookAt(spec.x + Math.cos(spec.yaw) * cp, ey + Math.sin(spec.pitch), spec.z + Math.sin(spec.yaw) * cp);
    camPos.copy(camera.position);
    widen(prefs.fov, dt, 18);
    return;
  }
  const want = w.p.y + (down ? 0.35 : w.eye());
  // Crouching, it goes down with you at once; up a kerb or a tread, it eases.
  const ducking = f && Math.abs(want - r.eye) < 0.6 && w.grounded && w.crouch > 0 && w.crouch < 1;
  r.eye = (Math.abs(want - r.eye) > 2 && !down) || ducking ? want : r.eye + (want - r.eye) * (1 - Math.exp(-dt / (down ? 0.15 : 0.07)));
  const d = w.dir();
  camera.position.set(w.p.x, r.eye, w.p.z);
  camera.lookAt(w.p.x + d.x, r.eye + d.y, w.p.z + d.z);
  if (f && f.me.alive && (f.me.punch.x || f.me.punch.y)) {
    camera.rotateY((-f.me.punch.x * PUNCH * Math.PI) / 180);
    camera.rotateX((f.me.punch.y * PUNCH * Math.PI) / 180);
  }
  if (down) {
    // Put down, the camera on the ground, rolling over; then turning to whoever did it, if they're
    // still there to see, as Counter-Strike's death camera does.
    const since = performance.now() - f.fell;
    const k = standing.get(f.by);
    if (k && since > 900) {
      const turn = Math.min(1, (since - 900) / 600);
      const at = new THREE.Vector3(k.x, k.y + 1.4, k.z);
      const ahead2 = camera.position.clone().add(new THREE.Vector3(d.x, d.y, d.z));
      camera.lookAt(ahead2.lerp(at, turn));
    }
    camera.rotateZ(0.7 * Math.min(1, since / 500) * (k && since > 900 ? 1 - Math.min(1, (since - 900) / 600) * 0.8 : 1));
  }
  if (!prefs.shake) r.shake = 0;
  if (r.shake > 0.01) {
    camera.rotateX((Math.random() - 0.5) * r.shake * 0.04);
    r.shake *= Math.exp(-dt * 8);
  }
  camPos.copy(camera.position);
  const zoom = zoomOf(f);
  widen(prefs.fov / zoom, dt, f ? 18 : 4);
}

// How much of a spray's kick the view shows: the bullets go further, so the crosshair isn't where they
// land, and a player learns to pull down.
const PUNCH = 0.45;

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
  if ((!race && !roam) || quality === 'low' || AUTODRIVE || !prefs.autoQuality || fullMap.isOpen) return;
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
  keys.mode = inputMode();
  // The full map closes when what it was opened for is over: a race or a round starting or ending.
  if (mapFor && mapFor !== mapNow()) closeMap();
  // The GPS's arrows are round the city's only.
  if (!roam) arrows.hide();

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
    if (AUTODRIVE) (window as unknown as { __kart: object }).__kart = { mode: 'race', map: fullMap.isOpen, track: race.course.id, driver: race.kart.driver, x: race.me.car.p.x, y: race.me.car.p.y, z: race.me.car.p.z, idx: race.me.car.idx, lap: race.me.run.laps, fin: race.me.fin, item: race.me.item?.kind ?? null, place: race.arena.rankOf(race.me.id), cars: race.arena.cars.size, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, audio: { ...readMeter(), record: recordState(), played, city: cityHeard } };
  } else if (roam) {
    const r = roam;
    stepRoam(r, now, dt);
    if (r.walk) walkCam(r, r.walk, dt);
    else if (r.fly) flyCam(r.fly, dt);
    else if (menu || results) orbit(r.me.car, t, dt);
    else chase(r, dt);
    // Your gun, once the camera's set; the shots' tracers and flashes.
    if (arms) {
      const f = fight;
      arms.view.update(camera, SUN_DIR, dt, f && r.walk ? hands(f, r.walk, now) : IDLE);
      arms.shots.update(dt);
      arms.nades.update(f ? now - f.goAt : 0, dt, camera);
    }
    fitTags(r.karts.values());
    look.follow(r.walk ? r.walk.p : r.fly ? lookedAt(r.fly) : r.me.car.p);
    if (AUTODRIVE) {
      const c = r.me.car;
      const d = camera.getWorldDirection(new THREE.Vector3());
      (window as unknown as { __kart: object }).__kart = {
        mode: 'roam',
        map: fullMap.isOpen,
        muted: isMuted(),
        gps: gps.mark ? { mark: gps.mark, follow: gps.follow, route: gps.route ? { travel: gps.route.travel, length: Math.round(gps.route.length), along: Math.round(gps.along), steps: gps.route.steps.length, next: nextStep(gps.route, gps.along) } : null } : null,
        marks: room?.marks ?? [],
        you: room?.you ?? null,
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
        fight: fight ? { started: fight.started, alive: fight.me.alive, health: fight.me.health, armour: fight.me.armour, hand: fight.me.hand, mag: fight.me.mag, reserve: fight.me.reserve, scope: fight.me.scope, crouch: roam?.walk?.crouch ?? 0, kit: fight.kit, buying: fight.hud.buying, team: teamOf(fight.me.id), kills: room?.board.find((e) => e.id === room?.you)?.kills ?? 0, deaths: room?.board.find((e) => e.id === room?.you)?.deaths ?? 0, foes: foes(), nades: fight.thrown.length, clouds: fight.clouds.length, fires: fight.fires.length, bots: fight.squad?.bots.map((b) => ({ id: b.id, x: b.w.p.x, y: b.w.p.y, z: b.w.p.z, alive: b.s.alive, health: b.s.health, hand: b.s.hand, shots: b.shots, stuck: b.stuck })) ?? null, free: fight.free, shots: fight.me.shots, comp: fight.comp ? { round: fight.comp.s.round, phase: fight.comp.s.phase, side: fight.comp.side, money: moneyOf(fight.comp), score: fight.comp.s.score, bomb: fight.comp.s.bomb, alive: fight.comp.s.alive, drops: fight.comp.s.drops, primary: fight.me.primary, secondary: fight.me.secondary, sites: fight.comp.s.map.sites, spawns: { t: fight.comp.s.map.t, ct: fight.comp.s.map.ct }, plants: fight.comp.bots?.plants ?? 0, defuses: fight.comp.bots?.defuses ?? 0 } : null } : null,
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
  // Under the full map nothing of the city shows: it's left undrawn while the map is up.
  if (!fullMap.isOpen) look.render(t);
  if (prefs.fps) {
    fpsCount.frames++;
    if (now - fpsCount.since > 500) {
      fpsEl.textContent = `${Math.round((fpsCount.frames * 1000) / (now - fpsCount.since))} fps`;
      fpsCount.frames = 0;
      fpsCount.since = now;
    }
  }
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
  // The GPS's waypoint at (x, z), or none, as a click on the full map puts it (braga-map's task 107).
  (window as unknown as { __mark: object }).__mark = (x?: number, z?: number) => setMark(x === undefined || z === undefined ? null : { x, z });
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
  if (keys.capturing || capturing()) return;
  if (!e.repeat && keys.works(e.code, 'mute') && !(e.target instanceof HTMLInputElement)) {
    toggleMute();
    if (page === 'settings' && menu) render();
  }
  // The full map's key opens it and closes it; Esc closes it too, before it's the menu's. (Typing in
  // its search box never gets here: the box keeps its keys.)
  if (fullMap.isOpen && (e.code === 'Escape' || (!e.repeat && keys.works(e.code, 'map')))) {
    e.preventDefault();
    return closeMap();
  }
  if (!e.repeat && keys.works(e.code, 'map') && !(e.target instanceof HTMLElement && e.target.closest('input, select, textarea'))) {
    e.preventDefault();
    return openMap();
  }
  // Esc opens the menu over the world, and closes it (or the results, or goes back from the race's
  // settings).
  // On foot, the Esc that let the pointer go has opened the menu already (mouse.onLost).
  if (e.code === 'Escape' && roam && !race && performance.now() - mouse.lostAt > 500) {
    e.preventDefault();
    if (results) results = null;
    else if (menu && (page === 'race' || page === 'settings')) page = 'main';
    else if (menu) return closeMenu();
    else menu = true;
    render();
  }
});
// On foot, the browser letting the pointer go (Esc, or another window) opens the menu.
mouse.onLost = () => {
  if (roam?.walk && !race && !menu && !results && !fullMap.isOpen) openMenu();
};
// On a touch screen a tap on the minimap opens the full map (with a mouse, a click on it), before the
// steering half under it takes the finger.
addEventListener(
  'pointerdown',
  (e) => {
    if (mouse.locked || fullMap.isOpen || paneled() || !(race || roam)) return;
    const b = hudRoot.querySelector('.minimap')?.getBoundingClientRect();
    if (!b?.width || e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) return;
    e.preventDefault();
    e.stopPropagation();
    openMap();
  },
  true,
);
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
