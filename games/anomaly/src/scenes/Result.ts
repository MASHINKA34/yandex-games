import * as Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { t } from '../strings';
import { createButton, type Button } from '../ui/button';
import { showInterstitial, showRewarded } from '../yg';
import { goTo, sceneLogger } from './nav';

const log = sceneLogger('Result');

interface ResultData {
  round?: number;
  playedMs?: number;
}

export class ResultScene extends Phaser.Scene {
  private buttons: Button[] = [];
  private bonusText!: Phaser.GameObjects.Text;

  constructor() {
    super('Result');
  }

  create(data: ResultData): void {
    const centerX = this.scale.gameSize.width / 2;
    const style = { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' };
    this.add.text(centerX, 120, t('roundOver'), style).setOrigin(0.5);
    this.add.text(centerX, 160, t('rounds', { n: this.registry.get('rounds') as number }), style).setOrigin(0.5).setName('rounds-count');
    this.bonusText = this.add.text(centerX, 190, '', style).setOrigin(0.5).setName('bonus-count');
    this.renderBonus();

    this.buttons = [
      createButton(this, { name: 'btn-again', label: t('again'), x: centerX, y: 300, onClick: (clickedAt) => this.playAgain(clickedAt) }),
      createButton(this, { name: 'btn-bonus', label: t('bonus'), x: centerX, y: 420, width: 230, onClick: (clickedAt) => this.watchBonus(clickedAt) }),
    ];
    log.info('result shown', { round: data.round, playedMs: data.playedMs, bonus: this.registry.get('bonus') as number });
  }

  private renderBonus(): void {
    this.bonusText.setText(t('bonuses', { n: this.registry.get('bonus') as number }));
  }

  private setBusy(busy: boolean): void {
    for (const button of this.buttons) button.setEnabled(!busy);
  }

  private playAgain(clickedAt: number): void {
    this.setBusy(true);
    showInterstitial('result-again', clickedAt)
      .then((result) => {
        log.info('interstitial over, starting next round', { shown: result.shown, error: result.error, ms: result.ms });
        goTo(this, 'Play', 'play again');
      })
      .catch((error: unknown) => {
        log.error('play again failed', { error });
        this.setBusy(false);
      });
  }

  private watchBonus(clickedAt: number): void {
    this.setBusy(true);
    showRewarded('result-bonus', clickedAt)
      .then((result) => {
        if (result.rewarded) {
          const bonus = (this.registry.get('bonus') as number) + BALANCE.rewardBonus;
          this.registry.set('bonus', bonus);
          log.info('bonus granted', { added: BALANCE.rewardBonus, bonus });
        } else {
          const why = result.error ? `ad failed (${result.error})` : result.shown ? 'video closed before the end' : 'video was not shown';
          log.info(`bonus not granted: ${why}`, { shown: result.shown, error: result.error, ms: result.ms });
        }
        this.renderBonus();
        this.setBusy(false);
      })
      .catch((error: unknown) => {
        log.error('bonus flow failed', { error });
        this.setBusy(false);
      });
  }
}
