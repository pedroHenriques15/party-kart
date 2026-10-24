import amigosPlan from 'braga-map/tracks/amigos.js';
import { loadWorld } from 'braga-map';
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { MARK_SEND, MarkBook, MarkSender, whereIs, type MarkMsg } from '../src/game/marks.ts';

// The room's marks (braga-map's task 110), as the host keeps them: it trusts nothing in what's sent.
const world = await loadWorld({ open: true });
const plinth = { x: amigosPlan.points[0].p[0], z: amigosPlan.points[0].p[2] };

test('the host takes a mark inside the open world, one a player, and drops the rest', () => {
  const book = new MarkBook((x, z) => world.inOpen(x, z));
  let t = 0;
  const later = () => (t += 1500);
  assert.ok(world.inOpen(plinth.x, plinth.z));
  // Ana's, at the plinth: hers, under her own id, with her name.
  assert.equal(book.take('ana', 'Ana', { t: 'mark', at: plinth }, later()), true);
  assert.deepEqual(book.list(), [{ id: 'ana', name: 'Ana', x: Math.round(plinth.x * 10) / 10, z: Math.round(plinth.z * 10) / 10 }]);
  // Outside the open world, or nowhere: dropped, and hers stays where it was.
  for (const at of [{ x: 10_000, z: 10_000 }, { x: plinth.x + 5000, z: plinth.z }, { x: NaN, z: plinth.z }, { x: Infinity, z: 0 }, { x: '1', z: '2' }, { x: plinth.x }, 'here', 7]) {
    assert.equal(book.take('ana', 'Ana', { t: 'mark', at }, later()), false, JSON.stringify(at));
  }
  for (const m of [null, undefined, 'mark', 3, { t: 'mark' }]) assert.equal(book.take('ana', 'Ana', m, later()), false, String(m));
  assert.equal(book.list().length, 1);
  // Under another's id: Bruno's connection naming Ana is dropped, hers untouched, and he has none.
  const near = { x: plinth.x + 30, z: plinth.z + 10 };
  assert.ok(world.inOpen(near.x, near.z));
  assert.equal(book.take('bruno', 'Bruno', { t: 'mark', id: 'ana', at: near }, later()), false);
  assert.equal(book.take('bruno', 'Bruno', { t: 'mark', id: 'host', at: null }, later()), false);
  assert.deepEqual(book.list().map((m) => [m.id, m.x]), [['ana', Math.round(plinth.x * 10) / 10]]);
  // His own: his, beside hers.
  assert.equal(book.take('bruno', 'Bruno', { t: 'mark', id: 'bruno', at: near }, later()), true);
  assert.deepEqual(book.list().map((m) => m.id).sort(), ['ana', 'bruno']);
  // One a player: Ana's new one takes the old one's place.
  assert.equal(book.take('ana', 'Ana', { t: 'mark', at: near }, later()), true);
  assert.equal(book.list().filter((m) => m.id === 'ana').length, 1);
  assert.equal(book.list().find((m) => m.id === 'ana')!.x, Math.round(near.x * 10) / 10);
  // Not more than one a second: 999 ms after her last, dropped; a second after, taken.
  t += 999;
  assert.equal(book.take('ana', 'Ana', { t: 'mark', at: plinth }, t), false);
  t += 1;
  assert.equal(book.take('ana', 'Ana', { t: 'mark', at: plinth }, t), true);
  // Taken away (null), or gone with whoever leaves; a new name on hers.
  assert.equal(book.rename('bruno', 'Bruninho'), true);
  assert.equal(book.list().find((m) => m.id === 'bruno')!.name, 'Bruninho');
  assert.equal(book.take('ana', 'Ana', { t: 'mark', at: null }, later()), true);
  assert.equal(book.take('ana', 'Ana', { t: 'mark', at: null }, later()), false, 'nothing to take away');
  assert.equal(book.drop('bruno'), true);
  assert.deepEqual(book.list(), []);
});

test("a player's marks go out one every 1.2 s at most, the last asked for always", () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let now = 0;
    const sent: MarkMsg[] = [];
    const s = new MarkSender((m) => sent.push(m), () => now);
    const a = { x: 1, z: 1 };
    const b = { x: 2, z: 2 };
    const c = { x: 3, z: 3 };
    s.push({ at: a });
    assert.deepEqual(sent, [{ at: a }], 'the first at once');
    now = 300;
    s.push({ at: b });
    now = 600;
    s.push({ at: c });
    assert.equal(sent.length, 1);
    now = MARK_SEND;
    mock.timers.tick(MARK_SEND);
    assert.deepEqual(sent, [{ at: a }, { at: c }], 'the last one asked for, once the time has passed');
    now = MARK_SEND + 200;
    s.push({ at: null });
    now = 2 * MARK_SEND;
    mock.timers.tick(MARK_SEND);
    assert.deepEqual(sent.at(-1), { at: null });
    // Stopped (leaving the room): nothing more goes.
    now = 2 * MARK_SEND + 100;
    s.push({ at: a });
    s.stop();
    mock.timers.tick(MARK_SEND);
    assert.equal(sent.length, 3);
  } finally {
    mock.timers.reset();
  }
});

test('where a friend is, for the GPS to follow: their latest snapshot, while they are in the room', () => {
  const members = [
    { id: 'host', bot: false },
    { id: 'ana', bot: false },
    { id: 'bot-1', bot: true },
  ];
  const cars = new Map([
    ['ana', [{ at: 1000, s: { x: 1, z: 2 } }, { at: 1066, s: { x: 3, z: 4 } }]],
    ['bot-1', [{ at: 1066, s: { x: 5, z: 6 } }]],
    ['gone', [{ at: 1066, s: { x: 7, z: 8 } }]],
  ]);
  assert.deepEqual(whereIs('ana', members, cars, 2000), { x: 3, z: 4 });
  assert.equal(whereIs('ana', members, cars, 7000), null, 'not heard of for 5 s');
  assert.equal(whereIs('bot-1', members, cars, 2000), null, 'a bot');
  assert.equal(whereIs('gone', members, cars, 2000), null, 'left the room');
  assert.equal(whereIs('host', members, cars, 2000), null, 'no snapshot yet');
});
