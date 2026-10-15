import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, loadGame } from './games.mjs';
import { createLogger, installProcessHandlers, since } from './log.mjs';

const log = createLogger('proxy');
installProcessHandlers(log);

const PROXY_PORT = 8080;
const DEV_CHECK_TIMEOUT_MS = 3000;

const WINDOWS_CTRL_C_EXIT = 0xc000013a;

async function devServerHasHmr(url) {
  try {
    const client = await (await fetch(`${url}/@vite/client`, { signal: AbortSignal.timeout(DEV_CHECK_TIMEOUT_MS) })).text();
    return client.includes('new WebSocket');
  } catch (error) {
    log.warn('could not read /@vite/client from the dev server', { url, error });
    return false;
  }
}

async function devServerAnswers(url) {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(DEV_CHECK_TIMEOUT_MS) });
    log.info(`dev server answered ${response.status} in ${since(startedAt)}ms`, { url });
    return response.ok;
  } catch (error) {
    log.error('dev server is not reachable', { url, ms: since(startedAt), error });
    return false;
  }
}

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  if (rest.length > 0) throw new Error(`unknown argument "${rest[0]}", usage: proxy.mjs <game>`);
  const game = loadGame(name);
  const { appId, devPort } = game.config;
  if (appId === null || appId === undefined) {
    log.error(`${game.name} has no appId in games/${game.name}/yg.config.json: create the game in the Yandex Games console first and put its ID there`);
    process.exitCode = 1;
    return;
  }
  const devUrl = `http://localhost:${devPort}`;
  if (!(await devServerAnswers(devUrl))) {
    log.error(`start the dev server first: npm run dev:${game.name} -- --no-hmr (without HMR, its websocket does not go through the proxy)`);
    process.exitCode = 1;
    return;
  }
  if (await devServerHasHmr(devUrl)) {
    log.warn(`dev server runs with HMR: its websocket does not pass through the proxy and the console will show [vite] websocket errors; restart it with npm run dev:${game.name} -- --no-hmr`);
  }

  const args = ['-h', devUrl, `--app-id=${appId}`, `--port=${PROXY_PORT}`];
  const bin = join(ROOT, 'node_modules', '@yandex-games', 'sdk-dev-proxy', 'bin', 'index.js');
  log.info(`starting sdk-dev-proxy for ${game.name}`, { appId, devServer: devUrl, port: PROXY_PORT });
  log.info(`open https://yandex.ru/games/app/${appId}?draft=true&game_url=https://localhost:${PROXY_PORT} while logged in as the developer; the proxy certificate is self-signed, accept it once at https://localhost:${PROXY_PORT}`);

  const child = spawn(process.execPath, [bin, ...args], { cwd: ROOT, stdio: 'inherit' });
  child.on('error', (error) => {
    log.error('sdk-dev-proxy failed to start', { bin, error });
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    const stoppedByUser = code === 0 || code === WINDOWS_CTRL_C_EXIT || signal === 'SIGINT' || signal === 'SIGTERM';
    if (stoppedByUser) {
      log.info('sdk-dev-proxy stopped', { code, signal });
      process.exitCode = 0;
    } else {
      log.error('sdk-dev-proxy exited with an error, see its output above (for example EADDRINUSE when the port is busy)', { code, signal, port: PROXY_PORT });
      process.exitCode = code ?? 1;
    }
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      log.info(`received ${signal}, stopping sdk-dev-proxy`);
      child.kill(signal);
    });
  }
}

main().catch((error) => {
  log.error('proxy failed', { argv: process.argv.slice(2).join(' '), error });
  process.exitCode = 1;
});
