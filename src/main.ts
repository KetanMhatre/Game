import { CrazyGames } from './sdk/crazygames';
import { Game, loadStats, type QualitySetting } from './game/Game';
import { UI, type PlayConfig } from './ui/UI';
import { Sfx } from './game/Audio';

/** Wait (briefly) for the bundled fonts so canvas-drawn labels and badges use them. */
async function loadFonts(): Promise<void> {
  if (!document.fonts) return;
  const timeout = new Promise((r) => setTimeout(r, 1500));
  await Promise.race([Promise.all([document.fonts.load('40px "Lilita One"'), document.fonts.load('600 20px "Fredoka"')]), timeout]).catch(() => {});
}

async function boot() {
  await CrazyGames.init();
  CrazyGames.loadingStart();
  await loadFonts();

  let saved: Partial<PlayConfig> & { quality?: QualitySetting } = {};
  try {
    saved = JSON.parse(CrazyGames.getItem('nn_prefs') || '{}');
  } catch {
    /* ignore corrupt prefs */
  }
  let quality: QualitySetting = saved.quality === 'high' || saved.quality === 'low' ? saved.quality : 'auto';
  // Dev-only: ?quality=high pins quality (headless test browsers render on the CPU and would auto-downgrade).
  const devQ = import.meta.env.DEV ? new URLSearchParams(location.search).get('quality') : null;
  if (devQ === 'high' || devQ === 'low' || devQ === 'auto') quality = devQ;

  const ui = new UI(document.getElementById('ui')!, saved, loadStats());
  const game = new Game(document.getElementById('game') as HTMLCanvasElement, ui, quality);

  if (!saved.name) {
    const username = await CrazyGames.getUsername();
    if (username) ui.setName(username.slice(0, 14));
  }

  // Unlock audio on first interaction anywhere (browser autoplay policy).
  const unlock = () => Sfx.unlock();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  game.start();
  CrazyGames.loadingStop();
  const boot = document.getElementById('boot');
  if (boot) {
    // Fade the splash out once the first frames are on screen.
    requestAnimationFrame(() => requestAnimationFrame(() => boot.classList.add('done')));
    setTimeout(() => boot.remove(), 800);
  }

  // Dev shortcut: ?autoplay=pond|lake|sea jumps straight into a match.
  if (import.meta.env.DEV) {
    (window as unknown as { __game: Game }).__game = game; // for automated tests
    const map = new URLSearchParams(location.search).get('autoplay');
    if (map) ui.onPlay({ ...ui.config, map: map as PlayConfig['map'] });
  }
}

boot();
