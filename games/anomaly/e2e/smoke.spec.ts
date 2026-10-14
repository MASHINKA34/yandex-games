import { expect, test } from '@playwright/test';
import { canvasBox, collectConsole, consoleProblems, delayResumeEvents, gameUi, mockIndexes, readRegistry, readText, waitForScene } from '../../../tools/e2e';

test('sdk cycle: ready, gameplay start/stop, interstitial, rewarded', async ({ page, hasTouch }) => {
  const lines = collectConsole(page);
  const ui = gameUi(page, hasTouch);

  await page.goto('./?log=debug');
  await waitForScene(page, 'Menu');
  const [initIndex] = mockIndexes(lines, 'init');
  const readyIndexes = mockIndexes(lines, 'LoadingAPI.ready');
  expect(initIndex).toBeDefined();
  expect(readyIndexes).toHaveLength(1);
  expect(readyIndexes[0]).toBeGreaterThan(initIndex ?? Infinity);

  await ui.tapObject('Menu', 'btn-play');
  await waitForScene(page, 'Play');
  await expect.poll(() => mockIndexes(lines, 'GameplayAPI.start').length).toBe(1);

  await waitForScene(page, 'Result', 10_000);
  await expect.poll(() => mockIndexes(lines, 'GameplayAPI.stop').length).toBe(1);

  const beforeAgain = lines.length;
  const clickedAt = Date.now();
  await ui.tapObject('Result', 'btn-again');
  await expect.poll(() => mockIndexes(lines, 'adv.showFullscreenAdv', beforeAgain).length).toBe(1);
  const advLine = lines[mockIndexes(lines, 'adv.showFullscreenAdv', beforeAgain)[0] ?? -1];
  expect((advLine?.at ?? Infinity) - clickedAt).toBeLessThanOrEqual(2000);
  await waitForScene(page, 'Play');
  const [pauseIndex] = mockIndexes(lines, 'emit game_api_pause', beforeAgain);
  const [resumeIndex] = mockIndexes(lines, 'emit game_api_resume', beforeAgain);
  expect(pauseIndex).toBeDefined();
  expect(resumeIndex).toBeGreaterThan(pauseIndex ?? Infinity);
  await expect.poll(() => mockIndexes(lines, 'GameplayAPI.start').length).toBe(2);

  await ui.tapObject('Play', 'btn-finish');
  await waitForScene(page, 'Result');
  await expect.poll(() => mockIndexes(lines, 'GameplayAPI.stop').length).toBe(2);

  await ui.tapObject('Result', 'btn-bonus');
  await ui.tapDom('#mock-adv-watch');
  await expect.poll(() => mockIndexes(lines, 'adv.showRewardedVideo.onRewarded').length).toBe(1);
  await expect.poll(() => readRegistry(page, 'bonus')).toBe(1);
  await expect.poll(() => readText(page, 'Result', 'bonus-count')).toMatch(/\b1\b/);

  expect(consoleProblems(lines)).toEqual([]);
});

test('late game_api_resume and double tap do not duplicate gameplay events', async ({ page, hasTouch }) => {
  await delayResumeEvents(page, 150);
  const lines = collectConsole(page);
  const ui = gameUi(page, hasTouch);

  await page.goto('./?log=debug');
  await waitForScene(page, 'Menu');
  await ui.doubleTapObject('Menu', 'btn-play');
  await waitForScene(page, 'Play');
  await ui.tapObject('Play', 'btn-finish');
  await waitForScene(page, 'Result');
  expect(await readRegistry(page, 'rounds')).toBe(1);

  await ui.tapObject('Result', 'btn-again');
  await waitForScene(page, 'Play');
  await expect.poll(() => mockIndexes(lines, 'emit game_api_resume').length).toBe(1);
  await page.waitForTimeout(300);
  expect(mockIndexes(lines, 'GameplayAPI.start')).toHaveLength(2);
  expect(mockIndexes(lines, 'GameplayAPI.stop')).toHaveLength(1);
  expect(lines.filter((line) => line.text.includes('skipped: already sent'))).toEqual([]);
  expect(consoleProblems(lines)).toEqual([]);
});

test('stray taps, focus loss and rotation', async ({ page, hasTouch, isMobile }) => {
  const lines = collectConsole(page);
  const ui = gameUi(page, hasTouch);

  await page.goto('./?log=debug');
  await waitForScene(page, 'Menu');
  if (!hasTouch) {
    await ui.rightClickObject('Menu', 'btn-play');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__ygGame?.scene.isActive('Menu'))).toBe(true);
  }
  await ui.tapObject('Menu', 'btn-play');
  await waitForScene(page, 'Play');

  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => mockIndexes(lines, 'GameplayAPI.stop').length).toBe(1);
  expect(await page.evaluate(() => (window.__ygGame as unknown as { loop: { running: boolean } }).loop.running)).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => mockIndexes(lines, 'GameplayAPI.start').length).toBe(2);

  await ui.doubleTapObject('Play', 'btn-finish', 150);
  await waitForScene(page, 'Result');
  await page.waitForTimeout(400);
  expect(mockIndexes(lines, 'adv.showRewardedVideo')).toEqual([]);
  expect(await page.locator('#mock-adv-overlay').count()).toBe(0);

  if (isMobile) {
    const portrait = await canvasBox(page);
    await page.setViewportSize({ width: 640, height: 360 });
    await page.waitForTimeout(500);
    const landscape = await canvasBox(page);
    expect(landscape.height).toBeLessThanOrEqual(360);
    expect(landscape.top).toBeGreaterThanOrEqual(0);
    await page.setViewportSize({ width: 360, height: 640 });
    await page.waitForTimeout(500);
    expect(await canvasBox(page)).toEqual(portrait);
  }
  expect(consoleProblems(lines)).toEqual([]);
});
