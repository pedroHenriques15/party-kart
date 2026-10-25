import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { cascadedLights, dithered } from '../src/render/post.ts';

// Ultra's shadows in cascades (braga-map's task 090, src/render/post.ts): its lit materials take three's
// own lights chunk with CSM's loop over the suns in it, as CSM's copy of the whole chunk is older than
// three's and drew every standard material darker and duller. Each three upgrade is checked here.
test("Ultra's lit materials take three's lights chunk, with CSM's choice of cascade in it", () => {
  const own = THREE.ShaderChunk.lights_fragment_begin;
  new CSM({ camera: new THREE.PerspectiveCamera(), parent: new THREE.Scene() });
  const csm = THREE.ShaderChunk.lights_fragment_begin;
  THREE.ShaderChunk.lights_fragment_begin = own;
  assert.notEqual(csm, own, "CSM puts its own chunk in three's place");
  const both = cascadedLights(own, csm);
  // three's light scattered more than once, which CSM's copy hasn't
  assert.match(both, /material\.dfg = texture2D\( dfgLUT/);
  assert.doesNotMatch(csm, /material\.dfg/);
  // CSM's cascades, and not three's own loop over the suns beside them
  assert.match(both, /CSM_cascades\[ i \]/);
  assert.equal(both.split('#if ( NUM_DIR_LIGHTS > 0 )').length, 2);
  // every #if closed
  const lines = both.split('\n').map((l) => l.trim());
  assert.equal(lines.filter((l) => /^#if/.test(l)).length, lines.filter((l) => l.startsWith('#endif')).length);
});

// What's dithered says so in the frame's alpha, for Ultra's resolve (braga-map's task 132): after three
// has set it, in the standard and basic materials a crown and a billboard are; and a card of bare twigs
// (trees.ts's seasonFragment) takes no sheen by three's names for it, which an upgrade could change.
test("a dithered pixel says so in Ultra's frame, and a bare twig's sheen is three's to take off", () => {
  for (const lib of [THREE.ShaderLib.standard, THREE.ShaderLib.basic]) {
    const sh = { fragmentShader: lib.fragmentShader };
    dithered(sh, 'share');
    assert.match(sh.fragmentShader, /#include <opaque_fragment>\nif \(share > 0\.0\) gl_FragColor\.a = -min\(share, 1\.0\);/);
  }
  assert.match(THREE.ShaderLib.standard.fragmentShader, /#include <lights_physical_fragment>/);
  for (const field of ['specularColor', 'specularColorBlended', 'specularF90']) assert.match(THREE.ShaderChunk.lights_physical_fragment, new RegExp(`material\\.${field} = `));
});
