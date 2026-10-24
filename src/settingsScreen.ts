// The settings, from the menu's "⚙️ Definições": the graphics, the sound, the mouse and the crosshair,
// what the screen shows, and the controls, each control's keys for each way of playing (binds.ts),
// changed by pressing the key (or the mouse's button) wanted. Every change is made and kept at once.
import { CONTROLS, keyName, keysOf, MODE_NAMES, RESERVED, type Mode } from './binds.ts';
import { CROSS_COLOURS, DEFAULTS, type Crosshair, type Prefs } from './prefs.ts';
import { GRAPHICS, type Graphics } from './render/look.ts';

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

// What the screen needs from the game: the settings and the quality as they are, a change to either
// (made and kept), whether the sound's off and turning it on or off, the keys while one is waited for,
// and going back to the menu.
export interface SettingsHost {
  prefs: Prefs;
  quality: Graphics;
  ultra: boolean; // whether this device is offered Ultra (a PC: braga-map's task 081)
  setQuality(q: Graphics): void;
  changed(p: Prefs): void;
  muted(): boolean;
  toggleMute(): void;
  capture(on: boolean): void;
  back(): void;
}

export type SettingsTab = 'graphics' | 'sound' | 'mouse' | 'screen' | 'keys';
const TABS: [SettingsTab, string][] = [
  ['graphics', 'Gráficos'],
  ['sound', 'Som'],
  ['mouse', 'Rato e mira'],
  ['screen', 'Ecrã'],
  ['keys', 'Controlos'],
];

// Which tab and which way of playing's keys were open, for the next time the screen is drawn.
const at: { tab: SettingsTab; mode: Mode } = { tab: 'graphics', mode: 'fight' };

// The screen, drawn again (by `redraw`) after anything that changes what it shows.
export function settingsScreen(host: SettingsHost, redraw: () => void): HTMLElement {
  const p = host.prefs;
  const set = (change: Partial<Prefs>) => host.changed({ ...host.prefs, ...change });
  const cross = (change: Partial<Crosshair>) => set({ crosshair: { ...host.prefs.crosshair, ...change } });

  // A slider, its value beside it as `show` says it.
  const slider = (label: string, value: number, lo: number, hi: number, step: number, show: (v: number) => string, onset: (v: number) => void) => {
    const out = h('output', {}, show(value));
    const input = h('input', {
      type: 'range',
      min: String(lo),
      max: String(hi),
      step: String(step),
      value: String(value),
      oninput: () => {
        out.textContent = show(Number(input.value));
        onset(Number(input.value));
      },
    });
    return h('label', { class: 'pref' }, h('span', { class: 'pl' }, label), input, out);
  };
  const toggle = (label: string, value: boolean, onset: (v: boolean) => void, note = '') => {
    const c = h('input', { type: 'checkbox', checked: value, onchange: () => onset(c.checked) });
    return h('label', { class: 'pref check' }, c, h('span', { class: 'pl' }, label, note && h('small', {}, note)));
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  let body: HTMLElement;
  if (at.tab === 'graphics') {
    const q = h(
      'select',
      { onchange: () => host.setQuality(q.value as Graphics) },
      ...GRAPHICS.filter((v) => v !== 'ultra' || host.ultra || host.quality === 'ultra').map((v) => h('option', { value: v, selected: v === host.quality }, { ultra: 'Ultra', high: 'Alta', medium: 'Média', low: 'Baixa' }[v])),
    );
    body = h(
      'div',
      { class: 'prefs' },
      h('label', { class: 'pref' }, h('span', { class: 'pl' }, 'Qualidade'), q, h('output', {}, '')),
      toggle('Baixar a qualidade sozinho quando o jogo vai lento', p.autoQuality, (autoQuality) => set({ autoQuality })),
      slider('Resolução', p.scale, 0.5, 1, 0.05, pct, (scale) => set({ scale })),
      slider('Campo de visão a pé', p.fov, 55, 100, 1, (v) => `${v}°`, (fov) => set({ fov })),
      slider('Campo de visão a conduzir', p.driveFov, -15, 20, 1, (v) => (v > 0 ? `+${v}°` : v < 0 ? `${v}°` : 'normal'), (driveFov) => set({ driveFov })),
      toggle('Abanar a câmara (pancadas, explosões, tiros)', p.shake, (shake) => set({ shake })),
    );
  } else if (at.tab === 'sound') {
    body = h(
      'div',
      { class: 'prefs' },
      toggle('Som ligado', !host.muted(), () => (host.toggleMute(), redraw()), keysOf(p.binds, 'drive', 'mute').length ? `(${keyName(keysOf(p.binds, 'drive', 'mute')[0])} liga e desliga)` : ''),
      slider('Volume geral', p.volume, 0, 1, 0.05, pct, (volume) => set({ volume })),
      slider('Motores', p.engines, 0, 1, 0.05, pct, (engines) => set({ engines })),
      slider('Efeitos e armas', p.effects, 0, 1, 0.05, pct, (effects) => set({ effects })),
      slider('A cidade à volta', p.city, 0, 1, 0.05, pct, (city) => set({ city })),
      slider('Música e avisos', p.music, 0, 1, 0.05, pct, (music) => set({ music })),
    );
  } else if (at.tab === 'mouse') {
    const c = p.crosshair;
    const preview = h('div', { class: 'cross-preview' }, h('div', { class: 'cross on', style: `--gap:${c.gap}px` }, h('i'), h('i'), h('i'), h('i')));
    body = h(
      'div',
      { class: 'prefs' },
      h('p', { class: 'sect' }, 'Rato'),
      slider('Sensibilidade', p.sens, 0.1, 5, 0.05, (v) => v.toFixed(2), (sens) => set({ sens })),
      slider('Sensibilidade com a mira', p.scopeSens, 0.2, 2, 0.05, (v) => v.toFixed(2), (scopeSens) => set({ scopeSens })),
      toggle('Inverter o eixo vertical', p.invert, (invert) => set({ invert })),
      slider('Sensibilidade no ecrã tátil', p.touchSens, 0.2, 3, 0.05, (v) => v.toFixed(2), (touchSens) => set({ touchSens })),
      h('p', { class: 'sect' }, 'Mira'),
      preview,
      h(
        'div',
        { class: 'pref swatches' },
        h('span', { class: 'pl' }, 'Cor'),
        h(
          'div',
          { class: 'row wrap' },
          ...CROSS_COLOURS.map(([col, name]) => h('button', { class: `swatch-btn${c.color === col ? ' on' : ''}`, title: name, style: `--c:${col}`, onclick: () => (cross({ color: col }), redraw()) }, name)),
        ),
      ),
      slider('Comprimento', c.len, 2, 20, 1, (v) => `${v} px`, (len) => cross({ len })),
      slider('Espessura', c.thick, 1, 6, 1, (v) => `${v} px`, (thick) => cross({ thick })),
      slider('Intervalo', c.gap, 0, 20, 1, (v) => `${v} px`, (gap) => (cross({ gap }), preview.firstElementChild!.setAttribute('style', `--gap:${gap}px`))),
      slider('Opacidade', c.alpha, 0.2, 1, 0.05, pct, (alpha) => cross({ alpha })),
      toggle('Ponto no meio', c.dot, (dot) => cross({ dot })),
      toggle('Contorno escuro', c.outline, (outline) => cross({ outline })),
      toggle('Abre com a dispersão dos tiros', c.dynamic, (dynamic) => cross({ dynamic }), 'como no Counter-Strike'),
      h('div', { class: 'row' }, h('button', { class: 'ghost small', onclick: () => (set({ crosshair: { ...DEFAULTS.crosshair } }), redraw()) }, 'Repor a mira')),
    );
  } else if (at.tab === 'screen') {
    body = h(
      'div',
      { class: 'prefs' },
      toggle('Mostrar as teclas em baixo', p.hints, (hints) => set({ hints })),
      toggle('Mostrar o minimapa', p.minimap, (minimap) => set({ minimap })),
      toggle('Mostrar as imagens por segundo', p.fps, (fps) => set({ fps })),
    );
  } else body = keysTab(host, redraw);

  return h(
    'div',
    { class: 'panel menu prefs-panel' },
    h('button', { class: 'ghost small close', title: 'Voltar ao menu (Esc)', onclick: () => host.back() }, '✕'),
    h('h2', {}, '⚙️ Definições'),
    h('nav', { class: 'tabs' }, ...TABS.map(([id, name]) => h('button', { class: `tab${at.tab === id ? ' on' : ''}`, onclick: () => ((at.tab = id), redraw()) }, name))),
    body,
    h('div', { class: 'row foot' }, h('button', { class: 'ghost', onclick: () => host.back() }, '← Voltar'), h('small', { class: 'saved' }, 'Guardado neste browser')),
  );
}

// The keys: a way of playing at a time, each control with its keys (✕ unbinds one) and + to bind
// another, by pressing it. A key another control of the same mode had is taken from it, and said so.
let waiting: { mode: Mode; id: string } | null = null;
let said = '';

function keysTab(host: SettingsHost, redraw: () => void): HTMLElement {
  const p = host.prefs;
  const mode = at.mode;
  const setKeys = (id: string, keys: string[], m: Mode = mode) => {
    const b = { ...host.prefs.binds, [m]: { ...(host.prefs.binds[m] ?? {}), [id]: keys } };
    host.prefs = { ...host.prefs, binds: b };
    host.changed(host.prefs);
  };
  // The next key or button, for the control waited on; Esc gives up.
  const listen = (id: string) => {
    waiting = { mode, id };
    said = '';
    host.capture(true);
    const done = (code: string | null) => {
      removeEventListener('keydown', onKey, true);
      removeEventListener('mousedown', onMouse, true);
      removeEventListener('wheel', onWheel, true);
      // The mousedown that bound a button would click what's under it; its click is swallowed too.
      setTimeout(() => {
        removeEventListener('click', swallow, true);
        removeEventListener('contextmenu', swallow, true);
      }, 300);
      waiting = null;
      host.capture(false);
      if (code && !RESERVED.has(code)) {
        // Taken from whichever other control of this mode had it.
        for (const c of CONTROLS[mode]) {
          const ks = keysOf(host.prefs.binds, mode, c.id);
          if (c.id !== id && ks.includes(code)) {
            setKeys(
              c.id,
              ks.filter((k) => k !== code),
            );
            said = `${keyName(code)} deixou de ser «${c.label}».`;
          }
        }
        const mine = keysOf(host.prefs.binds, mode, id);
        if (!mine.includes(code)) setKeys(id, [...mine, code]);
      }
      redraw();
    };
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      done(e.code === 'Escape' ? null : e.code);
    };
    const onMouse = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      addEventListener('click', swallow, true);
      addEventListener('contextmenu', swallow, true);
      done(`Mouse${e.button}`);
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.deltaY) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      done(e.deltaY > 0 ? 'WheelDown' : 'WheelUp');
    };
    // From the next event on: not the click that asked.
    setTimeout(() => {
      addEventListener('keydown', onKey, true);
      addEventListener('mousedown', onMouse, true);
      addEventListener('wheel', onWheel, { capture: true, passive: false });
    }, 0);
    redraw();
  };

  const rows = CONTROLS[mode].map((c) => {
    const keys = keysOf(p.binds, mode, c.id);
    const asking = waiting?.mode === mode && waiting.id === c.id;
    return h(
      'div',
      { class: `bind${asking ? ' asking' : ''}` },
      h('span', { class: 'bl' }, c.label),
      h(
        'span',
        { class: 'bk' },
        ...keys.map((k) =>
          h(
            'span',
            { class: 'kchip' },
            keyName(k),
            h(
              'button',
              {
                class: 'kx',
                title: 'Tirar esta tecla',
                onclick: () => {
                  setKeys(
                    c.id,
                    keys.filter((x) => x !== k),
                  );
                  redraw();
                },
              },
              '✕',
            ),
          ),
        ),
        asking ? h('span', { class: 'kchip wait' }, 'Prime uma tecla ou um botão do rato… (Esc cancela)') : h('button', { class: 'kadd', title: 'Juntar uma tecla', onclick: () => listen(c.id) }, '+'),
      ),
    );
  });
  const resetMode = () => {
    const b = { ...host.prefs.binds };
    delete b[mode];
    host.prefs = { ...host.prefs, binds: b };
    host.changed(host.prefs);
    said = `As teclas de «${MODE_NAMES[mode]}» voltaram às de origem.`;
    redraw();
  };
  const resetAll = () => {
    host.prefs = { ...host.prefs, binds: {} };
    host.changed(host.prefs);
    said = 'Todas as teclas voltaram às de origem.';
    redraw();
  };
  return h(
    'div',
    { class: 'prefs keymap' },
    h('nav', { class: 'tabs sub' }, ...(Object.keys(CONTROLS) as Mode[]).map((m) => h('button', { class: `tab${m === mode ? ' on' : ''}`, onclick: () => ((at.mode = m), (said = ''), redraw()) }, MODE_NAMES[m]))),
    h('p', { class: 'note' }, mode === 'fight' ? 'Num tiroteio, a mata-mata ou competitivo.' : mode === 'foot' ? 'Fora do kart, pela cidade, com as armas que comprares.' : mode === 'fly' ? 'A câmara a voar por cima da cidade.' : 'Pela cidade e nas corridas.', ' Esc abre sempre o menu.'),
    said && h('p', { class: 'note said' }, said),
    h('div', { class: 'binds' }, ...rows),
    h('div', { class: 'row wrap' }, h('button', { class: 'ghost small', onclick: resetMode }, `Repor «${MODE_NAMES[mode]}»`), h('button', { class: 'ghost small', onclick: resetAll }, 'Repor todas as teclas')),
  );
}

// Whether a key is waited for: Esc then is the settings', not the menu's.
export const capturing = () => !!waiting;
