import { defineConfig } from 'vite';

// Relative paths, so the build works at GitHub Pages' /party-kart/ as well as at a root. The map's
// KTX2 textures (braga-map's decision 030) stay files of their own, never inlined into the module
// that lists them, which every player downloads whatever level it draws.
export default defineConfig({ base: './', build: { assetsInlineLimit: (file) => (file.endsWith('.ktx2') ? false : undefined) } });
