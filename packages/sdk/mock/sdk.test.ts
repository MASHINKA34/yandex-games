import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SDK } from 'ysdk';

interface MockGlobal {
  init(): Promise<SDK>;
  mock: {
    pause(): void;
    resume(): void;
    state(): { readyCalls: number; pauseReasons: string[] };
    reset(): void;
  };
}

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'sdk.js'), 'utf8');
const lines: string[] = [];

function loadMock(search = ''): MockGlobal {
  window.history.replaceState({}, '', `/${search}`);
  const win = window as unknown as { __YG_MOCK__: unknown; YaGames: MockGlobal };
  win.__YG_MOCK__ = { appId: '631192' };
  new Function(source)();
  return win.YaGames;
}

const mockLines = (fragment: string) => lines.filter((line) => line.includes(`[mock-sdk] ${fragment}`));

beforeEach(() => {
  lines.length = 0;
  localStorage.clear();
  document.body.innerHTML = '';
  for (const method of ['info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((line: unknown) => {
      lines.push(`${method}: ${String(line)}`);
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('mock sdk', () => {
  it('init resolves with environment from query and logs with time', async () => {
    const sdk = await loadMock('?lang=tr&payload=abc').init();
    expect(sdk.environment.app.id).toBe('631192');
    expect(sdk.environment.i18n.lang).toBe('tr');
    expect(sdk.environment.payload).toBe('abc');
    expect(sdk.deviceInfo.type).toBe('desktop');
    expect(mockLines('init')[0]).toMatch(/^info: \[mock-sdk\] init #\d+ \d{2}:\d{2}:\d{2}\.\d{3} /);
    expect(document.getElementById('mock-sdk-badge')?.textContent).toBe('MOCK SDK');
  });

  it('player data survives a reload through localStorage', async () => {
    const player = await (await loadMock().init()).getPlayer();
    await player.setData({ level: 3, coins: 10 }, true);
    const reloaded = await (await loadMock().init()).getPlayer();
    expect(await reloaded.getData()).toEqual({ level: 3, coins: 10 });
    expect(await reloaded.getData(['coins'])).toEqual({ coins: 10 });
    expect(reloaded.getUniqueID()).toBe(player.getUniqueID());
  });

  it('mockFail rejects only the named method', async () => {
    const player = await (await loadMock('?mockFail=setData').init()).getPlayer();
    await expect(player.setData({ a: 1 })).rejects.toMatchObject({ code: 'MOCK_FAIL' });
    await expect(player.getData()).resolves.toEqual({});
    expect(mockLines('player.setData -> reject')[0]).toMatch(/^warn:/);
  });

  it('mockDelay postpones async results', async () => {
    const sdk = await loadMock('?mockDelay=150').init();
    const startedAt = performance.now();
    await sdk.getPlayer();
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(140);
  });

  it('fullscreen adv pauses, opens, closes after 1.5 s and resumes', async () => {
    const sdk = await loadMock().init();
    vi.useFakeTimers();
    const order: string[] = [];
    sdk.on('game_api_pause', () => order.push('pause'));
    sdk.on('game_api_resume', () => order.push('resume'));
    sdk.adv.showFullscreenAdv({
      callbacks: { onOpen: () => order.push('open'), onClose: (shown) => order.push(`close:${shown}`) },
    });
    expect(document.getElementById('mock-adv-close')).not.toBeNull();
    vi.advanceTimersByTime(1500);
    expect(order).toEqual(['pause', 'open', 'close:true', 'resume']);
    expect(document.getElementById('mock-adv-overlay')).toBeNull();
  });

  it('adv=error calls onError then onClose(false) without pausing', async () => {
    const sdk = await loadMock('?adv=error').init();
    vi.useFakeTimers();
    const order: string[] = [];
    sdk.on('game_api_pause', () => order.push('pause'));
    sdk.adv.showFullscreenAdv({
      callbacks: { onError: () => order.push('error'), onClose: (shown) => order.push(`close:${shown}`) },
    });
    vi.advanceTimersByTime(100);
    expect(order).toEqual(['error', 'close:false']);
  });

  it('rewarded gives the reward only after watching', async () => {
    const sdk = await loadMock().init();
    const run = (buttonId: string) => {
      const events: string[] = [];
      sdk.adv.showRewardedVideo({
        callbacks: { onRewarded: () => events.push('rewarded'), onClose: () => events.push('close') },
      });
      document.getElementById(buttonId)?.click();
      return events;
    };
    expect(run('mock-adv-watch')).toEqual(['rewarded', 'close']);
    expect(run('mock-adv-close')).toEqual(['close']);
  });

  it('getFlags merges defaults with ?flags=', async () => {
    const sdk = await loadMock('?flags={"adCooldown":"30"}').init();
    expect(await sdk.getFlags({ defaultFlags: { adCooldown: '60', mode: 'a' } })).toEqual({ adCooldown: '30', mode: 'a' });
  });

  it('second LoadingAPI.ready is reported as a warning', async () => {
    const yaGames = loadMock();
    const sdk = await yaGames.init();
    sdk.features.LoadingAPI.ready();
    sdk.features.LoadingAPI.ready();
    expect(mockLines('LoadingAPI.ready')).toHaveLength(2);
    expect(mockLines('LoadingAPI.ready called again')[0]).toMatch(/^warn:/);
    expect(yaGames.mock.state().readyCalls).toBe(2);
  });

  it('manual pause emits pause and resume and is shown on the badge', async () => {
    const yaGames = loadMock();
    const sdk = await yaGames.init();
    const order: string[] = [];
    sdk.on('game_api_pause', () => order.push('pause'));
    sdk.on('game_api_resume', () => order.push('resume'));
    yaGames.mock.pause();
    expect(yaGames.mock.state().pauseReasons).toEqual(['manual']);
    expect(document.getElementById('mock-sdk-badge')?.textContent).toBe('MOCK SDK: pause (manual)');
    yaGames.mock.pause();
    yaGames.mock.resume();
    expect(order).toEqual(['pause', 'resume']);
    expect(mockLines('pause reason already active')).toHaveLength(1);
  });

  it('setData stores a snapshot taken at call time and rejects unserializable data', async () => {
    const player = await (await loadMock('?mockDelay=30').init()).getPlayer();
    const data = { a: 1 };
    const saving = player.setData(data);
    data.a = 999;
    await saving;
    expect(await player.getData()).toEqual({ a: 1 });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(player.setData(circular)).rejects.toBeInstanceOf(TypeError);
  });

  it('async calls carry an id in request and result lines', async () => {
    const player = await (await loadMock().init()).getPlayer();
    await player.getData();
    const request = mockLines('player.getData #')[0] ?? '';
    const id = /#(\d+)/.exec(request)?.[1];
    expect(id).toBeDefined();
    expect(mockLines(`player.getData -> resolve #${id}`)).toHaveLength(1);
  });
  it('parallel init calls share one instance', async () => {
    const yaGames = loadMock('?mockDelay=50');
    const [first, second] = await Promise.all([yaGames.init(), yaGames.init()]);
    expect(first).toBe(second);
    expect(mockLines('init called again while the first call is pending')[0]).toMatch(/^warn:/);
  });

  it('reset clears stored and in-memory player data', async () => {
    const yaGames = loadMock();
    const player = await (await yaGames.init()).getPlayer();
    await player.setData({ secret: 1 });
    yaGames.mock.reset();
    await player.setStats({ a: 1 });
    expect(await player.getData()).toEqual({});
    expect(JSON.parse(localStorage.getItem('yg-mock-player') ?? '{}')).toMatchObject({ data: {}, stats: { a: 1 } });
  });
});
