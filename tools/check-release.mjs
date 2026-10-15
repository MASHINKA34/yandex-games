import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, relative, sep } from 'node:path';
import { chromium } from '@playwright/test';
import AdmZip from 'adm-zip';
import { ROOT, loadGame, mockSdkSource } from './games.mjs';
import { createLogger, installProcessHandlers, since } from './log.mjs';

const baseLog = createLogger('check');
installProcessHandlers(baseLog);

const READY_TIMEOUT_MS = 30_000;
const SETTLE_MS = 5_000;
const PAUSE_PROBE_MS = 300;
const GAME_PATH = '/games/app/build/';
const READY_LINE = /^\[mock-sdk\] LoadingAPI\.ready( #\d+)? \d{2}:\d{2}:\d{2}\.\d{3}/;
const SOFTWARE_GPU_NOISE = /^\[\.WebGL-0x[0-9a-f]+\]GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels/;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const cleanup = { browser: null, server: null, workDir: null };

async function releaseResources(log) {
  if (cleanup.browser) await cleanup.browser.close().catch((error) => log.warn('browser close failed', { error }));
  if (cleanup.server) await new Promise((resolve) => cleanup.server.close(resolve));
  if (cleanup.workDir) {
    rmSync(cleanup.workDir, { recursive: true, force: true });
    log.debug('temporary folder removed', { dir: cleanup.workDir });
  }
  cleanup.browser = null;
  cleanup.server = null;
  cleanup.workDir = null;
}

function serveArchive(root, entries, log) {
  const served = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(GAME_PATH)) {
      log.warn(`404 outside the game folder: ${req.method} ${url.pathname}`);
      res.writeHead(404).end();
      return;
    }
    let entry;
    try {
      entry = decodeURIComponent(url.pathname.slice(GAME_PATH.length)) || 'index.html';
    } catch (error) {
      log.warn(`400 malformed URL: ${url.pathname}`, { error });
      res.writeHead(400).end();
      return;
    }
    if (!entries.has(entry)) {
      log.warn(`404 not in archive (paths are case-sensitive, like on the platform): ${url.pathname}`);
      res.writeHead(404).end();
      return;
    }
    const file = join(root, ...entry.split('/'));
    served.push(entry);
    log.debug(`200 ${url.pathname}`, { bytes: statSync(file).size });
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, served }));
  });
}

function writeReport(path, report) {
  mkdirSync(join(ROOT, 'reports'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

async function inspect(game, zipPath, report, log) {
  cleanup.workDir = mkdtempSync(join(tmpdir(), `yg-check-${game.name}-`));
  const extractStartedAt = performance.now();
  const zip = new AdmZip(zipPath);
  const entries = new Set(zip.getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName));
  zip.extractAllTo(cleanup.workDir, true);
  log.info(`archive extracted in ${since(extractStartedAt)}ms`, { entries: entries.size, dir: cleanup.workDir });

  const served = await serveArchive(cleanup.workDir, entries, log);
  cleanup.server = served.server;
  const origin = `http://127.0.0.1:${served.port}`;
  log.info('static server started', { origin, gamePath: GAME_PATH });

  const launchStartedAt = performance.now();
  cleanup.browser = await chromium.launch();
  log.info(`headless chromium started in ${since(launchStartedAt)}ms`, { version: cleanup.browser.version() });
  const page = await cleanup.browser.newPage({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });

  await page.route('**/sdk.js', (route) => {
    log.debug('GET /sdk.js -> mock', { url: route.request().url() });
    return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: mockSdkSource(game.config.appId) });
  });

  let readyAt = 0;
  const navigationStartedAt = Date.now();
  const isExternal = (raw) => {
    const url = new URL(raw);
    return url.protocol !== 'data:' && url.protocol !== 'blob:' && url.host !== new URL(origin).host;
  };
  page.on('console', (message) => {
    const text = message.text();
    if (READY_LINE.test(text) && !readyAt) readyAt = Date.now();
    if (message.type() === 'error') report.consoleErrors.push(text);
    if (message.type() === 'warning' && !SOFTWARE_GPU_NOISE.test(text)) report.consoleWarnings.push(text);
  });
  page.on('pageerror', (error) => report.pageErrors.push(`${error.name}: ${error.message}`));
  page.on('request', (request) => {
    report.requests += 1;
    if (isExternal(request.url())) report.externalRequests.push(request.url());
  });
  page.on('websocket', (socket) => {
    if (isExternal(socket.url())) report.externalRequests.push(socket.url());
  });
  page.on('requestfailed', (request) => report.failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`.trim()));
  page.on('response', (response) => {
    if (response.status() >= 400) report.failedRequests.push(`${response.url()} HTTP ${response.status()}`);
  });

  await page.goto(`${origin}${GAME_PATH}index.html`);
  log.info('page opened, waiting for LoadingAPI.ready', { timeoutMs: READY_TIMEOUT_MS });
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (!readyAt && Date.now() < deadline) await page.waitForTimeout(100);
  if (readyAt) {
    report.readyMs = readyAt - navigationStartedAt;
    log.info(`LoadingAPI.ready after ${report.readyMs}ms`);
    await page.evaluate((ms) => {
      const mock = globalThis.YaGames.mock;
      mock.pause();
      return new Promise((resolve) => setTimeout(() => resolve(mock.resume()), ms));
    }, PAUSE_PROBE_MS);
    log.info('game_api_pause and game_api_resume emulated through the mock');
  } else {
    report.problems.push(`LoadingAPI.ready was not called within ${READY_TIMEOUT_MS}ms`);
  }
  log.info(`watching the page for ${SETTLE_MS}ms more`);
  await page.waitForTimeout(SETTLE_MS);
  report.servedFiles = [...new Set(served.served)];

  if (report.consoleErrors.length > 0) report.problems.push(`${report.consoleErrors.length} console error(s)`);
  if (report.consoleWarnings.length > 0) report.problems.push(`${report.consoleWarnings.length} console warning(s)`);
  if (report.pageErrors.length > 0) report.problems.push(`${report.pageErrors.length} uncaught page error(s)`);
  if (report.externalRequests.length > 0) report.problems.push(`${report.externalRequests.length} request(s) to external hosts`);
  if (report.failedRequests.length > 0) report.problems.push(`${report.failedRequests.length} failed request(s)`);
}

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  if (rest.length > 0) throw new Error(`unknown argument "${rest[0]}", usage: check-release.mjs <game>`);
  const game = loadGame(name);
  const log = baseLog.child(game.name);
  const { version } = game.config;
  const zipPath = join(ROOT, 'dist', `${game.name}-${version}.zip`);
  const reportPath = join(ROOT, 'reports', `check-${game.name}.json`);
  const startedAt = performance.now();

  let interrupted = '';
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      interrupted = signal;
      log.warn(`received ${signal}, stopping the check and cleaning up`);
      setTimeout(() => process.exit(1), 5000).unref();
      void releaseResources(log);
    });
  }

  const report = {
    game: game.name,
    version,
    zip: relative(ROOT, zipPath).split(sep).join('/'),
    checkedAt: new Date().toISOString(),
    ok: false,
    durationMs: 0,
    readyMs: null,
    requests: 0,
    servedFiles: [],
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    externalRequests: [],
    failedRequests: [],
    problems: [],
  };

  if (!existsSync(zipPath)) {
    report.problems.push(`${report.zip} not found, run "npm run zip:${game.name}" first`);
  } else {
    log.info(`checking release archive of ${game.name}`, { version, zip: report.zip });
    try {
      await inspect(game, zipPath, report, log);
    } catch (error) {
      if (interrupted) {
        log.warn(`release check stopped by ${interrupted}`);
        report.problems.push(`check stopped by ${interrupted}`);
      } else {
        log.error('release check crashed', { zip: report.zip, error });
        report.problems.push(`check crashed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      await releaseResources(log);
    }
  }

  report.ok = report.problems.length === 0;
  report.durationMs = since(startedAt);
  writeReport(reportPath, report);

  for (const text of report.consoleErrors) log.error('console error', { text });
  for (const text of report.consoleWarnings) log.warn('console warning', { text });
  for (const text of report.pageErrors) log.error('page error', { text });
  for (const url of report.externalRequests) log.error('external request', { url });
  for (const entry of report.failedRequests) log.error('failed request', { entry });
  const summary = { readyMs: report.readyMs, requests: report.requests, files: report.servedFiles.length, report: relative(ROOT, reportPath) };
  if (report.ok) {
    log.info(`release check passed in ${report.durationMs}ms`, summary);
  } else {
    log.error(`release check failed: ${report.problems.join('; ')}`, summary);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  baseLog.error('check-release failed', { argv: process.argv.slice(2).join(' '), error });
  process.exitCode = 1;
});
