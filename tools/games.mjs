import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const GAMES_DIR = join(ROOT, 'games');
export const MOCK_SDK_PATH = join(ROOT, 'packages', 'sdk', 'mock', 'sdk.js');
export const CHECKER_PATH = join(ROOT, 'vendor', 'yg-debug-checker', 'debugcheck.js');

export function listGames() {
  return readdirSync(GAMES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(GAMES_DIR, entry.name, 'yg.config.json')))
    .map((entry) => entry.name);
}

export function readYgConfig(gameDir) {
  return JSON.parse(readFileSync(join(gameDir, 'yg.config.json'), 'utf8'));
}

export function loadGame(name) {
  const games = listGames();
  if (!name || !games.includes(name)) {
    throw new Error(`unknown game "${name ?? ''}", expected one of: ${games.join(', ')}`);
  }
  const dir = join(GAMES_DIR, name);
  return { name, dir, distDir: join(dir, 'dist'), config: readYgConfig(dir) };
}

export function mockSdkSource(appId) {
  const config = JSON.stringify({ appId: appId === null || appId === undefined ? 'mock' : String(appId) });
  return `window.__YG_MOCK__ = ${config};\n${readFileSync(MOCK_SDK_PATH, 'utf8')}`;
}
