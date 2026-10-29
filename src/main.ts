import { CrazyGames } from './sdk/crazygames';
import { Game, loadStats } from './game/Game';
import { UI, type PlayConfig } from './ui/UI';
import { Sfx } from './game/Audio';

async function boot() {
  await CrazyGames.init();
  CrazyGames.loadingStart();

  let saved: Partial<PlayConfig> = {};
  try {
    saved = JSON.parse(CrazyGames.getItem('nn_prefs') || '{}');
  } catch {
    /* ignore corrupt prefs */
  }

  const ui = new UI(document.getElementById('ui')!, saved, loadStats());
  const game = new Game(document.getElementById('game') as HTMLCanvasElement, ui);

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

  // Dev shortcut: ?autoplay=pond|lake|sea jumps straight into a match.
  if (import.meta.env.DEV) {
    (window as unknown as { __game: Game }).__game = game; // for automated handling tests
    const map = new URLSearchParams(location.search).get('autoplay');
    if (map) ui.onPlay({ ...ui.config, map: map as PlayConfig['map'] });
  }
}

boot();
