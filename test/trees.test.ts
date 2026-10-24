import { map } from 'braga-map';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

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
