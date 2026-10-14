import * as Phaser from 'phaser';
import { since } from '../log';
import { bindGame, initSdk, sdkLang } from '../yg';
import { goTo, sceneLogger } from './nav';

const log = sceneLogger('Boot');

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const startedAt = performance.now();
    this.registry.set('rounds', 0);
    this.registry.set('bonus', 0);
    log.info('initializing SDK');
    initSdk()
      .then((sdkReady) => {
        bindGame(this.game);
        log.info(sdkReady ? 'boot done' : 'boot done without SDK, offline mode', { ms: since(startedAt), sdk: sdkReady, lang: sdkLang() });
        goTo(this, 'Preload', sdkReady ? 'sdk initialized' : 'sdk unavailable');
      })
      .catch((error: unknown) => log.error('boot failed', { ms: since(startedAt), error }));
  }
}
