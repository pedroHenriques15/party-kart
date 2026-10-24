// The controls, each to the keys (and mouse buttons) that work it, for each way of playing: driving
// (round the city and in a race), flying the camera, on foot round the city, and in a round on foot.
// Every one can be changed in the settings (settings.ts keeps what's changed); these are the defaults.
// A key is a KeyboardEvent's `code` (the key's place on the keyboard, whatever its layout prints on
// it), or one of the mouse's: Mouse0 the left button, Mouse1 the middle, Mouse2 the right, Mouse3 and
// Mouse4 the side ones, WheelUp and WheelDown.

export type Mode = 'drive' | 'fly' | 'foot' | 'fight';

// A control held (read every step: a pedal, a direction, the trigger) or pressed (counted once a
// press: the horn, a reload). A held one is counted as pressed too, for a click shorter than a frame.
export interface Control {
  id: string;
  label: string;
  held: boolean;
  keys: string[];
}

const hold = (id: string, label: string, ...keys: string[]): Control => ({ id, label, held: true, keys });
const press = (id: string, label: string, ...keys: string[]): Control => ({ id, label, held: false, keys });

// Walking about, the same on foot round the city and in a round.
const FEET: Control[] = [
  hold('fwd', 'Em frente', 'KeyW', 'ArrowUp'),
  hold('back', 'Para trás', 'KeyS', 'ArrowDown'),
  hold('left', 'Para a esquerda', 'KeyA'),
  hold('right', 'Para a direita', 'KeyD'),
  hold('turnLeft', 'Rodar para a esquerda', 'ArrowLeft'),
  hold('turnRight', 'Rodar para a direita', 'ArrowRight'),
  hold('quiet', 'Caminhar (devagar e em silêncio)', 'ShiftLeft', 'ShiftRight'),
  hold('crouch', 'Agachar', 'ControlLeft', 'ControlRight', 'KeyC'),
  hold('jump', 'Saltar', 'Space'),
];
// And the weapons.
const ARMS: Control[] = [
  hold('fire', 'Disparar', 'Mouse0'),
  hold('alt', 'Mira · facada · lançar a granada', 'Mouse2'),
  press('reload', 'Recarregar', 'KeyR'),
  press('slot1', 'Arma principal', 'Digit1'),
  press('slot2', 'Pistola', 'Digit2'),
  press('slot3', 'Faca', 'Digit3'),
  press('slot4', 'Granadas', 'Digit4', 'Digit5'),
  press('last', 'A arma de antes', 'KeyQ'),
  press('next', 'A arma seguinte', 'WheelDown'),
  press('prev', 'A arma anterior', 'WheelUp'),
  press('buy', 'Comprar armas', 'KeyB'),
];
// The full map (braga-map's task 106), and the sound, the same keys whichever way you play.
const MAP = press('map', 'Mapa (abre e fecha)', 'KeyM');
const MUTE = press('mute', 'Som ligado ou desligado', 'KeyN');

export const CONTROLS: Record<Mode, Control[]> = {
  drive: [
    hold('throttle', 'Acelerar', 'ArrowUp', 'KeyW'),
    hold('brake', 'Travar e marcha-atrás (na corrida, com o item: atirar para trás)', 'ArrowDown', 'KeyS'),
    hold('steerLeft', 'Virar à esquerda', 'ArrowLeft', 'KeyA'),
    hold('steerRight', 'Virar à direita', 'ArrowRight', 'KeyD'),
    hold('drift', 'Derrapar', 'Space'),
    press('use', 'Usar o item (na corrida)', 'KeyE', 'ShiftLeft', 'ShiftRight', 'KeyQ'),
    press('respawn', 'Voltar à rua (na corrida, ao último ponto de controlo)', 'Enter', 'NumpadEnter'),
    press('restart', 'Recomeçar a volta (no contrarrelógio)', 'Backspace', 'Delete'),
    press('horn', 'Buzina', 'KeyH'),
    press('camera', 'Câmara', 'KeyC'),
    press('fly', 'Voar pela cidade', 'KeyV'),
    press('walk', 'Sair do kart e andar a pé', 'KeyF'),
    MAP,
    MUTE,
  ],
  fly: [
    hold('fwd', 'Em frente', 'KeyW', 'ArrowUp'),
    hold('back', 'Para trás', 'KeyS', 'ArrowDown'),
    hold('left', 'Para a esquerda', 'KeyA'),
    hold('right', 'Para a direita', 'KeyD'),
    hold('turnLeft', 'Rodar para a esquerda', 'ArrowLeft'),
    hold('turnRight', 'Rodar para a direita', 'ArrowRight'),
    hold('rise', 'Subir', 'KeyE'),
    hold('sink', 'Descer', 'KeyQ'),
    hold('fast', 'Mais depressa', 'ShiftLeft', 'ShiftRight'),
    press('fly', 'Voltar ao kart', 'KeyV'),
    MAP,
    MUTE,
  ],
  foot: [...FEET, ...ARMS, press('inspect', 'Inspecionar a arma', 'KeyG'), press('respawn', 'Voltar à rua', 'Enter', 'NumpadEnter'), press('walk', 'Voltar ao kart', 'KeyF'), MAP, MUTE],
  fight: [
    ...FEET,
    ...ARMS,
    press('inspect', 'Inspecionar a arma', 'KeyF'),
    hold('use', 'Plantar · desativar · apanhar (competitivo)', 'KeyE'),
    press('drop', 'Largar a arma (competitivo)', 'KeyG'),
    hold('scores', 'Pontuação', 'Tab'),
    MAP,
    MUTE,
  ],
};

export const MODE_NAMES: Record<Mode, string> = { drive: 'Conduzir', fly: 'Voar', foot: 'A pé', fight: 'Tiroteio' };

// What's changed from the defaults: for a mode, a control's keys.
export type Binds = Partial<Record<Mode, Record<string, string[]>>>;

// The keys a control has, as changed or by default. A default key the player has given another
// control of the mode is that control's alone: a key kept from before the defaults changed (M, the
// sound's until the full map took it) keeps doing what the player bound it to.
export function keysOf(b: Binds, mode: Mode, id: string): string[] {
  const mine = b[mode]?.[id];
  if (mine) return mine;
  const theirs = new Set(Object.values(b[mode] ?? {}).flat());
  return (CONTROLS[mode].find((c) => c.id === id)?.keys ?? []).filter((k) => !theirs.has(k));
}

// The keys the browser keeps (full screen, its tools) and the menu's: never a control's.
export const RESERVED = new Set(['Escape', 'F11', 'F12']);

// Only what's there and makes sense, from what was kept: the modes and controls there are, a key a
// short string, none reserved, none twice.
export function cleanBinds(raw: unknown): Binds {
  const out: Binds = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const mode of Object.keys(CONTROLS) as Mode[]) {
    const m = (raw as Record<string, unknown>)[mode];
    if (!m || typeof m !== 'object') continue;
    for (const c of CONTROLS[mode]) {
      const keys = (m as Record<string, unknown>)[c.id];
      if (!Array.isArray(keys)) continue;
      const ok = [...new Set(keys.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length < 24 && !RESERVED.has(k)))].slice(0, 6);
      (out[mode] ??= {})[c.id] = ok;
    }
  }
  return out;
}

// What a key is called on the screen. Letters and digits as the keyboard's layout prints them, where
// the browser says (Chrome and Edge, `layout`); else as a US keyboard's.
let layout: Map<string, string> | null = null;
export function learnLayout(): void {
  const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
  kb?.getLayoutMap?.()
    .then((m) => (layout = m))
    .catch(() => {});
}

const NAMES: Record<string, string> = {
  Space: 'Espaço',
  Enter: 'Enter',
  NumpadEnter: 'Enter (num.)',
  Backspace: '⌫',
  Delete: 'Del',
  Tab: 'Tab',
  CapsLock: 'Caps',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift dir.',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl dir.',
  AltLeft: 'Alt',
  AltRight: 'AltGr',
  MetaLeft: '⊞',
  MetaRight: '⊞ dir.',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Insert: 'Ins',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Mouse0: 'Clique',
  Mouse1: 'Botão do meio',
  Mouse2: 'Botão direito',
  Mouse3: 'Botão lateral 1',
  Mouse4: 'Botão lateral 2',
  WheelUp: 'Roda ↑',
  WheelDown: 'Roda ↓',
  Backquote: 'º',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: 'Ç',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  IntlBackslash: '<',
};

export function keyName(code: string): string {
  // The layout's map has only the keys that write something: letters, digits and punctuation.
  const printed = layout?.get(code);
  if (printed && printed.trim()) return printed.toUpperCase();
  if (NAMES[code]) return NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

// A control's keys as the help says them: "W ou ↑".
export function keysText(b: Binds, mode: Mode, id: string): string {
  const k = keysOf(b, mode, id);
  return k.length ? k.map(keyName).join(' ou ') : '—';
}
