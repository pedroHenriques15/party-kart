// The player's settings, kept in this browser (localStorage's `pk-settings`): the graphics beyond
// their quality (which has a key of its own, `pk-quality`), the sound's levels, the mouse and the
// touch screen, the crosshair, what the screen shows, and the controls' keys (binds.ts). Whatever's
// missing or wrong in what was kept is the default.
import { cleanBinds, type Binds } from './binds.ts';

export interface Crosshair {
  color: string;
  len: number; // each line's length, px
  thick: number; // px
  gap: number; // px from the middle, standing still
  dot: boolean;
  outline: boolean;
  dynamic: boolean; // opening as the next shot would spread
  alpha: number; // 0.2 to 1
}

export interface Prefs {
  // The graphics: steps down by itself when slow; the resolution, as a share of the screen's; the
  // field of view on foot (degrees, vertical) and how much more or less driving; the camera's shake.
  autoQuality: boolean;
  scale: number;
  fov: number;
  driveFov: number;
  shake: boolean;
  // The sound: all of it, and each part of it (0 to 1).
  volume: number;
  engines: number;
  effects: number;
  city: number;
  music: number;
  // The mouse: how fast it turns your head (1 the game's own), through a scope, upside down; a
  // finger's drag on a touch screen.
  sens: number;
  scopeSens: number;
  invert: boolean;
  touchSens: number;
  crosshair: Crosshair;
  // What's on the screen: the keys' line at the bottom, the frames a second, the minimap.
  hints: boolean;
  fps: boolean;
  minimap: boolean;
  binds: Binds;
}

export const CROSS_COLOURS: [string, string][] = [
  ['#5bff7a', 'Verde'],
  ['#ffffff', 'Branco'],
  ['#ffe24a', 'Amarelo'],
  ['#4ae3ff', 'Ciano'],
  ['#ff4a8d', 'Rosa'],
  ['#ff4a3d', 'Vermelho'],
];

export const DEFAULTS: Prefs = {
  autoQuality: true,
  scale: 1,
  fov: 72,
  driveFov: 0,
  shake: true,
  volume: 0.8,
  engines: 1,
  effects: 1,
  city: 1,
  music: 1,
  sens: 1,
  scopeSens: 1,
  invert: false,
  touchSens: 1,
  crosshair: { color: '#5bff7a', len: 8, thick: 2, gap: 4, dot: false, outline: true, dynamic: true, alpha: 1 },
  hints: true,
  fps: false,
  minimap: true,
  binds: {},
};

const KEY = 'pk-settings';

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

// Only what makes sense, the rest the default.
export function cleanPrefs(raw: unknown): Prefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULTS;
  const c = (r.crosshair && typeof r.crosshair === 'object' ? r.crosshair : {}) as Record<string, unknown>;
  const dc = d.crosshair;
  return {
    autoQuality: bool(r.autoQuality, d.autoQuality),
    scale: num(r.scale, 0.5, 1, d.scale),
    fov: num(r.fov, 55, 100, d.fov),
    driveFov: num(r.driveFov, -15, 20, d.driveFov),
    shake: bool(r.shake, d.shake),
    volume: num(r.volume, 0, 1, d.volume),
    engines: num(r.engines, 0, 1, d.engines),
    effects: num(r.effects, 0, 1, d.effects),
    city: num(r.city, 0, 1, d.city),
    music: num(r.music, 0, 1, d.music),
    sens: num(r.sens, 0.1, 5, d.sens),
    scopeSens: num(r.scopeSens, 0.2, 2, d.scopeSens),
    invert: bool(r.invert, d.invert),
    touchSens: num(r.touchSens, 0.2, 3, d.touchSens),
    crosshair: {
      color: typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : dc.color,
      len: num(c.len, 2, 20, dc.len),
      thick: num(c.thick, 1, 6, dc.thick),
      gap: num(c.gap, 0, 20, dc.gap),
      dot: bool(c.dot, dc.dot),
      outline: bool(c.outline, dc.outline),
      dynamic: bool(c.dynamic, dc.dynamic),
      alpha: num(c.alpha, 0.2, 1, dc.alpha),
    },
    hints: bool(r.hints, d.hints),
    fps: bool(r.fps, d.fps),
    minimap: bool(r.minimap, d.minimap),
    binds: cleanBinds(r.binds),
  };
}

export function loadPrefs(): Prefs {
  try {
    return cleanPrefs(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return cleanPrefs({});
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private window */
  }
}
