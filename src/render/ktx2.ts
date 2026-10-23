// The map's textures (braga-map's tasks 016, 019 and 082: each kind of ground's, each kind of tree's bark
// and leaves, made, not photographed) are KTX2 files, compressed with Basis Universal's ETC1S, which
// three.js's KTX2Loader turns into what this graphics card takes (ETC1 on a phone, BC7 on a PC) in its
// workers, and which stays compressed on the card: on a phone an eighth of the memory a WebP or a canvas
// takes. Basis's transcoder is fetched once, the first time (about 0.6 MB, 0.26 gzipped), from the
// game's own assets.
import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import transcoderJs from 'three/addons/libs/basis/basis_transcoder.js?url';
import transcoderWasm from 'three/addons/libs/basis/basis_transcoder.wasm?url';

// A loader of the map's KTX2 files, as this graphics card takes them (cover.ts and trees.ts use it).
// Dispose of it once they're loaded: it keeps its workers.
export function ktx2Loader(renderer: THREE.WebGLRenderer): KTX2Loader {
  // KTX2Loader asks for the transcoder by name; the bundler has given each file a name of its own.
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => (url.endsWith('basis_transcoder.js') ? transcoderJs : url.endsWith('basis_transcoder.wasm') ? transcoderWasm : url));
  return new KTX2Loader(manager).setTranscoderPath('').detectSupport(renderer);
}
