import { defineConfig } from 'vite';

// Relative paths, so the build works at GitHub Pages' /party-kart/ as well as at a root. The map's
// photo textures (braga-map's task 007) stay files of their own, never inlined into the tiles'
// indexes, which every player downloads whether the photos are drawn or not.
export default defineConfig({ base: './', build: { assetsInlineLimit: (file) => (file.endsWith('.ktx2') ? false : undefined) } });
