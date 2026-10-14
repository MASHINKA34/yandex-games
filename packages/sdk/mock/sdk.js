(function () {
  'use strict';

  const PREFIX = '[mock-sdk]';
  const PLAYER_KEY = 'yg-mock-player';
  const BOARDS_KEY = 'yg-mock-leaderboards';
  const DATA_LIMIT_BYTES = 200 * 1024;
  const STATS_LIMIT_BYTES = 10 * 1024;
  const FULLSCREEN_ADV_MS = 1500;
  const MAX_LOGGED = 2048;

  const config = window.__YG_MOCK__ || {};
  const query = new URLSearchParams(window.location.search);
  const delayMs = Math.max(0, Number(query.get('mockDelay')) || 0);
  const failures = new Set((query.get('mockFail') || '').split(',').map((s) => s.trim()).filter(Boolean));
  const advMode = query.get('adv') || 'ok';

  const pad = (n, width = 2) => String(n).padStart(width, '0');
  function clock() {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  }

  function stringify(value) {
    if (value === undefined) return '';
    let text;
    try {
      text = value instanceof Error ? JSON.stringify({ name: value.name, message: value.message, code: value.code }) : JSON.stringify(value);
    } catch (error) {
      text = `[unserializable: ${error.message}]`;
    }
    if (text === undefined) text = String(value);
    return text.length > MAX_LOGGED ? `${text.slice(0, MAX_LOGGED)}...(${text.length} chars total)` : text;
  }

  function line(method, detail, id) {
    const tail = stringify(detail);
    return `${PREFIX} ${method}${id ? ` #${id}` : ''} ${clock()}${tail ? ` ${tail}` : ''}`;
  }

  const log = (method, detail, id) => console.info(line(method, detail, id));
  const warn = (method, detail, id) => console.warn(line(method, detail, id));
  let callSeq = 0;

  function safeCall(label, fn, ...args) {
    if (typeof fn !== 'function') return;
    try {
      fn(...args);
    } catch (error) {
      console.error(line(`${label} callback threw`, error), error);
    }
  }

  function shouldFail(method) {
    return failures.has(method) || failures.has(method.split('.').pop());
  }

  function call(method, params, run, summarize) {
    callSeq += 1;
    const id = callSeq;
    log(method, params, id);
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (shouldFail(method)) {
          const error = new Error(`mock failure for ${method} (mockFail)`);
          error.code = 'MOCK_FAIL';
          warn(`${method} -> reject`, { message: error.message, delayMs }, id);
          reject(error);
          return;
        }
        try {
          const result = run();
          log(`${method} -> resolve`, result === undefined ? { delayMs } : summarize ? summarize(result) : result, id);
          resolve(result);
        } catch (error) {
          warn(`${method} -> reject`, { message: error.message, code: error.code, delayMs }, id);
          reject(error);
        }
      }, delayMs);
    });
  }

  function readJson(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      warn(`storage read failed for ${key}, using defaults`, error);
      return fallback;
    }
  }

  function writeJson(key, value) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  function byteSize(value) {
    return new Blob([JSON.stringify(value)]).size;
  }

  function pick(source, keys) {
    if (!Array.isArray(keys) || keys.length === 0) return JSON.parse(JSON.stringify(source));
    const out = {};
    for (const key of keys) if (key in source) out[key] = JSON.parse(JSON.stringify(source[key]));
    return out;
  }

  function loadPlayer() {
    const stored = readJson(PLAYER_KEY, {});
    const player = {
      uid: stored.uid || `mock-${Math.random().toString(36).slice(2, 10)}`,
      authorized: Boolean(stored.authorized),
      data: stored.data && typeof stored.data === 'object' ? stored.data : {},
      stats: stored.stats && typeof stored.stats === 'object' ? stored.stats : {},
    };
    if (query.get('auth') === '1') player.authorized = true;
    if (query.get('auth') === '0') player.authorized = false;
    if (!stored.uid) writeJson(PLAYER_KEY, player);
    return player;
  }

  let playerStore = null;
  const listeners = new Map();
  const pauseReasons = new Set();
  const state = { readyCalls: 0, gameplayRunning: false, advOpen: false, reviewRequested: false };

  function emit(event, detail) {
    log(`emit ${event}`, detail);
    const set = listeners.get(event);
    if (!set) return;
    for (const listener of Array.from(set)) safeCall(event, listener, detail);
  }

  function pauseFor(reason) {
    if (pauseReasons.has(reason)) {
      log('pause reason already active', { reason, reasons: Array.from(pauseReasons) });
      return;
    }
    pauseReasons.add(reason);
    log('pause reason added', { reason, reasons: Array.from(pauseReasons) });
    if (pauseReasons.size === 1) emit('game_api_pause', { reason });
    updateBadge();
  }

  function resumeFor(reason) {
    if (!pauseReasons.delete(reason)) {
      log('resume ignored: reason was not active', { reason, reasons: Array.from(pauseReasons) });
      return;
    }
    log('pause reason removed', { reason, reasons: Array.from(pauseReasons) });
    if (pauseReasons.size === 0) emit('game_api_resume', { reason });
    updateBadge();
  }

  function on(event, listener) {
    log('on', { event });
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(listener);
    return () => off(event, listener);
  }

  function off(event, listener) {
    log('off', { event });
    const set = listeners.get(event);
    if (set) set.delete(listener);
  }

  let badge = null;

  function updateBadge() {
    if (!badge) return;
    badge.textContent = pauseReasons.size > 0 ? `MOCK SDK: pause (${Array.from(pauseReasons).join(',')})` : 'MOCK SDK';
  }

  function mountBadge() {
    badge = document.createElement('div');
    badge.id = 'mock-sdk-badge';
    badge.style.cssText =
      'position:fixed;top:4px;left:4px;z-index:2147483647;padding:2px 6px;font:bold 10px/1.4 monospace;' +
      'color:#000;background:#ffd400;border-radius:3px;opacity:.85;pointer-events:none;';
    document.body.appendChild(badge);
    updateBadge();
  }

  function showOverlay(title, buttons) {
    const root = document.createElement('div');
    root.id = 'mock-adv-overlay';
    root.style.cssText =
      'position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;gap:14px;background:rgba(12,12,24,.94);color:#fff;font:16px/1.3 system-ui,sans-serif;';
    const caption = document.createElement('div');
    caption.textContent = title;
    root.appendChild(caption);
    for (const spec of buttons) {
      const button = document.createElement('button');
      button.id = spec.id;
      button.type = 'button';
      button.textContent = spec.label;
      button.style.cssText = 'min-width:170px;min-height:44px;font:inherit;cursor:pointer;';
      button.addEventListener('click', spec.onClick);
      root.appendChild(button);
    }
    document.body.appendChild(root);
    return root;
  }

  function failAdvLater(method, callbacks, closeArgs) {
    setTimeout(() => {
      const error = new Error(`mock ${method} error (adv=error)`);
      warn(`${method}.onError`, error);
      safeCall(`${method}.onError`, callbacks.onError, error);
      log(`${method}.onClose`, { wasShown: false, reason: 'adv=error' });
      safeCall(`${method}.onClose`, callbacks.onClose, ...closeArgs);
    }, 50);
  }

  function skipAdvLater(method, callbacks, closeArgs, reason) {
    setTimeout(() => {
      log(`${method}.onClose`, { wasShown: false, reason });
      safeCall(`${method}.onClose`, callbacks.onClose, ...closeArgs);
    }, 50);
  }

  function showFullscreenAdv(options) {
    const callbacks = (options && options.callbacks) || {};
    const method = 'adv.showFullscreenAdv';
    log(method, { mode: advMode });
    if (state.advOpen) return skipAdvLater(method, callbacks, [false], 'another adv is open');
    if (advMode === 'error') return failAdvLater(method, callbacks, [false]);
    if (advMode === 'skip') return skipAdvLater(method, callbacks, [false], 'adv=skip');

    state.advOpen = true;
    pauseFor('adv');
    log(`${method}.onOpen`);
    safeCall(`${method}.onOpen`, callbacks.onOpen);
    let timer = 0;
    const overlay = showOverlay('MOCK: полноэкранная реклама', [
      { id: 'mock-adv-close', label: 'Закрыть', onClick: () => close('button') },
    ]);
    timer = setTimeout(() => close('timeout'), FULLSCREEN_ADV_MS);

    function close(by) {
      if (!state.advOpen) return;
      clearTimeout(timer);
      overlay.remove();
      state.advOpen = false;
      log(`${method}.onClose`, { wasShown: true, by });
      safeCall(`${method}.onClose`, callbacks.onClose, true);
      resumeFor('adv');
    }
  }

  function showRewardedVideo(options) {
    const callbacks = (options && options.callbacks) || {};
    const method = 'adv.showRewardedVideo';
    log(method, { mode: advMode });
    if (state.advOpen) return skipAdvLater(method, callbacks, [], 'another adv is open');
    if (advMode === 'error') return failAdvLater(method, callbacks, []);
    if (advMode === 'skip') return skipAdvLater(method, callbacks, [], 'adv=skip');

    state.advOpen = true;
    pauseFor('adv');
    log(`${method}.onOpen`);
    safeCall(`${method}.onOpen`, callbacks.onOpen);
    const overlay = showOverlay('MOCK: реклама за награду', [
      { id: 'mock-adv-watch', label: 'Досмотреть', onClick: () => close(true) },
      { id: 'mock-adv-close', label: 'Закрыть', onClick: () => close(false) },
    ]);

    function close(rewarded) {
      if (!state.advOpen) return;
      overlay.remove();
      state.advOpen = false;
      if (rewarded) {
        log(`${method}.onRewarded`);
        safeCall(`${method}.onRewarded`, callbacks.onRewarded);
      }
      log(`${method}.onClose`, { rewarded });
      safeCall(`${method}.onClose`, callbacks.onClose);
      resumeFor('adv');
    }
  }

  function parseFlags() {
    const raw = query.get('flags');
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      const out = {};
      for (const key of Object.keys(parsed)) out[key] = String(parsed[key]);
      return out;
    } catch (error) {
      warn('getFlags: ?flags= is not valid JSON, ignored', { raw, message: error.message });
      return {};
    }
  }

  function detectDevice() {
    const forced = query.get('device');
    if (forced) return forced;
    const touch = 'ontouchstart' in window;
    if (!touch) return 'desktop';
    return window.innerWidth >= 768 ? 'tablet' : 'mobile';
  }

  function deviceCheck(name, value) {
    return () => {
      log(`deviceInfo.${name}`, { value });
      return value;
    };
  }

  function createPlayer(store) {
    const persist = () => writeJson(PLAYER_KEY, store);
    return {
      isAuthorized() {
        log('player.isAuthorized', { value: store.authorized });
        return store.authorized;
      },
      getMode() {
        log('player.getMode');
        return store.authorized ? '' : 'lite';
      },
      getUniqueID() {
        log('player.getUniqueID', { value: store.uid });
        return store.uid;
      },
      getName() {
        const name = store.authorized ? 'Mock Player' : '';
        log('player.getName', { value: name });
        return name;
      },
      getPhoto(size) {
        log('player.getPhoto', { size });
        return '';
      },
      getPayingStatus() {
        log('player.getPayingStatus');
        return 'unknown';
      },
      getIDsPerGame() {
        return call('player.getIDsPerGame', {}, () => (store.authorized ? [{ appID: Number(config.appId) || 0, userID: store.uid }] : []));
      },
      setData(data, flush) {
        let snapshot;
        try {
          snapshot = JSON.parse(JSON.stringify(data || {}));
        } catch (error) {
          warn('player.setData -> reject: data is not JSON-serializable', { message: error.message });
          return Promise.reject(error);
        }
        const bytes = byteSize(snapshot);
        return call('player.setData', { bytes, flush: Boolean(flush), keys: Object.keys(snapshot) }, () => {
          if (bytes > DATA_LIMIT_BYTES) throw new Error(`setData payload ${bytes} B exceeds ${DATA_LIMIT_BYTES} B`);
          store.data = snapshot;
          persist();
          return undefined;
        });
      },
      getData(keys) {
        return call('player.getData', { keys: keys || 'all' }, () => pick(store.data, keys));
      },
      setStats(stats) {
        const snapshot = Object.assign({}, stats);
        return call('player.setStats', snapshot, () => {
          for (const key of Object.keys(snapshot)) {
            if (typeof snapshot[key] !== 'number') throw new Error(`setStats: value for "${key}" is not a number`);
          }
          if (byteSize(snapshot) > STATS_LIMIT_BYTES) throw new Error(`setStats payload exceeds ${STATS_LIMIT_BYTES} B`);
          store.stats = snapshot;
          persist();
          return undefined;
        });
      },
      getStats(keys) {
        return call('player.getStats', { keys: keys || 'all' }, () => pick(store.stats, keys));
      },
      incrementStats(increments) {
        return call('player.incrementStats', increments, () => {
          const newKeys = [];
          for (const key of Object.keys(increments || {})) {
            if (!(key in store.stats)) newKeys.push(key);
            store.stats[key] = (store.stats[key] || 0) + Number(increments[key]);
          }
          persist();
          return { stats: Object.assign({}, store.stats), newKeys };
        });
      },
    };
  }

  function createLeaderboards(store) {
    const readBoards = () => readJson(BOARDS_KEY, {});
    const description = (name) => ({
      appID: String(config.appId),
      name,
      default: false,
      title: { ru: name, en: name },
      description: { invert_sort_order: false, type: 'numberic', score_format: { options: { decimal_offset: 0 } } },
    });
    const toEntry = (row, rank) => ({
      score: row.score,
      formattedScore: String(row.score),
      extraData: row.extraData,
      rank,
      player: {
        uniqueID: row.uid,
        publicName: row.name,
        lang: 'ru',
        scopePermissions: { avatar: 'forbid', public_name: 'allow' },
        getAvatarSrc: () => '',
        getAvatarSrcSet: () => '',
      },
    });
    const sorted = (name) => (readBoards()[name] || []).slice().sort((a, b) => b.score - a.score);

    return {
      getDescription(name) {
        return call('leaderboards.getDescription', { name }, () => description(name));
      },
      setScore(name, score, extraData) {
        return call('leaderboards.setScore', { name, score, extraData }, () => {
          if (!store.authorized) throw Object.assign(new Error('player is not authorized'), { code: 'NOT_AUTHORIZED' });
          if (!Number.isInteger(score) || score < 0) throw new Error(`score must be a non-negative integer, got ${score}`);
          const boards = readBoards();
          const rows = boards[name] || [];
          const existing = rows.find((row) => row.uid === store.uid);
          if (existing) {
            existing.score = Math.max(existing.score, score);
            existing.extraData = extraData;
          } else {
            rows.push({ uid: store.uid, name: 'Mock Player', score, extraData });
          }
          boards[name] = rows;
          writeJson(BOARDS_KEY, boards);
          return undefined;
        });
      },
      getPlayerEntry(name) {
        return call('leaderboards.getPlayerEntry', { name }, () => {
          const rows = sorted(name);
          const index = rows.findIndex((row) => row.uid === store.uid);
          if (index < 0) throw Object.assign(new Error('player is not present in leaderboard'), { code: 'LEADERBOARD_PLAYER_NOT_PRESENT' });
          return toEntry(rows[index], index + 1);
        });
      },
      getEntries(name, options) {
        return call('leaderboards.getEntries', Object.assign({ name }, options), () => {
          const rows = sorted(name);
          const top = Math.min(Math.max((options && options.quantityTop) || 5, 1), 20);
          const userRank = rows.findIndex((row) => row.uid === store.uid) + 1;
          return {
            leaderboard: description(name),
            ranges: [{ start: 0, size: Math.min(top, rows.length) }],
            userRank,
            entries: rows.slice(0, top).map((row, i) => toEntry(row, i + 1)),
          };
        });
      },
    };
  }

  function hasPath(root, path) {
    let node = root;
    for (const part of path.split('.')) {
      if (node === null || node === undefined || !(part in node)) return false;
      node = node[part];
    }
    return typeof node === 'function';
  }

  function buildSdk() {
    const store = loadPlayer();
    playerStore = store;
    const lang = (query.get('lang') || navigator.language || 'ru').slice(0, 2).toLowerCase();
    const deviceType = detectDevice();
    const player = createPlayer(store);
    const sdk = {
      EVENTS: {
        ACCOUNT_SELECTION_DIALOG_CLOSED: 'ACCOUNT_SELECTION_DIALOG_CLOSED',
        ACCOUNT_SELECTION_DIALOG_OPENED: 'ACCOUNT_SELECTION_DIALOG_OPENED',
        EXIT: 'EXIT',
        HISTORY_BACK: 'HISTORY_BACK',
      },
      environment: {
        app: { id: String(config.appId === undefined ? 'mock' : config.appId) },
        browser: { lang },
        i18n: { lang, tld: query.get('tld') || 'ru' },
        payload: query.get('payload'),
      },
      deviceInfo: {
        get type() {
          log('deviceInfo.type', { value: deviceType });
          return deviceType;
        },
        isMobile: deviceCheck('isMobile', deviceType === 'mobile'),
        isDesktop: deviceCheck('isDesktop', deviceType === 'desktop'),
        isTablet: deviceCheck('isTablet', deviceType === 'tablet'),
        isTV: deviceCheck('isTV', deviceType === 'tv'),
      },
      features: {
        LoadingAPI: {
          ready() {
            state.readyCalls += 1;
            if (state.readyCalls === 1) log('LoadingAPI.ready', { sinceNavigationMs: Math.round(performance.now()) });
            else warn('LoadingAPI.ready called again', { calls: state.readyCalls });
          },
        },
        GameplayAPI: {
          start() {
            log('GameplayAPI.start', { wasRunning: state.gameplayRunning });
            state.gameplayRunning = true;
          },
          stop() {
            log('GameplayAPI.stop', { wasRunning: state.gameplayRunning });
            state.gameplayRunning = false;
          },
        },
      },
      adv: {
        showFullscreenAdv,
        showRewardedVideo,
        getBannerAdvStatus() {
          return call('adv.getBannerAdvStatus', {}, () => ({ stickyAdvIsShowing: false, reason: 'ADV_IS_NOT_CONNECTED' }));
        },
        showBannerAdv() {
          return call('adv.showBannerAdv', {}, () => ({ reason: 'ADV_IS_NOT_CONNECTED' }));
        },
        hideBannerAdv() {
          return call('adv.hideBannerAdv', {}, () => ({ stickyAdvIsShowing: false }));
        },
      },
      auth: {
        openAuthDialog() {
          return call('auth.openAuthDialog', {}, () => {
            store.authorized = true;
            writeJson(PLAYER_KEY, store);
            return undefined;
          });
        },
      },
      clipboard: {
        writeText(text) {
          log('clipboard.writeText', { length: String(text).length });
        },
      },
      feedback: {
        canReview() {
          return call('feedback.canReview', {}, () => {
            if (!store.authorized) return { value: false, reason: 'NO_AUTH' };
            if (state.reviewRequested) return { value: false, reason: 'REVIEW_ALREADY_REQUESTED' };
            return { value: true };
          });
        },
        requestReview() {
          return call('feedback.requestReview', {}, () => {
            state.reviewRequested = true;
            return { feedbackSent: true };
          });
        },
      },
      shortcut: {
        canShowPrompt() {
          return call('shortcut.canShowPrompt', {}, () => ({ canShow: true }));
        },
        showPrompt() {
          return call('shortcut.showPrompt', {}, () => ({ outcome: 'accepted' }));
        },
      },
      leaderboards: createLeaderboards(store),
      getPlayer(options) {
        return call('getPlayer', options || {}, () => player, () => ({ uid: store.uid, authorized: store.authorized }));
      },
      getStorage() {
        return call('getStorage', {}, () => window.localStorage, (storage) => ({ type: 'localStorage', keys: storage.length }));
      },
      getFlags(params) {
        return call('getFlags', params || {}, () => Object.assign({}, (params && params.defaultFlags) || {}, parseFlags()));
      },
      serverTime() {
        const now = Date.now();
        log('serverTime', { value: now });
        return now;
      },
      isAvailableMethod(name) {
        return call('isAvailableMethod', { name }, () => hasPath(sdk, name));
      },
      on,
      off,
      onEvent(eventName, listener) {
        return on(eventName, listener);
      },
      dispatchEvent(eventName, detail) {
        return call('dispatchEvent', { eventName, detail }, () => undefined);
      },
    };
    return sdk;
  }

  let instance = null;
  let pendingInit = null;

  function init(options) {
    if (instance) {
      warn('init called again, returning the same instance');
      return Promise.resolve(instance);
    }
    if (pendingInit) {
      warn('init called again while the first call is pending, returning the same promise');
      return pendingInit;
    }
    pendingInit = call('init', options || {}, () => {
      instance = buildSdk();
      document.addEventListener('visibilitychange', () => (document.hidden ? pauseFor('visibility') : resumeFor('visibility')));
      if (query.get('startAdv') === '1') setTimeout(platformStartAdv, 0);
      return { appId: instance.environment.app.id, lang: instance.environment.i18n.lang, device: detectDevice() };
    }).then(
      () => instance,
      (error) => {
        pendingInit = null;
        throw error;
      },
    );
    return pendingInit;
  }

  function platformStartAdv() {
    log('platform start adv: open (startAdv=1)');
    state.advOpen = true;
    pauseFor('start-adv');
    const overlay = showOverlay('MOCK: стартовая реклама платформы', [
      { id: 'mock-adv-close', label: 'Закрыть', onClick: () => finish('button') },
    ]);
    const timer = setTimeout(() => finish('timeout'), FULLSCREEN_ADV_MS);
    function finish(by) {
      clearTimeout(timer);
      if (!overlay.isConnected) return;
      overlay.remove();
      state.advOpen = false;
      log('platform start adv: closed', { by });
      resumeFor('start-adv');
    }
  }

  window.YaGames = {
    init,
    mock: {
      pause: () => pauseFor('manual'),
      resume: () => resumeFor('manual'),
      emit,
      state: () => Object.assign({ pauseReasons: Array.from(pauseReasons) }, state),
      reset() {
        window.localStorage.removeItem(PLAYER_KEY);
        window.localStorage.removeItem(BOARDS_KEY);
        if (playerStore) Object.assign(playerStore, { authorized: false, data: {}, stats: {} });
        log('mock.reset', { cleared: [PLAYER_KEY, BOARDS_KEY], inMemory: Boolean(playerStore) });
      },
    },
  };

  if (document.body) mountBadge();
  else document.addEventListener('DOMContentLoaded', mountBadge);
  log('loaded', { appId: config.appId, delayMs, failures: Array.from(failures), adv: advMode });
})();
