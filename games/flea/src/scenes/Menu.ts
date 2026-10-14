import * as Phaser from 'phaser';
import { gameTitle, lang, t } from '../strings';
import { createButton } from '../ui/button';
import { gameReady } from '../yg';
import { goTo, sceneLogger } from './nav';

const log = sceneLogger('Menu');

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    const centerX = this.scale.gameSize.width / 2;
    this.add
      .text(centerX, 150, gameTitle(), { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff', align: 'center', wordWrap: { width: 240 } })
      .setOrigin(0.5)
      .setName('title');
    createButton(this, { name: 'btn-play', label: t('play'), x: centerX, y: 300, onClick: () => goTo(this, 'Play', 'play button') });
    log.info('menu shown', { lang: lang(), title: gameTitle() });
    gameReady();
  }
}
