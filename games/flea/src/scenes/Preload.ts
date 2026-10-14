import * as Phaser from 'phaser';
import { GAME } from '../config/game';
import { since } from '../log';
import { goTo, sceneLogger } from './nav';

const log = sceneLogger('Preload');
const BAR_WIDTH = 160;

export class PreloadScene extends Phaser.Scene {
  private startedAt = 0;

  constructor() {
    super('Preload');
  }

  preload(): void {
    this.startedAt = performance.now();
    const { width, height } = this.scale.gameSize;
    this.add.rectangle(width / 2, height / 2, BAR_WIDTH, 6).setStrokeStyle(1, GAME.accentColor);
    const bar = this.add.rectangle(width / 2 - BAR_WIDTH / 2, height / 2, 0, 6, GAME.accentColor).setOrigin(0, 0.5);
    this.load.on(Phaser.Loader.Events.PROGRESS, (progress: number) => {
      bar.width = BAR_WIDTH * progress;
      log.debug('loading', { progress: progress.toFixed(2) });
    });
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      log.error('asset failed to load', { key: file.key, url: String(file.url) });
    });
    log.info('loading assets', { queued: this.load.list.size });
  }

  create(): void {
    log.info('assets loaded', { ms: since(this.startedAt), files: this.load.totalComplete, failed: this.load.totalFailed });
    goTo(this, 'Menu', 'assets loaded');
  }
}
