import { defineConfig } from 'vite';

// The multiplayer server (port 2567) is reachable on the same address under /net, so a single URL works
// for localhost, LAN tests and public tunnels (e.g. `cloudflared tunnel --url http://localhost:4173`).
const netProxy = {
  '/net': {
    target: 'http://localhost:2567',
    ws: true,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/net/, '') || '/',
  },
};
// Cloudflare quick tunnels serve the game from a random *.trycloudflare.com address.
const allowedHosts = ['.trycloudflare.com'];

// CrazyGames serves the build from a sub-path, so all asset URLs must be relative.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  server: { proxy: netProxy, allowedHosts },
  preview: { proxy: netProxy, allowedHosts },
});
