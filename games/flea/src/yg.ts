import * as Phaser from 'phaser';
import type { SDK } from 'ysdk';
import { createLogger, since } from './log';

export interface AdResult {
  shown: boolean;
  rewarded: boolean;
  error?: string;
  ms: number;
}

type PauseReason = 'sdk' | 'blur';
type AdProgress = Omit<AdResult, 'ms'>;

const log = createLogger('sdk');
const INIT_TIMEOUT_MS = 10_000;
const AD_TIMEOUT_MS = 60_000;
const AD_RESUME_GRACE_MS = 1_500;

let sdk: SDK | null = null;
let game: Phaser.Game | null = null;
let initDoneAt = 0;
let readySent = false;
let gameplayActive = false;
let gameplaySent: 'start' | 'stop' | null = null;
const pauseReasons = new Set<PauseReason>();
let onSdkResume: (() => void) | null = null;

export async function initSdk(): Promise<boolean> {
  if (typeof YaGames === 'undefined') {
    const inFrame = window.top !== window;
    log.error(
      inFrame
        ? 'YaGames is not defined: /sdk.js did not load, continuing without SDK'
        : 'YaGames is not defined: page is opened outside the Yandex Games frame (the SDK loader works only in an iframe) or /sdk.js did not load, continuing without SDK',
      { inFrame },
    );
    return false;
  }
  const startedAt = performance.now();
  log.info('YaGames.init started', { timeoutMs: INIT_TIMEOUT_MS });
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`YaGames.init did not finish in ${INIT_TIMEOUT_MS}ms`)), INIT_TIMEOUT_MS);
  });
  const init = YaGames.init();
  try {
    sdk = await Promise.race([init, timeout]);
  } catch (error) {
    log.error('YaGames.init failed, continuing without SDK', { ms: since(startedAt), error });
    init
      .then(() => log.warn('YaGames.init resolved after the timeout, SDK stays off for this session', { ms: since(startedAt) }))
      .catch((lateError: unknown) => log.debug('YaGames.init rejected after the timeout', { ms: since(startedAt), error: lateError }));
    return false;
  } finally {
    window.clearTimeout(timer);
  }
  initDoneAt = performance.now();
  log.info('YaGames.init done', {
    ms: since(startedAt),
    env: 'mock' in YaGames ? 'mock' : 'yandex',
    appId: sdk.environment.app.id,
    lang: sdk.environment.i18n.lang,
    device: sdk.deviceInfo.type,
    payload: sdk.environment.payload,
  });
  return true;
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
  if (gameplaySent === action) {
    log.warn(`GameplayAPI.${action} skipped: already sent`, { reason });
    return;
  }
  api[action]();
  gameplaySent = action;
  log.info(`GameplayAPI.${action}`, { reason });
}

function pauseGame(reason: PauseReason): void {
  if (pauseReasons.has(reason)) return;
  if (reason === 'blur' && pauseReasons.has('sdk')) {
    log.debug('window blur ignored: game is paused by SDK, focus moved to the ad or platform overlay');
    return;
  }
  pauseReasons.add(reason);
  if (pauseReasons.size > 1) {
    log.info(`pause reason ${reason} added, game already paused`, { reasons: [...pauseReasons].join(',') });
    return;
  }
  log.info(`game paused by ${reason}: sleeping loop, pausing sound`, { gameplayActive });
  if (gameplayActive) callGameplay('stop', `pause:${reason}`);
  game?.sound.pauseAll();
  game?.loop.sleep();
}

function resumeGame(reason: PauseReason): void {
  if (!pauseReasons.delete(reason)) return;
  if (pauseReasons.size > 0) {
    log.info(`pause reason ${reason} cleared, game stays paused`, { reasons: [...pauseReasons].join(',') });
    return;
  }
  const resumeGameplay = gameplayActive;
  log.info(`game resumed after ${reason}: waking loop, resuming sound`, { gameplayActive });
  game?.loop.resetDelta();
  game?.loop.wake();
  game?.sound.resumeAll();
  if (resumeGameplay) callGameplay('start', `resume:${reason}`);
}

export function bindGame(target: Phaser.Game): void {
  game = target;
  target.events.on(Phaser.Core.Events.BLUR, () => pauseGame('blur'));
  target.events.on(Phaser.Core.Events.FOCUS, () => resumeGame('blur'));
  if (!sdk) {
    log.warn('game_api_pause/resume not bound: SDK is not available, only window focus pauses the game');
    return;
  }
  sdk.on('game_api_pause', () => {
    log.info('game_api_pause received');
    pauseGame('sdk');
  });
  sdk.on('game_api_resume', () => {
    log.info('game_api_resume received');
    resumeGame('sdk');
    onSdkResume?.();
  });
  log.debug('subscribed to game_api_pause, game_api_resume and window focus');
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
  if (pauseReasons.size > 0) {
    log.info('gameplay active, GameplayAPI.start deferred until the game resumes', { reason, reasons: [...pauseReasons].join(',') });
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
  if (pauseReasons.size > 0) {
    log.info('gameplay inactive, GameplayAPI.stop was already sent on pause', { reason });
    return;
  }
  callGameplay('stop', reason);
}

function runAd(
  kind: 'interstitial' | 'rewarded',
  placement: string,
  clickedAt: number,
  show: (ysdk: SDK, progress: AdProgress, done: (result: AdProgress) => void) => void,
): Promise<AdResult> {
  const startedAt = performance.now();
  if (!sdk) {
    log.warn(`${kind} skipped: SDK is not available`, { placement });
    return Promise.resolve({ shown: false, rewarded: false, error: 'no-sdk', ms: 0 });
  }
  const ysdk = sdk;
  const progress: AdProgress = { shown: false, rewarded: false };
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      log.warn(`${kind} got no onClose within ${AD_TIMEOUT_MS}ms, finishing with what was received`, { placement, ...progress });
      done({ ...progress, error: 'timeout' });
    }, AD_TIMEOUT_MS);
    let graceTimer = 0;
    const done = (result: AdProgress) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.clearTimeout(graceTimer);
      onSdkResume = null;
      const ms = since(startedAt);
      log.info(`${kind} finished`, { placement, ...result, ms });
      resolve({ ...result, ms });
    };
    onSdkResume = () => {
      if (!progress.shown) return;
      window.clearTimeout(graceTimer);
      graceTimer = window.setTimeout(() => {
        log.warn(`${kind}: game_api_resume came but no onClose within ${AD_RESUME_GRACE_MS}ms, finishing with what was received`, { placement, ...progress });
        done({ ...progress, error: 'no-onclose' });
      }, AD_RESUME_GRACE_MS);
    };
    log.info(`${kind}: click -> SDK call in ${Math.round(startedAt - clickedAt)}ms`, { placement });
    try {
      show(ysdk, progress, done);
    } catch (error) {
      log.error(`${kind}: SDK call threw synchronously`, { placement, error });
      done({ ...progress, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function showInterstitial(placement: string, clickedAt: number): Promise<AdResult> {
  return runAd('interstitial', placement, clickedAt, (ysdk, progress, done) => {
    ysdk.adv.showFullscreenAdv({
      callbacks: {
        onOpen: () => {
          progress.shown = true;
          log.info('interstitial onOpen', { placement });
        },
        onClose: (wasShown) => done({ shown: wasShown, rewarded: false }),
        onError: (error) => {
          log.warn('interstitial onError, game continues', { placement, error });
          done({ ...progress, error: errorText(error) });
        },
        onOffline: () => log.warn('interstitial onOffline', { placement }),
      },
    });
  });
}

export function showRewarded(placement: string, clickedAt: number): Promise<AdResult> {
  return runAd('rewarded', placement, clickedAt, (ysdk, progress, done) => {
    ysdk.adv.showRewardedVideo({
      callbacks: {
        onOpen: () => {
          progress.shown = true;
          log.info('rewarded onOpen', { placement });
        },
        onRewarded: () => {
          progress.rewarded = true;
          log.info('rewarded onRewarded', { placement });
        },
        onClose: () => done({ ...progress }),
        onError: (error) => {
          log.warn(progress.rewarded ? 'rewarded onError after onRewarded, reward kept' : 'rewarded onError, no reward', { placement, error });
          done({ ...progress, error: errorText(error) });
        },
      },
    });
  });
}
