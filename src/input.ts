// The keyboard. Actions (respawn, restart, horn, camera) are counted presses, read once.
const KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  drift: ['Space'],
};
const ACTIONS: Record<string, 'respawn' | 'restart' | 'horn' | 'camera' | 'use'> = {
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
type Action = (typeof ACTIONS)[string];

export class Keyboard {
  private down = new Set<string>();
  private pending: Action[] = [];
  enabled = false;

  constructor() {
    const game = new Set([...Object.values(KEYS).flat(), ...Object.keys(ACTIONS)]);
    addEventListener('keydown', (e) => {
      if (!this.enabled || (e.target instanceof HTMLElement && e.target.closest('input, select, textarea'))) return;
      if (!game.has(e.code)) return;
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

  controls(): { throttle: number; brake: number; steer: number; drift: boolean } {
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
