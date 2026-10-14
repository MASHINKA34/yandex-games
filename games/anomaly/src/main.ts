import * as Phaser from 'phaser';
import ygConfig from '../yg.config.json';
import { GAME } from './config/game';
import { createLogger, installGlobalHandlers } from './log';
import { BootScene } from './scenes/Boot';
import { MenuScene } from './scenes/Menu';
import { PlayScene } from './scenes/Play';
import { PreloadScene } from './scenes/Preload';
import { ResultScene } from './scenes/Result';

declare global {
  interface Window {
    __ygGame?: Phaser.Game;
  }
}

installGlobalHandlers();
const log = createLogger('main');

log.info('game starting', {
  game: GAME.key,
  version: ygConfig.version,
  mode: import.meta.env.MODE,
  appId: ygConfig.appId,
  phaser: Phaser.VERSION,
  viewport: `${window.innerWidth}x${window.innerHeight}`,
  dpr: window.devicePixelRatio,
});

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: ygConfig.baseWidth,
  height: ygConfig.baseHeight,
  backgroundColor: GAME.backgroundColor,
  pixelArt: true,
  roundPixels: true,
  banner: false,
  disableContextMenu: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: ygConfig.baseWidth,
    height: ygConfig.baseHeight,
  },
  scene: [BootScene, PreloadScene, MenuScene, PlayScene, ResultScene],
});

game.events.once(Phaser.Core.Events.READY, () => {
  log.info('phaser ready', {
    renderer: game.renderer.type === Phaser.WEBGL ? 'webgl' : 'canvas',
    canvas: `${game.canvas.width}x${game.canvas.height}`,
    displayScale: game.scale.displayScale.x.toFixed(3),
    audio: game.sound instanceof Phaser.Sound.WebAudioSoundManager ? 'webaudio' : game.sound instanceof Phaser.Sound.HTML5AudioSoundManager ? 'html5' : 'none',
  });
});
game.events.on(Phaser.Core.Events.HIDDEN, () => log.info('page hidden'));
game.events.on(Phaser.Core.Events.VISIBLE, () => log.info('page visible'));
game.scale.on(Phaser.Scale.Events.RESIZE, (_gameSize: Phaser.Structs.Size, _baseSize: Phaser.Structs.Size, displaySize: Phaser.Structs.Size) => {
  log.debug('canvas display size changed', { width: Math.round(displaySize.width), height: Math.round(displaySize.height) });
});

let scaleTimer = 0;
const syncScale = (reason: string) => {
  window.clearTimeout(scaleTimer);
  scaleTimer = window.setTimeout(() => {
    const parentChanged = game.scale.getParentBounds();
    game.scale.refresh();
    log.info('viewport changed, canvas rescaled', {
      reason,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      canvas: `${Math.round(game.scale.displaySize.width)}x${Math.round(game.scale.displaySize.height)}`,
      parentChanged,
    });
  }, 150);
};
window.addEventListener('resize', () => syncScale('resize'));
screen.orientation?.addEventListener('change', () => syncScale(`orientation ${screen.orientation.type}`));

if (import.meta.env.DEV) window.__ygGame = game;
