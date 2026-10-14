import { basename, join } from 'node:path';
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { ROOT, readYgConfig } from './games.mjs';

const E2E_PORT_OFFSET = 100;

export function createE2eConfig(gameDir: string): PlaywrightTestConfig {
  const game = basename(gameDir);
  const port = (readYgConfig(gameDir) as { devPort: number }).devPort + E2E_PORT_OFFSET;
  return defineConfig({
    testDir: join(gameDir, 'e2e'),
    outputDir: join(ROOT, 'test-results', game),
    timeout: 60_000,
    workers: 1,
    fullyParallel: false,
    reporter: [['list']],
    use: {
      baseURL: `http://localhost:${port}/`,
      trace: 'retain-on-failure',
    },
    projects: [
      { name: 'mobile-360x640', use: { viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
      { name: 'desktop-1280x720', use: { viewport: { width: 1280, height: 720 } } },
    ],
    webServer: {
      command: `node tools/dev.mjs ${game} --port ${port}`,
      cwd: ROOT,
      url: `http://localhost:${port}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
    },
  });
}
