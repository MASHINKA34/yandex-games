import type { Page } from '@playwright/test';

interface GameHandle {
  canvas: HTMLCanvasElement;
  scale: { width: number; height: number };
  registry: { get(key: string): unknown };
  scene: {
    isActive(key: string): boolean;
    getScene(key: string): {
      children: {
        getByName(name: string): null | { text?: string; getData?(key: string): unknown; getBounds(): { centerX: number; centerY: number } };
      };
    };
  };
}

declare global {
  interface Window {
    __ygGame?: GameHandle;
  }
}

export interface ConsoleLine {
  at: number;
  type: string;
  text: string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function collectConsole(page: Page): ConsoleLine[] {
  const lines: ConsoleLine[] = [];
  page.on('console', (message) => lines.push({ at: Date.now(), type: message.type(), text: message.text() }));
  page.on('pageerror', (error) => lines.push({ at: Date.now(), type: 'pageerror', text: `${error.name}: ${error.message}` }));
  return lines;
}

export function mockMatcher(method: string): RegExp {
  return new RegExp(`^\\[mock-sdk\\] ${escapeRegExp(method)}( #\\d+)? \\d{2}:\\d{2}:\\d{2}\\.\\d{3}`);
}

export function mockIndexes(lines: ConsoleLine[], method: string, from = 0): number[] {
  const matcher = mockMatcher(method);
  const out: number[] = [];
  for (let i = from; i < lines.length; i += 1) if (matcher.test(lines[i]?.text ?? '')) out.push(i);
  return out;
}

const SOFTWARE_GPU_NOISE = /^\[\.WebGL-0x[0-9a-f]+\]GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels/;

export function isSoftwareGpuNoise(line: ConsoleLine): boolean {
  return line.type === 'warning' && SOFTWARE_GPU_NOISE.test(line.text);
}

export function consoleProblems(lines: ConsoleLine[]): string[] {
  return lines
    .filter((line) => (line.type === 'error' || line.type === 'pageerror' || line.type === 'warning') && !isSoftwareGpuNoise(line))
    .map((line) => `${line.type}: ${line.text}`);
}

export async function delayResumeEvents(page: Page, delayMs: number): Promise<void> {
  const wrapper = `;(function () {
  var init = window.YaGames.init;
  window.YaGames.init = function (options) {
    return init(options).then(function (sdk) {
      var on = sdk.on;
      sdk.on = function (event, listener) {
        if (event !== 'game_api_resume') return on(event, listener);
        return on(event, function (detail) { setTimeout(function () { listener(detail); }, ${delayMs}); });
      };
      return sdk;
    });
  };
})();`;
  await page.route('**/sdk.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + wrapper });
  });
}

export async function waitForScene(page: Page, key: string, timeout = 15_000): Promise<void> {
  await page.waitForFunction((sceneKey) => window.__ygGame?.scene.isActive(sceneKey) ?? false, key, { timeout });
}

export async function canvasBox(page: Page): Promise<{ width: number; height: number; left: number; top: number }> {
  return page.evaluate(() => {
    const rect = window.__ygGame?.canvas.getBoundingClientRect();
    return { width: Math.round(rect?.width ?? 0), height: Math.round(rect?.height ?? 0), left: Math.round(rect?.left ?? 0), top: Math.round(rect?.top ?? 0) };
  });
}

export async function readRegistry(page: Page, key: string): Promise<unknown> {
  return page.evaluate((name) => window.__ygGame?.registry.get(name), key);
}

export async function readText(page: Page, sceneKey: string, name: string): Promise<string> {
  return page.evaluate(([scene, object]) => window.__ygGame?.scene.getScene(scene).children.getByName(object)?.text ?? '', [sceneKey, name] as const);
}

export function gameUi(page: Page, hasTouch: boolean) {
  const pointAt = async (x: number, y: number) => {
    if (hasTouch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  };
  const objectPoint = async (sceneKey: string, name: string) => {
    const point = await page.evaluate(
      ([scene, object]) => {
        const game = window.__ygGame;
        const target = game?.scene.getScene(scene).children.getByName(object);
        if (!game || !target) return null;
        const bounds = target.getBounds();
        const rect = game.canvas.getBoundingClientRect();
        const armedAt = Number(target.getData?.('armedAt') ?? 0);
        return {
          x: rect.left + (bounds.centerX * rect.width) / game.scale.width,
          y: rect.top + (bounds.centerY * rect.height) / game.scale.height,
          waitMs: Math.max(0, armedAt - performance.now()),
        };
      },
      [sceneKey, name] as const,
    );
    if (!point) throw new Error(`object "${name}" not found in scene "${sceneKey}"`);
    if (point.waitMs > 0) await page.waitForTimeout(point.waitMs + 20);
    return point;
  };
  return {
    async tapObject(sceneKey: string, name: string): Promise<void> {
      const point = await objectPoint(sceneKey, name);
      await pointAt(point.x, point.y);
    },
    async doubleTapObject(sceneKey: string, name: string, gapMs = 0): Promise<void> {
      const point = await objectPoint(sceneKey, name);
      if (hasTouch) {
        await page.touchscreen.tap(point.x, point.y);
        if (gapMs > 0) await page.waitForTimeout(gapMs);
        await page.touchscreen.tap(point.x, point.y);
      } else if (gapMs > 0) {
        await page.mouse.click(point.x, point.y);
        await page.waitForTimeout(gapMs);
        await page.mouse.click(point.x, point.y);
      } else {
        await page.mouse.click(point.x, point.y, { clickCount: 2 });
      }
    },
    async rightClickObject(sceneKey: string, name: string): Promise<void> {
      const point = await objectPoint(sceneKey, name);
      await page.mouse.click(point.x, point.y, { button: 'right' });
    },
    async tapDom(selector: string): Promise<void> {
      const locator = page.locator(selector);
      if (hasTouch) await locator.tap();
      else await locator.click();
    },
  };
}
