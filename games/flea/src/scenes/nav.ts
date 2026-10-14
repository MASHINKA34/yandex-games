import * as Phaser from 'phaser';
import { createLogger } from '../log';

const log = createLogger('scene');
const leaving = new WeakSet<Phaser.Scene>();

export function goTo(from: Phaser.Scene, to: string, reason: string, data?: Record<string, unknown>): void {
  if (leaving.has(from)) {
    log.debug(`${from.scene.key} -> ${to} ignored: transition already requested`, { reason });
    return;
  }
  leaving.add(from);
  from.events.once(Phaser.Scenes.Events.SHUTDOWN, () => leaving.delete(from));
  log.info(`${from.scene.key} -> ${to}`, { reason, ...data });
  from.scene.start(to, data);
}

export function sceneLogger(key: string) {
  return log.child(key);
}
