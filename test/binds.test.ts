import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanBinds, CONTROLS, keyName, keysOf, type Mode } from '../src/binds.ts';
import { cleanPrefs, DEFAULTS } from '../src/prefs.ts';

// The controls' keys (binds.ts) and the settings they're kept in (prefs.ts).
test("every way of playing's controls: a key each, none bound twice in a mode, none the browser's", () => {
  for (const mode of Object.keys(CONTROLS) as Mode[]) {
    const ids = new Set<string>();
    const seen = new Map<string, string>();
    for (const c of CONTROLS[mode]) {
      assert.ok(!ids.has(c.id), `${mode}: ${c.id} twice`);
      ids.add(c.id);
      assert.ok(c.keys.length > 0, `${mode}: ${c.id} has no key`);
      for (const k of c.keys) {
        assert.ok(!['Escape', 'F11', 'F12'].includes(k), `${mode}: ${k}`);
        assert.ok(!seen.has(k), `${mode}: ${k} is both ${seen.get(k)} and ${c.id}`);
        seen.set(k, c.id);
      }
    }
  }
  // As Counter-Strike's: the left button fires, R reloads, B buys, E plants and defuses.
  assert.deepEqual(keysOf({}, 'fight', 'fire'), ['Mouse0']);
  assert.deepEqual(keysOf({}, 'fight', 'reload'), ['KeyR']);
  assert.deepEqual(keysOf({}, 'fight', 'buy'), ['KeyB']);
  assert.deepEqual(keysOf({}, 'fight', 'use'), ['KeyE']);
});

test('M opens the full map and N turns the sound on and off, whichever way you play; a key the player bound keeps its control', () => {
  for (const mode of Object.keys(CONTROLS) as Mode[]) {
    assert.deepEqual(keysOf({}, mode, 'map'), ['KeyM'], mode);
    assert.deepEqual(keysOf({}, mode, 'mute'), ['KeyN'], mode);
  }
  // Someone who bound the sound to M before it was the map's keeps it there, and the map has no key
  // in that way of playing till they give it one; in the others it's M.
  const kept = cleanBinds({ drive: { mute: ['KeyM'] } });
  assert.deepEqual(keysOf(kept, 'drive', 'mute'), ['KeyM']);
  assert.deepEqual(keysOf(kept, 'drive', 'map'), []);
  assert.deepEqual(keysOf(kept, 'fly', 'map'), ['KeyM']);
  // And someone who had given N to another control keeps it for that one.
  const horn = cleanBinds({ drive: { horn: ['KeyN'] } });
  assert.deepEqual(keysOf(horn, 'drive', 'horn'), ['KeyN']);
  assert.deepEqual(keysOf(horn, 'drive', 'mute'), []);
  assert.deepEqual(keysOf(horn, 'drive', 'map'), ['KeyM']);
});

test("the keys as changed: only modes and controls there are, a key once, the browser's never", () => {
  const b = cleanBinds({ fight: { fire: ['Mouse0', 'Mouse0', 'KeyK', 'Escape', 42], nope: ['KeyZ'] }, flying: { fwd: ['KeyI'] }, drive: { horn: 'KeyH' } });
  assert.deepEqual(b, { fight: { fire: ['Mouse0', 'KeyK'] } });
  assert.deepEqual(keysOf(b, 'fight', 'fire'), ['Mouse0', 'KeyK']);
  assert.deepEqual(keysOf(b, 'fight', 'reload'), ['KeyR']);
  // A control left with no key at all stays so: the player took them off.
  assert.deepEqual(keysOf(cleanBinds({ drive: { horn: [] } }), 'drive', 'horn'), []);
  assert.equal(keyName('KeyW'), 'W');
  assert.equal(keyName('Digit4'), '4');
  assert.equal(keyName('Space'), 'Espaço');
  assert.equal(keyName('Mouse2'), 'Botão direito');
  assert.equal(keyName('WheelDown'), 'Roda ↓');
});

test('the settings kept: the defaults for whatever is missing or wrong', () => {
  assert.deepEqual(cleanPrefs(null), DEFAULTS);
  const p = cleanPrefs({ sens: 99, fov: 30, volume: 0.3, crosshair: { color: 'red', len: 12, dot: true }, binds: { foot: { buy: ['KeyN'] } }, fps: 'yes' });
  assert.equal(p.sens, 5);
  assert.equal(p.fov, 55);
  assert.equal(p.volume, 0.3);
  assert.equal(p.crosshair.color, DEFAULTS.crosshair.color);
  assert.equal(p.crosshair.len, 12);
  assert.equal(p.crosshair.dot, true);
  assert.equal(p.fps, false);
  assert.deepEqual(p.binds, { foot: { buy: ['KeyN'] } });
});
