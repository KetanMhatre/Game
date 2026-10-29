import { defineConfig } from 'vite';

// CrazyGames serves the build from a sub-path, so all asset URLs must be relative.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
});
