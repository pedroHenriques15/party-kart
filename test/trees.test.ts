import { map } from 'braga-map';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { dayOf, seasonOf } from '../src/render/season.ts';

// On Ultra the near crowns of the kinds that drop their leaves have their limbs drawn (braga-map's task
// 089, `DECIDUOUS` in src/render/trees.ts): the map's own kinds (its decision 051). trees.ts loads the
// leaves' textures as the browser does, so it's read here rather than imported.
test("Ultra's trees with limbs are the kinds the map says drop their leaves", () => {
  const src = fs.readFileSync(new URL('../src/render/trees.ts', import.meta.url), 'utf8');
  const found = src.match(/export const DECIDUOUS: MapTreeKind\[\] = \[([^\]]*)\]/);
  assert.ok(found, 'trees.ts lists DECIDUOUS');
  const listed = found[1].split(',').map((k) => k.trim().replace(/'/g, ''));
  const deciduous = map().treeKinds.filter((k) => !k.evergreen).map((k) => k.kind);
  assert.deepEqual([...listed].sort(), [...deciduous].sort());
});

// On Ultra each kind's crown follows its year in Braga (braga-map's task 093, src/render/season.ts): by
// the game's default day, 13 March, the deciduous kinds are bare, as that day's photos have the planes.
test('the crowns on Ultra by the date: bare in winter and on the default 13 March, in leaf in summer, turning in autumn', () => {
  const kinds = map().treeKinds;
  const on = (date: string) => dayOf(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), 12));
  assert.equal(on('2026-03-13'), 72);
  for (const { kind, evergreen, year } of kinds) {
    const at = (date: string) => seasonOf(year, on(date));
    if (evergreen) {
      for (const d of ['2026-01-15', '2026-03-13', '2026-07-15', '2026-11-01']) assert.equal(at(d).leaves, 1, `${kind} on ${d}`);
      continue;
    }
    for (const d of ['2026-01-15', '2026-03-13', '2026-12-31']) assert.equal(at(d).leaves, 0, `${kind} bare on ${d}`);
    assert.deepEqual([at('2026-07-15').leaves, at('2026-07-15').turned], [1, 0], `${kind} in July`);
    const may = at('2026-05-01');
    assert.ok(may.leaves > 0.5 && may.fresh > 0, `${kind} on 1 May: ${JSON.stringify(may)}`);
    // Halfway from its leaves' turning to half of them down, as its year has it.
    const autumn = seasonOf(year, Math.round((year!.turn! + year!.fall!) / 2));
    assert.ok(autumn.turned > 0.3 && autumn.leaves > 0.5 && autumn.leaves < 1, `${kind} in autumn: ${JSON.stringify(autumn)}`);
    // And in November, every one turning, falling or bare.
    assert.ok(at('2026-11-30').turned > 0 && at('2026-11-30').leaves < 1, `${kind} on 30 November`);
  }
  // The limes in flower in June.
  assert.ok(seasonOf(kinds.find((k) => k.kind === 'lime')!.year, on('2026-06-20')).bloom > 0.5);
  assert.equal(seasonOf(kinds.find((k) => k.kind === 'lime')!.year, on('2026-08-20')).bloom, 0);
});
