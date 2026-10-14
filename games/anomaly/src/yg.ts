import type Phaser from 'phaser';
import type { SDK } from 'ysdk';
import { createLogger, since } from './log';

export interface AdResult {
  shown: boolean;
  rewarded: boolean;
  error?: string;
  ms: number;
}

const log = createLogger('sdk');
const AD_TIMEOUT_MS = 60_000;

let sdk: SDK | null = null;
let initDoneAt = 0;
let readySent = false;
let gameplayActive = false;
let pausedBySdk = false;

export async function initSdk(): Promise<void> {
  if (typeof YaGames === 'undefined') {
    log.error('YaGames is not defined: /sdk.js did not load, continuing without SDK');
    return;
  }
  const startedAt = performance.now();
  log.info('YaGames.init started');
  try {
    sdk = await YaGames.init();
  } catch (error) {
    log.error('YaGames.init failed, continuing without SDK', { ms: since(startedAt), error });
    return;
  }
  initDoneAt = performance.now();
  log.info('YaGames.init done', {
    ms: since(startedAt),
    appId: sdk.environment.app.id,
    lang: sdk.environment.i18n.lang,
    device: sdk.deviceInfo.type,
    payload: sdk.environment.payload,
  });
}

export function sdkLang(): string {
  return sdk?.environment.i18n.lang ?? navigator.language.slice(0, 2).toLowerCase();
}

function callGameplay(action: 'start' | 'stop', reason: string): void {
  if (!sdk) return;
  const api = sdk.features.GameplayAPI as SDK['features']['GameplayAPI'] | undefined;
  if (!api) {
    log.warn(`GameplayAPI.${action} skipped: GameplayAPI is missing in this SDK`, { reason });
    return;
  }
  api[action]();
  log.info(`GameplayAPI.${action}`, { reason });
}

export function bindGame(game: Phaser.Game): void {
  if (!sdk) {
    log.warn('game_api_pause/resume not bound: SDK is not available');
    return;
  }
  sdk.on('game_api_pause', () => {
    pausedBySdk = true;
    log.info('game_api_pause: sleeping game loop, pausing sound', { gameplayActive });
    if (gameplayActive) callGameplay('stop', 'game_api_pause');
    game.sound.pauseAll();
    game.loop.sleep();
  });
  sdk.on('game_api_resume', () => {
    pausedBySdk = false;
    game.loop.resetDelta();
    game.loop.wake();
    game.sound.resumeAll();
    log.info('game_api_resume: game loop awake, sound resumed', { gameplayActive });
    if (gameplayActive) callGameplay('start', 'game_api_resume');
  });
  log.debug('subscribed to game_api_pause and game_api_resume');
}

export function gameReady(): void {
  if (readySent) {
    log.warn('LoadingAPI.ready skipped: already called');
    return;
  }
  readySent = true;
  if (!sdk) {
    log.warn('LoadingAPI.ready skipped: SDK is not available');
    return;
  }
  const api = sdk.features.LoadingAPI as SDK['features']['LoadingAPI'] | undefined;
  if (!api) {
    log.error('LoadingAPI.ready skipped: LoadingAPI is missing in this SDK');
    return;
  }
  api.ready();
  log.info(`LoadingAPI.ready called at +${since(initDoneAt)}ms since init`, { sincePageStartMs: Math.round(performance.now()) });
}

export function gameplayStart(reason: string): void {
  if (gameplayActive) {
    log.warn('gameplayStart ignored: gameplay is already active', { reason });
    return;
  }
  gameplayActive = true;
  if (pausedBySdk) {
    log.info('gameplay active, GameplayAPI.start deferred until game_api_resume', { reason });
    return;
  }
  callGameplay('start', reason);
}

export function gameplayStop(reason: string): void {
  if (!gameplayActive) {
    log.warn('gameplayStop ignored: gameplay is not active', { reason });
    return;
  }
  gameplayActive = false;
  if (pausedBySdk) {
    log.info('gameplay inactive, GameplayAPI.stop already sent on game_api_pause', { reason });
    return;
  }
  callGameplay('stop', reason);
}

function runAd(kind: 'interstitial' | 'rewarded', placement: string, clickedAt: number, show: (ysdk: SDK, done: (result: Omit<AdResult, 'ms'>) => void) => void): Promise<AdResult> {
  const startedAt = performance.now();
  if (!sdk) {
    log.warn(`${kind} skipped: SDK is not available`, { placement });
    return Promise.resolve({ shown: false, rewarded: false, error: 'no-sdk', ms: 0 });
  }
  const ysdk = sdk;
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      log.warn(`${kind} got no onClose within ${AD_TIMEOUT_MS}ms, giving up`, { placement });
      done({ shown: false, rewarded: false, error: 'timeout' });
    }, AD_TIMEOUT_MS);
    const done = (result: Omit<AdResult, 'ms'>) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      const ms = since(startedAt);
      log.info(`${kind} finished`, { placement, ...result, ms });
      resolve({ ...result, ms });
    };
    log.info(`${kind}: click -> SDK call in ${Math.round(startedAt - clickedAt)}ms`, { placement });
    try {
      show(ysdk, done);
    } catch (error) {
      log.error(`${kind}: SDK call threw synchronously`, { placement, error });
      done({ shown: false, rewarded: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export function showInterstitial(placement: string, clickedAt: number): Promise<AdResult> {
  return runAd('interstitial', placement, clickedAt, (ysdk, done) => {
    ysdk.adv.showFullscreenAdv({
      callbacks: {
        onOpen: () => log.info('interstitial onOpen', { placement }),
        onClose: (wasShown) => done({ shown: wasShown, rewarded: false }),
        onError: (error) => {
          log.error('interstitial onError', { placement, error });
          done({ shown: false, rewarded: false, error: error instanceof Error ? error.message : String(error) });
        },
        onOffline: () => log.warn('interstitial onOffline', { placement }),
      },
    });
  });
}

export function showRewarded(placement: string, clickedAt: number): Promise<AdResult> {
  return runAd('rewarded', placement, clickedAt, (ysdk, done) => {
    let opened = false;
    let rewarded = false;
    ysdk.adv.showRewardedVideo({
      callbacks: {
        onOpen: () => {
          opened = true;
          log.info('rewarded onOpen', { placement });
        },
        onRewarded: () => {
          rewarded = true;
          log.info('rewarded onRewarded', { placement });
        },
        onClose: () => done({ shown: opened, rewarded }),
        onError: (error) => {
          log.error('rewarded onError', { placement, error });
          done({ shown: false, rewarded: false, error: error instanceof Error ? error.message : String(error) });
        },
      },
    });
  });
}
