import * as Phaser from 'phaser';
import { GAME } from '../config/game';
import { createLogger } from '../log';

const log = createLogger('ui');
const HEIGHT = 36;
const ARM_DELAY_MS = 300;

export interface ButtonOptions {
  name: string;
  label: string;
  x: number;
  y: number;
  width?: number;
  onClick: (clickedAt: number) => void;
}

export interface Button {
  setEnabled(enabled: boolean): void;
}

export function createButton(scene: Phaser.Scene, options: ButtonOptions): Button {
  const width = options.width ?? 180;
  const armedAt = performance.now() + ARM_DELAY_MS;
  const background = scene.add
    .rectangle(options.x, options.y, width, HEIGHT, GAME.buttonColor)
    .setStrokeStyle(1, GAME.accentColor)
    .setName(options.name)
    .setData('armedAt', armedAt)
    .setInteractive({ useHandCursor: true });
  scene.add
    .text(options.x, options.y, options.label, { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff' })
    .setOrigin(0.5)
    .setName(`${options.name}-label`);

  let enabled = true;
  let pressed = false;
  const paint = () => background.setFillStyle(pressed ? GAME.buttonPressedColor : GAME.buttonColor).setAlpha(enabled ? 1 : 0.4);
  const context = { scene: scene.scene.key, button: options.name };

  background.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
    if (pointer.button !== 0) {
      log.debug('press ignored: not the primary button', { ...context, mouseButton: pointer.button });
      return;
    }
    if (performance.now() < armedAt) {
      log.debug('press ignored: button just appeared', { ...context, armDelayMs: ARM_DELAY_MS });
      return;
    }
    pressed = true;
    paint();
  });
  background.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => {
    pressed = false;
    paint();
  });
  background.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, (pointer: Phaser.Input.Pointer) => {
    if (!pressed) return;
    pressed = false;
    paint();
    if (!enabled) {
      log.debug('click ignored: button disabled', context);
      return;
    }
    log.info('button click', { ...context, input: pointer.wasTouch ? 'touch' : 'mouse' });
    options.onClick(performance.now());
  });

  return {
    setEnabled(value) {
      enabled = value;
      paint();
    },
  };
}
