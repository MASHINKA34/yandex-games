import * as Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { t } from '../strings';
import { createButton } from '../ui/button';
import { gameplayStart, gameplayStop } from '../yg';
import { goTo, sceneLogger } from './nav';

const log = sceneLogger('Play');

export class PlayScene extends Phaser.Scene {
  private finished = false;
  private round = 0;
  private shownSeconds = -1;
  private timer!: Phaser.Time.TimerEvent;
  private timerText!: Phaser.GameObjects.Text;

  constructor() {
    super('Play');
  }

  init(): void {
    this.finished = false;
    this.shownSeconds = -1;
  }

  create(): void {
    const centerX = this.scale.gameSize.width / 2;
    this.round = (this.registry.get('rounds') as number) + 1;
    this.registry.set('rounds', this.round);

    this.timerText = this.add
      .text(centerX, 160, '', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' })
      .setOrigin(0.5)
      .setName('timer');
    this.timer = this.time.addEvent({ delay: BALANCE.roundSeconds * 1000, callback: () => this.finish('timer') });
    createButton(this, { name: 'btn-finish', label: t('finish'), x: centerX, y: 360, onClick: () => this.finish('finish button') });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.finished) return;
      log.warn('scene shut down mid-round, stopping gameplay', { round: this.round });
      gameplayStop('play scene shutdown');
    });

    log.info('round started', { round: this.round, seconds: BALANCE.roundSeconds });
    gameplayStart('round started');
    this.updateTimerText();
  }

  override update(): void {
    this.updateTimerText();
  }

  private updateTimerText(): void {
    const seconds = Math.ceil(this.timer.getRemainingSeconds());
    if (seconds === this.shownSeconds) return;
    this.shownSeconds = seconds;
    this.timerText.setText(t('timeLeft', { s: seconds }));
  }

  private finish(reason: string): void {
    if (this.finished) return;
    this.finished = true;
    const playedMs = Math.round(this.timer.getElapsed());
    this.timer.remove(false);
    log.info('round finished', { round: this.round, reason, playedMs });
    gameplayStop('round finished');
    goTo(this, 'Result', reason, { round: this.round, playedMs });
  }
}
