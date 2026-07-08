import './styles.css';
import { Game } from './core/Game';

// ---------------------------------------------------------------------------
// Entry point. Verifies WebGL2 support, then boots the game.
// ---------------------------------------------------------------------------

const app = document.getElementById('app')!;

function fail(message: string): void {
  app.innerHTML = `<div class="fatal"><h1>VoxelCraft</h1><p>${message}</p></div>`;
}

const testCanvas = document.createElement('canvas');
const gl = testCanvas.getContext('webgl2');
if (!gl) {
  fail('This game requires WebGL2, which your browser or device does not support. Try a recent version of Chrome, Edge or Firefox.');
} else {
  const game = new Game(app);
  game.init().catch((e) => {
    console.error(e);
    fail('Failed to start: ' + (e instanceof Error ? e.message : String(e)));
  });
  window.addEventListener('beforeunload', () => {
    // Best-effort save on exit is handled by the game's autosave & quit paths.
  });
}
